from datetime import datetime, timezone

import pytest


def workflow_event(run_id, key, phase="queued", event_status="completed"):
    timestamp = datetime.now(timezone.utc).isoformat()
    return {
        "run_id": run_id,
        "event_key": key,
        "phase": phase,
        "status": event_status,
        "title": key,
        "summary": None,
        "detail": None,
        "started_at": timestamp,
        "completed_at": timestamp if event_status != "active" else None,
        "duration_ms": 1 if event_status != "active" else None,
        "metadata": {},
    }


def assert_utc_timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.utcoffset() == timezone.utc.utcoffset(parsed)


async def create_run(client, headers, suffix="one"):
    project = await client.post(
        "/api/v1/projects", headers=headers, json={"name": f"Project {suffix}"}
    )
    conversation = await client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"project_id": project.json()["id"], "title": f"Chat {suffix}"},
    )
    run = await client.post(
        "/api/v1/workflow-runs",
        headers=headers,
        json={
            "project_id": project.json()["id"],
            "conversation_id": conversation.json()["id"],
            "input": {"prompt": "Analyze revenue"},
        },
    )
    assert run.status_code == 201, run.text
    return run.json()


def dashboard_response(run_id, title="Generated dashboard", description=None):
    dashboard = {
        "id": f"provider-dashboard-{run_id}",
        "title": title,
        "theme_id": "default",
        "layout": {"type": "grid", "grid_columns": 24},
        "components": [],
    }
    if description is not None:
        dashboard["description"] = description
    return {
        "type": "dashboard_config",
        "content": "Analysis completed",
        "dashboard": dashboard,
        "analysis_steps": [],
    }


async def claim_and_store_response(client, run, response):
    internal = {"X-Internal-Service-Secret": "internal-secret"}
    run_id = run["id"]
    base = f"/api/v1/internal/workflow/runs/{run_id}"
    claim = await client.post(
        f"{base}/claim",
        headers=internal,
        json={
            "workflow_execution_id": f"wfr-{run_id}",
            "event": workflow_event(run_id, "claim:completed"),
        },
    )
    assert claim.status_code == 200, claim.text
    artifact = await client.post(
        f"{base}/artifacts",
        headers=internal,
        json={
            "kind": "response",
            "value": response,
            "idempotency_key": f"{run_id}:response",
            "max_bytes": 1024 * 1024,
        },
    )
    assert artifact.status_code == 200, artifact.text
    payload = {
        "terminal_status": "completed",
        "response": response,
        "response_artifact": artifact.json()["artifact"],
        "result_reference": {
            "message_id": f"message-{run_id}",
            "dashboard_id": response["dashboard"]["id"],
            "artifact_ids": [artifact.json()["artifact"]["object_id"]],
            "response_type": response["type"],
        },
        "event": workflow_event(run_id, "persist:completed", "final"),
    }
    return base, internal, payload


