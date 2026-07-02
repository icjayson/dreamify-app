"""
Core orchestration for chat platform queries.

Flow per query:
  1. Lookup workspace → user_id, project_id
  2. Get or create chat session → conversation_id
  3. Post "Analyzing..." placeholder to Slack
  4. Append user node to conversation in S3 + DynamoDB
  5. Call Morpheus /run
  6. Poll workflow_status table, streaming step labels back to Slack
  7. On completion: use inline narrative (Q&A) or load from S3 (dashboard)
  8. Update placeholder with final Block Kit response
  9. Deduct credits
"""

import asyncio
import base64
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import boto3
import requests

from app.services.credit_service import CreditService
from app.services.chart_renderer import (
    is_chart_rendering_enabled,
    render_dashboard_previews,
)
from app.services.slack_service import (
    build_analyzing_blocks,
    build_error_blocks,
    build_response_blocks,
    build_status_blocks,
    build_sync_placeholder_blocks,
    build_sync_result_blocks,
    decrypt_token,
    step_label,
)
from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import chat_platform_repo
from utils.dynamodb.repos import conversations as conversations_repo
from utils.dynamodb.repos import projects as projects_repo
from utils.dynamodb.repos import workflow_nodes as workflow_nodes_repo
from utils.s3.conversations import load_conversation, save_conversation
from utils.s3.paths import build_conversation_key
from app.utils.timestamp_utils import utc_now_iso

logger = logging.getLogger(__name__)

MORPHEUS_SERVICE_URL = (
    config.chat_platform.morpheus_service_url
    if config.chat_platform
    else "http://localhost:8000"
)
DREAMIFY_APP_URL = (
    config.chat_platform.dreamify_app_url
    if config.chat_platform
    else "https://app.dreamify.dev"
)

# Chat queries always use the "pro" model alias (10 credits).
CHAT_MODEL_ALIAS = "pro"
CHAT_MODEL_ID = os.environ.get("DREAMIFY_PRO_MODEL", "gpt-5.4-mini")
CHAT_CREDIT_COST = 10

# Polling config
POLL_INTERVAL_S = 3
POLL_MAX_ATTEMPTS = 100  # ~5 minutes
PENDING_CLARIFICATION_TTL_S = 24 * 60 * 60
CALLBACK_PREFIX = "dfc"

credit_service = CreditService()


# ── Conversation helpers ──────────────────────────────────────────────────────


def _now_iso() -> str:
    return utc_now_iso()


def _make_user_node(query: str) -> Dict[str, Any]:
    return {
        "node_id": f"node_{uuid.uuid4().hex[:8]}",
        "role": "user",
        "status": "completed",
        "created_at": _now_iso(),
        "contents": [{"type": "text", "data": {"text": query}}],
        "metadata": {"chat_mode": CHAT_MODEL_ALIAS, "resolved_model": CHAT_MODEL_ID},
    }


def _make_greeting_node() -> Dict[str, Any]:
    return {
        "node_id": f"node_{uuid.uuid4().hex[:8]}",
        "role": "assistant",
        "status": "completed",
        "created_at": _now_iso(),
        "contents": [
            {
                "type": "text",
                "data": {
                    "text": "Hi! I'm Morpheus, your analytics teammate. Ask me anything about your data."
                },
            }
        ],
    }


def _build_conversation_keys(
    user_id: str, project_id: str, conversation_id: str
) -> Dict[str, str]:
    primary = build_conversation_key(user_id, project_id, conversation_id, backup=False)
    backup = build_conversation_key(user_id, project_id, conversation_id, backup=True)
    return {"primary": primary, "backup": backup}


def _extract_narrative(conversation: Dict[str, Any]) -> Optional[str]:
    """Return the text of the last completed assistant node."""
    for node in reversed(conversation.get("nodes", [])):
        if node.get("role") == "assistant" and node.get("status") == "completed":
            for content in node.get("contents", []):
                if content.get("type") == "text":
                    return content.get("data", {}).get("text")
    return None


def _build_dashboard_url(
    project_id: str, conversation: Dict[str, Any]
) -> Optional[str]:
    """Return the public preview URL for the most recently created dashboard."""
    dashboards = conversation.get("dashboards", [])
    if not dashboards:
        return None
    # Use the public preview page so the link works without Clerk auth
    return f"{DREAMIFY_APP_URL}/workspace/project/preview?projectId={project_id}"


def _load_dashboard_json(s3_uri: str) -> Optional[Dict[str, Any]]:
    """
    Load a dashboard JSON config from an S3 URI (s3://bucket/key).
    Returns the parsed dict, or None on any error.
    """
    import json
    from utils.s3.client import download_bytes

    try:
        if not s3_uri or not s3_uri.startswith("s3://"):
            return None
        without_scheme = s3_uri[len("s3://") :]
        bucket, _, key = without_scheme.partition("/")
        raw = download_bytes(bucket, key)
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Failed to load dashboard JSON from %s: %s", s3_uri, exc)
        return None


def _extract_top_metrics(dashboard: Dict[str, Any], max_n: int = 4) -> list:
    """Return up to max_n metric dicts from a dashboard JSON config."""
    return dashboard.get("metrics", [])[:max_n]


def _build_workspace_project_url(project_id: str) -> str:
    return f"{DREAMIFY_APP_URL}/workspace/project?projectId={project_id}"


def _analysis_incomplete_message(project_id: str) -> str:
    return (
        "Analysis did not complete. Please try again, or open Dreamify: "
        f"{_build_workspace_project_url(project_id)}"
    )


def _mark_user_node_assets_selected(node: Dict[str, Any], asset_ids: list) -> None:
    selected_asset_ids = [
        str(asset_id).strip()
        for asset_id in asset_ids
        if asset_id is not None and str(asset_id).strip()
    ]
    if not selected_asset_ids:
        return
    metadata = node.setdefault("metadata", {})
    existing_ids = metadata.get("selected_asset_ids", [])
    if not isinstance(existing_ids, list):
        existing_ids = []
    metadata["asset_selection"] = "explicit"
    metadata["selected_asset_ids"] = list(
        dict.fromkeys([*existing_ids, *selected_asset_ids])
    )


def _project_asset_summaries(user_id: str, project_id: str) -> List[Dict[str, Any]]:
    summaries: List[Dict[str, Any]] = []
    for asset in assets_repo.list_assets(user_id=user_id, project_id=project_id):
        asset_id = asset.get("asset_id")
        if not asset_id:
            continue
        summaries.append(
            {
                "asset_id": asset_id,
                "file_id": asset.get("file_id"),
                "filename": asset.get("filename") or "",
                "extension": asset.get("extension") or "",
                "asset_type": asset.get("asset_type") or "",
                "row_count": asset.get("row_count"),
                "column_count": asset.get("column_count"),
                "status": asset.get("status"),
            }
        )
    return summaries


def _asset_content_from_asset(asset: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": "asset",
        "data": {
            "asset_id": asset.get("asset_id"),
            "file_id": asset.get("file_id") or asset.get("asset_id"),
            "s3_bucket": asset.get("s3_bucket"),
            "s3_key": asset.get("s3_key"),
            "extension": asset.get("extension", ""),
            "filename": asset.get("filename", ""),
            "sourceType": asset.get("asset_type", ""),
        },
    }


def _trim(value: Any, limit: int = 75) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _valid_options(clarification: Dict[str, Any]) -> List[Dict[str, Any]]:
    options: List[Dict[str, Any]] = []
    for option in clarification.get("options", []):
        if not isinstance(option, dict):
            continue
        option_id = str(option.get("id") or "").strip()
        label = str(option.get("label") or "").strip()
        if option_id and label:
            options.append(option)
    return options


def _normalize_clarifications(conversation: Dict[str, Any]) -> List[Dict[str, Any]]:
    for node in reversed(conversation.get("nodes", [])):
        if node.get("role") != "assistant":
            continue
        items: List[Dict[str, Any]] = []
        for content in node.get("contents", []):
            if content.get("type") != "clarification_request":
                continue
            data = content.get("data") or {}
            if not isinstance(data, dict):
                continue
            clarification_id = str(data.get("clarification_id") or "").strip()
            question = str(data.get("question") or "").strip()
            options = _valid_options(data)
            if not clarification_id or not question or not options:
                continue
            normalized = dict(data)
            normalized["options"] = options
            items.append(normalized)
        if items:
            return items
    return []


def _load_valid_clarifications(
    bucket: str, key: str
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    conversation = load_conversation(bucket, key)
    return conversation, _normalize_clarifications(conversation)


def _default_selected_option_ids(
    clarifications: List[Dict[str, Any]],
) -> Dict[str, str]:
    selected: Dict[str, str] = {}
    for clarification in clarifications:
        options = _valid_options(clarification)
        if not options:
            continue
        choice = next((o for o in options if o.get("recommended")), options[0])
        selected[str(clarification["clarification_id"])] = str(choice["id"])
    return selected


def _build_pending_clarification(
    *,
    platform: str,
    conversation_id: str,
    project_id: str,
    user_id: str,
    thread_key: str,
    clarifications: List[Dict[str, Any]],
    message: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "status": "awaiting_user_input",
        "platform": platform,
        "nonce": uuid.uuid4().hex[:10],
        "conversation_id": conversation_id,
        "project_id": project_id,
        "user_id": user_id,
        "thread_key": thread_key,
        "clarifications": clarifications,
        "selected_option_ids": _default_selected_option_ids(clarifications),
        "message": message,
        "created_at": _now_iso(),
        "expires_at": int(time.time()) + PENDING_CLARIFICATION_TTL_S,
    }


def _is_pending_active(pending: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(pending, dict):
        return False
    if pending.get("status") not in {"awaiting_user_input", "resuming"}:
        return False
    expires_at = int(pending.get("expires_at") or 0)
    return not expires_at or expires_at > int(time.time())


def _get_active_pending(
    platform_workspace_id: str, thread_key: str
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    session = chat_platform_repo.get_session(platform_workspace_id, thread_key)
    pending = (session or {}).get("pending_clarification")
    if pending and not _is_pending_active(pending):
        chat_platform_repo.clear_session_pending_clarification(
            platform_workspace_id, thread_key
        )
        return session, None
    return session, pending if _is_pending_active(pending) else None


def has_pending_clarification(platform_workspace_id: str, thread_key: str) -> bool:
    _, pending = _get_active_pending(platform_workspace_id, thread_key)
    return pending is not None


def _store_pending(
    platform_workspace_id: str, thread_key: str, pending: Dict[str, Any]
) -> None:
    chat_platform_repo.set_session_pending_clarification(
        platform_workspace_id, thread_key, pending
    )


def _clear_pending(platform_workspace_id: str, thread_key: str) -> None:
    chat_platform_repo.clear_session_pending_clarification(
        platform_workspace_id, thread_key
    )


# ── Zalo 2-step collect flow (file → prompt) ──────────────────────────────────
#
# Zalo delivers files and text as separate messages, so we gather files into the
# workspace's ``pending_assets`` across turns, guided by a thin state machine
# (awaiting_file → awaiting_prompt) stored on the workspace row. When the prompt
# arrives we delegate to the normal ``handle_zalo_query`` which drains the
# pending assets and runs Morpheus.

COLLECT_TTL_S = 30 * 60  # 30 minutes (matches the web-upload token TTL)

_ZALO_CANCEL_WORDS = {
    "huỷ",
    "hủy",
    "huy",
    "thoát",
    "thoat",
    "cancel",
    "/cancel",
    "stop",
}
_ZALO_COLLECT_TRIGGER_WORDS = {
    "phân tích",
    "phan tich",
    "analyze",
    "analyse",
    "/analyze",
    "/analyse",
}


def build_collect_state(status: str) -> Dict[str, Any]:
    """status ∈ {"awaiting_file", "awaiting_prompt"}."""
    return {
        "status": status,
        "created_at": _now_iso(),
        "expires_at": int(time.time()) + COLLECT_TTL_S,
    }


def _is_collect_active(state: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(state, dict):
        return False
    if state.get("status") not in {"awaiting_file", "awaiting_prompt"}:
        return False
    expires_at = int(state.get("expires_at") or 0)
    return not expires_at or expires_at > int(time.time())


def _get_active_collect(platform_workspace_id: str) -> Optional[Dict[str, Any]]:
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    state = (workspace or {}).get("pending_collect")
    if state and not _is_collect_active(state):
        chat_platform_repo.clear_workspace_pending_collect(platform_workspace_id)
        return None
    return state if _is_collect_active(state) else None


def has_pending_collect(platform_workspace_id: str) -> bool:
    return _get_active_collect(platform_workspace_id) is not None


def is_zalo_collect_trigger(text: str) -> bool:
    """True when ``text`` is exactly a collect-flow start keyword (e.g. just
    "phân tích"). Exact-match only, so a real question like
    "phân tích doanh thu tháng này" still goes straight to the query handler."""
    return (text or "").strip().lower() in _ZALO_COLLECT_TRIGGER_WORDS


def _encode_callback_value(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    return f"{CALLBACK_PREFIX}:{encoded}"


def _decode_callback_value(value: str) -> Dict[str, Any]:
    if not value.startswith(f"{CALLBACK_PREFIX}:"):
        return {}
    encoded = value.split(":", 1)[1]
    padded = encoded + "=" * (-len(encoded) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _telegram_callback_data(
    action: str, nonce: str, clarification_index: int = -1, option_index: int = -1
) -> str:
    return f"{CALLBACK_PREFIX}:{action}:{nonce}:{clarification_index}:{option_index}"


def _parse_telegram_callback_data(data: str) -> Dict[str, Any]:
    parts = data.split(":")
    if len(parts) != 5 or parts[0] != CALLBACK_PREFIX:
        return {}
    try:
        return {
            "action": parts[1],
            "nonce": parts[2],
            "clarification_index": int(parts[3]),
            "option_index": int(parts[4]),
        }
    except ValueError:
        return {}


def _option_by_id(
    clarification: Dict[str, Any], option_id: str
) -> Optional[Dict[str, Any]]:
    for option in _valid_options(clarification):
        if str(option.get("id")) == option_id:
            return option
    return None


def _selected_label(pending: Dict[str, Any], clarification: Dict[str, Any]) -> str:
    selected = (pending.get("selected_option_ids") or {}).get(
        str(clarification.get("clarification_id"))
    )
    option = _option_by_id(clarification, str(selected or ""))
    return str((option or {}).get("label") or "Not selected")


def _slack_select_option(
    pending: Dict[str, Any],
    thread_key: str,
    clarification: Dict[str, Any],
    option: Dict[str, Any],
) -> Dict[str, Any]:
    value = _encode_callback_value(
        {
            "action": "select",
            "thread_key": thread_key,
            "nonce": pending["nonce"],
            "clarification_id": clarification["clarification_id"],
            "option_id": option["id"],
        }
    )
    item = {
        "text": {"type": "plain_text", "text": _trim(option.get("label"), 75)},
        "value": value,
    }
    description = str(option.get("description") or option.get("impact") or "").strip()
    if description:
        item["description"] = {"type": "plain_text", "text": _trim(description, 75)}
    return item


def build_slack_clarification_blocks(pending: Dict[str, Any], project_id: str) -> list:
    thread_key = str(pending.get("thread_key") or "")
    intro = "I need your choice before I continue the analysis."
    if pending.get("last_error"):
        intro = f"{intro}\n\n⚠️ {pending['last_error']}"
    blocks: list = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*📊 Dreamify*\n\n{intro}",
            },
        }
    ]
    for idx, clarification in enumerate(pending.get("clarifications", []), start=1):
        selected_label = _selected_label(pending, clarification)
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{idx}. {clarification.get('question')}*\n_Selected: {selected_label}_",
                },
            }
        )
        options = [
            _slack_select_option(pending, thread_key, clarification, option)
            for option in _valid_options(clarification)
        ][:10]
        selected_id = (pending.get("selected_option_ids") or {}).get(
            str(clarification.get("clarification_id"))
        )
        initial = next(
            (
                o
                for o in options
                if _decode_callback_value(o["value"]).get("option_id") == selected_id
            ),
            None,
        )
        select = {
            "type": "static_select",
            "action_id": "dreamify_clarification_select",
            "placeholder": {"type": "plain_text", "text": "Choose an option"},
            "options": options,
        }
        if initial:
            select["initial_option"] = initial
        blocks.append({"type": "actions", "elements": [select]})
    blocks.append(
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "action_id": "dreamify_clarification_continue",
                    "text": {"type": "plain_text", "text": "Continue"},
                    "style": "primary",
                    "value": _encode_callback_value(
                        {
                            "action": "continue",
                            "thread_key": thread_key,
                            "nonce": pending["nonce"],
                        }
                    ),
                },
                {
                    "type": "button",
                    "action_id": "dreamify_clarification_cancel",
                    "text": {"type": "plain_text", "text": "Cancel"},
                    "style": "danger",
                    "value": _encode_callback_value(
                        {
                            "action": "cancel",
                            "thread_key": thread_key,
                            "nonce": pending["nonce"],
                        }
                    ),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Open in Dreamify"},
                    "url": _build_workspace_project_url(project_id),
                },
            ],
        }
    )
    return blocks


