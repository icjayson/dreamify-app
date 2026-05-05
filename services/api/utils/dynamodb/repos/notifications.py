"""
DynamoDB repository for in-app notifications.
Schema:
  PK: user_id (String)
  SK: notification_id (String, UUID)
  GSI: user_id_created_at_index (PK: user_id, SK: created_at) — newest-first queries
"""
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from boto3.dynamodb.conditions import Key

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables

_NOTIFICATION_TTL_DAYS = 30


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_notification(
    user_id: str,
    notification_type: str,
    title: str,
    body: str,
    schedule_id: Optional[str] = None,
    run_id: Optional[str] = None,
    provider: Optional[str] = None,
    asset_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Dict:
    """Create a new notification for a user."""
    table = get_table(tables.notifications)
    now = _now_iso()
    notification_id = str(uuid.uuid4())
    expires_at = int(time.time()) + _NOTIFICATION_TTL_DAYS * 86400
    item: Dict = {
        "user_id": user_id,
        "notification_id": notification_id,
        "type": notification_type,
        "title": title,
        "body": body,
        "read": False,
        "created_at": now,
        "expires_at": expires_at,
    }
    if schedule_id is not None:
        item["schedule_id"] = schedule_id
    if run_id is not None:
        item["run_id"] = run_id
    if provider is not None:
        item["provider"] = provider
    if asset_id is not None:
        item["asset_id"] = asset_id
    if project_id is not None:
        item["project_id"] = project_id
    table.put_item(Item=item)
    return item


def list_notifications(
    user_id: str,
    limit: int = 20,
    unread_only: bool = False,
) -> List[Dict]:
    """Return recent notifications for a user, newest first."""
    table = get_table(tables.notifications)
    kwargs: Dict = {
        "IndexName": "user_id_created_at_index",
        "KeyConditionExpression": Key("user_id").eq(user_id),
        "ScanIndexForward": False,
        "Limit": limit * 3 if unread_only else limit,  # over-fetch when filtering
    }
    response = table.query(**kwargs)
    items: List[Dict] = response.get("Items", [])
    if unread_only:
        items = [n for n in items if not n.get("read", False)]
    return items[:limit]


def mark_read(user_id: str, notification_id: str) -> None:
    """Mark a single notification as read."""
    table = get_table(tables.notifications)
    table.update_item(
        Key={"user_id": user_id, "notification_id": notification_id},
        UpdateExpression="SET #r = :true",
        ExpressionAttributeNames={"#r": "read"},
        ExpressionAttributeValues={":true": True},
    )


def mark_all_read(user_id: str) -> int:
    """Mark all unread notifications for a user as read. Returns count updated."""
    items = list_notifications(user_id, limit=100, unread_only=True)
    for item in items:
        mark_read(user_id, item["notification_id"])
    return len(items)


def count_unread(user_id: str) -> int:
    """Return the count of unread notifications (scans up to 100)."""
    items = list_notifications(user_id, limit=100, unread_only=True)
    return len(items)
