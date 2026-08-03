import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select

from alembic import command
from app.platform.models import (
    Asset,
    BlogPost,
    Conversation,
    Dashboard,
    FeedbackSubmission,
    Notification,
    OverallFeedbackSubmission,
    StoredObject,
    WorkflowRun,
)
from app.platform.repositories import ProjectRepository, UserRepository
from app.platform.seed import BLOG_DEMO_NOTICE, BLOG_SEED_PATH, seed_database
from app.platform.settings import get_settings


def _overall_payload(**overrides):
    payload = {
        "full_name": "Demo User",
        "email": "demo@example.test",
        "overall_rating": 5,
        "visual_appeal_rating": 4,
        "metrics_insights_rating": 3,
        "layout_editing_rating": 2,
        "share_link_rating": 1,
        "requested_connectors": "Google Sheets",
        "dashboard_improvements": "More filters",
        "export_improvements": "CSV export",
        "website": "",
    }
    payload.update(overrides)
    return payload


def _blog_payload(**overrides):
    payload = {
        "title": "A deterministic demo post",
        "description": "A bounded description",
        "content_html": "<p>Demo content.</p>",
        "content_json": None,
        "cover_image_url": None,
        "cover_image_alt": None,
        "author": "Dreamify Team",
        "persona": "Demo",
        "tags": ["demo"],
        "target_keyword": None,
        "status": "draft",
    }
    payload.update(overrides)
    return payload


@pytest.mark.anyio
async def test_notifications_are_tenant_scoped_and_mark_read_is_bounded(
    client, app, auth_headers
):
    now = datetime.now(timezone.utc)
    with app.state.database.session() as session:
        users = UserRepository(session)
        users.ensure("tenant-a")
        users.ensure("tenant-b")
        own_ids = []
        for index in range(2):
            notification = Notification(
                owner_id="tenant-a",
                type="sync_success",
                title=f"Own {index}",
                body="Completed",
                created_at=now - timedelta(seconds=index),
            )
            session.add(notification)
            session.flush()
            own_ids.append(notification.id)
        other = Notification(
            owner_id="tenant-b",
            type="sync_failed",
            title="Other tenant",
            body="Failed",
        )
        session.add(other)
        session.flush()
        other_id = other.id

    listed = await client.get(
        "/api/v1/notifications?limit=1", headers=auth_headers("tenant-a")
    )
    assert listed.status_code == 200
    assert listed.json()["unread_count"] == 2
    assert [item["title"] for item in listed.json()["notifications"]] == ["Own 0"]

    marked = await client.post(
        "/api/v1/notifications/mark-read",
        headers=auth_headers("tenant-a"),
        json={"notification_ids": [own_ids[0], other_id]},
    )
    assert marked.status_code == 200
    assert marked.json() == {"marked_read": 1}
    unread = await client.get(
        "/api/v1/notifications?unread_only=true", headers=auth_headers("tenant-a")
    )
    assert [item["notification_id"] for item in unread.json()["notifications"]] == [
        own_ids[1]
    ]

    all_marked = await client.post(
        "/api/v1/notifications/mark-read",
        headers=auth_headers("tenant-a"),
        json={"notification_ids": None},
    )
    assert all_marked.json() == {"marked_read": 1}
    too_many = await client.post(
        "/api/v1/notifications/mark-read",
        headers=auth_headers("tenant-a"),
        json={"notification_ids": [f"id-{index}" for index in range(101)]},
    )
    assert too_many.status_code == 422


