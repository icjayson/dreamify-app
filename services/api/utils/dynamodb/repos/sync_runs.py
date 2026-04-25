"""
DynamoDB repository for sync run history.
Schema:
  PK: schedule_id (String)
  SK: run_id (String, UUID)
  GSI: user_id_triggered_at_index (PK: user_id, SK: triggered_at)
"""
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import uuid

from boto3.dynamodb.conditions import Key

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables

_RUN_TTL_DAYS = 90


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def create_run(schedule_id: str, user_id: str, provider: str) -> Dict:
    """Create a new run record with status=running."""
    table = get_table(tables.sync_runs)
    now = _now_iso()
    run_id = str(uuid.uuid4())
    expires_at = int(time.time()) + _RUN_TTL_DAYS * 86400
    item = {
        "schedule_id": schedule_id,
        "run_id": run_id,
        "user_id": user_id,
        "provider": provider,
        "triggered_at": now,
        "status": "running",
        "expires_at": expires_at,
    }
    table.put_item(Item=item)
    return item


def complete_run(
    schedule_id: str,
    run_id: str,
    status: str,
    rows_fetched: Optional[int] = None,
    columns_fetched: Optional[int] = None,
    asset_id: Optional[str] = None,
    error_message: Optional[str] = None,
    duration_ms: Optional[int] = None,
    date_range_start: Optional[str] = None,
    date_range_end: Optional[str] = None,
) -> None:
    """Mark a run as complete with outcome data."""
    table = get_table(tables.sync_runs)
    now = _now_iso()

    set_parts = ["#completed_at = :completed_at", "#status = :status"]
    expr_names = {"#completed_at": "completed_at", "#status": "status"}
    expr_values: Dict = {":completed_at": now, ":status": status}

    optional_fields = {
        "rows_fetched": rows_fetched,
        "columns_fetched": columns_fetched,
        "asset_id": asset_id,
        "error_message": error_message,
        "duration_ms": duration_ms,
        "date_range_start": date_range_start,
        "date_range_end": date_range_end,
    }
    for field, value in optional_fields.items():
        if value is not None:
            set_parts.append(f"#f_{field} = :v_{field}")
            expr_names[f"#f_{field}"] = field
            expr_values[f":v_{field}"] = value

    table.update_item(
        Key={"schedule_id": schedule_id, "run_id": run_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def list_runs_for_schedule(schedule_id: str, limit: int = 20) -> List[Dict]:
    """Return recent runs for a specific schedule, newest first."""
    table = get_table(tables.sync_runs)
    response = table.query(
        KeyConditionExpression=Key("schedule_id").eq(schedule_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return response.get("Items", [])


def list_runs_for_user(
    user_id: str,
    limit: int = 50,
    last_evaluated_key: Optional[Dict] = None,
) -> Tuple[List[Dict], Optional[Dict]]:
    """Return paginated runs for a user across all schedules, newest first."""
    table = get_table(tables.sync_runs)
    kwargs: Dict = {
        "IndexName": "user_id_triggered_at_index",
        "KeyConditionExpression": Key("user_id").eq(user_id),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if last_evaluated_key:
        kwargs["ExclusiveStartKey"] = last_evaluated_key

    response = table.query(**kwargs)
    return response.get("Items", []), response.get("LastEvaluatedKey")
