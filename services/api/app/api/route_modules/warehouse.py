import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.route_modules.user import AssetResponse, _ensure_project, _map_asset
from app.dependencies.auth import require_user
from app.services.warehouse_service import DEFAULT_ROW_LIMIT, warehouse_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["warehouse"])


class WarehouseColumn(BaseModel):
    name: str
    ordinal_position: Optional[int] = None
    data_type: Optional[str] = None
    native_type: Optional[str] = None
    nullable: Optional[bool] = None
    mode: Optional[str] = None
    description: Optional[str] = None
    numeric_precision: Optional[int] = None
    numeric_scale: Optional[int] = None
    datetime_precision: Optional[int] = None
    character_maximum_length: Optional[int] = None


class WarehouseTable(BaseModel):
    schema: str
    name: str
    catalog: Optional[str] = None
    source_schema: Optional[str] = None
    type: Optional[str] = None
    row_count: Optional[int] = None
    columns: List[WarehouseColumn] = Field(default_factory=list)


class WarehouseSchema(BaseModel):
    name: str
    catalog: Optional[str] = None
    source_schema: Optional[str] = None
    tables: List[WarehouseTable] = Field(default_factory=list)


class WarehouseSchemaSnapshot(BaseModel):
    refreshed_at: Optional[str] = None
    schemas: List[WarehouseSchema] = Field(default_factory=list)
    table_count: int = 0
    schema_fingerprint: Optional[str] = None
    project_id: Optional[str] = None
    location: Optional[str] = None
    account: Optional[str] = None
    warehouse: Optional[str] = None
    database: Optional[str] = None
    role: Optional[str] = None
    catalog: Optional[str] = None
    warehouse_id: Optional[str] = None


class WarehouseConnectionResponse(BaseModel):
    connection_id: str
    connector_key: str = "postgres"
    database_type: str = "postgres"
    display_name: str
    host: Optional[str] = None
    port: Optional[str] = None
    database: Optional[str] = None
    username: Optional[str] = None
    account: Optional[str] = None
    warehouse: Optional[str] = None
    role: Optional[str] = None
    include_schemas: List[str] = Field(default_factory=list)
    included_schemas: List[str] = Field(default_factory=list)
    project_id: Optional[str] = None
    location: Optional[str] = None
    included_datasets: List[str] = Field(default_factory=list)
    service_account_email: Optional[str] = None
    max_billing_bytes: Optional[int] = None
    max_assigned_bytes: Optional[int] = None
    server_hostname: Optional[str] = None
    http_path: Optional[str] = None
    catalog: Optional[str] = None
    warehouse_id: Optional[str] = None
    max_result_bytes: Optional[int] = None
    statement_timeout_seconds: Optional[int] = None
    source_timezone: str = "UTC"
    schema_snapshot: WarehouseSchemaSnapshot = Field(
        default_factory=WarehouseSchemaSnapshot
    )
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class WarehouseConnectionsResponse(BaseModel):
    success: bool
    connections: List[WarehouseConnectionResponse] = Field(default_factory=list)


class WarehouseQuickConnectRequest(BaseModel):
    connector_key: str = "postgres"
    connection_uri: str = ""
    display_name: str = ""
    include_schemas: List[str] = Field(default_factory=list)
    source_timezone: str = "UTC"
    project_id: str = ""
    location: str = ""
    service_account_json: str = ""
    included_datasets: List[str] = Field(default_factory=list)
    max_billing_bytes: Optional[int] = None
    account: str = ""
    username: str = ""
    private_key_pem: str = ""
    private_key_passphrase: str = ""
    warehouse: str = ""
    database: str = ""
    role: str = ""
    included_schemas: List[str] = Field(default_factory=list)
    max_assigned_bytes: Optional[int] = None
    server_hostname: str = ""
    http_path: str = ""
    access_token: str = ""
    catalog: str = ""
    max_result_bytes: Optional[int] = None
    statement_timeout_seconds: Optional[int] = None


class WarehouseTableRequest(BaseModel):
    schema_name: str
    table_name: str
    columns: Optional[List[str]] = None


class WarehouseSampleRequest(WarehouseTableRequest):
    limit: int = Field(default=25, ge=1, le=100)


class WarehouseSampleResponse(BaseModel):
    success: bool
    columns: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)
    generated_sql: str = ""


