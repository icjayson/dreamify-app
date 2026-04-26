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
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

import boto3
import requests

from app.services.credit_service import CreditService
from app.services.chart_renderer import is_chart_rendering_enabled, render_dashboard_previews
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

logger = logging.getLogger(__name__)

MORPHEUS_SERVICE_URL = os.environ.get("MORPHEUS_SERVICE_URL", "http://localhost:8000")
DREAMIFY_APP_URL = os.environ.get("DREAMIFY_APP_URL", "https://app.dreamify.dev")

# Chat queries always use the "fast" model alias (5 credits).
CHAT_MODEL_ALIAS = "fast"
CHAT_MODEL_ID = os.environ.get("DREAMIFY_FAST_MODEL", "gemini-3-flash-preview")
CHAT_CREDIT_COST = 5

# Polling config
POLL_INTERVAL_S = 3
POLL_MAX_ATTEMPTS = 100  # ~5 minutes

credit_service = CreditService()


# ── Conversation helpers ──────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now().isoformat()


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


def _build_conversation_keys(user_id: str, project_id: str, conversation_id: str) -> Dict[str, str]:
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


def _build_dashboard_url(project_id: str, conversation: Dict[str, Any]) -> Optional[str]:
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
        without_scheme = s3_uri[len("s3://"):]
        bucket, _, key = without_scheme.partition("/")
        raw = download_bytes(bucket, key)
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Failed to load dashboard JSON from %s: %s", s3_uri, exc)
        return None