@pytest.mark.anyio
async def test_public_feedback_validates_boundaries_honeypot_and_daily_quota(
    client, app, runtime_settings, auth_headers
):
    accepted = await client.post(
        "/api/v1/feedback",
        json={"category": " product ", "message": "x" * 5000},
    )
    assert accepted.status_code == 200
    assert accepted.json() == {"success": True}
    with app.state.database.session() as session:
        stored = session.scalar(select(FeedbackSubmission))
        assert stored is not None
        assert stored.owner_id is None
        assert stored.category == "product"

    too_large = await client.post(
        "/api/v1/feedback",
        json={"category": "product", "message": "x" * 5001},
    )
    assert too_large.status_code == 422
    assert (
        await client.post(
            "/api/v1/feedback", json={"category": " ", "message": "useful"}
        )
    ).status_code == 422
    invalid_overall = await client.post(
        "/api/v1/feedback/overall",
        json=_overall_payload(email="invalid", overall_rating=6),
    )
    assert invalid_overall.status_code == 422

    honeypot = await client.post(
        "/api/v1/feedback/overall",
        json=_overall_payload(website="bot.example"),
    )
    assert honeypot.status_code == 200
    with app.state.database.session() as session:
        assert (
            session.scalar(select(func.count()).select_from(OverallFeedbackSubmission))
            == 0
        )

    authenticated = await client.post(
        "/api/v1/feedback/overall",
        headers=auth_headers("tenant-a"),
        json=_overall_payload(),
    )
    assert authenticated.status_code == 200
    with app.state.database.session() as session:
        overall = session.scalar(select(OverallFeedbackSubmission))
        assert overall is not None
        assert overall.owner_id == "tenant-a"
        assert overall.email == "demo@example.test"

    runtime_settings.feedback_submissions_per_day = 2
    limited = await client.post(
        "/api/v1/feedback",
        json={"category": "product", "message": "one more"},
    )
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "FEEDBACK_RATE_LIMITED"


