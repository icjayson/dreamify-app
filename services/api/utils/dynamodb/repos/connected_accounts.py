"""
DynamoDB repository for OAuth connected account tokens.
Schema:
  PK: user_id (String)
  SK: provider (String)  — e.g. "facebook"
"""
from datetime import datetime, timezone
from typing import Dict, Optional, Any, List

from boto3.dynamodb.conditions import Key  # type: ignore
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


def list_connections_by_prefix(user_id: str, provider_prefix: str) -> List[Dict]:
    """List connection records whose provider sort key starts with provider_prefix."""
    table = get_table(tables.connected_accounts)
    response = table.query(
        KeyConditionExpression=Key("user_id").eq(user_id)
        & Key("provider").begins_with(provider_prefix)
    )
    return response.get("Items", [])


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
        **existing,
        "user_id": user_id,
        "provider": provider,
        "created_at": existing.get("created_at", now),
        "updated_at": now,
        **metadata,
    }
    table.put_item(Item=item)
    return item


def append_selected_entity(
    user_id: str,
    provider: str,
    entity: Dict[str, Any],
    max_items: int = 50,
) -> Dict:
    """Append a selected entity to provider metadata with simple dedupe by id+type."""
    # Flow 3: determine if this is the user's first connected entity across ALL
    # providers (before this insert) — drives the "first connector" celebration.
    try:
        _all = list_connections_by_prefix(user_id, "")
        _prior_total = sum(len(c.get("selected_entities", []) or []) for c in _all)
    except Exception:
        _prior_total = 1  # on error, assume not-first to avoid false celebrations

    existing = get_connection(user_id, provider) or {}
    entities: List[Dict[str, Any]] = list(existing.get("selected_entities", []))
    entity_id = str(entity.get("id", ""))
    entity_type = str(entity.get("type", ""))
    deduped = [e for e in entities if not (str(e.get("id", "")) == entity_id and str(e.get("type", "")) == entity_type)]
    normalized = {
        str(key): value
        for key, value in entity.items()
        if key and value is not None
    }
    normalized["id"] = entity_id
    normalized["name"] = str(entity.get("name", ""))
    normalized["type"] = entity_type
    deduped.insert(0, normalized)
    result = upsert_provider_metadata(
        user_id=user_id,
        provider=provider,
        metadata={"selected_entities": deduped[:max_items]},
    )

    # Best-effort: notify the email automation layer (runs in a daemon thread).
    try:
        from utils import resend_automation
        resend_automation.notify_connector_connected(
            user_id=user_id,
            provider=provider,
            entity=normalized,
            is_first=(_prior_total == 0),
        )
    except Exception:
        pass

    return result


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
