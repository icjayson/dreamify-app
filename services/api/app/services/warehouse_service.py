import base64
import csv
import hashlib
import io
import json
import logging
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization

from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import connected_accounts as connected_accounts_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes
from utils.s3.paths import build_asset_key

logger = logging.getLogger(__name__)


WAREHOUSE_PROVIDER = "warehouse"
WAREHOUSE_CONNECTION_PREFIX = "warehouse#"
SUPPORTED_WAREHOUSE_TYPES = {"postgres", "bigquery", "snowflake"}
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 50_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_BILLING_BYTES = 10 * 1024 * 1024 * 1024
DEFAULT_MAX_ASSIGNED_BYTES = DEFAULT_MAX_BILLING_BYTES


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connection_provider(connection_id: str) -> str:
    return f"{WAREHOUSE_CONNECTION_PREFIX}{connection_id}"


def _normalize_row_limit(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_ROW_LIMIT
    return max(1, min(parsed, MAX_ROW_LIMIT))


def _normalize_max_billing_bytes(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_BILLING_BYTES
    return max(1, parsed)


def _normalize_max_assigned_bytes(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_ASSIGNED_BYTES
    return max(1, parsed)


def _quote_identifier(identifier: str) -> str:
    if not isinstance(identifier, str) or not identifier.strip():
        raise HTTPException(status_code=400, detail="SQL identifier is required")
    if "\x00" in identifier:
        raise HTTPException(
            status_code=400, detail="SQL identifier contains invalid characters"
        )
    return '"' + identifier.replace('"', '""') + '"'


def _quote_bigquery_identifier(identifier: str) -> str:
    if not isinstance(identifier, str) or not identifier.strip():
        raise HTTPException(status_code=400, detail="GoogleSQL identifier is required")
    if "\x00" in identifier:
        raise HTTPException(
            status_code=400, detail="GoogleSQL identifier contains invalid characters"
        )
    return "`" + identifier.replace("\\", "\\\\").replace("`", "\\`") + "`"


def _quote_bigquery_table(project_id: str, dataset_name: str, table_name: str) -> str:
    return _quote_bigquery_identifier(f"{project_id}.{dataset_name}.{table_name}")


def _quote_snowflake_table(database: str, schema_name: str, table_name: str) -> str:
    return ".".join(
        [
            _quote_identifier(database),
            _quote_identifier(schema_name),
            _quote_identifier(table_name),
        ]
    )


def _sanitize_filename_part(value: str) -> str:
    return (
        "".join(
            ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in value
        ).strip("_")
        or "warehouse"
    )


def _parse_postgres_uri(connection_uri: str) -> Dict[str, str]:
    parsed = urlparse(connection_uri)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise HTTPException(
            status_code=400,
            detail="Only postgres:// or postgresql:// URIs are supported",
        )
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="PostgreSQL host is required")
    if not parsed.username:
        raise HTTPException(status_code=400, detail="PostgreSQL username is required")
    database = parsed.path[1:] if parsed.path.startswith("/") else parsed.path
    if not database:
        raise HTTPException(
            status_code=400, detail="PostgreSQL database name is required"
        )
    host = parsed.hostname
    port = str(parsed.port or 5432)
    username = parsed.username
    return {
        "host": host,
        "port": port,
        "database": database,
        "username": username,
        "redacted_uri": f"postgresql://{username}:***@{host}:{port}/{database}",
    }


def _parse_bigquery_service_account_json(
    service_account_json: str,
) -> Tuple[Dict[str, Any], Dict[str, str]]:
    raw = str(service_account_json or "").strip()
    if not raw:
        raise HTTPException(
            status_code=400, detail="BigQuery service account JSON is required"
        )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="BigQuery service account JSON is not valid JSON"
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400, detail="BigQuery service account JSON must be an object"
        )
    required = ["client_email", "private_key", "project_id"]
    missing = [key for key in required if not str(data.get(key) or "").strip()]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"BigQuery service account JSON is missing: {', '.join(missing)}",
        )
    if data.get("type") and data.get("type") != "service_account":
        raise HTTPException(
            status_code=400,
            detail="BigQuery credentials must be a service account JSON key",
        )
    summary = {
        "service_account_email": str(data.get("client_email") or ""),
        "credential_project_id": str(data.get("project_id") or ""),
    }
    return data, summary


