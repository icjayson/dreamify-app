"""
Chat platform integration routes.

Slack:
  POST /chat/slack/events          — Slack Events API webhook (app_mention, etc.)
  POST /chat/slack/auth-url        — Generate signed Slack OAuth URL (authenticated)
  GET  /chat/slack/oauth/callback  — OAuth 2.0 callback after "Add to Slack"
  GET  /chat/slack/me              — Current user's connected Slack workspace
  DELETE /chat/workspaces/{id}     — Disconnect a workspace

Internal:
  GET  /chat/workspaces/{id}       — Inspect a workspace (admin use)
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, quote

import requests as http_requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.dependencies.auth import require_user
from app.services.chat_platform_service import (
    handle_slack_clarification_interaction,
    handle_slack_clarification_reply,
    handle_slack_query,
    handle_telegram_clarification_callback,
    handle_telegram_clarification_reply,
    handle_telegram_query,
    handle_whatsapp_clarification_reply,
    handle_whatsapp_query,
    handle_zalo_clarification_reply,
    handle_zalo_collect_step,
    handle_zalo_query,
    build_collect_state,
    has_pending_clarification,
    has_pending_collect,
    is_zalo_collect_trigger,
)
from app.services.slack_service import decrypt_token, encrypt_token
from utils.config import config
from utils.dynamodb.repos import chat_platform_repo
from utils.dynamodb.repos import projects as projects_repo

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

SLACK_OAUTH_SCOPES = (
    "channels:history,channels:join,groups:history,im:history,"
    "chat:write,chat:write.public,files:read,files:write,app_mentions:read,commands"
)
STATE_TOKEN_TTL = 600  # 10 minutes
TELEGRAM_CODE_TTL = 900  # 15 minutes


def _slack_client_id() -> str:
    return config.slack.client_id if config.slack else ""


def _slack_client_secret() -> str:
    return config.slack.client_secret if config.slack else ""


def _dreamify_app_url() -> str:
    return (
        config.chat_platform.dreamify_app_url
        if config.chat_platform
        else "http://localhost:8080"
    )


def _telegram_bot_token() -> str:
    return config.telegram.bot_token if config.telegram else ""


def _telegram_bot_username() -> str:
    return config.telegram.bot_username if config.telegram else "DreamifyBot"


def _telegram_webhook_secret() -> str:
    return config.telegram.webhook_secret if config.telegram else ""


def _zalo_bot_token() -> str:
    return config.zalo.bot_token if config.zalo else ""


def _zalo_bot_username() -> str:
    return config.zalo.bot_username if config.zalo else "DreamifyBot"


def _zalo_bot_id() -> str:
    return config.zalo.bot_id if config.zalo else ""


def _zalo_webhook_secret() -> str:
    return config.zalo.webhook_secret if config.zalo else ""


ZALO_CODE_TTL = 900  # 15 minutes


# ── State token (signed, short-lived, no new deps) ────────────────────────────


def _create_state_token(user_id: str) -> str:
    payload = json.dumps(
        {"user_id": user_id, "exp": int(time.time()) + STATE_TOKEN_TTL}
    )
    sig = hmac.new(
        config.app.secret_key.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    raw = f"{payload}||{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _verify_state_token(token: str) -> str:
    """Return user_id or raise ValueError."""
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        payload_str, sig = raw.rsplit("||", 1)
        expected = hmac.new(
            config.app.secret_key.encode(),
            payload_str.encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("Invalid signature")
        payload = json.loads(payload_str)
        if payload["exp"] < int(time.time()):
            raise ValueError("Token expired")
        return payload["user_id"]
    except (KeyError, json.JSONDecodeError) as exc:
        raise ValueError(f"Malformed state token: {exc}") from exc


# ── Slack file fetch helper ──────────────────────────────────────────────────


def _fetch_slack_files(
    bot_token: str,
    channel_id: str,
    message_ts: str,
    thread_ts: Optional[str] = None,
) -> list:
    """
    Retrieve the file attachments for a specific Slack message.

    The ``app_mention`` event payload often omits the ``files`` field; only
    message/file events reliably carry it.  The authoritative way to get files
    for a given mention is to fetch the thread via ``conversations.replies`` and
    narrow to the exact message timestamp.  For thread replies, ``ts`` must be
    the thread parent timestamp, not the reply timestamp.

    Requires the ``files:read`` bot scope so that ``url_private_download`` links
    are accessible for download later.

    Returns an empty list on any error so the caller degrades gracefully.
    """
    if not bot_token or not channel_id or not message_ts:
        return []

    thread_root_ts = thread_ts or message_ts

    try:
        resp = http_requests.get(
            "https://slack.com/api/conversations.replies",
            headers={"Authorization": f"Bearer {bot_token}"},
            params={
                "channel": channel_id,
                "ts": thread_root_ts,
                "oldest": message_ts,
                "latest": message_ts,
                "inclusive": "true",
                "limit": "1",
            },
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            logger.warning(
                "conversations.replies returned error for ts=%s thread_ts=%s: %s",
                message_ts,
                thread_root_ts,
                data.get("error"),
            )
            return []

        messages = data.get("messages", [])
        for msg in messages:
            if msg.get("ts") == message_ts:
                files = msg.get("files", [])
                logger.info(
                    "Fetched %d file(s) from Slack message ts=%s",
                    len(files),
                    message_ts,
                )
                return files

        logger.info(
            "No message matched ts=%s in conversations.replies response for thread %s",
            message_ts,
            thread_root_ts,
        )
        return []

    except Exception as exc:
        logger.warning(
            "_fetch_slack_files failed for ts=%s thread_ts=%s: %s",
            message_ts,
            thread_root_ts,
            exc,
        )
        return []


def _verify_slack_signature(request: Request, body: bytes) -> bool:
    signing_secret = config.slack.signing_secret if config.slack else ""
    if not signing_secret:
        return True
    timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
    signature = request.headers.get("X-Slack-Signature", "")
    try:
        ts_int = int(timestamp)
    except ValueError:
        return False
    if abs(int(time.time()) - ts_int) > 300:
        return False
    base = f"v0:{timestamp}:{body.decode()}".encode()
    expected = (
        "v0="
        + hmac.new(
            signing_secret.encode(),
            base,
            hashlib.sha256,
        ).hexdigest()
    )
    return hmac.compare_digest(expected, signature)


# ── Slack Events API ──────────────────────────────────────────────────────────


@router.post("/chat/slack/events")
async def slack_events(request: Request, background_tasks: BackgroundTasks):
    """
    Receive Slack Events API payloads. Must respond within 3 seconds.
    Actual processing runs in a background task.
    """
    body = await request.body()
    body_json: Dict[str, Any] = {}
    try:
        body_json = json.loads(body)
    except Exception:
        pass

    # Slack URL verification challenge (one-time during app setup)
    if body_json.get("type") == "url_verification":
        return {"challenge": body_json.get("challenge")}

    event = body_json.get("event", {})
    event_type = event.get("type", "")

    if event_type == "app_mention":
        team_id = body_json.get("team_id", "")
        platform_workspace_id = f"slack:{team_id}"
        channel_id = event.get("channel", "")
        thread_ts = event.get("thread_ts") or event.get("ts", "")
        raw_text: str = event.get("text", "")
        query = re.sub(r"<@[A-Z0-9]+>", "", raw_text).strip()

        if not query:
            return {"ok": True}

        workspace = chat_platform_repo.get_workspace(platform_workspace_id)
        if not workspace:
            logger.warning(
                "Mention from unregistered workspace: %s", platform_workspace_id
            )
            return {"ok": True}

        if has_pending_clarification(
            platform_workspace_id, f"{channel_id}#{thread_ts}"
        ):
            background_tasks.add_task(
                handle_slack_clarification_reply,
                query=query,
                platform_workspace_id=platform_workspace_id,
                channel_id=channel_id,
                thread_ts=thread_ts,
                bot_token_encrypted=workspace["bot_token_encrypted"],
            )
            return {"ok": True}

        message_ts = event.get("ts", "")
        bot_token = decrypt_token(workspace["bot_token_encrypted"])
        slack_files = event.get("files") or _fetch_slack_files(
            bot_token, channel_id, message_ts, thread_ts=thread_ts
        )
        if slack_files:
            logger.info(
                "Found %d file(s) attached to Slack mention (ts=%s)",
                len(slack_files),
                message_ts,
            )
        else:
            logger.info("No file attachments on Slack mention (ts=%s)", message_ts)

        background_tasks.add_task(
            handle_slack_query,
            query=query,
            platform_workspace_id=platform_workspace_id,
            channel_id=channel_id,
            thread_ts=thread_ts,
            bot_token_encrypted=workspace["bot_token_encrypted"],
            slack_files=slack_files,
        )

    return {"ok": True}


@router.post("/chat/slack/interactions")
async def slack_interactions(request: Request, background_tasks: BackgroundTasks):
    """Receive Slack Block Kit action payloads for workspace-agent clarifications."""
    body = await request.body()
    if not _verify_slack_signature(request, body):
        raise HTTPException(status_code=403, detail="Invalid Slack signature")
    form = parse_qs(body.decode())
    payload_raw = (form.get("payload") or ["{}"])[0]
    try:
        payload = json.loads(payload_raw)
    except Exception:
        return {"ok": True}
    if payload.get("type") == "block_actions":
        background_tasks.add_task(handle_slack_clarification_interaction, payload)
    return {"ok": True}


# ── Slack OAuth ───────────────────────────────────────────────────────────────


class SlackAuthUrlResponse(BaseModel):
    url: str


@router.post("/chat/slack/auth-url", response_model=SlackAuthUrlResponse)
async def slack_auth_url(user_id: str = Depends(require_user)):
    """
    Return a signed Slack OAuth URL for the authenticated user.
    Frontend does window.location.href = url to start OAuth.
    """
    slack_client_id = _slack_client_id()
    if not slack_client_id:
        raise HTTPException(status_code=503, detail="Slack integration not configured")

    state = _create_state_token(user_id)
    redirect_uri = f"{_dreamify_app_url()}/api/v1/chat/slack/oauth/callback"
    url = (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={slack_client_id}"
        f"&scope={SLACK_OAUTH_SCOPES}"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
    )
    return SlackAuthUrlResponse(url=url)


@router.get("/chat/slack/oauth/callback")
async def slack_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    """
    OAuth 2.0 callback from Slack. Exchanges code for token, stores workspace,
    then redirects to the frontend with success/error query params.
    """
    frontend_base = f"{_dreamify_app_url()}/workspace?tab=connectors"

    if error:
        return RedirectResponse(
            url=f"{frontend_base}&slack=error&message={quote(error)}"
        )

    if not code or not state:
        return RedirectResponse(
            url=f"{frontend_base}&slack=error&message={quote('Missing code or state')}"
        )

    try:
        user_id = _verify_state_token(state)
    except ValueError as exc:
        return RedirectResponse(
            url=f"{frontend_base}&slack=error&message={quote(str(exc))}"
        )

    redirect_uri = f"{_dreamify_app_url()}/api/v1/chat/slack/oauth/callback"
    resp = http_requests.post(
        "https://slack.com/api/oauth.v2.access",
        data={
            "client_id": _slack_client_id(),
            "client_secret": _slack_client_secret(),
            "code": code,
            "redirect_uri": redirect_uri,
        },
        timeout=10,
    )
    data = resp.json()
    if not data.get("ok"):
        slack_error = data.get("error", "oauth_failed")
        return RedirectResponse(
            url=f"{frontend_base}&slack=error&message={quote(slack_error)}"
        )

    team_id: str = data["team"]["id"]
    team_name: str = data["team"].get("name", "")
    bot_token: str = data["access_token"]
    platform_workspace_id = f"slack:{team_id}"

    existing = chat_platform_repo.get_workspace(platform_workspace_id)
    if existing:
        project_id = existing["project_id"]
    else:
        project = projects_repo.create_project(
            user_id=user_id,
            name=f"Slack — {team_name}",
            description="Auto-created for Slack workspace integration",
        )
        project_id = project["project_id"]

    chat_platform_repo.save_workspace(
        platform_workspace_id=platform_workspace_id,
        user_id=user_id,
        project_id=project_id,
        platform="slack",
        bot_token_encrypted=encrypt_token(bot_token),
        workspace_name=team_name,
    )

    try:
        from slack_sdk.web.async_client import AsyncWebClient

        client = AsyncWebClient(token=bot_token)
        await client.chat_postMessage(
            channel="general",
            text=(
                "👋 *Dreamify is connected!* I'm Morpheus, your data analytics teammate.\n"
                "Mention me with a question: `@dreamify why did signups drop last week?`\n"
                "Data sources configured in your Dreamify workspace are ready to use."
            ),
        )
    except Exception as exc:
        logger.warning("Failed to post Slack welcome message: %s", exc)

    return RedirectResponse(
        url=f"{frontend_base}&slack=success&workspace={quote(team_name)}"
    )


# ── Slack status & disconnect ─────────────────────────────────────────────────


class SlackStatusResponse(BaseModel):
    connected: bool
    workspace_name: Optional[str] = None
    platform_workspace_id: Optional[str] = None
    project_id: Optional[str] = None


@router.get("/chat/slack/me", response_model=SlackStatusResponse)
async def get_slack_status(user_id: str = Depends(require_user)):
    """Return the current user's connected Slack workspace, or connected=false."""
    workspace = chat_platform_repo.get_workspace_by_user(user_id, "slack")
    if not workspace:
        return SlackStatusResponse(connected=False)
    return SlackStatusResponse(
        connected=True,
        workspace_name=workspace.get("workspace_name"),
        platform_workspace_id=workspace["platform_workspace_id"],
        project_id=workspace.get("project_id"),
    )


