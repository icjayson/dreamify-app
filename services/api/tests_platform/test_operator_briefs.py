"""Equivalent legacy behavior and tenant boundaries for Operator Briefs."""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.platform.operator_brief_domain import (
    build_metric_snapshot,
    compose_brief,
    detect_changes,
)
from app.platform.settings import get_settings


# The first nine tests replace the nine cases in tests/test_operator_brief.py.
def test_snapshot_falls_back_to_counts_without_metrics():
    snapshot = build_metric_snapshot(row_count=120, column_count=8)
    assert snapshot == {"__rows__": 120.0, "__cols__": 8.0}


def test_snapshot_falls_back_when_no_storage_metrics_are_available():
    snapshot = build_metric_snapshot({}, row_count=50, column_count=4)
    assert snapshot == {"__rows__": 50.0, "__cols__": 4.0}


def test_detect_changes_ignores_small_and_housekeeping_moves():
    previous = {"revenue": 1000.0, "spend": 100.0, "__rows__": 10.0}
    current = {"revenue": 1080.0, "spend": 100.0, "__rows__": 999.0}
    assert detect_changes(previous, current) == []


def test_detect_changes_ranks_biggest_mover_first():
    previous = {"revenue": 1000.0, "spend": 100.0}
    current = {"revenue": 780.0, "spend": 160.0}
    changes = detect_changes(previous, current)
    assert [item.metric for item in changes] == ["spend", "revenue"]
    assert changes[0].direction == "up"
    assert changes[0].severity == "alert"


def test_detect_changes_handles_new_metric_without_baseline():
    assert detect_changes({}, {"revenue": 500.0}) == []


def test_compose_brief_first_run_is_a_baseline():
    brief = compose_brief("shopify", "My Store", [], is_first_run=True)
    assert "baseline" in brief.headline.lower()
    assert brief.severity == "info"


def test_compose_brief_steady_when_nothing_moved():
    brief = compose_brief("ga4", "Web", [], is_first_run=False)
    assert "steady" in brief.headline.lower()


def test_compose_brief_recommends_reviewing_spend_when_returns_drop():
    previous = {"revenue": 1000.0, "ad_spend": 100.0}
    current = {"revenue": 700.0, "ad_spend": 180.0}
    brief = compose_brief("meta_ads", "Tet Campaign", detect_changes(previous, current))
    assert brief.severity == "alert"
    assert "spend" in brief.recommendation.lower()
    assert brief.as_text().startswith("🔴")
    assert "→" in brief.as_text()


def test_compose_brief_flags_inventory_dropping():
    previous = {"inventory_units": 500.0}
    current = {"inventory_units": 200.0}
    brief = compose_brief("shopify", "Store", detect_changes(previous, current))
    assert "reorder" in brief.recommendation.lower()


async def _register(client, auth_headers, user_id):
    response = await client.get("/api/v1/users/me", headers=auth_headers(user_id))
    assert response.status_code == 200


