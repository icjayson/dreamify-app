"""
DynamoDB repository for OAuth connected account tokens.
Schema:
  PK: user_id (String)
  SK: provider (String)  — e.g. "facebook"
"""
from datetime import datetime, timezone
from typing import Dict, Optional, Any, List

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def upsert_provider_metadata(user_id: str, provider: str, metadata: Dict[str, Any]) -> Dict:
    """
    Upsert non-token metadata for a provider key.

    Useful for storing connector selections even when OAuth tokens are managed elsewhere.
    """
    table = get_table(tables.connected_accounts)
    now = _now_iso()
    existing = get_connection(user_id, provider) or {}
    item = {
        "user_id": user_id,
        "provider": provider,
        "created_at": existing.get("created_at", now),
        "updated_at": now,
        **existing,
        **metadata,
    }
    table.put_item(Item=item)
    return item


def append_selected_entity(
    user_id: str,
    provider: str,
    entity: Dict[str, str],
    max_items: int = 50,
) -> Dict:
    """Append a selected entity to provider metadata with simple dedupe by id+type."""
    existing = get_connection(user_id, provider) or {}
    entities: List[Dict[str, str]] = list(existing.get("selected_entities", []))
    entity_id = str(entity.get("id", ""))
    entity_type = str(entity.get("type", ""))
    deduped = [e for e in entities if not (str(e.get("id", "")) == entity_id and str(e.get("type", "")) == entity_type)]
    deduped.insert(0, {"id": entity_id, "name": str(entity.get("name", "")), "type": entity_type})
    return upsert_provider_metadata(
        user_id=user_id,
        provider=provider,
        metadata={"selected_entities": deduped[:max_items]},
    )


def remove_selected_entity(user_id: str, provider: str, entity_id: str) -> Dict:
    """Remove one selected entity by id from provider metadata."""
    existing = get_connection(user_id, provider) or {}
    entities: List[Dict[str, str]] = list(existing.get("selected_entities", []))
    filtered = [e for e in entities if str(e.get("id", "")) != str(entity_id)]
    return upsert_provider_metadata(
        user_id=user_id,
        provider=provider,
        metadata={"selected_entities": filtered},
    )


def get_sync_version_name(
    user_id: str,
    provider: str,
    connector_entity_id: str,
    run_id: str,
) -> Optional[str]:
    """Read a custom sync version name for one run."""
    existing = get_connection(user_id, provider) or {}
    all_names = existing.get("sync_version_names") or {}
    entity_names = all_names.get(str(connector_entity_id)) or {}
    value = entity_names.get(str(run_id))
    return str(value).strip() if isinstance(value, str) and str(value).strip() else None


def set_sync_version_name(
    user_id: str,
    provider: str,
    connector_entity_id: str,
    run_id: str,
    sync_version_name: str,
) -> Dict:
    """Set or remove one custom sync version name under provider metadata."""
    existing = get_connection(user_id, provider) or {}
    all_names = dict(existing.get("sync_version_names") or {})
    entity_key = str(connector_entity_id)
    run_key = str(run_id)
    entity_names = dict(all_names.get(entity_key) or {})
    normalized_name = str(sync_version_name).strip()
    if normalized_name:
        entity_names[run_key] = normalized_name
    else:
        entity_names.pop(run_key, None)
    if entity_names:
        all_names[entity_key] = entity_names
    else:
        all_names.pop(entity_key, None)
    return upsert_provider_metadata(
        user_id=user_id,
        provider=provider,
        metadata={"sync_version_names": all_names},
    )