def build_telegram_clarification_message(
    pending: Dict[str, Any], project_id: str
) -> Tuple[str, Any]:
    from app.services.telegram_service import escape_markdown
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    lines = [
        "📊 *Dreamify*",
        "",
        "I need your choice before I continue the analysis\\.",
    ]
    if pending.get("last_error"):
        lines.extend(["", f"⚠️ {escape_markdown(str(pending['last_error']))}"])
    keyboard = []
    nonce = pending["nonce"]
    for ci, clarification in enumerate(pending.get("clarifications", []), start=0):
        selected = _selected_label(pending, clarification)
        lines.append("")
        lines.append(
            f"*{ci + 1}\\. {escape_markdown(str(clarification.get('question')))}*"
        )
        lines.append(f"_Selected: {escape_markdown(selected)}_")
        for oi, option in enumerate(_valid_options(clarification)):
            marker = "✓ " if str(option.get("label")) == selected else ""
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"{marker}{_trim(option.get('label'), 48)}",
                        callback_data=_telegram_callback_data("s", nonce, ci, oi),
                    )
                ]
            )
    keyboard.append(
        [
            InlineKeyboardButton(
                "Continue", callback_data=_telegram_callback_data("go", nonce)
            ),
            InlineKeyboardButton(
                "Cancel", callback_data=_telegram_callback_data("x", nonce)
            ),
        ]
    )
    keyboard.append(
        [
            InlineKeyboardButton(
                "Open in Dreamify", url=_build_workspace_project_url(project_id)
            )
        ]
    )
    return "\n".join(lines), InlineKeyboardMarkup(keyboard)


def build_zalo_clarification_message(pending: Dict[str, Any], project_id: str) -> str:
    lines = ["📊 Dreamify", "", "I need your choice before I continue the analysis."]
    if pending.get("last_error"):
        lines.extend(["", f"⚠️ {pending['last_error']}"])
    for ci, clarification in enumerate(pending.get("clarifications", []), start=1):
        lines.append("")
        lines.append(f"{ci}. {clarification.get('question')}")
        for oi, option in enumerate(_valid_options(clarification), start=1):
            suffix = " (recommended)" if option.get("recommended") else ""
            lines.append(f"{oi}. {option.get('label')}{suffix}")
            if option.get("description"):
                lines.append(f"   {option.get('description')}")
    lines.append("")
    lines.append("Reply with the option number, exact label, or cancel.")
    lines.append(f"Open in Dreamify: {_build_workspace_project_url(project_id)}")
    return "\n".join(lines)


def _parse_single_text_answer(
    clarification: Dict[str, Any], answer: str
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    text = answer.strip()
    if not text:
        return None, None
    options = _valid_options(clarification)
    if text.isdigit():
        index = int(text) - 1
        if 0 <= index < len(options):
            return options[index], None
    lowered = text.lower()
    for option in options:
        if lowered == str(option.get("id") or "").strip().lower():
            return option, None
        if lowered == str(option.get("label") or "").strip().lower():
            return option, None
    if clarification.get("reason_code") == "analysis_context" and clarification.get(
        "allow_free_text"
    ):
        option = next(
            (o for o in options if str(o.get("id")) == "define_metric_scope"), None
        )
        if option:
            return option, text
    return None, None


def parse_text_clarification_reply(
    pending: Dict[str, Any], reply_text: str
) -> Tuple[str, Optional[Dict[str, Any]], str]:
    clean = re.sub(r"<@[A-Z0-9]+>", "", reply_text or "").strip()
    if clean.lower() == "cancel":
        return "cancel", None, ""
    clarifications = list(pending.get("clarifications") or [])
    separators = r"[\n,]+"
    parts = [part.strip() for part in re.split(separators, clean) if part.strip()]
    if len(clarifications) == 1:
        parts = [clean]
    if len(parts) < len(clarifications):
        return "invalid", None, "Please answer each pending choice in order."
    selected: Dict[str, str] = {}
    free_text: Dict[str, str] = {}
    for clarification, answer in zip(clarifications, parts):
        option, answer_text = _parse_single_text_answer(clarification, answer)
        if not option:
            return (
                "invalid",
                None,
                "I could not match that answer to one of the choices.",
            )
        cid = str(clarification["clarification_id"])
        selected[cid] = str(option["id"])
        if answer_text:
            free_text[cid] = answer_text
    updated = dict(pending)
    updated["selected_option_ids"] = {
        **(pending.get("selected_option_ids") or {}),
        **selected,
    }
    if free_text:
        updated["free_text_by_id"] = {
            **(pending.get("free_text_by_id") or {}),
            **free_text,
        }
    return "valid", updated, ""


def _responses_from_pending(
    pending: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[str], Optional[str]]:
    responses: List[Dict[str, Any]] = []
    selected_asset_ids: List[str] = []
    selected = pending.get("selected_option_ids") or {}
    free_text_by_id = pending.get("free_text_by_id") or {}
    for clarification in pending.get("clarifications") or []:
        cid = str(clarification.get("clarification_id") or "")
        option = _option_by_id(clarification, str(selected.get(cid) or ""))
        if not option:
            return [], [], f"Missing choice for {clarification.get('question')}"
        metadata = dict(option.get("metadata") or {})
        if cid in free_text_by_id:
            metadata["free_text"] = free_text_by_id[cid]
        asset_ids = [
            str(asset_id).strip()
            for asset_id in metadata.get("asset_ids", [])
            if str(asset_id).strip()
        ]
        selected_asset_ids.extend(asset_ids)
        responses.append(
            {
                "type": "clarification_response",
                "data": {
                    "clarification_id": cid,
                    "selected_option_id": option.get("id"),
                    "selected_option_label": option.get("label"),
                    "metadata": metadata,
                },
            }
        )
    return responses, list(dict.fromkeys(selected_asset_ids)), None


def _hydrate_asset_contents(user_id: str, asset_ids: List[str]) -> List[Dict[str, Any]]:
    contents: List[Dict[str, Any]] = []
    for asset_id in asset_ids:
        asset = assets_repo.get_asset(user_id, asset_id)
        if not asset:
            logger.warning("Selected clarification asset not found: %s", asset_id)
            continue
        contents.append(_asset_content_from_asset(asset))
    return contents


def _append_clarification_response_node(
    pending: Dict[str, Any],
) -> Tuple[str, Dict[str, str]]:
    user_id = pending["user_id"]
    project_id = pending["project_id"]
    conversation_id = pending["conversation_id"]
    responses, selected_asset_ids, error = _responses_from_pending(pending)
    if error:
        raise RuntimeError(error)

    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise RuntimeError(f"Conversation {conversation_id} not found in DynamoDB")
    bucket = conversation_meta["s3_bucket"]
    keys = _build_conversation_keys(user_id, project_id, conversation_id)
    conversation = load_conversation(bucket, conversation_meta["s3_key"])
    asset_contents = _hydrate_asset_contents(user_id, selected_asset_ids)
    labels = [
        str(response["data"].get("selected_option_label") or "")
        for response in responses
        if response.get("data")
    ]
    user_node = _make_user_node("Clarification answer: " + "; ".join(labels))
    user_node.setdefault("contents", []).extend(responses)
    user_node["contents"].extend(asset_contents)
    if selected_asset_ids:
        _mark_user_node_assets_selected(user_node, selected_asset_ids)
    conversation.setdefault("nodes", []).append(user_node)
    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)
    return bucket, keys


def _append_no_answer_node(pending: Dict[str, Any]) -> None:
    user_id = pending["user_id"]
    project_id = pending["project_id"]
    conversation_id = pending["conversation_id"]
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        return
    bucket = conversation_meta["s3_bucket"]
    keys = _build_conversation_keys(user_id, project_id, conversation_id)
    conversation = load_conversation(bucket, conversation_meta["s3_key"])
    contents = []
    for clarification in pending.get("clarifications") or []:
        contents.append(
            {
                "type": "clarification_response",
                "data": {
                    "clarification_id": clarification.get("clarification_id"),
                    "selected_option_id": None,
                    "selected_option_label": None,
                    "answer_status": "no_answer",
                },
            }
        )
    node = {
        "node_id": f"node_{uuid.uuid4().hex[:8]}",
        "role": "user",
        "status": "completed",
        "created_at": _now_iso(),
        "contents": contents,
        "metadata": {
            "hidden": True,
            "chat_mode": CHAT_MODEL_ALIAS,
            "resolved_model": CHAT_MODEL_ID,
        },
    }
    conversation.setdefault("nodes", []).append(node)
    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)


def _stop_pending_workflow(pending: Dict[str, Any]) -> None:
    now_iso = _now_iso()
    metadata = {
        "step": "clarification_dismissed",
        "answer_status": "no_answer",
        "stopped_at": now_iso,
        "stopped_by": pending.get("user_id"),
    }
    for node_id in ("workflow", "stop_signal"):
        workflow_nodes_repo.upsert_node_status(
            conversation_id=pending["conversation_id"],
            node_id=node_id,
            status="stopped",
            metadata=metadata,
        )


# ── Session management ────────────────────────────────────────────────────────


def _get_or_create_session(
    platform_workspace_id: str,
    thread_key: str,
    workspace: Dict[str, Any],
) -> Tuple[str, str, bool]:
    """
    Return (conversation_id, project_id, is_new_conversation).
    Creates a session record if one doesn't exist for this thread.
    """
    session = chat_platform_repo.get_session(platform_workspace_id, thread_key)
    if session:
        return session["conversation_id"], session["project_id"], False

    conversation_id = str(uuid.uuid4())
    project_id = workspace["project_id"]
    chat_platform_repo.create_session(
        platform_workspace_id=platform_workspace_id,
        thread_key=thread_key,
        conversation_id=conversation_id,
        project_id=project_id,
        user_id=workspace["user_id"],
    )
    return conversation_id, project_id, True


# ── S3 + DynamoDB conversation persistence ────────────────────────────────────


def _save_new_conversation(
    user_id: str, project_id: str, conversation_id: str, query: str
) -> Tuple[str, Dict[str, str]]:
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    keys = _build_conversation_keys(user_id, project_id, conversation_id)
    conversation = {
        "user_id": user_id,
        "project_id": project_id,
        "conversation_id": conversation_id,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "metadata": {
            "status": "active",
            "chat_mode": CHAT_MODEL_ALIAS,
            "resolved_model": CHAT_MODEL_ID,
        },
        "nodes": [_make_greeting_node(), _make_user_node(query)],
        "dashboards": [],
    }
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)
    conversations_repo.create_conversation(
        project_id=project_id,
        user_id=user_id,
        s3_bucket=bucket,
        s3_key=keys["primary"],
        title="Chat conversation",
        metadata={},
        conversation_id=conversation_id,
        node_count=len(conversation["nodes"]),
    )
    projects_repo.update_project(
        user_id=user_id,
        project_id=project_id,
        latest_conversation_id=conversation_id,
    )
    return bucket, keys


def _append_user_node_to_conversation(
    user_id: str, project_id: str, conversation_id: str, query: str
) -> Tuple[str, Dict[str, str]]:
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    keys = _build_conversation_keys(user_id, project_id, conversation_id)
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise RuntimeError(f"Conversation {conversation_id} not found in DynamoDB")
    conversation = load_conversation(
        conversation_meta["s3_bucket"], conversation_meta["s3_key"]
    )
    conversation.setdefault("nodes", []).append(_make_user_node(query))
    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)
    return bucket, keys


# ── Morpheus call ─────────────────────────────────────────────────────────────


