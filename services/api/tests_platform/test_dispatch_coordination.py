from datetime import datetime, timedelta, timezone

import pytest

from app.platform.dispatch_coordination import DispatchCoordinator
from app.platform.models import WorkflowRun, utc_now


def workflow_event(run_id: str, key: str) -> dict:
    timestamp = datetime.now(timezone.utc).isoformat()
    return {
        "run_id": run_id,
        "event_key": key,
        "phase": "queued",
        "status": "completed",
        "title": key,
        "summary": None,
        "detail": None,
        "started_at": timestamp,
        "completed_at": timestamp,
        "duration_ms": 1,
        "metadata": {},
    }


async def create_run(client, headers) -> str:
    project = await client.post(
        "/api/v1/projects", headers=headers, json={"name": "Dispatch lease"}
    )
    conversation = await client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"project_id": project.json()["id"], "title": "Dispatch"},
    )
    run = await client.post(
        "/api/v1/workflow-runs",
        headers=headers,
        json={
            "project_id": project.json()["id"],
            "conversation_id": conversation.json()["id"],
            "input": {"prompt": "Analyze"},
        },
    )
    assert run.status_code == 201, run.text
    return run.json()["id"]


@pytest.mark.anyio
async def test_cross_instance_dispatch_authorization_and_receipt_are_cas(
    client, app, auth_headers, runtime_settings
):
    run_id = await create_run(client, auth_headers("dispatch-user"))
    with app.state.database.session() as session:
        first = DispatchCoordinator(session, runtime_settings).acquire(run_id)
    with app.state.database.session() as session:
        second = DispatchCoordinator(session, runtime_settings).acquire(run_id)
    assert first.outcome == "authorized"
    assert second.outcome == "in_progress"
    assert second.lease_id == first.lease_id

    internal = {"X-Internal-Service-Secret": "internal-secret"}
    base = f"/api/v1/internal/workflow/runs/{run_id}"
    authorized = await client.post(
        f"{base}/dispatch/authorize",
        headers=internal,
        json={"dispatch_lease_id": first.lease_id},
    )
    duplicate = await client.post(
        f"{base}/dispatch/authorize",
        headers=internal,
        json={"dispatch_lease_id": first.lease_id},
    )
    assert authorized.json()["outcome"] == "authorized"
    assert duplicate.json()["outcome"] == "in_progress"

    recorded = await client.post(
        f"{base}/dispatch/receipt",
        headers=internal,
        json={
            "dispatch_lease_id": first.lease_id,
            "workflow_execution_id": "workflow-first",
        },
    )
    late = await client.post(
        f"{base}/dispatch/receipt",
        headers=internal,
        json={
            "dispatch_lease_id": first.lease_id,
            "workflow_execution_id": "workflow-late",
        },
    )
    assert recorded.json()["workflow_execution_id"] == "workflow-first"
    assert late.json()["outcome"] == "conflict"
    assert late.json()["workflow_execution_id"] == "workflow-first"

    busy = await client.post(
        f"{base}/claim",
        headers=internal,
        json={
            "workflow_execution_id": "workflow-late",
            "event": workflow_event(run_id, "late-claim"),
        },
    )
    claimed = await client.post(
        f"{base}/claim",
        headers=internal,
        json={
            "workflow_execution_id": "workflow-first",
            "event": workflow_event(run_id, "winning-claim"),
        },
    )
    assert busy.json()["outcome"] == "busy"
    assert claimed.json()["outcome"] == "claimed"


@pytest.mark.anyio
async def test_timeout_replay_cannot_overwrite_a_workflow_that_claimed_first(
    client, app, auth_headers, runtime_settings
):
    run_id = await create_run(client, auth_headers("timeout-user"))
    with app.state.database.session() as session:
        first = DispatchCoordinator(session, runtime_settings).acquire(run_id)
        DispatchCoordinator(session, runtime_settings).authorize(run_id, first.lease_id)
    with app.state.database.session() as session:
        run = session.get(WorkflowRun, run_id)
        run.dispatch_lease_expires_at = utc_now() - timedelta(seconds=1)
    with app.state.database.session() as session:
        replay = DispatchCoordinator(session, runtime_settings).acquire(run_id)
    assert replay.lease_id != first.lease_id

    internal = {"X-Internal-Service-Secret": "internal-secret"}
    base = f"/api/v1/internal/workflow/runs/{run_id}"
    first_claim = await client.post(
        f"{base}/claim",
        headers=internal,
        json={
            "workflow_execution_id": "workflow-first",
            "event": workflow_event(run_id, "first-claim"),
        },
    )
    replay_receipt = await client.post(
        f"{base}/dispatch/receipt",
        headers=internal,
        json={
            "dispatch_lease_id": replay.lease_id,
            "workflow_execution_id": "workflow-replay",
        },
    )
    assert first_claim.json()["outcome"] == "claimed"
    assert replay_receipt.json()["outcome"] == "conflict"
    assert replay_receipt.json()["workflow_execution_id"] == "workflow-first"
