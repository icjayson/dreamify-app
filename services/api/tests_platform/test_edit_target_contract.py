from datetime import datetime, timezone

import pytest


class DispatchResponse:
    status_code = 202

    def json(self):
        return {"workflow_run_id": "wfr-edit-target"}


def event(run_id, key, phase="queued"):
    timestamp = datetime.now(timezone.utc).isoformat()
    return {
        "run_id": run_id,
        "event_key": key,
        "phase": phase,
        "status": "completed",
        "title": key,
        "summary": None,
        "detail": None,
        "started_at": timestamp,
        "completed_at": timestamp,
        "duration_ms": 1,
        "metadata": {},
    }


def dashboard_content(identifier, value=1):
    return {
        "id": identifier,
        "title": identifier,
        "theme_id": "default",
        "layout": {"type": "grid", "grid_columns": 24},
        "components": [
            {
                "id": "component-revenue",
                "type": "chart",
                "position": {"x": 0, "y": 0, "width": 12, "height": 8},
                "component_config": {
                    "id": "chart-revenue",
                    "type": "bar",
                    "title": "Revenue",
                    "datasets": [
                        {
                            "label": "Revenue",
                            "data": [{"label": "A", "value": value}],
                        }
                    ],
                },
            },
            {
                "id": "component-orders",
                "type": "metric",
                "position": {"x": 12, "y": 0, "width": 6, "height": 2},
                "component_config": {
                    "id": "metric-orders",
                    "title": "Orders",
                    "value": 10,
                },
            },
        ],
    }


async def workspace(client, headers, suffix):
    project = await client.post(
        "/api/v1/projects", headers=headers, json={"name": f"Project {suffix}"}
    )
    conversation = await client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"project_id": project.json()["id"], "title": f"Chat {suffix}"},
    )
    return project.json()["id"], conversation.json()["id"]