class WarehouseSyncRequest(WarehouseTableRequest):
    project_id: Optional[str] = None
    row_limit: int = Field(default=DEFAULT_ROW_LIMIT, ge=1)


class WarehouseSyncResponse(BaseModel):
    success: bool
    message: str
    asset: AssetResponse
    row_count: int
    column_count: int
    manifest: Dict[str, Any] = Field(default_factory=dict)


class WarehouseDeleteResponse(BaseModel):
    success: bool
    message: str


@router.get(
    "/integration/warehouse/connections", response_model=WarehouseConnectionsResponse
)
async def list_warehouse_connections(user_id: str = Depends(require_user)):
    connections = warehouse_service.list_connections(user_id=user_id)
    return WarehouseConnectionsResponse(success=True, connections=connections)


@router.post(
    "/integration/warehouse/connections/quick-connect",
    response_model=WarehouseConnectionResponse,
)
async def quick_connect_warehouse(
    request: WarehouseQuickConnectRequest,
    user_id: str = Depends(require_user),
):
    return warehouse_service.create_connection(
        user_id=user_id,
        connector_key=request.connector_key,
        connection_uri=request.connection_uri,
        display_name=request.display_name,
        include_schemas=request.include_schemas,
        source_timezone=request.source_timezone,
        project_id=request.project_id,
        location=request.location,
        service_account_json=request.service_account_json,
        included_datasets=request.included_datasets or request.include_schemas,
        max_billing_bytes=request.max_billing_bytes,
        account=request.account,
        username=request.username,
        private_key_pem=request.private_key_pem,
        private_key_passphrase=request.private_key_passphrase,
        warehouse=request.warehouse,
        database=request.database,
        role=request.role,
        included_schemas=request.included_schemas or request.include_schemas,
        max_assigned_bytes=request.max_assigned_bytes,
        server_hostname=request.server_hostname,
        http_path=request.http_path,
        access_token=request.access_token,
        catalog=request.catalog,
        max_result_bytes=request.max_result_bytes,
        statement_timeout_seconds=request.statement_timeout_seconds,
    )


@router.post(
    "/integration/warehouse/connections/{connection_id}/schema/refresh",
    response_model=WarehouseConnectionResponse,
)
async def refresh_warehouse_schema(
    connection_id: str,
    user_id: str = Depends(require_user),
):
    return warehouse_service.refresh_schema(
        user_id=user_id, connection_id=connection_id
    )


@router.post(
    "/integration/warehouse/connections/{connection_id}/tables/sample",
    response_model=WarehouseSampleResponse,
)
async def sample_warehouse_table(
    connection_id: str,
    request: WarehouseSampleRequest,
    user_id: str = Depends(require_user),
):
    sample = warehouse_service.sample_table(
        user_id=user_id,
        connection_id=connection_id,
        schema_name=request.schema_name,
        table_name=request.table_name,
        columns=request.columns,
        limit=request.limit,
    )
    return WarehouseSampleResponse(success=True, **sample)


@router.post(
    "/integration/warehouse/connections/{connection_id}/sync",
    response_model=WarehouseSyncResponse,
)
async def sync_warehouse_table(
    connection_id: str,
    request: WarehouseSyncRequest,
    user_id: str = Depends(require_user),
):
    project = _ensure_project(user_id, request.project_id)
    result = warehouse_service.sync_table(
        user_id=user_id,
        connection_id=connection_id,
        schema_name=request.schema_name,
        table_name=request.table_name,
        project_id=project["project_id"],
        columns=request.columns,
        row_limit=request.row_limit,
    )
    return WarehouseSyncResponse(
        success=result.get("success", True),
        message=result.get("message", "Warehouse table synced successfully"),
        asset=_map_asset(
            result.get("asset"),
            row_count=result.get("row_count"),
            column_count=result.get("column_count"),
        ),
        row_count=result.get("row_count", 0),
        column_count=result.get("column_count", 0),
        manifest=result.get("manifest", {}),
    )


@router.delete(
    "/integration/warehouse/connections/{connection_id}",
    response_model=WarehouseDeleteResponse,
)
async def delete_warehouse_connection(
    connection_id: str,
    user_id: str = Depends(require_user),
):
    warehouse_service.remove_connection(user_id=user_id, connection_id=connection_id)
    return WarehouseDeleteResponse(
        success=True, message="Warehouse connection deleted."
    )
