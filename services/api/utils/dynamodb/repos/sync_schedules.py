"""
DynamoDB repository for sync schedule definitions.
Schema:
  PK: user_id (String)
  SK: schedule_id (String, UUID)
  GSI: schedule_id_index (PK: schedule_id) — for trigger lookup without user_id
"""
from datetime import datetime
from typing import Dict, List, Optional
import uuid

from boto3.dynamodb.conditions import Key

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def create_schedule(
    user_id: str,
    provider: str,
    connector_config: Dict,
    project_id: str,
    account_name: str,
    frequency: str,
    hour_utc: int,
    day_of_week: int,
    date_range_preset: str,
) -> Dict:
    """Create a new sync schedule record."""
    table = get_table(tables.sync_schedules)
    now = _now_iso()
    schedule_id = str(uuid.uuid4())
    item = {
        "user_id": user_id,
        "schedule_id": schedule_id,
        "provider": provider,
        "connector_config": connector_config,
        "project_id": project_id,
        "account_name": account_name,
        "frequency": frequency,
        "hour_utc": hour_utc,
        "day_of_week": day_of_week,
        "date_range_preset": date_range_preset,
        "status": "active",
        "eventbridge_rule_name": "",
        "created_at": now,
        "updated_at": now,
    }
    table.put_item(Item=item)
    return item


def get_schedule(user_id: str, schedule_id: str) -> Optional[Dict]:
    """Get a schedule by user_id + schedule_id."""
    table = get_table(tables.sync_schedules)
    response = table.get_item(Key={"user_id": user_id, "schedule_id": schedule_id})
    return response.get("Item")


def get_schedule_by_id(schedule_id: str) -> Optional[Dict]:
    """Get a schedule by schedule_id alone (uses GSI). For trigger endpoint use."""
    table = get_table(tables.sync_schedules)
    response = table.query(
        IndexName="schedule_id_index",
        KeyConditionExpression=Key("schedule_id").eq(schedule_id),
        Limit=1,
    )
    items = response.get("Items", [])
    return items[0] if items else None


def list_schedules(user_id: str) -> List[Dict]:
    """List all schedules for a user."""
    table = get_table(tables.sync_schedules)
    response = table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
    )
    items = response.get("Items", [])
    # Sort newest first
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items


def update_schedule(user_id: str, schedule_id: str, **updates) -> Optional[Dict]:
    """Update allowed fields on a schedule."""
    table = get_table(tables.sync_schedules)
    updates["updated_at"] = _now_iso()

    allowed = {
        "frequency", "hour_utc", "day_of_week", "date_range_preset",
        "status", "eventbridge_rule_name", "updated_at",
        "connector_config", "account_name", "project_id",
    }
    set_expr_parts = []
    expr_names = {}
    expr_values = {}
    for k, v in updates.items():
        if k not in allowed:
            continue
        placeholder = f"#f_{k}"
        value_key = f":v_{k}"
        set_expr_parts.append(f"{placeholder} = {value_key}")
        expr_names[placeholder] = k
        expr_values[value_key] = v

    if not set_expr_parts:
        return get_schedule(user_id, schedule_id)

    table.update_item(
        Key={"user_id": user_id, "schedule_id": schedule_id},
        UpdateExpression="SET " + ", ".join(set_expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    return get_schedule(user_id, schedule_id)


def update_last_run(
    user_id: str,
    schedule_id: str,
    status: str,
    rows: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    """Update last_run_* fields after a sync run completes."""
    table = get_table(tables.sync_schedules)
    now = _now_iso()
    update_values: Dict = {
        ":last_run_at": now,
        ":last_run_status": status,
        ":updated_at": now,
    }
    set_parts = [
        "#last_run_at = :last_run_at",
        "#last_run_status = :last_run_status",
        "#updated_at = :updated_at",
    ]
    expr_names = {
        "#last_run_at": "last_run_at",
        "#last_run_status": "last_run_status",
        "#updated_at": "updated_at",
    }
    if rows is not None:
        set_parts.append("#last_run_rows = :last_run_rows")
        expr_names["#last_run_rows"] = "last_run_rows"
        update_values[":last_run_rows"] = rows

    table.update_item(
        Key={"user_id": user_id, "schedule_id": schedule_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=update_values,
    )


def delete_schedule(user_id: str, schedule_id: str) -> None:
    """Delete a schedule record."""
    table = get_table(tables.sync_schedules)
    table.delete_item(Key={"user_id": user_id, "schedule_id": schedule_id})