@router.delete("/chat/workspaces/{platform_workspace_id}")
async def disconnect_workspace(
    platform_workspace_id: str,
    user_id: str = Depends(require_user),
):
    """Disconnect a chat workspace. Only the installing user may disconnect."""
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if workspace.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    chat_platform_repo.delete_workspace(platform_workspace_id)
    return {"ok": True}


# ── Admin / debug ─────────────────────────────────────────────────────────────


class WorkspaceResponse(BaseModel):
    platform_workspace_id: str
    platform: str
    workspace_name: str
    project_id: str
    language: str
    created_at: str


@router.get(
    "/chat/workspaces/{platform_workspace_id}", response_model=WorkspaceResponse
)
async def get_workspace(platform_workspace_id: str):
    """Return workspace metadata (no token). Admin/debug use."""
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return WorkspaceResponse(
        platform_workspace_id=workspace["platform_workspace_id"],
        platform=workspace["platform"],
        workspace_name=workspace.get("workspace_name", ""),
        project_id=workspace["project_id"],
        language=workspace.get("language", "en"),
        created_at=workspace.get("created_at", ""),
    )


# ── Telegram webhook ──────────────────────────────────────────────────────────

import secrets
import string
from datetime import datetime as _datetime
from datetime import timezone as _timezone
from app.utils.timestamp_utils import parse_timestamp_to_utc, utc_now_iso


def _generate_telegram_code() -> str:
    # Exclude ambiguous characters: 0, O, 1, I, L
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def _verify_telegram_webhook(request: Request) -> bool:
    webhook_secret = _telegram_webhook_secret()
    if not webhook_secret:
        return True  # no secret configured — allow all (dev mode)
    token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    return hmac.compare_digest(token, webhook_secret)


