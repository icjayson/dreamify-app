"""
DynamoDB repository for asset entities.
"""
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any

from boto3.dynamodb.conditions import Attr, Key  # type: ignore

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables

ASSET_ID_INDEX = "asset_id_index"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    row_count: Optional[int] = None,
    column_count: Optional[int] = None,
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
        "asset_type": asset_type,
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
    if row_count is not None:
        item["row_count"] = row_count
    if column_count is not None:
        item["column_count"] = column_count
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
        items = [item for item in items if item.get("asset_type") == asset_type]
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


def update_asset_metadata(user_id: str, asset_id: str, metadata: Dict[str, Any]) -> Optional[Dict]:
    """Patch arbitrary metadata fields on an asset record."""
    if not metadata:
        return get_asset(user_id, asset_id)
    table = get_table(tables.assets)
    expr_parts = ["updated_at = :updated_at"]
    expr_values: Dict[str, Any] = {":updated_at": _now_iso()}
    expr_names: Dict[str, str] = {}

    for idx, (key, value) in enumerate(metadata.items()):
        name_key = f"#m_{idx}"
        value_key = f":v_{idx}"
        expr_names[name_key] = key
        expr_values[value_key] = value
        expr_parts.append(f"{name_key} = {value_key}")

    resp = table.update_item(
        Key={"user_id": user_id, "asset_id": asset_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes")


def clone_asset_to_project(user_id: str, source_asset: Dict[str, Any], project_id: str) -> Dict:
    """Create a new asset record in another project pointing to the same S3 object."""
    return create_asset(
        user_id=user_id,
        project_id=project_id,
        s3_bucket=source_asset.get("s3_bucket", ""),
        s3_key=source_asset.get("s3_key", ""),
        asset_type=source_asset.get("asset_type", ""),
        size_bytes=int(source_asset.get("size_bytes", 0)),
        checksum_sha256=source_asset.get("checksum_sha256"),
        version=source_asset.get("version", ""),
        content_type=source_asset.get("content_type"),
        status=source_asset.get("status", "uploaded"),
        file_id=source_asset.get("file_id") or source_asset.get("asset_id"),
        original_filename=source_asset.get("filename"),
        extension=source_asset.get("extension"),
        row_count=source_asset.get("row_count"),
        column_count=source_asset.get("column_count"),
    )


