"""
DynamoDB repository for chat platform workspace and session entities.
"""

import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from boto3.dynamodb.conditions import Attr

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Workspaces ────────────────────────────────────────────────────────────────


def get_workspace(platform_workspace_id: str) -> Optional[Dict]:
    table = get_table(tables.chat_workspaces)
    resp = table.get_item(Key={"platform_workspace_id": platform_workspace_id})
    return resp.get("Item")


def save_workspace(
    platform_workspace_id: str,
    user_id: str,
    project_id: str,
    platform: str,
    bot_token_encrypted: str,
    workspace_name: str = "",
    language: str = "en",
    telegram_user_id: Optional[str] = None,
    zalo_user_id: Optional[str] = None,
    whatsapp_user_id: Optional[str] = None,
    target_workspace_id: Optional[str] = None,
) -> Dict:
    table = get_table(tables.chat_workspaces)
    item = {
        "platform_workspace_id": platform_workspace_id,
        "user_id": user_id,
        "project_id": project_id,
        "platform": platform,
        "bot_token_encrypted": bot_token_encrypted,
        "workspace_name": workspace_name,
        "language": language,
        "created_at": _now_iso(),
    }
    if telegram_user_id is not None:
        item["telegram_user_id"] = telegram_user_id
    if zalo_user_id is not None:
        item["zalo_user_id"] = zalo_user_id
    if whatsapp_user_id is not None:
        item["whatsapp_user_id"] = whatsapp_user_id
    if target_workspace_id is not None:
        # Used by short-lived `zalo_upload:{token}` rows to point at the
        # real Zalo workspace that owns the upload session.
        item["target_workspace_id"] = target_workspace_id
    table.put_item(Item=item)
    return item


def append_pending_asset(platform_workspace_id: str, asset: Dict) -> None:
    """Append a pending-asset record to a chat workspace.

    Used for Zalo: files uploaded via the web upload page are parked on the
    workspace until the user's next chat query consumes them.
    """
    table = get_table(tables.chat_workspaces)
    table.update_item(
        Key={"platform_workspace_id": platform_workspace_id},
        UpdateExpression="SET pending_assets = list_append(if_not_exists(pending_assets, :empty), :a)",
        ExpressionAttributeValues={":empty": [], ":a": [asset]},
    )


def clear_pending_assets(platform_workspace_id: str) -> None:
    table = get_table(tables.chat_workspaces)
    table.update_item(
        Key={"platform_workspace_id": platform_workspace_id},
        UpdateExpression="REMOVE pending_assets",
    )


def cleanup_expired_pending(
    platform: str, ttl_seconds: int, user_id: Optional[str] = None
) -> int:
    """Delete pending registration rows older than ``ttl_seconds``.

    Called opportunistically from the `generate-code` endpoints so the table
    doesn't accumulate stale `*_pending` rows. Scoped to a single user when
    ``user_id`` is provided to keep the scan small.
    Returns the number of rows deleted.
    """
    table = get_table(tables.chat_workspaces)
    flt = Attr("platform").eq(platform)
    if user_id:
        flt = flt & Attr("user_id").eq(user_id)
    resp = table.scan(FilterExpression=flt, Limit=50)
    now = datetime.now(timezone.utc)
    deleted = 0
    for item in resp.get("Items", []):
        try:
            created_raw = item.get("created_at", "")
            created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            age = (now - created).total_seconds()
        except Exception:
            age = ttl_seconds + 1  # malformed timestamp → treat as expired
        if age > ttl_seconds:
            table.delete_item(
                Key={"platform_workspace_id": item["platform_workspace_id"]}
            )
            deleted += 1
    return deleted


def delete_workspace(platform_workspace_id: str) -> None:
    table = get_table(tables.chat_workspaces)
    table.delete_item(Key={"platform_workspace_id": platform_workspace_id})