@router.post("/chat/telegram/webhook")
async def telegram_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receive Telegram Update payloads. Must respond within a few seconds.
    Dispatches /start, /connect, and mention/DM messages to background tasks.
    """
    if not _verify_telegram_webhook(request):
        raise HTTPException(status_code=403, detail="Invalid webhook token")

    body: Dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    callback_query = body.get("callback_query")
    if callback_query:
        background_tasks.add_task(
            handle_telegram_clarification_callback, callback_query
        )
        return {"ok": True}

    message = body.get("message") or body.get("edited_message")
    if not message:
        return {"ok": True}

    chat = message.get("chat", {})
    chat_id: int = chat.get("id", 0)
    chat_type: str = chat.get("type", "")  # "private", "group", "supergroup", "channel"
    from_user = message.get("from", {})
    telegram_user_id: str = str(from_user.get("id", ""))
    # Telegram puts the body in `text` for plain messages and `caption` for
    # document/photo/video messages. Read both.
    text: str = (message.get("text") or message.get("caption") or "").strip()
    message_thread_id: Optional[int] = message.get("message_thread_id")
    has_document = bool(message.get("document"))

    if not chat_id:
        return {"ok": True}
    # Drop only when there is neither text nor a document — otherwise the
    # message has actionable content (a file with no caption is still a query
    # in DMs: "analyze this").
    if not text and not has_document:
        return {"ok": True}

    # ── /start {code} — DM registration ──────────────────────────────────────
    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        code = parts[1].strip() if len(parts) > 1 else ""
        if code:
            code = code.strip().upper()
            logger.info("Received Telegram /start with code: %s", code)
            background_tasks.add_task(
                _handle_telegram_start, code, chat_id, telegram_user_id, from_user
            )
        else:
            # /start with no code — just send a welcome hint
            background_tasks.add_task(_send_telegram_start_hint, chat_id)
        return {"ok": True}

    # ── /connect — group linking ──────────────────────────────────────────────
    if text.startswith("/connect") and chat_type in ("group", "supergroup"):
        background_tasks.add_task(
            _handle_telegram_connect, chat_id, chat, telegram_user_id
        )
        return {"ok": True}

    # ── Query messages ────────────────────────────────────────────────────────
    # In private (DM) chats: any message is a query
    # In group chats: only messages that @mention the bot
    is_dm = chat_type == "private"
    is_mention = _is_bot_mentioned(message)

    if not is_dm and not is_mention:
        return {"ok": True}

    # Strip the @BotUsername mention from the text if present
    query = _strip_bot_mention(text).strip()
    if not query and has_document:
        # Document with no caption — still a valid query, just no narrative
        query = "(file attached)"
    if not query:
        return {"ok": True}

    # Determine platform_workspace_id
    platform_workspace_id = f"telegram:{chat_id}"
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    if not workspace:
        logger.warning(
            "Telegram message from unregistered chat: %s", platform_workspace_id
        )
        # Reply with a hint so the user isn't stuck in a silent chat.
        # Only send for DMs — in groups, the bot was @mentioned but isn't
        # connected, and we don't want to spam the channel.
        if is_dm:
            background_tasks.add_task(_send_telegram_unregistered_hint, chat_id)
        return {"ok": True}

    thread_key = f"{chat_id}#{message_thread_id or 0}"
    if has_pending_clarification(platform_workspace_id, thread_key):
        background_tasks.add_task(
            handle_telegram_clarification_reply,
            query=query,
            platform_workspace_id=platform_workspace_id,
            chat_id=chat_id,
            message_thread_id=message_thread_id,
        )
        return {"ok": True}

    # Resolve file metadata (including download URL) now, while we have async context.
    # This mirrors the Slack pattern and avoids a fragile bot.get_file() call inside
    # the background task where failures are harder to surface.
    telegram_files = await _fetch_telegram_document_metadata(message)

    background_tasks.add_task(
        handle_telegram_query,
        query=query,
        platform_workspace_id=platform_workspace_id,
        chat_id=chat_id,
        message_thread_id=message_thread_id,
        telegram_files=telegram_files,
    )
    return {"ok": True}


def _is_bot_mentioned(message: Dict[str, Any]) -> bool:
    """Return True if the bot's username appears in the message entities.

    Checks both `entities` (plain text messages) and `caption_entities`
    (document/photo messages with a caption) so group @mentions work
    regardless of whether the user sends text or a file with caption.
    """
    bot_mention = f"@{_telegram_bot_username()}".lower()
    all_entities = [
        *message.get("entities", []),
        *message.get("caption_entities", []),
    ]
    for entity in all_entities:
        if entity.get("type") == "mention":
            offset = entity.get("offset", 0)
            length = entity.get("length", 0)
            # Mention offset/length applies to whichever text field is present.
            source_text = message.get("text") or message.get("caption") or ""
            mention = source_text[offset : offset + length].lower()
            if mention == bot_mention:
                return True
    return False


def _strip_bot_mention(text: str) -> str:
    """Remove @BotUsername from the query text."""
    return re.sub(
        rf"@{re.escape(_telegram_bot_username())}", "", text, flags=re.IGNORECASE
    ).strip()


async def _fetch_telegram_document_metadata(message: Dict[str, Any]) -> list:
    """Return rich file metadata dicts for documents attached to the message.

    Resolves the Telegram file download URL now (in the async webhook handler)
    so the background task can HTTP-GET the file directly without needing a
    second bot.get_file() call that could fail silently.
    """
    from app.services.telegram_service import get_telegram_bot

    doc = message.get("document")
    if not doc or not doc.get("file_id"):
        return []

    file_id = doc["file_id"]
    filename = doc.get("file_name") or f"{file_id}.bin"
    file_size = doc.get("file_size", 0)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"

    try:
        bot = await get_telegram_bot()
        tg_file = await bot.get_file(file_id)
        # In python-telegram-bot v21+, bot.get_file() already rewrites file_path to
        # the full download URL (https://api.telegram.org/file/bot<token>/<path>).
        # Use it directly — do NOT prepend the base URL again.
        download_url = tg_file.file_path or ""
    except Exception as exc:
        logger.warning(
            "Failed to resolve Telegram file %s (%s): %s", file_id, filename, exc
        )
        return []

    return [
        {
            "filename": filename,
            "size": file_size,
            "ext": ext,
            "download_url": download_url,
        }
    ]


async def _send_telegram_start_hint(chat_id: int) -> None:
    try:
        from app.services.telegram_service import get_telegram_bot

        bot = await get_telegram_bot()
        await bot.send_message(
            chat_id=chat_id,
            text=(
                "👋 Hi\\! I'm *Dreamify Morpheus*, your analytics teammate\\.\n\n"
                "To connect, generate a code at [app\\.dreamify\\.dev](https://app.dreamify.dev) "
                "under *Integrations → Telegram*, then send `/start YOUR_CODE` here\\."
            ),
            parse_mode="MarkdownV2",
        )
    except Exception as exc:
        logger.warning("Failed to send Telegram start hint: %s", exc)


async def _send_telegram_unregistered_hint(chat_id: int) -> None:
    """Reply when a DM arrives from a chat we don't have a workspace for —
    so users aren't stuck wondering why nothing happens."""
    try:
        from app.services.telegram_service import get_telegram_bot

        bot = await get_telegram_bot()
        await bot.send_message(
            chat_id=chat_id,
            text=(
                "🔌 You're not connected to *Dreamify* yet\\.\n\n"
                "Generate a code at [app\\.dreamify\\.dev](https://app.dreamify.dev) "
                "under *Integrations → Telegram*, then send `/start YOUR_CODE` here\\."
            ),
            parse_mode="MarkdownV2",
        )
    except Exception as exc:
        logger.warning("Failed to send Telegram unregistered hint: %s", exc)


