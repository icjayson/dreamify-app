import pytest


async def create_project(client, headers, name="Project A"):
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.anyio
async def test_project_crud_and_cross_tenant_isolation(client, auth_headers):
    owner = auth_headers("tenant-a")
    outsider = auth_headers("tenant-b")
    project = await create_project(client, owner)

    visible = await client.get(f"/api/v1/projects/{project['id']}", headers=owner)
    assert visible.status_code == 200
    hidden = await client.get(f"/api/v1/projects/{project['id']}", headers=outsider)
    assert hidden.status_code == 404

    renamed = await client.patch(
        f"/api/v1/projects/{project['id']}",
        headers=owner,
        json={"name": "Renamed"},
    )
    assert renamed.json()["name"] == "Renamed"
    listing = await client.get("/api/v1/projects", headers=outsider)
    assert listing.json() == []


@pytest.mark.anyio
async def test_conversation_dashboard_and_workflow_contracts(client, auth_headers):
    owner = auth_headers("tenant-a")
    outsider = auth_headers("tenant-b")
    internal = {"X-Internal-Service-Secret": "internal-secret"}
    project = await create_project(client, owner)
    project_id = project["id"]

    conversation_response = await client.post(
        "/api/v1/conversations",
        headers=owner,
        json={"project_id": project_id, "title": "Analysis"},
    )
    assert conversation_response.status_code == 201
    conversation = conversation_response.json()

    dashboard_response = await client.post(
        "/api/v1/dashboards",
        headers=owner,
        json={"project_id": project_id, "title": "KPI", "content": {"charts": []}},
    )
    assert dashboard_response.status_code == 201
    dashboard = dashboard_response.json()
    updated = await client.patch(
        f"/api/v1/dashboards/{dashboard['id']}",
        headers=owner,
        json={"content": {"charts": [{"type": "bar"}]}, "expected_version": 1},
    )
    assert updated.json()["current_version"] == 2
    stale = await client.patch(
        f"/api/v1/dashboards/{dashboard['id']}",
        headers=owner,
        json={"content": {"charts": []}, "expected_version": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "DASHBOARD_VERSION_CONFLICT"
    versions = await client.get(
        f"/api/v1/dashboards/{dashboard['id']}/versions", headers=owner
    )
    assert [item["version"] for item in versions.json()] == [2, 1]
    assert (
        await client.get(f"/api/v1/dashboards/{dashboard['id']}", headers=outsider)
    ).status_code == 404

    run_response = await client.post(
        "/api/v1/workflow-runs",
        headers=owner,
        json={
            "project_id": project_id,
            "conversation_id": conversation["id"],
            "workflow_name": "analyze_data",
            "input": {"question": "Revenue?"},
        },
    )
    assert run_response.status_code == 201, run_response.text
    run = run_response.json()
    event_payload = {
        "event_key": "started-1",
        "event_type": "run_started",
        "payload": {"message": "started"},
    }
    event = await client.post(
        f"/api/v1/workflow-runs/{run['id']}/events",
        headers=internal,
        json=event_payload,
    )
    repeated = await client.post(
        f"/api/v1/workflow-runs/{run['id']}/events",
        headers=internal,
        json=event_payload,
    )
    assert event.status_code == repeated.status_code == 201
    assert event.json()["id"] == repeated.json()["id"]
    conflict = await client.post(
        f"/api/v1/workflow-runs/{run['id']}/events",
        headers=internal,
        json={**event_payload, "payload": {"message": "different"}},
    )
    assert conflict.status_code == 409
    assert (
        await client.get(f"/api/v1/workflow-runs/{run['id']}", headers=outsider)
    ).status_code == 404

    waiting = await client.post(
        f"/api/v1/workflow-runs/{run['id']}/events",
        headers=internal,
        json={
            "event_key": "clarify-1",
            "event_type": "awaiting_user_input",
            "payload": {"question": "Which period?"},
        },
    )
    assert waiting.status_code == 201
    child = await client.post(
        "/api/v1/workflow-runs",
        headers=owner,
        json={
            "project_id": project_id,
            "conversation_id": conversation["id"],
            "parent_run_id": run["id"],
            "input": {"answer": "Q2"},
        },
    )
    assert child.status_code == 201
    assert child.json()["parent_run_id"] == run["id"]