def get_workspace_by_user(user_id: str, platform: str) -> Optional[Dict]:
    """Find a workspace by owner user_id and platform. Returns first match."""
    table = get_table(tables.chat_workspaces)
    resp = table.scan(
        FilterExpression=Attr("user_id").eq(user_id) & Attr("platform").eq(platform),
        Limit=10,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def get_workspace_by_telegram_user_id(telegram_user_id: str) -> Optional[Dict]:
    """Find a Telegram DM workspace by the Telegram user_id stored at registration."""
    table = get_table(tables.chat_workspaces)
    resp = table.scan(
        FilterExpression=Attr("platform").eq("telegram")
        & Attr("telegram_user_id").eq(telegram_user_id),
        Limit=10,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def get_workspace_by_zalo_user_id(zalo_user_id: str) -> Optional[Dict]:
    """Find a Zalo DM workspace by the Zalo user_id stored at registration."""
    table = get_table(tables.chat_workspaces)
    resp = table.scan(
        FilterExpression=Attr("platform").eq("zalo")
        & Attr("zalo_user_id").eq(zalo_user_id),
        Limit=10,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def get_workspace_by_whatsapp_user_id(whatsapp_user_id: str) -> Optional[Dict]:
    """Find a WhatsApp DM workspace by the wa_id stored at registration."""
    table = get_table(tables.chat_workspaces)
    resp = table.scan(
        FilterExpression=Attr("platform").eq("whatsapp")
        & Attr("whatsapp_user_id").eq(whatsapp_user_id),
        Limit=10,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def update_workspace_language(platform_workspace_id: str, language: str) -> None:
    table = get_table(tables.chat_workspaces)
    table.update_item(
        Key={"platform_workspace_id": platform_workspace_id},
        UpdateExpression="SET #lang = :lang",
        ExpressionAttributeNames={"#lang": "language"},
        ExpressionAttributeValues={":lang": language},
    )


# ── Sessions ──────────────────────────────────────────────────────────────────


def get_session(platform_workspace_id: str, thread_key: str) -> Optional[Dict]:
    table = get_table(tables.chat_sessions)
    resp = table.get_item(
        Key={"platform_workspace_id": platform_workspace_id, "thread_key": thread_key}
    )
    return resp.get("Item")


def create_session(
    platform_workspace_id: str,
    thread_key: str,
    conversation_id: str,
    project_id: str,
    user_id: str,
) -> Dict:
    table = get_table(tables.chat_sessions)
    item = {
        "platform_workspace_id": platform_workspace_id,
        "thread_key": thread_key,
        "conversation_id": conversation_id,
        "project_id": project_id,
        "user_id": user_id,
        "last_active_at": _now_iso(),
    }
    table.put_item(Item=item)
    return item


def update_session_conversation(
    platform_workspace_id: str,
    thread_key: str,
    conversation_id: str,
) -> None:
    table = get_table(tables.chat_sessions)
    table.update_item(
        Key={"platform_workspace_id": platform_workspace_id, "thread_key": thread_key},
        UpdateExpression="SET conversation_id = :cid, last_active_at = :ts",
        ExpressionAttributeValues={
            ":cid": conversation_id,
            ":ts": _now_iso(),
        },
    )


def set_session_pending_clarification(
    platform_workspace_id: str,
    thread_key: str,
    pending: Dict,
) -> None:
    table = get_table(tables.chat_sessions)
    table.update_item(
        Key={"platform_workspace_id": platform_workspace_id, "thread_key": thread_key},
        UpdateExpression="SET pending_clarification = :pending, last_active_at = :ts",
        ExpressionAttributeValues={
            ":pending": pending,
            ":ts": _now_iso(),
        },
    )


def clear_session_pending_clarification(
    platform_workspace_id: str,
    thread_key: str,
) -> None:
    table = get_table(tables.chat_sessions)
    table.update_item(
        Key={"platform_workspace_id": platform_workspace_id, "thread_key": thread_key},
        UpdateExpression="SET last_active_at = :ts REMOVE pending_clarification",
        ExpressionAttributeValues={":ts": _now_iso()},
    )
