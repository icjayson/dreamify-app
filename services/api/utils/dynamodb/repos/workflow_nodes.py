"""
DynamoDB repository for workflow node status tracking.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from boto3.dynamodb.conditions import Key

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables
from utils.logger import logger


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_node_status(
    conversation_id: str,
    node_id: str,
    status: str,
    metadata: Optional[Dict] = None,
) -> Dict:
    table = get_table(tables.workflow_status)
    item = {
        "conversation_id": conversation_id,
        "node_id": node_id,
        "status": status,
        "metadata": metadata or {},
        "updated_at": _now_iso(),
    }
    logger.info(f"Upserting node status: {item}")
    table.put_item(Item=item)
    return item


def append_workflow_event(
    conversation_id: str,
    run_id: str,
    sequence: int,
    event: Dict[str, Any],
) -> Dict:
    table = get_table(tables.workflow_status)
    node_id = f"event#{run_id}#{sequence:06d}"
    now_iso = _now_iso()
    metadata = {
        **event,
        "id": event.get("id") or node_id,
        "run_id": event.get("run_id") or run_id,
        "sequence": int(event.get("sequence", sequence)),
        "updated_at": event.get("updated_at") or now_iso,
    }
    item = {
        "conversation_id": conversation_id,
        "node_id": node_id,
        "status": metadata.get("status", "completed"),
        "metadata": metadata,
        "updated_at": now_iso,
    }
    logger.info(f"Appending workflow event: {item}")
    table.put_item(Item=item)
    return item


def list_nodes(conversation_id: str) -> List[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.query(
        KeyConditionExpression=Key("conversation_id").eq(conversation_id),
        ScanIndexForward=False,
    )
    return resp.get("Items", [])


def list_workflow_events(conversation_id: str) -> List[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.query(
        KeyConditionExpression=Key("conversation_id").eq(conversation_id)
        & Key("node_id").begins_with("event#"),
        ScanIndexForward=True,
    )
    items = resp.get("Items", [])
    return sorted(
        items,
        key=lambda item: (
            (item.get("metadata") or {}).get("started_at")
            or (item.get("metadata") or {}).get("updated_at")
            or item.get("updated_at")
            or "",
            (item.get("metadata") or {}).get("run_id") or "",
            int((item.get("metadata") or {}).get("sequence") or 0),
        ),
    )


def get_node(conversation_id: str, node_id: str) -> Optional[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.get_item(
        Key={"conversation_id": conversation_id, "node_id": node_id}
    )
    return resp.get("Item")
