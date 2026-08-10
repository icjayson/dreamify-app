import re
from pathlib import Path
from runpy import run_path

from app.platform.models import Base
from scripts.export_supabase_schema import enable_row_level_security


def test_rls_migration_covers_every_platform_table():
    api_root = Path(__file__).resolve().parents[1]
    migration = run_path(
        str(api_root / "alembic" / "versions" / "0010_enable_supabase_rls.py")
    )

    assert set(migration["PUBLIC_TABLES"]) == {
        "alembic_version",
        *Base.metadata.tables.keys(),
    }


def test_rls_export_adds_only_missing_table_hardening():
    sql = """BEGIN;
CREATE TABLE app_users (
    id VARCHAR(255) NOT NULL
);
CREATE TABLE projects (
    id VARCHAR(36) NOT NULL
);
ALTER TABLE public."app_users" ENABLE ROW LEVEL SECURITY;
COMMIT;
"""

    hardened = enable_row_level_security(sql)

    assert (
        hardened.count('ALTER TABLE public."app_users" ENABLE ROW LEVEL SECURITY;') == 1
    )
    assert (
        hardened.count('ALTER TABLE public."projects" ENABLE ROW LEVEL SECURITY;') == 1
    )


def test_checked_in_supabase_export_is_current():
    api_root = Path(__file__).resolve().parents[1]
    sql = (api_root / "sql" / "supabase_schema.sql").read_text(encoding="utf-8")

    assert "0010_enable_supabase_rls" in sql
    for table_name in ("alembic_version", *Base.metadata.tables.keys()):
        assert f'ALTER TABLE public."{table_name}" ENABLE ROW LEVEL SECURITY;' in sql


def test_existing_supabase_upgrade_is_non_destructive_and_covers_all_tables():
    api_root = Path(__file__).resolve().parents[1]
    migration = run_path(
        str(api_root / "alembic" / "versions" / "0010_enable_supabase_rls.py")
    )
    sql = (
        api_root / "sql" / "supabase_upgrade_0009_to_0010.sql"
    ).read_text(encoding="utf-8")
    table_array = re.search(
        r"expected_tables text\[\] := ARRAY\[(.*?)\];",
        sql,
        re.DOTALL,
    )

    assert table_array is not None
    assert set(re.findall(r"'([a-z][a-z0-9_]*)'", table_array.group(1))) == set(
        migration["PUBLIC_TABLES"]
    )
    assert "DROP " not in sql.upper()
    assert "0009_operator_briefs" in sql
    assert "0010_enable_supabase_rls" in sql
