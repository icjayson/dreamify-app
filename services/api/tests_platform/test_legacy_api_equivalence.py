"""Behavior-level replacements for deployable legacy API contracts.

These tests exercise the Postgres/durable-Workflow implementation rather than
the retired DynamoDB, in-memory event bus, or Morpheus HTTP-server internals.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.platform.models import OverallFeedbackSubmission, Project


class DispatchResponse:
    status_code = 202

    def json(self):
        return {"workflow_run_id": "wfr_legacy_equivalence"}


async def create_project(client, headers, name="Legacy replacement"):
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def create_conversation(client, headers, project_id):
    response = await client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"project_id": project_id, "title": "Legacy conversation"},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.anyio
async def test_platform_smoke_and_removed_routes_are_truthful(client, auth_headers):
    assert (await client.get("/")).status_code == 404
    assert (await client.get("/health")).json() == {
        "status": "ok",
        "service": "dreamify-api",
    }
    assert (await client.get("/health/ready")).json() == {"status": "ready"}
    assert (await client.get("/api/v1/health")).status_code == 200
    assert (await client.get("/api/v1/docs")).status_code == 200

    schema_response = await client.get("/api/v1/openapi.json")
    assert schema_response.status_code == 200
    paths = schema_response.json()["paths"]
    assert "/api/v1/dashboards" in paths
    assert "/api/v1/user/asset/list" in paths
    assert "/api/v1/conversation/{conversation_id}/dashboard" in paths
    assert "/api/v1/stripe/products" not in paths
    assert "/api/v1/analytics/dashboard" not in paths

    headers = auth_headers("tenant-a")
    disabled_dashboard = await client.post(
        "/api/v1/dashboard/generate", headers=headers, json={}
    )
    assert disabled_dashboard.status_code == 503
    assert disabled_dashboard.json()["error"]["code"] == "FEATURE_DISABLED"
    disabled_upload = await client.post(
        "/api/v1/user/asset/upload", headers=headers, json={}
    )
    assert disabled_upload.status_code == 503
    assert disabled_upload.json()["error"]["code"] == "FEATURE_DISABLED"
    assert (await client.get("/api/v1/stripe/products")).status_code == 404
    assert (await client.get("/api/v1/analytics/dashboard")).status_code == 404


@pytest.mark.anyio
async def test_chat_preserves_chart_context_and_durable_stream_boundaries(
    client, auth_headers, monkeypatch
):
    monkeypatch.setattr(
        "app.platform.dispatch.httpx.post",
        lambda *_args, **_kwargs: DispatchResponse(),
    )
    owner = auth_headers("tenant-a")
    project = await create_project(client, owner)
    conversation = await create_conversation(client, owner, project["id"])
    dashboard = await client.post(
        "/api/v1/dashboards",
        headers=owner,
        json={
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "title": "Revenue",
            "content": {
                "id": "dashboard-1",
                "components": [
                    {
                        "id": "component-1",
                        "type": "chart",
                        "component_config": {"id": "chart-1"},
                    }
                ],
            },
        },
    )
    assert dashboard.status_code == 201, dashboard.text

    chart_mention = {
        "type": "chart_mention",
        "data": {
            "component_id": "component-1",
            "chart_id": "chart-1",
            "dashboard_id": dashboard.json()["id"],
            "title": "Revenue trend",
            "chart_type": "line",
            "config": {"title": "Revenue trend", "datasets": []},
        },
    }
    accepted = await client.post(
        "/api/v1/conversation/chat",
        headers=owner,
        json={
            "client_request_id": "legacy-chart-request-1",
            "conversation_id": conversation["id"],
            "project_id": project["id"],
            "model": "fast",
            "user_node_contents": [
                {"type": "text", "data": {"text": "Explain this chart"}},
                chart_mention,
            ],
            "user_node_metadata": {
                "asset_selection": "none",
                "selected_chart_ids": ["component-1"],
            },
        },
    )
    assert accepted.status_code == 202, accepted.text
    accepted_body = accepted.json()
    unchanged_project = await client.get(
        f"/api/v1/projects/{project['id']}", headers=owner
    )
    assert unchanged_project.json()["name"] == "Legacy replacement"

    restored = await client.get(
        f"/api/v1/conversation/{conversation['id']}",
        headers=owner,
        params={"project_id": project["id"]},
    )
    user_node = restored.json()["conversation"]["nodes"][0]
    assert user_node["contents"][1] == chart_mention
    assert user_node["metadata"]["selected_chart_ids"] == ["component-1"]

    starting = await client.get(accepted_body["links"]["status"], headers=owner)
    assert starting.json()["status"] == "starting"

    internal = {"X-Internal-Service-Secret": "internal-secret"}
    for key, event_type, phase in (
        ("legacy-start", "run_started", "routing"),
        ("legacy-clarify", "awaiting_user_input", "clarification"),
    ):
        event = await client.post(
            f"/api/v1/workflow-runs/{accepted_body['run_id']}/events",
            headers=internal,
            json={
                "event_key": key,
                "event_type": event_type,
                "payload": {
                    "phase": phase,
                    "step": phase,
                    "title": key,
                    "response_type": "clarification_request",
                    "metadata": {"step_index": 1},
                },
            },
        )
        assert event.status_code == 201, event.text

    events = await client.get(accepted_body["links"]["events"], headers=owner)
    assert [event["sequence"] for event in events.json()["events"]] == [1, 2]
    assert events.json()["status"]["status"] == "awaiting_user_input"

    stream = await client.get(
        accepted_body["links"]["stream"],
        headers={**owner, "Last-Event-ID": "1", "Accept": "text/event-stream"},
    )
    assert stream.status_code == 200
    assert "awaiting_user_input" in stream.text
    assert "id: 2\nevent: event" in stream.text
    assert "id: 1\nevent: event" not in stream.text
    assert (
        await client.get(
            accepted_body["links"]["stream"],
            headers=auth_headers("tenant-b"),
        )
    ).status_code == 404
    assert (
        await client.get(
            f"/api/v1/conversation/missing/stream?project_id={project['id']}",
            headers=owner,
        )
    ).status_code == 404


@pytest.mark.anyio
async def test_dashboard_versions_keep_cas_and_negative_boundaries(
    client, auth_headers
):
    owner = auth_headers("tenant-a")
    outsider = auth_headers("tenant-b")
    project = await create_project(client, owner)
    conversation = await create_conversation(client, owner, project["id"])
    dashboard = await client.post(
        "/api/v1/dashboards",
        headers=owner,
        json={
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "title": "Versioned",
            "content": {"id": "dashboard-versioned", "components": []},
        },
    )
    dashboard_id = dashboard.json()["id"]
    base = f"/api/v1/conversation/{conversation['id']}/dashboard/{dashboard_id}"

    stale = await client.put(
        f"{base}/data",
        headers=owner,
        json={
            "project_id": project["id"],
            "dashboard_data": {"id": "dashboard-versioned", "components": []},
            "expected_version": 99,
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "DASHBOARD_VERSION_CONFLICT"

    query = {"project_id": project["id"]}
    missing_version = await client.get(
        f"{base}/versions/99", headers=owner, params=query
    )
    assert missing_version.status_code == 404
    assert (
        await client.get(f"{base}/versions", headers=outsider, params=query)
    ).status_code == 404
    missing_revert = await client.post(
        f"{base}/revert",
        headers=owner,
        json={
            "project_id": project["id"],
            "target_version": 99,
            "expected_version": 1,
        },
    )
    assert missing_revert.status_code == 404
    missing_conversation = await client.post(
        f"/api/v1/conversation/missing/dashboard/{dashboard_id}/revert",
        headers=owner,
        json={
            "project_id": project["id"],
            "target_version": 1,
            "expected_version": 1,
        },
    )
    assert missing_conversation.status_code == 404


@pytest.mark.anyio
async def test_overall_feedback_persists_every_required_answer(client, app):
    payload = {
        "full_name": "Ada Lovelace",
        "email": "ADA@example.test",
        "overall_rating": 5,
        "visual_appeal_rating": 4,
        "metrics_insights_rating": 3,
        "layout_editing_rating": 4,
        "share_link_rating": 5,
        "requested_connectors": "HubSpot",
        "dashboard_improvements": "More filters",
        "export_improvements": "Scheduled PDF",
    }
    accepted = await client.post("/api/v1/feedback/overall", json=payload)
    assert accepted.status_code == 200
    with app.state.database.session() as session:
        stored = session.scalar(select(OverallFeedbackSubmission))
        assert stored is not None
        assert stored.email == "ada@example.test"
        for field, expected in payload.items():
            if field != "email":
                assert getattr(stored, field) == expected

    incomplete = dict(payload)
    incomplete.pop("export_improvements")
    assert (
        await client.post("/api/v1/feedback/overall", json=incomplete)
    ).status_code == 422


@pytest.mark.anyio
async def test_recent_projects_use_bounded_postgres_ordering(client, app, auth_headers):
    headers = auth_headers("tenant-a")
    projects = [
        await create_project(client, headers, name)
        for name in ("Oldest", "Middle", "Newest")
    ]
    epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with app.state.database.session() as session:
        for index, record in enumerate(projects):
            project = session.get(Project, record["id"])
            assert project is not None
            project.updated_at = epoch + timedelta(days=index)

    recent = await client.get(
        "/api/v1/user/project/recent", headers=headers, params={"limit": 2}
    )
    assert recent.status_code == 200
    assert [item["id"] for item in recent.json()["projects"]] == [
        projects[2]["id"],
        projects[1]["id"],
    ]
    assert (
        await client.get(
            "/api/v1/user/project/recent", headers=headers, params={"limit": 101}
        )
    ).status_code == 422
    schema = (await client.get("/api/v1/openapi.json")).json()
    assert "/api/v1/user/project/recent" in schema["paths"]


@pytest.mark.anyio
async def test_durable_events_preserve_nested_metadata_and_reject_oversize(
    client, auth_headers
):
    owner = auth_headers("tenant-a")
    project = await create_project(client, owner)
    conversation = await create_conversation(client, owner, project["id"])
    run = await client.post(
        "/api/v1/workflow-runs",
        headers=owner,
        json={
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "input": {"prompt": "Revenue?"},
        },
    )
    assert run.status_code == 201, run.text
    run_id = run.json()["id"]
    internal = {"X-Internal-Service-Secret": "internal-secret"}
    first_payload = {
        "title": "Sum revenue",
        "metadata": {
            "python": "df['rev'].sum()",
            "output": "12345",
            "step_index": 1,
        },
    }
    first = await client.post(
        f"/api/v1/workflow-runs/{run_id}/events",
        headers=internal,
        json={
            "event_key": "analysis-1",
            "event_type": "analysis",
            "payload": first_payload,
        },
    )
    replay = await client.post(
        f"/api/v1/workflow-runs/{run_id}/events",
        headers=internal,
        json={
            "event_key": "analysis-1",
            "event_type": "analysis",
            "payload": first_payload,
        },
    )
    assert first.status_code == replay.status_code == 201
    assert first.json()["id"] == replay.json()["id"]

    oversized = await client.post(
        f"/api/v1/workflow-runs/{run_id}/events",
        headers=internal,
        json={
            "event_key": "analysis-oversized",
            "event_type": "analysis",
            "payload": {"metadata": {"python": "x" * (33 * 1024)}},
        },
    )
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "EVENT_TOO_LARGE"

    second = await client.post(
        f"/api/v1/workflow-runs/{run_id}/events",
        headers=internal,
        json={
            "event_key": "analysis-2",
            "event_type": "analysis",
            "payload": {"title": "Second", "metadata": {"step_index": 2}},
        },
    )
    assert second.status_code == 201
    listed = await client.get(f"/api/v1/workflow-runs/{run_id}/events", headers=owner)
    assert [item["sequence"] for item in listed.json()] == [1, 2]
    assert listed.json()[0]["payload"] == first_payload
    assert (
        await client.get(
            f"/api/v1/workflow-runs/{run_id}/events",
            headers=auth_headers("tenant-b"),
        )
    ).status_code == 404
