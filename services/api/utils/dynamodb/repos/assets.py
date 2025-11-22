"""
DynamoDB repository for asset entities.
"""
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from boto3.dynamodb.conditions import Attr, Key  # type: ignore

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables

ASSET_ID_INDEX = "asset_id_index"


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def create_asset(
    user_id: str,
    project_id: str,
    s3_bucket: str,
    s3_key: str,
    asset_type: str,
    size_bytes: int,
    checksum_sha256: Optional[str],
    version: str,
    content_type: Optional[str],
    status: str = "uploaded",
    asset_id: Optional[str] = None,
    file_id: Optional[str] = None,
    original_filename: Optional[str] = None,
    extension: Optional[str] = None,
) -> Dict:
    table = get_table(tables.assets)
    asset_id = asset_id or str(uuid.uuid4())
    item = {
        "user_id": user_id,
        "asset_id": asset_id,
        "file_id": file_id or asset_id,
        "project_id": project_id,
        "s3_bucket": s3_bucket,
        "s3_key": s3_key,
        "type": asset_type,
        "filename": original_filename or "",
        "extension": extension or "",
        "size_bytes": size_bytes,
        "checksum_sha256": checksum_sha256,
        "version": version,
        "content_type": content_type,
        "status": status,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "processed_json_s3_key": None,
    }
    table.put_item(Item=item)
    return item


def list_assets(
    user_id: str,
    project_id: Optional[str] = None,
    asset_type: Optional[str] = None,
) -> List[Dict]:
    table = get_table(tables.assets)
    resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = resp.get("Items", [])
    if project_id:
        items = [item for item in items if item.get("project_id") == project_id]
    if asset_type:
        items = [item for item in items if item.get("type") == asset_type]
    return items


def get_asset(user_id: str, asset_id: str) -> Optional[Dict]:
    table = get_table(tables.assets)
    resp = table.get_item(Key={"user_id": user_id, "asset_id": asset_id})
    return resp.get("Item")


def get_asset_by_id(asset_id: str) -> Optional[Dict]:
    """
    Fetch an asset when only asset_id is known (requires asset_id_index on table).
    """
    table = get_table(tables.assets)
    resp = table.query(
        IndexName=ASSET_ID_INDEX,
        KeyConditionExpression=Key("asset_id").eq(asset_id),
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def update_asset_status(user_id: str, asset_id: str, status: str) -> Optional[Dict]:
    table = get_table(tables.assets)
    resp = table.update_item(
        Key={"user_id": user_id, "asset_id": asset_id},
        UpdateExpression="SET #status = :status, updated_at = :updated_at",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": status,
            ":updated_at": _now_iso(),
        },
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes")


def delete_asset(user_id: str, asset_id: str) -> None:
    table = get_table(tables.assets)
    table.delete_item(Key={"user_id": user_id, "asset_id": asset_id})


def set_processed_json_key(user_id: str, asset_id: str, processed_key: str) -> Optional[Dict]:
    table = get_table(tables.assets)
    resp = table.update_item(
        Key={"user_id": user_id, "asset_id": asset_id},
        UpdateExpression="SET processed_json_s3_key = :processed_key, #status = :status, updated_at = :updated_at",
        ExpressionAttributeNames={
            "#status": "status",
        },
        ExpressionAttributeValues={
            ":processed_key": processed_key,
            ":status": "processed",
            ":updated_at": _now_iso(),
        },
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes")


def set_processed_json_key_by_asset_id(asset_id: str, processed_key: str) -> Optional[Dict]:
    asset = get_asset_by_id(asset_id)
    if not asset:
        return None
    return set_processed_json_key(asset["user_id"], asset_id, processed_key)