def _call_morpheus(
    conversation_id: str,
    project_id: str,
    user_id: str,
    bucket: str,
    keys: Dict[str, str],
    *,
    skip_ask_first: bool = False,
) -> None:
    payload = {
        "conversation_id": conversation_id,
        "conversation_uri": f"s3://{bucket}/{keys['primary']}",
        "conversation_backup_uri": f"s3://{bucket}/{keys['backup']}",
        "project_id": project_id,
        "user_id": user_id,
        "model": CHAT_MODEL_ID,
        "project_assets": _project_asset_summaries(user_id, project_id),
        "skip_ask_first": skip_ask_first,
    }
    try:
        response = requests.post(
            f"{MORPHEUS_SERVICE_URL}/run", json=payload, timeout=30
        )
        response.raise_for_status()
    except requests.exceptions.ReadTimeout:
        # Morpheus /run blocks while waiting for a previous workflow to stop before
        # returning. The job has been accepted and will run; we can poll for completion.
        logger.warning(
            "Morpheus /run read timeout for %s — workflow accepted, polling anyway",
            conversation_id,
        )


# ── Polling ───────────────────────────────────────────────────────────────────


async def _poll_workflow(
    conversation_id: str,
    on_step: Optional[Any] = None,
) -> Tuple[str, Optional[str], Dict[str, Any]]:
    """
    Poll workflow_status until terminal state. Returns (status, last_step, final_metadata).
    Calls on_step(label) each time the step changes so callers can update the UI.
    """
    last_step = None
    for _ in range(POLL_MAX_ATTEMPTS):
        await asyncio.sleep(POLL_INTERVAL_S)
        try:
            node = workflow_nodes_repo.get_node(conversation_id, "workflow")
        except Exception as e:
            logger.warning(
                "DynamoDB get_node error for %s (will retry): %s", conversation_id, e
            )
            continue
        if not node:
            continue
        status = node.get("status", "")
        metadata = node.get("metadata", {})
        current_step = metadata.get("step", "")
        if current_step != last_step:
            last_step = current_step
            if on_step and current_step:
                await on_step(step_label(current_step))
        if status in ("completed", "error", "stopped", "awaiting_user_input"):
            return status, last_step, metadata
    return "timeout", last_step, {}


def _workspace_result(
    user_id: str,
    project_id: str,
    conversation_id: str,
    final_meta: Dict[str, Any],
) -> Tuple[str, Optional[str], list, Optional[Dict[str, Any]]]:
    metrics: list = []
    dashboard_json: Optional[Dict[str, Any]] = None
    if final_meta.get("response_type") in (
        "message",
        "answer_with_visual",
    ) and final_meta.get("content"):
        return final_meta["content"], None, metrics, dashboard_json

    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise RuntimeError(
            f"Post-poll: conversation {conversation_id} not found in DynamoDB"
        )
    conversation = load_conversation(
        conversation_meta["s3_bucket"], conversation_meta["s3_key"]
    )
    narrative = (
        _extract_narrative(conversation) or "Analysis complete. No narrative returned."
    )
    dashboard_url = _build_dashboard_url(project_id, conversation)
    dashboards = conversation.get("dashboards", [])
    if dashboards:
        try:
            projects_repo.update_project(
                user_id=user_id,
                project_id=project_id,
                is_preview_public=True,
            )
        except Exception as exc:
            logger.warning(
                "Failed to enable public preview for %s: %s", project_id, exc
            )
        s3_uri = dashboards[-1].get("s3_uri")
        if s3_uri:
            dashboard_json = _load_dashboard_json(s3_uri)
            if dashboard_json:
                metrics = _extract_top_metrics(dashboard_json)
    return narrative, dashboard_url, metrics, dashboard_json


def _awaiting_message_text(project_id: str) -> str:
    return (
        "I need your choice before I continue. "
        f"Open in Dreamify: {_build_workspace_project_url(project_id)}"
    )


def _prepare_pending_from_conversation(
    *,
    platform: str,
    platform_workspace_id: str,
    thread_key: str,
    conversation_id: str,
    project_id: str,
    user_id: str,
    bucket: str,
    keys: Dict[str, str],
    message: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    try:
        _, clarifications = _load_valid_clarifications(bucket, keys["primary"])
    except Exception as exc:
        logger.warning(
            "Failed to load paused workflow %s clarification payload: %s",
            conversation_id,
            exc,
        )
        return None
    if not clarifications:
        logger.warning(
            "Workflow %s paused without valid clarification choices",
            conversation_id,
        )
        return None
    pending = _build_pending_clarification(
        platform=platform,
        conversation_id=conversation_id,
        project_id=project_id,
        user_id=user_id,
        thread_key=thread_key,
        clarifications=clarifications,
        message=message,
    )
    _store_pending(platform_workspace_id, thread_key, pending)
    return pending


def _set_pending_resuming(
    platform_workspace_id: str, pending: Dict[str, Any]
) -> Dict[str, Any]:
    updated = dict(pending)
    updated["status"] = "resuming"
    updated["resuming_at"] = _now_iso()
    _store_pending(platform_workspace_id, pending["thread_key"], updated)
    return updated


# ── Slack file handling ───────────────────────────────────────────────────────

SLACK_FILE_SIZE_LIMIT = 50 * 1024 * 1024  # 50 MB


async def _download_and_attach_slack_files(
    slack_files: list,
    bot_token: str,
    user_id: str,
    project_id: str,
    conversation: Dict[str, Any],
    bucket: str,
    keys: Dict[str, str],
) -> None:
    """
    Download each Slack file, upload to S3, create asset record, and attach
    an asset content node to the last user node in the conversation.
    Persists the updated conversation to S3 in place.
    """
    import aiohttp

    logger.info(
        "_download_and_attach_slack_files called with %d file(s): %s",
        len(slack_files),
        [sf.get("name", "<unnamed>") for sf in slack_files],
    )
    asset_nodes = []
    for sf in slack_files:
        filename = sf.get("name", "file")
        size = sf.get("size", 0)
        url = sf.get("url_private_download") or sf.get("url_private")
        mimetype = sf.get("mimetype", "")

        if not url:
            continue
        if size > SLACK_FILE_SIZE_LIMIT:
            logger.warning("Slack file %s exceeds 50 MB limit, skipping", filename)
            continue

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "csv"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, headers={"Authorization": f"Bearer {bot_token}"}
                ) as resp:
                    if resp.status != 200:
                        logger.error(
                            "Failed to download Slack file %s: HTTP %s",
                            filename,
                            resp.status,
                        )
                        continue
                    file_bytes = await resp.read()
        except Exception as exc:
            logger.error("Error downloading Slack file %s: %s", filename, exc)
            continue

        asset_id = str(uuid.uuid4())
        s3_key = (
            f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{asset_id}.{ext}"
        )

        try:
            s3 = boto3.client(
                "s3",
                region_name=config.aws.access_key.AWS_DEFAULT_REGION,
                aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
            )
            s3.put_object(
                Bucket=bucket,
                Key=s3_key,
                Body=file_bytes,
                ContentType=mimetype or "application/octet-stream",
            )
        except Exception as exc:
            logger.error("Failed to upload Slack file %s to S3: %s", filename, exc)
            continue

        try:
            assets_repo.create_asset(
                user_id=user_id,
                project_id=project_id,
                s3_bucket=bucket,
                s3_key=s3_key,
                asset_type="raw",
                size_bytes=len(file_bytes),
                checksum_sha256=None,
                version="1",
                content_type=mimetype or None,
                asset_id=asset_id,
                file_id=asset_id,
                original_filename=filename,
                extension=ext,
            )
        except Exception as exc:
            logger.error("Failed to create asset record for %s: %s", filename, exc)
            continue

        asset_nodes.append(
            {
                "type": "asset",
                "data": {
                    "asset_id": asset_id,
                    "file_id": asset_id,
                    "s3_bucket": bucket,
                    "s3_key": s3_key,
                    "extension": ext,
                    "filename": filename,
                },
            }
        )
        logger.info("Attached Slack file %s as asset %s", filename, asset_id)

    if not asset_nodes:
        return

    # Append asset nodes to the last user node's contents and mark them selected
    # so Morpheus downloads the uploaded files instead of treating the turn as
    # pure Q&A.
    nodes = conversation.get("nodes", [])
    for node in reversed(nodes):
        if node.get("role") == "user":
            node.setdefault("contents", []).extend(asset_nodes)
            _mark_user_node_assets_selected(
                node, [asset["data"]["asset_id"] for asset in asset_nodes]
            )
            break

    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)


async def _update_slack_clarification_card(
    client: Any, pending: Dict[str, Any]
) -> None:
    message = pending.get("message") or {}
    await client.chat_update(
        channel=message.get("channel_id"),
        ts=message.get("message_ts"),
        blocks=build_slack_clarification_blocks(pending, pending["project_id"]),
        text=_awaiting_message_text(pending["project_id"]),
    )


async def _post_slack_result(
    client: Any,
    pending: Dict[str, Any],
    final_meta: Dict[str, Any],
) -> None:
    message = pending.get("message") or {}
    narrative, dashboard_url, metrics, dashboard_json = _workspace_result(
        pending["user_id"],
        pending["project_id"],
        pending["conversation_id"],
        final_meta,
    )
    await client.chat_update(
        channel=message.get("channel_id"),
        ts=message.get("message_ts"),
        blocks=build_response_blocks(
            narrative, dashboard_url, CHAT_CREDIT_COST, metrics=metrics
        ),
        text=narrative,
    )
    thread_ts = message.get("thread_ts") or message.get("message_ts")
    if is_chart_rendering_enabled() and dashboard_json:
        for png_bytes, chart_title in render_dashboard_previews(
            dashboard_json, max_charts=3
        ):
            safe_name = chart_title.lower().replace(" ", "_").replace("/", "_")
            await client.files_upload_v2(
                channel=message.get("channel_id"),
                thread_ts=thread_ts,
                content=png_bytes,
                filename=f"{safe_name}.png",
                title=chart_title,
            )


async def _resume_slack_pending(
    client: Any, platform_workspace_id: str, pending: Dict[str, Any]
) -> None:
    if pending.get("status") == "resuming":
        return
    pending = _set_pending_resuming(platform_workspace_id, pending)
    message = pending.get("message") or {}
    await client.chat_update(
        channel=message.get("channel_id"),
        ts=message.get("message_ts"),
        blocks=build_status_blocks("Continuing analysis..."),
        text="Continuing analysis...",
    )
    bucket, keys = _append_clarification_response_node(pending)
    _call_morpheus(
        pending["conversation_id"],
        pending["project_id"],
        pending["user_id"],
        bucket,
        keys,
    )
    credit_service.consume_credits(pending["user_id"], CHAT_CREDIT_COST)
    final_status, _, final_meta = await _poll_workflow(pending["conversation_id"])
    if final_status == "awaiting_user_input":
        next_pending = _prepare_pending_from_conversation(
            platform="slack",
            platform_workspace_id=platform_workspace_id,
            thread_key=pending["thread_key"],
            conversation_id=pending["conversation_id"],
            project_id=pending["project_id"],
            user_id=pending["user_id"],
            bucket=bucket,
            keys=keys,
            message=message,
        )
        if next_pending:
            await _update_slack_clarification_card(client, next_pending)
            return
    _clear_pending(platform_workspace_id, pending["thread_key"])
    if final_status == "completed":
        await _post_slack_result(client, pending, final_meta)
        return
    err = _analysis_incomplete_message(pending["project_id"])
    await client.chat_update(
        channel=message.get("channel_id"),
        ts=message.get("message_ts"),
        blocks=build_error_blocks(err),
        text=err,
    )


async def handle_slack_clarification_interaction(payload: Dict[str, Any]) -> None:
    from slack_sdk.web.async_client import AsyncWebClient

    action = (payload.get("actions") or [{}])[0]
    value = action.get("value")
    if action.get("selected_option"):
        value = action["selected_option"].get("value")
    data = _decode_callback_value(str(value or ""))
    if not data:
        return
    team_id = ((payload.get("team") or {}).get("id") or "").strip()
    platform_workspace_id = f"slack:{team_id}"
    thread_key = str(data.get("thread_key") or "")
    _, pending = _get_active_pending(platform_workspace_id, thread_key)
    if not pending or data.get("nonce") != pending.get("nonce"):
        return
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    if not workspace:
        return
    client = AsyncWebClient(token=decrypt_token(workspace["bot_token_encrypted"]))

    action_name = data.get("action")
    if action_name == "select":
        updated = dict(pending)
        selected = dict(updated.get("selected_option_ids") or {})
        selected[str(data.get("clarification_id"))] = str(data.get("option_id"))
        updated["selected_option_ids"] = selected
        updated.pop("last_error", None)
        _store_pending(platform_workspace_id, thread_key, updated)
        await _update_slack_clarification_card(client, updated)
        return
    if action_name == "cancel":
        _append_no_answer_node(pending)
        _stop_pending_workflow(pending)
        _clear_pending(platform_workspace_id, thread_key)
        message = pending.get("message") or {}
        await client.chat_update(
            channel=message.get("channel_id"),
            ts=message.get("message_ts"),
            blocks=build_error_blocks("Clarification cancelled. No credits used."),
            text="Clarification cancelled.",
        )
        return
    if action_name == "continue":
        responses, _, error = _responses_from_pending(pending)
        if error or not responses:
            updated = dict(pending)
            updated["last_error"] = (
                error or "Please choose an option before continuing."
            )
            _store_pending(platform_workspace_id, thread_key, updated)
            await _update_slack_clarification_card(client, updated)
            return
        await _resume_slack_pending(client, platform_workspace_id, pending)


async def handle_slack_clarification_reply(
    query: str,
    platform_workspace_id: str,
    channel_id: str,
    thread_ts: str,
    bot_token_encrypted: str,
) -> None:
    from slack_sdk.web.async_client import AsyncWebClient

    thread_key = f"{channel_id}#{thread_ts}"
    _, pending = _get_active_pending(platform_workspace_id, thread_key)
    if not pending:
        return
    client = AsyncWebClient(token=decrypt_token(bot_token_encrypted))
    status, updated, error = parse_text_clarification_reply(pending, query)
    if status == "cancel":
        _append_no_answer_node(pending)
        _stop_pending_workflow(pending)
        _clear_pending(platform_workspace_id, thread_key)
        message = pending.get("message") or {}
        await client.chat_update(
            channel=message.get("channel_id"),
            ts=message.get("message_ts"),
            blocks=build_error_blocks("Clarification cancelled. No credits used."),
            text="Clarification cancelled.",
        )
        return
    if status != "valid" or not updated:
        pending["last_error"] = error or "Please reply with a listed option."
        _store_pending(platform_workspace_id, thread_key, pending)
        await _update_slack_clarification_card(client, pending)
        return
    _store_pending(platform_workspace_id, thread_key, updated)
    await _resume_slack_pending(client, platform_workspace_id, updated)


