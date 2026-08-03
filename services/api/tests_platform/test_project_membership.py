from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.platform.settings import get_settings


async def register(client, auth_headers, user_id):
    response = await client.get("/api/v1/users/me", headers=auth_headers(user_id))
    assert response.status_code == 200, response.text


async def create_project(client, headers, name="Shared project"):
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def add_member(client, owner, project_id, user_id, role):
    response = await client.post(
        f"/api/v1/projects/{project_id}/members",
        headers=owner,
        json={"user_id": user_id, "role": role},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.anyio
async def test_owner_membership_is_atomic_registered_and_unique(client, auth_headers):
    owner = auth_headers("owner")
    outsider = auth_headers("outsider")
    project = await create_project(client, owner)
    members_url = f"/api/v1/projects/{project['id']}/members"

    members = await client.get(members_url, headers=owner)
    assert members.status_code == 200
    assert [
        (item["user_id"], item["role"], item["status"]) for item in members.json()
    ] == [("owner", "owner", "active")]
    member = await client.get(f"{members_url}/{members.json()[0]['id']}", headers=owner)
    assert member.status_code == 200
    assert member.json()["user_id"] == "owner"
    assert (await client.get(members_url, headers=outsider)).status_code == 404

    duplicate = await client.post(
        members_url,
        headers=owner,
        json={"user_id": "owner", "role": "viewer"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "PROJECT_MEMBER_EXISTS"

    unknown = await client.post(
        members_url,
        headers=owner,
        json={"user_id": "not-registered", "role": "viewer"},
    )
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "PROJECT_MEMBER_USER_NOT_FOUND"


@pytest.mark.anyio
async def test_editor_writes_viewer_reads_and_creator_fields_do_not_gate_access(
    client, auth_headers
):
    owner = auth_headers("owner")
    editor = auth_headers("editor")
    viewer = auth_headers("viewer")
    for user_id in ("editor", "viewer"):
        await register(client, auth_headers, user_id)
    project = await create_project(client, owner)
    project_id = project["id"]
    await add_member(client, owner, project_id, "editor", "editor")
    await add_member(client, owner, project_id, "viewer", "viewer")

    for headers in (editor, viewer):
        assert (
            await client.get(f"/api/v1/projects/{project_id}", headers=headers)
        ).status_code == 200
        assert project_id in {
            item["id"]
            for item in (await client.get("/api/v1/projects", headers=headers)).json()
        }

    editor_manage = await client.patch(
        f"/api/v1/projects/{project_id}",
        headers=editor,
        json={"name": "Not allowed"},
    )
    assert editor_manage.status_code == 403
    assert editor_manage.json()["error"]["code"] == "PROJECT_ROLE_FORBIDDEN"
    assert (
        await client.get(f"/api/v1/projects/{project_id}/members", headers=editor)
    ).status_code == 403

    conversation = await client.post(
        "/api/v1/conversations",
        headers=editor,
        json={"project_id": project_id, "title": "Editor analysis"},
    )
    assert conversation.status_code == 201, conversation.text
    conversation_id = conversation.json()["id"]
    assert (
        await client.get(f"/api/v1/conversations/{conversation_id}", headers=owner)
    ).status_code == 200
    assert (
        await client.get(f"/api/v1/conversations/{conversation_id}", headers=viewer)
    ).status_code == 200
    viewer_edit = await client.patch(
        f"/api/v1/conversations/{conversation_id}",
        headers=viewer,
        json={"title": "No write"},
    )
    assert viewer_edit.status_code == 403

    dashboard = await client.post(
        "/api/v1/dashboards",
        headers=editor,
        json={
            "project_id": project_id,
            "conversation_id": conversation_id,
            "title": "Shared dashboard",
            "content": {"charts": []},
        },
    )
    assert dashboard.status_code == 201, dashboard.text
    dashboard_id = dashboard.json()["id"]
    assert (
        await client.get(f"/api/v1/dashboards/{dashboard_id}", headers=owner)
    ).status_code == 200
    viewer_dashboard_write = await client.patch(
        f"/api/v1/dashboards/{dashboard_id}",
        headers=viewer,
        json={"title": "No write"},
    )
    assert viewer_dashboard_write.status_code == 403

    editor_text_run = await client.post(
        "/api/v1/workflow-runs",
        headers=editor,
        json={
            "project_id": project_id,
            "conversation_id": conversation_id,
            "input": {"prompt": "Summarize this project"},
        },
    )
    assert editor_text_run.status_code == 201, editor_text_run.text
    viewer_run = await client.post(
        "/api/v1/workflow-runs",
        headers=viewer,
        json={"project_id": project_id, "input": {"prompt": "Blocked"}},
    )
    assert viewer_run.status_code == 403
    assert (
        await client.post(
            f"/api/v1/workflow-runs/{editor_text_run.json()['id']}/cancel",
            headers=editor,
            json={"reason": "Continue test"},
        )
    ).status_code == 200

    content = b"region,revenue\nAPAC,42\n"
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=editor,
        json={
            "project_id": project_id,
            "filename": "shared.csv",
            "content_type": "text/csv",
            "size_bytes": len(content),
            "client_request_id": "member-upload-0001",
        },
    )
    assert intent.status_code == 201, intent.text
    intent_id = intent.json()["id"]
    uploaded = await client.put(
        f"/api/v1/uploads/{intent_id}/content",
        headers={**editor, "Content-Type": "text/csv"},
        content=content,
    )
    assert uploaded.status_code == 202, uploaded.text
    asset = await client.post(f"/api/v1/uploads/{intent_id}/finalize", headers=editor)
    assert asset.status_code == 200, asset.text
    asset_id = asset.json()["id"]
    for headers in (owner, editor, viewer):
        assert (
            await client.get(f"/api/v1/assets/{asset_id}", headers=headers)
        ).status_code == 200
    viewer_upload = await client.post(
        "/api/v1/uploads/intents",
        headers=viewer,
        json={
            "project_id": project_id,
            "filename": "blocked.csv",
            "content_type": "text/csv",
            "size_bytes": len(content),
            "client_request_id": "member-upload-0002",
        },
    )
    assert viewer_upload.status_code == 403
    assert (
        await client.delete(f"/api/v1/assets/{asset_id}", headers=viewer)
    ).status_code == 403

    run = await client.post(
        "/api/v1/workflow-runs",
        headers=owner,
        json={
            "project_id": project_id,
            "conversation_id": conversation_id,
            "asset_ids": [asset_id],
            "input": {"prompt": "Revenue?"},
        },
    )
    assert run.status_code == 201, run.text
    run_id = run.json()["id"]
    assert (
        await client.get(f"/api/v1/workflow-runs/{run_id}", headers=editor)
    ).status_code == 200
    assert (
        await client.get(f"/api/v1/workflow-runs/{run_id}", headers=viewer)
    ).status_code == 200
    context = await client.get(
        f"/api/v1/internal/workflow/runs/{run_id}/context",
        headers={"X-Internal-Service-Secret": "internal-secret"},
    )
    assert context.status_code == 200, context.text
    assert context.json()["context"]["assets"][0]["asset_id"] == asset_id
    viewer_cancel = await client.post(
        f"/api/v1/workflow-runs/{run_id}/cancel",
        headers=viewer,
        json={"reason": "Not permitted"},
    )
    assert viewer_cancel.status_code == 403
    assert (
        await client.post(
            f"/api/v1/workflow-runs/{run_id}/cancel",
            headers=editor,
            json={"reason": "Editor cancelled"},
        )
    ).status_code == 200


@pytest.mark.anyio
async def test_last_owner_protection_and_canonical_owner_transfer(client, auth_headers):
    first = auth_headers("owner-one")
    second = auth_headers("owner-two")
    await register(client, auth_headers, "owner-two")
    project = await create_project(client, first)
    project_id = project["id"]
    members_url = f"/api/v1/projects/{project_id}/members"
    initial_member = (await client.get(members_url, headers=first)).json()[0]

    for method, payload in (
        ("patch", {"role": "editor"}),
        ("patch", {"status": "inactive"}),
        ("delete", None),
    ):
        response = await client.request(
            method,
            f"{members_url}/{initial_member['id']}",
            headers=first,
            json=payload,
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "LAST_PROJECT_OWNER"

    second_member = await add_member(client, first, project_id, "owner-two", "owner")
    removed = await client.delete(
        f"{members_url}/{initial_member['id']}", headers=first
    )
    assert removed.status_code == 204
    detail = await client.get(f"/api/v1/projects/{project_id}", headers=second)
    assert detail.status_code == 200
    assert detail.json()["owner_id"] == "owner-two"
    assert (
        await client.get(f"/api/v1/projects/{project_id}", headers=first)
    ).status_code == 404

    last_owner = await client.patch(
        f"{members_url}/{second_member['id']}",
        headers=second,
        json={"role": "viewer"},
    )
    assert last_owner.status_code == 409
    assert last_owner.json()["error"]["code"] == "LAST_PROJECT_OWNER"


@pytest.mark.anyio
async def test_preview_grant_does_not_become_project_membership(client, auth_headers):
    owner = auth_headers("owner")
    grantee = auth_headers("preview-only")
    await register(client, auth_headers, "preview-only")
    project = await create_project(client, owner)
    project_id = project["id"]
    granted = await client.patch(
        f"/api/v1/projects/{project_id}",
        headers=owner,
        json={"allowed": [{"user_id": "preview-only"}]},
    )
    assert granted.status_code == 200, granted.text
    assert (
        await client.get(f"/api/v1/public/project/{project_id}", headers=grantee)
    ).status_code == 200
    assert (
        await client.get(f"/api/v1/projects/{project_id}", headers=grantee)
    ).status_code == 404
    assert (
        await client.post(
            "/api/v1/conversations",
            headers=grantee,
            json={"project_id": project_id, "title": "Blocked"},
        )
    ).status_code == 404


def test_membership_migration_backfills_and_roundtrips(tmp_path, monkeypatch):
    service_root = Path(__file__).resolve().parents[1]
    database_path = tmp_path / "membership-migration.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("DIRECT_DATABASE_URL", raising=False)
    get_settings.cache_clear()
    config = Config(str(service_root / "alembic.ini"))
    config.set_main_option("script_location", str(service_root / "alembic"))

    command.upgrade(config, "0005_core_support")
    engine = create_engine(database_url)
    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO app_users "
                "(id, email, display_name, status, created_at, updated_at) "
                "VALUES (:id, NULL, NULL, 'active', :now, :now)"
            ),
            {"id": "legacy-owner", "now": now},
        )
        connection.execute(
            text(
                "INSERT INTO projects "
                "(id, owner_id, name, description, is_preview_public, "
                "created_at, updated_at) "
                "VALUES (:id, :owner_id, 'Legacy', NULL, 0, :now, :now)"
            ),
            {"id": "legacy-project", "owner_id": "legacy-owner", "now": now},
        )
    engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(database_url)
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT project_id, user_id, role, status FROM project_members")
        ).one()
    assert tuple(row) == (
        "legacy-project",
        "legacy-owner",
        "owner",
        "active",
    )
    engine.dispose()

    command.downgrade(config, "0005_core_support")
    engine = create_engine(database_url)
    assert "project_members" not in inspect(engine).get_table_names()
    engine.dispose()
    command.upgrade(config, "head")
    get_settings.cache_clear()