def _extract_top_metrics(dashboard: Dict[str, Any], max_n: int = 4) -> list:
    """Return up to max_n metric dicts from a dashboard JSON config."""
    return dashboard.get("metrics", [])[:max_n]


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
    conversation = load_conversation(conversation_meta["s3_bucket"], conversation_meta["s3_key"])
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
) -> None:
    payload = {
        "conversation_id": conversation_id,
        "conversation_uri": f"s3://{bucket}/{keys['primary']}",
        "conversation_backup_uri": f"s3://{bucket}/{keys['backup']}",
        "project_id": project_id,
        "user_id": user_id,
        "model": CHAT_MODEL_ID,
    }
    try:
        response = requests.post(f"{MORPHEUS_SERVICE_URL}/run", json=payload, timeout=30)
        response.raise_for_status()
    except requests.exceptions.ReadTimeout:
        # Morpheus /run blocks while waiting for a previous workflow to stop before
        # returning. The job has been accepted and will run; we can poll for completion.
        logger.warning("Morpheus /run read timeout for %s — workflow accepted, polling anyway", conversation_id)


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
            logger.warning("DynamoDB get_node error for %s (will retry): %s", conversation_id, e)
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
        if status in ("completed", "error", "stopped"):
            return status, last_step, metadata
    return "timeout", last_step, {}


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
                        logger.error("Failed to download Slack file %s: HTTP %s", filename, resp.status)
                        continue
                    file_bytes = await resp.read()
        except Exception as exc:
            logger.error("Error downloading Slack file %s: %s", filename, exc)
            continue

        asset_id = str(uuid.uuid4())
        s3_key = f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{asset_id}.{ext}"

        try:
            s3 = boto3.client(
                "s3",
                region_name=config.aws.access_key.AWS_DEFAULT_REGION,
                aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
            )
            s3.put_object(Bucket=bucket, Key=s3_key, Body=file_bytes, ContentType=mimetype or "application/octet-stream")
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

        asset_nodes.append({
            "type": "asset",
            "data": {
                "asset_id": asset_id,
                "file_id": asset_id,
                "s3_bucket": bucket,
                "s3_key": s3_key,
                "extension": ext,
                "filename": filename,
            },
        })
        logger.info("Attached Slack file %s as asset %s", filename, asset_id)

    if not asset_nodes:
        return

    # Append asset nodes to the last user node's contents
    nodes = conversation.get("nodes", [])
    for node in reversed(nodes):
        if node.get("role") == "user":
            node.setdefault("contents", []).extend(asset_nodes)
            break

    conversation["updated_at"] = _now_iso()
    save_conversation(bucket, keys["primary"], conversation)
    save_conversation(bucket, keys["backup"], conversation)


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
        logger.error("Failed to decrypt bot token for %s: %s", platform_workspace_id, exc)
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
            bucket, keys = _save_new_conversation(user_id, project_id, conversation_id, query)
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
            conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
            if conversation_meta:
                conv = load_conversation(conversation_meta["s3_bucket"], conversation_meta["s3_key"])
                await _download_and_attach_slack_files(
                    slack_files, bot_token, user_id, project_id, conv, bucket, keys
                )
                await asyncio.sleep(0.5)  # S3 consistency after file upload

        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)

        final_status, _, final_meta = await _poll_workflow(conversation_id, on_step=update_status)

        if final_status != "completed":
            await client.chat_update(
                channel=channel_id,
                ts=placeholder_ts,
                blocks=build_error_blocks(
                    "Analysis did not complete. Please try again."
                ),
                text="Analysis failed.",
            )
            return

        # For plain Q&A responses Morpheus puts the reply directly in the status metadata,
        # so we can skip the S3 load entirely.
        metrics: list = []
        dashboard_json: Optional[Dict[str, Any]] = None
        if final_meta.get("response_type") == "message" and final_meta.get("content"):
            narrative = final_meta["content"]
            dashboard_url = None
            logger.info("Using inline narrative from workflow metadata (len=%d)", len(narrative))
        else:
            # Load completed conversation and extract narrative
            logger.info("Workflow completed, loading conversation %s", conversation_id)
            conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
            if not conversation_meta:
                raise RuntimeError(f"Post-poll: conversation {conversation_id} not found in DynamoDB")
            logger.info("Loading S3 conversation from %s/%s", conversation_meta["s3_bucket"], conversation_meta["s3_key"])
            conversation = load_conversation(
                conversation_meta["s3_bucket"], conversation_meta["s3_key"]
            )
            narrative = _extract_narrative(conversation) or "Analysis complete. No narrative returned."
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
                    logger.warning("Failed to enable public preview for %s: %s", project_id, exc)

                s3_uri = dashboards[-1].get("s3_uri")
                if s3_uri:
                    dashboard_json = _load_dashboard_json(s3_uri)
                    if dashboard_json:
                        metrics = _extract_top_metrics(dashboard_json)
                        logger.info("Extracted %d metric(s) from dashboard", len(metrics))

        logger.info("Updating Slack message with narrative (len=%d)", len(narrative))

        await client.chat_update(
            channel=channel_id,
            ts=placeholder_ts,
            blocks=build_response_blocks(narrative, dashboard_url, CHAT_CREDIT_COST, metrics=metrics),
            text=narrative,
        )
        logger.info("Successfully updated Slack message for conversation %s", conversation_id)

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
        logger.error("handle_slack_query failed for %s: %s", platform_workspace_id, exc, exc_info=True)
        if placeholder_ts:
            try:
                await client.chat_update(
                    channel=channel_id,
                    ts=placeholder_ts,
                    blocks=build_error_blocks("Something went wrong. Please try again."),
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
        logger.info("No Slack workspace connected for user %s — skipping Slack post", user_id)
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
            blocks=build_sync_placeholder_blocks(provider_label, account_name, rows_fetched),
            text=f"✅ {account_name} synced · Analyzing…",
        )
        placeholder_ts = resp["ts"]
    except Exception as exc:
        logger.error("Failed to post sync placeholder to Slack: %s", exc)
        return

    # 3. Create a new conversation with text prompt + asset content
    conversation_id = str(uuid.uuid4())
    now_iso = datetime.now().isoformat()
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
        "metadata": {"chat_mode": CHAT_MODEL_ALIAS, "resolved_model": CHAT_MODEL_ID},
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
        logger.error("Failed to save sync analysis conversation %s: %s", conversation_id, exc)
        await _update_slack_error(client, channel_id, placeholder_ts)
        return

    await asyncio.sleep(0.5)

    # 4. Trigger Morpheus
    try:
        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)
    except Exception as exc:
        logger.error("Failed to trigger Morpheus for sync analysis %s: %s", conversation_id, exc)
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

    final_status, _, final_meta = await _poll_workflow(conversation_id, on_step=_on_step)

    if final_status != "completed":
        await _update_slack_error(client, channel_id, placeholder_ts, "Analysis did not complete.")
        return

    # 6. Extract result and update Slack message
    metrics: list = []
    dashboard_url: Optional[str] = None
    if final_meta.get("response_type") == "message" and final_meta.get("content"):
        narrative = final_meta["content"]
    else:
        try:
            conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
            if conversation_meta:
                conv = load_conversation(conversation_meta["s3_bucket"], conversation_meta["s3_key"])
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
                provider_label, account_name, rows_fetched, narrative, dashboard_url, metrics
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

        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            logger.warning(
                "Auto-refresh: conversation %s not found in DynamoDB — skipping", conversation_id
            )
            return

        conversation = load_conversation(
            conversation_meta["s3_bucket"], conversation_meta["s3_key"]
        )

        now_iso = datetime.now().isoformat()
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
            "metadata": {"chat_mode": CHAT_MODEL_ALIAS, "resolved_model": CHAT_MODEL_ID},
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
        _call_morpheus(conversation_id, project_id, user_id, bucket, keys)
        credit_service.consume_credits(user_id, CHAT_CREDIT_COST)
        logger.info(
            "Auto-refresh triggered for conversation %s in project %s",
            conversation_id, project_id,
        )
    except Exception as exc:
        logger.error(
            "Auto-refresh failed for conversation %s: %s", conversation_id, exc, exc_info=True
        )


async def _update_slack_error(
    client: Any, channel_id: str, placeholder_ts: Optional[str], msg: str = "Something went wrong."
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