async def _handle_telegram_start(
    code: str, chat_id: int, telegram_user_id: str, from_user: Dict[str, Any]
) -> None:
    """Validate registration code and create the Telegram workspace."""
    from app.services.telegram_service import get_telegram_bot, escape_markdown

    try:
        bot = await get_telegram_bot()
    except RuntimeError as exc:
        logger.error("Telegram bot not configured: %s", exc)
        return

    pending_key = f"pending:{code}"
    logger.info("Looking up Telegram pending key: %s", pending_key)
    pending = chat_platform_repo.get_workspace(pending_key)

    if not pending:
        logger.warning("Telegram registration code not found: %s", code)
        try:
            await bot.send_message(
                chat_id=chat_id,
                text="❌ Code not found\\. Please generate a new code at app\\.dreamify\\.dev\\.",
                parse_mode="MarkdownV2",
            )
        except Exception as exc:
            logger.error("Failed to send 'code not found' message: %s", exc)
        return

    # Check expiry
    created_at_str = pending.get("created_at", "")
    try:
        created_at = parse_timestamp_to_utc(created_at_str)
        age_seconds = (_datetime.now(_timezone.utc) - created_at).total_seconds()
        logger.info(
            "Telegram code %s age: %.1fs (TTL: %d)",
            code,
            age_seconds,
            TELEGRAM_CODE_TTL,
        )
    except Exception as exc:
        logger.error("Failed to parse created_at for code %s: %s", code, exc)
        age_seconds = TELEGRAM_CODE_TTL + 1  # treat malformed timestamp as expired

    if age_seconds > TELEGRAM_CODE_TTL:
        logger.warning("Telegram code %s expired (age: %.1fs)", code, age_seconds)
        chat_platform_repo.delete_workspace(pending_key)
        try:
            await bot.send_message(
                chat_id=chat_id,
                text="⏰ Code expired\\. Please generate a new code at app\\.dreamify\\.dev\\.",
                parse_mode="MarkdownV2",
            )
        except Exception:
            pass
        return

    user_id = pending["user_id"]
    platform_workspace_id = f"telegram:{chat_id}"

    # Create the Dreamify project for this chat (if not already connected)
    existing = chat_platform_repo.get_workspace(platform_workspace_id)
    if existing:
        project_id = existing["project_id"]
    else:
        first_name = from_user.get("first_name", "")
        username = from_user.get("username", "")
        chat_label = username or first_name or f"user_{telegram_user_id}"
        project = projects_repo.create_project(
            user_id=user_id,
            name=f"Telegram — {chat_label}",
            description="Auto-created for Telegram DM integration",
        )
        project_id = project["project_id"]

    logger.info(
        "Saving Telegram workspace: %s for user %s", platform_workspace_id, user_id
    )
    try:
        chat_platform_repo.save_workspace(
            platform_workspace_id=platform_workspace_id,
            user_id=user_id,
            project_id=project_id,
            platform="telegram",
            bot_token_encrypted="",  # global bot token used from env
            workspace_name=from_user.get("first_name")
            or from_user.get("username")
            or "Telegram DM",
            telegram_user_id=telegram_user_id,
        )
        logger.info("Successfully saved Telegram workspace: %s", platform_workspace_id)
    except Exception as exc:
        logger.error(
            "Failed to save Telegram workspace %s: %s", platform_workspace_id, exc
        )
        return

    chat_platform_repo.delete_workspace(pending_key)
    logger.info("Deleted pending key: %s", pending_key)

    try:
        await bot.send_message(
            chat_id=chat_id,
            text=(
                "✅ *Dreamify connected\\!*\n\n"
                "I'm Morpheus, your analytics teammate\\. "
                "Just message me with a question about your data\\.\n\n"
                "_Example: What were our top performing campaigns last month?_"
            ),
            parse_mode="MarkdownV2",
        )
    except Exception as exc:
        logger.warning("Failed to send Telegram welcome message: %s", exc)


async def _handle_telegram_connect(
    chat_id: int, chat: Dict[str, Any], telegram_user_id: str
) -> None:
    """Link a group chat to an existing Dreamify user who already connected via DM."""
    from app.services.telegram_service import get_telegram_bot

    try:
        bot = await get_telegram_bot()
    except RuntimeError as exc:
        logger.error("Telegram bot not configured: %s", exc)
        return

    # Look up the DM workspace for this Telegram user
    dm_workspace = chat_platform_repo.get_workspace_by_telegram_user_id(
        telegram_user_id
    )
    if not dm_workspace:
        try:
            await bot.send_message(
                chat_id=chat_id,
                text=(
                    "⚠️ You haven't connected your Dreamify account yet\\.\n\n"
                    "DM me first: click [here](https://t.me/"
                    + re.escape(_telegram_bot_username())
                    + ") and send `/start YOUR_CODE`\\."
                ),
                parse_mode="MarkdownV2",
            )
        except Exception:
            pass
        return

    user_id = dm_workspace["user_id"]
    platform_workspace_id = f"telegram:{chat_id}"

    existing = chat_platform_repo.get_workspace(platform_workspace_id)
    if existing:
        try:
            await bot.send_message(
                chat_id=chat_id,
                text="✅ This group is already connected to Dreamify\\.",
                parse_mode="MarkdownV2",
            )
        except Exception:
            pass
        return

    group_name = chat.get("title") or f"group_{chat_id}"
    project = projects_repo.create_project(
        user_id=user_id,
        name=f"Telegram — {group_name}",
        description="Auto-created for Telegram group integration",
    )

    chat_platform_repo.save_workspace(
        platform_workspace_id=platform_workspace_id,
        user_id=user_id,
        project_id=project["project_id"],
        platform="telegram",
        bot_token_encrypted="",
        workspace_name=group_name,
    )

    try:
        await bot.send_message(
            chat_id=chat_id,
            text=(
                "✅ *Dreamify connected to this group\\!*\n\n"
                "Mention me with a question: `@"
                + _telegram_bot_username()
                + " why did signups drop?`"
            ),
            parse_mode="MarkdownV2",
        )
    except Exception as exc:
        logger.warning("Failed to send Telegram group welcome message: %s", exc)


# ── Telegram registration code ────────────────────────────────────────────────


class TelegramCodeResponse(BaseModel):
    code: str
    bot_username: str
    deeplink: str
    expires_in: int


@router.post("/chat/telegram/generate-code", response_model=TelegramCodeResponse)
async def telegram_generate_code(user_id: str = Depends(require_user)):
    """Generate a short-lived registration code for Telegram DM linking."""
    if not _telegram_bot_token():
        raise HTTPException(
            status_code=503, detail="Telegram integration not configured"
        )

    # Opportunistic GC: prune any expired pending rows for this user before
    # adding a new one. Cheap (scoped scan), keeps the table tidy.
    try:
        pruned = chat_platform_repo.cleanup_expired_pending(
            "telegram_pending", TELEGRAM_CODE_TTL, user_id=user_id
        )
        if pruned:
            logger.info(
                "Pruned %d expired telegram_pending rows for user %s", pruned, user_id
            )
    except Exception as exc:
        logger.warning("telegram_pending GC failed: %s", exc)

    code = _generate_telegram_code()
    pending_key = f"pending:{code}"
    logger.info("Generating new Telegram code %s for user %s", code, user_id)

    chat_platform_repo.save_workspace(
        platform_workspace_id=pending_key,
        user_id=user_id,
        project_id="",
        platform="telegram_pending",
        bot_token_encrypted="",
    )

    bot_username = _telegram_bot_username()
    deeplink = f"https://t.me/{bot_username}?start={code}"
    return TelegramCodeResponse(
        code=code,
        bot_username=bot_username,
        deeplink=deeplink,
        expires_in=TELEGRAM_CODE_TTL,
    )


# ── Telegram status ───────────────────────────────────────────────────────────


class TelegramStatusResponse(BaseModel):
    connected: bool
    workspace_name: Optional[str] = None
    platform_workspace_id: Optional[str] = None
    project_id: Optional[str] = None


@router.get("/chat/telegram/me", response_model=TelegramStatusResponse)
async def get_telegram_status(user_id: str = Depends(require_user)):
    """Return the current user's connected Telegram workspace, or connected=false."""
    workspace = chat_platform_repo.get_workspace_by_user(user_id, "telegram")
    if not workspace:
        return TelegramStatusResponse(connected=False)
    return TelegramStatusResponse(
        connected=True,
        workspace_name=workspace.get("workspace_name"),
        platform_workspace_id=workspace["platform_workspace_id"],
        project_id=workspace.get("project_id"),
    )


# ── Zalo Bot Platform webhook ─────────────────────────────────────────────────


def _verify_zalo_webhook(request: Request) -> bool:
    webhook_secret = _zalo_webhook_secret()
    if not webhook_secret:
        return True  # no secret configured — allow all (dev mode)
    token = request.headers.get("X-Bot-Api-Secret-Token", "")
    return hmac.compare_digest(token, webhook_secret)