async def dashboard(client, headers, project_id, conversation_id, identifier):
    response = await client.post(
        "/api/v1/dashboards",
        headers=headers,
        json={
            "project_id": project_id,
            "conversation_id": conversation_id,
            "title": identifier,
            "content": dashboard_content(identifier),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def chat_payload(project_id, conversation_id, dashboard_id, request_id):
    return {
        "client_request_id": request_id,
        "project_id": project_id,
        "conversation_id": conversation_id,
        "user_node_contents": [
            {"type": "text", "data": {"text": "Make revenue a line chart"}},
            {
                "type": "chart_mention",
                "data": {
                    "dashboard_id": dashboard_id,
                    "component_id": "component-revenue",
                    "chart_id": "chart-revenue",
                },
            },
        ],
        "edit_target": {
            "dashboard_id": dashboard_id,
            "component_ids": ["component-revenue", "chart-revenue"],
        },
    }


@pytest.mark.anyio
async def test_edit_target_selects_exact_dashboard_and_rejects_scope_mismatches(
    client, auth_headers, monkeypatch
):
    monkeypatch.setattr(
        "app.platform.dispatch.httpx.post", lambda *args, **kwargs: DispatchResponse()
    )
    headers = auth_headers("tenant-a")
    project_id, conversation_id = await workspace(client, headers, "A")
    selected = await dashboard(
        client, headers, project_id, conversation_id, "dashboard-selected"
    )
    await dashboard(client, headers, project_id, conversation_id, "dashboard-latest")

    accepted = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=chat_payload(
            project_id, conversation_id, selected["id"], "edit-target-selected"
        ),
    )
    assert accepted.status_code == 202, accepted.text
    run_id = accepted.json()["run_id"]
    context = await client.get(
        f"/api/v1/internal/workflow/runs/{run_id}/context",
        headers={"X-Internal-Service-Secret": "internal-secret"},
    )
    assert context.status_code == 200, context.text
    assert context.json()["context"]["existing_dashboard"]["id"] == (
        "dashboard-selected"
    )
    assert context.json()["context"]["edit_target"] == {
        "dashboard_id": selected["id"],
        "component_ids": ["component-revenue", "chart-revenue"],
    }

    internal = {"X-Internal-Service-Secret": "internal-secret"}
    base = f"/api/v1/internal/workflow/runs/{run_id}"
    await client.post(
        f"{base}/claim",
        headers=internal,
        json={
            "workflow_execution_id": "wfr-edit-target",
            "event": event(run_id, "claim:completed"),
        },
    )
    awaiting = await client.post(
        f"{base}/transition",
        headers=internal,
        json={
            "allowed_from": ["running"],
            "status": "awaiting_user_input",
            "current_step": "clarification",
            "response_type": "clarification_request",
            "event": event(run_id, "clarification:completed", "clarification"),
        },
    )
    assert awaiting.status_code == 200, awaiting.text
    child = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json={
            "client_request_id": "edit-target-child",
            "project_id": project_id,
            "conversation_id": conversation_id,
            "user_node_contents": [
                {"type": "text", "data": {"text": "Use sales.csv"}},
            ],
        },
    )
    assert child.status_code == 202, child.text
    child_context = await client.get(
        f"/api/v1/internal/workflow/runs/{child.json()['run_id']}/context",
        headers=internal,
    )
    assert (
        child_context.json()["context"]["edit_target"]["dashboard_id"]
        == (selected["id"])
    )

    tenant_b = auth_headers("tenant-b")
    project_b, conversation_b = await workspace(client, tenant_b, "B")
    cross_tenant = await client.post(
        "/api/v1/conversation/chat",
        headers=tenant_b,
        json=chat_payload(
            project_b, conversation_b, selected["id"], "edit-target-cross-tenant"
        ),
    )
    assert cross_tenant.status_code == 404

    missing_component_payload = chat_payload(
        project_id, conversation_id, selected["id"], "edit-target-missing-component"
    )
    missing_component_payload["user_node_contents"][1]["data"]["component_id"] = (
        "component-missing"
    )
    missing_component_payload["user_node_contents"][1]["data"]["chart_id"] = (
        "chart-missing"
    )
    missing_component_payload["edit_target"]["component_ids"] = [
        "component-missing",
        "chart-missing",
    ]
    missing_component = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=missing_component_payload,
    )
    assert missing_component.status_code == 409
    assert missing_component.json()["error"]["code"] == (
        "EDIT_TARGET_COMPONENT_MISMATCH"
    )

    mismatch_payload = chat_payload(
        project_id, conversation_id, selected["id"], "edit-target-mismatch"
    )
    mismatch_payload["edit_target"]["component_ids"] = ["component-orders"]
    mismatch = await client.post(
        "/api/v1/conversation/chat", headers=headers, json=mismatch_payload
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "EDIT_TARGET_MISMATCH"


@pytest.mark.anyio
async def test_chart_modification_commits_only_to_explicit_target(
    client, auth_headers, monkeypatch
):
    monkeypatch.setattr(
        "app.platform.dispatch.httpx.post", lambda *args, **kwargs: DispatchResponse()
    )
    headers = auth_headers("tenant-a")
    project_id, conversation_id = await workspace(client, headers, "commit")
    selected = await dashboard(
        client, headers, project_id, conversation_id, "dashboard-selected"
    )
    latest = await dashboard(
        client, headers, project_id, conversation_id, "dashboard-latest"
    )
    accepted = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=chat_payload(
            project_id, conversation_id, selected["id"], "edit-target-commit"
        ),
    )
    run_id = accepted.json()["run_id"]
    internal = {"X-Internal-Service-Secret": "internal-secret"}
    base = f"/api/v1/internal/workflow/runs/{run_id}"
    claim = await client.post(
        f"{base}/claim",
        headers=internal,
        json={
            "workflow_execution_id": "wfr-edit-target",
            "event": event(run_id, "claim:completed"),
        },
    )
    assert claim.status_code == 200, claim.text

    edited = dashboard_content("dashboard-selected", value=42)
    edited["components"][0]["component_config"]["type"] = "line"
    response = {
        "type": "chart_modification",
        "content": "Updated the selected revenue chart.",
        "dashboard": edited,
    }
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
    payload = {
        "terminal_status": "completed",
        "response": response,
        "response_artifact": artifact.json()["artifact"],
        "result_reference": {
            "message_id": f"message-{run_id}",
            "dashboard_id": "dashboard-selected",
            "artifact_ids": [artifact.json()["artifact"]["object_id"]],
            "response_type": "chart_modification",
        },
        "event": event(run_id, "persist:completed", "final"),
    }
    committed = await client.post(f"{base}/response", headers=internal, json=payload)
    assert committed.status_code == 200, committed.text
    assert committed.json()["run"]["result"]["dashboard_id"] == selected["id"]

    selected_after = await client.get(
        f"/api/v1/dashboards/{selected['id']}", headers=headers
    )
    latest_after = await client.get(
        f"/api/v1/dashboards/{latest['id']}", headers=headers
    )
    assert (
        selected_after.json()["content"]["components"][0]["component_config"]["type"]
        == "line"
    )
    assert selected_after.json()["current_version"] == 2
    assert latest_after.json()["content"]["id"] == "dashboard-latest"
    assert latest_after.json()["current_version"] == 1
