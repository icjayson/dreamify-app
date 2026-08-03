"""
Admin monitoring endpoints for tracking and debugging AnalyzeCSVWorkflow LLM execution.
"""
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Optional, Any, Iterable

from boto3.dynamodb.conditions import Attr
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from clerk_backend_api import Clerk
from utils.config import config
from app.dependencies.auth import require_admin
from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables
from utils.dynamodb.repos import conversations as conversations_repo
from utils.s3.conversations import load_conversation
from utils.s3.client import download_bytes
from app.api.route_modules.conversation import DashboardDataResponse
from app.api.route_modules.user import FilePreviewResponse
from utils.dynamodb.repos import assets as assets_repo
from utils.resend_automation import provider_label
import json
import logging
import csv
import io

logger = logging.getLogger(__name__)

# Initialize Clerk client independently
clerk_client = Clerk(bearer_auth=config.clerk.CLERK_SECRET_KEY)

router = APIRouter(prefix="/admin", tags=["admin"])


class MetricsCache:
    def __init__(self, ttl_seconds=300):
        self.ttl = ttl_seconds
        self.data = None
        self.timestamp = 0

    def get(self):
        if self.data and (time.time() - self.timestamp) < self.ttl:
            return self.data
        return None

    def set(self, data):
        self.data = data
        self.timestamp = time.time()


metrics_cache = MetricsCache(ttl_seconds=300)
admin_user_state_cache = MetricsCache(ttl_seconds=300)


CONNECTOR_DISPLAY_NAMES = {
    "meta_ads": "Meta Ads",
    "facebook": "Meta Ads",
    "tiktok": "TikTok Ads",
    "google_ads": "Google Ads",
    "ga4": "GA4",
    "appsflyer": "AppsFlyer",
    "firebase": "Firebase",
    "google_sheets": "Google Sheets",
    "stripe": "Stripe",
    "hubspot": "HubSpot",
    "salesforce": "Salesforce",
    "pipedrive": "Pipedrive",
    "shopify": "Shopify",
    "supabase": "Supabase",
    "warehouse": "Data Warehouse",
    "postgres": "PostgreSQL",
    "bigquery": "BigQuery",
    "snowflake": "Snowflake",
    "databricks": "Databricks",
}

SENSITIVE_ADMIN_FIELDS = {
    "access_token",
    "refresh_token",
    "bot_token_encrypted",
    "client_secret",
    "code_verifier",
    "private_key",
}


class AdminUserProjectItem(BaseModel):
    project_id: str
    name: str = ""
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None
    dashboard_preview_key: Optional[str] = None
    source_type: Optional[str] = None


class AdminUserDashboardItem(BaseModel):
    dashboard_id: str
    project_id: str
    conversation_id: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    s3_bucket: Optional[str] = None
    s3_key: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdminUserAssetItem(BaseModel):
    asset_id: str
    file_id: Optional[str] = None
    project_id: Optional[str] = None
    filename: str = ""
    extension: str = ""
    asset_type: str = ""
    status: str = ""
    size_bytes: int = 0
    created_at: Optional[str] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None


class AdminUserEntityItem(BaseModel):
    provider: str
    display_name: str
    id: str
    name: str = ""
    type: Optional[str] = None
    raw: Dict[str, Any] = {}


class AdminUserConnectorItem(BaseModel):
    provider: str
    display_name: str
    connected: bool = False
    entity_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    selected_entities: List[AdminUserEntityItem] = []
    raw: Dict[str, Any] = {}


class AdminUserWorkspaceItem(BaseModel):
    platform_workspace_id: str
    platform: str = ""
    workspace_name: str = ""
    project_id: Optional[str] = None
    language: Optional[str] = None
    created_at: Optional[str] = None
    raw: Dict[str, Any] = {}


class AdminUserConversationItem(BaseModel):
    conversation_id: str
    project_id: str
    title: str = "Conversation"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    total_tokens: int = 0
    chat_mode: Optional[str] = None
    model: Optional[str] = None


class AdminUserListItem(BaseModel):
    uid: str
    mail: Optional[str] = None
    name: str = ""
    has_dashboard: bool = False
    workspace_platform: str = ""
    workspace_platforms: List[str] = []
    has_workspace: bool = False
    has_connector: bool = False
    dashboard_count: int = 0
    project_count: int = 0
    file_upload_count: int = 0
    connector_count: int = 0
    connected_connectors: List[str] = []
    connector_entity_count: int = 0
    workspace_count: int = 0
    connected_workspaces: List[str] = []
    token_burned: int = 0
    signup_date: Optional[str] = None
    latest_signin_date: Optional[str] = None


class AdminUserListResponse(BaseModel):
    users: List[AdminUserListItem]
    total: int
    page: int
    page_size: int


class AdminUserDetailResponse(BaseModel):
    user: AdminUserListItem
    projects: List[AdminUserProjectItem] = []
    dashboards: List[AdminUserDashboardItem] = []
    files: List[AdminUserAssetItem] = []
    connectors: List[AdminUserConnectorItem] = []
    entities: List[AdminUserEntityItem] = []
    workspaces: List[AdminUserWorkspaceItem] = []
    conversations: List[AdminUserConversationItem] = []


