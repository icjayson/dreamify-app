from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.platform.errors import ApiError
from app.platform.models import (
    AppUser,
    Asset,
    Conversation,
    Dashboard,
    DashboardVersion,
    Project,
    ProjectMember,
    StoredObject,
)
from app.platform.seed import (
    DEMO_ASSET_ID,
    DEMO_CONVERSATION_ID,
    DEMO_CSV_BYTES,
    DEMO_CSV_CONTENT_TYPE,
    DEMO_CSV_PATHNAME,
    DEMO_CSV_SHA256,
    DEMO_DASHBOARD_CONTENT,
    DEMO_DASHBOARD_ID,
    DEMO_DASHBOARD_VERSION_ID,
    DEMO_PROJECT_ID,
    DEMO_PROJECT_MEMBER_ID,
    DEMO_STORED_OBJECT_ID,
    DEMO_USER_ID,
    seed_database,
)

SEEDED_RECORDS = (
    (AppUser, DEMO_USER_ID),
    (Project, DEMO_PROJECT_ID),
    (ProjectMember, DEMO_PROJECT_MEMBER_ID),
    (StoredObject, DEMO_STORED_OBJECT_ID),
    (Asset, DEMO_ASSET_ID),
    (Conversation, DEMO_CONVERSATION_ID),
    (Dashboard, DEMO_DASHBOARD_ID),
    (DashboardVersion, DEMO_DASHBOARD_VERSION_ID),
)


def test_demo_seed_twice_creates_one_linked_workspace(app):
    app.state.database.create_schema()
    with app.state.database.session() as session:
        seed_database(session, app.state.storage)
        seed_database(session, app.state.storage)

        for model, identifier in SEEDED_RECORDS:
            count = session.scalar(
                select(func.count()).select_from(model).where(model.id == identifier)
            )
            assert count == 1

        project = session.get(Project, DEMO_PROJECT_ID)
        member = session.get(ProjectMember, DEMO_PROJECT_MEMBER_ID)
        asset = session.get(Asset, DEMO_ASSET_ID)
        conversation = session.get(Conversation, DEMO_CONVERSATION_ID)
        dashboard = session.get(Dashboard, DEMO_DASHBOARD_ID)
        version = session.get(DashboardVersion, DEMO_DASHBOARD_VERSION_ID)
        assert project.owner_id == DEMO_USER_ID
        assert (member.project_id, member.user_id, member.role, member.status) == (
            DEMO_PROJECT_ID,
            DEMO_USER_ID,
            "owner",
            "active",
        )
        assert (asset.project_id, asset.stored_object_id) == (
            DEMO_PROJECT_ID,
            DEMO_STORED_OBJECT_ID,
        )
        assert conversation.project_id == DEMO_PROJECT_ID
        assert dashboard.conversation_id == DEMO_CONVERSATION_ID
        assert dashboard.content == DEMO_DASHBOARD_CONTENT
        assert version.dashboard_id == DEMO_DASHBOARD_ID
        assert version.content == DEMO_DASHBOARD_CONTENT


def test_demo_csv_is_versioned_and_persisted_through_configured_storage(app):
    shared_fixture = (
        Path(__file__).resolve().parents[3]
        / "packages"
        / "demo-fixtures"
        / "data"
        / "sales.csv"
    )
    assert DEMO_CSV_BYTES == shared_fixture.read_bytes()

    app.state.database.create_schema()
    with app.state.database.session() as session:
        seed_database(session, app.state.storage)
        stored_object = session.get(StoredObject, DEMO_STORED_OBJECT_ID)
        assert stored_object.backend == app.state.storage.backend
        assert stored_object.pathname == DEMO_CSV_PATHNAME
        assert stored_object.content_type == DEMO_CSV_CONTENT_TYPE
        assert stored_object.size_bytes == len(DEMO_CSV_BYTES)
        assert stored_object.checksum_sha256 == DEMO_CSV_SHA256

    assert app.state.storage.get_bytes(DEMO_CSV_PATHNAME) == DEMO_CSV_BYTES
    metadata = app.state.storage.head(DEMO_CSV_PATHNAME, verify_checksum=True)
    assert metadata.checksum_sha256 == DEMO_CSV_SHA256
    with pytest.raises(ApiError) as conflict:
        app.state.storage.put_bytes(
            DEMO_CSV_PATHNAME,
            b"replacement",
            DEMO_CSV_CONTENT_TYPE,
            overwrite=False,
        )
    assert conflict.value.code == "OBJECT_EXISTS"
    assert app.state.storage.get_bytes(DEMO_CSV_PATHNAME) == DEMO_CSV_BYTES


def test_demo_seed_rejects_corrupt_immutable_storage_object(app):
    app.state.database.create_schema()
    with app.state.database.session() as session:
        seed_database(session, app.state.storage)
    app.state.storage.put_bytes(
        DEMO_CSV_PATHNAME, b"corrupt", "application/octet-stream"
    )

    with pytest.raises(RuntimeError, match="immutable checksum address"):
        with app.state.database.session() as session:
            seed_database(session, app.state.storage)

    assert app.state.storage.get_bytes(DEMO_CSV_PATHNAME) == b"corrupt"


@pytest.mark.anyio
async def test_demo_auth_identity_can_read_seeded_workspace(client, auth_headers):
    # This ID is the web app's auth-free fallback; keeping it canonical makes the
    # fresh local demo project visible without a separate migration or user copy.
    assert DEMO_USER_ID == "demo_user"
    headers = auth_headers(DEMO_USER_ID)

    projects = await client.get("/api/v1/projects", headers=headers)
    assets = await client.get(
        f"/api/v1/projects/{DEMO_PROJECT_ID}/assets", headers=headers
    )
    conversations = await client.get("/api/v1/conversations", headers=headers)
    dashboards = await client.get(
        "/api/v1/dashboards",
        params={"project_id": DEMO_PROJECT_ID},
        headers=headers,
    )
    versions = await client.get(
        f"/api/v1/dashboards/{DEMO_DASHBOARD_ID}/versions", headers=headers
    )

    assert projects.status_code == 200
    assert [item["id"] for item in projects.json()] == [DEMO_PROJECT_ID]
    assert assets.status_code == 200
    assert [item["id"] for item in assets.json()] == [DEMO_ASSET_ID]
    assert conversations.status_code == 200
    assert [item["id"] for item in conversations.json()] == [DEMO_CONVERSATION_ID]
    assert dashboards.status_code == 200
    assert [item["id"] for item in dashboards.json()] == [DEMO_DASHBOARD_ID]
    assert versions.status_code == 200
    assert [item["id"] for item in versions.json()] == [DEMO_DASHBOARD_VERSION_ID]

    outsider = await client.get(
        f"/api/v1/projects/{DEMO_PROJECT_ID}", headers=auth_headers("other-user")
    )
    assert outsider.status_code == 404
