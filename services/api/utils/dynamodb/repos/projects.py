"""
DynamoDB repository for project entities.
"""

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
import logging

from boto3.dynamodb.conditions import Key, Attr  # type: ignore
from botocore.exceptions import ClientError  # type: ignore

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables

logger = logging.getLogger(__name__)

RECENT_PROJECTS_INDEX = "user_id_updated_at_index"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_project(
    user_id: str,
    name: str,
    description: Optional[str] = None,
    allowed: Optional[List[Dict]] = None,
    name_source: str = "generated",
) -> Dict:
    table = get_table(tables.projects)
    project_id = str(uuid.uuid4())
    item = {
        "user_id": user_id,
        "project_id": project_id,
        "name": name,
        "name_source": name_source,
        "description": description or "",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "latest_conversation_id": None,
        "latest_dashboard_id": None,
        "dashboard_title": None,
        "dashboard_preview_key": None,
        "is_preview_public": False,
        "allowed": allowed or [],
    }
    table.put_item(Item=item)
    return item


def list_projects(user_id: str) -> List[Dict]:
    """Return ALL of a user's projects, newest-first.

    Paginates through DynamoDB (a single query returns at most 1MB), then sorts
    by updated_at/created_at so callers like the workspace sidebar get a true
    recent-first list rather than project_id (UUID) order.
    """
    table = get_table(tables.projects)
    items: List[Dict] = []
    last_key = None
    while True:
        kwargs: Dict = {"KeyConditionExpression": Key("user_id").eq(user_id)}
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
    return _sort_recent_projects(items)


def _project_timestamp(item: Dict) -> float:
    value = item.get("updated_at") or item.get("created_at")
    if not value:
        return 0
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def _sort_recent_projects(items: List[Dict]) -> List[Dict]:
    return sorted(items, key=_project_timestamp, reverse=True)


def _can_fallback_from_index_error(exc: ClientError) -> bool:
    error = exc.response.get("Error", {})
    code = error.get("Code", "")
    message = error.get("Message", "").lower()
    return (
        code in {"ValidationException", "ResourceNotFoundException"}
        and "index" in message
    )


def list_recent_projects(user_id: str, limit: int = 10) -> List[Dict]:
    table = get_table(tables.projects)
    safe_limit = max(1, min(int(limit or 10), 50))

    try:
        resp = table.query(
            IndexName=RECENT_PROJECTS_INDEX,
            KeyConditionExpression=Key("user_id").eq(user_id),
            ScanIndexForward=False,
            Limit=safe_limit,
        )
        return resp.get("Items", [])[:safe_limit]
    except ClientError as exc:
        if not _can_fallback_from_index_error(exc):
            raise
        logger.info(
            "Recent projects GSI %s unavailable; falling back to base project query",
            RECENT_PROJECTS_INDEX,
        )

    return _sort_recent_projects(list_projects(user_id))[:safe_limit]


def get_project(user_id: str, project_id: str) -> Optional[Dict]:
    table = get_table(tables.projects)
    resp = table.get_item(Key={"user_id": user_id, "project_id": project_id})
    return resp.get("Item")


def get_project_by_id(project_id: str) -> Optional[Dict]:
    """
    Get project by project_id only (requires scanning table).
    Used for public preview access.
    """
    table = get_table(tables.projects)
    all_items = []
    last_key = None

    while True:
        scan_kwargs = {
            "FilterExpression": Attr("project_id").eq(project_id),
            "Limit": 1000,
        }

        if last_key:
            scan_kwargs["ExclusiveStartKey"] = last_key

        resp = table.scan(**scan_kwargs)
        items = resp.get("Items", [])
        all_items.extend(items)

        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break

        # If we found the project, we can stop scanning
        if items:
            break

    return all_items[0] if all_items else None


def update_project(
    user_id: str,
    project_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    latest_conversation_id: Optional[str] = None,
    latest_dashboard_id: Optional[str] = None,
    dashboard_title: Optional[str] = None,
    dashboard_preview_key: Optional[str] = None,
    is_preview_public: Optional[bool] = None,
    allowed: Optional[List[Dict]] = None,
    source_type: Optional[str] = None,
    name_source: Optional[str] = None,
) -> Optional[Dict]:
    logger.info(
        f"Updating project {project_id} for user {user_id}: name={name}, dashboard_title={dashboard_title}, conversation_id={latest_conversation_id}"
    )
    table = get_table(tables.projects)
    expr = []
    values = {}
    names = {}
    if name is not None:
        expr.append("#name = :name")
        names["#name"] = "name"
        values[":name"] = name
    if description is not None:
        expr.append("#description = :description")
        names["#description"] = "description"
        values[":description"] = description
    if latest_conversation_id is not None:
        expr.append("#latest_conversation_id = :latest_conversation_id")
        names["#latest_conversation_id"] = "latest_conversation_id"
        values[":latest_conversation_id"] = latest_conversation_id
    if latest_dashboard_id is not None:
        expr.append("#latest_dashboard_id = :latest_dashboard_id")
        names["#latest_dashboard_id"] = "latest_dashboard_id"
        values[":latest_dashboard_id"] = latest_dashboard_id
    if dashboard_title is not None:
        expr.append("#dashboard_title = :dashboard_title")
        names["#dashboard_title"] = "dashboard_title"
        values[":dashboard_title"] = dashboard_title
    if dashboard_preview_key is not None:
        expr.append("#dashboard_preview_key = :dashboard_preview_key")
        names["#dashboard_preview_key"] = "dashboard_preview_key"
        values[":dashboard_preview_key"] = dashboard_preview_key
    if is_preview_public is not None:
        expr.append("#is_preview_public = :is_preview_public")
        names["#is_preview_public"] = "is_preview_public"
        values[":is_preview_public"] = is_preview_public
    if allowed is not None:
        expr.append("#allowed = :allowed")
        names["#allowed"] = "allowed"
        values[":allowed"] = allowed
    if source_type is not None:
        expr.append("#source_type = :source_type")
        names["#source_type"] = "source_type"
        values[":source_type"] = source_type
    if name_source is not None:
        expr.append("#name_source = :name_source")
        names["#name_source"] = "name_source"
        values[":name_source"] = name_source
    if not expr:
        logger.info(f"No fields to update for project {project_id}")
        return get_project(user_id, project_id)
    expr.append("#updated_at = :updated_at")
    names["#updated_at"] = "updated_at"
    values[":updated_at"] = _now_iso()

    try:
        resp = table.update_item(
            Key={"user_id": user_id, "project_id": project_id},
            UpdateExpression="SET " + ", ".join(expr),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
        updated_item = resp.get("Attributes")
        logger.info(f"Successfully updated project {project_id}: {updated_item}")
        return updated_item
    except Exception as e:
        logger.error(f"Failed to update project {project_id}: {e}")
        raise


def delete_project(user_id: str, project_id: str) -> None:
    table = get_table(tables.projects)
    table.delete_item(Key={"user_id": user_id, "project_id": project_id})
