import socket

import pytest
from pydantic import ValidationError
from sqlalchemy import func, inspect, select

from app.main import create_app, duplicate_routes, route_methods
from app.platform.access_policy import ROUTE_ACCESS_POLICY, openapi_access_policy
from app.platform.models import BlogPost, WorkflowSlot
from app.platform.seed import seed_database
from app.platform.services import CapabilityService
from app.platform.settings import HOBBY_DEMO_MAXIMA, Settings
from app.platform.storage import LocalObjectStorage


@pytest.mark.anyio
async def test_capabilities_are_explicit_and_disabled_features_are_safe(
    client, auth_headers
):
    response = await client.get("/api/v1/capabilities")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["vary"] == "Authorization, X-Demo-User"
    body = response.json()
    assert body["profile"] == "hobby_demo"
    assert body["billing"] == {"enabled": False, "label": "Free Preview"}
    assert body["model"] == {
        "mode": "demo",
        "active_provider": "demo",
        "providers": ["demo"],
    }
    assert body["connectors"]["file_upload"] == {
        "enabled": True,
        "connected": True,
        "reason": None,
    }
    external = body["connectors"]["ga4"]
    assert external["enabled"] is False
    assert external["connected"] is False
    assert external["reason"]
    assert set(body["connectors"]) >= {
        "file_upload",
        "ga4",
        "google_sheets",
        "stripe",
        "shopify",
        "postgres",
    }
    assert body["features"]["projects"]["enabled"] is True
    assert body["features"]["billing"]["enabled"] is False
    assert body["features"]["connectors"]["enabled"] is False
    assert body["features"]["scheduling"]["enabled"] is False
    assert body["features"]["direct_upload"]["enabled"] is False
    assert body["checksum_verification"] is True
    assert body["limits"] == {
        "max_file_bytes": 1024,
        "max_files_per_run": 3,
        "max_total_run_bytes": 25 * 1024 * 1024,
        "max_rows_per_file": 100_000,
        "max_columns_per_file": 200,
        "max_user_storage_bytes": 4096,
        "max_global_storage_bytes": 8192,
        "workflow_slots": 2,
        "active_data_runs_per_user": 1,
        "data_runs_per_user_per_day": 5,
        "deployment_runs_per_day": 10,
        "text_runs_per_user_per_day": 20,
        "max_dashboard_bytes": 1024 * 1024,
        "max_database_bytes": 350 * 1024 * 1024,
        "workflow_event_max_bytes": 32 * 1024,
        "max_events_per_run": 100,
        "max_upload_bytes": 1024,
        "max_workflow_assets": 3,
    }

    disabled = await client.post(
        "/api/v1/connectors/stripe/connect", headers=auth_headers(), json={}
    )
    assert disabled.status_code == 503
    assert disabled.json()["error"]["code"] == "FEATURE_DISABLED"

    scheduling = await client.post("/api/v1/schedules", headers=auth_headers(), json={})
    assert scheduling.status_code == 503
    assert scheduling.json()["error"] == {
        "code": "FEATURE_DISABLED",
        "message": "scheduling is disabled in this deployment",
        "details": {"feature": "scheduling"},
    }


@pytest.mark.anyio
@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize(
    "path,feature",
    [
        ("/api/v1/connectors/ga4/connect", "connector:ga4"),
        ("/api/v1/integration/google/authorize", "external connectors"),
        ("/api/v1/billing/checkout", "billing"),
    ],
)
async def test_disabled_connector_and_billing_routes_never_open_network(
    client, auth_headers, monkeypatch, method, path, feature
):
    network_attempts = 0

    def reject_network(*_args, **_kwargs):
        nonlocal network_attempts
        network_attempts += 1
        raise AssertionError("disabled feature attempted an outbound connection")

    monkeypatch.setattr(socket, "create_connection", reject_network)
    response = await client.request(method, path, headers=auth_headers(), json={})

    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "FEATURE_DISABLED",
        "message": f"{feature} is disabled in this deployment",
        "details": {"feature": feature},
    }
    assert network_attempts == 0