def _require_snowflake_field(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise HTTPException(
            status_code=400, detail=f"Snowflake {field_name} is required"
        )
    return normalized


def _warehouse_fernet() -> Fernet:
    raw = config.slack.chat_encryption_key if config.slack else ""
    if raw:
        return Fernet(raw.encode("utf-8"))
    app_secret = getattr(config.app, "secret_key", "")
    if not app_secret or app_secret == "dev-secret-key":
        raise RuntimeError("warehouse credential encryption key is not configured")
    key = base64.urlsafe_b64encode(hashlib.sha256(app_secret.encode("utf-8")).digest())
    return Fernet(key)


def _encrypt_secret(value: str) -> str:
    return _warehouse_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def _decrypt_secret(value: str) -> str:
    return _warehouse_fernet().decrypt(value.encode("utf-8")).decode("utf-8")


def _schema_fingerprint(snapshot: Dict[str, Any]) -> str:
    payload = json.dumps(snapshot.get("schemas", []), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _select_table(
    snapshot: Dict[str, Any], schema_name: str, table_name: str
) -> Optional[Dict[str, Any]]:
    for schema in snapshot.get("schemas", []):
        if schema.get("name") != schema_name:
            continue
        for table in schema.get("tables", []):
            if table.get("name") == table_name:
                return table
    return None


def _normalize_selected_columns(
    table: Optional[Dict[str, Any]], columns: Optional[Sequence[str]]
) -> List[str]:
    available = [
        str(col.get("name", ""))
        for col in (table or {}).get("columns", [])
        if col.get("name")
    ]
    if not columns:
        return available
    requested = [str(col).strip() for col in columns if str(col).strip()]
    if not requested:
        return available
    unknown = [col for col in requested if available and col not in available]
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Unknown column(s): {', '.join(unknown)}"
        )
    return requested


def _csv_stats_from_bytes(data: bytes) -> Tuple[List[str], int]:
    text = data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        return [], 0
    return headers, sum(1 for _ in reader)


class PostgresWarehouseAdapter:
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
    ) -> Dict[str, Any]:
        include = [s for s in (include_schemas or []) if str(s).strip()]
        tables_sql = """
            SELECT table_schema, table_name, table_type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
        """
        columns_sql = """
            SELECT table_schema, table_name, column_name, ordinal_position,
                   data_type, udt_name, is_nullable, numeric_precision,
                   numeric_scale, datetime_precision, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name, ordinal_position
        """

        tables_by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
        with self._connect(connection_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(tables_sql)
                for schema_name, table_name, table_type in cur.fetchall():
                    if include and schema_name not in include:
                        continue
                    tables_by_key[(schema_name, table_name)] = {
                        "schema": schema_name,
                        "name": table_name,
                        "type": str(table_type or "").lower(),
                        "columns": [],
                    }

                cur.execute(columns_sql)
                for row in cur.fetchall():
                    schema_name, table_name = row[0], row[1]
                    table = tables_by_key.get((schema_name, table_name))
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
                        }
                    )

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
        }
        snapshot["schema_fingerprint"] = _schema_fingerprint(snapshot)
        return snapshot

    def sample_table(
        self,
        connection_uri: str,
        schema_name: str,
        table_name: str,
        columns: Optional[Sequence[str]] = None,
        limit: int = 25,
    ) -> Dict[str, Any]:
        row_limit = max(1, min(int(limit or 25), 100))
        selected = [str(col).strip() for col in (columns or []) if str(col).strip()]
        column_clause = (
            ", ".join(_quote_identifier(col) for col in selected) if selected else "*"
        )
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
        columns: Optional[Sequence[str]],
        row_limit: int,
        max_bytes: int,
    ) -> Dict[str, Any]:
        bounded_limit = _normalize_row_limit(row_limit)
        selected = [str(col).strip() for col in (columns or []) if str(col).strip()]
        column_clause = (
            ", ".join(_quote_identifier(col) for col in selected) if selected else "*"
        )
        sql = (
            f"SELECT {column_clause} FROM "
            f"{_quote_identifier(schema_name)}.{_quote_identifier(table_name)} LIMIT {bounded_limit}"
        )

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
                            detail="Warehouse extract exceeded the configured byte cap. Select fewer columns or add filters.",
                        )

        data = output.getvalue().encode("utf-8")
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="Warehouse extract exceeded the configured byte cap. Select fewer columns or add filters.",
            )
        return {
            "csv_content": data,
            "headers": headers,
            "row_count": row_count,
            "column_count": len(headers),
            "generated_sql": sql,
            "row_limit": bounded_limit,
        }


class BigQueryWarehouseAdapter:
    def _bigquery_module(self):
        try:
            from google.cloud import bigquery
        except ImportError as exc:
            raise RuntimeError(
                "google-cloud-bigquery is not installed. Add it to backend dependencies."
            ) from exc
        return bigquery

    def _client(self, service_account_json: str, project_id: str, location: str):
        try:
            from google.oauth2 import service_account
        except ImportError as exc:
            raise RuntimeError(
                "google-auth is not installed. Add google-cloud-bigquery to backend dependencies."
            ) from exc

        service_account_info, _ = _parse_bigquery_service_account_json(
            service_account_json
        )
        credentials = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        bigquery = self._bigquery_module()
        return bigquery.Client(
            project=project_id,
            credentials=credentials,
            location=location or None,
        )

    def _dry_run(
        self,
        client: Any,
        sql: str,
        location: str,
        max_billing_bytes: int,
    ) -> int:
        bigquery = self._bigquery_module()
        job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        job = client.query(sql, job_config=job_config, location=location or None)
        dry_run_bytes = int(getattr(job, "total_bytes_processed", 0) or 0)
        if dry_run_bytes > max_billing_bytes:
            raise HTTPException(
                status_code=413,
                detail=(
                    "BigQuery dry-run estimate exceeds the configured max_billing_bytes. "
                    "Select fewer columns, lower the row cap, or use a filtered view."
                ),
            )
        return dry_run_bytes

    def _query_rows(
        self,
        client: Any,
        sql: str,
        location: str,
        max_billing_bytes: int,
    ) -> Any:
        bigquery = self._bigquery_module()
        job_config = bigquery.QueryJobConfig(
            use_query_cache=False,
            maximum_bytes_billed=max_billing_bytes,
        )
        query_job = client.query(sql, job_config=job_config, location=location or None)
        return query_job.result()

    def test_connection(
        self,
        service_account_json: str,
        project_id: str,
        location: str,
    ) -> Dict[str, Any]:
        client = self._client(service_account_json, project_id, location)
        datasets = list(client.list_datasets(project=project_id, max_results=1))
        _, summary = _parse_bigquery_service_account_json(service_account_json)
        return {
            "project_id": project_id,
            "location": location,
            "service_account_email": summary["service_account_email"],
            "dataset_accessible": bool(datasets),
        }

    def refresh_schema(
        self,
        service_account_json: str,
        project_id: str,
        location: str,
        include_datasets: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        include = [str(s).strip() for s in (include_datasets or []) if str(s).strip()]
        client = self._client(service_account_json, project_id, location)

        if include:
            dataset_items = [
                client.get_dataset(client.dataset(dataset_id, project=project_id))
                for dataset_id in include
            ]
        else:
            dataset_items = list(client.list_datasets(project=project_id))

        schemas: List[Dict[str, Any]] = []
        table_count = 0
        for dataset in dataset_items:
            dataset_id = str(
                getattr(dataset, "dataset_id", "")
                or getattr(getattr(dataset, "reference", None), "dataset_id", "")
            )
            if not dataset_id:
                continue
            if include and dataset_id not in include:
                continue
            dataset_ref = getattr(dataset, "reference", None) or client.dataset(
                dataset_id, project=project_id
            )
            schema_tables: List[Dict[str, Any]] = []
            for table_item in client.list_tables(dataset_ref):
                table = client.get_table(getattr(table_item, "reference", table_item))
                table_id = str(
                    getattr(table, "table_id", "")
                    or getattr(getattr(table, "reference", None), "table_id", "")
                )
                if not table_id:
                    continue
                fields = getattr(table, "schema", []) or []
                schema_tables.append(
                    {
                        "schema": dataset_id,
                        "name": table_id,
                        "type": str(
                            getattr(table, "table_type", "") or "table"
                        ).lower(),
                        "row_count": int(getattr(table, "num_rows", 0) or 0),
                        "columns": [
                            self._schema_field_to_column(field, index + 1)
                            for index, field in enumerate(fields)
                        ],
                    }
                )
                table_count += 1
            schemas.append({"name": dataset_id, "tables": schema_tables})

        snapshot = {
            "refreshed_at": _now_iso(),
            "schemas": schemas,
            "table_count": table_count,
            "project_id": project_id,
            "location": location,
        }
        snapshot["schema_fingerprint"] = _schema_fingerprint(snapshot)
        return snapshot

    def sample_table(
        self,
        service_account_json: str,
        project_id: str,
        location: str,
        schema_name: str,
        table_name: str,
        columns: Optional[Sequence[str]] = None,
        limit: int = 25,
        max_billing_bytes: int = DEFAULT_MAX_BILLING_BYTES,
    ) -> Dict[str, Any]:
        row_limit = max(1, min(int(limit or 25), 100))
        selected = [str(col).strip() for col in (columns or []) if str(col).strip()]
        column_clause = (
            ", ".join(_quote_bigquery_identifier(col) for col in selected)
            if selected
            else "*"
        )
        sql = f"SELECT {column_clause} FROM {_quote_bigquery_table(project_id, schema_name, table_name)} LIMIT {row_limit}"
        client = self._client(service_account_json, project_id, location)
        dry_run_bytes = self._dry_run(client, sql, location, max_billing_bytes)
        results = self._query_rows(client, sql, location, max_billing_bytes)
        headers = [
            str(getattr(field, "name", ""))
            for field in (getattr(results, "schema", []) or [])
        ]
        rows = [self._row_to_list(row) for row in results]
        return {
            "columns": headers,
            "rows": rows,
            "generated_sql": sql,
            "dry_run_bytes": dry_run_bytes,
        }

    def export_table_csv(
        self,
        service_account_json: str,
        project_id: str,
        location: str,
        schema_name: str,
        table_name: str,
        columns: Optional[Sequence[str]],
        row_limit: int,
        max_bytes: int,
        max_billing_bytes: int = DEFAULT_MAX_BILLING_BYTES,
    ) -> Dict[str, Any]:
        bounded_limit = _normalize_row_limit(row_limit)
        selected = [str(col).strip() for col in (columns or []) if str(col).strip()]
        column_clause = (
            ", ".join(_quote_bigquery_identifier(col) for col in selected)
            if selected
            else "*"
        )
        sql = f"SELECT {column_clause} FROM {_quote_bigquery_table(project_id, schema_name, table_name)} LIMIT {bounded_limit}"
        client = self._client(service_account_json, project_id, location)
        dry_run_bytes = self._dry_run(client, sql, location, max_billing_bytes)
        results = self._query_rows(client, sql, location, max_billing_bytes)
        headers = [
            str(getattr(field, "name", ""))
            for field in (getattr(results, "schema", []) or [])
        ]

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        row_count = 0
        for row in results:
            writer.writerow(self._row_to_list(row))
            row_count += 1
            if output.tell() > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail="Warehouse extract exceeded the configured byte cap. Select fewer columns or add filters.",
                )

        data = output.getvalue().encode("utf-8")
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="Warehouse extract exceeded the configured byte cap. Select fewer columns or add filters.",
            )
        return {
            "csv_content": data,
            "headers": headers,
            "row_count": row_count,
            "column_count": len(headers),
            "generated_sql": sql,
            "row_limit": bounded_limit,
            "dry_run_bytes": dry_run_bytes,
            "max_billing_bytes": max_billing_bytes,
        }

    def _schema_field_to_column(
        self, field: Any, ordinal_position: int
    ) -> Dict[str, Any]:
        mode = str(getattr(field, "mode", "") or "")
        nested_fields = getattr(field, "fields", None) or []
        return {
            "name": str(getattr(field, "name", "") or ""),
            "ordinal_position": ordinal_position,
            "data_type": str(getattr(field, "field_type", "") or ""),
            "native_type": str(getattr(field, "field_type", "") or ""),
            "nullable": mode.upper() != "REQUIRED",
            "mode": mode,
            "description": getattr(field, "description", None),
            "fields": [
                self._schema_field_to_column(nested_field, index + 1)
                for index, nested_field in enumerate(nested_fields)
            ],
        }

    def _row_to_list(self, row: Any) -> List[Any]:
        if hasattr(row, "values"):
            return list(row.values())
        return list(row)


