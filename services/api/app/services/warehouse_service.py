import base64
import csv
import hashlib
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException

from cryptography.fernet import Fernet

from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import connected_accounts as connected_accounts_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes
from utils.s3.paths import build_asset_key

logger = logging.getLogger(__name__)


WAREHOUSE_PROVIDER = "warehouse"
WAREHOUSE_CONNECTION_PREFIX = "warehouse#"
SUPPORTED_WAREHOUSE_TYPES = {"postgres"}
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 50_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024


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


def _quote_identifier(identifier: str) -> str:
    if not isinstance(identifier, str) or not identifier.strip():
        raise HTTPException(status_code=400, detail="SQL identifier is required")
    if "\x00" in identifier:
        raise HTTPException(status_code=400, detail="SQL identifier contains invalid characters")
    return '"' + identifier.replace('"', '""') + '"'


def _sanitize_filename_part(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in value).strip("_") or "warehouse"


def _parse_postgres_uri(connection_uri: str) -> Dict[str, str]:
    parsed = urlparse(connection_uri)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise HTTPException(status_code=400, detail="Only postgres:// or postgresql:// URIs are supported")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="PostgreSQL host is required")
    if not parsed.username:
        raise HTTPException(status_code=400, detail="PostgreSQL username is required")
    database = parsed.path[1:] if parsed.path.startswith("/") else parsed.path
    if not database:
        raise HTTPException(status_code=400, detail="PostgreSQL database name is required")
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


def _select_table(snapshot: Dict[str, Any], schema_name: str, table_name: str) -> Optional[Dict[str, Any]]:
    for schema in snapshot.get("schemas", []):
        if schema.get("name") != schema_name:
            continue
        for table in schema.get("tables", []):
            if table.get("name") == table_name:
                return table
    return None


def _normalize_selected_columns(table: Optional[Dict[str, Any]], columns: Optional[Sequence[str]]) -> List[str]:
    available = [str(col.get("name", "")) for col in (table or {}).get("columns", []) if col.get("name")]
    if not columns:
        return available
    requested = [str(col).strip() for col in columns if str(col).strip()]
    if not requested:
        return available
    unknown = [col for col in requested if available and col not in available]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown column(s): {', '.join(unknown)}")
    return requested