def test_hobby_capability_defaults_match_published_contract(tmp_path):
    settings = Settings(
        app_env="test",
        database_url="sqlite:///:memory:",
        cors_origins=["https://app.example.test"],
    )
    limits = CapabilityService(
        settings, LocalObjectStorage(tmp_path / "objects")
    ).read()["limits"]
    assert {
        "max_file_bytes": limits["max_file_bytes"],
        "max_files_per_run": limits["max_files_per_run"],
        "max_total_run_bytes": limits["max_total_run_bytes"],
        "max_rows_per_file": limits["max_rows_per_file"],
        "max_columns_per_file": limits["max_columns_per_file"],
        "max_user_storage_bytes": limits["max_user_storage_bytes"],
        "max_global_storage_bytes": limits["max_global_storage_bytes"],
        "workflow_slots": limits["workflow_slots"],
        "active_data_runs_per_user": limits["active_data_runs_per_user"],
        "data_runs_per_user_per_day": limits["data_runs_per_user_per_day"],
        "deployment_runs_per_day": limits["deployment_runs_per_day"],
        "text_runs_per_user_per_day": limits["text_runs_per_user_per_day"],
        "max_dashboard_bytes": limits["max_dashboard_bytes"],
        "max_database_bytes": limits["max_database_bytes"],
        "workflow_event_max_bytes": limits["workflow_event_max_bytes"],
    } == {
        "max_file_bytes": 10 * 1024 * 1024,
        "max_files_per_run": 3,
        "max_total_run_bytes": 25 * 1024 * 1024,
        "max_rows_per_file": 100_000,
        "max_columns_per_file": 200,
        "max_user_storage_bytes": 100 * 1024 * 1024,
        "max_global_storage_bytes": 750 * 1024 * 1024,
        "workflow_slots": 2,
        "active_data_runs_per_user": 1,
        "data_runs_per_user_per_day": 5,
        "deployment_runs_per_day": 10,
        "text_runs_per_user_per_day": 20,
        "max_dashboard_bytes": 1024 * 1024,
        "max_database_bytes": 350 * 1024 * 1024,
        "workflow_event_max_bytes": 32 * 1024,
    }


@pytest.mark.parametrize("field,maximum", sorted(HOBBY_DEMO_MAXIMA.items()))
def test_hobby_limits_cannot_be_relaxed(field, maximum):
    with pytest.raises(ValidationError, match="locked hobby_demo ceiling"):
        Settings(**{field: maximum + 1})


def test_hobby_profile_requires_exactly_two_workflow_slots():
    for count in (1, 3):
        with pytest.raises(ValidationError, match="exactly two workflow slots"):
            Settings(workflow_slot_count=count)