def _extract_zalo_image_file_ids(message: Dict[str, Any]) -> list:
    """Return file_ids for image attachments on a Zalo Bot Platform message.

    Zalo's payload shape for images isn't well-documented and the field name
    has drifted over time, so we probe several plausible locations rather
    than gating on event_name (which is unreliable — see the text-event bug).
    """
    candidates = [
        message.get("file_id"),
        (
            (message.get("photo") or {}).get("file_id")
            if isinstance(message.get("photo"), dict)
            else None
        ),
        (
            (message.get("image") or {}).get("file_id")
            if isinstance(message.get("image"), dict)
            else None
        ),
    ]
    return [c for c in candidates if c]


@router.post("/chat/zalo/webhook")
async def zalo_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receive Zalo Bot Platform Update payloads. Must respond within ~2 seconds;
    actual processing runs in a background task.
    """
    if not _verify_zalo_webhook(request):
        raise HTTPException(status_code=403, detail="Invalid webhook token")

    body: Dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    # Zalo wraps the payload as {"event_name": "...", "message": {...}} at the
    # TOP level (not nested inside `message`). Also tolerate the older
    # `{"result": {...}}` shape we initially coded against.
    update = body.get("result") if isinstance(body.get("result"), dict) else body
    message = update.get("message") if isinstance(update, dict) else None
    if not message:
        return {"ok": True}

    # event_name lives at the update level, not on `message` itself.
    event_name = update.get("event_name") or message.get("event_name") or ""

    chat = message.get("chat", {}) or {}
    chat_id = chat.get("id")
    chat_type = chat.get("chat_type") or chat.get("type") or ""
    from_user = message.get("from", {}) or {}
    zalo_user_id = str(from_user.get("id", ""))
    text = (message.get("text") or "").strip()

    if not chat_id:
        return {"ok": True}

    # Phase 1: DMs only (chat_type == "PRIVATE"); ignore groups until Zalo ships them
    if chat_type and chat_type.upper() != "PRIVATE":
        return {"ok": True}

    # `start CODE` registration handshake (Zalo Bot has no slash-command convention)
    lowered = text.lower()
    if lowered.startswith("start ") or lowered == "start":
        parts = text.split(maxsplit=1)
        code = parts[1].strip() if len(parts) > 1 else ""
        if code:
            background_tasks.add_task(
                _handle_zalo_start, code, chat_id, zalo_user_id, from_user
            )
        else:
            background_tasks.add_task(_send_zalo_start_hint, chat_id)
        return {"ok": True}

    platform_workspace_id = f"zalo:{chat_id}"
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    zalo_file_ids = _extract_zalo_image_file_ids(message)
    is_unsupported = event_name == "message.unsupported.received"
    thread_key = f"{chat_id}#0"

    # Unregistered chat — only nudge on a real message.
    if not workspace:
        if text or zalo_file_ids or is_unsupported:
            logger.warning(
                "Zalo message from unregistered chat: %s", platform_workspace_id
            )
            background_tasks.add_task(_send_zalo_unregistered_hint, chat_id)
        return {"ok": True}

    # Document (CSV/PDF/etc.) — Zalo delivers it as `message.unsupported.received`
    # with no downloadable reference. Phase 0: log the raw payload so we can
    # confirm whether a downloadable handle is actually present. Then mint the
    # web-upload URL (which also enters the 2-step flow at `awaiting_file`).
    if is_unsupported:
        try:
            logger.info(
                "Zalo unsupported payload probe: %s",
                json.dumps(
                    {
                        k: message.get(k)
                        for k in (
                            "file_id", "document", "file", "attachment",
                            "doc", "photo", "image", "sticker", "type",
                        )
                    },
                    default=str,
                ),
            )
            logger.info(
                "Zalo unsupported FULL message: %s",
                json.dumps(message, default=str)[:2000],
            )
        except Exception:
            pass
        background_tasks.add_task(_handle_zalo_unsupported_file, chat_id)
        return {"ok": True}

    if not text and not zalo_file_ids:
        return {"ok": True}

    # 1) An active 2-step collect flow takes precedence over everything else.
    if has_pending_collect(platform_workspace_id):
        background_tasks.add_task(
            handle_zalo_collect_step,
            platform_workspace_id=platform_workspace_id,
            chat_id=chat_id,
            text=text,
            zalo_file_ids=zalo_file_ids,
            start=False,
        )
        return {"ok": True}

    # 2) Pending clarification reply (existing behaviour).
    if text and has_pending_clarification(platform_workspace_id, thread_key):
        background_tasks.add_task(
            handle_zalo_clarification_reply,
            query=text,
            platform_workspace_id=platform_workspace_id,
            chat_id=chat_id,
        )
        return {"ok": True}

    # 3) Enter the 2-step collect flow:
    #    (a) auto — a file arrives with no accompanying prompt; or
    #    (b) explicit — user types exactly a start keyword (e.g. "phân tích").
    if (zalo_file_ids and not text) or (
        text and not zalo_file_ids and is_zalo_collect_trigger(text)
    ):
        background_tasks.add_task(
            handle_zalo_collect_step,
            platform_workspace_id=platform_workspace_id,
            chat_id=chat_id,
            text=text,
            zalo_file_ids=zalo_file_ids,
            start=True,
        )
        return {"ok": True}

    # 4) Default — image+caption in one message, or a plain text query.
    query = text or "(image attachment)"
    background_tasks.add_task(
        handle_zalo_query,
        query=query,
        platform_workspace_id=platform_workspace_id,
        chat_id=chat_id,
        zalo_file_ids=zalo_file_ids,
    )
    return {"ok": True}


def _send_zalo_start_hint(chat_id: Any) -> None:
    try:
        from app.services import zalo_service

        zalo_service.send_message(
            chat_id,
            "👋 Hi! I'm Dreamify Morpheus, your analytics teammate.\n\n"
            "To connect, generate a code at app.dreamify.dev under "
            "Integrations → Zalo, then send `start YOUR_CODE` here.",
        )
    except Exception as exc:
        logger.warning("Failed to send Zalo start hint: %s", exc)


def _send_zalo_unregistered_hint(chat_id: Any) -> None:
    """Reply when a Zalo DM arrives from a chat we don't have a workspace for."""
    try:
        from app.services import zalo_service

        zalo_service.send_message(
            chat_id,
            "🔌 You're not connected to Dreamify yet.\n\n"
            "Generate a code at app.dreamify.dev under Integrations → Zalo, "
            "then send `start YOUR_CODE` here.",
        )
    except Exception as exc:
        logger.warning("Failed to send Zalo unregistered hint: %s", exc)


# ── Zalo file upload (magic-token URL) ──────────────────────────────────────

ZALO_UPLOAD_TTL = 1800  # 30 minutes


def _zalo_upload_app_url() -> str:
    """Return the user-facing base URL where the upload page is served.

    Defers to chat_platform.dreamify_app_url so it can be overridden per env
    (ngrok in dev, app.dreamify.dev in prod).
    """
    return _dreamify_app_url().rstrip("/")


def _generate_upload_token() -> str:
    # 16-char URL-safe token (~96 bits of entropy)
    return secrets.token_urlsafe(12)