@pytest.mark.anyio
async def test_seeded_public_blog_and_owner_cms_contracts(
    client, app, runtime_settings, auth_headers
):
    public = await client.get("/api/v1/blog/posts")
    assert public.status_code == 200
    assert len(public.json()) == 8
    assert public.json()[0]["slug"] == "marketing-dashboard-in-5-minutes"
    source = json.loads(BLOG_SEED_PATH.read_text(encoding="utf-8"))[0]
    seeded = await client.get(f"/api/v1/blog/posts/{source['slug']}")
    assert seeded.status_code == 200
    assert seeded.json()["content_html"] == BLOG_DEMO_NOTICE + source["content_html"]
    assert seeded.json()["tags"] == ["historical"]

    missing = await client.get("/api/v1/blog/posts/not-found")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"

    non_owner = await client.get(
        "/api/v1/admin/blog/posts", headers=auth_headers("tenant-a")
    )
    assert non_owner.status_code == 403
    assert non_owner.json()["error"]["code"] == "OWNER_ADMIN_REQUIRED"
    assert (
        await client.get("/api/v1/admin/blog/posts", headers=auth_headers("owner-id"))
    ).status_code == 200

    created = await client.post(
        "/api/v1/admin/blog/posts",
        headers=auth_headers("owner-id"),
        json=_blog_payload(slug="owner-draft"),
    )
    assert created.status_code == 201
    post_id = created.json()["post_id"]
    assert (await client.get("/api/v1/blog/posts/owner-draft")).status_code == 404
    draft_feature = await client.patch(
        f"/api/v1/admin/blog/posts/{post_id}/feature",
        headers=auth_headers("owner-id"),
    )
    assert draft_feature.status_code == 409
    assert draft_feature.json()["error"]["code"] == "BLOG_POST_NOT_PUBLISHED"

    published = await client.patch(
        f"/api/v1/admin/blog/posts/{post_id}",
        headers=auth_headers("owner-id"),
        json=_blog_payload(slug="owner-draft", status="published"),
    )
    assert published.status_code == 200
    featured = await client.patch(
        f"/api/v1/admin/blog/posts/{post_id}/feature",
        headers=auth_headers("owner-id"),
    )
    assert featured.status_code == 200
    assert featured.json()["featured"] is True

    conflict = await client.post(
        "/api/v1/admin/blog/posts",
        headers=auth_headers("owner-id"),
        json=_blog_payload(slug="owner-draft"),
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "BLOG_SLUG_CONFLICT"

    runtime_settings.max_blog_content_bytes = 32
    boundary = await client.post(
        "/api/v1/admin/blog/posts",
        headers=auth_headers("owner-id"),
        json=_blog_payload(slug="size-boundary", content_html="x" * 28),
    )
    assert boundary.status_code == 201
    overflow = await client.post(
        "/api/v1/admin/blog/posts",
        headers=auth_headers("owner-id"),
        json=_blog_payload(slug="size-overflow", content_html="x" * 29),
    )
    assert overflow.status_code == 413
    assert overflow.json()["error"]["code"] == "BLOG_CONTENT_TOO_LARGE"

    media = await client.post(
        "/api/v1/admin/blog/assets", headers=auth_headers("owner-id")
    )
    assert media.status_code == 503
    assert media.json()["error"] == {
        "code": "FEATURE_DISABLED",
        "message": "public blog media upload is disabled in this deployment",
        "details": {"feature": "public blog media upload"},
    }
    deleted = await client.delete(
        f"/api/v1/admin/blog/posts/{post_id}", headers=auth_headers("owner-id")
    )
    assert deleted.status_code == 204


@pytest.mark.anyio
async def test_owner_admin_allowlist_matches_id_or_email_and_fails_closed(
    client, app, runtime_settings, auth_headers
):
    assert (await client.get("/api/v1/admin/metrics")).status_code == 401
    denied = await client.get(
        "/api/v1/admin/metrics", headers=auth_headers("normal-user")
    )
    assert denied.status_code == 403
    with app.state.database.session() as session:
        UserRepository(session).ensure("email-owner", email="owner@example.test")
    assert (
        await client.get("/api/v1/admin/metrics", headers=auth_headers("email-owner"))
    ).status_code == 200
    runtime_settings.owner_admin_allowlist = []
    closed = await client.get("/api/v1/admin/metrics", headers=auth_headers("owner-id"))
    assert closed.status_code == 403
    assert closed.json()["error"]["code"] == "OWNER_ADMIN_REQUIRED"


def _seed_admin_graph(app):
    storage = app.state.storage
    metadata = storage.put_bytes(
        "uploads/tenant-a/admin.csv", b"name,value\nalpha,1\n", "text/csv"
    )
    with app.state.database.session() as session:
        users = UserRepository(session)
        users.ensure("tenant-a", email="tenant-a@example.test", display_name="Tenant A")
        users.ensure("tenant-b")
        project = ProjectRepository(session).create("tenant-a", "Admin project", None)
        other_project = ProjectRepository(session).create(
            "tenant-b", "Other project", None
        )
        conversation = Conversation(
            owner_id="tenant-a", project_id=project.id, title="Admin conversation"
        )
        dashboard = Dashboard(
            owner_id="tenant-a",
            project_id=project.id,
            conversation_id=None,
            title="Admin dashboard",
            content={"title": "Demo"},
        )
        session.add_all([conversation, dashboard])
        session.flush()
        dashboard.conversation_id = conversation.id
        run = WorkflowRun(
            owner_id="tenant-a",
            project_id=project.id,
            conversation_id=conversation.id,
            workflow_name="analyze_data",
            run_kind="data",
            status="completed",
            input={
                "chat_request": {
                    "user_node_contents": [
                        {"type": "text", "data": {"text": "Analyze"}}
                    ]
                }
            },
            output={"content": "Done"},
            completed_at=datetime.now(timezone.utc),
        )
        stored = StoredObject(
            owner_id="tenant-a",
            backend="local",
            pathname=metadata.pathname,
            content_type=metadata.content_type,
            size_bytes=metadata.size_bytes,
            checksum_sha256=metadata.checksum_sha256,
            etag=metadata.etag,
        )
        session.add_all([run, stored])
        session.flush()
        asset = Asset(
            owner_id="tenant-a",
            project_id=project.id,
            stored_object_id=stored.id,
            filename="admin.csv",
            asset_type="dataset",
            content_type="text/csv",
            size_bytes=metadata.size_bytes,
            status="ready",
        )
        session.add(asset)
        session.flush()
        return project.id, other_project.id, conversation.id, dashboard.id, asset.id


@pytest.mark.anyio
async def test_owner_admin_read_endpoints_preserve_object_boundaries(
    client, app, runtime_settings, auth_headers
):
    project_id, other_project_id, conversation_id, dashboard_id, asset_id = (
        _seed_admin_graph(app)
    )
    headers = auth_headers("owner-id")
    metrics = await client.get("/api/v1/admin/metrics", headers=headers)
    assert metrics.status_code == 200
    assert metrics.json()["total_messages"] == 2
    assert metrics.json()["success_rate"] == 100.0
    series = await client.get(
        "/api/v1/admin/metrics/timeseries?days=1", headers=headers
    )
    assert series.status_code == 200
    assert series.json()[0]["messages"] == 2

    users = await client.get(
        "/api/v1/admin/users?page=1&page_size=1&sort_by=uid&sort_dir=asc",
        headers=headers,
    )
    assert users.status_code == 200
    assert users.json()["total"] >= 3
    detail = await client.get("/api/v1/admin/users/tenant-a", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["user"]["dashboard_count"] == 1
    assert detail.json()["connectors"] == []
    assert "encrypted_api_key" not in json.dumps(detail.json())
    missing_user = await client.get("/api/v1/admin/users/missing", headers=headers)
    assert missing_user.status_code == 404

    conversations = await client.get(
        f"/api/v1/admin/conversations?project_id={project_id}", headers=headers
    )
    assert conversations.status_code == 200
    assert (
        conversations.json()["conversations"][0]["conversation_id"] == conversation_id
    )
    conversation = await client.get(
        f"/api/v1/admin/conversations/{conversation_id}?project_id={project_id}",
        headers=headers,
    )
    assert conversation.status_code == 200
    assert conversation.json()["conversation"]["user_id"] == "tenant-a"
    nodes = await client.get(
        f"/api/v1/admin/conversations/{conversation_id}/nodes?project_id={project_id}",
        headers=headers,
    )
    assert [node["role"] for node in nodes.json()["nodes"]] == ["user", "assistant"]

    dashboard = await client.get(
        f"/api/v1/admin/conversations/{conversation_id}/dashboard"
        f"?project_id={project_id}&dashboard_id={dashboard_id}",
        headers=headers,
    )
    assert dashboard.status_code == 200
    assert dashboard.json()["dashboard_data"] == {"title": "Demo"}
    runtime_settings.max_dashboard_bytes = 5
    oversized = await client.get(
        f"/api/v1/admin/conversations/{conversation_id}/dashboard"
        f"?project_id={project_id}&dashboard_id={dashboard_id}",
        headers=headers,
    )
    assert oversized.status_code == 413
    runtime_settings.max_dashboard_bytes = 1024 * 1024

    preview = await client.get(
        f"/api/v1/admin/conversations/{conversation_id}/assets/{asset_id}/preview"
        f"?project_id={project_id}",
        headers=headers,
    )
    assert preview.status_code == 200
    assert preview.json()["rows"] == [["alpha", "1"]]
    wrong_project = await client.get(
        f"/api/v1/admin/conversations/{conversation_id}?project_id={other_project_id}",
        headers=headers,
    )
    assert wrong_project.status_code == 404
    assert wrong_project.json()["error"]["code"] == "NOT_FOUND"


def test_core_support_migration_roundtrip(tmp_path, monkeypatch):
    service_root = Path(__file__).resolve().parents[1]
    database_path = tmp_path / "migration.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("DIRECT_DATABASE_URL", raising=False)
    get_settings.cache_clear()
    config = Config(str(service_root / "alembic.ini"))
    config.set_main_option("script_location", str(service_root / "alembic"))

    command.upgrade(config, "head")
    engine = create_engine(database_url)
    support_tables = {
        "notifications",
        "feedback_submissions",
        "overall_feedback_submissions",
        "blog_posts",
    }
    assert support_tables <= set(inspect(engine).get_table_names())
    engine.dispose()

    command.downgrade(config, "0004_project_previews")
    engine = create_engine(database_url)
    assert support_tables.isdisjoint(inspect(engine).get_table_names())
    engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(database_url)
    assert support_tables <= set(inspect(engine).get_table_names())
    engine.dispose()
    get_settings.cache_clear()


def test_versioned_blog_seed_is_exactly_eight_and_idempotent(app):
    app.state.database.create_schema()
    with app.state.database.session() as session:
        seed_database(session, app.state.storage, 2)
        seed_database(session, app.state.storage, 2)
        assert session.scalar(select(func.count()).select_from(BlogPost)) == 8
        assert len(json.loads(BLOG_SEED_PATH.read_text(encoding="utf-8"))) == 8
