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
from urllib.parse import quote

import requests as http_requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.dependencies.auth import require_user
from app.services.chat_platform_service import handle_slack_query, handle_telegram_query
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


# ── State token (signed, short-lived, no new deps) ────────────────────────────

def _create_state_token(user_id: str) -> str:
    payload = json.dumps({"user_id": user_id, "exp": int(time.time()) + STATE_TOKEN_TTL})
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

def _fetch_slack_files(bot_token: str, channel_id: str, message_ts: str) -> list:
    """
    Retrieve the file attachments for a specific Slack message.

    The ``app_mention`` event payload intentionally omits the ``files`` field;
    only ``message`` events carry it.  The authoritative way to get files for a
    given message is to call ``conversations.replies`` with the exact message
    timestamp (inclusive=True, limit=1) — this works for both top-level messages
    and thread replies.

    Requires the ``files:read`` bot scope so that ``url_private_download`` links
    are accessible for download later.

    Returns an empty list on any error so the caller degrades gracefully.
    """
    if not bot_token or not channel_id or not message_ts:
        return []

    try:
        resp = http_requests.get(
            "https://slack.com/api/conversations.replies",
            headers={"Authorization": f"Bearer {bot_token}"},
            params={
                "channel": channel_id,
                "ts": message_ts,        # thread parent (or the message itself)
                "latest": message_ts,   # narrow to exactly this message
                "inclusive": "true",
                "limit": "1",
            },
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            logger.warning(
                "conversations.replies returned error for ts=%s: %s",
                message_ts, data.get("error"),
            )
            return []

        messages = data.get("messages", [])
        for msg in messages:
            if msg.get("ts") == message_ts:
                files = msg.get("files", [])
                logger.info(
                    "Fetched %d file(s) from Slack message ts=%s", len(files), message_ts
                )
                return files

        logger.info("No message matched ts=%s in conversations.replies response", message_ts)
        return []

    except Exception as exc:
        logger.warning("_fetch_slack_files failed for ts=%s: %s", message_ts, exc)
        return []


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
            logger.warning("Mention from unregistered workspace: %s", platform_workspace_id)
            return {"ok": True}

        # The app_mention event never includes a `files` field by Slack design.
        # Fetch the real message object via conversations.replies to get attachments.
        message_ts = event.get("ts", "")
        bot_token = decrypt_token(workspace["bot_token_encrypted"])
        slack_files = _fetch_slack_files(bot_token, channel_id, message_ts)
        if slack_files:
            logger.info(
                "Found %d file(s) attached to Slack mention (ts=%s)",
                len(slack_files), message_ts,
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


@router.get("/chat/workspaces/{platform_workspace_id}", response_model=WorkspaceResponse)
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

    message = body.get("message") or body.get("edited_message")
    if not message:
        return {"ok": True}

    chat = message.get("chat", {})
    chat_id: int = chat.get("id", 0)
    chat_type: str = chat.get("type", "")  # "private", "group", "supergroup", "channel"
    from_user = message.get("from", {})
    telegram_user_id: str = str(from_user.get("id", ""))
    text: str = message.get("text", "").strip()
    message_thread_id: Optional[int] = message.get("message_thread_id")

    if not chat_id or not text:
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
        background_tasks.add_task(_handle_telegram_connect, chat_id, chat, telegram_user_id)
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
    if not query:
        return {"ok": True}

    # Determine platform_workspace_id
    platform_workspace_id = f"telegram:{chat_id}"
    workspace = chat_platform_repo.get_workspace(platform_workspace_id)
    if not workspace:
        logger.warning("Telegram message from unregistered chat: %s", platform_workspace_id)
        return {"ok": True}

    # Collect document file_ids (CSV / data files)
    telegram_file_ids = _extract_document_file_ids(message)

    background_tasks.add_task(
        handle_telegram_query,
        query=query,
        platform_workspace_id=platform_workspace_id,
        chat_id=chat_id,
        message_thread_id=message_thread_id,
        telegram_file_ids=telegram_file_ids,
    )
    return {"ok": True}


def _is_bot_mentioned(message: Dict[str, Any]) -> bool:
    """Return True if the bot's username appears in the message entities."""
    bot_mention = f"@{_telegram_bot_username()}".lower()
    for entity in message.get("entities", []):
        if entity.get("type") == "mention":
            offset = entity.get("offset", 0)
            length = entity.get("length", 0)
            text = message.get("text", "")
            mention = text[offset:offset + length].lower()
            if mention == bot_mention:
                return True
    return False


def _strip_bot_mention(text: str) -> str:
    """Remove @BotUsername from the query text."""
    return re.sub(rf"@{re.escape(_telegram_bot_username())}", "", text, flags=re.IGNORECASE).strip()


def _extract_document_file_ids(message: Dict[str, Any]) -> list:
    """Return file_ids for documents attached to the message."""
    doc = message.get("document")
    if doc and doc.get("file_id"):
        return [doc["file_id"]]
    return []


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
        created_at = _datetime.fromisoformat(created_at_str)
        age_seconds = (_datetime.now() - created_at).total_seconds()
        logger.info("Telegram code %s age: %.1fs (TTL: %d)", code, age_seconds, TELEGRAM_CODE_TTL)
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

    logger.info("Saving Telegram workspace: %s for user %s", platform_workspace_id, user_id)
    try:
        chat_platform_repo.save_workspace(
            platform_workspace_id=platform_workspace_id,
            user_id=user_id,
            project_id=project_id,
            platform="telegram",
            bot_token_encrypted="",  # global bot token used from env
            workspace_name=from_user.get("first_name") or from_user.get("username") or "Telegram DM",
            telegram_user_id=telegram_user_id,
        )
        logger.info("Successfully saved Telegram workspace: %s", platform_workspace_id)
    except Exception as exc:
        logger.error("Failed to save Telegram workspace %s: %s", platform_workspace_id, exc)
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
    dm_workspace = chat_platform_repo.get_workspace_by_telegram_user_id(telegram_user_id)
    if not dm_workspace:
        try:
            await bot.send_message(
                chat_id=chat_id,
                text=(
                    "⚠️ You haven't connected your Dreamify account yet\\.\n\n"
                    "DM me first: click [here](https://t.me/" +
                    re.escape(_telegram_bot_username()) + ") and send `/start YOUR_CODE`\\."
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
                "Mention me with a question: `@" + _telegram_bot_username() + " why did signups drop?`"
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
        raise HTTPException(status_code=503, detail="Telegram integration not configured")

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
