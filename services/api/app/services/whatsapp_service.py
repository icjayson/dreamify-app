"""
WhatsApp Business Cloud API helpers: HTTP client wrappers and plain-text
formatters.

The Cloud API (Meta Graph API) is a small REST surface — there is no official
Python SDK we depend on, so we call it directly with ``requests`` (mirroring
``zalo_service``). A single Dreamify-owned sender number is used, so the access
token is global (read from config), like Telegram/Zalo.

Send endpoint:   POST {graph}/{phone_number_id}/messages
Media upload:    POST {graph}/{phone_number_id}/media
Media resolve:   GET  {graph}/{media_id}  → temporary download URL

WhatsApp has no message-edit API, so — like Zalo — status updates are not
edited in place; we post one "Analyzing…" placeholder and the final answer as
new messages. Rich affordances use interactive messages: a CTA-URL button for
"View Dashboard" and reply buttons for clarifications.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

from utils.config import config

logger = logging.getLogger(__name__)

_TIMEOUT_S = 20

# WhatsApp text body limit is 4096 chars. Interactive body text is capped at
# 1024 chars; reply-button titles and CTA display_text at 20 chars.
WHATSAPP_TEXT_LIMIT = 4096
WHATSAPP_INTERACTIVE_BODY_LIMIT = 1024
WHATSAPP_BUTTON_TITLE_LIMIT = 20


# ── Config accessors ──────────────────────────────────────────────────────────


def _access_token() -> str:
    return config.whatsapp.access_token if config.whatsapp else ""


def _phone_number_id() -> str:
    return config.whatsapp.phone_number_id if config.whatsapp else ""


def _api_version() -> str:
    return (config.whatsapp.api_version if config.whatsapp else "") or "v21.0"


def _graph_base() -> str:
    return f"https://graph.facebook.com/{_api_version()}"


def _messages_url() -> str:
    pnid = _phone_number_id()
    if not _access_token() or not pnid:
        raise RuntimeError("whatsapp.access_token / phone_number_id not set in config.yaml")
    return f"{_graph_base()}/{pnid}/messages"


def _media_url() -> str:
    return f"{_graph_base()}/{_phone_number_id()}/media"


def _auth_headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {_access_token()}"}


def is_configured() -> bool:
    return bool(_access_token() and _phone_number_id())


# ── Wire-level helpers ────────────────────────────────────────────────────────


def _chunk_text(text: str, limit: int = WHATSAPP_TEXT_LIMIT) -> List[str]:
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


def _post_message(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """POST a message payload to the Cloud API. ``messaging_product`` and ``to``
    must already be set by the caller. Returns the JSON body or None on error."""
    try:
        resp = requests.post(
            _messages_url(),
            headers={**_auth_headers(), "Content-Type": "application/json"},
            json=payload,
            timeout=_TIMEOUT_S,
        )
        body = resp.json() if resp.content else {}
    except Exception as exc:
        logger.warning("WhatsApp message request failed: %s", exc)
        return None
    if resp.status_code >= 300 or body.get("error"):
        logger.warning("WhatsApp message returned error: %s", body)
    return body


def send_message(wa_id: Any, text: str) -> Optional[Dict[str, Any]]:
    """Send a free-form text message. Auto-chunks over the 4096-char limit.
    Returns the API response for the *last* chunk, or None on failure."""
    last: Optional[Dict[str, Any]] = None
    for chunk in _chunk_text(text):
        last = _post_message(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": str(wa_id),
                "type": "text",
                "text": {"preview_url": True, "body": chunk},
            }
        )
    return last


def send_cta_url(
    wa_id: Any, body_text: str, button_text: str, url: str
) -> Optional[Dict[str, Any]]:
    """Send an interactive CTA-URL button (the 'View Dashboard' affordance)."""
    return _post_message(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": str(wa_id),
            "type": "interactive",
            "interactive": {
                "type": "cta_url",
                "body": {"text": body_text[:WHATSAPP_INTERACTIVE_BODY_LIMIT]},
                "action": {
                    "name": "cta_url",
                    "parameters": {
                        "display_text": button_text[:WHATSAPP_BUTTON_TITLE_LIMIT],
                        "url": url,
                    },
                },
            },
        }
    )


def send_reply_buttons(
    wa_id: Any, body_text: str, buttons: List[Tuple[str, str]]
) -> Optional[Dict[str, Any]]:
    """Send interactive reply buttons. ``buttons`` is a list of (id, title);
    WhatsApp allows at most 3, titles capped at 20 chars."""
    btns = [
        {
            "type": "reply",
            "reply": {"id": str(bid)[:256], "title": str(title)[:WHATSAPP_BUTTON_TITLE_LIMIT]},
        }
        for bid, title in buttons[:3]
    ]
    return _post_message(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": str(wa_id),
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": body_text[:WHATSAPP_INTERACTIVE_BODY_LIMIT]},
                "action": {"buttons": btns},
            },
        }
    )


def upload_media(
    file_bytes: bytes, mime_type: str = "image/png", filename: str = "chart.png"
) -> Optional[str]:
    """Upload media to the Cloud API and return its ``media_id`` (or None)."""
    files = {"file": (filename, file_bytes, mime_type)}
    data = {"messaging_product": "whatsapp", "type": mime_type}
    try:
        resp = requests.post(
            _media_url(), headers=_auth_headers(), data=data, files=files, timeout=30
        )
        body = resp.json() if resp.content else {}
    except Exception as exc:
        logger.warning("WhatsApp media upload failed: %s", exc)
        return None
    if resp.status_code >= 300 or not body.get("id"):
        logger.warning("WhatsApp media upload returned no id: %s", body)
        return None
    return body["id"]


def send_image(
    wa_id: Any, photo_bytes: bytes, caption: str = "", filename: str = "chart.png"
) -> Optional[Dict[str, Any]]:
    """Upload a PNG then send it as an image message by media_id."""
    media_id = upload_media(photo_bytes, "image/png", filename)
    if not media_id:
        return None
    image: Dict[str, Any] = {"id": media_id}
    if caption:
        image["caption"] = caption[:1024]
    return _post_message(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": str(wa_id),
            "type": "image",
            "image": image,
        }
    )


def get_media_meta(media_id: str) -> Optional[Dict[str, Any]]:
    """Resolve a media_id to its metadata: ``{url, mime_type, file_size, ...}``.
    The ``url`` is short-lived and Bearer-protected."""
    try:
        resp = requests.get(
            f"{_graph_base()}/{media_id}", headers=_auth_headers(), timeout=_TIMEOUT_S
        )
        body = resp.json() if resp.content else {}
    except Exception as exc:
        logger.warning("WhatsApp get_media_meta failed for %s: %s", media_id, exc)
        return None
    if not body.get("url"):
        logger.warning("WhatsApp media meta missing url for %s: %s", media_id, body)
        return None
    return body


def get_media_url(media_id: str) -> Optional[str]:
    """Convenience wrapper returning only the download URL."""
    meta = get_media_meta(media_id)
    return meta.get("url") if meta else None


def download_media(url: str) -> Optional[bytes]:
    """Download inbound media bytes from a resolved (Bearer-protected) URL."""
    try:
        resp = requests.get(url, headers=_auth_headers(), timeout=30)
        if resp.status_code != 200:
            logger.warning("WhatsApp media download HTTP %s", resp.status_code)
            return None
        return resp.content
    except Exception as exc:
        logger.warning("WhatsApp media download failed: %s", exc)
        return None


def mark_read(message_id: str) -> Optional[Dict[str, Any]]:
    """Mark an inbound message as read (optional, nicer UX)."""
    return _post_message(
        {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
        }
    )


# ── Message formatters (plain text; WhatsApp supports *bold* / _italic_) ───────


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
    parts: List[str] = ["📊 *Dreamify*\n", narrative]

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

    # The dashboard link is also offered as an interactive CTA-URL button, but
    # we append it inline too so it survives if the interactive send fails.
    if dashboard_url:
        parts.append(f"\n\n📈 View dashboard: {dashboard_url}")

    parts.append(f"\n\n_{credits_used} credits used_")
    return "".join(parts)


def format_error_message(message: str) -> str:
    return f"⚠️ {message}"
