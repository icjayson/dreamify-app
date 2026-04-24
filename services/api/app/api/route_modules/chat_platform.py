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
import os
import re
import time
import uuid
from typing import Any, Dict, Optional
from urllib.parse import quote

from dotenv import load_dotenv
load_dotenv()

import requests as http_requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.dependencies.auth import require_user
from app.services.chat_platform_service import handle_slack_query
from app.services.slack_service import decrypt_token, encrypt_token
from utils.config import config
from utils.dynamodb.repos import chat_platform_repo
from utils.dynamodb.repos import projects as projects_repo

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

SLACK_CLIENT_ID = os.environ.get("SLACK_CLIENT_ID", "")
SLACK_CLIENT_SECRET = os.environ.get("SLACK_CLIENT_SECRET", "")
SLACK_OAUTH_SCOPES = (
    "channels:history,channels:join,groups:history,im:history,"
    "chat:write,chat:write.public,files:read,files:write,app_mentions:read,commands"
)
DREAMIFY_APP_URL = os.environ.get("DREAMIFY_APP_URL", "http://localhost:8080")
STATE_TOKEN_TTL = 600  # 10 minutes


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
    if not SLACK_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Slack integration not configured")

    state = _create_state_token(user_id)
    redirect_uri = f"{DREAMIFY_APP_URL}/api/v1/chat/slack/oauth/callback"
    url = (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={SLACK_CLIENT_ID}"
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
    frontend_base = f"{DREAMIFY_APP_URL}/workspace?tab=connectors"

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

    redirect_uri = f"{DREAMIFY_APP_URL}/api/v1/chat/slack/oauth/callback"
    resp = http_requests.post(
        "https://slack.com/api/oauth.v2.access",
        data={
            "client_id": SLACK_CLIENT_ID,
            "client_secret": SLACK_CLIENT_SECRET,
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