# ── Main entry point ──────────────────────────────────────────────────────────


async def handle_slack_query(
    query: str,
    platform_workspace_id: str,
    channel_id: str,
    thread_ts: str,
    bot_token_encrypted: str,
    slack_files: list = [],
) -> None:
    """
    Full lifecycle for a Slack @mention query. Runs as a background task.
    Uses the workspace's decrypted bot token for all Slack API calls.
    """
    from slack_sdk.web.async_client import AsyncWebClient

    try:
        bot_token = decrypt_token(bot_token_encrypted)
    except Exception as exc:
        logger.error(
            "Failed to decrypt bot token for %s: %s", platform_workspace_id, exc
        )
        return

    client = AsyncWebClient(token=bot_token)

    # Post placeholder immediately so the user sees activity
    placeholder_ts: Optional[str] = None
    try:
        resp = await client.chat_postMessage(
            channel=channel_id,
            thread_ts=thread_ts,
            blocks=build_analyzing_blocks(query),
            text="🔍 Analyzing...",
        )
        placeholder_ts = resp["ts"]
    except Exception as exc:
        logger.error("Failed to post placeholder to Slack: %s", exc)
        return

    async def update_status(label: str) -> None:
        if placeholder_ts:
            try:
                await client.chat_update(
                    channel=channel_id,
                    ts=placeholder_ts,
                    blocks=build_status_blocks(label),
                    text=label,
                )
            except Exception as exc:
                logger.warning("Failed to update status message: %s", exc)

    try:
        workspace = chat_platform_repo.get_workspace(platform_workspace_id)
        if not workspace:
            raise RuntimeError(f"Workspace {platform_workspace_id} not found")

        user_id = workspace["user_id"]
        thread_key = f"{channel_id}#{thread_ts}"
        conversation_id, project_id, is_new = _get_or_create_session(
            platform_workspace_id, thread_key, workspace
        )

        if is_new:
            bucket, keys = _save_new_conversation(
                user_id, project_id, conversation_id, query
            )
        else:
            bucket, keys = _append_user_node_to_conversation(
                user_id, project_id, conversation_id, query
            )
            # Point new keys for this turn
            chat_platform_repo.update_session_conversation(
                platform_workspace_id, thread_key, conversation_id
            )

        await asyncio.sleep(0.5)  # S3 eventual consistency buffer

        if slack_files:
            try:
                conv = load_conversation(bucket, keys["primary"])
                await _download_and_attach_slack_files(
                    slack_files, bot_token, user_id, project_id, conv, bucket, keys
                )
                await asyncio.sleep(0.5)  # S3 consistency after file upload
            except Exception as exc:
                logger.error(
                    "Failed to attach Slack files for conversation %s: %s",
                    conversation_id,
                    exc,
                    exc_info=True,
                )

        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)

        final_status, _, final_meta = await _poll_workflow(
            conversation_id, on_step=update_status
        )

        if final_status == "awaiting_user_input":
            pending = _prepare_pending_from_conversation(
                platform="slack",
                platform_workspace_id=platform_workspace_id,
                thread_key=thread_key,
                conversation_id=conversation_id,
                project_id=project_id,
                user_id=user_id,
                bucket=bucket,
                keys=keys,
                message={
                    "channel_id": channel_id,
                    "message_ts": placeholder_ts,
                    "thread_ts": thread_ts,
                },
            )
            if pending:
                await _update_slack_clarification_card(client, pending)
                return

        if final_status != "completed":
            message = _analysis_incomplete_message(project_id)
            logger.info(
                "Workspace Slack workflow %s ended with status %s",
                conversation_id,
                final_status,
            )
            await client.chat_update(
                channel=channel_id,
                ts=placeholder_ts,
                blocks=build_error_blocks(message),
                text=message,
            )
            return

        # For plain Q&A responses Morpheus puts the reply directly in the status metadata,
        # so we can skip the S3 load entirely.
        metrics: list = []
        dashboard_json: Optional[Dict[str, Any]] = None
        if final_meta.get("response_type") in (
            "message",
            "answer_with_visual",
        ) and final_meta.get("content"):
            narrative = final_meta["content"]
            dashboard_url = None
            logger.info(
                "Using inline narrative from workflow metadata (len=%d)", len(narrative)
            )
        else:
            # Load completed conversation and extract narrative
            logger.info("Workflow completed, loading conversation %s", conversation_id)
            conversation_meta = conversations_repo.get_conversation(
                project_id, conversation_id
            )
            if not conversation_meta:
                raise RuntimeError(
                    f"Post-poll: conversation {conversation_id} not found in DynamoDB"
                )
            logger.info(
                "Loading S3 conversation from %s/%s",
                conversation_meta["s3_bucket"],
                conversation_meta["s3_key"],
            )
            conversation = load_conversation(
                conversation_meta["s3_bucket"], conversation_meta["s3_key"]
            )
            narrative = (
                _extract_narrative(conversation)
                or "Analysis complete. No narrative returned."
            )
            dashboard_url = _build_dashboard_url(project_id, conversation)

            # Auto-enable public preview and extract dashboard metrics
            dashboards = conversation.get("dashboards", [])
            if dashboards:
                try:
                    projects_repo.update_project(
                        user_id=user_id,
                        project_id=project_id,
                        is_preview_public=True,
                    )
                    logger.info("Enabled public preview for project %s", project_id)
                except Exception as exc:
                    logger.warning(
                        "Failed to enable public preview for %s: %s", project_id, exc
                    )

                s3_uri = dashboards[-1].get("s3_uri")
                if s3_uri:
                    dashboard_json = _load_dashboard_json(s3_uri)
                    if dashboard_json:
                        metrics = _extract_top_metrics(dashboard_json)
                        logger.info(
                            "Extracted %d metric(s) from dashboard", len(metrics)
                        )

        logger.info("Updating Slack message with narrative (len=%d)", len(narrative))

        await client.chat_update(
            channel=channel_id,
            ts=placeholder_ts,
            blocks=build_response_blocks(
                narrative, dashboard_url, CHAT_CREDIT_COST, metrics=metrics
            ),
            text=narrative,
        )
        logger.info(
            "Successfully updated Slack message for conversation %s", conversation_id
        )

        # Phase 2B — upload chart preview PNGs into the thread (opt-in)
        if is_chart_rendering_enabled() and dashboard_json:
            chart_previews = render_dashboard_previews(dashboard_json, max_charts=3)
            for png_bytes, chart_title in chart_previews:
                try:
                    safe_name = chart_title.lower().replace(" ", "_").replace("/", "_")
                    await client.files_upload_v2(
                        channel=channel_id,
                        thread_ts=thread_ts,
                        content=png_bytes,
                        filename=f"{safe_name}.png",
                        title=chart_title,
                    )
                    logger.info("Uploaded chart image '%s'", chart_title)
                except Exception as exc:
                    logger.warning("Failed to upload chart '%s': %s", chart_title, exc)

    except Exception as exc:
        logger.error(
            "handle_slack_query failed for %s: %s",
            platform_workspace_id,
            exc,
            exc_info=True,
        )
        if placeholder_ts:
            try:
                await client.chat_update(
                    channel=channel_id,
                    ts=placeholder_ts,
                    blocks=build_error_blocks(
                        "Something went wrong. Please try again."
                    ),
                    text="Error.",
                )
            except Exception:
                pass


# ── Scheduled sync → Slack ────────────────────────────────────────────────────

_PROVIDER_LABELS_SLACK: Dict[str, str] = {
    "ga4": "Google Analytics 4",
    "meta_ads": "Meta Ads",
    "tiktok": "TikTok Ads",
    "appsflyer": "AppsFlyer",
    "stripe": "Stripe",
    "hubspot": "HubSpot",
    "salesforce": "Salesforce",
    "pipedrive": "Pipedrive",
    "shopify": "Shopify",
    "klaviyo": "Klaviyo",
    "quickbooks": "QuickBooks",
    "zendesk": "Zendesk",
    "mixpanel": "Mixpanel",
    "posthog": "PostHog",
    "customer_io": "Customer.io",
    "google_search_console": "Google Search Console",
    "amazon_seller": "Amazon Seller",
    "tiktok_shop_seller": "TikTok Shop Seller",
    "shopee_seller": "Shopee Seller",
    "lazada_seller": "Lazada Seller",
    "supabase": "Supabase",
}

SYNC_ANALYSIS_PROMPT = (
    "Summarize this data with the most important KPIs, trends, and insights. "
    "Be concise — 3-5 sentences max."
)


async def post_sync_to_slack(
    user_id: str,
    project_id: str,
    channel_id: str,
    provider: str,
    account_name: str,
    rows_fetched: Optional[int],
    asset: Dict[str, Any],
) -> None:
    """
    After a scheduled sync completes:
    1. Post placeholder to Slack channel
    2. Create a new conversation with the synced asset
    3. Trigger Morpheus analysis
    4. Poll for completion
    5. Update Slack with narrative + [Open Dashboard →] button
    """
    from slack_sdk.web.async_client import AsyncWebClient

    provider_label = _PROVIDER_LABELS_SLACK.get(provider, provider)

    # 1. Find the user's connected Slack workspace and decrypt token
    workspace = chat_platform_repo.get_workspace_by_user(user_id, "slack")
    if not workspace:
        logger.info(
            "No Slack workspace connected for user %s — skipping Slack post", user_id
        )
        return
    try:
        bot_token = decrypt_token(workspace["bot_token_encrypted"])
    except Exception as exc:
        logger.error("Failed to decrypt bot token for user %s: %s", user_id, exc)
        return

    client = AsyncWebClient(token=bot_token)

    # 2. Post placeholder immediately
    placeholder_ts: Optional[str] = None
    try:
        resp = await client.chat_postMessage(
            channel=channel_id,
            blocks=build_sync_placeholder_blocks(
                provider_label, account_name, rows_fetched
            ),
            text=f"✅ {account_name} synced · Analyzing…",
        )
        placeholder_ts = resp["ts"]
    except Exception as exc:
        logger.error("Failed to post sync placeholder to Slack: %s", exc)
        return

    # 3. Create a new conversation with text prompt + asset content
    conversation_id = str(uuid.uuid4())
    now_iso = utc_now_iso()
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    keys = _build_conversation_keys(user_id, project_id, conversation_id)

    asset_content = {
        "type": "asset",
        "data": {
            "asset_id": asset.get("asset_id"),
            "file_id": asset.get("file_id") or asset.get("asset_id"),
            "s3_bucket": asset.get("s3_bucket"),
            "s3_key": asset.get("s3_key"),
            "extension": asset.get("extension", ""),
            "filename": asset.get("filename", ""),
            "sourceType": asset.get("asset_type", ""),
        },
    }
    user_node = {
        "node_id": f"node_{uuid.uuid4().hex[:8]}",
        "role": "user",
        "status": "completed",
        "created_at": now_iso,
        "contents": [
            {"type": "text", "data": {"text": SYNC_ANALYSIS_PROMPT}},
            asset_content,
        ],
        "metadata": {
            "chat_mode": CHAT_MODEL_ALIAS,
            "resolved_model": CHAT_MODEL_ID,
            "asset_selection": "explicit",
            "selected_asset_ids": [
                asset_id for asset_id in [asset.get("asset_id")] if asset_id
            ],
        },
    }
    conversation = {
        "user_id": user_id,
        "project_id": project_id,
        "conversation_id": conversation_id,
        "created_at": now_iso,
        "updated_at": now_iso,
        "metadata": {
            "status": "active",
            "chat_mode": CHAT_MODEL_ALIAS,
            "resolved_model": CHAT_MODEL_ID,
            "source": "scheduled_sync",
            "project": {"project_id": project_id, "user_id": user_id},
        },
        "nodes": [_make_greeting_node(), user_node],
        "dashboards": [],
    }

    try:
        save_conversation(bucket, keys["primary"], conversation)
        save_conversation(bucket, keys["backup"], conversation)
        conversations_repo.create_conversation(
            project_id=project_id,
            user_id=user_id,
            s3_bucket=bucket,
            s3_key=keys["primary"],
            title=f"{account_name} auto-analysis",
            metadata={"source": "scheduled_sync"},
            conversation_id=conversation_id,
            node_count=len(conversation["nodes"]),
        )
        # Update project's latest_conversation_id
        projects_repo.update_project(
            user_id=user_id,
            project_id=project_id,
            latest_conversation_id=conversation_id,
        )
    except Exception as exc:
        logger.error(
            "Failed to save sync analysis conversation %s: %s", conversation_id, exc
        )
        await _update_slack_error(client, channel_id, placeholder_ts)
        return

    await asyncio.sleep(0.5)

    # 4. Trigger Morpheus
    try:
        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)
    except Exception as exc:
        logger.error(
            "Failed to trigger Morpheus for sync analysis %s: %s", conversation_id, exc
        )
        await _update_slack_error(client, channel_id, placeholder_ts)
        return

    # 5. Poll for completion
    async def _on_step(label: str) -> None:
        if placeholder_ts:
            try:
                await client.chat_update(
                    channel=channel_id,
                    ts=placeholder_ts,
                    blocks=build_status_blocks(label),
                    text=label,
                )
            except Exception:
                pass

    final_status, _, final_meta = await _poll_workflow(
        conversation_id, on_step=_on_step
    )

    if final_status == "awaiting_user_input":
        platform_workspace_id = workspace["platform_workspace_id"]
        thread_key = f"{channel_id}#{placeholder_ts}"
        if not chat_platform_repo.get_session(platform_workspace_id, thread_key):
            chat_platform_repo.create_session(
                platform_workspace_id=platform_workspace_id,
                thread_key=thread_key,
                conversation_id=conversation_id,
                project_id=project_id,
                user_id=user_id,
            )
        pending = _prepare_pending_from_conversation(
            platform="slack",
            platform_workspace_id=platform_workspace_id,
            thread_key=thread_key,
            conversation_id=conversation_id,
            project_id=project_id,
            user_id=user_id,
            bucket=bucket,
            keys=keys,
            message={
                "channel_id": channel_id,
                "message_ts": placeholder_ts,
                "thread_ts": placeholder_ts,
            },
        )
        if pending:
            await _update_slack_clarification_card(client, pending)
            return

    if final_status != "completed":
        logger.info(
            "Scheduled Slack workspace workflow %s ended with status %s",
            conversation_id,
            final_status,
        )
        await _update_slack_error(
            client,
            channel_id,
            placeholder_ts,
            _analysis_incomplete_message(project_id),
        )
        return

    # 6. Extract result and update Slack message
    metrics: list = []
    dashboard_url: Optional[str] = None
    if final_meta.get("response_type") in (
        "message",
        "answer_with_visual",
    ) and final_meta.get("content"):
        narrative = final_meta["content"]
    else:
        try:
            conversation_meta = conversations_repo.get_conversation(
                project_id, conversation_id
            )
            if conversation_meta:
                conv = load_conversation(
                    conversation_meta["s3_bucket"], conversation_meta["s3_key"]
                )
                narrative = _extract_narrative(conv) or "Analysis complete."
                dashboard_url = _build_dashboard_url(project_id, conv)
                dashboards = conv.get("dashboards", [])
                if dashboards:
                    projects_repo.update_project(
                        user_id=user_id, project_id=project_id, is_preview_public=True
                    )
                    s3_uri = dashboards[-1].get("s3_uri")
                    if s3_uri:
                        dj = _load_dashboard_json(s3_uri)
                        if dj:
                            metrics = _extract_top_metrics(dj)
            else:
                narrative = "Analysis complete."
        except Exception as exc:
            logger.error("Failed to load sync analysis result: %s", exc)
            narrative = "Analysis complete. View results in Dreamify."

    try:
        await client.chat_update(
            channel=channel_id,
            ts=placeholder_ts,
            blocks=build_sync_result_blocks(
                provider_label,
                account_name,
                rows_fetched,
                narrative,
                dashboard_url,
                metrics,
            ),
            text=narrative,
        )
    except Exception as exc:
        logger.warning("Failed to post sync analysis result to Slack: %s", exc)