def _handle_zalo_unsupported_file(chat_id: Any) -> None:
    """Mint an upload token and reply with a tappable URL.

    Zalo Bot Platform delivers CSV/PDF/document attachments as
    ``message.unsupported.received`` with no downloadable reference, so the
    user must re-upload the file via the web. We park a token row pointing at
    the user's Zalo workspace; the upload page POSTs to
    ``/chat/zalo/upload/{token}`` and the asset queues onto the workspace.
    """
    from app.services import zalo_service

    platform_workspace_id = f"zalo:{chat_id}"
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    if not workspace:
        return

    token = _generate_upload_token()
    chat_platform_repo.save_workspace(
        platform_workspace_id=f"zalo_upload:{token}",
        user_id=workspace["user_id"],
        project_id=workspace.get("project_id", ""),
        platform="zalo_upload_token",
        bot_token_encrypted="",
        target_workspace_id=platform_workspace_id,
    )

    # Enter the 2-step collect flow at `awaiting_file`; the upload endpoint
    # advances it to `awaiting_prompt` once the file lands.
    try:
        chat_platform_repo.set_workspace_pending_collect(
            platform_workspace_id, build_collect_state("awaiting_file")
        )
    except Exception as exc:
        logger.warning("Failed to set Zalo collect state: %s", exc)

    upload_url = f"{_zalo_upload_app_url()}/zalo-upload/{token}"
    try:
        zalo_service.send_message(
            chat_id,
            "📎 Bot Zalo chưa nhận file trực tiếp được, nên bạn upload file tại đây "
            f"(hết hạn sau 30 phút):\n\n{upload_url}\n\n"
            "Upload xong mình sẽ hỏi câu hỏi bạn muốn phân tích.",
        )
    except Exception as exc:
        logger.warning("Failed to send Zalo upload URL: %s", exc)


class ZaloUploadInfoResponse(BaseModel):
    valid: bool
    workspace_name: Optional[str] = None
    expires_in: Optional[int] = None


@router.get("/chat/zalo/upload/{token}", response_model=ZaloUploadInfoResponse)
async def zalo_upload_info(token: str):
    """Return validity + remaining TTL for an upload token. No auth — the
    token IS the credential; the user got it via their authenticated Zalo
    chat session with our bot."""
    row = chat_platform_repo.get_workspace(f"zalo_upload:{token}")
    if not row or row.get("platform") != "zalo_upload_token":
        return ZaloUploadInfoResponse(valid=False)

    try:
        created_at = parse_timestamp_to_utc(row.get("created_at", ""))
        age = (_datetime.now(_timezone.utc) - created_at).total_seconds()
    except Exception:
        return ZaloUploadInfoResponse(valid=False)

    if age > ZALO_UPLOAD_TTL:
        return ZaloUploadInfoResponse(valid=False)

    target_id = row.get("target_workspace_id", "")
    target = chat_platform_repo.get_workspace(target_id) if target_id else None
    return ZaloUploadInfoResponse(
        valid=True,
        workspace_name=(target or {}).get("workspace_name"),
        expires_in=int(ZALO_UPLOAD_TTL - age),
    )


@router.post("/chat/zalo/upload/{token}")
async def zalo_upload_file(token: str, request: Request):
    """Accept a multipart file upload, validate the token, push to S3,
    queue the asset onto the target Zalo workspace, and ack to the user
    via the bot."""
    from fastapi import UploadFile
    import boto3
    from app.services import zalo_service
    from utils.dynamodb.repos import assets as assets_repo

    row = chat_platform_repo.get_workspace(f"zalo_upload:{token}")
    if not row or row.get("platform") != "zalo_upload_token":
        raise HTTPException(status_code=404, detail="Invalid or used upload token")

    try:
        created_at = parse_timestamp_to_utc(row.get("created_at", ""))
        age = (_datetime.now(_timezone.utc) - created_at).total_seconds()
    except Exception:
        age = ZALO_UPLOAD_TTL + 1
    if age > ZALO_UPLOAD_TTL:
        chat_platform_repo.delete_workspace(f"zalo_upload:{token}")
        raise HTTPException(status_code=410, detail="Upload token expired")

    target_id = row.get("target_workspace_id", "")
    target = chat_platform_repo.get_workspace(target_id) if target_id else None
    if not target:
        raise HTTPException(status_code=404, detail="Target workspace not found")

    form = await request.form()
    upload: Optional["UploadFile"] = form.get("file")  # type: ignore
    if upload is None:
        raise HTTPException(status_code=400, detail="No file provided")

    file_bytes = await upload.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    # Reuse the existing 5 MB ceiling for parity with inline image handling.
    if len(file_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 5 MB limit")

    user_id = target["user_id"]
    project_id = target["project_id"]
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    asset_id = str(uuid.uuid4())
    filename = upload.filename or f"upload_{asset_id}.bin"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    s3_key = f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{asset_id}.{ext}"

    try:
        s3 = boto3.client(
            "s3",
            region_name=config.aws.access_key.AWS_DEFAULT_REGION,
            aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
        )
        s3.put_object(Bucket=bucket, Key=s3_key, Body=file_bytes)
    except Exception as exc:
        logger.error("Zalo upload S3 put failed: %s", exc)
        raise HTTPException(status_code=500, detail="Storage upload failed")

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
            content_type=upload.content_type,
            asset_id=asset_id,
            file_id=asset_id,
            original_filename=filename,
            extension=ext,
        )
    except Exception as exc:
        logger.error("Zalo upload asset record failed: %s", exc)
        raise HTTPException(status_code=500, detail="Asset record failed")

    asset_record = {
        "asset_id": asset_id,
        "filename": filename,
        "s3_bucket": bucket,
        "s3_key": s3_key,
        "extension": ext,
        "queued_at": utc_now_iso(),
    }
    chat_platform_repo.append_pending_asset(target_id, asset_record)
    # Token is single-use
    chat_platform_repo.delete_workspace(f"zalo_upload:{token}")

    # If a 2-step collect flow is waiting on this file, advance it to the
    # prompt step so the user's next message is treated as the question.
    try:
        chat_platform_repo.set_workspace_pending_collect(
            target_id, build_collect_state("awaiting_prompt")
        )
    except Exception as exc:
        logger.warning("Failed to advance Zalo collect state: %s", exc)

    # Reach the user back in chat
    chat_id = target_id.split(":", 1)[1] if ":" in target_id else target_id
    try:
        zalo_service.send_message(
            chat_id,
            f"✅ Đã nhận '{filename}' ({len(file_bytes)/1024:.1f} KB).\n"
            "Giờ gửi câu hỏi bạn muốn phân tích về dữ liệu này nhé.",
        )
    except Exception as exc:
        logger.warning("Failed to ack Zalo upload: %s", exc)

    return {"ok": True, "filename": filename, "asset_id": asset_id}


def _handle_zalo_start(
    code: str, chat_id: Any, zalo_user_id: str, from_user: Dict[str, Any]
) -> None:
    """Validate registration code and create the Zalo workspace."""
    from app.services import zalo_service

    if not zalo_service._bot_token():
        logger.error("Zalo bot not configured")
        return

    pending_key = f"pending:{code}"
    pending = chat_platform_repo.get_workspace(pending_key)
    if not pending or pending.get("platform") != "zalo_pending":
        try:
            zalo_service.send_message(
                chat_id,
                "❌ Code not found. Please generate a new code at app.dreamify.dev.",
            )
        except Exception:
            pass
        return

    # Check expiry
    created_at_str = pending.get("created_at", "")
    try:
        created_at = parse_timestamp_to_utc(created_at_str)
        age_seconds = (_datetime.now(_timezone.utc) - created_at).total_seconds()
    except Exception:
        age_seconds = ZALO_CODE_TTL + 1  # treat malformed timestamp as expired

    if age_seconds > ZALO_CODE_TTL:
        chat_platform_repo.delete_workspace(pending_key)
        try:
            zalo_service.send_message(
                chat_id,
                "⏰ Code expired. Please generate a new code at app.dreamify.dev.",
            )
        except Exception:
            pass
        return

    user_id = pending["user_id"]
    platform_workspace_id = f"zalo:{chat_id}"

    existing = chat_platform_repo.get_workspace(platform_workspace_id)
    if existing:
        project_id = existing["project_id"]
    else:
        display_name = (
            from_user.get("display_name")
            or from_user.get("name")
            or f"user_{zalo_user_id}"
        )
        project = projects_repo.create_project(
            user_id=user_id,
            name=f"Zalo — {display_name}",
            description="Auto-created for Zalo DM integration",
        )
        project_id = project["project_id"]

    workspace_name = from_user.get("display_name") or from_user.get("name") or "Zalo DM"
    chat_platform_repo.save_workspace(
        platform_workspace_id=platform_workspace_id,
        user_id=user_id,
        project_id=project_id,
        platform="zalo",
        bot_token_encrypted="",  # global bot token used from config
        workspace_name=workspace_name,
        zalo_user_id=zalo_user_id,
    )
    chat_platform_repo.delete_workspace(pending_key)

    try:
        zalo_service.send_message(
            chat_id,
            "✅ Dreamify connected!\n\n"
            "I'm Morpheus, your analytics teammate. "
            "Just message me with a question about your data.\n\n"
            "Example: What were our top performing campaigns last month?",
        )
    except Exception as exc:
        logger.warning("Failed to send Zalo welcome message: %s", exc)


