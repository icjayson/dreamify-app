import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.platform.database import Database
from app.platform.models import Asset, DailyRunUsage, StoredObject, WorkflowRun


class DispatchResponse:
    status_code = 202

    def json(self):
        return {"workflow_run_id": "wfr_usage_test"}


@pytest.fixture
def dispatched(monkeypatch):
    calls = []

    def fake_dispatch(url, *, headers, json, timeout):
        calls.append((url, headers, json, timeout))
        return DispatchResponse()

    monkeypatch.setattr("app.platform.dispatch.httpx.post", fake_dispatch)
    return calls


async def create_project(client, headers, name):
    response = await client.post(
        "/api/v1/user/project/create",
        headers=headers,
        json={"name": name, "description": "Usage limits"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def create_asset(runtime_settings, owner_id, project_id):
    database = Database(runtime_settings)
    marker = uuid4().hex
    with database.session() as session:
        stored = StoredObject(
            owner_id=owner_id,
            backend="local",
            pathname=f"usage-tests/{marker}.csv",
            content_type="text/csv",
            size_bytes=12,
            checksum_sha256="a" * 64,
        )
        session.add(stored)
        session.flush()
        asset = Asset(
            owner_id=owner_id,
            project_id=project_id,
            stored_object_id=stored.id,
            filename=f"{marker}.csv",
            content_type="text/csv",
            size_bytes=12,
            status="ready",
        )
        session.add(asset)
        session.flush()
        asset_id = asset.id
    database.dispose()
    return asset_id


def chat_payload(project_id, request_id, *, asset_id=None, conversation_id=None):
    payload = {
        "client_request_id": request_id,
        "project_id": project_id,
        "user_node_contents": [
            {"type": "text", "data": {"text": f"Question {request_id}"}}
        ],
        "user_node_metadata": {"asset_selection": "none"},
        "model": "fast",
    }
    if asset_id:
        payload["asset_id"] = asset_id
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return payload


async def finish_run(client, run_id, event_type="run_completed"):
    response = await client.post(
        f"/api/v1/workflow-runs/{run_id}/events",
        headers={"X-Internal-Service-Secret": "internal-secret"},
        json={
            "event_key": event_type,
            "event_type": event_type,
            "payload": {"title": event_type},
        },
    )
    assert response.status_code == 201, response.text


def persisted_usage(runtime_settings):
    database = Database(runtime_settings)
    with database.session() as session:
        rows = session.execute(
            select(
                DailyRunUsage.scope,
                DailyRunUsage.subject_id,
                DailyRunUsage.run_kind,
                DailyRunUsage.run_count,
            )
        ).all()
    database.dispose()
    return {(scope, subject, kind): count for scope, subject, kind, count in rows}


def persisted_runs(runtime_settings):
    database = Database(runtime_settings)
    with database.session() as session:
        rows = session.execute(
            select(
                WorkflowRun.id,
                WorkflowRun.parent_run_id,
                WorkflowRun.run_kind,
            ).order_by(WorkflowRun.created_at)
        ).all()
    database.dispose()
    return rows


@pytest.mark.anyio
async def test_aggregate_asset_limit_rejects_before_quota_is_consumed(
    client, auth_headers, runtime_settings
):
    headers = auth_headers("aggregate-user")
    project = await create_project(client, headers, "Aggregate boundary")
    asset_ids = [
        create_asset(runtime_settings, "aggregate-user", project["id"])
        for _ in range(2)
    ]
    runtime_settings.workflow_max_aggregate_asset_bytes = 23

    response = await client.post(
        "/api/v1/workflow-runs",
        headers=headers,
        json={
            "project_id": project["id"],
            "asset_ids": asset_ids,
            "input": {"question": "Summarize"},
        },
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "WORKFLOW_ASSET_BYTES_EXCEEDED"
    assert persisted_usage(runtime_settings) == {}
    assert persisted_runs(runtime_settings) == []


@pytest.mark.anyio
async def test_text_daily_limit_boundary_and_duplicate_does_not_charge(
    client, auth_headers, runtime_settings, dispatched
):
    headers = auth_headers("text-user")
    project = await create_project(client, headers, "Text quota")
    first_payload = chat_payload(project["id"], "text-run-00")

    accepted = await client.post(
        "/api/v1/conversation/chat", headers=headers, json=first_payload
    )
    duplicate = await client.post(
        "/api/v1/conversation/chat", headers=headers, json=first_payload
    )
    assert accepted.status_code == duplicate.status_code == 202
    assert accepted.json()["run_id"] == duplicate.json()["run_id"]

    for number in range(1, 20):
        response = await client.post(
            "/api/v1/conversation/chat",
            headers=headers,
            json=chat_payload(project["id"], f"text-run-{number:02d}"),
        )
        assert response.status_code == 202, response.text

    exhausted = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=chat_payload(project["id"], "text-run-20"),
    )
    assert exhausted.status_code == 429
    assert exhausted.json()["error"] == {
        "code": "RUN_QUOTA_EXCEEDED",
        "message": "Daily run quota is exhausted",
        "details": {
            "scope": "user",
            "run_kind": "text",
            "limit": 20,
            "usage_date": exhausted.json()["error"]["details"]["usage_date"],
            "reset_at": exhausted.json()["error"]["details"]["reset_at"],
        },
    }
    assert persisted_usage(runtime_settings)[("user", "text-user", "text")] == 20
    assert len(persisted_runs(runtime_settings)) == 20
    assert len(dispatched) == 20


@pytest.mark.anyio
async def test_one_active_data_run_and_per_user_daily_boundary(
    client, auth_headers, runtime_settings, dispatched
):
    headers = auth_headers("data-user")
    project = await create_project(client, headers, "Data quota")
    asset_id = create_asset(runtime_settings, "data-user", project["id"])

    accepted_ids = []
    for number in range(5):
        payload = chat_payload(
            project["id"], f"data-run-{number:02d}", asset_id=asset_id
        )
        response = await client.post(
            "/api/v1/conversation/chat", headers=headers, json=payload
        )
        assert response.status_code == 202, response.text
        accepted_ids.append(response.json()["run_id"])
        if number == 0:
            duplicate = await client.post(
                "/api/v1/conversation/chat", headers=headers, json=payload
            )
            assert duplicate.status_code == 202
            assert duplicate.json()["run_id"] == accepted_ids[0]
            for suffix in ("queued", "running", "cancelling"):
                active = await client.post(
                    "/api/v1/conversation/chat",
                    headers=headers,
                    json=chat_payload(
                        project["id"], f"data-run-{suffix}", asset_id=asset_id
                    ),
                )
                assert active.status_code == 429
                assert active.json()["error"]["code"] == "DATA_RUN_ALREADY_ACTIVE"
                assert (
                    active.json()["error"]["details"]["active_run_id"]
                    == accepted_ids[0]
                )
                if suffix == "queued":
                    await finish_run(client, accepted_ids[0], "run_started")
                elif suffix == "running":
                    stopped = await client.post(
                        f"/api/v1/conversation/{response.json()['conversation_id']}/stop",
                        params={"project_id": project["id"]},
                        headers=headers,
                    )
                    assert stopped.status_code == 200, stopped.text
        await finish_run(client, accepted_ids[-1])

    exhausted = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=chat_payload(project["id"], "data-run-05", asset_id=asset_id),
    )
    assert exhausted.status_code == 429
    assert exhausted.json()["error"]["code"] == "RUN_QUOTA_EXCEEDED"
    details = exhausted.json()["error"]["details"]
    assert details["scope"] == "user"
    assert details["run_kind"] == "data"
    assert details["limit"] == 5
    usage = persisted_usage(runtime_settings)
    assert usage[("user", "data-user", "data")] == 5
    assert usage[("deployment", "deployment", "data")] == 5
    assert len(dispatched) == 5


@pytest.mark.anyio
async def test_deployment_data_limit_rolls_back_rejected_user_charge(
    client, auth_headers, runtime_settings, dispatched
):
    for user_id in ("deployment-a", "deployment-b"):
        headers = auth_headers(user_id)
        project = await create_project(client, headers, user_id)
        asset_id = create_asset(runtime_settings, user_id, project["id"])
        for number in range(5):
            response = await client.post(
                "/api/v1/conversation/chat",
                headers=headers,
                json=chat_payload(
                    project["id"],
                    f"{user_id}-{number}",
                    asset_id=asset_id,
                ),
            )
            assert response.status_code == 202, response.text
            await finish_run(client, response.json()["run_id"])

    rejected_headers = auth_headers("deployment-c")
    rejected_project = await create_project(client, rejected_headers, "deployment-c")
    rejected_asset = create_asset(
        runtime_settings, "deployment-c", rejected_project["id"]
    )
    rejected = await client.post(
        "/api/v1/conversation/chat",
        headers=rejected_headers,
        json=chat_payload(
            rejected_project["id"], "deployment-c-0", asset_id=rejected_asset
        ),
    )
    assert rejected.status_code == 429
    assert rejected.json()["error"]["details"]["scope"] == "deployment"
    assert rejected.json()["error"]["details"]["limit"] == 10
    usage = persisted_usage(runtime_settings)
    assert usage[("deployment", "deployment", "data")] == 10
    assert ("user", "deployment-c", "data") not in usage
    assert len(dispatched) == 10


@pytest.mark.anyio
async def test_clarification_child_inherits_data_classification(
    client, auth_headers, runtime_settings, dispatched
):
    headers = auth_headers("clarification-user")
    project = await create_project(client, headers, "Clarification")
    asset_id = create_asset(runtime_settings, "clarification-user", project["id"])
    parent = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=chat_payload(project["id"], "clarify-parent", asset_id=asset_id),
    )
    assert parent.status_code == 202, parent.text
    await finish_run(client, parent.json()["run_id"], "awaiting_user_input")

    child = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=chat_payload(
            project["id"],
            "clarify-child",
            conversation_id=parent.json()["conversation_id"],
        ),
    )
    assert child.status_code == 202, child.text
    runs = persisted_runs(runtime_settings)
    assert runs[-1].parent_run_id == parent.json()["run_id"]
    assert [run.run_kind for run in runs] == ["data", "data"]
    usage = persisted_usage(runtime_settings)
    assert usage[("user", "clarification-user", "data")] == 2
    assert usage[("deployment", "deployment", "data")] == 2
    assert len(dispatched) == 2


