import subprocess
import sys
from argparse import Namespace
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from scripts.run_local_supabase_api import (
    build_database_url,
    build_runtime_environment,
    migrate_database,
    validate_http_origin,
    verify_platform_schema,
)


def test_build_database_url_encodes_special_password_characters():
    raw_password = "brackets[and]at@percent%"

    rendered = build_database_url(
        host="pooler.example.test",
        user="postgres.project-ref",
        password=raw_password,
    )
    parsed = make_url(rendered)

    assert raw_password not in rendered
    assert parsed.password == raw_password
    assert parsed.host == "pooler.example.test"
    assert parsed.port == 5432
    assert parsed.database == "postgres"
    assert parsed.query == {"sslmode": "require"}


def test_build_database_url_rejects_a_pasted_uri_as_host():
    try:
        build_database_url(
            host="postgresql://pooler.example.test/postgres",
            user="postgres.project-ref",
            password="secret",
        )
    except ValueError as error:
        assert str(error) == "Database host must be a hostname without scheme or path"
    else:
        raise AssertionError("Expected an invalid database host to be rejected")


def runtime_args(**overrides):
    values = {
        "auth_mode": "demo",
        "clerk_jwks_url": None,
        "clerk_issuer": None,
        "clerk_authorized_party": None,
        "clerk_audience": None,
    }
    values.update(overrides)
    return Namespace(**values)


def test_demo_runtime_environment_keeps_clerk_disabled():
    environment = build_runtime_environment(runtime_args(), "sqlite:///test.db")

    assert environment["DEMO_AUTH_MODE"] == "true"
    assert "CLERK_JWKS_URL" not in environment


def test_clerk_runtime_environment_aligns_auth_and_cors_origins():
    environment = build_runtime_environment(
        runtime_args(
            auth_mode="clerk",
            clerk_jwks_url="https://example.clerk.accounts.dev/.well-known/jwks.json",
            clerk_issuer="https://example.clerk.accounts.dev/",
            clerk_authorized_party=[
                "http://localhost:3000/",
                "https://dreamify.example",
            ],
        ),
        "postgresql://example",
    )

    assert environment["DEMO_AUTH_MODE"] == "false"
    assert environment["CLERK_ISSUER"] == "https://example.clerk.accounts.dev"
    assert environment["CLERK_AUTHORIZED_PARTIES"] == (
        '["http://localhost:3000", "https://dreamify.example"]'
    )
    assert environment["CORS_ORIGINS"] == environment["CLERK_AUTHORIZED_PARTIES"]


def test_clerk_runtime_environment_requires_public_verification_metadata():
    with pytest.raises(ValueError, match="--clerk-jwks-url"):
        build_runtime_environment(
            runtime_args(auth_mode="clerk"),
            "postgresql://example",
        )


@pytest.mark.parametrize(
    "value",
    ("localhost:3000", "http://localhost:3000/path", "file:///tmp/test"),
)
def test_validate_http_origin_rejects_non_origins(value):
    with pytest.raises(ValueError, match=r"HTTP\(S\) origins"):
        validate_http_origin(value)


def test_migrate_and_verify_platform_schema(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'platform.sqlite'}"

    migrate_database(database_url)
    verify_platform_schema(database_url)


def test_launcher_can_start_from_its_documented_script_path():
    api_root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "scripts/run_local_supabase_api.py", "--help"],
        cwd=api_root,
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "--db-host" in result.stdout
    assert "--auth-mode {demo,clerk}" in result.stdout
