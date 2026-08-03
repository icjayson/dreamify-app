"""
Zalo Bot Platform helpers: HTTP client wrappers and plain-text formatters.

Zalo Bot Platform (bot.zapps.me) uses a Telegram-clone REST API at
``https://bot-api.zaloplatforms.com/bot{TOKEN}/{method}``. There is no
official Python SDK, so we call the small REST surface directly.

Phase 1 has no inline-keyboard support (not documented by Zalo); the
"View Dashboard" affordance is rendered as a plain URL appended to the
message body — Zalo clients auto-linkify URLs.
"""

import logging
from typing import Any, Dict, List, Optional

import requests

from utils.config import config

logger = logging.getLogger(__name__)

_BASE_URL = "https://bot-api.zaloplatforms.com"
_TIMEOUT_S = 15

# Zalo enforces a 2,000-character limit per text message.
ZALO_TEXT_LIMIT = 2000


def _bot_token() -> str:
    return config.zalo.bot_token if config.zalo else ""


def _url(method: str) -> str:
    token = _bot_token()
    if not token:
        raise RuntimeError("zalo.bot_token is not set in config.yaml")
    return f"{_BASE_URL}/bot{token}/{method}"


def _post(method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    resp = requests.post(_url(method), json=payload, timeout=_TIMEOUT_S)
    data = resp.json() if resp.content else {}
    if not data.get("ok"):
        logger.warning("Zalo %s failed: %s", method, data)
    return data


def _get(method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    resp = requests.get(_url(method), params=params or {}, timeout=_TIMEOUT_S)
    data = resp.json() if resp.content else {}
    if not data.get("ok"):
        logger.warning("Zalo %s failed: %s", method, data)
    return data


# ── Wire-level helpers ────────────────────────────────────────────────────────

def _chunk_text(text: str, limit: int = ZALO_TEXT_LIMIT) -> List[str]:
    """Split ``text`` into chunks of at most ``limit`` chars on paragraph
    boundaries when possible; falls back to hard slicing for runaway lines."""
    if len(text) <= limit:
        return [text]
    chunks: List[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind("\n\n", 0, limit)
        if cut == -1:
            cut = remaining.rfind("\n", 0, limit)
        if cut == -1 or cut < limit // 2:
            cut = limit
        chunks.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


def send_message(chat_id: Any, text: str) -> Optional[Dict[str, Any]]:
    """Send a text message. Auto-chunks responses over the 2,000-char limit.
    Returns the API response for the *last* chunk, or None on failure."""
    last: Optional[Dict[str, Any]] = None
    for chunk in _chunk_text(text):
        last = _post("sendMessage", {"chat_id": str(chat_id), "text": chunk})
    return last


def edit_message_text(chat_id: Any, message_id: str, text: str) -> Optional[Dict[str, Any]]:
    """Compatibility shim — Zalo Bot Platform does NOT support editMessageText
    (the endpoint returns 404). We fall back to ``sendMessage`` so callers
    that share code with Telegram (which does support edits) still work, with
    the trade-off that each "edit" appears as a new chat message.

    Prefer ``send_message`` directly for new code."""
    logger.debug(
        "zalo_service.edit_message_text falling back to sendMessage "
        "(edit not supported on Zalo Bot Platform)"
    )
    return send_message(chat_id, text)


def send_chat_action(chat_id: Any, action: str = "typing") -> Optional[Dict[str, Any]]:
    return _post("sendChatAction", {"chat_id": str(chat_id), "action": action})


def send_photo(
    chat_id: Any,
    photo_bytes: bytes,
    caption: str = "",
    filename: str = "chart.png",
) -> Optional[Dict[str, Any]]:
    """Upload a PNG to a Zalo chat via multipart sendPhoto.

    Bot Platform's `sendPhoto` mirrors Telegram's shape but with a 5 MB limit
    and no documented `reply_markup`. The simplest path is multipart bytes —
    no S3 round-trip needed, no need to confirm whether remote URLs are
    accepted as photo source.
    """
    url = _url("sendPhoto")
    files = {"photo": (filename, photo_bytes, "image/png")}
    data: Dict[str, Any] = {"chat_id": str(chat_id)}
    if caption:
        # Cap caption — exact limit not documented; mirror Telegram's 1,024.
        data["caption"] = caption[:1024]
    try:
        resp = requests.post(url, data=data, files=files, timeout=30)
        body = resp.json() if resp.content else {}
    except Exception as exc:
        logger.warning("Zalo sendPhoto request failed: %s", exc)
        return None
    if not body.get("ok"):
        logger.warning("Zalo sendPhoto returned not-ok: %s", body)
    return body


def get_file(file_id: str) -> Optional[Dict[str, Any]]:
    """Resolve a file_id to a download URL via Bot Platform's getFile."""
    return _get("getFile", {"file_id": file_id})


# ── Message formatters (plain text) ───────────────────────────────────────────

def format_analyzing_message(query: str) -> str:
    truncated = query[:80] + "…" if len(query) > 80 else query
    return f"🔍 Analyzing: {truncated}"


def format_status_message(label: str) -> str:
    return f"⏳ {label}"


def format_response_message(
    narrative: str,
    dashboard_url: Optional[str],
    credits_used: int,
    metrics: Optional[list] = None,
) -> str:
    parts: List[str] = ["📊 Dreamify\n", narrative]

    if metrics:
        chip_lines = []
        for m in metrics[:4]:
            trend = m.get("trend", "")
            icon = "📈" if trend == "up" else "📉" if trend == "down" else "➡️"
            title = str(m.get("title", ""))
            value = str(m.get("value", ""))
            change = str(m.get("change", "")) if m.get("change") else ""
            line = f"{icon} {title}: {value}"
            if change:
                line += f"  ({change})"
            chip_lines.append(line)
        parts.append("\n\n" + "\n".join(chip_lines))

    if dashboard_url:
        parts.append(f"\n\n📈 View dashboard: {dashboard_url}")

    parts.append(f"\n\n— {credits_used} credits used")
    return "".join(parts)


def format_error_message(message: str) -> str:
    return f"⚠️ {message}"