async def trigger_auto_refresh(
    user_id: str,
    project_id: str,
    conversation_id: str,
    asset: Dict[str, Any],
    prompt: str = "Refresh this dashboard with the latest synced data.",
) -> None:
    """
    Re-run Morpheus on an existing conversation with a new asset.
    Called after a scheduled sync when auto_refresh_conversation_id is set.
    Fire-and-forget — does not wait for completion.
    """
    try:
        bucket = config.aws.s3.USER_ASSETS_BUCKET
        keys = _build_conversation_keys(user_id, project_id, conversation_id)

        conversation_meta = conversations_repo.get_conversation(
            project_id, conversation_id
        )
        if not conversation_meta:
            logger.warning(
                "Auto-refresh: conversation %s not found in DynamoDB — skipping",
                conversation_id,
            )
            return

        conversation = load_conversation(
            conversation_meta["s3_bucket"], conversation_meta["s3_key"]
        )

        now_iso = utc_now_iso()
        asset_content = {
            "type": "asset",
            "data": {
                "asset_id": asset.get("asset_id"),
                "file_id": asset.get("file_id") or asset.get("asset_id"),
                "s3_bucket": asset.get("s3_bucket"),
                "s3_key": asset.get("s3_key"),
                "extension": asset.get("extension", ""),
                "filename": asset.get("filename", ""),
                "sourceType": asset.get("asset_type", ""),
            },
        }
        user_node = {
            "node_id": f"node_{uuid.uuid4().hex[:8]}",
            "role": "user",
            "status": "completed",
            "created_at": now_iso,
            "contents": [
                {"type": "text", "data": {"text": prompt}},
                asset_content,
            ],
            "metadata": {
                "chat_mode": CHAT_MODEL_ALIAS,
                "resolved_model": CHAT_MODEL_ID,
                "asset_selection": "explicit",
                "selected_asset_ids": [
                    asset_id for asset_id in [asset.get("asset_id")] if asset_id
                ],
            },
        }
        conversation.setdefault("nodes", []).append(user_node)
        conversation["updated_at"] = now_iso

        save_conversation(bucket, keys["primary"], conversation)
        save_conversation(bucket, keys["backup"], conversation)

        # Update conversation metadata in DynamoDB
        existing_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if existing_meta:
            conversations_repo.update_conversation_metadata(
                project_id,
                conversation_id,
                {**existing_meta.get("metadata", {}), "source": "auto_refresh"},
            )

        await asyncio.sleep(0.3)
        _call_morpheus(
            conversation_id,
            project_id,
            user_id,
            bucket,
            keys,
            skip_ask_first=True,
        )
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)
        logger.info(
            "Auto-refresh triggered for conversation %s in project %s",
            conversation_id,
            project_id,
        )
    except Exception as exc:
        logger.error(
            "Auto-refresh failed for conversation %s: %s",
            conversation_id,
            exc,
            exc_info=True,
        )


async def _update_slack_error(
    client: Any,
    channel_id: str,
    placeholder_ts: Optional[str],
    msg: str = "Something went wrong.",
) -> None:
    if placeholder_ts:
        try:
            from app.services.slack_service import build_error_blocks

            await client.chat_update(
                channel=channel_id,
                ts=placeholder_ts,
                blocks=build_error_blocks(msg),
                text=msg,
            )
        except Exception:
            pass


# ── Telegram file handling ────────────────────────────────────────────────────

TELEGRAM_FILE_SIZE_LIMIT = 20 * 1024 * 1024  # 20 MB (Telegram Bot API limit)


async def _download_and_attach_telegram_files(
    telegram_files: list,
    user_id: str,
    project_id: str,
    conversation: Dict[str, Any],
    bucket: str,
    keys: Dict[str, str],
) -> None:
    """
    Download pre-resolved Telegram document files, upload to S3, create asset records,
    and attach asset content nodes to the last user node in the conversation.

    `telegram_files` is a list of rich dicts produced by _fetch_telegram_document_metadata
    in the webhook handler: {filename, size, ext, download_url}.  The download URL is
    already resolved so no extra bot.get_file() call is needed here.
    """
    import aiohttp

    logger.info(
        "_download_and_attach_telegram_files called with %d file(s): %s",
        len(telegram_files),
        [f.get("filename", "<unnamed>") for f in telegram_files],
    )
    asset_nodes = []
    for tf in telegram_files:
        filename = tf.get("filename", "file")
        size = tf.get("size", 0)
        ext = tf.get("ext", "bin")
        download_url = tf.get("download_url", "")

        if not download_url:
            logger.warning("Telegram file %s has no download URL, skipping", filename)
            continue
        if size > TELEGRAM_FILE_SIZE_LIMIT:
            logger.warning("Telegram file %s exceeds 20 MB limit, skipping", filename)
            continue

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(download_url) as resp:
                    if resp.status != 200:
                        logger.error(
                            "Failed to download Telegram file %s: HTTP %s",
                            filename,
                            resp.status,
                        )
                        continue
                    file_bytes = await resp.read()
        except Exception as exc:
            logger.error("Error downloading Telegram file %s: %s", filename, exc)
            continue

        if len(file_bytes) > TELEGRAM_FILE_SIZE_LIMIT:
            logger.warning("Telegram file %s exceeds 20 MB limit, skipping", filename)
            continue

        asset_id = str(uuid.uuid4())
        s3_key = (
            f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{asset_id}.{ext}"
        )

        try:
            s3 = boto3.client(
                "s3",
                region_name=config.aws.access_key.AWS_DEFAULT_REGION,
                aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
            )
            s3.put_object(Bucket=bucket, Key=s3_key, Body=file_bytes)
        except Exception as exc:
            logger.error("Failed to upload Telegram file %s to S3: %s", filename, exc)
            continue

        try:
            assets_repo.create_asset(
                user_id=user_id,
                project_id=project_id,
                s3_bucket=bucket,
                s3_key=s3_key,
                asset_type="raw",
                size_bytes=len(file_bytes),
                checksum_sha256=None,
                version="1",
                content_type=None,
                asset_id=asset_id,
                file_id=asset_id,
                original_filename=filename,
                extension=ext,
            )
        except Exception as exc:
            logger.error(
                "Failed to create asset record for Telegram file %s: %s", filename, exc
            )
            continue

        asset_nodes.append(
            {
                "type": "asset",
                "data": {
                    "asset_id": asset_id,
                    "file_id": asset_id,
                    "s3_bucket": bucket,
                    "s3_key": s3_key,
                    "extension": ext,
                    "filename": filename,
                },
            }
        )
        logger.info("Attached Telegram file %s as asset %s", filename, asset_id)

    if not asset_nodes:
        return

    nodes = conversation.get("nodes", [])
    for node in reversed(nodes):
        if node.get("role") == "user":
            node.setdefault("contents", []).extend(asset_nodes)
            _mark_user_node_assets_selected(
                node, [asset["data"]["asset_id"] for asset in asset_nodes]
            )
            break

    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)


async def _update_telegram_clarification_card(
    bot: Any, pending: Dict[str, Any]
) -> None:
    message = pending.get("message") or {}
    text, reply_markup = build_telegram_clarification_message(
        pending, pending["project_id"]
    )
    await bot.edit_message_text(
        chat_id=message.get("chat_id"),
        message_id=message.get("message_id"),
        text=text,
        parse_mode="MarkdownV2",
        reply_markup=reply_markup,
    )


async def _post_telegram_result(
    bot: Any, pending: Dict[str, Any], final_meta: Dict[str, Any]
) -> None:
    from app.services.telegram_service import (
        build_dashboard_keyboard,
        format_response_message,
    )

    message = pending.get("message") or {}
    narrative, dashboard_url, metrics, dashboard_json = _workspace_result(
        pending["user_id"],
        pending["project_id"],
        pending["conversation_id"],
        final_meta,
    )
    reply_markup = build_dashboard_keyboard(dashboard_url) if dashboard_url else None
    await bot.edit_message_text(
        chat_id=message.get("chat_id"),
        message_id=message.get("message_id"),
        text=format_response_message(
            narrative, dashboard_url, CHAT_CREDIT_COST, metrics
        ),
        parse_mode="MarkdownV2",
        reply_markup=reply_markup,
    )
    if is_chart_rendering_enabled() and dashboard_json:
        from telegram import InputMediaPhoto

        previews = render_dashboard_previews(dashboard_json, max_charts=4)
        if len(previews) == 1:
            png_bytes, chart_title = previews[0]
            await bot.send_photo(
                chat_id=message.get("chat_id"),
                photo=png_bytes,
                caption=chart_title[:1024],
                message_thread_id=message.get("message_thread_id"),
            )
        elif len(previews) > 1:
            media = [
                InputMediaPhoto(media=png, caption=title[:1024])
                for png, title in previews
            ]
            await bot.send_media_group(
                chat_id=message.get("chat_id"),
                media=media,
                message_thread_id=message.get("message_thread_id"),
            )


async def _resume_telegram_pending(
    bot: Any, platform_workspace_id: str, pending: Dict[str, Any]
) -> None:
    from app.services.telegram_service import (
        format_status_message,
        format_error_message,
    )

    if pending.get("status") == "resuming":
        return
    pending = _set_pending_resuming(platform_workspace_id, pending)
    message = pending.get("message") or {}
    await bot.edit_message_text(
        chat_id=message.get("chat_id"),
        message_id=message.get("message_id"),
        text=format_status_message("Continuing analysis..."),
        parse_mode="MarkdownV2",
    )
    bucket, keys = _append_clarification_response_node(pending)
    _call_morpheus(
        pending["conversation_id"],
        pending["project_id"],
        pending["user_id"],
        bucket,
        keys,
    )
    credit_service.consume_credits(pending["user_id"], CHAT_CREDIT_COST)
    final_status, _, final_meta = await _poll_workflow(pending["conversation_id"])
    if final_status == "awaiting_user_input":
        next_pending = _prepare_pending_from_conversation(
            platform="telegram",
            platform_workspace_id=platform_workspace_id,
            thread_key=pending["thread_key"],
            conversation_id=pending["conversation_id"],
            project_id=pending["project_id"],
            user_id=pending["user_id"],
            bucket=bucket,
            keys=keys,
            message=message,
        )
        if next_pending:
            await _update_telegram_clarification_card(bot, next_pending)
            return
    _clear_pending(platform_workspace_id, pending["thread_key"])
    if final_status == "completed":
        await _post_telegram_result(bot, pending, final_meta)
        return
    await bot.edit_message_text(
        chat_id=message.get("chat_id"),
        message_id=message.get("message_id"),
        text=format_error_message(_analysis_incomplete_message(pending["project_id"])),
        parse_mode="MarkdownV2",
    )


async def handle_telegram_clarification_callback(callback: Dict[str, Any]) -> None:
    from app.services.telegram_service import get_telegram_bot

    bot = await get_telegram_bot()
    callback_id = callback.get("id")
    if callback_id:
        try:
            await bot.answer_callback_query(callback_query_id=callback_id)
        except Exception as exc:
            logger.debug("Telegram answer_callback_query failed: %s", exc)
    data = _parse_telegram_callback_data(str(callback.get("data") or ""))
    message = callback.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")
    if not data or not chat_id:
        return
    thread_key = f"{chat_id}#{message.get('message_thread_id') or 0}"
    platform_workspace_id = f"telegram:{chat_id}"
    _, pending = _get_active_pending(platform_workspace_id, thread_key)
    if not pending or data.get("nonce") != pending.get("nonce"):
        return

    action = data.get("action")
    if action == "s":
        try:
            clarification = pending["clarifications"][data["clarification_index"]]
            option = _valid_options(clarification)[data["option_index"]]
        except Exception:
            return
        updated = dict(pending)
        selected = dict(updated.get("selected_option_ids") or {})
        selected[str(clarification["clarification_id"])] = str(option["id"])
        updated["selected_option_ids"] = selected
        updated.pop("last_error", None)
        _store_pending(platform_workspace_id, thread_key, updated)
        await _update_telegram_clarification_card(bot, updated)
        return
    if action == "x":
        _append_no_answer_node(pending)
        _stop_pending_workflow(pending)
        _clear_pending(platform_workspace_id, thread_key)
        from app.services.telegram_service import format_error_message

        await bot.edit_message_text(
            chat_id=chat_id,
            message_id=message.get("message_id"),
            text=format_error_message("Clarification cancelled. No credits used."),
            parse_mode="MarkdownV2",
        )
        return
    if action == "go":
        responses, _, error = _responses_from_pending(pending)
        if error or not responses:
            updated = dict(pending)
            updated["last_error"] = (
                error or "Please choose an option before continuing."
            )
            _store_pending(platform_workspace_id, thread_key, updated)
            await _update_telegram_clarification_card(bot, updated)
            return
        await _resume_telegram_pending(bot, platform_workspace_id, pending)


