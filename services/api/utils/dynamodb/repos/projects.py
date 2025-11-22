"""
DynamoDB repository for project entities.
"""
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from boto3.dynamodb.conditions import Key  # type: ignore

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


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


def update_project(user_id: str, project_id: str, name: Optional[str] = None, description: Optional[str] = None) -> Optional[Dict]:
    table = get_table(tables.projects)
    expr = []
    values = {}
    if name is not None:
        expr.append("name = :name")
        values[":name"] = name
    if description is not None:
        expr.append("description = :description")
        values[":description"] = description
    if not expr:
        return get_project(user_id, project_id)
    expr.append("updated_at = :updated_at")
    values[":updated_at"] = _now_iso()

    resp = table.update_item(
        Key={"user_id": user_id, "project_id": project_id},
        UpdateExpression="SET " + ", ".join(expr),
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes")


def delete_project(user_id: str, project_id: str) -> None:
    table = get_table(tables.projects)
    table.delete_item(Key={"user_id": user_id, "project_id": project_id})


