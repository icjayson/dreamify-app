"""
DynamoDB repository for OAuth connected account tokens.
Schema:
  PK: user_id (String)
  SK: provider (String)  — e.g. "facebook"
"""
from datetime import datetime
from typing import Dict, Optional

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def save_connection(
    user_id: str,
    provider: str,
    access_token: str,
    expires_at: str,
) -> Dict:
    """Upsert an OAuth connection record."""
    table = get_table(tables.connected_accounts)
    now = _now_iso()
    item = {
        "user_id": user_id,
        "provider": provider,
        "access_token": access_token,
        "expires_at": expires_at,
        "updated_at": now,
    }
    # Preserve created_at if record already exists
    existing = get_connection(user_id, provider)
    item["created_at"] = existing["created_at"] if existing else now

    table.put_item(Item=item)
    return item


def get_connection(user_id: str, provider: str) -> Optional[Dict]:
    """Retrieve an OAuth connection record, or None if not found."""
    table = get_table(tables.connected_accounts)
    response = table.get_item(Key={"user_id": user_id, "provider": provider})
    return response.get("Item")


def delete_connection(user_id: str, provider: str) -> None:
    """Remove an OAuth connection record."""
    table = get_table(tables.connected_accounts)
    table.delete_item(Key={"user_id": user_id, "provider": provider})
