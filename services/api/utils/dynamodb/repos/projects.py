"""
DynamoDB repository for project entities.
"""
import uuid
from datetime import datetime
from typing import Dict, List, Optional
import logging

from boto3.dynamodb.conditions import Key  # type: ignore

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def create_project(user_id: str, name: str, description: Optional[str] = None) -> Dict:
    table = get_table(tables.projects)
    project_id = str(uuid.uuid4())
    item = {
        "user_id": user_id,
        "project_id": project_id,
        "name": name,
        "description": description or "",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "latest_conversation_id": None,
        "latest_dashboard_id": None,
        "dashboard_title": None,
    }
    table.put_item(Item=item)
    return item


def list_projects(user_id: str) -> List[Dict]:
    table = get_table(tables.projects)
    resp = table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
    )
    return resp.get("Items", [])


def get_project(user_id: str, project_id: str) -> Optional[Dict]:
    table = get_table(tables.projects)
    resp = table.get_item(Key={"user_id": user_id, "project_id": project_id})
    return resp.get("Item")


def update_project(
    user_id: str,
    project_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    latest_conversation_id: Optional[str] = None,
    latest_dashboard_id: Optional[str] = None,
    dashboard_title: Optional[str] = None,
) -> Optional[Dict]:
    logger.info(f"Updating project {project_id} for user {user_id}: name={name}, dashboard_title={dashboard_title}, conversation_id={latest_conversation_id}")
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