class PostgresWarehouseAdapter:
    def _connect(self, connection_uri: str):
        try:
            import psycopg
        except ImportError as exc:
            raise RuntimeError("psycopg is not installed. Add psycopg[binary] to backend dependencies.") from exc
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
            schemas.setdefault(schema_name, {"name": schema_name, "tables": []})["tables"].append(table)

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
        column_clause = ", ".join(_quote_identifier(col) for col in selected) if selected else "*"
        sql = (
            f"SELECT {column_clause} FROM "
            f"{_quote_identifier(schema_name)}.{_quote_identifier(table_name)} LIMIT {row_limit}"
        )
        with self._connect(connection_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
                headers = [getattr(desc, "name", desc[0]) for desc in cur.description or []]
        return {"columns": headers, "rows": [list(row) for row in rows], "generated_sql": sql}

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
        column_clause = ", ".join(_quote_identifier(col) for col in selected) if selected else "*"
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
                headers = [getattr(desc, "name", desc[0]) for desc in cur.description or []]
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


class WarehouseService:
    def __init__(self):
        self.postgres_adapter = PostgresWarehouseAdapter()

    def _adapter_for(self, connector_key: str) -> PostgresWarehouseAdapter:
        if connector_key != "postgres":
            raise HTTPException(status_code=400, detail=f"Unsupported warehouse connector: {connector_key}")
        return self.postgres_adapter

    def _connection_summary(self, record: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "connection_id": record.get("connection_id"),
            "connector_key": record.get("connector_key", "postgres"),
            "database_type": record.get("database_type", "postgres"),
            "display_name": record.get("display_name") or record.get("database") or "PostgreSQL",
            "host": record.get("host"),
            "port": record.get("port"),
            "database": record.get("database"),
            "username": record.get("username"),
            "include_schemas": record.get("include_schemas", []),
            "source_timezone": record.get("source_timezone", "UTC"),
            "schema_snapshot": record.get("schema_snapshot") or {},
            "created_at": record.get("created_at"),
            "updated_at": record.get("updated_at"),
        }

    def create_connection(
        self,
        user_id: str,
        connector_key: str,
        connection_uri: str,
        display_name: str = "",
        include_schemas: Optional[Sequence[str]] = None,
        source_timezone: str = "UTC",
    ) -> Dict[str, Any]:
        if connector_key not in SUPPORTED_WAREHOUSE_TYPES:
            raise HTTPException(status_code=400, detail="Only PostgreSQL quick-connect is supported in this phase")
        parsed = _parse_postgres_uri(connection_uri)
        test_result = self._adapter_for(connector_key).test_connection(connection_uri)
        connection_id = str(uuid.uuid4())
        normalized_schemas = [str(s).strip() for s in (include_schemas or []) if str(s).strip()]
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

    def list_connections(self, user_id: str, connector_key: Optional[str] = None) -> List[Dict[str, Any]]:
        records = connected_accounts_repo.list_connections_by_prefix(user_id, WAREHOUSE_CONNECTION_PREFIX)
        if connector_key:
            records = [record for record in records if record.get("connector_key") == connector_key]
        records.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return [self._connection_summary(record) for record in records]

    def get_connection_record(self, user_id: str, connection_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, _connection_provider(connection_id))
        if not record:
            raise HTTPException(status_code=404, detail="Warehouse connection not found")
        return record

    def refresh_schema(self, user_id: str, connection_id: str) -> Dict[str, Any]:
        record = self.get_connection_record(user_id, connection_id)
        connection_uri = _decrypt_secret(str(record.get("encrypted_connection_uri", "")))
        snapshot = self._adapter_for(record.get("connector_key", "postgres")).refresh_schema(
            connection_uri=connection_uri,
            include_schemas=record.get("include_schemas") or [],
        )
        updated = connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=_connection_provider(connection_id),
            metadata={"schema_snapshot": snapshot, "last_schema_refresh_at": snapshot["refreshed_at"]},
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
        connection_uri = _decrypt_secret(str(record.get("encrypted_connection_uri", "")))
        snapshot = record.get("schema_snapshot") or {}
        table = _select_table(snapshot, schema_name, table_name)
        selected_columns = _normalize_selected_columns(table, columns)
        return self._adapter_for(record.get("connector_key", "postgres")).sample_table(
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
        connection_uri = _decrypt_secret(str(record.get("encrypted_connection_uri", "")))
        snapshot = record.get("schema_snapshot") or {}
        table = _select_table(snapshot, schema_name, table_name)
        if table is None:
            refreshed = self.refresh_schema(user_id, connection_id)
            record = self.get_connection_record(user_id, connection_id)
            snapshot = refreshed.get("schema_snapshot") or record.get("schema_snapshot") or {}
            table = _select_table(snapshot, schema_name, table_name)
        if table is None:
            raise HTTPException(status_code=404, detail="Warehouse table was not found in the schema snapshot")

        selected_columns = _normalize_selected_columns(table, columns)
        export = self._adapter_for(record.get("connector_key", "postgres")).export_table_csv(
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
        schema_name = str(connector_config.get("schema") or connector_config.get("schema_name") or "").strip()
        table_name = str(connector_config.get("table") or connector_config.get("table_name") or "").strip()
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
        connected_accounts_repo.delete_connection(user_id, _connection_provider(connection_id))
        warehouse_record = connected_accounts_repo.get_connection(user_id, WAREHOUSE_PROVIDER) or {}
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

    def _selected_entity(self, record: Dict[str, Any], schema_name: str, table_name: str) -> Dict[str, Any]:
        connection_id = str(record.get("connection_id"))
        display_name = str(record.get("display_name") or record.get("database") or "PostgreSQL")
        return {
            "id": f"{connection_id}:{schema_name}.{table_name}",
            "name": f"{schema_name}.{table_name}",
            "type": "table",
            "account_name": display_name,
            "connection_id": connection_id,
            "connector_key": record.get("connector_key", "postgres"),
            "database_type": record.get("database_type", "postgres"),
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
        upload_bytes(bucket=bucket, key=s3_key, data=csv_content, content_type="text/csv")

        table_columns = table.get("columns", [])
        manifest = {
            "connection_id": record.get("connection_id"),
            "source_type": record.get("database_type", "postgres"),
            "schema": schema_name,
            "table": table_name,
            "selected_columns": list(selected_columns),
            "generated_sql": export["generated_sql"],
            "filters": [],
            "snapshot_time": _now_iso(),
            "row_count": export["row_count"],
            "column_schema": [col for col in table_columns if col.get("name") in selected_columns],
            "checksum_sha256": checksum,
            "data_format": "csv",
            "source_timezone": record.get("source_timezone", "UTC"),
            "schema_fingerprint": record.get("schema_snapshot", {}).get("schema_fingerprint"),
            "row_limit": export["row_limit"],
            "byte_limit": max_bytes,
        }
        manifest_key = f"{s3_key}.manifest.json"
        upload_bytes(
            bucket=bucket,
            key=manifest_key,
            data=json.dumps(manifest, default=str, sort_keys=True).encode("utf-8"),
            content_type="application/json",
        )

        filename = (
            f"{_sanitize_filename_part(str(record.get('display_name') or 'postgres'))}/"
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
                "connector_key": "postgres",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "warehouse_connection_id": record.get("connection_id"),
                "warehouse_database_type": record.get("database_type", "postgres"),
                "warehouse_schema": schema_name,
                "warehouse_table": table_name,
                "warehouse_columns": list(selected_columns),
                "warehouse_generated_sql": export["generated_sql"],
                "warehouse_manifest_s3_key": manifest_key,
                "warehouse_data_format": "csv",
                "warehouse_source_timezone": record.get("source_timezone", "UTC"),
                "warehouse_schema_fingerprint": manifest.get("schema_fingerprint"),
                "warehouse_manifest": manifest,
            },
        )
        return updated or asset


warehouse_service = WarehouseService()
