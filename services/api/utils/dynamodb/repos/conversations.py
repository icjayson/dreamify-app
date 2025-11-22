"""
DynamoDB repository for conversation metadata.
"""
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from boto3.dynamodb.conditions import Key  # type: ignore

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def create_conversation(
    project_id: str,
    user_id: str,
    s3_bucket: str,
    s3_key: str,
    title: Optional[str] = None,
    metadata: Optional[Dict] = None,
    conversation_id: Optional[str] = None,
) -> Dict:
    table = get_table(tables.conversations)
    conversation_id = conversation_id or str(uuid.uuid4())
    item = {
        "project_id": project_id,
        "conversation_id": conversation_id,
        "user_id": user_id,
        "s3_bucket": s3_bucket,
        "s3_key": s3_key,
        "title": title or "Conversation",
        "metadata": metadata or {},
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    table.put_item(Item=item)
    return item


def list_conversations(project_id: str) -> List[Dict]:
    table = get_table(tables.conversations)
    resp = table.query(
        KeyConditionExpression=Key("project_id").eq(project_id),
        ScanIndexForward=False,
    )
    return resp.get("Items", [])


def get_conversation(project_id: str, conversation_id: str) -> Optional[Dict]:
    table = get_table(tables.conversations)
    resp = table.get_item(
        Key={"project_id": project_id, "conversation_id": conversation_id}
    )
    return resp.get("Item")


def update_conversation_metadata(
    project_id: str, conversation_id: str, metadata: Dict
) -> Optional[Dict]:
    table = get_table(tables.conversations)
    resp = table.update_item(
        Key={"project_id": project_id, "conversation_id": conversation_id},
        UpdateExpression="SET metadata = :metadata, updated_at = :updated_at",
        ExpressionAttributeValues={
            ":metadata": metadata,
            ":updated_at": _now_iso(),
        },
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes")