# ── Zalo registration code ────────────────────────────────────────────────────


class ZaloCodeResponse(BaseModel):
    code: str
    bot_username: str
    bot_id: str
    qr_url: str
    expires_in: int


@router.post("/chat/zalo/generate-code", response_model=ZaloCodeResponse)
async def zalo_generate_code(user_id: str = Depends(require_user)):
    """Generate a short-lived registration code for Zalo DM linking."""
    if not _zalo_bot_token():
        raise HTTPException(status_code=503, detail="Zalo integration not configured")

    # Opportunistic GC of stale zalo_pending rows for this user.
    try:
        pruned = chat_platform_repo.cleanup_expired_pending(
            "zalo_pending", ZALO_CODE_TTL, user_id=user_id
        )
        if pruned:
            logger.info(
                "Pruned %d expired zalo_pending rows for user %s", pruned, user_id
            )
    except Exception as exc:
        logger.warning("zalo_pending GC failed: %s", exc)

    code = _generate_telegram_code()  # shared helper — same alphabet/length
    pending_key = f"pending:{code}"

    chat_platform_repo.save_workspace(
        platform_workspace_id=pending_key,
        user_id=user_id,
        project_id="",
        platform="zalo_pending",
        bot_token_encrypted="",
    )

    # Return a relative path so the frontend always reaches the QR endpoint
    # via the same origin (Vite proxy in dev, same-host serving in prod).
    return ZaloCodeResponse(
        code=code,
        bot_username=_zalo_bot_username(),
        bot_id=_zalo_bot_id(),
        qr_url=f"/api/v1/chat/zalo/qr/{code}",
        expires_in=ZALO_CODE_TTL,
    )


# ── Zalo QR code (anonymous) ──────────────────────────────────────────────────


@router.get("/chat/zalo/qr/{code}")
async def zalo_qr_code(code: str):
    """Render an SVG QR that opens the Zalo bot profile when scanned.

    Zalo Bot Platform does not support deeplink payloads (unlike Telegram's
    `t.me/Bot?start=CODE`). The QR therefore encodes only the bot profile URL
    `https://zalo.me/{bot_id}`; the user still types `start <CODE>` manually.

    The path param ``code`` is unused for the encoded payload — it is kept in
    the URL so that each pending session gets its own cache-bust key, and so
    the frontend's `<img src>` invalidates whenever a new code is generated.
    """
    from fastapi.responses import Response
    import io
    import segno

    bot_id = _zalo_bot_id()
    if not bot_id:
        raise HTTPException(status_code=503, detail="Zalo integration not configured")

    target = f"https://zalo.me/{bot_id}"
    buf = io.BytesIO()
    segno.make(target, error="m").save(buf, kind="svg", scale=8, border=2)
    return Response(
        content=buf.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=900"},
    )


# ── Zalo status ───────────────────────────────────────────────────────────────


class ZaloStatusResponse(BaseModel):
    connected: bool
    workspace_name: Optional[str] = None
    platform_workspace_id: Optional[str] = None
    project_id: Optional[str] = None


@router.get("/chat/zalo/me", response_model=ZaloStatusResponse)
async def get_zalo_status(user_id: str = Depends(require_user)):
    """Return the current user's connected Zalo workspace, or connected=false."""
    workspace = chat_platform_repo.get_workspace_by_user(user_id, "zalo")
    if not workspace:
        return ZaloStatusResponse(connected=False)
    return ZaloStatusResponse(
        connected=True,
        workspace_name=workspace.get("workspace_name"),
        platform_workspace_id=workspace["platform_workspace_id"],
        project_id=workspace.get("project_id"),
    )


# ── WhatsApp Business Cloud API webhook ───────────────────────────────────────
#
# WhatsApp is DM-only (the Cloud API has no bot group chats / @-mentions), so it
# follows the Zalo model: a single Dreamify-owned sender number, code-link
# onboarding via `start CODE`, every inbound text is a query. It improves on Zalo
# with native inbound media download and interactive CTA-URL / reply buttons.

WHATSAPP_CODE_TTL = 900  # 15 minutes


def _whatsapp_app_secret() -> str:
    return config.whatsapp.app_secret if config.whatsapp else ""


def _whatsapp_verify_token() -> str:
    return config.whatsapp.verify_token if config.whatsapp else ""


def _whatsapp_bot_username() -> str:
    return config.whatsapp.bot_username if config.whatsapp else "Dreamify"


def _whatsapp_display_number() -> str:
    return config.whatsapp.business_phone_display if config.whatsapp else ""


def _whatsapp_deeplink(code: str) -> str:
    """wa.me deep link that pre-fills the `start CODE` message (better UX than
    Zalo's profile-only QR — WhatsApp supports prefilled text)."""
    number = _whatsapp_display_number()
    return f"https://wa.me/{number}?text={quote(f'start {code}')}"


def _verify_whatsapp_signature(request: Request, body: bytes) -> bool:
    """Verify Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the
    app secret). Dev-mode fallback (allow) when no secret is configured —
    mirrors the Telegram/Zalo webhook verifiers."""
    app_secret = _whatsapp_app_secret()
    if not app_secret:
        return True
    header = request.headers.get("X-Hub-Signature-256", "")
    if not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header[len("sha256="):], expected)


