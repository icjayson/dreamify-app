"""
DynamoDB repository for chat platform workspace and session entities.
"""

import uuid
from datetime import datetime
from typing import Dict, Optional

from boto3.dynamodb.conditions import Attr

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables


def _now_iso() -> str:
    return datetime.now().isoformat()


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
    table.put_item(Item=item)
    return item


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