async def handle_telegram_clarification_reply(
    query: str,
    platform_workspace_id: str,
    chat_id: int,
    message_thread_id: Optional[int],
) -> None:
    from app.services.telegram_service import get_telegram_bot

    thread_key = f"{chat_id}#{message_thread_id or 0}"
    _, pending = _get_active_pending(platform_workspace_id, thread_key)
    if not pending:
        return
    bot = await get_telegram_bot()
    status, updated, error = parse_text_clarification_reply(pending, query)
    if status == "cancel":
        _append_no_answer_node(pending)
        _stop_pending_workflow(pending)
        _clear_pending(platform_workspace_id, thread_key)
        from app.services.telegram_service import format_error_message

        message = pending.get("message") or {}
        await bot.edit_message_text(
            chat_id=chat_id,
            message_id=message.get("message_id"),
            text=format_error_message("Clarification cancelled. No credits used."),
            parse_mode="MarkdownV2",
        )
        return
    if status != "valid" or not updated:
        pending["last_error"] = error or "Please reply with a listed option."
        _store_pending(platform_workspace_id, thread_key, pending)
        await _update_telegram_clarification_card(bot, pending)
        return
    _store_pending(platform_workspace_id, thread_key, updated)
    await _resume_telegram_pending(bot, platform_workspace_id, updated)


# ── Telegram main entry point ─────────────────────────────────────────────────


async def handle_telegram_query(
    query: str,
    platform_workspace_id: str,
    chat_id: int,
    message_thread_id: Optional[int],
    telegram_files: list = [],
) -> None:
    """
    Full lifecycle for a Telegram message query. Runs as a background task.
    Mirrors handle_slack_query but uses Telegram Bot API instead of Slack SDK.

    `telegram_files` is a list of pre-resolved file metadata dicts produced by
    _fetch_telegram_document_metadata in the webhook handler.
    """
    from app.services.telegram_service import (
        build_dashboard_keyboard,
        format_analyzing_message,
        format_error_message,
        format_response_message,
        format_status_message,
        get_telegram_bot,
    )

    try:
        bot = await get_telegram_bot()
    except RuntimeError as exc:
        logger.error("Telegram bot not configured: %s", exc)
        return

    # Post placeholder immediately
    placeholder_message_id: Optional[int] = None
    try:
        msg = await bot.send_message(
            chat_id=chat_id,
            text=format_analyzing_message(query),
            parse_mode="MarkdownV2",
            message_thread_id=message_thread_id,
        )
        placeholder_message_id = msg.message_id
    except Exception as exc:
        logger.error("Failed to post placeholder to Telegram chat %s: %s", chat_id, exc)
        return

    async def update_status(label: str) -> None:
        if placeholder_message_id:
            try:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=placeholder_message_id,
                    text=format_status_message(label),
                    parse_mode="MarkdownV2",
                )
            except Exception as exc:
                logger.warning("Failed to update Telegram status message: %s", exc)

    try:
        workspace = chat_platform_repo.get_workspace(platform_workspace_id)
        if not workspace:
            raise RuntimeError(f"Workspace {platform_workspace_id} not found")

        user_id = workspace["user_id"]
        thread_key = f"{chat_id}#{message_thread_id or 0}"
        conversation_id, project_id, is_new = _get_or_create_session(
            platform_workspace_id, thread_key, workspace
        )

        if is_new:
            bucket, keys = _save_new_conversation(
                user_id, project_id, conversation_id, query
            )
        else:
            bucket, keys = _append_user_node_to_conversation(
                user_id, project_id, conversation_id, query
            )
            chat_platform_repo.update_session_conversation(
                platform_workspace_id, thread_key, conversation_id
            )

        await asyncio.sleep(0.5)

        if telegram_files:
            try:
                conv = load_conversation(bucket, keys["primary"])
                await _download_and_attach_telegram_files(
                    telegram_files, user_id, project_id, conv, bucket, keys
                )
                await asyncio.sleep(0.5)
            except Exception as exc:
                logger.error(
                    "Failed to attach Telegram files for conversation %s: %s",
                    conversation_id,
                    exc,
                    exc_info=True,
                )

        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)

        final_status, _, final_meta = await _poll_workflow(
            conversation_id, on_step=update_status
        )

        if final_status == "awaiting_user_input":
            pending = _prepare_pending_from_conversation(
                platform="telegram",
                platform_workspace_id=platform_workspace_id,
                thread_key=thread_key,
                conversation_id=conversation_id,
                project_id=project_id,
                user_id=user_id,
                bucket=bucket,
                keys=keys,
                message={
                    "chat_id": chat_id,
                    "message_id": placeholder_message_id,
                    "message_thread_id": message_thread_id,
                },
            )
            if pending:
                await _update_telegram_clarification_card(bot, pending)
                return

        if final_status != "completed":
            message = _analysis_incomplete_message(project_id)
            logger.info(
                "Workspace Telegram workflow %s ended with status %s",
                conversation_id,
                final_status,
            )
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=placeholder_message_id,
                text=format_error_message(message),
                parse_mode="MarkdownV2",
            )
            return

        metrics: list = []
        dashboard_url: Optional[str] = None
        dashboard_json: Optional[Dict[str, Any]] = None

        if final_meta.get("response_type") in (
            "message",
            "answer_with_visual",
        ) and final_meta.get("content"):
            narrative = final_meta["content"]
            logger.info(
                "Using inline narrative from Telegram workflow metadata (len=%d)",
                len(narrative),
            )
        else:
            conversation_meta = conversations_repo.get_conversation(
                project_id, conversation_id
            )
            if not conversation_meta:
                raise RuntimeError(
                    f"Post-poll: conversation {conversation_id} not found in DynamoDB"
                )
            conversation = load_conversation(
                conversation_meta["s3_bucket"], conversation_meta["s3_key"]
            )
            narrative = (
                _extract_narrative(conversation)
                or "Analysis complete. No narrative returned."
            )
            dashboard_url = _build_dashboard_url(project_id, conversation)

            dashboards = conversation.get("dashboards", [])
            if dashboards:
                try:
                    projects_repo.update_project(
                        user_id=user_id,
                        project_id=project_id,
                        is_preview_public=True,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to enable public preview for %s: %s", project_id, exc
                    )

                s3_uri = dashboards[-1].get("s3_uri")
                if s3_uri:
                    dashboard_json = _load_dashboard_json(s3_uri)
                    if dashboard_json:
                        metrics = _extract_top_metrics(dashboard_json)

        reply_markup = (
            build_dashboard_keyboard(dashboard_url) if dashboard_url else None
        )
        await bot.edit_message_text(
            chat_id=chat_id,
            message_id=placeholder_message_id,
            text=format_response_message(
                narrative, dashboard_url, CHAT_CREDIT_COST, metrics
            ),
            parse_mode="MarkdownV2",
            reply_markup=reply_markup,
        )
        logger.info(
            "Successfully updated Telegram message for conversation %s", conversation_id
        )

        # Phase 2B — upload chart previews into the chat (opt-in via ENABLE_CHART_RENDERING).
        # Album for 2-10 charts, single send_photo for 1.
        if is_chart_rendering_enabled() and dashboard_json:
            chart_previews = render_dashboard_previews(dashboard_json, max_charts=4)
            if chart_previews:
                try:
                    from telegram import InputMediaPhoto

                    if len(chart_previews) == 1:
                        png_bytes, chart_title = chart_previews[0]
                        await bot.send_photo(
                            chat_id=chat_id,
                            photo=png_bytes,
                            caption=chart_title[:1024],
                            message_thread_id=message_thread_id,
                        )
                    else:
                        media = [
                            InputMediaPhoto(media=png, caption=title[:1024])
                            for png, title in chart_previews
                        ]
                        await bot.send_media_group(
                            chat_id=chat_id,
                            media=media,
                            message_thread_id=message_thread_id,
                        )
                    logger.info(
                        "Sent %d chart preview(s) to Telegram", len(chart_previews)
                    )
                except Exception as exc:
                    logger.warning("Failed to send Telegram chart previews: %s", exc)

    except Exception as exc:
        logger.error(
            "handle_telegram_query failed for %s: %s",
            platform_workspace_id,
            exc,
            exc_info=True,
        )
        if placeholder_message_id:
            try:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=placeholder_message_id,
                    text=format_error_message(
                        "Something went wrong. Please try again."
                    ),
                    parse_mode="MarkdownV2",
                )
            except Exception:
                pass


# ── Zalo file handling ────────────────────────────────────────────────────────

ZALO_FILE_SIZE_LIMIT = 5 * 1024 * 1024  # 5 MB (Zalo Bot Platform default)


def _download_and_attach_zalo_files(
    file_ids: list,
    user_id: str,
    project_id: str,
    conversation: Dict[str, Any],
    bucket: str,
    keys: Dict[str, str],
) -> None:
    """
    Resolve Zalo file_ids via getFile, download, push to S3, and attach asset
    nodes to the last user node in the conversation. Synchronous (uses requests)
    to match zalo_service's HTTP client.
    """
    from app.services import zalo_service

    asset_nodes = []
    for file_id in file_ids:
        info = zalo_service.get_file(file_id)
        if not info or not info.get("ok"):
            logger.warning("Failed to resolve Zalo file %s", file_id)
            continue

        result = info.get("result", {}) or {}
        download_url = result.get("file_url") or result.get("file_path") or ""
        filename = (
            download_url.rsplit("/", 1)[-1] if download_url else f"{file_id}.bin"
        ).split("?")[0]
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"

        if not download_url:
            logger.warning("Zalo getFile returned no URL for %s", file_id)
            continue

        try:
            resp = requests.get(download_url, timeout=20)
            if resp.status_code != 200:
                logger.error(
                    "Failed to download Zalo file %s: HTTP %s",
                    file_id,
                    resp.status_code,
                )
                continue
            file_bytes = resp.content
        except Exception as exc:
            logger.error("Error downloading Zalo file %s: %s", file_id, exc)
            continue

        if len(file_bytes) > ZALO_FILE_SIZE_LIMIT:
            logger.warning("Zalo file %s exceeds 5 MB limit, skipping", filename)
            continue

        asset_id = str(uuid.uuid4())
        s3_key = (
            f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{asset_id}.{ext}"
        )

        try:
            s3 = boto3.client(
                "s3",
                region_name=config.aws.access_key.AWS_DEFAULT_REGION,
                aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
            )
            s3.put_object(Bucket=bucket, Key=s3_key, Body=file_bytes)
        except Exception as exc:
            logger.error("Failed to upload Zalo file %s to S3: %s", filename, exc)
            continue

        try:
            assets_repo.create_asset(
                user_id=user_id,
                project_id=project_id,
                s3_bucket=bucket,
                s3_key=s3_key,
                asset_type="raw",
                size_bytes=len(file_bytes),
                checksum_sha256=None,
                version="1",
                content_type=None,
                asset_id=asset_id,
                file_id=asset_id,
                original_filename=filename,
                extension=ext,
            )
        except Exception as exc:
            logger.error(
                "Failed to create asset record for Zalo file %s: %s", filename, exc
            )
            continue

        asset_nodes.append(
            {
                "type": "asset",
                "data": {
                    "asset_id": asset_id,
                    "file_id": asset_id,
                    "s3_bucket": bucket,
                    "s3_key": s3_key,
                    "extension": ext,
                    "filename": filename,
                },
            }
        )
        logger.info("Attached Zalo file %s as asset %s", filename, asset_id)

    if not asset_nodes:
        return

    nodes = conversation.get("nodes", [])
    for node in reversed(nodes):
        if node.get("role") == "user":
            node.setdefault("contents", []).extend(asset_nodes)
            _mark_user_node_assets_selected(
                node, [asset["data"]["asset_id"] for asset in asset_nodes]
            )
            break

    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)


def _ingest_zalo_files_to_pending(file_ids: list, workspace: Dict[str, Any]) -> int:
    """Download Zalo file(s) via getFile and queue them onto the workspace's
    ``pending_assets`` (so the next prompt drains them through handle_zalo_query).

    Mirrors the download path of ``_download_and_attach_zalo_files`` but targets
    pending_assets instead of a conversation — used by the 2-step collect flow.
    Returns the number of files successfully ingested.
    """
    from app.services import zalo_service

    user_id = workspace["user_id"]
    project_id = workspace["project_id"]
    platform_workspace_id = workspace["platform_workspace_id"]
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    ingested = 0

    for file_id in file_ids:
        info = zalo_service.get_file(file_id)
        if not info or not info.get("ok"):
            logger.warning("Collect: failed to resolve Zalo file %s", file_id)
            continue
        result = info.get("result", {}) or {}
        download_url = result.get("file_url") or result.get("file_path") or ""
        if not download_url:
            logger.warning("Collect: Zalo getFile returned no URL for %s", file_id)
            continue
        filename = (download_url.rsplit("/", 1)[-1] or f"{file_id}.bin").split("?")[0]
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"

        try:
            resp = requests.get(download_url, timeout=20)
            if resp.status_code != 200:
                logger.error("Collect: download %s HTTP %s", file_id, resp.status_code)
                continue
            file_bytes = resp.content
        except Exception as exc:
            logger.error("Collect: error downloading %s: %s", file_id, exc)
            continue
        if len(file_bytes) > ZALO_FILE_SIZE_LIMIT:
            logger.warning("Collect: %s exceeds 5 MB, skipping", filename)
            continue

        asset_id = str(uuid.uuid4())
        s3_key = (
            f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{asset_id}.{ext}"
        )
        try:
            s3 = boto3.client(
                "s3",
                region_name=config.aws.access_key.AWS_DEFAULT_REGION,
                aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
            )
            s3.put_object(Bucket=bucket, Key=s3_key, Body=file_bytes)
        except Exception as exc:
            logger.error("Collect: S3 put failed for %s: %s", filename, exc)
            continue
        try:
            assets_repo.create_asset(
                user_id=user_id,
                project_id=project_id,
                s3_bucket=bucket,
                s3_key=s3_key,
                asset_type="raw",
                size_bytes=len(file_bytes),
                checksum_sha256=None,
                version="1",
                content_type=None,
                asset_id=asset_id,
                file_id=asset_id,
                original_filename=filename,
                extension=ext,
            )
        except Exception as exc:
            logger.error("Collect: asset record failed for %s: %s", filename, exc)
            continue

        chat_platform_repo.append_pending_asset(
            platform_workspace_id,
            {
                "asset_id": asset_id,
                "filename": filename,
                "s3_bucket": bucket,
                "s3_key": s3_key,
                "extension": ext,
                "queued_at": _now_iso(),
            },
        )
        ingested += 1
        logger.info("Collect: ingested Zalo file %s as asset %s", filename, asset_id)

    return ingested