@pytest.mark.anyio
async def test_concurrent_duplicate_text_request_is_charged_once(
    client, auth_headers, runtime_settings, dispatched
):
    headers = auth_headers("duplicate-user")
    project = await create_project(client, headers, "Concurrent duplicate")
    payload = chat_payload(project["id"], "duplicate-request")

    responses = await asyncio.gather(
        *(
            client.post("/api/v1/conversation/chat", headers=headers, json=payload)
            for _ in range(2)
        )
    )
    assert [response.status_code for response in responses] == [202, 202]
    assert len({response.json()["run_id"] for response in responses}) == 1
    assert persisted_usage(runtime_settings)[("user", "duplicate-user", "text")] == 1
    assert len(persisted_runs(runtime_settings)) == 1


@pytest.mark.anyio
async def test_concurrent_data_requests_enforce_single_active_run(
    client, auth_headers, runtime_settings, dispatched
):
    headers = auth_headers("concurrent-data-user")
    project = await create_project(client, headers, "Concurrent data")
    asset_id = create_asset(runtime_settings, "concurrent-data-user", project["id"])
    payloads = [
        chat_payload(project["id"], f"concurrent-data-{number}", asset_id=asset_id)
        for number in range(2)
    ]

    responses = await asyncio.gather(
        *(
            client.post("/api/v1/conversation/chat", headers=headers, json=payload)
            for payload in payloads
        )
    )
    assert sorted(response.status_code for response in responses) == [202, 429]
    rejected = next(response for response in responses if response.status_code == 429)
    assert rejected.json()["error"]["code"] == "DATA_RUN_ALREADY_ACTIVE"
    usage = persisted_usage(runtime_settings)
    assert usage[("user", "concurrent-data-user", "data")] == 1
    assert usage[("deployment", "deployment", "data")] == 1
    assert len(persisted_runs(runtime_settings)) == 1