@router.get("/chat/whatsapp/webhook")
async def whatsapp_webhook_verify(request: Request):
    """Meta webhook verification handshake. Echo hub.challenge when the token
    matches. Returns plaintext per Meta's spec."""
    from fastapi.responses import PlainTextResponse

    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge", "")
    if mode == "subscribe" and token and token == _whatsapp_verify_token():
        return PlainTextResponse(content=challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


def _extract_whatsapp_messages(body: Dict[str, Any]) -> list:
    """Flatten the Cloud API webhook envelope to a list of message objects.

    Shape: entry[].changes[].value.messages[]. Statuses/echoes live under
    value.statuses and are ignored.
    """
    out = []
    for entry in body.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value", {}) or {}
            for msg in value.get("messages", []) or []:
                out.append(msg)
    return out


def _whatsapp_message_text(message: Dict[str, Any]) -> str:
    """Extract user-typed text from text or interactive (button/list) replies."""
    mtype = message.get("type")
    if mtype == "text":
        return (message.get("text", {}) or {}).get("body", "").strip()
    if mtype == "interactive":
        interactive = message.get("interactive", {}) or {}
        itype = interactive.get("type")
        if itype == "button_reply":
            return (interactive.get("button_reply", {}) or {}).get("title", "").strip()
        if itype == "list_reply":
            return (interactive.get("list_reply", {}) or {}).get("title", "").strip()
    if mtype == "button":
        # Template quick-reply button
        return (message.get("button", {}) or {}).get("text", "").strip()
    return ""


def _extract_whatsapp_media_ids(message: Dict[str, Any]) -> list:
    """Return media_ids for image/document attachments on an inbound message."""
    ids = []
    for key in ("image", "document", "video", "audio"):
        obj = message.get(key)
        if isinstance(obj, dict) and obj.get("id"):
            ids.append(obj["id"])
    return ids


@router.post("/chat/whatsapp/webhook")
async def whatsapp_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive WhatsApp Cloud API events. Must respond within ~seconds; actual
    processing runs in a background task."""
    body_bytes = await request.body()
    if not _verify_whatsapp_signature(request, body_bytes):
        raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        body = json.loads(body_bytes)
    except Exception:
        return {"ok": True}

    for message in _extract_whatsapp_messages(body):
        wa_id = str(message.get("from", ""))
        if not wa_id:
            continue

        text = _whatsapp_message_text(message)
        media_ids = _extract_whatsapp_media_ids(message)

        # `start CODE` registration handshake
        lowered = text.lower()
        if lowered.startswith("start ") or lowered == "start":
            parts = text.split(maxsplit=1)
            code = parts[1].strip() if len(parts) > 1 else ""
            if code:
                background_tasks.add_task(_handle_whatsapp_start, code, wa_id, message)
            else:
                background_tasks.add_task(_send_whatsapp_start_hint, wa_id)
            continue

        if not text and not media_ids:
            continue

        platform_workspace_id = f"whatsapp:{wa_id}"
        workspace = chat_platform_repo.get_workspace(platform_workspace_id)
        if not workspace:
            logger.warning("WhatsApp message from unregistered wa_id: %s", wa_id)
            background_tasks.add_task(_send_whatsapp_unregistered_hint, wa_id)
            continue

        query = text or "(image attachment)"
        thread_key = f"{wa_id}#0"
        if text and has_pending_clarification(platform_workspace_id, thread_key):
            background_tasks.add_task(
                handle_whatsapp_clarification_reply,
                query=query,
                platform_workspace_id=platform_workspace_id,
                wa_id=wa_id,
            )
            continue

        background_tasks.add_task(
            handle_whatsapp_query,
            query=query,
            platform_workspace_id=platform_workspace_id,
            wa_id=wa_id,
            whatsapp_media_ids=media_ids,
        )

    return {"ok": True}


def _send_whatsapp_start_hint(wa_id: str) -> None:
    try:
        from app.services import whatsapp_service

        whatsapp_service.send_message(
            wa_id,
            "👋 Hi! I'm Dreamify Morpheus, your analytics teammate.\n\n"
            "To connect, generate a code at app.dreamify.dev under "
            "Integrations → WhatsApp, then send `start YOUR_CODE` here.",
        )
    except Exception as exc:
        logger.warning("Failed to send WhatsApp start hint: %s", exc)


def _send_whatsapp_unregistered_hint(wa_id: str) -> None:
    try:
        from app.services import whatsapp_service

        whatsapp_service.send_message(
            wa_id,
            "🔌 You're not connected to Dreamify yet.\n\n"
            "Generate a code at app.dreamify.dev under Integrations → WhatsApp, "
            "then send `start YOUR_CODE` here.",
        )
    except Exception as exc:
        logger.warning("Failed to send WhatsApp unregistered hint: %s", exc)


def _handle_whatsapp_start(code: str, wa_id: str, message: Dict[str, Any]) -> None:
    """Validate registration code and create the WhatsApp workspace."""
    from app.services import whatsapp_service

    if not whatsapp_service.is_configured():
        logger.error("WhatsApp bot not configured")
        return

    pending_key = f"pending:{code}"
    pending = chat_platform_repo.get_workspace(pending_key)
    if not pending or pending.get("platform") != "whatsapp_pending":
        whatsapp_service.send_message(
            wa_id, "❌ Code not found. Please generate a new code at app.dreamify.dev."
        )
        return

    created_at_str = pending.get("created_at", "")
    try:
        created_at = parse_timestamp_to_utc(created_at_str)
        age_seconds = (_datetime.now(_timezone.utc) - created_at).total_seconds()
    except Exception:
        age_seconds = WHATSAPP_CODE_TTL + 1

    if age_seconds > WHATSAPP_CODE_TTL:
        chat_platform_repo.delete_workspace(pending_key)
        whatsapp_service.send_message(
            wa_id, "⏰ Code expired. Please generate a new code at app.dreamify.dev."
        )
        return

    user_id = pending["user_id"]
    platform_workspace_id = f"whatsapp:{wa_id}"

    # The contact name (if shared) lives in value.contacts[].profile.name; the
    # message payload itself doesn't carry it, so fall back to the number.
    display_name = (message.get("profile", {}) or {}).get("name") or f"+{wa_id}"

    existing = chat_platform_repo.get_workspace(platform_workspace_id)
    if existing:
        project_id = existing["project_id"]
    else:
        project = projects_repo.create_project(
            user_id=user_id,
            name=f"WhatsApp — {display_name}",
            description="Auto-created for WhatsApp DM integration",
        )
        project_id = project["project_id"]

    chat_platform_repo.save_workspace(
        platform_workspace_id=platform_workspace_id,
        user_id=user_id,
        project_id=project_id,
        platform="whatsapp",
        bot_token_encrypted="",  # global token used from config
        workspace_name=display_name,
        whatsapp_user_id=wa_id,
    )
    chat_platform_repo.delete_workspace(pending_key)

    whatsapp_service.send_message(
        wa_id,
        "✅ Dreamify connected!\n\n"
        "I'm Morpheus, your analytics teammate. "
        "Just message me with a question about your data.\n\n"
        "Example: What were our top performing campaigns last month?",
    )


# ── WhatsApp registration code ────────────────────────────────────────────────


class WhatsAppCodeResponse(BaseModel):
    code: str
    bot_username: str
    phone_number: str
    deeplink: str
    qr_url: str
    expires_in: int


@router.post("/chat/whatsapp/generate-code", response_model=WhatsAppCodeResponse)
async def whatsapp_generate_code(user_id: str = Depends(require_user)):
    """Generate a short-lived registration code for WhatsApp DM linking."""
    if config.whatsapp is None or not config.whatsapp.phone_number_id:
        raise HTTPException(status_code=503, detail="WhatsApp integration not configured")

    try:
        pruned = chat_platform_repo.cleanup_expired_pending(
            "whatsapp_pending", WHATSAPP_CODE_TTL, user_id=user_id
        )
        if pruned:
            logger.info(
                "Pruned %d expired whatsapp_pending rows for user %s", pruned, user_id
            )
    except Exception as exc:
        logger.warning("whatsapp_pending GC failed: %s", exc)

    code = _generate_telegram_code()  # shared helper — same alphabet/length
    pending_key = f"pending:{code}"

    chat_platform_repo.save_workspace(
        platform_workspace_id=pending_key,
        user_id=user_id,
        project_id="",
        platform="whatsapp_pending",
        bot_token_encrypted="",
    )

    return WhatsAppCodeResponse(
        code=code,
        bot_username=_whatsapp_bot_username(),
        phone_number=_whatsapp_display_number(),
        deeplink=_whatsapp_deeplink(code),
        qr_url=f"/api/v1/chat/whatsapp/qr/{code}",
        expires_in=WHATSAPP_CODE_TTL,
    )


# ── WhatsApp QR code (anonymous) ──────────────────────────────────────────────


@router.get("/chat/whatsapp/qr/{code}")
async def whatsapp_qr_code(code: str):
    """Render an SVG QR encoding the wa.me deep link with the `start CODE`
    message pre-filled, so scanning opens a chat ready to send."""
    from fastapi.responses import Response
    import io
    import segno

    if not _whatsapp_display_number():
        raise HTTPException(status_code=503, detail="WhatsApp integration not configured")

    target = _whatsapp_deeplink(code)
    buf = io.BytesIO()
    segno.make(target, error="m").save(buf, kind="svg", scale=8, border=2)
    return Response(
        content=buf.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=900"},
    )


# ── WhatsApp status ───────────────────────────────────────────────────────────


class WhatsAppStatusResponse(BaseModel):
    connected: bool
    workspace_name: Optional[str] = None
    platform_workspace_id: Optional[str] = None
    project_id: Optional[str] = None


@router.get("/chat/whatsapp/me", response_model=WhatsAppStatusResponse)
async def get_whatsapp_status(user_id: str = Depends(require_user)):
    """Return the current user's connected WhatsApp workspace, or connected=false."""
    workspace = chat_platform_repo.get_workspace_by_user(user_id, "whatsapp")
    if not workspace:
        return WhatsAppStatusResponse(connected=False)
    return WhatsAppStatusResponse(
        connected=True,
        workspace_name=workspace.get("workspace_name"),
        platform_workspace_id=workspace["platform_workspace_id"],
        project_id=workspace.get("project_id"),
    )
