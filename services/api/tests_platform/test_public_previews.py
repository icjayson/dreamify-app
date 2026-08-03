import pytest

from app.platform.database import Database
from app.platform.models import AppUser


async def create_preview_fixture(client, owner_headers):
    project_response = await client.post(
        "/api/v1/projects",
        headers=owner_headers,
        json={"name": "Shared KPI", "description": "Saved dashboard preview"},
    )
    assert project_response.status_code == 201, project_response.text
    project = project_response.json()
    conversation_response = await client.post(
        "/api/v1/conversations",
        headers=owner_headers,
        json={"project_id": project["id"], "title": "Preview conversation"},
    )
    assert conversation_response.status_code == 201, conversation_response.text
    conversation = conversation_response.json()
    dashboard_response = await client.post(
        "/api/v1/dashboards",
        headers=owner_headers,
        json={
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "title": "Latest KPI",
            "content": {"components": [{"type": "metric", "value": 42}]},
        },
    )
    assert dashboard_response.status_code == 201, dashboard_response.text
    return project, conversation, dashboard_response.json()


@pytest.mark.anyio
async def test_public_preview_is_explicit_and_never_exposes_assets(
    client, auth_headers
):
    owner = auth_headers("preview-owner")
    outsider = auth_headers("preview-outsider")
    project, conversation, dashboard = await create_preview_fixture(client, owner)
    metadata_url = f"/api/v1/public/project/{project['id']}"
    data_url = f"/api/v1/public/project/{project['id']}/dashboard"

    anonymous_private = await client.get(metadata_url)
    assert anonymous_private.status_code == 403
    assert anonymous_private.json()["error"]["code"] == "PREVIEW_PRIVATE"
    assert (await client.get(metadata_url, headers=outsider)).status_code == 403
    assert (await client.get(metadata_url, headers=owner)).status_code == 200

    enabled = await client.patch(
        f"/api/v1/projects/{project['id']}",
        headers=owner,
        json={"is_preview_public": True},
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["is_preview_public"] is True

    public_metadata = await client.get(metadata_url)
    assert public_metadata.status_code == 200
    assert public_metadata.headers["cache-control"] == "private, no-store"
    assert public_metadata.json()["latest_dashboard_id"] == dashboard["id"]
    assert "owner_id" not in public_metadata.json()
    assert "allowed" not in public_metadata.json()

    public_dashboard = await client.get(data_url)
    assert public_dashboard.status_code == 200
    assert public_dashboard.json()["dashboard_id"] == dashboard["id"]
    assert public_dashboard.json()["dashboard_data"]["components"][0]["value"] == 42
    assert "assets" not in public_dashboard.json()


@pytest.mark.anyio
async def test_private_preview_grants_require_signed_in_matching_identity(
    client, auth_headers, runtime_settings
):
    owner = auth_headers("preview-owner")
    viewer = auth_headers("preview-viewer")
    outsider = auth_headers("preview-outsider")
    project, conversation, _dashboard = await create_preview_fixture(client, owner)
    metadata_url = f"/api/v1/public/project/{project['id']}"
    data_url = f"/api/v1/public/project/{project['id']}/dashboard"

    assert (await client.get("/api/v1/users/me", headers=viewer)).status_code == 200
    database = Database(runtime_settings)
    with database.session() as session:
        session.get(AppUser, "preview-viewer").email = "viewer@example.test"
    database.dispose()

    lookup = await client.get(
        "/api/v1/user/lookup?email=Viewer%40Example.Test", headers=owner
    )
    assert lookup.status_code == 200
    assert lookup.json()["user_id"] == "preview-viewer"
    assert lookup.json()["email"] == "viewer@example.test"

    granted = await client.put(
        f"/api/v1/user/project/{project['id']}",
        headers=owner,
        json={"allowed": [{"email": "Viewer@Example.Test"}]},
    )
    assert granted.status_code == 200, granted.text
    assert granted.json()["allowed"] == [
        {
            "user_id": "preview-viewer",
            "email": "viewer@example.test",
            "name": None,
            "image_url": None,
        }
    ]

    assert (await client.get(metadata_url)).status_code == 403
    assert (await client.get(metadata_url, headers=outsider)).status_code == 403
    assert (await client.get(metadata_url, headers=viewer)).status_code == 200
    assert (await client.get(data_url, headers=viewer)).status_code == 200

    denied_update = await client.put(
        f"/api/v1/user/project/{project['id']}",
        headers=outsider,
        json={"is_preview_public": True},
    )
    assert denied_update.status_code == 404

    revoked = await client.put(
        f"/api/v1/user/project/{project['id']}",
        headers=owner,
        json={"allowed": []},
    )
    assert revoked.status_code == 200
    assert (await client.get(metadata_url, headers=viewer)).status_code == 403


@pytest.mark.anyio
async def test_public_dashboard_rejects_cross_project_conversation(
    client, auth_headers
):
    owner = auth_headers("preview-owner")
    first, _conversation, _dashboard = await create_preview_fixture(client, owner)
    second, second_conversation, _dashboard = await create_preview_fixture(
        client, owner
    )
    for project in (first, second):
        response = await client.patch(
            f"/api/v1/projects/{project['id']}",
            headers=owner,
            json={"is_preview_public": True},
        )
        assert response.status_code == 200

    mismatch = await client.get(
        f"/api/v1/public/conversation/{second_conversation['id']}/dashboard"
        f"?project_id={first['id']}"
    )
    assert mismatch.status_code == 404


@pytest.mark.anyio
async def test_latest_preview_supports_dashboard_without_conversation(
    client, auth_headers
):
    owner = auth_headers("preview-owner")
    project_response = await client.post(
        "/api/v1/projects", headers=owner, json={"name": "Standalone dashboard"}
    )
    project = project_response.json()
    dashboard = await client.post(
        "/api/v1/dashboards",
        headers=owner,
        json={
            "project_id": project["id"],
            "title": "Standalone",
            "content": {"components": []},
        },
    )
    assert dashboard.status_code == 201
    enabled = await client.patch(
        f"/api/v1/projects/{project['id']}",
        headers=owner,
        json={"is_preview_public": True},
    )
    assert enabled.status_code == 200

    latest = await client.get(f"/api/v1/public/project/{project['id']}/dashboard")
    assert latest.status_code == 200
    assert latest.json()["dashboard_id"] == dashboard.json()["id"]


@pytest.mark.anyio
async def test_dashboard_json_is_capped_at_one_mib(client, auth_headers):
    owner = auth_headers("preview-owner")
    project, conversation, dashboard = await create_preview_fixture(client, owner)
    oversized = {"payload": "x" * (1024 * 1024)}

    create = await client.post(
        "/api/v1/dashboards",
        headers=owner,
        json={
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "title": "Too large",
            "content": oversized,
        },
    )
    assert create.status_code == 413
    assert create.json()["error"]["code"] == "DASHBOARD_TOO_LARGE"

    update = await client.patch(
        f"/api/v1/dashboards/{dashboard['id']}",
        headers=owner,
        json={"content": oversized, "expected_version": 1},
    )
    assert update.status_code == 413

    compatibility_update = await client.put(
        f"/api/v1/conversation/{conversation['id']}/dashboard/{dashboard['id']}/data",
        headers=owner,
        json={
            "project_id": project["id"],
            "dashboard_data": oversized,
            "expected_version": 1,
        },
    )
    assert compatibility_update.status_code == 413
