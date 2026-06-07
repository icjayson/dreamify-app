import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import quote, urlencode, urlparse

import httpx
from fastapi import HTTPException

from app.services.warehouse_service import (
    _decrypt_secret,
    _encrypt_secret,
    _quote_identifier,
    _sanitize_filename_part,
)
from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import connected_accounts as connected_accounts_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes
from utils.s3.paths import build_asset_key

logger = logging.getLogger(__name__)


SUPABASE_PROVIDER = "supabase"
SUPABASE_CONNECTION_PREFIX = "supabase#"
SUPABASE_ASSET_TYPE = "integration_supabase"
DEFAULT_SCHEMA_ALLOWLIST = ["public"]
SYSTEM_SCHEMAS = {
    "auth",
    "storage",
    "vault",
    "realtime",
    "extensions",
    "pg_catalog",
    "information_schema",
}
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 50_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connection_provider(connection_id: str) -> str:
    return f"{SUPABASE_CONNECTION_PREFIX}{connection_id}"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _normalize_row_limit(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_ROW_LIMIT
    return max(1, min(parsed, MAX_ROW_LIMIT))


def _normalize_max_export_bytes(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_EXPORT_BYTES
    return max(1, parsed)


def _normalize_schema_allowlist(
    schemas: Optional[Sequence[str]], include_system_schemas: bool = False
) -> List[str]:
    normalized = []
    for schema in schemas or DEFAULT_SCHEMA_ALLOWLIST:
        value = str(schema or "").strip()
        if not value:
            continue
        if value in SYSTEM_SCHEMAS and not include_system_schemas:
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized or list(DEFAULT_SCHEMA_ALLOWLIST)


def _parse_date(value: Optional[str], field_name: str) -> Optional[str]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"{field_name} must be YYYY-MM-DD"
        ) from exc


def _sql_literal(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _schema_fingerprint(snapshot: Dict[str, Any]) -> str:
    payload = json.dumps(snapshot.get("schemas", []), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _csv_stats_from_bytes(data: bytes) -> Tuple[List[str], int]:
    text = data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        return [], 0
    return headers, sum(1 for _ in reader)


def _connection_mode_from_host(host: str, port: int) -> str:
    if port == 6543:
        raise HTTPException(
            status_code=400,
            detail=(
                "Supabase transaction pooler URLs on port 6543 are not supported "
                "for analytics extracts. Use the direct connection or session pooler on port 5432."
            ),
        )
    if host.startswith("db.") and host.endswith(".supabase.co") and port == 5432:
        return "direct"
    if "pooler.supabase.com" in host and port == 5432:
        return "session_pooler"
    raise HTTPException(
        status_code=400,
        detail=(
            "Supabase connection must use db.<project-ref>.supabase.co:5432 "
            "or the Supavisor session pooler on port 5432."
        ),
    )


def _project_ref_from_uri(parsed: Any, fallback: str = "") -> str:
    host = parsed.hostname or ""
    if host.startswith("db.") and host.endswith(".supabase.co"):
        return host.split(".")[1]
    username = parsed.username or ""
    if username.startswith("postgres.") and len(username.split(".", 1)) == 2:
        return username.split(".", 1)[1]
    return str(fallback or "").strip()


def _validate_supabase_connection_uri(
    connection_uri: str, project_ref: str = ""
) -> Dict[str, str]:
    raw = str(connection_uri or "").strip()
    if not raw:
        raise HTTPException(
            status_code=400, detail="Supabase connection_uri is required"
        )
    parsed = urlparse(raw)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise HTTPException(
            status_code=400,
            detail="Supabase connection_uri must use postgres:// or postgresql://",
        )
    if not parsed.hostname:
        raise HTTPException(
            status_code=400, detail="Supabase database host is required"
        )
    if not parsed.username:
        raise HTTPException(
            status_code=400, detail="Supabase database username is required"
        )
    try:
        port = int(parsed.port or 5432)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Invalid Supabase database port"
        ) from exc
    database = parsed.path[1:] if parsed.path.startswith("/") else parsed.path
    if not database:
        raise HTTPException(
            status_code=400, detail="Supabase database name is required"
        )

    mode = _connection_mode_from_host(parsed.hostname, port)
    resolved_ref = _project_ref_from_uri(parsed, project_ref)
    if not resolved_ref:
        raise HTTPException(
            status_code=400,
            detail="Supabase project_ref is required for pooler connection URLs",
        )
    username = parsed.username
    credential_risk = (
        "admin_role" if username in {"postgres", "supabase_admin"} else "read_only"
    )
    return {
        "project_ref": resolved_ref,
        "host": parsed.hostname,
        "port": str(port),
        "database": database,
        "username": username,
        "connection_mode": mode,
        "credential_risk": credential_risk,
        "redacted_uri": (
            raw.replace(parsed.password or "", "***") if parsed.password else raw
        ),
    }


def _build_direct_uri(
    project_ref: str, db_password: str, database: str = "postgres"
) -> str:
    ref = str(project_ref or "").strip()
    password = str(db_password or "")
    if not ref:
        raise HTTPException(status_code=400, detail="Supabase project_ref is required")
    if not password:
        raise HTTPException(
            status_code=400, detail="Supabase database password is required"
        )
    return (
        f"postgresql://postgres:{quote(password, safe='')}"
        f"@db.{ref}.supabase.co:5432/{database}?sslmode=require"
    )


def _find_table(
    snapshot: Dict[str, Any], schema_name: str, table_name: str
) -> Dict[str, Any]:
    for schema in snapshot.get("schemas", []):
        if schema.get("name") != schema_name:
            continue
        for table in schema.get("tables", []):
            if table.get("name") == table_name:
                return table
    raise HTTPException(status_code=400, detail="Unknown Supabase table")


def _select_columns(
    table: Dict[str, Any], columns: Optional[Sequence[str]]
) -> List[str]:
    available = [str(col.get("name")) for col in table.get("columns", [])]
    requested = [str(col).strip() for col in columns or [] if str(col).strip()]
    if not requested:
        return available
    unknown = [col for col in requested if col not in available]
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Unknown column(s): {', '.join(unknown)}"
        )
    return requested


class SupabaseAdapter:
    def _connect(self, connection_uri: str):
        try:
            import psycopg
        except ImportError as exc:
            raise RuntimeError(
                "psycopg is not installed. Add psycopg[binary] to backend dependencies."
            ) from exc
        return psycopg.connect(connection_uri, connect_timeout=10)

    def test_connection(self, connection_uri: str) -> Dict[str, Any]:
        with self._connect(connection_uri) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database(), current_user, version()")
                database, username, version = cur.fetchone()
        return {"database": database, "username": username, "version": version}

    def refresh_schema(
        self,
        connection_uri: str,
        include_schemas: Optional[Sequence[str]] = None,
        include_system_schemas: bool = False,
    ) -> Dict[str, Any]:
        include = _normalize_schema_allowlist(include_schemas, include_system_schemas)
        tables_by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}

        with self._connect(connection_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT table_schema, table_name, table_type
                    FROM information_schema.tables
                    ORDER BY table_schema, table_name
                    """
                )
                for schema_name, table_name, table_type in cur.fetchall():
                    if schema_name not in include:
                        continue
                    tables_by_key[(schema_name, table_name)] = {
                        "schema": schema_name,
                        "name": table_name,
                        "type": str(table_type or "").lower(),
                        "columns": [],
                        "rls_enabled": False,
                        "policy_count": 0,
                        "grant_count": 0,
                        "index_count": 0,
                        "row_estimate": None,
                        "primary_key_columns": [],
                    }

                cur.execute(
                    """
                    SELECT table_schema, table_name, column_name, ordinal_position,
                           data_type, udt_name, is_nullable, numeric_precision,
                           numeric_scale, datetime_precision, character_maximum_length
                    FROM information_schema.columns
                    ORDER BY table_schema, table_name, ordinal_position
                    """
                )
                for row in cur.fetchall():
                    table = tables_by_key.get((row[0], row[1]))
                    if table is None:
                        continue
                    table["columns"].append(
                        {
                            "name": row[2],
                            "ordinal_position": int(row[3] or 0),
                            "data_type": row[4],
                            "native_type": row[5],
                            "nullable": str(row[6]).upper() == "YES",
                            "numeric_precision": row[7],
                            "numeric_scale": row[8],
                            "datetime_precision": row[9],
                            "character_maximum_length": row[10],
                            "possible_pii": self._looks_like_pii(str(row[2])),
                        }
                    )

                self._merge_optional_table_metadata(cur, tables_by_key)

        schemas: Dict[str, Dict[str, Any]] = {}
        for table in tables_by_key.values():
            schema_name = table["schema"]
            schemas.setdefault(schema_name, {"name": schema_name, "tables": []})[
                "tables"
            ].append(table)

        snapshot = {
            "refreshed_at": _now_iso(),
            "schemas": list(schemas.values()),
            "table_count": len(tables_by_key),
            "rls_summary": {
                "tables_with_rls": sum(
                    1 for table in tables_by_key.values() if table.get("rls_enabled")
                ),
                "tables_without_rls": sum(
                    1
                    for table in tables_by_key.values()
                    if table.get("type") in {"base table", "partitioned table"}
                    and not table.get("rls_enabled")
                ),
            },
        }
        snapshot["schema_fingerprint"] = _schema_fingerprint(snapshot)
        return snapshot

    def _merge_optional_table_metadata(
        self, cur: Any, tables_by_key: Dict[Tuple[str, str], Dict[str, Any]]
    ) -> None:
        optional_queries = [
            (
                """
                SELECT n.nspname, c.relname, c.relrowsecurity, c.reltuples::bigint
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p', 'v', 'm')
                """,
                self._merge_rls_rows,
            ),
            (
                """
                SELECT schemaname, tablename, count(*)::int
                FROM pg_policies
                GROUP BY schemaname, tablename
                """,
                self._merge_count_rows("policy_count"),
            ),
            (
                """
                SELECT table_schema, table_name, count(*)::int
                FROM information_schema.role_table_grants
                GROUP BY table_schema, table_name
                """,
                self._merge_count_rows("grant_count"),
            ),
            (
                """
                SELECT schemaname, tablename, count(*)::int
                FROM pg_indexes
                GROUP BY schemaname, tablename
                """,
                self._merge_count_rows("index_count"),
            ),
            (
                """
                SELECT tc.table_schema, tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                 AND tc.table_name = kcu.table_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
                """,
                self._merge_primary_key_rows,
            ),
        ]
        for sql, merger in optional_queries:
            try:
                cur.execute(sql)
                merger(cur.fetchall(), tables_by_key)
            except Exception as exc:
                logger.debug("Skipping Supabase schema metadata query: %s", exc)

    @staticmethod
    def _looks_like_pii(column_name: str) -> bool:
        lowered = column_name.lower()
        return any(
            token in lowered
            for token in (
                "email",
                "phone",
                "address",
                "name",
                "ip",
                "token",
                "password",
                "secret",
            )
        )

    @staticmethod
    def _merge_rls_rows(
        rows: Sequence[Sequence[Any]],
        tables_by_key: Dict[Tuple[str, str], Dict[str, Any]],
    ) -> None:
        for schema_name, table_name, rls_enabled, row_estimate in rows:
            table = tables_by_key.get((schema_name, table_name))
            if table is None:
                continue
            table["rls_enabled"] = bool(rls_enabled)
            table["row_estimate"] = int(row_estimate or 0)

    @staticmethod
    def _merge_count_rows(field_name: str):
        def merge(
            rows: Sequence[Sequence[Any]],
            tables_by_key: Dict[Tuple[str, str], Dict[str, Any]],
        ) -> None:
            for schema_name, table_name, count_value in rows:
                table = tables_by_key.get((schema_name, table_name))
                if table is not None:
                    table[field_name] = int(count_value or 0)

        return merge

    @staticmethod
    def _merge_primary_key_rows(
        rows: Sequence[Sequence[Any]],
        tables_by_key: Dict[Tuple[str, str], Dict[str, Any]],
    ) -> None:
        for schema_name, table_name, column_name in rows:
            table = tables_by_key.get((schema_name, table_name))
            if table is not None:
                table.setdefault("primary_key_columns", []).append(column_name)

    def sample_table(
        self,
        connection_uri: str,
        schema_name: str,
        table_name: str,
        columns: Sequence[str],
        limit: int = 25,
    ) -> Dict[str, Any]:
        row_limit = max(1, min(int(limit or 25), 100))
        column_clause = ", ".join(_quote_identifier(col) for col in columns) or "*"
        sql = (
            f"SELECT {column_clause} FROM "
            f"{_quote_identifier(schema_name)}.{_quote_identifier(table_name)} LIMIT {row_limit}"
        )
        with self._connect(connection_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
                headers = [
                    getattr(desc, "name", desc[0]) for desc in cur.description or []
                ]
        return {
            "columns": headers,
            "rows": [list(row) for row in rows],
            "generated_sql": sql,
        }

    def export_table_csv(
        self,
        connection_uri: str,
        schema_name: str,
        table_name: str,
        columns: Sequence[str],
        row_limit: int,
        max_bytes: int,
        date_filter_column: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        bounded_limit = _normalize_row_limit(row_limit)
        column_clause = ", ".join(_quote_identifier(col) for col in columns) or "*"
        filters = []
        if date_filter_column:
            quoted = _quote_identifier(date_filter_column)
            if start_date:
                filters.append(f"{quoted} >= {_sql_literal(start_date)}")
            if end_date:
                filters.append(f"{quoted} <= {_sql_literal(end_date)}")
        where_clause = f" WHERE {' AND '.join(filters)}" if filters else ""
        sql = (
            f"SELECT {column_clause} FROM "
            f"{_quote_identifier(schema_name)}.{_quote_identifier(table_name)}"
            f"{where_clause} LIMIT {bounded_limit}"
        )
        return self._query_to_csv(
            connection_uri=connection_uri,
            sql=sql,
            max_bytes=max_bytes,
            row_limit=bounded_limit,
            data_format="csv",
        )

    def export_aggregate_csv(
        self,
        connection_uri: str,
        schema_name: str,
        table_name: str,
        group_by_columns: Sequence[str],
        metric_columns: Sequence[str],
        row_limit: int,
        max_bytes: int,
    ) -> Dict[str, Any]:
        bounded_limit = _normalize_row_limit(row_limit)
        groups = list(group_by_columns)[:3]
        metrics = list(metric_columns)[:5]
        select_parts = [_quote_identifier(col) for col in groups]
        select_parts.append("COUNT(*) AS row_count")
        for metric in metrics:
            quoted = _quote_identifier(metric)
            safe_alias = metric.replace('"', "").replace(".", "_")
            select_parts.append(
                f"SUM({quoted}) AS { _quote_identifier(f'{safe_alias}_sum') }"
            )
            select_parts.append(
                f"AVG({quoted}) AS { _quote_identifier(f'{safe_alias}_avg') }"
            )
        group_clause = (
            " GROUP BY " + ", ".join(_quote_identifier(col) for col in groups)
            if groups
            else ""
        )
        order_clause = " ORDER BY row_count DESC" if groups else ""
        sql = (
            f"SELECT {', '.join(select_parts)} FROM "
            f"{_quote_identifier(schema_name)}.{_quote_identifier(table_name)}"
            f"{group_clause}{order_clause} LIMIT {bounded_limit}"
        )
        export = self._query_to_csv(
            connection_uri=connection_uri,
            sql=sql,
            max_bytes=max_bytes,
            row_limit=bounded_limit,
            data_format="csv",
        )
        export["sync_mode"] = "aggregated_result"
        return export

    def _query_to_csv(
        self,
        connection_uri: str,
        sql: str,
        max_bytes: int,
        row_limit: int,
        data_format: str,
    ) -> Dict[str, Any]:
        output = io.StringIO()
        writer = csv.writer(output)
        row_count = 0
        with self._connect(connection_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                headers = [
                    getattr(desc, "name", desc[0]) for desc in cur.description or []
                ]
                writer.writerow(headers)
                while True:
                    batch = cur.fetchmany(1000)
                    if not batch:
                        break
                    writer.writerows(batch)
                    row_count += len(batch)
                    if output.tell() > max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail="Supabase extract exceeded the configured byte cap.",
                        )
        data = output.getvalue().encode("utf-8")
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="Supabase extract exceeded the configured byte cap.",
            )
        return {
            "csv_content": data,
            "headers": headers,
            "row_count": row_count,
            "column_count": len(headers),
            "generated_sql": sql,
            "row_limit": row_limit,
            "data_format": data_format,
            "truncated": row_count >= row_limit,
        }

    def app_profile_csv(self, connection_uri: str, max_bytes: int) -> Dict[str, Any]:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["section", "metric", "value", "redacted"])
        rows = 0
        with self._connect(connection_uri) as conn:
            with conn.cursor() as cur:
                rows += self._write_auth_summary(cur, writer)
                rows += self._write_storage_summary(cur, writer)
        data = output.getvalue().encode("utf-8")
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413, detail="Supabase app profile exceeded byte cap."
            )
        return {
            "csv_content": data,
            "headers": ["section", "metric", "value", "redacted"],
            "row_count": rows,
            "column_count": 4,
            "generated_sql": "Generated Supabase Auth/Storage summary queries",
            "row_limit": rows,
            "data_format": "csv",
            "pii_redacted": True,
        }

    @staticmethod
    def _write_auth_summary(cur: Any, writer: Any) -> int:
        try:
            cur.execute(
                """
                SELECT count(*)::int,
                       count(confirmed_at)::int,
                       min(created_at)::text,
                       max(created_at)::text
                FROM auth.users
                """
            )
            total, confirmed, first_seen, last_seen = cur.fetchone()
            rows = [
                ("auth_users", "total_users", total, True),
                ("auth_users", "confirmed_users", confirmed, True),
                ("auth_users", "first_created_at", first_seen, True),
                ("auth_users", "last_created_at", last_seen, True),
            ]
        except Exception as exc:
            rows = [("auth_users", "status", f"unavailable: {exc}", True)]
        writer.writerows(rows)
        return len(rows)

    @staticmethod
    def _write_storage_summary(cur: Any, writer: Any) -> int:
        try:
            cur.execute(
                """
                SELECT id, name, public, created_at::text, updated_at::text
                FROM storage.buckets
                ORDER BY name
                LIMIT 200
                """
            )
            rows = [
                (
                    "storage_bucket",
                    str(name or bucket_id),
                    json.dumps(
                        {
                            "bucket_id": bucket_id,
                            "public": bool(public),
                            "created_at": created_at,
                            "updated_at": updated_at,
                        },
                        sort_keys=True,
                    ),
                    False,
                )
                for bucket_id, name, public, created_at, updated_at in cur.fetchall()
            ]
        except Exception as exc:
            rows = [("storage_bucket", "status", f"unavailable: {exc}", False)]
        writer.writerows(rows)
        return len(rows)


class SupabaseConnectorService:
    def __init__(self) -> None:
        self.adapter = SupabaseAdapter()

    def _supabase_config(self) -> Dict[str, str]:
        supabase_cfg = getattr(config, "supabase", None)
        return {
            "client_id": (
                getattr(supabase_cfg, "client_id", "") if supabase_cfg else ""
            )
            or os.environ.get("SUPABASE_CLIENT_ID", ""),
            "client_secret": (
                getattr(supabase_cfg, "client_secret", "") if supabase_cfg else ""
            )
            or os.environ.get("SUPABASE_CLIENT_SECRET", ""),
            "redirect_uri": (
                getattr(supabase_cfg, "redirect_uri", "") if supabase_cfg else ""
            )
            or os.environ.get("SUPABASE_REDIRECT_URI", ""),
            "oauth_base_url": (
                getattr(supabase_cfg, "oauth_base_url", "") if supabase_cfg else ""
            )
            or os.environ.get(
                "SUPABASE_OAUTH_BASE_URL", "https://api.supabase.com/v1/oauth"
            ),
            "api_base_url": (
                getattr(supabase_cfg, "api_base_url", "") if supabase_cfg else ""
            )
            or os.environ.get("SUPABASE_API_BASE_URL", "https://api.supabase.com/v1"),
        }

    def _make_state_payload(self, user_id: str, nonce: str, ts: int) -> str:
        body = _b64url(
            json.dumps(
                {"u": user_id, "n": nonce, "ts": ts}, separators=(",", ":")
            ).encode("utf-8")
        )
        sig = hmac.new(
            config.app.secret_key.encode(), body.encode("ascii"), hashlib.sha256
        ).hexdigest()
        return f"{body}.{sig}"

    def _verify_state(self, state: str, max_age_seconds: int = 600) -> Dict[str, Any]:
        try:
            body, sig = state.split(".", 1)
            expected = hmac.new(
                config.app.secret_key.encode(), body.encode("ascii"), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(sig, expected):
                raise ValueError("Invalid state signature")
            padded = body + "=" * (-len(body) % 4)
            data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
            age = int(datetime.now(timezone.utc).timestamp()) - int(data.get("ts", 0))
            if age > max_age_seconds:
                raise ValueError("State token expired")
            if not data.get("u") or not data.get("n"):
                raise ValueError("Invalid state payload")
            return data
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Invalid state format") from exc

    def _basic_auth_header(self, client_id: str, client_secret: str) -> str:
        raw = f"{client_id}:{client_secret}".encode("utf-8")
        return f"Basic {base64.b64encode(raw).decode('ascii')}"

    def _save_provider_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict:
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id, provider=SUPABASE_PROVIDER, metadata=metadata
        )

    def get_oauth_url(self, user_id: str) -> str:
        cfg = self._supabase_config()
        if not cfg["client_id"] or not cfg["redirect_uri"]:
            raise ValueError(
                "Supabase OAuth client_id or redirect_uri is not configured."
            )
        verifier = _b64url(secrets.token_bytes(48))
        challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
        nonce = _b64url(secrets.token_bytes(18))
        ts = int(datetime.now(timezone.utc).timestamp())
        state = self._make_state_payload(user_id, nonce, ts)

        record = (
            connected_accounts_repo.get_connection(user_id, SUPABASE_PROVIDER) or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        pending[state] = {"code_verifier": verifier, "created_at": ts}
        self._save_provider_metadata(
            user_id,
            {
                "pending_oauth_states": {
                    key: value
                    for key, value in pending.items()
                    if ts - int(value.get("created_at", 0)) <= 900
                }
            },
        )

        params = urlencode(
            {
                "client_id": cfg["client_id"],
                "redirect_uri": cfg["redirect_uri"],
                "response_type": "code",
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        return f"{cfg['oauth_base_url'].rstrip('/')}/authorize?{params}"

    async def handle_oauth_callback(self, code: str, state: str) -> None:
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        cfg = self._supabase_config()
        record = (
            connected_accounts_repo.get_connection(user_id, SUPABASE_PROVIDER) or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        pending_state = pending.pop(state, None)
        if not pending_state or not pending_state.get("code_verifier"):
            raise ValueError("Missing Supabase OAuth verifier.")
        if not cfg["client_id"] or not cfg["client_secret"]:
            raise ValueError("Supabase OAuth client credentials are not configured.")

        async with httpx.AsyncClient(timeout=20.0) as client:
            token_resp = await client.post(
                f"{cfg['oauth_base_url'].rstrip('/')}/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": cfg["redirect_uri"],
                    "code_verifier": pending_state["code_verifier"],
                },
                headers={
                    "Authorization": self._basic_auth_header(
                        cfg["client_id"], cfg["client_secret"]
                    ),
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
            )
        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Supabase OAuth token exchange failed: {token_resp.text}",
            )
        data = token_resp.json()
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        if not access_token or not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="Supabase OAuth response did not include tokens.",
            )
        expires_in = int(data.get("expires_in") or 3600)
        self._save_provider_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(str(access_token)),
                "encrypted_refresh_token": _encrypt_secret(str(refresh_token)),
                "expires_at": (
                    datetime.now(timezone.utc)
                    + timedelta(seconds=max(60, expires_in - 60))
                ).isoformat(),
                "api_base_url": cfg["api_base_url"],
                "pending_oauth_states": pending,
                "connected_at": _now_iso(),
            },
        )

    async def _get_access_token(self, user_id: str) -> str:
        record = (
            connected_accounts_repo.get_connection(user_id, SUPABASE_PROVIDER) or {}
        )
        encrypted_access = record.get("encrypted_access_token")
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_access or not encrypted_refresh:
            raise HTTPException(status_code=401, detail="Supabase is not connected.")
        expires_at = str(record.get("expires_at") or "")
        if expires_at:
            try:
                expiry = datetime.fromisoformat(expires_at)
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=timezone.utc)
                if expiry > datetime.now(timezone.utc) + timedelta(seconds=60):
                    return _decrypt_secret(str(encrypted_access))
            except ValueError:
                pass
        return await self._refresh_access_token(user_id, record)

    async def _refresh_access_token(self, user_id: str, record: Dict[str, Any]) -> str:
        cfg = self._supabase_config()
        refresh_token = _decrypt_secret(
            str(record.get("encrypted_refresh_token") or "")
        )
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{cfg['oauth_base_url'].rstrip('/')}/token",
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                headers={
                    "Authorization": self._basic_auth_header(
                        cfg["client_id"], cfg["client_secret"]
                    ),
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=401, detail="Supabase connection expired. Please reconnect."
            )
        data = resp.json()
        access_token = str(data.get("access_token") or "")
        new_refresh = str(data.get("refresh_token") or refresh_token)
        if not access_token:
            raise HTTPException(
                status_code=401,
                detail="Supabase refresh did not return an access token.",
            )
        expires_in = int(data.get("expires_in") or 3600)
        self._save_provider_metadata(
            user_id,
            {
                **{
                    key: value
                    for key, value in record.items()
                    if key not in {"user_id", "provider", "created_at", "updated_at"}
                },
                "encrypted_access_token": _encrypt_secret(access_token),
                "encrypted_refresh_token": _encrypt_secret(new_refresh),
                "expires_at": (
                    datetime.now(timezone.utc)
                    + timedelta(seconds=max(60, expires_in - 60))
                ).isoformat(),
            },
        )
        return access_token

    async def _api_request(
        self,
        user_id: str,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        cfg = self._supabase_config()
        token = await self._get_access_token(user_id)
        url = f"{cfg['api_base_url'].rstrip('/')}/{path.lstrip('/')}"
        for attempt in range(3):
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.request(
                    method,
                    url,
                    params=params,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                )
            if resp.status_code == 401 and attempt == 0:
                record = (
                    connected_accounts_repo.get_connection(user_id, SUPABASE_PROVIDER)
                    or {}
                )
                token = await self._refresh_access_token(user_id, record)
                continue
            if resp.status_code == 429 and attempt < 2:
                retry_after = int(resp.headers.get("Retry-After") or "1")
                time.sleep(max(0, min(retry_after, 5)))
                continue
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"Supabase API error: {resp.text}",
                )
            return resp.json() if resp.text else {}
        raise HTTPException(status_code=429, detail="Supabase API rate limit exceeded.")

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, SUPABASE_PROVIDER) or {}
        )
        connections = self.list_connections(user_id)
        return {
            "connected": bool(record.get("encrypted_access_token") or connections),
            "oauth_connected": bool(record.get("encrypted_access_token")),
            "connection_count": len(connections),
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        for item in connected_accounts_repo.list_connections_by_prefix(
            user_id, SUPABASE_CONNECTION_PREFIX
        ):
            connected_accounts_repo.delete_connection(user_id, item["provider"])
        connected_accounts_repo.delete_connection(user_id, SUPABASE_PROVIDER)

    async def list_projects(self, user_id: str) -> List[Dict[str, Any]]:
        data = await self._api_request(user_id, "GET", "/projects")
        projects = data if isinstance(data, list) else data.get("projects", [])
        return [
            {
                "ref": str(project.get("ref") or project.get("id") or ""),
                "name": str(project.get("name") or project.get("ref") or "Supabase"),
                "region": project.get("region"),
                "status": project.get("status"),
                "organization_id": project.get("organization_id")
                or project.get("organization_slug"),
            }
            for project in projects
            if project.get("ref") or project.get("id")
        ]

    def list_connections(self, user_id: str) -> List[Dict[str, Any]]:
        records = connected_accounts_repo.list_connections_by_prefix(
            user_id, SUPABASE_CONNECTION_PREFIX
        )
        return [self._connection_summary(record) for record in records]

    def _connection_summary(self, record: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "connection_id": record.get("connection_id"),
            "connector_key": "supabase",
            "database_type": "supabase",
            "display_name": record.get("display_name") or record.get("project_name"),
            "project_ref": record.get("project_ref"),
            "project_name": record.get("project_name"),
            "organization_id": record.get("organization_id"),
            "connection_mode": record.get("connection_mode"),
            "host": record.get("host"),
            "port": record.get("port"),
            "database": record.get("database"),
            "username": record.get("username"),
            "include_schemas": record.get("include_schemas", []),
            "source_timezone": record.get("source_timezone", "UTC"),
            "max_export_bytes": record.get("max_export_bytes"),
            "credential_risk": record.get("credential_risk"),
            "schema_snapshot": record.get("schema_snapshot") or {},
            "created_at": record.get("created_at"),
            "updated_at": record.get("updated_at"),
        }

    def _get_connection_record(
        self, user_id: str, connection_id: str
    ) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(
            user_id, _connection_provider(connection_id)
        )
        if not record:
            raise HTTPException(status_code=404, detail="Supabase connection not found")
        return record

    def create_connection(
        self,
        user_id: str,
        project_ref: str,
        project_name: str = "",
        organization_id: str = "",
        connection_uri: str = "",
        db_password: str = "",
        display_name: str = "",
        include_schemas: Optional[Sequence[str]] = None,
        include_system_schemas: bool = False,
        source_timezone: str = "UTC",
        service_role_key: str = "",
        max_export_bytes: Any = None,
    ) -> Dict[str, Any]:
        uri = str(connection_uri or "").strip() or _build_direct_uri(
            project_ref, db_password
        )
        parsed = _validate_supabase_connection_uri(uri, project_ref=project_ref)
        test_result = self.adapter.test_connection(uri)
        schemas = _normalize_schema_allowlist(include_schemas, include_system_schemas)
        connection_id = str(uuid.uuid4())
        record = {
            "connection_id": connection_id,
            "connector_key": "supabase",
            "database_type": "supabase",
            "display_name": display_name.strip()
            or project_name.strip()
            or parsed["project_ref"],
            "project_ref": parsed["project_ref"],
            "project_name": project_name.strip() or parsed["project_ref"],
            "organization_id": str(organization_id or "").strip(),
            "encrypted_connection_uri": _encrypt_secret(uri),
            "encrypted_service_role_key": (
                _encrypt_secret(service_role_key) if service_role_key else None
            ),
            "redacted_uri": parsed["redacted_uri"],
            "host": parsed["host"],
            "port": parsed["port"],
            "database": parsed["database"],
            "username": parsed["username"],
            "connection_mode": parsed["connection_mode"],
            "credential_risk": parsed["credential_risk"],
            "include_schemas": schemas,
            "include_system_schemas": bool(include_system_schemas),
            "source_timezone": source_timezone or "UTC",
            "max_export_bytes": _normalize_max_export_bytes(max_export_bytes),
            "test_result": test_result,
            "schema_snapshot": {},
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        cleaned = {key: value for key, value in record.items() if value is not None}
        connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=_connection_provider(connection_id),
            metadata=cleaned,
        )
        return self._connection_summary(cleaned)

    def refresh_schema(self, user_id: str, connection_id: str) -> Dict[str, Any]:
        record = self._get_connection_record(user_id, connection_id)
        uri = _decrypt_secret(str(record["encrypted_connection_uri"]))
        snapshot = self.adapter.refresh_schema(
            connection_uri=uri,
            include_schemas=record.get("include_schemas") or DEFAULT_SCHEMA_ALLOWLIST,
            include_system_schemas=bool(record.get("include_system_schemas")),
        )
        updated = {
            **record,
            "schema_snapshot": snapshot,
            "updated_at": _now_iso(),
        }
        connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=_connection_provider(connection_id),
            metadata={
                key: value
                for key, value in updated.items()
                if key not in {"user_id", "provider"}
            },
        )
        return self._connection_summary(updated)

    def sample_table(
        self,
        user_id: str,
        connection_id: str,
        schema_name: str,
        table_name: str,
        columns: Optional[Sequence[str]] = None,
        limit: int = 25,
    ) -> Dict[str, Any]:
        record = self._get_connection_record(user_id, connection_id)
        snapshot = record.get("schema_snapshot") or {}
        if not snapshot.get("schemas"):
            refreshed = self.refresh_schema(user_id, connection_id)
            record = self._get_connection_record(user_id, connection_id)
            snapshot = (
                refreshed.get("schema_snapshot") or record.get("schema_snapshot") or {}
            )
        table = _find_table(snapshot, schema_name, table_name)
        selected_columns = _select_columns(table, columns)
        return self.adapter.sample_table(
            connection_uri=_decrypt_secret(str(record["encrypted_connection_uri"])),
            schema_name=schema_name,
            table_name=table_name,
            columns=selected_columns,
            limit=limit,
        )

    def sync_entity(
        self,
        user_id: str,
        entity_id: str,
        project_id: str,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        config = dict(overrides or {})
        if entity_id:
            parsed = self.parse_entity_id(entity_id)
            config.setdefault("connection_id", parsed["connection_id"])
            config.setdefault("sync_mode", parsed["sync_mode"])
            config.setdefault("schema", parsed.get("schema"))
            config.setdefault("table", parsed.get("table"))
            config.setdefault("bucket", parsed.get("bucket"))
        return self.sync(
            user_id=user_id,
            project_id=project_id,
            connection_id=str(config.get("connection_id") or ""),
            sync_mode=str(config.get("sync_mode") or "bounded_table_snapshot"),
            schema_name=str(config.get("schema") or config.get("schema_name") or ""),
            table_name=str(config.get("table") or config.get("table_name") or ""),
            columns=config.get("columns") or [],
            row_limit=config.get("row_limit"),
            max_bytes=config.get("max_bytes"),
            date_filter_column=config.get("date_filter_column"),
            start_date=config.get("start_date"),
            end_date=config.get("end_date"),
            group_by_columns=config.get("group_by_columns") or [],
            metric_columns=config.get("metric_columns") or [],
            bucket=str(config.get("bucket") or "all"),
        )

    def sync_scheduled_entity(
        self, user_id: str, project_id: str, connector_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self.sync_entity(
            user_id=user_id,
            entity_id=str(connector_config.get("entity_id") or ""),
            project_id=project_id,
            overrides=connector_config,
        )

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) < 3 or parts[0] != "supabase":
            raise HTTPException(status_code=400, detail="Invalid Supabase entity id")
        connection_id = parts[1]
        kind = parts[2]
        if kind == "table" and len(parts) == 4:
            table_path = parts[3]
            if "." not in table_path:
                raise HTTPException(status_code=400, detail="Invalid Supabase table id")
            schema, table = table_path.rsplit(".", 1)
            return {
                "connection_id": connection_id,
                "sync_mode": "bounded_table_snapshot",
                "schema": schema,
                "table": table,
            }
        if kind == "auth_users":
            return {"connection_id": connection_id, "sync_mode": "app_profile"}
        if kind == "storage" and len(parts) == 4:
            return {
                "connection_id": connection_id,
                "sync_mode": "app_profile",
                "bucket": parts[3] or "all",
            }
        if kind == "profile":
            return {"connection_id": connection_id, "sync_mode": "profile_only"}
        raise HTTPException(status_code=400, detail="Invalid Supabase entity id")

    def sync(
        self,
        user_id: str,
        project_id: str,
        connection_id: str,
        sync_mode: str = "bounded_table_snapshot",
        schema_name: str = "",
        table_name: str = "",
        columns: Optional[Sequence[str]] = None,
        row_limit: Any = None,
        max_bytes: Any = None,
        date_filter_column: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        group_by_columns: Optional[Sequence[str]] = None,
        metric_columns: Optional[Sequence[str]] = None,
        bucket: str = "all",
    ) -> Dict[str, Any]:
        if sync_mode not in {
            "profile_only",
            "bounded_table_snapshot",
            "aggregated_result",
            "app_profile",
        }:
            raise HTTPException(status_code=400, detail="Invalid Supabase sync_mode")
        record = self._get_connection_record(user_id, connection_id)
        snapshot = record.get("schema_snapshot") or {}
        if not snapshot.get("schemas"):
            refreshed = self.refresh_schema(user_id, connection_id)
            record = self._get_connection_record(user_id, connection_id)
            snapshot = (
                refreshed.get("schema_snapshot") or record.get("schema_snapshot") or {}
            )
        uri = _decrypt_secret(str(record["encrypted_connection_uri"]))
        bounded_rows = _normalize_row_limit(row_limit)
        bounded_bytes = min(
            _normalize_max_export_bytes(max_bytes),
            _normalize_max_export_bytes(record.get("max_export_bytes")),
        )

        table: Dict[str, Any] = {}
        selected_columns: List[str] = []
        if sync_mode in {"bounded_table_snapshot", "aggregated_result"}:
            if not schema_name or not table_name:
                raise HTTPException(
                    status_code=400,
                    detail="schema_name and table_name are required for table syncs",
                )
            table = _find_table(snapshot, schema_name, table_name)
            selected_columns = _select_columns(table, columns)

        if sync_mode == "bounded_table_snapshot":
            if date_filter_column and date_filter_column not in selected_columns:
                raise HTTPException(
                    status_code=400,
                    detail="date_filter_column must be one of the selected columns",
                )
            export = self.adapter.export_table_csv(
                connection_uri=uri,
                schema_name=schema_name,
                table_name=table_name,
                columns=selected_columns,
                row_limit=bounded_rows,
                max_bytes=bounded_bytes,
                date_filter_column=date_filter_column,
                start_date=_parse_date(start_date, "start_date"),
                end_date=_parse_date(end_date, "end_date"),
            )
        elif sync_mode == "aggregated_result":
            group_columns = [
                col for col in (group_by_columns or []) if col in selected_columns
            ]
            metric_cols = [
                col for col in (metric_columns or []) if col in selected_columns
            ]
            export = self.adapter.export_aggregate_csv(
                connection_uri=uri,
                schema_name=schema_name,
                table_name=table_name,
                group_by_columns=group_columns,
                metric_columns=metric_cols,
                row_limit=bounded_rows,
                max_bytes=bounded_bytes,
            )
        elif sync_mode == "app_profile":
            export = self.adapter.app_profile_csv(uri, bounded_bytes)
        else:
            export = self._profile_only_csv(snapshot)

        return self._save_supabase_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            sync_mode=sync_mode,
            schema_name=schema_name,
            table_name=table_name,
            table=table,
            selected_columns=selected_columns,
            export=export,
            max_bytes=bounded_bytes,
            bucket=bucket,
        )

    def _profile_only_csv(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        output = io.StringIO()
        writer = csv.writer(output)
        headers = [
            "schema",
            "table",
            "type",
            "row_estimate",
            "rls_enabled",
            "policy_count",
            "grant_count",
            "index_count",
            "column_count",
            "primary_key_columns",
            "possible_pii_columns",
        ]
        writer.writerow(headers)
        row_count = 0
        for schema in snapshot.get("schemas", []):
            for table in schema.get("tables", []):
                pii_cols = [
                    col.get("name")
                    for col in table.get("columns", [])
                    if col.get("possible_pii")
                ]
                writer.writerow(
                    [
                        schema.get("name"),
                        table.get("name"),
                        table.get("type"),
                        table.get("row_estimate"),
                        table.get("rls_enabled"),
                        table.get("policy_count"),
                        table.get("grant_count"),
                        table.get("index_count"),
                        len(table.get("columns", [])),
                        ",".join(table.get("primary_key_columns", [])),
                        ",".join(str(col) for col in pii_cols),
                    ]
                )
                row_count += 1
        data = output.getvalue().encode("utf-8")
        return {
            "csv_content": data,
            "headers": headers,
            "row_count": row_count,
            "column_count": len(headers),
            "generated_sql": "Supabase schema/profile snapshot",
            "row_limit": row_count,
            "data_format": "csv",
            "pii_redacted": True,
        }

    def _selected_entity(
        self,
        record: Dict[str, Any],
        sync_mode: str,
        schema_name: str,
        table_name: str,
        bucket: str = "all",
    ) -> Dict[str, Any]:
        connection_id = str(record.get("connection_id") or "")
        project_name = str(
            record.get("project_name") or record.get("project_ref") or "Supabase"
        )
        if sync_mode in {"bounded_table_snapshot", "aggregated_result"}:
            entity_id = f"supabase:{connection_id}:table:{schema_name}.{table_name}"
            entity_name = f"{project_name} / {schema_name}.{table_name}"
            entity_type = "table"
        elif sync_mode == "app_profile":
            entity_id = f"supabase:{connection_id}:storage:{bucket or 'all'}"
            entity_name = f"{project_name} / App Profile"
            entity_type = "app_profile"
        else:
            entity_id = f"supabase:{connection_id}:profile"
            entity_name = f"{project_name} / Schema Profile"
            entity_type = "profile"
        return {
            "id": entity_id,
            "name": entity_name,
            "type": entity_type,
            "account_name": project_name,
            "connection_id": connection_id,
            "project_ref": record.get("project_ref"),
            "schema_name": schema_name or None,
            "table_name": table_name or None,
            "sync_mode": sync_mode,
            "connector_key": "supabase",
        }

    def _save_supabase_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        sync_mode: str,
        schema_name: str,
        table_name: str,
        table: Dict[str, Any],
        selected_columns: Sequence[str],
        export: Dict[str, Any],
        max_bytes: int,
        bucket: str = "all",
    ) -> Dict[str, Any]:
        csv_content = export["csv_content"]
        checksum = compute_sha256_checksum(csv_content)
        asset_id = str(uuid.uuid4())
        file_id = str(uuid.uuid4())
        s3_bucket = config.aws.s3.USER_ASSETS_BUCKET
        s3_key = build_asset_key(
            user_id=user_id,
            project_id=project_id,
            asset_id=asset_id,
            file_id=file_id,
            extension="csv",
        )
        upload_bytes(s3_bucket, s3_key, csv_content, "text/csv")

        entity = self._selected_entity(
            record, sync_mode, schema_name, table_name, bucket=bucket
        )
        manifest = {
            "connection_id": record.get("connection_id"),
            "connector_key": "supabase",
            "source_type": "supabase",
            "project_ref": record.get("project_ref"),
            "project_name": record.get("project_name"),
            "organization_id": record.get("organization_id"),
            "connection_mode": record.get("connection_mode"),
            "credential_risk": record.get("credential_risk"),
            "sync_mode": sync_mode,
            "schema": schema_name or None,
            "table": table_name or None,
            "selected_columns": list(selected_columns),
            "generated_sql": export.get("generated_sql"),
            "filters": [],
            "snapshot_time": _now_iso(),
            "row_count": export.get("row_count"),
            "column_schema": [
                col
                for col in table.get("columns", [])
                if col.get("name") in selected_columns
            ],
            "checksum_sha256": checksum,
            "data_format": export.get("data_format", "csv"),
            "source_timezone": record.get("source_timezone", "UTC"),
            "schema_fingerprint": (record.get("schema_snapshot") or {}).get(
                "schema_fingerprint"
            ),
            "rls_profile": (
                {
                    "enabled": table.get("rls_enabled"),
                    "policy_count": table.get("policy_count"),
                    "grant_count": table.get("grant_count"),
                }
                if table
                else (record.get("schema_snapshot") or {}).get("rls_summary")
            ),
            "row_limit": export.get("row_limit"),
            "byte_limit": max_bytes,
            "truncated": bool(export.get("truncated", False)),
            "pii_redacted": bool(export.get("pii_redacted", False)),
            "parquet_ready": True,
        }
        manifest_key = f"{s3_key}.manifest.json"
        upload_bytes(
            bucket=s3_bucket,
            key=manifest_key,
            data=json.dumps(manifest, sort_keys=True, default=str).encode("utf-8"),
            content_type="application/json",
        )

        filename_parts = [
            _sanitize_filename_part(str(record.get("project_name") or "supabase")),
            _sanitize_filename_part(sync_mode),
        ]
        if schema_name and table_name:
            filename_parts.append(
                f"{_sanitize_filename_part(schema_name)}.{_sanitize_filename_part(table_name)}"
            )
        filename = "/".join(filename_parts) + ".csv"
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=s3_bucket,
            s3_key=s3_key,
            asset_type=SUPABASE_ASSET_TYPE,
            size_bytes=len(csv_content),
            checksum_sha256=checksum,
            version=config.aws.s3.USER_ASSETS_BUCKET_VERSION,
            content_type="text/csv",
            asset_id=asset_id,
            file_id=file_id,
            original_filename=filename,
            extension="csv",
            row_count=export.get("row_count"),
            column_count=export.get("column_count"),
        )
        connected_accounts_repo.append_selected_entity(
            user_id=user_id, provider=SUPABASE_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "supabase",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "supabase_connection_id": record.get("connection_id"),
                "supabase_project_ref": record.get("project_ref"),
                "supabase_sync_mode": sync_mode,
                "supabase_schema": schema_name,
                "supabase_table": table_name,
                "supabase_manifest_s3_key": manifest_key,
                "supabase_manifest": manifest,
            },
        )
        final_asset = updated or asset
        headers, row_count = _csv_stats_from_bytes(csv_content)
        return {
            "success": True,
            "message": "Supabase data synced successfully",
            "asset": final_asset,
            "row_count": int(export.get("row_count") or row_count),
            "column_count": int(export.get("column_count") or len(headers)),
            "entity_id": entity["id"],
            "truncated": bool(export.get("truncated", False)),
        }


supabase_service = SupabaseConnectorService()