@pytest.mark.anyio
async def test_operator_briefs_enforce_member_read_and_write_roles(
    client, auth_headers
):
    owner = auth_headers("brief-owner")
    editor = auth_headers("brief-editor")
    viewer = auth_headers("brief-viewer")
    outsider = auth_headers("brief-outsider")
    for user_id in ("brief-editor", "brief-viewer"):
        await _register(client, auth_headers, user_id)

    project = await client.post(
        "/api/v1/projects", headers=owner, json={"name": "Operator demo"}
    )
    assert project.status_code == 201
    project_id = project.json()["id"]
    for user_id, role in (("brief-editor", "editor"), ("brief-viewer", "viewer")):
        member = await client.post(
            f"/api/v1/projects/{project_id}/members",
            headers=owner,
            json={"user_id": user_id, "role": role},
        )
        assert member.status_code == 201

    baseline = await client.post(
        f"/api/v1/projects/{project_id}/operator-briefs",
        headers=editor,
        json={
            "provider": "file",
            "account_name": "Demo Store",
            "metric_snapshot": {"revenue": 1000, "ad_spend": 100},
            "row_count": 20,
            "column_count": 2,
        },
    )
    assert baseline.status_code == 201, baseline.text
    assert "baseline" in baseline.json()["headline"].lower()

    changed = await client.post(
        f"/api/v1/projects/{project_id}/operator-briefs",
        headers=editor,
        json={
            "provider": "file",
            "account_name": "Demo Store",
            "metric_snapshot": {"revenue": 700, "ad_spend": 180},
        },
    )
    assert changed.status_code == 201, changed.text
    brief_id = changed.json()["brief_id"]
    assert changed.json()["severity"] == "alert"

    for headers in (owner, editor, viewer):
        project_list = await client.get(
            f"/api/v1/projects/{project_id}/operator-briefs", headers=headers
        )
        assert project_list.status_code == 200
        assert [item["brief_id"] for item in project_list.json()] == [
            brief_id,
            baseline.json()["brief_id"],
        ]
        detail = await client.get(
            f"/api/v1/operator-briefs/{brief_id}", headers=headers
        )
        assert detail.status_code == 200

    assert (await client.get("/api/v1/operator-briefs", headers=outsider)).json() == []
    assert (
        await client.get(
            f"/api/v1/projects/{project_id}/operator-briefs", headers=outsider
        )
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/operator-briefs/{brief_id}", headers=outsider)
    ).status_code == 404

    viewer_write = await client.post(
        f"/api/v1/projects/{project_id}/operator-briefs",
        headers=viewer,
        json={
            "provider": "file",
            "account_name": "Blocked",
            "metric_snapshot": {"revenue": 1},
        },
    )
    assert viewer_write.status_code == 403
    assert viewer_write.json()["error"]["code"] == "PROJECT_ROLE_FORBIDDEN"
    viewer_outcome = await client.patch(
        f"/api/v1/operator-briefs/{brief_id}/outcome",
        headers=viewer,
        json={"outcome": {"action": "reviewed"}},
    )
    assert viewer_outcome.status_code == 403

    outcome = await client.patch(
        f"/api/v1/operator-briefs/{brief_id}/outcome",
        headers=editor,
        json={"outcome": {"action": "reduced_spend", "result": "recovered"}},
    )
    assert outcome.status_code == 200
    assert outcome.json()["outcome"]["action"] == "reduced_spend"


@pytest.mark.anyio
async def test_operator_brief_rejects_cross_project_source_run(client, auth_headers):
    headers = auth_headers("source-owner")
    first = await client.post(
        "/api/v1/projects", headers=headers, json={"name": "First"}
    )
    second = await client.post(
        "/api/v1/projects", headers=headers, json={"name": "Second"}
    )
    run = await client.post(
        "/api/v1/workflow-runs",
        headers=headers,
        json={
            "project_id": second.json()["id"],
            "input": {"prompt": "Create a source run"},
        },
    )
    assert run.status_code == 201, run.text
    brief = await client.post(
        f"/api/v1/projects/{first.json()['id']}/operator-briefs",
        headers=headers,
        json={
            "provider": "demo",
            "account_name": "Cross project",
            "metric_snapshot": {"revenue": 10},
            "run_id": run.json()["id"],
        },
    )
    assert brief.status_code == 422
    assert brief.json()["error"]["code"] == "OPERATOR_BRIEF_SOURCE_INVALID"


def test_operator_brief_migration_roundtrip(tmp_path, monkeypatch):
    service_root = Path(__file__).resolve().parents[1]
    database_url = f"sqlite:///{tmp_path / 'operator-brief-migration.sqlite'}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("DIRECT_DATABASE_URL", raising=False)
    get_settings.cache_clear()
    config = Config(str(service_root / "alembic.ini"))
    config.set_main_option("script_location", str(service_root / "alembic"))

    command.upgrade(config, "0008_workflow_provider_effects")
    engine = create_engine(database_url)
    assert "operator_briefs" not in inspect(engine).get_table_names()
    engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert "operator_briefs" in inspector.get_table_names()
    assert {
        "project_id",
        "created_by_id",
        "run_id",
        "source_asset_id",
        "changes",
        "metric_snapshot",
        "outcome",
        "expires_at",
    }.issubset({column["name"] for column in inspector.get_columns("operator_briefs")})
    engine.dispose()

    command.downgrade(config, "0008_workflow_provider_effects")
    engine = create_engine(database_url)
    assert "operator_briefs" not in inspect(engine).get_table_names()
    engine.dispose()
    command.upgrade(config, "head")
    get_settings.cache_clear()
