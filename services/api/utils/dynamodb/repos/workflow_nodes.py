"""
DynamoDB repository for workflow node status tracking.
"""
from datetime import datetime
from typing import Dict, List, Optional

from boto3.dynamodb.conditions import Key

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables
from utils.logger import logger


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


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


def list_nodes(conversation_id: str) -> List[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.query(
        KeyConditionExpression=Key("conversation_id").eq(conversation_id),
        ScanIndexForward=False,
    )
    return resp.get("Items", [])


def get_node(conversation_id: str, node_id: str) -> Optional[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.get_item(
        Key={"conversation_id": conversation_id, "node_id": node_id}
    )
    return resp.get("Item")