async def handle_zalo_collect_step(
    *,
    platform_workspace_id: str,
    chat_id: Any,
    text: str = "",
    zalo_file_ids: Optional[list] = None,
    start: bool = False,
) -> None:
    """Drive the 2-step collect flow: gather file(s), then a prompt, then run.

    Documents (which Zalo can't deliver inline) are handled by the web-upload
    path in the route module, which sets ``awaiting_file`` and — on upload —
    advances to ``awaiting_prompt``. This handler covers image files + the
    prompt text + start/cancel/re-prompt transitions.
    """
    from app.services import zalo_service

    zalo_file_ids = zalo_file_ids or []
    text_clean = (text or "").strip()

    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    if not workspace:
        return
    if not _get_active_collect(platform_workspace_id) and not start:
        return

    # Cancel at any point.
    if text_clean.lower() in _ZALO_CANCEL_WORDS:
        chat_platform_repo.clear_workspace_pending_collect(platform_workspace_id)
        chat_platform_repo.clear_pending_assets(platform_workspace_id)
        zalo_service.send_message(
            chat_id, "Đã huỷ. Gửi file hoặc câu hỏi mới bất cứ lúc nào nhé."
        )
        return

    # Ingest any image file(s) arriving in this message.
    if zalo_file_ids:
        try:
            _ingest_zalo_files_to_pending(zalo_file_ids, workspace)
        except Exception as exc:
            logger.warning("Zalo collect ingest failed: %s", exc)

    refreshed = chat_platform_repo.get_workspace(platform_workspace_id) or {}
    has_assets = bool(refreshed.get("pending_assets"))

    # Have a real prompt AND at least one file → run the analysis now.
    if text_clean and has_assets and not is_zalo_collect_trigger(text_clean):
        chat_platform_repo.clear_workspace_pending_collect(platform_workspace_id)
        await handle_zalo_query(
            query=text_clean,
            platform_workspace_id=platform_workspace_id,
            chat_id=chat_id,
            zalo_file_ids=[],
        )
        return

    # File collected but no prompt yet → ask for the prompt.
    if has_assets:
        chat_platform_repo.set_workspace_pending_collect(
            platform_workspace_id, build_collect_state("awaiting_prompt")
        )
        zalo_service.send_message(
            chat_id,
            "✅ Đã nhận file. Giờ gửi câu hỏi bạn muốn phân tích về dữ liệu này "
            "(vd: 'Doanh thu theo tháng ra sao?'). Gõ 'huỷ' để thoát.",
        )
        return

    # No file yet → ask for one.
    chat_platform_repo.set_workspace_pending_collect(
        platform_workspace_id, build_collect_state("awaiting_file")
    )
    zalo_service.send_message(
        chat_id,
        "📎 Gửi mình file dữ liệu (CSV/Excel/ảnh) bạn muốn phân tích nhé. "
        "Gõ 'huỷ' để thoát.",
    )


def _post_zalo_result(
    chat_id: Any, pending: Dict[str, Any], final_meta: Dict[str, Any]
) -> None:
    from app.services import zalo_service

    narrative, dashboard_url, metrics, dashboard_json = _workspace_result(
        pending["user_id"],
        pending["project_id"],
        pending["conversation_id"],
        final_meta,
    )
    zalo_service.send_message(
        chat_id,
        zalo_service.format_response_message(
            narrative, dashboard_url, CHAT_CREDIT_COST, metrics
        ),
    )
    if is_chart_rendering_enabled() and dashboard_json:
        for png_bytes, chart_title in render_dashboard_previews(
            dashboard_json, max_charts=4
        ):
            zalo_service.send_photo(
                chat_id,
                png_bytes,
                caption=chart_title[:1024],
                filename=f"{chart_title[:40] or 'chart'}.png",
            )


async def _resume_zalo_pending(
    chat_id: Any, platform_workspace_id: str, pending: Dict[str, Any]
) -> None:
    from app.services import zalo_service

    if pending.get("status") == "resuming":
        return
    pending = _set_pending_resuming(platform_workspace_id, pending)
    zalo_service.send_message(chat_id, "Continuing analysis...")
    bucket, keys = _append_clarification_response_node(pending)
    _call_morpheus(
        pending["conversation_id"],
        pending["project_id"],
        pending["user_id"],
        bucket,
        keys,
    )
    credit_service.consume_credits(pending["user_id"], CHAT_CREDIT_COST)
    final_status, _, final_meta = await _poll_workflow(pending["conversation_id"])
    if final_status == "awaiting_user_input":
        next_pending = _prepare_pending_from_conversation(
            platform="zalo",
            platform_workspace_id=platform_workspace_id,
            thread_key=pending["thread_key"],
            conversation_id=pending["conversation_id"],
            project_id=pending["project_id"],
            user_id=pending["user_id"],
            bucket=bucket,
            keys=keys,
            message={"chat_id": chat_id},
        )
        if next_pending:
            zalo_service.send_message(
                chat_id,
                build_zalo_clarification_message(next_pending, pending["project_id"]),
            )
            return
    _clear_pending(platform_workspace_id, pending["thread_key"])
    if final_status == "completed":
        _post_zalo_result(chat_id, pending, final_meta)
        return
    zalo_service.send_message(
        chat_id,
        zalo_service.format_error_message(
            _analysis_incomplete_message(pending["project_id"])
        ),
    )


async def handle_zalo_clarification_reply(
    query: str,
    platform_workspace_id: str,
    chat_id: Any,
) -> None:
    from app.services import zalo_service

    thread_key = f"{chat_id}#0"
    _, pending = _get_active_pending(platform_workspace_id, thread_key)
    if not pending:
        return
    status, updated, error = parse_text_clarification_reply(pending, query)
    if status == "cancel":
        _append_no_answer_node(pending)
        _stop_pending_workflow(pending)
        _clear_pending(platform_workspace_id, thread_key)
        zalo_service.send_message(
            chat_id,
            zalo_service.format_error_message(
                "Clarification cancelled. No credits used."
            ),
        )
        return
    if status != "valid" or not updated:
        pending["last_error"] = error or "Please reply with a listed option."
        _store_pending(platform_workspace_id, thread_key, pending)
        zalo_service.send_message(
            chat_id, build_zalo_clarification_message(pending, pending["project_id"])
        )
        return
    _store_pending(platform_workspace_id, thread_key, updated)
    await _resume_zalo_pending(chat_id, platform_workspace_id, updated)


# ── Zalo main entry point ─────────────────────────────────────────────────────


async def handle_zalo_query(
    query: str,
    platform_workspace_id: str,
    chat_id: Any,
    zalo_file_ids: list = [],
) -> None:
    """
    Full lifecycle for a Zalo Bot Platform message query. Runs as a background task.

    Zalo Bot Platform is **send-only** — `editMessageText` returns 404 — so we
    can't edit the "Analyzing..." placeholder into the final response the way
    we do on Telegram. The shape here is therefore:

      1. send a one-shot "Analyzing..." placeholder so the user knows we got it
      2. emit `sendChatAction("typing")` heartbeats during the workflow as
         lightweight progress feedback (no chat clutter)
      3. send the final narrative as a NEW message when the workflow completes
      4. on error, send the error as a NEW message
    """
    from app.services import zalo_service

    if not zalo_service._bot_token():
        logger.error("Zalo bot not configured")
        return

    try:
        zalo_service.send_message(chat_id, zalo_service.format_analyzing_message(query))
    except Exception as exc:
        logger.error("Failed to post placeholder to Zalo chat %s: %s", chat_id, exc)
        return

    async def update_status(label: str) -> None:
        # Zalo can't edit messages and we don't want to spam the chat with a
        # new message per workflow step. Use a typing indicator instead — it
        # auto-dismisses after a few seconds and stays out of the transcript.
        try:
            zalo_service.send_chat_action(chat_id, action="typing")
        except Exception as exc:
            logger.debug("Zalo sendChatAction failed (non-fatal): %s", exc)

    try:
        workspace = chat_platform_repo.get_workspace(platform_workspace_id)
        if not workspace:
            raise RuntimeError(f"Workspace {platform_workspace_id} not found")

        user_id = workspace["user_id"]
        thread_key = f"{chat_id}#0"
        conversation_id, project_id, is_new = _get_or_create_session(
            platform_workspace_id, thread_key, workspace
        )

        if is_new:
            bucket, keys = _save_new_conversation(
                user_id, project_id, conversation_id, query
            )
        else:
            bucket, keys = _append_user_node_to_conversation(
                user_id, project_id, conversation_id, query
            )
            chat_platform_repo.update_session_conversation(
                platform_workspace_id, thread_key, conversation_id
            )

        await asyncio.sleep(0.5)

        # Drain any web-uploaded files that arrived before this query.
        # (Zalo Bot Platform doesn't deliver file payloads in webhooks, so users
        # upload via the magic-token URL the bot replied with on
        # `message.unsupported.received`. Those assets are queued on the
        # workspace as `pending_assets`.)
        pending_assets = workspace.get("pending_assets") or []
        if pending_assets:
            try:
                conversation_meta = conversations_repo.get_conversation(
                    project_id, conversation_id
                )
                if conversation_meta:
                    conv = load_conversation(
                        conversation_meta["s3_bucket"], conversation_meta["s3_key"]
                    )
                    asset_nodes = []
                    for a in pending_assets:
                        asset_nodes.append(
                            {
                                "type": "asset",
                                "data": {
                                    "asset_id": a.get("asset_id"),
                                    "file_id": a.get("asset_id"),
                                    "s3_bucket": a.get("s3_bucket"),
                                    "s3_key": a.get("s3_key"),
                                    "extension": a.get("extension"),
                                    "filename": a.get("filename"),
                                },
                            }
                        )
                    nodes = conv.get("nodes", [])
                    for node in reversed(nodes):
                        if node.get("role") == "user":
                            node.setdefault("contents", []).extend(asset_nodes)
                            _mark_user_node_assets_selected(
                                node,
                                [
                                    asset["data"]["asset_id"]
                                    for asset in asset_nodes
                                    if asset.get("data", {}).get("asset_id")
                                ],
                            )
                            break
                    conv["updated_at"] = _now_iso()
                    save_conversation(bucket, keys["primary"], conv)
                    save_conversation(bucket, keys["backup"], conv)
                    logger.info(
                        "Attached %d pending Zalo asset(s) to conversation %s",
                        len(asset_nodes),
                        conversation_id,
                    )
                chat_platform_repo.clear_pending_assets(platform_workspace_id)
            except Exception as exc:
                logger.warning("Failed to drain Zalo pending assets: %s", exc)
            await asyncio.sleep(0.3)

        if zalo_file_ids:
            try:
                conv = load_conversation(bucket, keys["primary"])
                _download_and_attach_zalo_files(
                    zalo_file_ids, user_id, project_id, conv, bucket, keys
                )
                await asyncio.sleep(0.5)
            except Exception as exc:
                logger.error(
                    "Failed to attach Zalo files for conversation %s: %s",
                    conversation_id,
                    exc,
                    exc_info=True,
                )

        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)

        final_status, _, final_meta = await _poll_workflow(
            conversation_id, on_step=update_status
        )

        if final_status == "awaiting_user_input":
            pending = _prepare_pending_from_conversation(
                platform="zalo",
                platform_workspace_id=platform_workspace_id,
                thread_key=thread_key,
                conversation_id=conversation_id,
                project_id=project_id,
                user_id=user_id,
                bucket=bucket,
                keys=keys,
                message={"chat_id": chat_id},
            )
            if pending:
                zalo_service.send_message(
                    chat_id,
                    build_zalo_clarification_message(pending, project_id),
                )
                return

        if final_status != "completed":
            message = _analysis_incomplete_message(project_id)
            logger.info(
                "Workspace Zalo workflow %s ended with status %s",
                conversation_id,
                final_status,
            )
            zalo_service.send_message(
                chat_id,
                zalo_service.format_error_message(message),
            )
            return

        metrics: list = []
        dashboard_url: Optional[str] = None
        dashboard_json: Optional[Dict[str, Any]] = None

        if final_meta.get("response_type") in (
            "message",
            "answer_with_visual",
        ) and final_meta.get("content"):
            narrative = final_meta["content"]
            logger.info(
                "Using inline narrative from Zalo workflow metadata (len=%d)",
                len(narrative),
            )
        else:
            conversation_meta = conversations_repo.get_conversation(
                project_id, conversation_id
            )
            if not conversation_meta:
                raise RuntimeError(
                    f"Post-poll: conversation {conversation_id} not found in DynamoDB"
                )
            conversation = load_conversation(
                conversation_meta["s3_bucket"], conversation_meta["s3_key"]
            )
            narrative = (
                _extract_narrative(conversation)
                or "Analysis complete. No narrative returned."
            )
            dashboard_url = _build_dashboard_url(project_id, conversation)

            dashboards = conversation.get("dashboards", [])
            if dashboards:
                try:
                    projects_repo.update_project(
                        user_id=user_id,
                        project_id=project_id,
                        is_preview_public=True,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to enable public preview for %s: %s", project_id, exc
                    )

                s3_uri = dashboards[-1].get("s3_uri")
                if s3_uri:
                    dashboard_json = _load_dashboard_json(s3_uri)
                    if dashboard_json:
                        metrics = _extract_top_metrics(dashboard_json)

        zalo_service.send_message(
            chat_id,
            zalo_service.format_response_message(
                narrative, dashboard_url, CHAT_CREDIT_COST, metrics
            ),
        )
        logger.info(
            "Successfully sent Zalo response for conversation %s", conversation_id
        )

        # Phase 2B — upload chart previews via sendPhoto (sequential; Zalo Bot
        # Platform has no documented sendMediaGroup). Throttled at 200 ms to
        # stay clear of any undocumented per-chat rate limit.
        if is_chart_rendering_enabled() and dashboard_json:
            chart_previews = render_dashboard_previews(dashboard_json, max_charts=4)
            for png_bytes, chart_title in chart_previews:
                try:
                    safe_name = chart_title.lower().replace(" ", "_").replace("/", "_")
                    zalo_service.send_photo(
                        chat_id,
                        png_bytes,
                        caption=chart_title,
                        filename=f"{safe_name}.png",
                    )
                    logger.info("Sent Zalo chart preview '%s'", chart_title)
                except Exception as exc:
                    logger.warning(
                        "Failed to send Zalo chart '%s': %s", chart_title, exc
                    )
                await asyncio.sleep(0.2)

    except Exception as exc:
        logger.error(
            "handle_zalo_query failed for %s: %s",
            platform_workspace_id,
            exc,
            exc_info=True,
        )
        try:
            zalo_service.send_message(
                chat_id,
                zalo_service.format_error_message(
                    "Something went wrong. Please try again."
                ),
            )
        except Exception:
            pass