@pytest.mark.anyio
async def test_internal_workflow_store_and_artifact_contract(client, auth_headers):
    user_headers = auth_headers("tenant-a")
    internal = {"X-Internal-Service-Secret": "internal-secret"}
    run = await create_run(client, user_headers)
    run_id = run["id"]
    base = f"/api/v1/internal/workflow/runs/{run_id}"

    unauthorized = await client.get(base)
    assert unauthorized.status_code == 401
    claim_payload = {
        "workflow_execution_id": "wfr_001",
        "event": workflow_event(run_id, "claim:completed"),
    }
    claimed = await client.post(f"{base}/claim", headers=internal, json=claim_payload)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["outcome"] == "claimed"
    assert claimed.json()["run"]["workflow_run_id"] == "wfr_001"
    for field in ("created_at", "updated_at", "started_at"):
        assert_utc_timestamp(claimed.json()["run"][field])
    assert claimed.json()["run"]["completed_at"] is None
    resumed = await client.post(f"{base}/claim", headers=internal, json=claim_payload)
    assert resumed.json()["outcome"] == "resume"
    busy = await client.post(
        f"{base}/claim",
        headers=internal,
        json={**claim_payload, "workflow_execution_id": "wfr_other"},
    )
    assert busy.json()["outcome"] == "busy"

    first_provider_call = await client.post(
        f"{base}/provider-calls/reserve",
        headers=internal,
        json={"call_key": "route:attempt:1"},
    )
    assert first_provider_call.status_code == 200
    assert first_provider_call.json() == {
        "call_key": "route:attempt:1",
        "ordinal": 1,
        "remaining": 4,
        "created": True,
    }
    replayed_provider_call = await client.post(
        f"{base}/provider-calls/reserve",
        headers=internal,
        json={"call_key": "route:attempt:1"},
    )
    assert replayed_provider_call.json() == {
        **first_provider_call.json(),
        "created": False,
    }
    for ordinal in range(2, 6):
        reserved = await client.post(
            f"{base}/provider-calls/reserve",
            headers=internal,
            json={"call_key": f"effect:{ordinal}"},
        )
        assert reserved.status_code == 200
        assert reserved.json()["ordinal"] == ordinal
        assert reserved.json()["remaining"] == 5 - ordinal
        assert reserved.json()["created"] is True
    exhausted = await client.post(
        f"{base}/provider-calls/reserve",
        headers=internal,
        json={"call_key": "effect:6"},
    )
    assert exhausted.status_code == 429
    assert exhausted.json()["error"]["code"] == "PROVIDER_CALL_BUDGET_EXCEEDED"

    context = await client.get(f"{base}/context", headers=internal)
    assert context.status_code == 200, context.text
    assert context.json()["context"]["prompt"] == "Analyze revenue"
    assert context.json()["context"]["assets"] == []
    transition = await client.post(
        f"{base}/transition",
        headers=internal,
        json={
            "allowed_from": ["running"],
            "status": "running",
            "current_step": "context",
            "event": workflow_event(run_id, "context:active", "context", "active"),
        },
    )
    assert transition.json()["run"]["current_step"] == "context"

    step_base = f"{base}/steps/context:profile"
    begin_payload = {
        "step": "profiling",
        "event": workflow_event(run_id, "profile:active", "profiling", "active"),
    }
    begun = await client.post(
        f"{step_base}/begin",
        headers=internal,
        json=begin_payload,
    )
    assert begun.status_code == 204
    replayed_begin = await client.post(
        f"{step_base}/begin",
        headers=internal,
        json={
            **begin_payload,
            "event": {
                **begin_payload["event"],
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
        },
    )
    assert replayed_begin.status_code == 204
    conflicting_begin = await client.post(
        f"{step_base}/begin",
        headers=internal,
        json={
            **begin_payload,
            "event": {**begin_payload["event"], "title": "changed"},
        },
    )
    assert conflicting_begin.status_code == 409
    assert (await client.get(step_base, headers=internal)).json() == {
        "found": False,
        "value": None,
    }
    result_payload = {
        "result": {"rows": 10},
        "event": workflow_event(run_id, "profile:completed", "profiling"),
    }
    completed = await client.put(step_base, headers=internal, json=result_payload)
    replay_event = {
        **result_payload["event"],
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": 99,
    }
    repeated = await client.put(
        step_base,
        headers=internal,
        json={**result_payload, "event": replay_event},
    )
    assert completed.status_code == repeated.status_code == 204
    assert (await client.get(step_base, headers=internal)).json()["value"] == {
        "rows": 10
    }
    conflict = await client.put(
        step_base,
        headers=internal,
        json={**result_payload, "result": {"rows": 11}},
    )
    assert conflict.status_code == 409

    capacity_payload = {"run_id": run_id, "idempotency_key": "capacity:profile"}
    first_lease = await client.post(
        "/api/v1/internal/workflow/capacity/acquire",
        headers=internal,
        json=capacity_payload,
    )
    same_lease = await client.post(
        "/api/v1/internal/workflow/capacity/acquire",
        headers=internal,
        json=capacity_payload,
    )
    assert first_lease.json() == same_lease.json()
    release = await client.post(
        "/api/v1/internal/workflow/capacity/release",
        headers=internal,
        json={
            "lease": first_lease.json()["lease"],
            "idempotency_key": "capacity:profile",
        },
    )
    assert release.status_code == 204
    fresh_lease = await client.post(
        "/api/v1/internal/workflow/capacity/acquire",
        headers=internal,
        json=capacity_payload,
    )
    assert (
        fresh_lease.json()["lease"]["lease_id"]
        != first_lease.json()["lease"]["lease_id"]
    )

    artifact_payload = {
        "kind": "response",
        "value": {"type": "message", "content": "Complete"},
        "idempotency_key": "response:artifact",
        "max_bytes": 1024,
    }
    artifact = await client.post(
        f"{base}/artifacts", headers=internal, json=artifact_payload
    )
    repeated_artifact = await client.post(
        f"{base}/artifacts", headers=internal, json=artifact_payload
    )
    assert artifact.json() == repeated_artifact.json()
    object_id = artifact.json()["artifact"]["object_id"]
    fetched = await client.get(f"{base}/artifacts/{object_id}", headers=internal)
    assert fetched.json()["value"] == artifact_payload["value"]
    artifact_conflict = await client.post(
        f"{base}/artifacts",
        headers=internal,
        json={**artifact_payload, "value": {"type": "message", "content": "Changed"}},
    )
    assert artifact_conflict.status_code == 409

    response_payload = {
        "terminal_status": "completed",
        "response": artifact_payload["value"],
        "response_artifact": artifact.json()["artifact"],
        "result_reference": {"message_id": "message-1", "response_type": "message"},
        "event": workflow_event(run_id, "response:completed", "final"),
    }
    committed = await client.post(
        f"{base}/response", headers=internal, json=response_payload
    )
    repeated_commit = await client.post(
        f"{base}/response", headers=internal, json=response_payload
    )
    assert committed.status_code == repeated_commit.status_code == 200
    assert committed.json()["run"]["status"] == "completed"
    assert (await client.get(f"{base}/response", headers=internal)).json() == {
        "response": artifact_payload["value"]
    }
    public_events = await client.get(
        f"/api/v1/workflow-runs/{run_id}/events", headers=user_headers
    )
    sequences = [item["sequence"] for item in public_events.json()]
    assert sequences == list(range(1, len(sequences) + 1))


@pytest.mark.anyio
async def test_internal_cancellation_is_idempotent_and_non_terminal(
    client, auth_headers
):
    run = await create_run(client, auth_headers("tenant-a"), "cancel")
    base = f"/api/v1/internal/workflow/runs/{run['id']}"
    headers = {"X-Internal-Service-Secret": "internal-secret"}
    payload = {"reason": "user"}
    first = await client.post(f"{base}/cancel", headers=headers, json=payload)
    repeated = await client.post(f"{base}/cancel", headers=headers, json=payload)
    assert first.status_code == repeated.status_code == 200
    assert first.json()["run"]["status"] == "cancelling"
    assert first.json()["run"]["cancel_requested"] is True
    assert first.json()["run"]["version"] == repeated.json()["run"]["version"]
    resumed = await client.post(
        f"{base}/claim",
        headers=headers,
        json={
            "workflow_execution_id": "wfr-cancel",
            "event": workflow_event(run["id"], "claim:cancel-resume"),
        },
    )
    assert resumed.status_code == 200
    assert resumed.json()["outcome"] == "resume"
    competing = await client.post(
        f"{base}/claim",
        headers=headers,
        json={
            "workflow_execution_id": "wfr-other",
            "event": workflow_event(run["id"], "claim:other"),
        },
    )
    assert competing.json()["outcome"] == "busy"


@pytest.mark.anyio
async def test_dashboard_response_is_materialized_once_and_readable(
    client, auth_headers
):
    user_headers = auth_headers("tenant-dashboard")
    run = await create_run(client, user_headers, "dashboard")
    response = dashboard_response(run["id"])
    base, internal, payload = await claim_and_store_response(client, run, response)

    committed = await client.post(f"{base}/response", headers=internal, json=payload)
    replay = await client.post(f"{base}/response", headers=internal, json=payload)
    assert committed.status_code == replay.status_code == 200
    dashboard_id = committed.json()["run"]["result"]["dashboard_id"]
    assert dashboard_id != response["dashboard"]["id"]
    assert replay.json()["run"]["result"]["dashboard_id"] == dashboard_id

    loaded = await client.get(
        f"/api/v1/conversation/{run['conversation_id']}/dashboard",
        headers=user_headers,
        params={"project_id": run["project_id"]},
    )
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["dashboard_id"] == dashboard_id
    assert loaded.json()["dashboard_data"] == response["dashboard"]
    versions = await client.get(
        f"/api/v1/dashboards/{dashboard_id}/versions", headers=user_headers
    )
    assert [item["version"] for item in versions.json()] == [1]


@pytest.mark.anyio
async def test_superseded_run_cannot_materialize_dashboard(client, auth_headers):
    user_headers = auth_headers("tenant-superseded")
    run = await create_run(client, user_headers, "superseded")
    response = dashboard_response(run["id"])
    base, internal, payload = await claim_and_store_response(client, run, response)
    cancelled = await client.post(
        f"{base}/cancel", headers=internal, json={"reason": "superseded"}
    )
    assert cancelled.status_code == 200

    rejected = await client.post(f"{base}/response", headers=internal, json=payload)
    assert rejected.status_code == 409
    dashboards = await client.get(
        "/api/v1/dashboards",
        headers=user_headers,
        params={"project_id": run["project_id"]},
    )
    assert dashboards.json() == []


@pytest.mark.anyio
async def test_dashboard_materialization_enforces_json_limit(
    client, auth_headers, runtime_settings
):
    runtime_settings.max_dashboard_bytes = 300
    user_headers = auth_headers("tenant-dashboard-limit")
    run = await create_run(client, user_headers, "dashboard-limit")
    response = dashboard_response(run["id"], description="x" * 400)
    base, internal, payload = await claim_and_store_response(client, run, response)

    rejected = await client.post(f"{base}/response", headers=internal, json=payload)
    assert rejected.status_code == 413
    assert rejected.json()["error"]["code"] == "DASHBOARD_TOO_LARGE"
    dashboards = await client.get(
        "/api/v1/dashboards",
        headers=user_headers,
        params={"project_id": run["project_id"]},
    )
    assert dashboards.json() == []