class SnowflakeWarehouseAdapter:
    def _connector_module(self):
        try:
            import snowflake.connector
        except ImportError as exc:
            raise RuntimeError(
                "snowflake-connector-python is not installed. Add it to backend dependencies."
            ) from exc
        return snowflake.connector

    def _private_key_der(
        self, private_key_pem: str, private_key_passphrase: str = ""
    ) -> bytes:
        password = (
            private_key_passphrase.encode("utf-8") if private_key_passphrase else None
        )
        try:
            private_key = serialization.load_pem_private_key(
                private_key_pem.encode("utf-8"),
                password=password,
            )
            return private_key.private_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail="Snowflake private key PEM could not be loaded"
            ) from exc

    def _connect(
        self,
        account: str,
        username: str,
        private_key_pem: str,
        private_key_passphrase: str,
        warehouse: str,
        database: str,
        role: str = "",
    ):
        connector = self._connector_module()
        kwargs: Dict[str, Any] = {
            "account": account,
            "user": username,
            "private_key": self._private_key_der(
                private_key_pem, private_key_passphrase
            ),
            "warehouse": warehouse,
            "database": database,
            "login_timeout": 10,
            "client_session_keep_alive": False,
            "session_parameters": {"QUERY_TAG": "dreamify_warehouse"},
        }
        if role:
            kwargs["role"] = role
        return connector.connect(**kwargs)

    def test_connection(
        self,
        account: str,
        username: str,
        private_key_pem: str,
        private_key_passphrase: str,
        warehouse: str,
        database: str,
        role: str = "",
    ) -> Dict[str, Any]:
        with self._connect(
            account,
            username,
            private_key_pem,
            private_key_passphrase,
            warehouse,
            database,
            role,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT CURRENT_ACCOUNT(), CURRENT_USER(), CURRENT_DATABASE(), CURRENT_WAREHOUSE()"
                )
                current_account, current_user, current_database, current_warehouse = (
                    cur.fetchone()
                )
        return {
            "account": current_account,
            "username": current_user,
            "database": current_database,
            "warehouse": current_warehouse,
            "role": role or None,
        }

    def refresh_schema(
        self,
        account: str,
        username: str,
        private_key_pem: str,
        private_key_passphrase: str,
        warehouse: str,
        database: str,
        role: str = "",
        include_schemas: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        include = [str(s).strip() for s in (include_schemas or []) if str(s).strip()]
        with self._connect(
            account,
            username,
            private_key_pem,
            private_key_passphrase,
            warehouse,
            database,
            role,
        ) as conn:
            with conn.cursor() as cur:
                tables_by_key = self._fetch_tables(cur, database, include)
                self._fetch_columns(cur, database, tables_by_key)
        return self._schema_snapshot(tables_by_key, account, warehouse, database, role)

    def sample_table(
        self,
        account: str,
        username: str,
        private_key_pem: str,
        private_key_passphrase: str,
        warehouse: str,
        database: str,
        schema_name: str,
        table_name: str,
        columns: Optional[Sequence[str]] = None,
        limit: int = 25,
        role: str = "",
    ) -> Dict[str, Any]:
        row_limit = max(1, min(int(limit or 25), 100))
        sql = self._select_sql(database, schema_name, table_name, columns, row_limit)
        with self._connect(
            account,
            username,
            private_key_pem,
            private_key_passphrase,
            warehouse,
            database,
            role,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
                headers = [desc[0] for desc in cur.description or []]
        return {
            "columns": headers,
            "rows": [list(row) for row in rows],
            "generated_sql": sql,
        }

    def export_table_csv(
        self,
        account: str,
        username: str,
        private_key_pem: str,
        private_key_passphrase: str,
        warehouse: str,
        database: str,
        schema_name: str,
        table_name: str,
        columns: Optional[Sequence[str]],
        row_limit: int,
        max_bytes: int,
        role: str = "",
        max_assigned_bytes: int = DEFAULT_MAX_ASSIGNED_BYTES,
    ) -> Dict[str, Any]:
        bounded_limit = _normalize_row_limit(row_limit)
        sql = self._select_sql(
            database, schema_name, table_name, columns, bounded_limit
        )
        with self._connect(
            account,
            username,
            private_key_pem,
            private_key_passphrase,
            warehouse,
            database,
            role,
        ) as conn:
            assigned_bytes = self._explain_assigned_bytes(conn, sql)
            self._enforce_assigned_bytes(assigned_bytes, max_assigned_bytes)
            data = self._copy_select_to_csv(conn, sql, max_bytes)
        headers, row_count = _csv_stats_from_bytes(data)
        return {
            "csv_content": data,
            "headers": headers,
            "row_count": row_count,
            "column_count": len(headers),
            "generated_sql": sql,
            "row_limit": bounded_limit,
            "explain_assigned_bytes": assigned_bytes,
            "max_assigned_bytes": max_assigned_bytes,
            "data_format": "csv",
        }

    def _fetch_tables(
        self,
        cur: Any,
        database: str,
        include_schemas: Sequence[str],
    ) -> Dict[Tuple[str, str], Dict[str, Any]]:
        sql = (
            f"SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ROW_COUNT "
            f"FROM {_quote_identifier(database)}.INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_SCHEMA <> 'INFORMATION_SCHEMA' "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )
        cur.execute(sql)
        tables: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for schema_name, table_name, table_type, row_count in cur.fetchall():
            if include_schemas and schema_name not in include_schemas:
                continue
            tables[(schema_name, table_name)] = {
                "schema": schema_name,
                "name": table_name,
                "type": str(table_type or "").lower(),
                "row_count": int(row_count or 0),
                "columns": [],
            }
        return tables

    def _fetch_columns(
        self,
        cur: Any,
        database: str,
        tables_by_key: Dict[Tuple[str, str], Dict[str, Any]],
    ) -> None:
        sql = (
            f"SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, "
            f"IS_NULLABLE, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION, CHARACTER_MAXIMUM_LENGTH "
            f"FROM {_quote_identifier(database)}.INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA <> 'INFORMATION_SCHEMA' "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
        )
        cur.execute(sql)
        for row in cur.fetchall():
            table = tables_by_key.get((row[0], row[1]))
            if table is None:
                continue
            table["columns"].append(
                {
                    "name": row[2],
                    "ordinal_position": int(row[3] or 0),
                    "data_type": row[4],
                    "native_type": row[4],
                    "nullable": str(row[5]).upper() == "YES",
                    "numeric_precision": row[6],
                    "numeric_scale": row[7],
                    "datetime_precision": row[8],
                    "character_maximum_length": row[9],
                }
            )

    def _schema_snapshot(
        self,
        tables_by_key: Dict[Tuple[str, str], Dict[str, Any]],
        account: str,
        warehouse: str,
        database: str,
        role: str,
    ) -> Dict[str, Any]:
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
            "account": account,
            "warehouse": warehouse,
            "database": database,
            "role": role or None,
        }
        snapshot["schema_fingerprint"] = _schema_fingerprint(snapshot)
        return snapshot

    def _select_sql(
        self,
        database: str,
        schema_name: str,
        table_name: str,
        columns: Optional[Sequence[str]],
        row_limit: int,
    ) -> str:
        selected = [str(col).strip() for col in (columns or []) if str(col).strip()]
        column_clause = (
            ", ".join(_quote_identifier(col) for col in selected) if selected else "*"
        )
        table_ref = _quote_snowflake_table(database, schema_name, table_name)
        return f"SELECT {column_clause} FROM {table_ref} LIMIT {row_limit}"

    def _explain_assigned_bytes(self, conn: Any, sql: str) -> int:
        with conn.cursor() as cur:
            cur.execute(f"EXPLAIN USING JSON {sql}")
            return self._extract_assigned_bytes(cur.fetchall())

    def _extract_assigned_bytes(self, value: Any) -> int:
        values: List[int] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                for key, child in node.items():
                    if str(key) == "assignedBytes":
                        try:
                            values.append(int(child))
                        except (TypeError, ValueError):
                            pass
                    walk(child)
            elif isinstance(node, (list, tuple)):
                for child in node:
                    walk(child)
            elif isinstance(node, str) and node.strip().startswith(("{", "[")):
                try:
                    walk(json.loads(node))
                except json.JSONDecodeError:
                    return

        walk(value)
        return sum(values)

    def _enforce_assigned_bytes(
        self, assigned_bytes: int, max_assigned_bytes: int
    ) -> None:
        if assigned_bytes > max_assigned_bytes:
            raise HTTPException(
                status_code=413,
                detail=(
                    "Snowflake EXPLAIN estimate exceeds the configured max_assigned_bytes. "
                    "Select fewer columns, lower the row cap, or use a filtered view."
                ),
            )

    def _copy_select_to_csv(self, conn: Any, sql: str, max_bytes: int) -> bytes:
        stage_path = f"dreamify_extracts/{uuid.uuid4().hex}"
        copy_sql = (
            f"COPY INTO @~/{stage_path}/ FROM ({sql}) "
            "FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '\"' COMPRESSION = NONE) "
            "HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            with conn.cursor() as cur:
                try:
                    cur.execute(copy_sql)
                    cur.fetchall()
                    cur.execute(f"GET @~/{stage_path}/ file://{tmpdir}")
                    cur.fetchall()
                    return self._read_stage_download(Path(tmpdir), max_bytes)
                finally:
                    cur.execute(f"REMOVE @~/{stage_path}/")
                    cur.fetchall()

    def _read_stage_download(self, tmpdir: Path, max_bytes: int) -> bytes:
        files = sorted(path for path in tmpdir.rglob("*") if path.is_file())
        if not files:
            raise RuntimeError("Snowflake COPY export did not download any files")
        data = b"\n".join(path.read_bytes().rstrip(b"\r\n") for path in files)
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="Warehouse extract exceeded the configured byte cap. Select fewer columns or add filters.",
            )
        return data


class WarehouseService:
    def __init__(self):
        self.postgres_adapter = PostgresWarehouseAdapter()
        self.bigquery_adapter = BigQueryWarehouseAdapter()
        self.snowflake_adapter = SnowflakeWarehouseAdapter()

    def _adapter_for(self, connector_key: str) -> Any:
        if connector_key == "postgres":
            return self.postgres_adapter
        if connector_key == "bigquery":
            return self.bigquery_adapter
        if connector_key == "snowflake":
            return self.snowflake_adapter
        if connector_key not in SUPPORTED_WAREHOUSE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported warehouse connector: {connector_key}",
            )
        raise HTTPException(
            status_code=400, detail=f"Unsupported warehouse connector: {connector_key}"
        )

    def _connection_summary(self, record: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "connection_id": record.get("connection_id"),
            "connector_key": record.get("connector_key", "postgres"),
            "database_type": record.get("database_type", "postgres"),
            "display_name": record.get("display_name")
            or record.get("database")
            or "PostgreSQL",
            "host": record.get("host"),
            "port": record.get("port"),
            "database": record.get("database"),
            "username": record.get("username"),
            "account": record.get("account"),
            "warehouse": record.get("warehouse"),
            "role": record.get("role"),
            "include_schemas": record.get("include_schemas", []),
            "included_schemas": record.get(
                "included_schemas", record.get("include_schemas", [])
            ),
            "project_id": record.get("project_id"),
            "location": record.get("location"),
            "included_datasets": record.get(
                "included_datasets", record.get("include_schemas", [])
            ),
            "service_account_email": record.get("service_account_email"),
            "max_billing_bytes": record.get("max_billing_bytes"),
            "max_assigned_bytes": record.get("max_assigned_bytes"),
            "source_timezone": record.get("source_timezone", "UTC"),
            "schema_snapshot": record.get("schema_snapshot") or {},
            "created_at": record.get("created_at"),
            "updated_at": record.get("updated_at"),
        }

    def create_connection(
        self,
        user_id: str,
        connector_key: str,
        connection_uri: str = "",
        display_name: str = "",
        include_schemas: Optional[Sequence[str]] = None,
        source_timezone: str = "UTC",
        project_id: str = "",
        location: str = "",
        service_account_json: str = "",
        included_datasets: Optional[Sequence[str]] = None,
        max_billing_bytes: Any = None,
        account: str = "",
        username: str = "",
        private_key_pem: str = "",
        private_key_passphrase: str = "",
        warehouse: str = "",
        database: str = "",
        role: str = "",
        included_schemas: Optional[Sequence[str]] = None,
        max_assigned_bytes: Any = None,
    ) -> Dict[str, Any]:
        if connector_key not in SUPPORTED_WAREHOUSE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported warehouse connector: {connector_key}",
            )
        if connector_key == "bigquery":
            return self._create_bigquery_connection(
                user_id=user_id,
                project_id=project_id,
                location=location,
                service_account_json=service_account_json,
                display_name=display_name,
                included_datasets=(
                    included_datasets
                    if included_datasets is not None
                    else include_schemas
                ),
                source_timezone=source_timezone,
                max_billing_bytes=max_billing_bytes,
            )
        if connector_key == "snowflake":
            return self._create_snowflake_connection(
                user_id=user_id,
                account=account,
                username=username,
                private_key_pem=private_key_pem,
                private_key_passphrase=private_key_passphrase,
                warehouse=warehouse,
                database=database,
                role=role,
                display_name=display_name,
                included_schemas=(
                    included_schemas
                    if included_schemas is not None
                    else include_schemas
                ),
                source_timezone=source_timezone,
                max_assigned_bytes=max_assigned_bytes,
            )

        if not str(connection_uri or "").strip():
            raise HTTPException(
                status_code=400, detail="PostgreSQL connection_uri is required"
            )
        parsed = _parse_postgres_uri(connection_uri)
        test_result = self._adapter_for(connector_key).test_connection(connection_uri)
        connection_id = str(uuid.uuid4())
        normalized_schemas = [
            str(s).strip() for s in (include_schemas or []) if str(s).strip()
        ]
        metadata = {
            "connection_id": connection_id,
            "connector_key": connector_key,
            "database_type": connector_key,
            "display_name": display_name.strip() or parsed["database"],
            "encrypted_connection_uri": _encrypt_secret(connection_uri),
            "redacted_uri": parsed["redacted_uri"],
            "host": parsed["host"],
            "port": parsed["port"],
            "database": parsed["database"],
            "username": parsed["username"],
            "include_schemas": normalized_schemas,
            "source_timezone": source_timezone.strip() or "UTC",
            "test_result": test_result,
            "schema_snapshot": {},
        }
        record = connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=_connection_provider(connection_id),
            metadata=metadata,
        )
        return self._connection_summary(record)

    def _create_bigquery_connection(
        self,
        user_id: str,
        project_id: str,
        location: str,
        service_account_json: str,
        display_name: str = "",
        included_datasets: Optional[Sequence[str]] = None,
        source_timezone: str = "UTC",
        max_billing_bytes: Any = None,
    ) -> Dict[str, Any]:
        normalized_project_id = str(project_id or "").strip()
        normalized_location = str(location or "").strip()
        if not normalized_project_id:
            raise HTTPException(
                status_code=400, detail="BigQuery project_id is required"
            )
        if not normalized_location:
            raise HTTPException(status_code=400, detail="BigQuery location is required")

        _, credential_summary = _parse_bigquery_service_account_json(
            service_account_json
        )
        normalized_datasets = [
            str(s).strip() for s in (included_datasets or []) if str(s).strip()
        ]
        normalized_max_billing_bytes = _normalize_max_billing_bytes(max_billing_bytes)
        test_result = self.bigquery_adapter.test_connection(
            service_account_json=service_account_json,
            project_id=normalized_project_id,
            location=normalized_location,
        )
        connection_id = str(uuid.uuid4())
        metadata = {
            "connection_id": connection_id,
            "connector_key": "bigquery",
            "database_type": "bigquery",
            "display_name": display_name.strip() or normalized_project_id,
            "encrypted_service_account_json": _encrypt_secret(service_account_json),
            "project_id": normalized_project_id,
            "location": normalized_location,
            "database": normalized_project_id,
            "username": credential_summary["service_account_email"],
            "service_account_email": credential_summary["service_account_email"],
            "credential_project_id": credential_summary["credential_project_id"],
            "include_schemas": normalized_datasets,
            "included_datasets": normalized_datasets,
            "source_timezone": source_timezone.strip() or "UTC",
            "max_billing_bytes": normalized_max_billing_bytes,
            "test_result": test_result,
            "schema_snapshot": {},
        }
        record = connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=_connection_provider(connection_id),
            metadata=metadata,
        )
        return self._connection_summary(record)

    def _create_snowflake_connection(
        self,
        user_id: str,
        account: str,
        username: str,
        private_key_pem: str,
        private_key_passphrase: str = "",
        warehouse: str = "",
        database: str = "",
        role: str = "",
        display_name: str = "",
        included_schemas: Optional[Sequence[str]] = None,
        source_timezone: str = "UTC",
        max_assigned_bytes: Any = None,
    ) -> Dict[str, Any]:
        normalized_account = _require_snowflake_field(account, "account identifier")
        normalized_username = _require_snowflake_field(username, "username")
        normalized_private_key = _require_snowflake_field(
            private_key_pem, "private_key_pem"
        )
        normalized_warehouse = _require_snowflake_field(warehouse, "warehouse")
        normalized_database = _require_snowflake_field(database, "database")
        normalized_role = str(role or "").strip()
        normalized_schemas = [
            str(s).strip() for s in (included_schemas or []) if str(s).strip()
        ]
        normalized_max_assigned_bytes = _normalize_max_assigned_bytes(
            max_assigned_bytes
        )
        passphrase = str(private_key_passphrase or "").strip()
        test_result = self.snowflake_adapter.test_connection(
            account=normalized_account,
            username=normalized_username,
            private_key_pem=normalized_private_key,
            private_key_passphrase=passphrase,
            warehouse=normalized_warehouse,
            database=normalized_database,
            role=normalized_role,
        )
        connection_id = str(uuid.uuid4())
        metadata = {
            "connection_id": connection_id,
            "connector_key": "snowflake",
            "database_type": "snowflake",
            "display_name": display_name.strip() or normalized_database,
            "encrypted_private_key_pem": _encrypt_secret(normalized_private_key),
            "encrypted_private_key_passphrase": (
                _encrypt_secret(passphrase) if passphrase else ""
            ),
            "account": normalized_account,
            "host": f"{normalized_account}.snowflakecomputing.com",
            "warehouse": normalized_warehouse,
            "database": normalized_database,
            "username": normalized_username,
            "role": normalized_role,
            "include_schemas": normalized_schemas,
            "included_schemas": normalized_schemas,
            "source_timezone": source_timezone.strip() or "UTC",
            "max_assigned_bytes": normalized_max_assigned_bytes,
            "test_result": test_result,
            "schema_snapshot": {},
        }
        record = connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=_connection_provider(connection_id),
            metadata=metadata,
        )
        return self._connection_summary(record)

    def list_connections(
        self, user_id: str, connector_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        records = connected_accounts_repo.list_connections_by_prefix(
            user_id, WAREHOUSE_CONNECTION_PREFIX
        )
        if connector_key:
            records = [
                record
                for record in records
                if record.get("connector_key") == connector_key
            ]
        records.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return [self._connection_summary(record) for record in records]

    def get_connection_record(self, user_id: str, connection_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(
            user_id, _connection_provider(connection_id)
        )
        if not record:
            raise HTTPException(
                status_code=404, detail="Warehouse connection not found"
            )
        return record

    def refresh_schema(self, user_id: str, connection_id: str) -> Dict[str, Any]:
        record = self.get_connection_record(user_id, connection_id)
        connector_key = record.get("connector_key", "postgres")
        if connector_key == "bigquery":
            service_account_json = _decrypt_secret(
                str(record.get("encrypted_service_account_json", ""))
            )
            snapshot = self.bigquery_adapter.refresh_schema(
                service_account_json=service_account_json,
                project_id=str(
                    record.get("project_id") or record.get("database") or ""
                ),
                location=str(record.get("location") or ""),
                include_datasets=record.get("included_datasets")
                or record.get("include_schemas")
                or [],
            )
        elif connector_key == "snowflake":
            private_key_pem, passphrase = self._snowflake_secrets(record)
            snapshot = self.snowflake_adapter.refresh_schema(
                account=str(record.get("account") or ""),
                username=str(record.get("username") or ""),
                private_key_pem=private_key_pem,
                private_key_passphrase=passphrase,
                warehouse=str(record.get("warehouse") or ""),
                database=str(record.get("database") or ""),
                role=str(record.get("role") or ""),
                include_schemas=record.get("included_schemas")
                or record.get("include_schemas")
                or [],
            )
        else:
            connection_uri = _decrypt_secret(
                str(record.get("encrypted_connection_uri", ""))
            )
            snapshot = self.postgres_adapter.refresh_schema(
                connection_uri=connection_uri,
                include_schemas=record.get("include_schemas") or [],
            )
        updated = connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=_connection_provider(connection_id),
            metadata={
                "schema_snapshot": snapshot,
                "last_schema_refresh_at": snapshot["refreshed_at"],
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
        record = self.get_connection_record(user_id, connection_id)
        snapshot = record.get("schema_snapshot") or {}
        table = _select_table(snapshot, schema_name, table_name)
        if table is None:
            raise HTTPException(
                status_code=404,
                detail="Warehouse table was not found in the schema snapshot",
            )
        selected_columns = _normalize_selected_columns(table, columns)
        connector_key = record.get("connector_key", "postgres")
        if connector_key == "bigquery":
            service_account_json = _decrypt_secret(
                str(record.get("encrypted_service_account_json", ""))
            )
            return self.bigquery_adapter.sample_table(
                service_account_json=service_account_json,
                project_id=str(
                    record.get("project_id") or record.get("database") or ""
                ),
                location=str(record.get("location") or ""),
                schema_name=schema_name,
                table_name=table_name,
                columns=selected_columns,
                limit=limit,
                max_billing_bytes=_normalize_max_billing_bytes(
                    record.get("max_billing_bytes")
                ),
            )
        if connector_key == "snowflake":
            private_key_pem, passphrase = self._snowflake_secrets(record)
            return self.snowflake_adapter.sample_table(
                account=str(record.get("account") or ""),
                username=str(record.get("username") or ""),
                private_key_pem=private_key_pem,
                private_key_passphrase=passphrase,
                warehouse=str(record.get("warehouse") or ""),
                database=str(record.get("database") or ""),
                schema_name=schema_name,
                table_name=table_name,
                columns=selected_columns,
                limit=limit,
                role=str(record.get("role") or ""),
            )
        connection_uri = _decrypt_secret(
            str(record.get("encrypted_connection_uri", ""))
        )
        return self.postgres_adapter.sample_table(
            connection_uri=connection_uri,
            schema_name=schema_name,
            table_name=table_name,
            columns=selected_columns,
            limit=limit,
        )

    def sync_table(
        self,
        user_id: str,
        connection_id: str,
        schema_name: str,
        table_name: str,
        project_id: str,
        columns: Optional[Sequence[str]] = None,
        row_limit: int = DEFAULT_ROW_LIMIT,
        max_bytes: int = DEFAULT_MAX_EXPORT_BYTES,
    ) -> Dict[str, Any]:
        if not project_id:
            raise HTTPException(status_code=400, detail="project_id is required")
        record = self.get_connection_record(user_id, connection_id)
        snapshot = record.get("schema_snapshot") or {}
        table = _select_table(snapshot, schema_name, table_name)
        if table is None:
            refreshed = self.refresh_schema(user_id, connection_id)
            record = self.get_connection_record(user_id, connection_id)
            snapshot = (
                refreshed.get("schema_snapshot") or record.get("schema_snapshot") or {}
            )
            table = _select_table(snapshot, schema_name, table_name)
        if table is None:
            raise HTTPException(
                status_code=404,
                detail="Warehouse table was not found in the schema snapshot",
            )

        selected_columns = _normalize_selected_columns(table, columns)
        connector_key = record.get("connector_key", "postgres")
        if connector_key == "bigquery":
            service_account_json = _decrypt_secret(
                str(record.get("encrypted_service_account_json", ""))
            )
            export = self.bigquery_adapter.export_table_csv(
                service_account_json=service_account_json,
                project_id=str(
                    record.get("project_id") or record.get("database") or ""
                ),
                location=str(record.get("location") or ""),
                schema_name=schema_name,
                table_name=table_name,
                columns=selected_columns,
                row_limit=row_limit,
                max_bytes=max_bytes,
                max_billing_bytes=_normalize_max_billing_bytes(
                    record.get("max_billing_bytes")
                ),
            )
        elif connector_key == "snowflake":
            private_key_pem, passphrase = self._snowflake_secrets(record)
            export = self.snowflake_adapter.export_table_csv(
                account=str(record.get("account") or ""),
                username=str(record.get("username") or ""),
                private_key_pem=private_key_pem,
                private_key_passphrase=passphrase,
                warehouse=str(record.get("warehouse") or ""),
                database=str(record.get("database") or ""),
                schema_name=schema_name,
                table_name=table_name,
                columns=selected_columns,
                row_limit=row_limit,
                max_bytes=max_bytes,
                role=str(record.get("role") or ""),
                max_assigned_bytes=_normalize_max_assigned_bytes(
                    record.get("max_assigned_bytes")
                ),
            )
        else:
            connection_uri = _decrypt_secret(
                str(record.get("encrypted_connection_uri", ""))
            )
            export = self.postgres_adapter.export_table_csv(
                connection_uri=connection_uri,
                schema_name=schema_name,
                table_name=table_name,
                columns=selected_columns,
                row_limit=row_limit,
                max_bytes=max_bytes,
            )
        asset = self._save_warehouse_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            schema_name=schema_name,
            table_name=table_name,
            table=table,
            selected_columns=selected_columns,
            export=export,
            max_bytes=max_bytes,
        )
        entity = self._selected_entity(record, schema_name, table_name)
        connected_accounts_repo.append_selected_entity(
            user_id=user_id,
            provider=WAREHOUSE_PROVIDER,
            entity=entity,
        )
        return {
            "success": True,
            "message": "Warehouse table synced successfully",
            "asset": asset,
            "row_count": export["row_count"],
            "column_count": export["column_count"],
            "manifest": asset.get("warehouse_manifest", {}),
        }

    def sync_entity(
        self,
        user_id: str,
        entity_id: str,
        project_id: str,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        connection_id, schema_name, table_name = self.parse_entity_id(entity_id)
        overrides = overrides or {}
        return self.sync_table(
            user_id=user_id,
            connection_id=connection_id,
            schema_name=schema_name,
            table_name=table_name,
            project_id=project_id,
            columns=overrides.get("columns"),
            row_limit=_normalize_row_limit(overrides.get("row_limit")),
        )

    def sync_scheduled_table(
        self,
        user_id: str,
        project_id: str,
        connector_config: Dict[str, Any],
    ) -> Dict[str, Any]:
        connection_id = str(connector_config.get("connection_id") or "").strip()
        schema_name = str(
            connector_config.get("schema") or connector_config.get("schema_name") or ""
        ).strip()
        table_name = str(
            connector_config.get("table") or connector_config.get("table_name") or ""
        ).strip()
        if not connection_id or not schema_name or not table_name:
            entity_id = str(connector_config.get("entity_id") or "").strip()
            connection_id, schema_name, table_name = self.parse_entity_id(entity_id)
        return self.sync_table(
            user_id=user_id,
            connection_id=connection_id,
            schema_name=schema_name,
            table_name=table_name,
            project_id=project_id,
            columns=connector_config.get("columns"),
            row_limit=_normalize_row_limit(connector_config.get("row_limit")),
        )

    def _snowflake_secrets(self, record: Dict[str, Any]) -> Tuple[str, str]:
        private_key_pem = _decrypt_secret(
            str(record.get("encrypted_private_key_pem", ""))
        )
        encrypted_passphrase = str(record.get("encrypted_private_key_passphrase") or "")
        private_key_passphrase = (
            _decrypt_secret(encrypted_passphrase) if encrypted_passphrase else ""
        )
        return private_key_pem, private_key_passphrase

    def parse_entity_id(self, entity_id: str) -> Tuple[str, str, str]:
        raw = str(entity_id or "").strip()
        if ":" not in raw or "." not in raw.split(":", 1)[1]:
            raise HTTPException(status_code=400, detail="Invalid warehouse entity id")
        connection_id, table_path = raw.split(":", 1)
        schema_name, table_name = table_path.split(".", 1)
        if not connection_id or not schema_name or not table_name:
            raise HTTPException(status_code=400, detail="Invalid warehouse entity id")
        return connection_id, schema_name, table_name

    def remove_connection(self, user_id: str, connection_id: str) -> None:
        self.get_connection_record(user_id, connection_id)
        connected_accounts_repo.delete_connection(
            user_id, _connection_provider(connection_id)
        )
        warehouse_record = (
            connected_accounts_repo.get_connection(user_id, WAREHOUSE_PROVIDER) or {}
        )
        selected = warehouse_record.get("selected_entities") or []
        filtered = [
            entity
            for entity in selected
            if str(entity.get("connection_id") or "") != str(connection_id)
        ]
        connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=WAREHOUSE_PROVIDER,
            metadata={"selected_entities": filtered},
        )

    def _selected_entity(
        self, record: Dict[str, Any], schema_name: str, table_name: str
    ) -> Dict[str, Any]:
        connection_id = str(record.get("connection_id"))
        connector_key = str(record.get("connector_key") or "postgres")
        default_names = {
            "bigquery": "BigQuery",
            "snowflake": "Snowflake",
        }
        default_name = default_names.get(connector_key, "PostgreSQL")
        display_name = str(
            record.get("display_name") or record.get("database") or default_name
        )
        return {
            "id": f"{connection_id}:{schema_name}.{table_name}",
            "name": f"{schema_name}.{table_name}",
            "type": "table",
            "account_name": display_name,
            "connection_id": connection_id,
            "connector_key": connector_key,
            "database_type": record.get("database_type", connector_key),
            "schema_name": schema_name,
            "table_name": table_name,
        }

    def _save_warehouse_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        schema_name: str,
        table_name: str,
        table: Dict[str, Any],
        selected_columns: Sequence[str],
        export: Dict[str, Any],
        max_bytes: int,
    ) -> Dict[str, Any]:
        csv_content = export["csv_content"]
        asset_id = str(uuid.uuid4())
        file_id = str(uuid.uuid4())
        checksum = compute_sha256_checksum(csv_content)
        bucket = config.aws.s3.USER_ASSETS_BUCKET
        s3_key = build_asset_key(
            user_id=user_id,
            project_id=project_id,
            asset_id=asset_id,
            file_id=file_id,
            extension="csv",
        )
        upload_bytes(
            bucket=bucket, key=s3_key, data=csv_content, content_type="text/csv"
        )

        table_columns = table.get("columns", [])
        connector_key = str(record.get("connector_key") or "postgres")
        manifest = {
            "connection_id": record.get("connection_id"),
            "connector_key": connector_key,
            "source_type": record.get("database_type", connector_key),
            "project_id": record.get("project_id"),
            "location": record.get("location"),
            "account": record.get("account"),
            "warehouse": record.get("warehouse"),
            "database": record.get("database"),
            "role": record.get("role"),
            "dataset": schema_name if connector_key == "bigquery" else None,
            "schema": schema_name,
            "table": table_name,
            "selected_columns": list(selected_columns),
            "generated_sql": export["generated_sql"],
            "filters": [],
            "snapshot_time": _now_iso(),
            "row_count": export["row_count"],
            "column_schema": [
                col for col in table_columns if col.get("name") in selected_columns
            ],
            "checksum_sha256": checksum,
            "data_format": export.get("data_format", "csv"),
            "source_timezone": record.get("source_timezone", "UTC"),
            "schema_fingerprint": record.get("schema_snapshot", {}).get(
                "schema_fingerprint"
            ),
            "row_limit": export["row_limit"],
            "byte_limit": max_bytes,
            "dry_run_bytes": export.get("dry_run_bytes"),
            "max_billing_bytes": export.get("max_billing_bytes")
            or record.get("max_billing_bytes"),
            "explain_assigned_bytes": export.get("explain_assigned_bytes"),
            "max_assigned_bytes": export.get("max_assigned_bytes")
            or record.get("max_assigned_bytes"),
            "parquet_ready": connector_key in {"bigquery", "snowflake"},
        }
        manifest_key = f"{s3_key}.manifest.json"
        upload_bytes(
            bucket=bucket,
            key=manifest_key,
            data=json.dumps(manifest, default=str, sort_keys=True).encode("utf-8"),
            content_type="application/json",
        )

        filename = (
            f"{_sanitize_filename_part(str(record.get('display_name') or connector_key))}/"
            f"{_sanitize_filename_part(schema_name)}.{_sanitize_filename_part(table_name)}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type="warehouse_extract",
            size_bytes=len(csv_content),
            checksum_sha256=checksum,
            version=config.aws.s3.USER_ASSETS_BUCKET_VERSION,
            content_type="text/csv",
            asset_id=asset_id,
            file_id=file_id,
            original_filename=filename,
            extension="csv",
            row_count=export["row_count"],
            column_count=export["column_count"],
        )
        entity = self._selected_entity(record, schema_name, table_name)
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": connector_key,
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "warehouse_connection_id": record.get("connection_id"),
                "warehouse_database_type": record.get("database_type", connector_key),
                "warehouse_schema": schema_name,
                "warehouse_table": table_name,
                "warehouse_columns": list(selected_columns),
                "warehouse_generated_sql": export["generated_sql"],
                "warehouse_manifest_s3_key": manifest_key,
                "warehouse_data_format": manifest["data_format"],
                "warehouse_source_timezone": record.get("source_timezone", "UTC"),
                "warehouse_schema_fingerprint": manifest.get("schema_fingerprint"),
                "warehouse_dry_run_bytes": manifest.get("dry_run_bytes"),
                "warehouse_max_billing_bytes": manifest.get("max_billing_bytes"),
                "warehouse_explain_assigned_bytes": manifest.get(
                    "explain_assigned_bytes"
                ),
                "warehouse_max_assigned_bytes": manifest.get("max_assigned_bytes"),
                "warehouse_manifest": manifest,
            },
        )
        return updated or asset


warehouse_service = WarehouseService()