def _active_clerk_client() -> Clerk:
    """Use the live Clerk instance for admin user inventory when configured."""
    live_key = getattr(config.clerk, "CLERK_LIVE_SECRET_KEY", None)
    if live_key:
        return Clerk(bearer_auth=live_key)
    return clerk_client


def _get_attr(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _timestamp_to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, (int, float, Decimal)):
        numeric = float(value)
        if numeric > 10_000_000_000:
            numeric = numeric / 1000
        return datetime.fromtimestamp(numeric, tz=timezone.utc).isoformat()
    text = str(value).strip()
    return text or None


def _decimal_to_native(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [_decimal_to_native(v) for v in value]
    if isinstance(value, dict):
        return {k: _decimal_to_native(v) for k, v in value.items()}
    return value


def _strip_sensitive(item: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {}
    for key, value in item.items():
        if key in SENSITIVE_ADMIN_FIELDS or key.endswith("_token"):
            continue
        cleaned[key] = _decimal_to_native(value)
    return cleaned


def _primary_email_from_clerk(user: Any) -> Optional[str]:
    emails = list(_get_attr(user, "email_addresses", []) or [])
    if not emails:
        return None
    primary_id = _get_attr(user, "primary_email_address_id")
    if primary_id:
        for email_obj in emails:
            if _get_attr(email_obj, "id") == primary_id:
                return _get_attr(email_obj, "email_address")
    return _get_attr(emails[0], "email_address")


def _name_from_clerk(user: Any) -> str:
    first = _get_attr(user, "first_name") or ""
    last = _get_attr(user, "last_name") or ""
    full_name = " ".join(part for part in [first, last] if part).strip()
    return full_name or _get_attr(user, "username") or _get_attr(user, "id") or ""


def _iter_clerk_users(page_size: int = 100) -> Iterable[Any]:
    client = _active_clerk_client()
    offset = 0
    while True:
        batch = list(client.users.list(request={"limit": page_size, "offset": offset}))
        if not batch:
            break
        yield from batch
        if len(batch) < page_size:
            break
        offset += page_size


def _get_clerk_user(user_id: str) -> Any:
    try:
        return _active_clerk_client().users.get(user_id=user_id)
    except Exception:
        return clerk_client.users.get(user_id=user_id)


def _scan_all_items(table_name: str) -> List[Dict[str, Any]]:
    table = get_table(table_name)
    items: List[Dict[str, Any]] = []
    kwargs: Dict[str, Any] = {}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key
    return items


def _is_real_workspace(item: Dict[str, Any]) -> bool:
    platform = str(item.get("platform", ""))
    workspace_id = str(item.get("platform_workspace_id", ""))
    return (
        "pending" not in platform
        and not workspace_id.startswith("zalo_upload")
        and item.get("target_workspace_id") is None
    )


def _connector_display_name(provider: str) -> str:
    return CONNECTOR_DISPLAY_NAMES.get(provider, provider_label(provider))


def _connected_connector_names(connections: List[Dict[str, Any]]) -> List[str]:
    names = set()
    for connection in connections:
        provider = str(connection.get("provider", ""))
        entities = connection.get("selected_entities") or []
        if provider == "warehouse" and isinstance(entities, list):
            for entity in entities:
                if not isinstance(entity, dict):
                    continue
                connector_key = str(entity.get("connector_key") or "")
                if connector_key:
                    names.add(_connector_display_name(connector_key))
            if names:
                continue
        if provider:
            names.add(_connector_display_name(provider))
    return sorted(names)


def _dashboard_item_from_project(project: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    dashboard_id = project.get("latest_dashboard_id")
    if not dashboard_id:
        return None
    return {
        "dashboard_id": dashboard_id,
        "project_id": project.get("project_id", ""),
        "conversation_id": project.get("latest_conversation_id"),
        "title": project.get("dashboard_title"),
        "status": "ready",
        "s3_bucket": None,
        "s3_key": None,
        "created_at": project.get("updated_at") or project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }


def _build_admin_user_state() -> Dict[str, Dict[str, Any]]:
    cached = admin_user_state_cache.get()
    if cached:
        return cached

    state: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "projects": [],
            "dashboards": [],
            "files": [],
            "connectors": [],
            "entities": [],
            "workspaces": [],
            "conversations": [],
            "token_burned": 0,
        }
    )

    for project in _scan_all_items(tables.projects):
        user_id = project.get("user_id")
        if not user_id:
            continue
        state[user_id]["projects"].append(project)

    dashboard_keys = set()
    try:
        dashboard_rows = _scan_all_items(tables.dashboards)
    except Exception as exc:
        logger.warning("Failed to scan dashboards table for admin users: %s", exc)
        dashboard_rows = []
    for dashboard in dashboard_rows:
        user_id = dashboard.get("user_id")
        project_id = dashboard.get("project_id", "")
        dashboard_id = dashboard.get("dashboard_id", "")
        if not user_id or not dashboard_id:
            continue
        dashboard_keys.add((project_id, dashboard_id))
        state[user_id]["dashboards"].append(dashboard)

    for user_id, bucket in state.items():
        for project in bucket["projects"]:
            fallback = _dashboard_item_from_project(project)
            if not fallback:
                continue
            key = (fallback["project_id"], fallback["dashboard_id"])
            if key not in dashboard_keys:
                bucket["dashboards"].append(fallback)
                dashboard_keys.add(key)

    for asset in _scan_all_items(tables.assets):
        user_id = asset.get("user_id")
        if user_id:
            state[user_id]["files"].append(asset)

    for connection in _scan_all_items(tables.connected_accounts):
        user_id = connection.get("user_id")
        provider = connection.get("provider")
        if not user_id or not provider:
            continue
        entities = connection.get("selected_entities") or []
        if not isinstance(entities, list):
            entities = []
        state[user_id]["connectors"].append(connection)
        for entity in entities:
            if not isinstance(entity, dict):
                continue
            normalized = {
                "provider": provider,
                "display_name": _connector_display_name(provider),
                "id": str(entity.get("id", "")),
                "name": str(entity.get("name", "")),
                "type": entity.get("type"),
                "raw": _strip_sensitive(entity),
            }
            state[user_id]["entities"].append(normalized)

    for workspace in _scan_all_items(tables.chat_workspaces):
        user_id = workspace.get("user_id")
        if user_id and _is_real_workspace(workspace):
            state[user_id]["workspaces"].append(workspace)

    for conversation in _scan_all_items(tables.conversations):
        user_id = conversation.get("user_id")
        if not user_id:
            continue
        metadata = conversation.get("metadata") or {}
        total_tokens = int(metadata.get("total_tokens") or 0)
        state[user_id]["token_burned"] += total_tokens
        state[user_id]["conversations"].append(conversation)

    for bucket in state.values():
        bucket["projects"].sort(
            key=lambda item: item.get("updated_at") or item.get("created_at") or "",
            reverse=True,
        )
        bucket["dashboards"].sort(
            key=lambda item: item.get("updated_at") or item.get("created_at") or "",
            reverse=True,
        )
        bucket["files"].sort(key=lambda item: item.get("created_at") or "", reverse=True)
        bucket["workspaces"].sort(
            key=lambda item: item.get("created_at") or "", reverse=True
        )
        bucket["conversations"].sort(
            key=lambda item: item.get("updated_at") or item.get("created_at") or "",
            reverse=True,
        )

    admin_user_state_cache.set(state)
    return state


def _admin_user_summary(user: Any, state: Dict[str, Dict[str, Any]]) -> AdminUserListItem:
    user_id = _get_attr(user, "id") or ""
    bucket = state.get(user_id, {})
    projects = bucket.get("projects", [])
    dashboards = bucket.get("dashboards", [])
    files = bucket.get("files", [])
    connectors = bucket.get("connectors", [])
    entities = bucket.get("entities", [])
    workspaces = bucket.get("workspaces", [])
    platforms = sorted({str(w.get("platform", "")) for w in workspaces if w.get("platform")})
    connected_connectors = _connected_connector_names(connectors)
    connected_workspaces = [
        w.get("workspace_name") or w.get("platform_workspace_id", "")
        for w in workspaces
    ]

    return AdminUserListItem(
        uid=user_id,
        mail=_primary_email_from_clerk(user),
        name=_name_from_clerk(user),
        has_dashboard=bool(dashboards),
        workspace_platform=", ".join(platforms),
        workspace_platforms=platforms,
        has_workspace=bool(workspaces),
        has_connector=bool(entities),
        dashboard_count=len(dashboards),
        project_count=len(projects),
        file_upload_count=len(files),
        connector_count=len(connected_connectors),
        connected_connectors=connected_connectors,
        connector_entity_count=len(entities),
        workspace_count=len(workspaces),
        connected_workspaces=connected_workspaces,
        token_burned=int(bucket.get("token_burned") or 0),
        signup_date=_timestamp_to_iso(_get_attr(user, "created_at")),
        latest_signin_date=_timestamp_to_iso(
            _get_attr(user, "last_sign_in_at")
            or _get_attr(user, "last_active_at")
        ),
    )


def _matches_user_query(item: AdminUserListItem, query: str) -> bool:
    q = query.strip().lower()
    if not q:
        return True
    haystack = " ".join(
        [
            item.uid,
            item.mail or "",
            item.name or "",
            item.workspace_platform or "",
            " ".join(item.connected_connectors),
        ]
    ).lower()
    return q in haystack


def _map_admin_project(item: Dict[str, Any]) -> AdminUserProjectItem:
    return AdminUserProjectItem(
        project_id=str(item.get("project_id", "")),
        name=str(item.get("name", "")),
        description=item.get("description"),
        created_at=item.get("created_at"),
        updated_at=item.get("updated_at"),
        latest_conversation_id=item.get("latest_conversation_id"),
        latest_dashboard_id=item.get("latest_dashboard_id"),
        dashboard_title=item.get("dashboard_title"),
        dashboard_preview_key=item.get("dashboard_preview_key"),
        source_type=item.get("source_type"),
    )


def _map_admin_dashboard(item: Dict[str, Any]) -> AdminUserDashboardItem:
    metadata = item.get("metadata") or {}
    title = (
        item.get("title")
        or item.get("dashboard_title")
        or metadata.get("title")
        or metadata.get("dashboard_title")
    )
    return AdminUserDashboardItem(
        dashboard_id=str(item.get("dashboard_id", "")),
        project_id=str(item.get("project_id", "")),
        conversation_id=item.get("conversation_id"),
        title=title,
        status=item.get("status"),
        s3_bucket=item.get("s3_bucket"),
        s3_key=item.get("s3_key"),
        created_at=item.get("created_at"),
        updated_at=item.get("updated_at"),
    )


def _map_admin_asset(item: Dict[str, Any]) -> AdminUserAssetItem:
    return AdminUserAssetItem(
        asset_id=str(item.get("asset_id", "")),
        file_id=item.get("file_id"),
        project_id=item.get("project_id"),
        filename=str(item.get("filename", "")),
        extension=str(item.get("extension", "")),
        asset_type=str(item.get("asset_type", "")),
        status=str(item.get("status", "")),
        size_bytes=int(item.get("size_bytes") or 0),
        created_at=item.get("created_at"),
        row_count=item.get("row_count"),
        column_count=item.get("column_count"),
    )


def _map_admin_entity(provider: str, entity: Dict[str, Any]) -> AdminUserEntityItem:
    return AdminUserEntityItem(
        provider=provider,
        display_name=_connector_display_name(provider),
        id=str(entity.get("id", "")),
        name=str(entity.get("name", "")),
        type=entity.get("type"),
        raw=_strip_sensitive(entity),
    )


def _map_admin_connector(item: Dict[str, Any]) -> AdminUserConnectorItem:
    provider = str(item.get("provider", ""))
    entities = item.get("selected_entities") or []
    if not isinstance(entities, list):
        entities = []
    return AdminUserConnectorItem(
        provider=provider,
        display_name=_connector_display_name(provider),
        connected=bool(entities or item.get("access_token")),
        entity_count=len(entities),
        created_at=item.get("created_at"),
        updated_at=item.get("updated_at"),
        selected_entities=[
            _map_admin_entity(provider, entity)
            for entity in entities
            if isinstance(entity, dict)
        ],
        raw=_strip_sensitive(item),
    )


def _map_admin_workspace(item: Dict[str, Any]) -> AdminUserWorkspaceItem:
    return AdminUserWorkspaceItem(
        platform_workspace_id=str(item.get("platform_workspace_id", "")),
        platform=str(item.get("platform", "")),
        workspace_name=str(item.get("workspace_name", "")),
        project_id=item.get("project_id"),
        language=item.get("language"),
        created_at=item.get("created_at"),
        raw=_strip_sensitive(item),
    )


def _map_admin_conversation(item: Dict[str, Any]) -> AdminUserConversationItem:
    metadata = item.get("metadata") or {}
    return AdminUserConversationItem(
        conversation_id=str(item.get("conversation_id", "")),
        project_id=str(item.get("project_id", "")),
        title=str(item.get("title") or "Conversation"),
        created_at=item.get("created_at"),
        updated_at=item.get("updated_at"),
        total_tokens=int(metadata.get("total_tokens") or 0),
        chat_mode=metadata.get("chat_mode"),
        model=metadata.get("resolved_model"),
    )


@router.get("/users", response_model=AdminUserListResponse)
async def list_admin_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    query: str = Query("", description="Search by uid, email, name, connector, workspace platform"),
    has_dashboard: Optional[bool] = Query(None),
    has_workspace: Optional[bool] = Query(None),
    has_connector: Optional[bool] = Query(None),
    sort_by: str = Query(
        "signup_date",
        description="signup_date, token_burned, dashboard_count, project_count, file_upload_count",
    ),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    _: dict = Depends(require_admin),
):
    """List Clerk users enriched with existing product state for the admin Users tab."""
    try:
        state = _build_admin_user_state()
        users = [_admin_user_summary(user, state) for user in _iter_clerk_users()]

        if query:
            users = [item for item in users if _matches_user_query(item, query)]
        if has_dashboard is not None:
            users = [item for item in users if item.has_dashboard == has_dashboard]
        if has_workspace is not None:
            users = [item for item in users if item.has_workspace == has_workspace]
        if has_connector is not None:
            users = [item for item in users if item.has_connector == has_connector]

        sort_key_map = {
            "uid": lambda item: item.uid.lower(),
            "mail": lambda item: (item.mail or "").lower(),
            "name": lambda item: (item.name or "").lower(),
            "has_dashboard": lambda item: int(item.has_dashboard),
            "workspace_platform": lambda item: item.workspace_platform.lower(),
            "has_workspace": lambda item: int(item.has_workspace),
            "has_connector": lambda item: int(item.has_connector),
            "signup_date": lambda item: item.signup_date or "",
            "latest_signin_date": lambda item: item.latest_signin_date or "",
            "token_burned": lambda item: item.token_burned,
            "dashboard_count": lambda item: item.dashboard_count,
            "project_count": lambda item: item.project_count,
            "file_upload_count": lambda item: item.file_upload_count,
            "connector_count": lambda item: item.connector_count,
            "connected_connectors": lambda item: ", ".join(item.connected_connectors).lower(),
            "connector_entity_count": lambda item: item.connector_entity_count,
            "workspace_count": lambda item: item.workspace_count,
            "connected_workspaces": lambda item: ", ".join(item.connected_workspaces).lower(),
        }
        key_fn = sort_key_map.get(sort_by, sort_key_map["signup_date"])
        users.sort(key=key_fn, reverse=(sort_dir == "desc"))

        total = len(users)
        start = (page - 1) * page_size
        end = start + page_size
        return AdminUserListResponse(
            users=users[start:end],
            total=total,
            page=page,
            page_size=page_size,
        )
    except Exception as e:
        logger.error("Failed to list admin users: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list users: {str(e)}")


