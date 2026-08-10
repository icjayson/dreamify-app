"""Run the local FastAPI server against Supabase without persisting credentials."""

import argparse
import json
import os
import sys
from getpass import getpass
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.pool import NullPool

from alembic import command

API_ROOT = Path(__file__).resolve().parents[1]


def ensure_api_import_path() -> None:
    api_root = str(API_ROOT)
    if api_root not in sys.path:
        sys.path.insert(0, api_root)


def build_database_url(
    *,
    host: str,
    user: str,
    password: str,
    port: int = 5432,
    database: str = "postgres",
) -> str:
    """Build an encoded SQLAlchemy URI from unescaped connection fields."""
    if not host or "://" in host or "/" in host:
        raise ValueError("Database host must be a hostname without scheme or path")
    if not user:
        raise ValueError("Database user is required")
    if not password:
        raise ValueError("Database password is required")

    return URL.create(
        drivername="postgresql+psycopg",
        username=user,
        password=password,
        host=host,
        port=port,
        database=database,
        query={"sslmode": "require"},
    ).render_as_string(hide_password=False)


def verify_connection(database_url: str) -> None:
    engine = create_engine(database_url, poolclass=NullPool)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    finally:
        engine.dispose()


def alembic_config(database_url: str) -> Config:
    ensure_api_import_path()
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    config.attributes["database_url_override"] = database_url
    return config


def migrate_database(database_url: str) -> None:
    command.upgrade(alembic_config(database_url), "head")


def verify_platform_schema(database_url: str) -> None:
    ensure_api_import_path()
    from app.platform.models import Base

    expected_tables = {"alembic_version", *Base.metadata.tables.keys()}
    expected_revision = ScriptDirectory.from_config(
        alembic_config(database_url)
    ).get_current_head()
    engine = create_engine(database_url, poolclass=NullPool)
    try:
        with engine.connect() as connection:
            schema = "public" if connection.dialect.name == "postgresql" else None
            actual_tables = set(inspect(connection).get_table_names(schema=schema))
            missing_tables = sorted(expected_tables - actual_tables)
            if missing_tables:
                raise RuntimeError(
                    "Supabase schema is incomplete; missing tables: "
                    + ", ".join(missing_tables)
                    + ". Re-run this command with --migrate."
                )
            actual_revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one_or_none()
            if actual_revision != expected_revision:
                raise RuntimeError(
                    "Supabase schema revision is "
                    f"{actual_revision or 'unset'}, expected {expected_revision}. "
                    "Re-run this command with --migrate."
                )
            if connection.dialect.name == "postgresql":
                rls_disabled = (
                    connection.execute(
                        text(
                            """
                        SELECT c.relname
                        FROM pg_class AS c
                        JOIN pg_namespace AS n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public'
                          AND c.relkind = 'r'
                          AND c.relname = ANY(:table_names)
                          AND NOT c.relrowsecurity
                        ORDER BY c.relname
                        """
                        ),
                        {"table_names": list(expected_tables)},
                    )
                    .scalars()
                    .all()
                )
                if rls_disabled:
                    raise RuntimeError(
                        "Supabase RLS is disabled for: "
                        + ", ".join(rls_disabled)
                        + ". Re-run this command with --migrate."
                    )
    finally:
        engine.dispose()


def validate_http_origin(value: str) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urlsplit(candidate)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "Clerk authorized parties must be HTTP(S) origins without a path"
        )
    return candidate


def build_runtime_environment(
    args: argparse.Namespace, database_url: str
) -> dict[str, str]:
    environment = {
        "APP_ENV": "development",
        "DATABASE_URL": database_url,
        "DIRECT_DATABASE_URL": database_url,
        "STORAGE_BACKEND": "local",
        "LOCAL_STORAGE_PATH": "/tmp/dreamify-storage",
    }
    if args.auth_mode == "demo":
        environment["DEMO_AUTH_MODE"] = "true"
        return environment

    missing = [
        flag
        for flag, value in (
            ("--clerk-jwks-url", args.clerk_jwks_url),
            ("--clerk-issuer", args.clerk_issuer),
            ("--clerk-authorized-party", args.clerk_authorized_party),
        )
        if not value
    ]
    if missing:
        raise ValueError("Clerk auth mode requires " + ", ".join(missing))

    authorized_parties = [
        validate_http_origin(value) for value in args.clerk_authorized_party
    ]
    environment.update(
        {
            "DEMO_AUTH_MODE": "false",
            "CLERK_JWKS_URL": args.clerk_jwks_url.strip(),
            "CLERK_ISSUER": args.clerk_issuer.strip().rstrip("/"),
            "CLERK_AUTHORIZED_PARTIES": json.dumps(authorized_parties),
            "CORS_ORIGINS": json.dumps(authorized_parties),
        }
    )
    if args.clerk_audience:
        environment["CLERK_AUDIENCE"] = args.clerk_audience.strip()
    return environment


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run local FastAPI against a Supabase session-pooler connection",
    )
    parser.add_argument("--db-host", required=True)
    parser.add_argument("--db-user", required=True)
    parser.add_argument("--db-port", type=int, default=5432)
    parser.add_argument("--db-name", default="postgres")
    parser.add_argument("--api-port", type=int, default=5000)
    parser.add_argument(
        "--migrate",
        action="store_true",
        help="Apply all pending Alembic migrations before starting the API",
    )
    parser.add_argument(
        "--auth-mode",
        choices=("demo", "clerk"),
        default="demo",
        help="Use X-Demo-User locally or verify real Clerk bearer tokens",
    )
    parser.add_argument("--clerk-jwks-url")
    parser.add_argument("--clerk-issuer")
    parser.add_argument(
        "--clerk-authorized-party",
        action="append",
        help="Allowed frontend origin; repeat for multiple origins",
    )
    parser.add_argument(
        "--clerk-audience",
        help="Optional only when the Clerk session token has a matching aud claim",
    )
    parser.add_argument("--no-reload", action="store_true")
    return parser.parse_args()


def main() -> None:
    ensure_api_import_path()
    args = parse_args()
    password = getpass("Supabase database password: ")
    database_url = build_database_url(
        host=args.db_host,
        user=args.db_user,
        password=password,
        port=args.db_port,
        database=args.db_name,
    )
    del password

    try:
        runtime_environment = build_runtime_environment(args, database_url)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    os.environ.update(runtime_environment)

    verify_connection(database_url)
    print("Supabase connection: OK")
    if args.migrate:
        migrate_database(database_url)
        print("Alembic migration: head")
    verify_platform_schema(database_url)
    print("Supabase schema and RLS: OK")
    print(f"Authentication mode: {args.auth_mode}")
    os.chdir(API_ROOT)
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=args.api_port,
        reload=not args.no_reload,
    )


if __name__ == "__main__":
    main()
