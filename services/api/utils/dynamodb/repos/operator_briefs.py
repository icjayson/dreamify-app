"""
DynamoDB repository for the Operator Brief ledger — the decision→outcome record.

Every proactive brief Dreamify sends is logged here: what changed, what we
recommended, and the metric snapshot at the time. This is the un-pretrainable
flywheel ("when this business did X after metric Y moved, the result was Z");
it is read back later to attribute outcomes and to seed benchmarks.

Schema:
  PK: user_id (String)
  SK: sk (String, "{created_at}#{brief_id}") — newest-first within a user, no GSI needed
"""

import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from boto3.dynamodb.conditions import Key

from utils.dynamodb.client import floats_to_decimal, get_table
from utils.dynamodb.tables import tables

# Keep briefs far longer than sync runs (90d) — this is the moat data.
_BRIEF_TTL_DAYS = 730


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_brief(
    user_id: str,
    schedule_id: str,
    run_id: str,
    provider: str,
    headline: str,
    body: str,
    severity: str,
    recommendation: str,
    changes: Optional[List[Dict]] = None,
    metric_snapshot: Optional[Dict] = None,
    project_id: Optional[str] = None,
) -> Dict:
    """Append one brief to the ledger. Returns the stored item."""
    table = get_table(tables.operator_briefs)
    now = _now_iso()
    brief_id = str(uuid.uuid4())
    item: Dict = {
        "user_id": user_id,
        "sk": f"{now}#{brief_id}",
        "brief_id": brief_id,
        "schedule_id": schedule_id,
        "run_id": run_id,
        "provider": provider,
        "headline": headline,
        "body": body,
        "severity": severity,
        "recommendation": recommendation,
        "changes": changes or [],
        "metric_snapshot": metric_snapshot or {},
        "created_at": now,
        # Outcome attribution is filled in by a later run / feedback (see attach_outcome).
        "outcome": None,
        "expires_at": int(time.time()) + _BRIEF_TTL_DAYS * 86400,
    }
    # changes/metric_snapshot carry floats; DynamoDB resource API needs Decimal.
    table.put_item(Item=floats_to_decimal(item))
    return item


def list_briefs_for_user(user_id: str, limit: int = 50) -> List[Dict]:
    """Return recent briefs for a user, newest first."""
    table = get_table(tables.operator_briefs)
    response = table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return response.get("Items", [])


def list_briefs_for_schedule(
    user_id: str, schedule_id: str, limit: int = 50
) -> List[Dict]:
    """Return recent briefs for one schedule, newest first."""
    briefs = list_briefs_for_user(user_id, limit=limit * 3)
    matched = [b for b in briefs if b.get("schedule_id") == schedule_id]
    return matched[:limit]


def attach_outcome(user_id: str, sk: str, outcome: Dict) -> None:
    """Record the realised result of a brief's recommendation (the flywheel close)."""
    table = get_table(tables.operator_briefs)
    table.update_item(
        Key={"user_id": user_id, "sk": sk},
        UpdateExpression="SET #o = :o",
        ExpressionAttributeNames={"#o": "outcome"},
        ExpressionAttributeValues={":o": outcome},
    )