@router.get("/users/{user_id}", response_model=AdminUserDetailResponse)
async def get_admin_user_detail(
    user_id: str,
    _: dict = Depends(require_admin),
):
    """Return full project/dashboard/file/connector/entity/workspace lists for one user."""
    try:
        state = _build_admin_user_state()
        clerk_user = _get_clerk_user(user_id)
        summary = _admin_user_summary(clerk_user, state)
        bucket = state.get(user_id, {})
        connectors = [_map_admin_connector(item) for item in bucket.get("connectors", [])]
        entities: List[AdminUserEntityItem] = []
        for connector in connectors:
            entities.extend(connector.selected_entities)

        return AdminUserDetailResponse(
            user=summary,
            projects=[_map_admin_project(item) for item in bucket.get("projects", [])],
            dashboards=[
                _map_admin_dashboard(item)
                for item in bucket.get("dashboards", [])
                if item.get("dashboard_id")
            ],
            files=[_map_admin_asset(item) for item in bucket.get("files", [])],
            connectors=connectors,
            entities=entities,
            workspaces=[
                _map_admin_workspace(item) for item in bucket.get("workspaces", [])
            ],
            conversations=[
                _map_admin_conversation(item)
                for item in bucket.get("conversations", [])
            ],
        )
    except Exception as e:
        logger.error("Failed to load admin user detail for %s: %s", user_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to load user detail: {str(e)}")


@router.get("/metrics")
async def get_admin_metrics(
    _: dict = Depends(require_admin),
):
    """
    Get high-level dashboard metrics directly from DynamoDB.
    Results are cached in memory for 5 minutes.
    """
    cached = metrics_cache.get()
    if cached:
        return cached

    try:
        total_unique_users = set()
        total_conversations = 0
        total_messages = 0
        total_tokens = 0
        mode_distribution = {}
        model_distribution = {}
        
        last_key = None
        while True:
            result = conversations_repo.scan_all_conversations(limit=1000, last_evaluated_key=last_key)
            items = result.get("Items", [])
            for item in items:
                total_conversations += 1
                if "user_id" in item:
                    total_unique_users.add(item["user_id"])
                
                node_count = item.get("node_count")
                if node_count is not None:
                    total_messages += int(node_count)
                else:
                    total_messages += 2
                    
                metadata = item.get("metadata", {})
                tokens = metadata.get("total_tokens", 0)
                if tokens:
                    total_tokens += tokens
                
                mode = metadata.get("chat_mode", "standard") or "standard"
                mode_distribution[mode] = mode_distribution.get(mode, 0) + 1
                
                model = metadata.get("resolved_model", "unknown") or "unknown"
                model_distribution[model] = model_distribution.get(model, 0) + 1
            
            last_key = result.get("LastEvaluatedKey")
            if not last_key:
                break
                
        table = get_table(tables.workflow_status)
        completed = 0
        errors = 0
        
        last_status_key = None
        while True:
            status_kwargs = {
                "Limit": 1000,
                "FilterExpression": Attr("node_id").eq("workflow"),
                "ProjectionExpression": "#st",
                "ExpressionAttributeNames": {"#st": "status"}
            }
            if last_status_key:
                status_kwargs["ExclusiveStartKey"] = last_status_key
                
            resp = table.scan(**status_kwargs)
            for item in resp.get("Items", []):
                s = item.get("status")
                if s == "completed":
                    completed += 1
                elif s == "error":
                    errors += 1
            
            last_status_key = resp.get("LastEvaluatedKey")
            if not last_status_key:
                break
                
        total_runs = completed + errors
        success_rate = (completed / total_runs * 100) if total_runs > 0 else 100.0
        
        total_users_count = len(total_unique_users)
        avg_msgs = (total_messages / total_users_count) if total_users_count > 0 else 0.0
        
        metrics = {
            "total_users": total_users_count,
            "total_conversations": total_conversations,
            "total_messages": total_messages,
            "avg_msgs_per_user": round(avg_msgs, 1),
            "success_rate": round(success_rate, 1),
            "total_tokens": total_tokens,
            "mode_distribution": mode_distribution,
            "model_distribution": model_distribution
        }
        metrics_cache.set(metrics)
        return metrics
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate metrics: {str(e)}")


timeseries_cache = MetricsCache(ttl_seconds=300)

@router.get("/metrics/timeseries")
async def get_admin_metrics_timeseries(
    days: int = Query(30, ge=1, le=90),
    _: dict = Depends(require_admin),
):
    """
    Get time-series metrics for the last N days.
    """
    cache_key = f"timeseries_v3_{days}"
    
    # We cheat the MetricsCache by storing a dict of cache keys inside
    cached_data = timeseries_cache.get()
    if cached_data and cache_key in cached_data:
        return cached_data[cache_key]

    try:
        start_date = datetime.now(timezone.utc) - timedelta(days=days)
        start_date_iso = start_date.isoformat()
        
        # Initialize buckets
        buckets = {}
        for i in range(days):
            d = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
            buckets[d] = {
                "date": d,
                "messages": 0,
                "conversations": 0,
                "users_set": set(),
                "active_users": 0,
                "tokens": 0,
                "modes": {},
                "models": {},
                "tokens_by_model": {}
            }
            
        last_key = None
        while True:
            result = conversations_repo.scan_recent_conversations(
                start_date_iso=start_date_iso, 
                limit=1000, 
                last_evaluated_key=last_key
            )
            for item in result.get("Items", []):
                created_at = item.get("created_at", "")
                if len(created_at) >= 10:
                    date_prefix = created_at[:10]
                    if date_prefix in buckets:
                        buckets[date_prefix]["conversations"] += 1
                        
                        node_count = item.get("node_count")
                        if node_count is not None:
                            buckets[date_prefix]["messages"] += int(node_count)
                        else:
                            buckets[date_prefix]["messages"] += 2
                            
                        if "user_id" in item:
                            buckets[date_prefix]["users_set"].add(item["user_id"])
                            
                        metadata = item.get("metadata", {})
                        tokens = metadata.get("total_tokens", 0)
                        if tokens:
                            buckets[date_prefix]["tokens"] += tokens
                            
                        mode = metadata.get("chat_mode", "standard") or "standard"
                        buckets[date_prefix]["modes"][mode] = buckets[date_prefix]["modes"].get(mode, 0) + 1
                        
                        model = metadata.get("resolved_model", "unknown") or "unknown"
                        buckets[date_prefix]["models"][model] = buckets[date_prefix]["models"].get(model, 0) + 1
                        
                        if tokens:
                            buckets[date_prefix]["tokens_by_model"][model] = buckets[date_prefix]["tokens_by_model"].get(model, 0) + tokens
            
            last_key = result.get("LastEvaluatedKey")
            if not last_key:
                break
                
        # Format output
        output = []
        # Sort keys chronologically (oldest to newest)
        for d in sorted(buckets.keys()):
            bucket = buckets[d]
            bucket["active_users"] = len(bucket["users_set"])
            del bucket["users_set"]
            output.append(bucket)
            
        # Save to cache
        current_cache = timeseries_cache.get() or {}
        current_cache[cache_key] = output
        timeseries_cache.set(current_cache)
        
        return output
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate time-series: {str(e)}")


class ConversationListItem(BaseModel):
    """Conversation metadata for list view."""
    conversation_id: str
    project_id: str
    user_id: str
    user_name: Optional[str] = None
    user_avatar: Optional[str] = None
    title: str
    created_at: str
    updated_at: str
    s3_bucket: Optional[str] = None
    s3_key: Optional[str] = None
    chat_mode: Optional[str] = None
    model: Optional[str] = None
    total_tokens: Optional[int] = None


class ConversationDetailResponse(BaseModel):
    """Full conversation JSON response."""
    conversation: Dict[str, Any]


class NodeListResponse(BaseModel):
    """Nodes array response."""
    nodes: List[Dict[str, Any]]


class ConversationListResponse(BaseModel):
    """List of conversations with pagination."""
    conversations: List[ConversationListItem]
    total: int
    last_key: Optional[str] = None


@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations(
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Number of results per page"),
    _: dict = Depends(require_admin),
):
    """
    List all conversations or filter by project_id with pagination.
    
    Returns conversation metadata for tracking and debugging.
    """
    try:
        # Get all conversations (we'll paginate in memory for simplicity)
        all_items = []
        
        if project_id:
            # Filter by project_id - get all matching items
            all_items = conversations_repo.scan_conversations_by_project(project_id, limit=None)
        else:
            # Get all conversations using paginated scan
            all_items = []
            last_key = None
            while True:
                result = conversations_repo.scan_all_conversations(limit=1000, last_evaluated_key=last_key)
                items = result.get("Items", [])
                all_items.extend(items)
                last_key = result.get("LastEvaluatedKey")
                if not last_key:
                    break
        
        # Sort by created_at descending
        all_items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        # Calculate pagination
        total = len(all_items)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = all_items[start_idx:end_idx]
        # Collect unique user IDs from current page
        unique_user_ids = list(set(item.get("user_id") for item in paginated_items if item.get("user_id")))
        user_metadata_map = {}
        
        # Fetch user profiles from Clerk if there are any users
        if unique_user_ids:
            try:
                clerk_users = clerk_client.users.list(request={"user_id": unique_user_ids})
                found_ids = []
                for u in clerk_users:
                    found_ids.append(u.id)
                    name_parts = filter(None, [u.first_name, u.last_name])
                    full_name = " ".join(name_parts)
                    user_metadata_map[u.id] = {
                        "name": full_name if full_name else (u.username if u.username else u.id),
                        "avatar": u.image_url
                    }
                
                # Check for missing users and try fallback instance if available
                missing_ids = list(set(unique_user_ids) - set(found_ids))
                if missing_ids and config.clerk.CLERK_LIVE_SECRET_KEY:
                    logger.info(f"Attempting fallback fetch for {len(missing_ids)} missing users from Live instance")
                    try:
                        clerk_live = Clerk(bearer_auth=config.clerk.CLERK_LIVE_SECRET_KEY)
                        live_users = clerk_live.users.list(request={"user_id": missing_ids})
                        for u in live_users:
                            found_ids.append(u.id)
                            name_parts = filter(None, [u.first_name, u.last_name])
                            full_name = " ".join(name_parts)
                            user_metadata_map[u.id] = {
                                "name": full_name if full_name else (u.username if u.username else u.id),
                                "avatar": u.image_url
                            }
                    except Exception as live_e:
                        logger.warning(f"Fallback Clerk fetch failed: {live_e}")

                # Final diagnostic log
                final_missing = set(unique_user_ids) - set(found_ids)
                if final_missing:
                    logger.warning(f"Clerk metadata still missing for {len(final_missing)} users after fallback attempt: {list(final_missing)}")
                else:
                    logger.info(f"Successfully resolved all {len(unique_user_ids)} user IDs")
                    
            except Exception as e:
                # Log error but don't fail the request (metadata will just be empty)
                logger.error(f"Failed to fetch Clerk user metadata: {str(e)}", exc_info=True)
        
        conversations = [
            ConversationListItem(
                conversation_id=item.get("conversation_id", ""),
                project_id=item.get("project_id", ""),
                user_id=item.get("user_id", ""),
                user_name=user_metadata_map.get(item.get("user_id"), {}).get("name"),
                user_avatar=user_metadata_map.get(item.get("user_id"), {}).get("avatar"),
                title=item.get("title", "Conversation"),
                created_at=item.get("created_at", ""),
                updated_at=item.get("updated_at", ""),
                s3_bucket=item.get("s3_bucket"),
                s3_key=item.get("s3_key"),
                chat_mode=item.get("metadata", {}).get("chat_mode"),
                model=item.get("metadata", {}).get("resolved_model"),
                total_tokens=item.get("metadata", {}).get("total_tokens"),
            )
            for item in paginated_items
        ]
        
        return ConversationListResponse(
            conversations=conversations,
            total=total,
            last_key=None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list conversations: {str(e)}")


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation_by_id(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID (required to get conversation from DynamoDB)"),
    _: dict = Depends(require_admin),
):
    """
    Get full conversation JSON by conversation_id.
    
    Loads the complete conversation data from S3 for tracking and debugging.
    """
    try:
        # Get conversation metadata from DynamoDB
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Load full conversation JSON from S3
        s3_bucket = conversation_meta.get("s3_bucket")
        s3_key = conversation_meta.get("s3_key")
        
        if not s3_bucket or not s3_key:
            raise HTTPException(status_code=404, detail="Conversation S3 location not found")
        
        conversation = load_conversation(s3_bucket, s3_key)
        
        return ConversationDetailResponse(conversation=conversation)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load conversation: {str(e)}")


@router.get("/conversations/{conversation_id}/nodes", response_model=NodeListResponse)
async def get_conversation_nodes(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID (required to get conversation from DynamoDB)"),
    _: dict = Depends(require_admin),
):
    """
    Get conversation nodes array.
    
    Returns the nodes array from the conversation JSON showing the full conversation flow.
    """
    try:
        # Get conversation metadata from DynamoDB
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Load full conversation JSON from S3
        s3_bucket = conversation_meta.get("s3_bucket")
        s3_key = conversation_meta.get("s3_key")
        
        if not s3_bucket or not s3_key:
            raise HTTPException(status_code=404, detail="Conversation S3 location not found")
        
        conversation = load_conversation(s3_bucket, s3_key)
        
        # Extract nodes array
        nodes = conversation.get("nodes", [])
        
        return NodeListResponse(nodes=nodes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load conversation nodes: {str(e)}")


@router.get("/conversations/{conversation_id}/dashboard", response_model=DashboardDataResponse)
async def get_conversation_dashboard(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID"),
    dashboard_id: Optional[str] = Query(None, description="Specific dashboard ID to fetch"),
    _: dict = Depends(require_admin),
):
    """Get dashboard data from a specific dashboard or the latest dashboard in conversation for Admin."""
    logger.info(
        "Admin fetching dashboard for conversation: project_id=%s, conversation_id=%s, dashboard_id=%s",
        project_id,
        conversation_id,
        dashboard_id,
    )

    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        logger.warning(
            "Conversation not found for dashboard request: project_id=%s, conversation_id=%s",
            project_id,
            conversation_id,
        )
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)
    
    # Get dashboards list
    dashboards = conversation.get("dashboards", [])
    if not dashboards:
        logger.info(
            "No dashboards present in conversation: project_id=%s, conversation_id=%s",
            project_id,
            conversation_id,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    
    # Select specific dashboard if ID provided, otherwise get latest
    if dashboard_id:
        target_dashboard = next((d for d in dashboards if d.get("dashboard_id") == dashboard_id), None)
        if not target_dashboard:
            logger.warning(
                "Dashboard not found: project_id=%s, conversation_id=%s, dashboard_id=%s",
                project_id,
                conversation_id,
                dashboard_id,
            )
            raise HTTPException(status_code=404, detail=f"Dashboard {dashboard_id} not found")
    else:
        target_dashboard = dashboards[-1]
    
    dash_id = target_dashboard.get("dashboard_id")
    s3_uri = target_dashboard.get("s3_uri")
    
    if not dash_id or not s3_uri:
        logger.warning(
            "Dashboard metadata incomplete for conversation: project_id=%s, conversation_id=%s, dashboard=%s",
            project_id,
            conversation_id,
            target_dashboard,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    
    # Parse s3://bucket/key format
    if not s3_uri.startswith("s3://"):
        logger.error(
            "Invalid S3 URI format for dashboard: project_id=%s, conversation_id=%s, dashboard_id=%s, s3_uri=%s",
            project_id,
            conversation_id,
            dash_id,
            s3_uri,
        )
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        logger.error(
            "Invalid S3 URI format (missing key) for dashboard: project_id=%s, conversation_id=%s, dashboard_id=%s, s3_uri=%s",
            project_id,
            conversation_id,
            dash_id,
            s3_uri,
        )
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
    bucket = uri_parts[0]
    key = uri_parts[1].lstrip("/")
    
    try:
        dashboard_bytes = download_bytes(bucket, key)
        dashboard_data = json.loads(dashboard_bytes.decode("utf-8"))
        
        logger.info(
            "Successfully loaded dashboard from S3: bucket=%s, key=%s, dashboard_id=%s",
            bucket,
            key,
            dash_id,
        )

        return DashboardDataResponse(
            dashboard_id=dash_id,
            dashboard_data=dashboard_data,
        )
    except FileNotFoundError:
        logger.warning(
            "Dashboard data not found in S3, treating as no dashboard yet: bucket=%s, key=%s, dashboard_id=%s",
            bucket,
            key,
            dash_id,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)

@router.get("/conversations/{conversation_id}/assets/{asset_id}/preview", response_model=FilePreviewResponse)
async def get_conversation_asset_preview(
    conversation_id: str,
    asset_id: str,
    project_id: str = Query(..., description="Project ID"),
    _: dict = Depends(require_admin),
):
    """Preview CSV file data as JSON for Admin."""
    try:
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        user_id = conversation_meta.get("user_id")
        if not user_id:
            raise HTTPException(status_code=404, detail="User ID not found in conversation")

        # Get asset
        asset = assets_repo.get_asset(user_id, asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")
        
        # Check if file is CSV
        extension = asset.get("extension", "").lower()
        if extension != "csv":
            raise HTTPException(status_code=400, detail="Preview only supported for CSV files")
        
        # Download file from S3
        try:
            file_data = download_bytes(asset["s3_bucket"], asset["s3_key"])
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found in storage")
        
        # Parse CSV
        try:
            # Try different encodings
            encodings = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']
            content_str = None
            for encoding in encodings:
                try:
                    content_str = file_data.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            
            if content_str is None:
                raise HTTPException(status_code=500, detail="Could not decode file with any encoding")
            
            # Parse CSV with proper handling of quoted fields
            csv_reader = csv.reader(io.StringIO(content_str))
            rows = []
            total_rows = 0
            max_display_rows = 1000
            
            for row in csv_reader:
                total_rows += 1
                if total_rows <= max_display_rows:
                    rows.append(row)
            
            if len(rows) == 0:
                raise HTTPException(status_code=400, detail="CSV file is empty")
            
            # First row is headers
            columns = rows[0] if rows else []
            data_rows = rows[1:] if len(rows) > 1 else []
            
            filename = asset.get("filename", "file.csv")
            
            return FilePreviewResponse(
                success=True,
                filename=filename,
                columns=columns,
                rows=data_rows,
                total_rows=max(0, total_rows - 1),  # Exclude header
                displayed_rows=len(data_rows)
            )
            
        except csv.Error as e:
            raise HTTPException(status_code=500, detail=f"CSV parsing error: {str(e)}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