# ── WhatsApp file handling ────────────────────────────────────────────────────

WHATSAPP_FILE_SIZE_LIMIT = 100 * 1024 * 1024  # 100 MB (Cloud API media ceiling)

_WHATSAPP_MIME_EXT = {
    "text/csv": "csv",
    "application/csv": "csv",
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "application/json": "json",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
}


def _ext_from_mime(mime: str) -> str:
    if not mime:
        return "bin"
    base = mime.split(";")[0].strip().lower()
    if base in _WHATSAPP_MIME_EXT:
        return _WHATSAPP_MIME_EXT[base]
    # Fall back to the subtype (e.g. "image/heic" -> "heic").
    return base.rsplit("/", 1)[-1] if "/" in base else "bin"


def _download_and_attach_whatsapp_files(
    media_ids: list,
    user_id: str,
    project_id: str,
    conversation: Dict[str, Any],
    bucket: str,
    keys: Dict[str, str],
) -> None:
    """Resolve WhatsApp media_ids via the Graph API, download the bytes, push to
    S3, and attach asset nodes to the last user node. WhatsApp delivers media
    natively (unlike Zalo), so no web-upload detour is needed."""
    from app.services import whatsapp_service

    asset_nodes = []
    for media_id in media_ids:
        meta = whatsapp_service.get_media_meta(media_id)
        if not meta:
            logger.warning("Failed to resolve WhatsApp media %s", media_id)
            continue

        ext = _ext_from_mime(meta.get("mime_type", ""))
        file_bytes = whatsapp_service.download_media(meta["url"])
        if not file_bytes:
            logger.error("Failed to download WhatsApp media %s", media_id)
            continue
        if len(file_bytes) > WHATSAPP_FILE_SIZE_LIMIT:
            logger.warning("WhatsApp media %s exceeds size limit, skipping", media_id)
            continue

        asset_id = str(uuid.uuid4())
        filename = f"{asset_id}.{ext}"
        s3_key = (
            f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{asset_id}.{ext}"
        )

        try:
            s3 = boto3.client(
                "s3",
                region_name=config.aws.access_key.AWS_DEFAULT_REGION,
                aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
            )
            s3.put_object(Bucket=bucket, Key=s3_key, Body=file_bytes)
        except Exception as exc:
            logger.error("Failed to upload WhatsApp media %s to S3: %s", media_id, exc)
            continue

        try:
            assets_repo.create_asset(
                user_id=user_id,
                project_id=project_id,
                s3_bucket=bucket,
                s3_key=s3_key,
                asset_type="raw",
                size_bytes=len(file_bytes),
                checksum_sha256=None,
                version="1",
                content_type=meta.get("mime_type"),
                asset_id=asset_id,
                file_id=asset_id,
                original_filename=filename,
                extension=ext,
            )
        except Exception as exc:
            logger.error(
                "Failed to create asset record for WhatsApp media %s: %s", media_id, exc
            )
            continue

        asset_nodes.append(
            {
                "type": "asset",
                "data": {
                    "asset_id": asset_id,
                    "file_id": asset_id,
                    "s3_bucket": bucket,
                    "s3_key": s3_key,
                    "extension": ext,
                    "filename": filename,
                },
            }
        )
        logger.info("Attached WhatsApp media %s as asset %s", media_id, asset_id)

    if not asset_nodes:
        return

    nodes = conversation.get("nodes", [])
    for node in reversed(nodes):
        if node.get("role") == "user":
            node.setdefault("contents", []).extend(asset_nodes)
            _mark_user_node_assets_selected(
                node, [asset["data"]["asset_id"] for asset in asset_nodes]
            )
            break

    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)


# ── WhatsApp clarifications ───────────────────────────────────────────────────


def build_whatsapp_clarification_message(
    pending: Dict[str, Any], project_id: str
) -> str:
    lines = ["📊 *Dreamify*", "", "I need your choice before I continue the analysis."]
    if pending.get("last_error"):
        lines.extend(["", f"⚠️ {pending['last_error']}"])
    for ci, clarification in enumerate(pending.get("clarifications", []), start=1):
        lines.append("")
        lines.append(f"{ci}. {clarification.get('question')}")
        for oi, option in enumerate(_valid_options(clarification), start=1):
            suffix = " (recommended)" if option.get("recommended") else ""
            lines.append(f"{oi}. {option.get('label')}{suffix}")
            if option.get("description"):
                lines.append(f"   {option.get('description')}")
    lines.append("")
    lines.append("Reply with the option number, exact label, or cancel.")
    lines.append(f"Open in Dreamify: {_build_workspace_project_url(project_id)}")
    return "\n".join(lines)


def _send_whatsapp_clarification(
    wa_id: Any, pending: Dict[str, Any], project_id: str
) -> None:
    """Send the clarification as a numbered text prompt, and — when a single
    clarification has short-enough option labels — also offer interactive reply
    buttons (a WhatsApp affordance Zalo lacks). Button titles equal the option
    labels so a tapped reply parses through the same text path."""
    from app.services import whatsapp_service

    whatsapp_service.send_message(
        wa_id, build_whatsapp_clarification_message(pending, project_id)
    )

    clarifications = pending.get("clarifications", [])
    if len(clarifications) != 1:
        return
    options = _valid_options(clarifications[0])
    if not (1 <= len(options) <= 3):
        return
    if any(len(str(o.get("label", ""))) > 20 for o in options):
        return  # labels too long to round-trip through a 20-char button title
    buttons = [(str(o.get("id")), str(o.get("label"))) for o in options]
    try:
        whatsapp_service.send_reply_buttons(wa_id, "Tap a choice below:", buttons)
    except Exception as exc:
        logger.debug("WhatsApp reply buttons failed (non-fatal): %s", exc)


def _deliver_whatsapp_answer(
    wa_id: Any,
    narrative: str,
    dashboard_url: Optional[str],
    metrics: list,
    dashboard_json: Optional[Dict[str, Any]],
) -> None:
    """Send the narrative + KPI chips, a CTA-URL dashboard button, and chart
    image previews."""
    from app.services import whatsapp_service

    whatsapp_service.send_message(
        wa_id,
        whatsapp_service.format_response_message(
            narrative, None, CHAT_CREDIT_COST, metrics
        ),
    )

    if dashboard_url:
        res = whatsapp_service.send_cta_url(
            wa_id,
            "📈 Open your live dashboard in Dreamify",
            "View Dashboard",
            dashboard_url,
        )
        if not res or res.get("error"):
            whatsapp_service.send_message(wa_id, f"📈 View dashboard: {dashboard_url}")

    if is_chart_rendering_enabled() and dashboard_json:
        for png_bytes, chart_title in render_dashboard_previews(
            dashboard_json, max_charts=4
        ):
            try:
                safe_name = chart_title.lower().replace(" ", "_").replace("/", "_")
                whatsapp_service.send_image(
                    wa_id,
                    png_bytes,
                    caption=chart_title,
                    filename=f"{safe_name or 'chart'}.png",
                )
            except Exception as exc:
                logger.warning(
                    "Failed to send WhatsApp chart '%s': %s", chart_title, exc
                )


def _post_whatsapp_result(
    wa_id: Any, pending: Dict[str, Any], final_meta: Dict[str, Any]
) -> None:
    narrative, dashboard_url, metrics, dashboard_json = _workspace_result(
        pending["user_id"],
        pending["project_id"],
        pending["conversation_id"],
        final_meta,
    )
    _deliver_whatsapp_answer(wa_id, narrative, dashboard_url, metrics, dashboard_json)


async def _resume_whatsapp_pending(
    wa_id: Any, platform_workspace_id: str, pending: Dict[str, Any]
) -> None:
    from app.services import whatsapp_service

    if pending.get("status") == "resuming":
        return
    pending = _set_pending_resuming(platform_workspace_id, pending)
    whatsapp_service.send_message(wa_id, "Continuing analysis...")
    bucket, keys = _append_clarification_response_node(pending)
    _call_morpheus(
        pending["conversation_id"],
        pending["project_id"],
        pending["user_id"],
        bucket,
        keys,
    )
    credit_service.consume_credits(pending["user_id"], CHAT_CREDIT_COST)
    final_status, _, final_meta = await _poll_workflow(pending["conversation_id"])
    if final_status == "awaiting_user_input":
        next_pending = _prepare_pending_from_conversation(
            platform="whatsapp",
            platform_workspace_id=platform_workspace_id,
            thread_key=pending["thread_key"],
            conversation_id=pending["conversation_id"],
            project_id=pending["project_id"],
            user_id=pending["user_id"],
            bucket=bucket,
            keys=keys,
            message={"wa_id": wa_id},
        )
        if next_pending:
            _send_whatsapp_clarification(wa_id, next_pending, pending["project_id"])
            return
    _clear_pending(platform_workspace_id, pending["thread_key"])
    if final_status == "completed":
        _post_whatsapp_result(wa_id, pending, final_meta)
        return
    whatsapp_service.send_message(
        wa_id,
        whatsapp_service.format_error_message(
            _analysis_incomplete_message(pending["project_id"])
        ),
    )


async def handle_whatsapp_clarification_reply(
    query: str,
    platform_workspace_id: str,
    wa_id: Any,
) -> None:
    from app.services import whatsapp_service

    thread_key = f"{wa_id}#0"
    _, pending = _get_active_pending(platform_workspace_id, thread_key)
    if not pending:
        return
    status, updated, error = parse_text_clarification_reply(pending, query)
    if status == "cancel":
        _append_no_answer_node(pending)
        _stop_pending_workflow(pending)
        _clear_pending(platform_workspace_id, thread_key)
        whatsapp_service.send_message(
            wa_id,
            whatsapp_service.format_error_message(
                "Clarification cancelled. No credits used."
            ),
        )
        return
    if status != "valid" or not updated:
        pending["last_error"] = error or "Please reply with a listed option."
        _store_pending(platform_workspace_id, thread_key, pending)
        _send_whatsapp_clarification(wa_id, pending, pending["project_id"])
        return
    _store_pending(platform_workspace_id, thread_key, updated)
    await _resume_whatsapp_pending(wa_id, platform_workspace_id, updated)


# ── WhatsApp main entry point ─────────────────────────────────────────────────


async def handle_whatsapp_query(
    query: str,
    platform_workspace_id: str,
    wa_id: Any,
    whatsapp_media_ids: list = [],
) -> None:
    """
    Full lifecycle for a WhatsApp Cloud API message query. Runs as a background
    task.

    Like Zalo, WhatsApp has no message-edit API, so we post a one-shot
    "Analyzing..." placeholder and send the final answer as new messages.
    Unlike Zalo, inbound media is delivered natively and downloaded directly
    via the Graph media endpoint.
    """
    from app.services import whatsapp_service

    if not whatsapp_service.is_configured():
        logger.error("WhatsApp bot not configured")
        return

    try:
        whatsapp_service.send_message(
            wa_id, whatsapp_service.format_analyzing_message(query)
        )
    except Exception as exc:
        logger.error("Failed to post placeholder to WhatsApp %s: %s", wa_id, exc)
        return

    try:
        workspace = chat_platform_repo.get_workspace(platform_workspace_id)
        if not workspace:
            raise RuntimeError(f"Workspace {platform_workspace_id} not found")

        user_id = workspace["user_id"]
        thread_key = f"{wa_id}#0"
        conversation_id, project_id, is_new = _get_or_create_session(
            platform_workspace_id, thread_key, workspace
        )

        if is_new:
            bucket, keys = _save_new_conversation(
                user_id, project_id, conversation_id, query
            )
        else:
            bucket, keys = _append_user_node_to_conversation(
                user_id, project_id, conversation_id, query
            )
            chat_platform_repo.update_session_conversation(
                platform_workspace_id, thread_key, conversation_id
            )

        await asyncio.sleep(0.5)

        if whatsapp_media_ids:
            try:
                conv = load_conversation(bucket, keys["primary"])
                _download_and_attach_whatsapp_files(
                    whatsapp_media_ids, user_id, project_id, conv, bucket, keys
                )
                await asyncio.sleep(0.5)
            except Exception as exc:
                logger.error(
                    "Failed to attach WhatsApp media for conversation %s: %s",
                    conversation_id,
                    exc,
                    exc_info=True,
                )

        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)

        final_status, _, final_meta = await _poll_workflow(conversation_id)

        if final_status == "awaiting_user_input":
            pending = _prepare_pending_from_conversation(
                platform="whatsapp",
                platform_workspace_id=platform_workspace_id,
                thread_key=thread_key,
                conversation_id=conversation_id,
                project_id=project_id,
                user_id=user_id,
                bucket=bucket,
                keys=keys,
                message={"wa_id": wa_id},
            )
            if pending:
                _send_whatsapp_clarification(wa_id, pending, project_id)
                return

        if final_status != "completed":
            message = _analysis_incomplete_message(project_id)
            logger.info(
                "Workspace WhatsApp workflow %s ended with status %s",
                conversation_id,
                final_status,
            )
            whatsapp_service.send_message(
                wa_id, whatsapp_service.format_error_message(message)
            )
            return

        narrative, dashboard_url, metrics, dashboard_json = _workspace_result(
            user_id, project_id, conversation_id, final_meta
        )
        _deliver_whatsapp_answer(
            wa_id, narrative, dashboard_url, metrics, dashboard_json
        )
        logger.info(
            "Successfully sent WhatsApp response for conversation %s", conversation_id
        )

    except Exception as exc:
        logger.error(
            "handle_whatsapp_query failed for %s: %s",
            platform_workspace_id,
            exc,
            exc_info=True,
        )
        try:
            whatsapp_service.send_message(
                wa_id,
                whatsapp_service.format_error_message(
                    "Something went wrong. Please try again."
                ),
            )
        except Exception:
            pass