@pytest.mark.anyio
async def test_strict_cors_preflight(client):
    allowed = await client.options(
        "/api/v1/projects",
        headers={
            "Origin": "https://app.example.test",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert allowed.headers["access-control-allow-origin"] == "https://app.example.test"

    denied = await client.options(
        "/api/v1/projects",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in denied.headers


def test_production_rejects_demo_auth_and_wildcard_cors():
    with pytest.raises(ValidationError, match="Wildcard CORS"):
        Settings(app_env="production", cors_origins=["*"], demo_auth_mode=True)

    with pytest.raises(ValidationError, match="DEMO_AUTH_MODE"):
        Settings(
            app_env="production",
            cors_origins=["https://app.example.test"],
            demo_auth_mode=True,
        )


def test_vercel_runtime_cannot_boot_with_local_defaults():
    with pytest.raises(ValidationError, match="APP_ENV=preview or production"):
        Settings(vercel=True)

    with pytest.raises(ValidationError, match="match the injected VERCEL_ENV"):
        Settings(vercel=True, vercel_env="production", app_env="preview")


def production_settings(**overrides):
    values = {
        "app_env": "production",
        "database_url": "postgresql://app:secret@db.acme.internal/dreamify",
        "cors_origins": ["https://dreamify.acme.dev"],
        "clerk_jwks_url": "https://clerk.acme.dev/.well-known/jwks.json",
        "clerk_issuer": "https://clerk.acme.dev",
        "clerk_authorized_parties": ["https://dreamify.acme.dev"],
        "storage_backend": "vercel_blob",
        "vercel_blob_token": "vercel_blob_rw_realistic_nonpublic_value",
        "blob_upload_gateway_url": "https://dreamify.acme.dev/api/blob/upload",
        "blob_signing_gateway_url": "https://dreamify.acme.dev/api/blob/sign",
        "blob_gateway_shared_secret": "a" * 48,
        "internal_service_shared_secret": "b" * 48,
        "workflow_dispatch_url": "https://dreamify.acme.dev/api/workflow/dispatch",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_accepts_independently_generated_runtime_values():
    settings = production_settings()
    assert settings.app_env == "production"


def test_settings_accepts_vercel_standard_blob_token_name():
    settings = Settings(BLOB_READ_WRITE_TOKEN="vercel_blob_rw_realistic_nonpublic_value")
    assert settings.vercel_blob_token == "vercel_blob_rw_realistic_nonpublic_value"


@pytest.mark.parametrize(
    "field,value",
    [
        ("vercel_blob_token", "replace-with-vercel-blob-read-write-token"),
        ("blob_gateway_shared_secret", "replace-with-at-least-32-random-characters"),
        ("internal_service_shared_secret", "change-me-please-change-me-please-change"),
        ("clerk_issuer", "https://your-clerk-domain.example"),
    ],
)
def test_production_rejects_public_placeholder_credentials(field, value):
    with pytest.raises(ValidationError, match="public placeholder"):
        production_settings(**{field: value})


def test_production_requires_independent_service_secrets():
    shared = "independent-looking-but-reused-secret-value-123"
    with pytest.raises(ValidationError, match="independently generated"):
        production_settings(
            blob_gateway_shared_secret=shared,
            internal_service_shared_secret=shared,
        )


def test_routes_are_unique(runtime_settings):
    app = create_app(runtime_settings)
    methods = set(route_methods(app.routes))
    assert ("POST", "/api/v1/uploads/intents") in methods
    assert ("POST", "/api/v1/internal/assets/resolve") in methods
    assert len(methods) >= 40
    assert duplicate_routes(app) == []
    assert methods == set(ROUTE_ACCESS_POLICY)

    schema = app.openapi()
    documented_policy = openapi_access_policy()
    for path, path_item in schema["paths"].items():
        for method, operation in path_item.items():
            if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                assert (
                    operation["x-dreamify-access"]
                    == documented_policy[(method.upper(), path)]
                )


@pytest.mark.anyio
async def test_access_policy_categories_are_enforced(client, auth_headers):
    assert (await client.get("/api/v1/capabilities")).status_code == 200
    assert (await client.get("/api/v1/projects")).status_code == 401
    blob = await client.post(
        "/api/v1/uploads/blob-completed",
        json={
            "intent_id": "intent-missing",
            "client_request_id": "request-missing",
            "pathname": "uploads/missing.csv",
            "content_type": "text/csv",
            "size_bytes": 1,
        },
    )
    assert blob.status_code == 401
    internal = await client.get("/api/v1/internal/workflow/runs/run-missing")
    assert internal.status_code == 401
    disabled = await client.post(
        "/api/v1/connectors/stripe/connect", headers=auth_headers(), json={}
    )
    assert disabled.status_code == 503


@pytest.mark.anyio
async def test_schema_and_seed_are_idempotent(runtime_settings):
    app = create_app(runtime_settings)
    async with app.router.lifespan_context(app):
        database = app.state.database
        expected = {
            "app_users",
            "projects",
            "stored_objects",
            "upload_reservations",
            "assets",
            "conversations",
            "dashboards",
            "dashboard_versions",
            "workflow_runs",
            "workflow_run_assets",
            "workflow_step_journals",
            "workflow_artifacts",
            "workflow_events",
            "workflow_provider_calls",
            "workflow_slots",
            "provider_connections",
            "daily_run_usage",
            "project_preview_grants",
            "project_members",
            "notifications",
            "feedback_submissions",
            "overall_feedback_submissions",
            "blog_posts",
            "operator_briefs",
        }
        assert expected == set(inspect(database.engine).get_table_names())
        with database.session() as session:
            seed_database(session, app.state.storage, 2)
            seed_database(session, app.state.storage, 2)
            assert session.scalar(select(func.count()).select_from(WorkflowSlot)) == 2
            assert session.scalar(select(func.count()).select_from(BlogPost)) == 8
