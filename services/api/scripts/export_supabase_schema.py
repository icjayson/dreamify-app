"""Export the canonical Alembic migration chain as Supabase-compatible SQL."""

import re
from io import StringIO
from pathlib import Path

from alembic import command
from alembic.config import Config


API_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = API_ROOT / "sql" / "supabase_schema.sql"
POSTGRES_DIALECT_URL = "postgresql://schema-export:unused@localhost/dreamify"

HEADER = """-- Dreamify Platform schema for a fresh Supabase PostgreSQL database.
-- Generated from Alembic revisions 0001_initial_platform through 0009_operator_briefs.
-- Canonical source: services/api/alembic/versions/*.py
-- Every created public table has RLS enabled without public policies so Supabase's
-- Data API fails closed; Dreamify accesses these tables through FastAPI only.
--
-- Apply this file only to an empty Supabase database. For an existing deployment,
-- run Alembic with DIRECT_DATABASE_URL instead so only pending revisions execute.

"""


def enable_row_level_security(sql: str) -> str:
    table_names = re.findall(r"^CREATE TABLE ([a-z][a-z0-9_]*) \($", sql, re.MULTILINE)
    if not table_names:
        raise RuntimeError("Alembic export did not create any PostgreSQL tables")

    statements = [
        "-- Supabase Data API hardening: no anon/authenticated policies are created."
    ]
    statements.extend(
        f'ALTER TABLE public."{table_name}" ENABLE ROW LEVEL SECURITY;'
        for table_name in table_names
    )
    commit_marker = "\nCOMMIT;\n"
    if sql.count(commit_marker) != 1:
        raise RuntimeError("Alembic export did not contain exactly one COMMIT marker")
    hardening_sql = "\n".join(statements)
    return sql.replace(commit_marker, f"\n{hardening_sql}\n{commit_marker}")


def main() -> None:
    output = StringIO()
    config = Config(str(API_ROOT / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    config.attributes["database_url_override"] = POSTGRES_DIALECT_URL

    command.upgrade(config, "head", sql=True)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        HEADER + enable_row_level_security(output.getvalue()),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
