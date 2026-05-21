import warnings 
warnings.filterwarnings("ignore", message="Core Pydantic V1 functionality isn't compatible with Python 3.14", category=UserWarning)

from datetime import datetime
import json
import os
import re as _re
import tempfile
import time
import uuid
import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiohttp
import requests

from morpheus.workflows.analyze_csv.state_graph import StatefulAnalyzeCSVWorkflow
from utils.config import config
from utils.dynamodb import save_dashboard_metadata
from utils.health import check_health
from utils.logger import logger
from utils.s3_client import download_bytes, get_s3_client

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic models for request/response
class RunRequest(BaseModel):
    conversation_id: str
    conversation_uri: str
    conversation_backup_uri: Optional[str] = None
    project_id: str
    user_id: str
    model: Optional[str] = None
    theme_id: Optional[str] = None
    analysis_focus_id: Optional[str] = None
    # Legacy compatibility: older backend payloads sent use-case template IDs.
    template_id: Optional[str] = None
    project_assets: List[Dict[str, Any]] = []


class StatusRequest(BaseModel):
    conversation_id: str
    project_id: str


# Backend API URL for updating file records
BACKEND_API_URL = config.app.backend_url.rstrip("/")
MORPHEUS_API_KEY = config.app.morpheus_api_key

VALID_THEME_IDS = {
    "default",
    "carbon",
    "slate",
    "chalk",
    "warm",
    "ash",
    "sage",
    "ink",
    "aurora",
    "glacier",
    "coral",
    "orchid",
    "mint",
    "crimson",
    "cobalt",
    "sandstone",
}
LEGACY_TEMPLATE_THEME_MAP = {
    "default": "default",
    "saas_growth": "carbon",
    "ecommerce_sales": "slate",
    "finance_overview": "chalk",
    "marketing_funnel": "sage",
    "ops_performance": "ash",
    "product_analytics": "ink",
    "hr_workforce": "warm",
    "executive_summary": "carbon",
}


def _resolve_theme_id(theme_id: Optional[str], template_id: Optional[str] = None) -> Optional[str]:
    resolved = theme_id or LEGACY_TEMPLATE_THEME_MAP.get(template_id or "")
    return resolved if resolved in VALID_THEME_IDS else None


def _effective_theme_id(theme_id: Optional[str], template_id: Optional[str] = None) -> str:
    return _resolve_theme_id(theme_id, template_id) or "default"


def _apply_theme_to_dashboard_data(data: Dict[str, Any], theme_id: Optional[str]) -> None:
    if not theme_id or not isinstance(data, dict):
        return
    data["theme_id"] = theme_id
    styling_recommendations = data.get("styling_recommendations")
    if not isinstance(styling_recommendations, dict):
        styling_recommendations = {}
        data["styling_recommendations"] = styling_recommendations
    styling_recommendations["theme"] = theme_id

    for key in ("metrics", "charts", "tables"):
        items = data.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            styling = item.get("styling")
            if not isinstance(styling, dict):
                styling = {}
                item["styling"] = styling
            styling["theme"] = theme_id

STEP_FRIENDLY_MAP: Dict[str, str] = {
    "start": "Waking up...",
    "load_conversation": "Reading conversation context...",
    "download_asset": "Analyzing file structure...",
    "run_workflow": "Booting up data engine...",
    "routing": "Understanding your goal...",
    "reasoning": "Planning the best visualization...",
    "execution": "Crunching the numbers...",
    "synthesis": "Designing your dashboard...",
    "validation": "Double-checking results...",
    "finish": "Finalizing...",
    "error": "I ran into a hiccup.",
}

# Only persist meaningful AI processing steps (exclude infrastructure/setup steps)
SAVEABLE_WORKFLOW_STEPS = {"load_conversation",  "download_asset", "routing","execution", "synthesis", "validation"}


STEP_PHASE_MAP: Dict[str, str] = {
    "initialized": "queued",
    "load_conversation": "context",
    "download_asset": "context",
    "run_workflow": "analysis",
    "explore_files": "analysis",
    "routing": "routing",
    "reasoning": "analysis",
    "reasoning_internal": "analysis",
    "execution": "tool",
    "synthesis": "synthesis",
    "validation": "validation",
    "finish": "final",
    "error": "error",
}

STEP_TITLE_MAP: Dict[str, str] = {
    "initialized": "Queued for analysis",
    "load_conversation": "Reading project context",
    "download_asset": "Loading data assets",
    "run_workflow": "Starting analysis workflow",
    "explore_files": "Profiling data structure",
    "routing": "Choosing analysis path",
    "reasoning": "Planning next analysis step",
    "reasoning_internal": "Comparing analytical options",
    "execution": "Running analysis tool",
    "synthesis": "Drafting answer with visual",
    "validation": "Validating numbers",
    "finish": "Finishing response",
    "error": "Handling issue",
}


def _safe_preview(value: Any, limit: int = 700) -> str:
    text = str(value or "").strip()
    text = _re.sub(r"\s+", " ", text)
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


class ThinkingTracer:
    """Append-only, user-safe workflow activity trace."""

    def __init__(self, conversation_id: str):
        self.conversation_id = conversation_id
        self.run_id = f"run_{uuid.uuid4().hex[:12]}"
        self.sequence = 0
        self.events: List[Dict[str, Any]] = []
        self._seen_setup_steps: set[str] = set()

    def emit(
        self,
        phase: str,
        title: str,
        summary: Optional[str] = None,
        detail: Optional[str] = None,
        status: str = "completed",
        metadata: Optional[Dict[str, Any]] = None,
        duration_ms: Optional[float] = None,
    ) -> Dict[str, Any]:
        self.sequence += 1
        now = datetime.now().isoformat()
        event = {
            "id": f"{self.run_id}:{self.sequence}",
            "run_id": self.run_id,
            "sequence": self.sequence,
            "phase": phase,
            "status": status,
            "title": _safe_preview(title, 120) or "Thinking",
            "summary": _safe_preview(summary, 260) if summary else None,
            "detail": _safe_preview(detail, 900) if detail else None,
            "started_at": now,
            "completed_at": now if status in {"completed", "error"} else None,
            "duration_ms": duration_ms,
            "metadata": metadata or {},
        }
        self.events.append(event)
        _post_workflow_event_sync(self.conversation_id, self.run_id, self.sequence, event)
        return event

    def emit_status(self, metadata: Optional[Dict[str, Any]], status: str) -> None:
        if not metadata:
            return
        step = str(metadata.get("step") or "").lower()
        if not step:
            return
        status_key = f"{step}:{metadata.get('iteration', '')}:{status}"
        if metadata.get("iteration") is None and status_key in self._seen_setup_steps:
            return
        self._seen_setup_steps.add(status_key)
        event_status = "error" if status == "error" else "completed"
        self.emit(
            phase=STEP_PHASE_MAP.get(step, "analysis"),
            title=STEP_TITLE_MAP.get(step, STEP_FRIENDLY_MAP.get(step, "Processing")),
            summary=metadata.get("log") or metadata.get("message") or metadata.get("error"),
            detail=metadata.get("error"),
            status=event_status,
            metadata={
                "step": step,
                "node": metadata.get("node"),
                "iteration": metadata.get("iteration"),
            },
        )

    def snapshot(self, finalize: bool = False) -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        for event in self.events:
            copied = dict(event)
            if finalize and copied.get("status") == "active":
                copied["status"] = "completed"
                copied["completed_at"] = copied.get("completed_at") or datetime.now().isoformat()
            events.append(copied)
        return events


def _parse_run_tasks(prompt: str) -> List[Dict[str, str]]:
    """Parse user-defined tasks from a /run prompt."""
    if not prompt or not prompt.strip().startswith("/run"):
        return []
    text = prompt.strip()[4:].strip()
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    tasks: List[Dict[str, str]] = []
    for i, line in enumerate(lines):
        cleaned = _re.sub(r"^(?:[-*o]|\d+\.)\s*", "", line).strip()
        if cleaned:
            tasks.append({"id": f"prompt-{i}", "text": cleaned})
    return tasks


def _attach_thinking_trace(
    conversation: Dict[str, Any],
    events: List[Dict[str, Any]],
) -> None:
    if not events:
        return
    last_assistant_node = None
    for node in reversed(conversation.setdefault("nodes", [])):
        if node.get("role") == "assistant":
            last_assistant_node = node
            break
    if last_assistant_node is None:
        last_assistant_node = {
            "node_id": f"node_{uuid.uuid4().hex[:8]}",
            "role": "assistant",
            "status": "completed",
            "created_at": datetime.now().isoformat(),
            "contents": [],
        }
        conversation["nodes"].append(last_assistant_node)

    contents = last_assistant_node.setdefault("contents", [])
    contents[:] = [content for content in contents if content.get("type") != "thinking_trace"]
    contents.append({"type": "thinking_trace", "data": {"events": events}})

logger.info(
    "Config AWS credentials present: %s",
    "yes" if getattr(config, "aws", None) else "no",
)


def _parse_s3_key(s3_key: str) -> Optional[dict]:
    """Parse S3 key to extract user/project/asset metadata."""
    if s3_key is None:
        return None
    clean_key = s3_key.lstrip("/")
    parts = clean_key.split("/")
    if not parts:
        raise ValueError(f"Invalid S3 key format: {s3_key}")
    if parts[0] == "v1":
        parts = parts[1:]
    if len(parts) < 7:
        raise ValueError(f"Invalid S3 key format: {s3_key}")
    if parts[0] != "users" or parts[2] != "projects" or parts[4] != "assets":
        raise ValueError(f"Unexpected S3 key structure: {s3_key}")

    user_id = parts[1]
    project_id = parts[3]
    asset_id = parts[5]
    filename = "/".join(parts[6:])

    if "." in filename:
        file_id, extension = filename.rsplit(".", 1)
    else:
        file_id = filename
        extension = ""

    return {
        "user_id": user_id,
        "project_id": project_id,
        "asset_id": asset_id,
        "file_id": file_id,
        "extension": extension,
    }


def _fetch_asset_from_backend(asset_id: str) -> Optional[Dict[str, Any]]:
    """Fetch asset information from backend API using asset_id."""
    try:
        headers = {"X-Morpheus-Key": MORPHEUS_API_KEY}
        response = requests.get(
            f"{BACKEND_API_URL}/api/v1/morpheus/asset/{asset_id}",
            headers=headers,
            timeout=10,
        )
        if response.status_code == 200:
            asset_data = response.json()
            logger.info(f"Successfully fetched asset {asset_id} from backend API")
            return asset_data
        else:
            logger.warning(
                f"Failed to fetch asset {asset_id}: HTTP {response.status_code}"
            )
            return None
    except Exception as e:
        logger.error(f"Error fetching asset {asset_id} from backend: {e}")
        return None


def _build_processed_json_key(
    user_id: str, project_id: str, asset_id: str, file_id: str
) -> str:
    """Build S3 key for processed JSON file."""
    return f"users/{user_id}/projects/{project_id}/assets/{asset_id}/processed/{file_id}.json"


def _upload_bytes_to_s3(
    bucket: str, key: str, data: bytes, content_type: str = "application/json"
):
    """Upload bytes to S3."""
    s3_client = get_s3_client()
    s3_client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError(f"Invalid S3 URI: {uri}")
    without_scheme = uri[len("s3://") :]
    if "/" not in without_scheme:
        raise ValueError(f"Invalid S3 URI: {uri}")
    bucket, key = without_scheme.split("/", 1)
    return bucket, key.lstrip("/")


def _load_json_from_s3_uri(
    uri: str, max_retries: int = 3, initial_delay: float = 1.0
) -> Dict[str, Any]:
    """
    Load JSON from S3 URI with retry logic for handling eventual consistency.

    Args:
        uri: S3 URI to load from
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay in seconds (doubles with each retry)

    Returns:
        Parsed JSON data as dictionary

    Raises:
        FileNotFoundError: If the object doesn't exist after all retries
    """
    bucket, key = _parse_s3_uri(uri)
    delay = initial_delay

    for attempt in range(max_retries + 1):
        try:
            payload = download_bytes(bucket, key)
            return json.loads(payload.decode("utf-8"))
        except FileNotFoundError:
            if attempt < max_retries:
                logger.warning(
                    f"Conversation not found at {uri}, retrying in {delay}s (attempt {attempt + 1}/{max_retries})"
                )
                time.sleep(delay)
                delay *= 2  # Exponential backoff
            else:
                logger.error(
                    f"Conversation not found at {uri} after {max_retries + 1} attempts"
                )
                raise


def _upload_json_to_s3_uri(uri: str, data: Dict[str, Any]):
    bucket, key = _parse_s3_uri(uri)
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    _upload_bytes_to_s3(bucket, key, body)


def _persist_conversation(
    primary_uri: str, backup_uri: Optional[str], payload: Dict[str, Any]
):
    _upload_json_to_s3_uri(primary_uri, payload)
    if backup_uri:
        try:
            _upload_json_to_s3_uri(backup_uri, payload)
        except Exception as exc:
            logger.warning(f"Failed to update conversation backup: {exc}")


def _load_existing_dashboards(conversation: Dict[str, Any]) -> Dict[str, Any]:
    dashboards: Dict[str, Any] = {}
    for entry in conversation.get("dashboards", []):
        dash_id = entry.get("dashboard_id")
        uri = entry.get("s3_uri")
        if not dash_id or not uri:
            continue
        try:
            dashboards[dash_id] = _load_json_from_s3_uri(uri)
        except Exception as exc:
            logger.warning(f"Failed to load dashboard {dash_id}: {exc}")
    return dashboards


def _build_dashboard_key(user_id: str, project_id: str, dashboard_id: str) -> str:
    return f"users/{user_id}/projects/{project_id}/dashboards/{dashboard_id}.json"


def _save_dashboard_artifact(
    bucket: str,
    conversation: Dict[str, Any],
    dashboard_data: Dict[str, Any],
) -> Dict[str, Any]:
    user_id = conversation.get("user_id")
    project_id = conversation.get("project_id")
    conversation_id = conversation.get("conversation_id")
    if not user_id or not project_id or not conversation_id:
        raise ValueError(
            "Conversation missing identifiers required for dashboard persistence"
        )
    dashboard_id = str(uuid.uuid4())
    key = _build_dashboard_key(user_id, project_id, dashboard_id)
    payload = json.dumps(dashboard_data, ensure_ascii=False, indent=2).encode("utf-8")
    _upload_bytes_to_s3(bucket, key, payload)
    save_dashboard_metadata(
        user_id=user_id,
        project_id=project_id,
        conversation_id=conversation_id,
        dashboard_id=dashboard_id,
        s3_bucket=bucket,
        s3_key=key,
    )
    return {
        "dashboard_id": dashboard_id,
        "s3_bucket": bucket,
        "s3_key": key,
        "s3_uri": f"s3://{bucket}/{key}",
    }


async def _post_node_status(
    conversation_id: Optional[str], status: str, metadata: Optional[dict] = None
):
    if not conversation_id:
        return
    try:
        logger.info(
            f"Posting node status: {conversation_id}, {status}, {metadata} to {BACKEND_API_URL}/api/v1/morpheus/workflow-status"
        )
        timeout = aiohttp.ClientTimeout(total=100)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{BACKEND_API_URL}/api/v1/morpheus/workflow-status",
                headers={"X-Morpheus-Key": MORPHEUS_API_KEY},
                json={
                    "conversation_id": conversation_id,
                    "node_id": "workflow",
                    "status": status,
                    "metadata": metadata or {},
                },
            ) as response:
                if response.status != 200:
                    response_text = await response.text()
                    logger.error(
                        f"Failed to update node status: HTTP {response.status} - {response_text[:200]} "
                        f"(conversation_id={conversation_id}, status={status})"
                    )
                    raise Exception(
                        f"Failed to update node status: HTTP {response.status} - {response_text[:200]} "
                        f"(conversation_id={conversation_id}, status={status})"
                    )
                return await response.json()
    except asyncio.TimeoutError:
        logger.warning(
            f"Timeout updating node status for conversation {conversation_id}"
        )
        return None
    except aiohttp.ClientError as e:
        logger.warning(f"Failed to update node status: {e}")
        return None
    except Exception as e:
        logger.warning(f"Failed to update node status: {e}")
        return None


def _post_node_status_sync(
    conversation_id: Optional[str], status: str, metadata: Optional[dict] = None
):
    """Synchronous wrapper for _post_node_status to use in background tasks."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(_post_node_status(conversation_id, status, metadata))


def _post_workflow_event_sync(
    conversation_id: Optional[str],
    run_id: str,
    sequence: int,
    event: Dict[str, Any],
):
    if not conversation_id:
        return None
    try:
        response = requests.post(
            f"{BACKEND_API_URL}/api/v1/morpheus/workflow-event",
            headers={"X-Morpheus-Key": MORPHEUS_API_KEY},
            json={
                "conversation_id": conversation_id,
                "run_id": run_id,
                "sequence": sequence,
                "event": event,
            },
            timeout=10,
        )
        if response.status_code != 200:
            logger.warning(
                "Failed to append workflow event: HTTP %s - %s",
                response.status_code,
                response.text[:200],
            )
            return None
        return response.json()
    except Exception as exc:
        logger.warning("Failed to append workflow event: %s", exc)
        return None


async def _get_workflow_status(conversation_id: str, project_id: str) -> Optional[str]:
    """Get the current workflow status from the backend."""
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(
                f"{BACKEND_API_URL}/api/v1/morpheus/workflow-status/{conversation_id}",
                params={"project_id": project_id},
                headers={"X-Morpheus-Key": MORPHEUS_API_KEY},
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(
                        f"Workflow status response for {conversation_id}: {json.dumps(data, default=str)[:500]}"
                    )
                    nodes = data.get("nodes", [])
                    for node in nodes:
                        if node.get("node_id") == "workflow":
                            return node.get("status")
                    # Fallback: check top-level status field
                    if data.get("status"):
                        return data.get("status")
                else:
                    logger.debug(
                        f"Workflow status returned HTTP {response.status} for {conversation_id}"
                    )
                return None
    except Exception as e:
        logger.debug(f"Could not get workflow status: {e}")
        return None


async def _wait_for_workflow_completion(
    conversation_id: str,
    project_id: str,
    timeout: float = 60.0,
    poll_interval: float = 1.0,
) -> bool:
    """
    Wait for any running workflow to fully stop before starting a new one.
    Returns True if no workflow is running (or it stopped within timeout), False on timeout.
    """
    status = await _get_workflow_status(conversation_id, project_id)
    logger.info(f"Initial workflow status for {conversation_id}: {status}")
    if status != "processing":
        return True

    logger.info(
        f"Previous workflow still running for {conversation_id}, waiting for it to stop..."
    )
    elapsed = 0.0
    while elapsed < timeout:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        status = await _get_workflow_status(conversation_id, project_id)
        if status != "processing":
            logger.info(
                f"Previous workflow stopped for {conversation_id} after {elapsed:.1f}s"
            )
            return True

    logger.warning(
        f"Previous workflow did not stop within {timeout}s for {conversation_id}"
    )
    return False


async def _clear_stop_signal(conversation_id: str):
    """Clear any stale stop_signal from a previous run."""
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{BACKEND_API_URL}/api/v1/morpheus/workflow-status",
                headers={"X-Morpheus-Key": MORPHEUS_API_KEY},
                json={
                    "conversation_id": conversation_id,
                    "node_id": "stop_signal",
                    "status": "cleared",
                    "metadata": {},
                },
            ) as response:
                if response.status != 200:
                    logger.warning(
                        f"Failed to clear stop signal: HTTP {response.status}"
                    )
    except Exception:
        pass


def _wait_for_workflow_completion_sync(
    conversation_id: str,
    project_id: str,
    timeout: float = 60.0,
    poll_interval: float = 1.0,
) -> bool:
    """Synchronous wrapper for _wait_for_workflow_completion to use in background tasks."""
    try:
        loop = asyncio.new_event_loop()
        return loop.run_until_complete(
            _wait_for_workflow_completion(
                conversation_id, project_id, timeout, poll_interval
            )
        )
    except Exception as e:
        logger.warning(f"Error in _wait_for_workflow_completion_sync: {e}")
        return True
    finally:
        loop.close()


def _clear_stop_signal_sync(conversation_id: str):
    """Synchronous wrapper for _clear_stop_signal to use in background tasks."""
    try:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(_clear_stop_signal(conversation_id))
    except Exception as e:
        logger.warning(f"Error in _clear_stop_signal_sync: {e}")
    finally:
        loop.close()


def _extract_assets_from_nodes(conversation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract asset content items from conversation nodes.

    Respects user_node_metadata.asset_selection to filter assets:
    - 'none' or no metadata: Return no assets
    - 'explicit' with selected_asset_ids: Only return those specific assets
    - 'all': Return all assets in conversation
    """
    nodes = conversation.get("nodes", [])

    # Find latest user node to check for selection metadata
    latest_user_node = None
    for node in reversed(nodes):
        if node.get("role") == "user":
            latest_user_node = node
            break

    # Check metadata for selection mode
    metadata = latest_user_node.get("metadata", {}) if latest_user_node else {}
    selection_mode = metadata.get("asset_selection", "none")
    selected_ids = set(metadata.get("selected_asset_ids", []))

    logger.info(f"Asset selection mode: {selection_mode}, selected_ids: {selected_ids}")

    if selection_mode == "none":
        logger.info("Asset selection is none; no conversation assets will be downloaded")
        return []

    # Extract all assets from conversation
    assets = []
    for node in nodes:
        contents = node.get("contents", [])
        for content in contents:
            content_type = content.get("type")
            if content_type in ["asset", "attachment"]:
                asset_data = content.get("data", {})
                # Ensure we have required fields
                if (
                    asset_data.get("asset_id")
                    and asset_data.get("s3_bucket")
                    and asset_data.get("s3_key")
                ):
                    assets.append(
                        {
                            "asset_id": asset_data.get("asset_id"),
                            "file_id": asset_data.get("file_id"),
                            "s3_bucket": asset_data.get("s3_bucket"),
                            "s3_key": asset_data.get("s3_key"),
                            "extension": asset_data.get("extension", "csv"),
                            "filename": asset_data.get("filename", ""),
                        }
                    )

    # Filter based on selection mode
    if selection_mode == "explicit" and selected_ids:
        filtered_assets = [a for a in assets if a.get("asset_id") in selected_ids]
        logger.info(
            f"Filtered assets from {len(assets)} to {len(filtered_assets)} based on explicit selection"
        )
        return filtered_assets

    if selection_mode == "all":
        return assets

    return []


DATA_CONTEXT_PROMPT_RE = _re.compile(
    r"\b("
    r"trend|chart|graph|plot|visuali[sz]e|dashboard|report|metric|metrics|"
    r"sessions?|users?|visitors?|traffic|revenue|sales|orders?|spend|clicks?|"
    r"impressions?|ctr|cpc|roas|conversion|conversions?|compare|ranking|top|bottom"
    r")\b",
    _re.IGNORECASE,
)


def _latest_user_node(conversation: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for node in reversed(conversation.get("nodes", [])):
        if node.get("role") == "user":
            return node
    return None


def _latest_user_prompt(conversation: Dict[str, Any]) -> Optional[str]:
    latest_user = _latest_user_node(conversation)
    if not latest_user:
        return None
    for content in latest_user.get("contents", []):
        if content.get("type") == "text":
            text = (content.get("data") or {}).get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
    return None


def _latest_user_has_clarification_response(conversation: Dict[str, Any]) -> bool:
    latest_user = _latest_user_node(conversation)
    if not latest_user:
        return False
    return any(
        content.get("type") == "clarification_response"
        for content in latest_user.get("contents", [])
    )


def _is_data_context_needed(user_prompt: Optional[str]) -> bool:
    return bool(user_prompt and DATA_CONTEXT_PROMPT_RE.search(user_prompt))


def _asset_label(asset: Dict[str, Any]) -> str:
    filename = str(asset.get("filename") or "Data source").strip()
    source = str(asset.get("asset_type") or "").replace("integration_", "").replace("_", " ").strip()
    return source.title() if source else filename


def _rank_project_assets_for_prompt(
    project_assets: List[Dict[str, Any]], user_prompt: Optional[str]
) -> List[Dict[str, Any]]:
    prompt = (user_prompt or "").lower()

    def score(asset: Dict[str, Any]) -> int:
        raw = " ".join(
            str(asset.get(key) or "").lower()
            for key in ("filename", "asset_type", "extension")
        )
        total = 0
        if any(term in prompt for term in ("visitor", "traffic", "session", "user", "ga4", "analytics")):
            total += 5 if any(term in raw for term in ("ga4", "analytics", "visitor", "traffic")) else 0
        if any(term in prompt for term in ("ad", "campaign", "spend", "click", "impression")):
            total += 5 if "ads" in raw or "campaign" in raw else 0
        if any(term in prompt for term in ("revenue", "sales", "order", "payment")):
            total += 5 if any(term in raw for term in ("stripe", "shopify", "sales", "revenue")) else 0
        total += 1 if asset.get("row_count") not in (None, 0, "0") else 0
        return total

    return sorted(project_assets, key=score, reverse=True)


def _build_data_context_clarification(
    user_prompt: Optional[str],
    project_assets: List[Dict[str, Any]],
) -> Dict[str, Any]:
    ranked_assets = _rank_project_assets_for_prompt(project_assets, user_prompt)
    options: List[Dict[str, Any]] = []
    for asset in ranked_assets[:6]:
        asset_id = str(asset.get("asset_id") or "").strip()
        if not asset_id:
            continue
        row_count = asset.get("row_count")
        column_count = asset.get("column_count")
        shape = ""
        if row_count is not None and column_count is not None:
            shape = f" ({row_count} rows, {column_count} columns)"
        options.append(
            {
                "id": f"asset:{asset_id}",
                "label": _asset_label(asset),
                "description": f"{asset.get('filename') or 'Project data'}{shape}",
                "recommended": len(options) == 0,
                "metadata": {
                    "asset_ids": [asset_id],
                    "asset_selection": "explicit",
                    "asset": asset,
                },
            }
        )

    all_asset_ids = [
        str(asset.get("asset_id"))
        for asset in ranked_assets
        if str(asset.get("asset_id") or "").strip()
    ]
    if len(all_asset_ids) > 1:
        options.append(
            {
                "id": "all_project_data",
                "label": "Use all project data",
                "description": "Broader context, slower and less precise if sources are unrelated",
                "metadata": {
                    "asset_ids": all_asset_ids,
                    "asset_selection": "all",
                },
            }
        )

    options.append(
        {
            "id": "answer_without_data",
            "label": "Answer without data",
            "description": "Explain what data is needed instead of analyzing",
            "metadata": {"asset_selection": "none"},
        }
    )

    return {
        "clarification_id": str(uuid.uuid4()),
        "reason_code": "missing_data_context",
        "question": "Choose the data context",
        "options": options,
        "allow_free_text": True,
        "required": True,
    }


def _append_clarification_request_node(
    conversation: Dict[str, Any], clarification: Dict[str, Any]
) -> None:
    text = "I need one choice before I analyze. No data source was selected, so I will not guess."
    conversation.setdefault("nodes", []).append(
        {
            "node_id": f"node_{uuid.uuid4().hex[:8]}",
            "role": "assistant",
            "status": "awaiting_user_input",
            "created_at": datetime.now().isoformat(),
            "contents": [
                {"type": "text", "data": {"text": text}},
                {"type": "clarification_request", "data": clarification},
            ],
        }
    )
    conversation["updated_at"] = datetime.now().isoformat()


def _postprocess_workflow_to_conversation_nodes(
    workflow_output,
) -> List[Dict[str, Any]]:
    """Convert all workflow_output.messages into conversation nodes."""
    from morpheus.workflows.base import WorkflowMessage

    if not workflow_output or not hasattr(workflow_output, "messages"):
        return []

    nodes = []
    for msg in workflow_output.messages:
        # Handle WorkflowMessage objects
        if isinstance(msg, dict):
            msg_type = msg.get("type", "unknown")
            msg_content = msg.get("content", "")
            msg_timestamp = msg.get("timestamp", datetime.now())
            msg_tool_calls = msg.get("tool_calls")
            msg_tool_call_id = msg.get("tool_call_id")
        else:
            # Pydantic model access
            msg_type = getattr(msg, "type", "unknown")
            msg_content = getattr(msg, "content", "")
            msg_timestamp = getattr(msg, "timestamp", datetime.now())
            msg_tool_calls = getattr(msg, "tool_calls", None)
            msg_tool_call_id = getattr(msg, "tool_call_id", None)

        # Map message types to conversation roles
        role_map = {
            "human": "user",
            "ai": "assistant",
            "system": "system",
            "tool": "tool",
        }
        role = role_map.get(msg_type, "system")

        # If AIMessage has tool_calls, treat it as 'tool' role (tool invocation)
        if msg_type == "ai" and msg_tool_calls:
            role = "tool"

        # Get timestamp as ISO string
        if isinstance(msg_timestamp, str):
            timestamp_iso = msg_timestamp
        elif hasattr(msg_timestamp, "isoformat"):
            timestamp_iso = msg_timestamp.isoformat()
        else:
            timestamp_iso = datetime.now().isoformat()

        # Build node
        node = {
            "node_id": f"node_{uuid.uuid4().hex[:8]}",
            "role": role,
            "status": "completed",
            "created_at": timestamp_iso,
            "contents": [
                {
                    "type": "text",
                    "data": {
                        "text": str(msg_content),
                    },
                }
            ],
        }

        # Add metadata for tool calls if present
        metadata = {}
        if msg_tool_calls:
            metadata["tool_calls"] = msg_tool_calls
        if msg_tool_call_id:
            metadata["tool_call_id"] = msg_tool_call_id

        # Extract token usage if present
        msg_usage = getattr(msg, "usage_metadata", None)
        if hasattr(msg, "get") and msg_usage is None:
            msg_usage = msg.get("usage_metadata")
            
        if msg_usage:
            metadata["usage"] = msg_usage

        if metadata:
            node["metadata"] = metadata

        nodes.append(node)

    return nodes


def _process_conversation_background(
    conversation_id: str,
    conversation_uri: str,
    conversation_backup_uri: Optional[str],
    project_id: str,
    user_id: str,
    wait_for_previous: bool = False,
    model_override: Optional[str] = None,
    theme_id: Optional[str] = None,
    analysis_focus_id: Optional[str] = None,
    template_id: Optional[str] = None,
    project_assets: Optional[List[Dict[str, Any]]] = None,
):
    """Background processing function for workflow execution."""
    temp_file_path = None
    processed_json_s3_key = None
    conversation: Optional[Dict[str, Any]] = None
    conversation_bucket: Optional[str] = None
    collected_steps: List[Dict[str, str]] = []
    thinking_tracer = ThinkingTracer(conversation_id)

    def _collecting_post_status(conv_id, status, metadata=None):
        """Wrapper that collects meaningful workflow steps for todo_tasks persistence."""
        thinking_tracer.emit_status(metadata, status)
        if metadata and isinstance(metadata, dict):
            step = metadata.get("step")
            if step and step in SAVEABLE_WORKFLOW_STEPS and step not in {s["id"] for s in collected_steps}:
                display_text = metadata.get("log") or STEP_FRIENDLY_MAP.get(step, "Processing...")
                collected_steps.append({"id": step, "text": display_text})
        return _post_node_status_sync(conv_id, status, metadata)

    try:
        logger.info(f"Starting workflow for conversation {conversation_id}")

        if wait_for_previous:
            # Wait for any running workflow to fully stop before starting a new one
            workflow_stopped = _wait_for_workflow_completion_sync(
                conversation_id, project_id
            )
            if not workflow_stopped:
                logger.warning(
                    f"Previous workflow did not stop within timeout for {conversation_id}, proceeding anyway"
                )

            # Clear stale stop signal AFTER previous workflow has stopped
            _clear_stop_signal_sync(conversation_id)

            # Post the initial status now that the previous workflow is done
            _collecting_post_status(
                conversation_id,
                "processing",
                {
                    "step": "initialized",
                    "message": "Workflow queued for processing",
                },
            )

        _collecting_post_status(
            conversation_id, "processing", {"step": "load_conversation"}
        )

        try:
            conversation = _load_json_from_s3_uri(conversation_uri)
        except FileNotFoundError as e:
            error_msg = f"Conversation not found in S3: {conversation_uri}. The conversation may not have been saved yet or there was an S3 consistency delay."
            logger.error(error_msg)
            _collecting_post_status(
                conversation_id,
                "error",
                {
                    "step": "load_conversation",
                    "error": error_msg,
                    "conversation_uri": conversation_uri,
                },
            )
            return

        conversation_bucket, _ = _parse_s3_uri(conversation_uri)
        dashboards_cache = _load_existing_dashboards(conversation)
        user_prompt = _latest_user_prompt(conversation)

        # Extract all assets from conversation nodes
        assets = _extract_assets_from_nodes(conversation)
        logger.info(f"Found {len(assets)} asset(s) in conversation {conversation_id}")

        if (
            not assets
            and _is_data_context_needed(user_prompt)
            and not _latest_user_has_clarification_response(conversation)
        ):
            clarification = _build_data_context_clarification(
                user_prompt, project_assets or []
            )
            _append_clarification_request_node(conversation, clarification)
            thinking_tracer.emit(
                "final",
                "Need data context",
                "Paused for the user to choose which project data source to analyze.",
            )
            _attach_thinking_trace(conversation, thinking_tracer.snapshot(finalize=True))
            _persist_conversation(
                conversation_uri, conversation_backup_uri, conversation
            )
            _post_node_status_sync(
                conversation_id,
                "awaiting_user_input",
                {
                    "step": "clarification",
                    "response_type": "clarification_request",
                    "clarification_id": clarification["clarification_id"],
                    "reason_code": clarification["reason_code"],
                },
            )
            return

        # Handle file download - download all assets, or skip entirely for Q&A
        temp_file_paths = []
        if not assets:
            logger.info(
                f"No assets in conversation {conversation_id} - processing as pure Q&A (no file)"
            )
            # For Q&A with no data files, pass empty file_paths so the workflow
            # routes to Q&A mode immediately without trying to open any file.
        else:
            _collecting_post_status(
                conversation_id, "processing", {"step": "download_asset"}
            )
            for idx, asset_info in enumerate(assets):
                asset_bucket = asset_info.get("s3_bucket")
                asset_key = asset_info.get("s3_key")

                if not asset_bucket or not asset_key:
                    logger.warning(
                        f"Asset {asset_info.get('asset_id')} missing s3_bucket or s3_key, skipping"
                    )
                    continue

                logger.info(
                    f"Downloading asset {idx + 1}/{len(assets)} for conversation {conversation_id}: s3://{asset_bucket}/{asset_key}"
                )
                try:
                    file_content = download_bytes(asset_bucket, asset_key)
                    logger.info(
                        f"Successfully downloaded {len(file_content)} bytes from S3"
                    )

                    # Safely get extension with proper None handling
                    extension = asset_info.get("extension", "csv")
                    if extension and isinstance(extension, str):
                        file_ext = extension.lstrip(".")
                    else:
                        file_ext = "csv"

                    file_identifier = (
                        asset_info.get("file_id")
                        or asset_info.get("asset_id")
                        or f"{conversation_id}_{idx}"
                    )
                    temp_dir = tempfile.gettempdir()
                    temp_file_path = os.path.join(
                        temp_dir, f"{file_identifier}.{file_ext}"
                    )
                    with open(temp_file_path, "wb") as handle:
                        handle.write(file_content)
                    temp_file_paths.append(temp_file_path)
                    logger.info(
                        f"Saved file to {temp_file_path} ({os.path.getsize(temp_file_path)} bytes)"
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to download asset {asset_info.get('asset_id')}: {e}"
                    )
                    _collecting_post_status(
                        conversation_id,
                        "error",
                        {
                            "step": "download_asset",
                            "error": f"Failed to download file: {str(e)}",
                            "asset_id": asset_info.get("asset_id"),
                        },
                    )
                    # Continue with other assets instead of returning
                    continue

            if not temp_file_paths:
                logger.error("No assets were successfully downloaded")
                _collecting_post_status(
                    conversation_id,
                    "error",
                    {
                        "step": "download_asset",
                        "error": "Failed to download any assets",
                    },
                )
                return

        # Store primary_asset for later use in error handling and completion
        primary_asset = assets[0] if assets else None

        effective_theme_id = _effective_theme_id(theme_id, template_id)
        workflow = StatefulAnalyzeCSVWorkflow(
            model_override=model_override,
            theme_id=effective_theme_id,
            analysis_focus_id=analysis_focus_id,
            template_id=template_id,
        )
        _collecting_post_status(conversation_id, "processing", {"step": "run_workflow"})

        # Extract user prompt and chart_mention context from latest user node
        chart_mentions = []
        nodes = conversation.get("nodes", [])
        for node in reversed(nodes):
            if node.get("role") == "user":
                contents = node.get("contents", [])
                for content in contents:
                    if content.get("type") == "text":
                        if not user_prompt:
                            user_prompt = content.get("data", {}).get("text")
                    elif content.get("type") == "chart_mention":
                        chart_mentions.append(content.get("data", {}))
                break  # only from latest user node

        if chart_mentions:
            logger.info(
                f"Found {len(chart_mentions)} chart mention(s) for modification: {[cm.get('title') for cm in chart_mentions]}"
            )

        result = workflow.execute(
            file_paths=temp_file_paths,  # Pass all file paths for multi-file analysis
            conversation=conversation,
            dashboards=dashboards_cache,
            user_prompt=user_prompt,
            chart_mentions=chart_mentions,  # Pass chart modification context
            conversation_uri=conversation_uri,
            conversation_backup_uri=conversation_backup_uri,
            post_status_fn=_collecting_post_status,
            thinking_event_fn=thinking_tracer.emit,
            assets=assets,
        )

        # Validate result is not None
        if result is None:
            error_msg = "Workflow returned None result"
            logger.error(error_msg)
            thinking_tracer.emit(
                "error",
                "Workflow stopped on an issue",
                "The workflow ended without a usable result.",
                detail=error_msg,
                status="error",
            )
            _attach_thinking_trace(conversation, thinking_tracer.snapshot(finalize=True))
            _persist_conversation(conversation_uri, conversation_backup_uri, conversation)
            _collecting_post_status(
                conversation_id,
                "error",
                {"step": "error", "error": error_msg},
            )
            return

        # Check response type to route handling
        response_type = result.get(
            "type", "dashboard_config"
        )  # Default to dashboard for backward compatibility

        # Postprocess workflow messages into conversation nodes
        workflow_output = result.get("workflow_output")
        if workflow_output:
            postprocessed_nodes = _postprocess_workflow_to_conversation_nodes(
                workflow_output
            )
            conversation.setdefault("nodes", []).extend(postprocessed_nodes)

            # Calculate total tokens from workflow_output and update backend metadata
            total_tokens = 0
            if hasattr(workflow_output, "messages"):
                for msg in workflow_output.messages:
                    msg_usage = getattr(msg, "usage_metadata", None)
                    if hasattr(msg, "get") and msg_usage is None:
                        msg_usage = msg.get("usage_metadata")
                    if msg_usage and isinstance(msg_usage, dict):
                        total_tokens += msg_usage.get("total_tokens", 0)

            if total_tokens > 0:
                try:
                    tokens_url = f"{BACKEND_API_URL}/api/v1/morpheus/project/{project_id}/conversation/{conversation_id}/tokens"
                    headers = {"X-Morpheus-Key": MORPHEUS_API_KEY}
                    requests.put(tokens_url, json={"total_tokens": total_tokens}, headers=headers, timeout=5)
                    logger.info(f"Updated total tokens for conversation {conversation_id}: {total_tokens}")
                except Exception as exc:
                    logger.warning(f"Failed to update total tokens: {exc}")

        # Handle chart modification responses — merge modified chart into existing dashboard
        if response_type == "chart_modification":
            logger.info(
                "Processing chart modification response — merging into existing dashboard"
            )
            chart_mod_context = result.get("chart_modification_context", {})
            target_chart_id = chart_mod_context.get("chart_id")
            modified_data = result.get("data", {})

            # Load the existing dashboard to merge into
            existing_dashboard = None
            for _dash_id, dash_data in dashboards_cache.items():
                existing_dashboard = dash_data
                # Use the last one (most recent)

            if existing_dashboard and modified_data:
                import copy

                merged = copy.deepcopy(existing_dashboard)

                # Replace the target chart
                modified_charts = modified_data.get("charts", [])
                if modified_charts:
                    existing_charts = merged.get("charts", [])
                    replaced = False
                    for i, chart in enumerate(existing_charts):
                        if chart.get("id") == target_chart_id:
                            existing_charts[i] = modified_charts[0]
                            replaced = True
                            logger.info(f"Merged: replaced chart '{target_chart_id}'")
                            break
                    if not replaced:
                        existing_charts.append(modified_charts[0])
                        logger.info(
                            f"Merged: appended chart (target '{target_chart_id}' not found)"
                        )
                    merged["charts"] = existing_charts

                # Replace metrics/tables if LLM converted types
                for key in ("metrics", "tables"):
                    new_items = modified_data.get(key, [])
                    if new_items:
                        existing_items = merged.get(key, [])
                        for new_item in new_items:
                            found = False
                            for j, item in enumerate(existing_items):
                                if item.get("id") == new_item.get("id"):
                                    existing_items[j] = new_item
                                    found = True
                                    break
                            if not found:
                                existing_items.append(new_item)
                        merged[key] = existing_items

                # Use merged dashboard as the result data going forward
                result["data"] = merged
                result["type"] = "dashboard_config"
                response_type = "dashboard_config"
                logger.info(
                    "Chart modification merged successfully into existing dashboard"
                )
            else:
                # No existing dashboard — treat the chart-only output as a regular dashboard
                logger.warning(
                    "No existing dashboard for merge, using chart-only output as dashboard"
                )
                result["type"] = "dashboard_config"
                response_type = "dashboard_config"

        # Handle QA visual responses (text + inline chart/table artifacts, no dashboard artifact)
        if response_type == "answer_with_visual":
            logger.info("Processing QA visual response - skipping dashboard generation")

            qa_content = result.get("content", "I've processed your question.")
            artifacts = result.get("artifacts", []) or []

            visual_node = {
                "node_id": f"node_{uuid.uuid4().hex[:8]}",
                "role": "assistant",
                "status": "completed",
                "created_at": datetime.now().isoformat(),
                "contents": [
                    {
                        "type": "text",
                        "data": {"text": qa_content},
                    },
                    {
                        "type": "visual_artifacts",
                        "data": {"artifacts": artifacts},
                    },
                ],
            }
            conversation.setdefault("nodes", []).append(visual_node)
            conversation["updated_at"] = datetime.now().isoformat()
            thinking_tracer.emit(
                "final",
                "Answer ready",
                f"Prepared the response with {len(artifacts)} inline visual artifact(s).",
            )
            _attach_thinking_trace(conversation, thinking_tracer.snapshot(finalize=True))
            _persist_conversation(
                conversation_uri, conversation_backup_uri, conversation
            )

            file_identifier = (
                assets[0].get("file_id") or assets[0].get("asset_id")
                if assets
                else conversation_id
            )
            _post_node_status_sync(
                conversation_id,
                "completed",
                {
                    "fileID": file_identifier,
                    "response_type": "answer_with_visual",
                    "content": qa_content,
                    "artifact_count": len(artifacts),
                },
            )

            logger.info(f"QA visual workflow completed for conversation {conversation_id}")
            return

        # Handle Q&A responses (type == "message")
        if response_type == "message":
            logger.info("Processing Q&A response - skipping dashboard generation")

            # Extract Q&A content from result
            qa_content = result.get("content", "I've processed your question.")

            # The workflow_output messages have already been added to conversation nodes above
            # But we should ensure the final assistant response is clear
            # The postprocessed_nodes should already contain the assistant's text response

            # Q&A responses don't generate dashboards, just save conversation with text response
            conversation["updated_at"] = datetime.now().isoformat()
            thinking_tracer.emit(
                "final",
                "Answer ready",
                "Prepared the response from the available project context.",
            )
            _attach_thinking_trace(conversation, thinking_tracer.snapshot(finalize=True))
            _persist_conversation(
                conversation_uri, conversation_backup_uri, conversation
            )

            # Post completion status with Q&A content in metadata
            file_identifier = (
                assets[0].get("file_id") or assets[0].get("asset_id")
                if assets
                else conversation_id
            )
            _post_node_status_sync(
                conversation_id,
                "completed",
                {
                    "fileID": file_identifier,
                    "response_type": "message",
                    "content": qa_content,
                },
            )

            logger.info(f"Q&A workflow completed for conversation {conversation_id}")
            return

        # Handle Dashboard responses (type == "dashboard_config")
        logger.info("Processing Dashboard response")

        # Use first asset for processed JSON key generation (for backward compatibility)
        primary_asset = assets[0] if assets else None
        file_size = (
            os.path.getsize(temp_file_path)
            if temp_file_path and os.path.exists(temp_file_path)
            else 0
        )
        processed_json_s3_key = None

        if primary_asset and primary_asset.get("s3_key"):
            asset_key = primary_asset.get("s3_key")
            key_parts = _parse_s3_key(asset_key)
            if key_parts:
                processed_json_s3_key = _build_processed_json_key(
                    user_id=key_parts["user_id"],
                    project_id=key_parts["project_id"],
                    asset_id=key_parts["asset_id"],
                    file_id=key_parts["file_id"],
                )
            else:
                logger.warning(f"Failed to parse asset_key: {asset_key}")
        else:
            logger.warning(f"No asset_key available for processed JSON key generation")

        result_data = result.get("data", {}) if result else {}
        if not isinstance(result_data, dict):
            result_data = {}
        effective_theme_id = _effective_theme_id(theme_id, template_id)
        _apply_theme_to_dashboard_data(result_data, effective_theme_id)
        if analysis_focus_id:
            result_data["analysis_focus_id"] = analysis_focus_id

        file_identifier = (
            primary_asset.get("file_id") or primary_asset.get("asset_id")
            if primary_asset
            else conversation_id
        )
        file_ext = (
            primary_asset.get("extension", "csv").lstrip(".")
            if primary_asset
            else "csv"
        )

        processed_data = {
            "fileID": file_identifier,
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "file_size": file_size,
            "file_type": file_ext,
            "data": result_data,
            "charts": result_data.get("charts", []),
            "metrics": result_data.get("metrics", []),
            "insights": result_data.get("insights", []),
        }

        if result.get("workflow_output"):
            output_dir = Path("storage/out")
            output_dir.mkdir(exist_ok=True, parents=True)
            workflow_output_file = (
                output_dir
                / f"workflow_{file_identifier}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            )
            result["workflow_output"].save_to_file(str(workflow_output_file))
            processed_data["workflow_output_path"] = str(workflow_output_file)

        processed_json_bytes = json.dumps(
            processed_data, ensure_ascii=False, indent=2
        ).encode("utf-8")
        if processed_json_s3_key and primary_asset:
            asset_bucket = primary_asset.get("s3_bucket")
            if asset_bucket:
                _upload_bytes_to_s3(
                    asset_bucket, processed_json_s3_key, processed_json_bytes
                )
            else:
                logger.warning(f"Skipping processed JSON upload: missing asset_bucket")
        else:
            logger.warning(
                f"Skipping processed JSON upload: processed_json_s3_key={processed_json_s3_key}, primary_asset={primary_asset is not None}"
            )

        asset_id = primary_asset.get("asset_id") if primary_asset else None
        if asset_id and processed_json_s3_key:
            try:
                update_url = (
                    f"{BACKEND_API_URL}/api/v1/morpheus/asset/{asset_id}/processed-key"
                )
                headers = {"X-Morpheus-Key": MORPHEUS_API_KEY}
                response = requests.put(
                    update_url,
                    json={"processed_json_s3_key": processed_json_s3_key},
                    headers=headers,
                    timeout=10,
                )
                if response.status_code != 200:
                    logger.warning(
                        f"Failed to update asset {asset_id}: {response.status_code} - {response.text}"
                    )
            except Exception as exc:
                logger.warning(f"Failed to update asset via API: {exc}")

        dashboard_title = None
        dashboard_description = None
        result_data = result.get("data")
        if result_data:
            dashboard_meta = (
                result_data.get("dashboard") if isinstance(result_data, dict) else {}
            )
            if isinstance(dashboard_meta, dict):
                dashboard_title = dashboard_meta.get("title")
                dashboard_description = dashboard_meta.get("description")

        new_dashboard_record = None
        result_data = result.get("data")
        if result_data and isinstance(result_data, dict) and conversation_bucket:
            effective_theme_id = _effective_theme_id(theme_id, template_id)
            _apply_theme_to_dashboard_data(result_data, effective_theme_id)
            if analysis_focus_id:
                result_data["analysis_focus_id"] = analysis_focus_id
            if template_id:
                result_data["template_id"] = template_id
            logger.info(
                f"Saving dashboard artifact for conversation {conversation_id}, data keys: {list(result_data.keys())}"
            )
            try:
                new_dashboard_record = _save_dashboard_artifact(
                    bucket=conversation_bucket,
                    conversation=conversation,
                    dashboard_data=result_data,
                )
                logger.info(
                    f"Successfully saved dashboard {new_dashboard_record.get('dashboard_id')} "
                    f"to s3://{new_dashboard_record.get('s3_bucket')}/{new_dashboard_record.get('s3_key')}"
                )
            except Exception as e:
                logger.error(f"Failed to save dashboard artifact: {e}", exc_info=True)
                raise
        else:
            logger.warning(
                f"Skipping dashboard save: result_data={result_data is not None}, "
                f"result_data_type={type(result_data).__name__ if result_data else None}, "
                f"conversation_bucket={conversation_bucket}"
            )

        # If we have a saved dashboard record, attach it to the conversation structure
        if new_dashboard_record:
            # Determine todo tasks to persist alongside the dashboard
            todo_tasks_to_save: List[Dict[str, str]] = []
            if user_prompt and user_prompt.strip().startswith("/run"):
                todo_tasks_to_save = _parse_run_tasks(user_prompt)
            elif collected_steps:
                todo_tasks_to_save = list(collected_steps)

            # Add todo_tasks + dashboard reference to the last assistant node (or create one)
            if conversation.get("nodes"):
                last_assistant_node = None
                for node in reversed(conversation["nodes"]):
                    if node.get("role") == "assistant":
                        last_assistant_node = node
                        break

                if last_assistant_node:
                    if todo_tasks_to_save:
                        last_assistant_node["contents"].append(
                            {
                                "type": "todo_tasks",
                                "data": {"tasks": todo_tasks_to_save},
                            }
                        )
                    last_assistant_node["contents"].append(
                        {
                            "type": "dashboard",
                            "data": {
                                "dashboard_id": new_dashboard_record["dashboard_id"],
                                "s3_uri": new_dashboard_record["s3_uri"],
                            },
                        }
                    )
                else:
                    # Create a new assistant node for dashboard if none exists
                    dashboard_node = {
                        "node_id": f"node_{uuid.uuid4().hex[:8]}",
                        "role": "assistant",
                        "status": "completed",
                        "created_at": datetime.now().isoformat(),
                        "contents": [
                            {
                                "type": "dashboard",
                                "data": {
                                    "dashboard_id": new_dashboard_record[
                                        "dashboard_id"
                                    ],
                                    "s3_uri": new_dashboard_record["s3_uri"],
                                },
                            }
                        ],
                    }
                    conversation.setdefault("nodes", []).append(dashboard_node)

            # Append to conversation-level dashboards list for backend /dashboard endpoint
            conversation.setdefault("dashboards", []).append(
                {
                    "dashboard_id": new_dashboard_record["dashboard_id"],
                    "s3_uri": new_dashboard_record["s3_uri"],
                    "created_at": datetime.now().isoformat(),
                    "title": dashboard_title,
                }
            )

        conversation["updated_at"] = datetime.now().isoformat()
        thinking_tracer.emit(
            "final",
            "Dashboard ready",
            "Saved the generated dashboard and prepared the response.",
        )
        _attach_thinking_trace(conversation, thinking_tracer.snapshot(finalize=True))
        _persist_conversation(conversation_uri, conversation_backup_uri, conversation)

        # Derive source_type from primary asset's asset_type
        _asset_type_to_source: dict = {
            "integration_ga4": "GA4",
            "integration_gsheets": "Google Sheets",
            "integration_meta_ads": "Meta Ads",
            "integration_tiktok_ads": "TikTok Ads",
            "integration_appsflyer": "AppsFlyer",
            "integration_stripe": "Stripe",
            "integration_google_ads": "Google Ads",
            "integration_firebase": "Firebase",
        }
        _raw_asset_type = primary_asset.get("asset_type", "") if primary_asset else ""
        dashboard_source_type = _asset_type_to_source.get(_raw_asset_type, "CSV")

        # Update project metadata in backend so UI can restore conversations/dashboards
        try:
            project_metadata_payload = {
                "user_id": user_id,
                "description": dashboard_description,
                "latest_conversation_id": conversation_id,
                "latest_dashboard_id": (
                    new_dashboard_record["dashboard_id"]
                    if new_dashboard_record
                    else None
                ),
                "dashboard_title": dashboard_title,
                "source_type": dashboard_source_type,
            }
            headers = {"X-Morpheus-Key": MORPHEUS_API_KEY}
            response = requests.put(
                f"{BACKEND_API_URL}/api/v1/morpheus/project/{project_id}/metadata",
                json=project_metadata_payload,
                headers=headers,
                timeout=10,
            )
            if response.status_code != 200:
                logger.warning(
                    "Failed to update project metadata for %s: %s %s",
                    project_id,
                    response.status_code,
                    response.text,
                )
        except Exception as exc:
            logger.warning("Project metadata update failed: %s", exc)

        completion_file_identifier = (
            primary_asset.get("file_id") or primary_asset.get("asset_id")
            if primary_asset
            else conversation_id
        )
        _post_node_status_sync(
            conversation_id,
            "completed",
            {
                "fileID": completion_file_identifier,
                "response_type": "dashboard_config",
                "dashboard_id": (
                    new_dashboard_record["dashboard_id"]
                    if new_dashboard_record
                    else None
                ),
            },
        )

        logger.info(f"Workflow completed for conversation {conversation_id}")

    except Exception as exc:
        logger.error(f"Workflow failed for conversation {conversation_id}: {exc}")
        import traceback

        logger.error(traceback.format_exc())
        if conversation is not None:
            # Add error node to conversation
            error_node = {
                "node_id": f"node_{uuid.uuid4().hex[:8]}",
                "role": "assistant",
                "status": "error",
                "created_at": datetime.now().isoformat(),
                "contents": [
                    {
                        "type": "text",
                        "data": {
                            "text": "Sorry, we encountered an error. Please try again."
                        },
                    }
                ],
            }
            conversation.setdefault("nodes", []).append(error_node)
            conversation["updated_at"] = datetime.now().isoformat()
            try:
                thinking_tracer.emit(
                    "error",
                    "Workflow stopped on an issue",
                    "The workflow hit an error before it could finish.",
                    detail=str(exc),
                    status="error",
                )
                _attach_thinking_trace(conversation, thinking_tracer.snapshot(finalize=True))
                _persist_conversation(
                    conversation_uri, conversation_backup_uri, conversation
                )
            except Exception as persist_error:
                logger.warning(
                    f"Failed to persist errored conversation: {persist_error}"
                )

        if processed_json_s3_key and conversation is not None and primary_asset:
            try:
                error_file_identifier = (
                    primary_asset.get("file_id")
                    or primary_asset.get("asset_id")
                    or conversation_id
                )
                error_payload = {
                    "fileID": error_file_identifier,
                    "status": "error",
                    "error": str(exc),
                    "processed_at": datetime.now().isoformat(),
                }
                error_asset_bucket = (
                    primary_asset.get("s3_bucket") or conversation_bucket
                )
                _upload_bytes_to_s3(
                    error_asset_bucket,
                    processed_json_s3_key,
                    json.dumps(error_payload, ensure_ascii=False, indent=2).encode(
                        "utf-8"
                    ),
                )
            except Exception as upload_error:
                logger.error(f"Failed to save error payload: {upload_error}")

        _post_node_status_sync(
            conversation_id,
            "error",
            {"error": "Sorry, we encountered an error. Please try again."},
        )

    finally:
        # Clean up all downloaded asset files
        if temp_file_paths:
            for temp_path in temp_file_paths:
                if temp_path and os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception as cleanup_error:
                        logger.warning(
                            f"Failed to clean up temporary file {temp_path}: {cleanup_error}"
                        )


@app.post("/run")
async def run_workflow(request: RunRequest, background_tasks: BackgroundTasks):
    """
    Start workflow processing for a conversation.
    """
    try:
        if not request.conversation_uri:
            raise HTTPException(status_code=400, detail="conversation_uri is required")

        logger.info(
            "Received run request conversation_id=%s project_id=%s",
            request.conversation_id,
            request.project_id,
        )

        # Check if previous workflow is running
        previous_status = await _get_workflow_status(
            request.conversation_id, request.project_id
        )
        is_previous_running = previous_status == "processing"

        if not is_previous_running:
            # Clear any stale stop signal if it's not running
            await _clear_stop_signal(request.conversation_id)

            # Create workflow status node immediately
            response = await _post_node_status(
                request.conversation_id,
                "processing",
                {
                    "step": "initialized",
                    "message": "Workflow queued for processing",
                },
            )
            if not response:
                return {
                    "success": False,
                    "data": {
                        "success": False,
                        "conversation_id": request.conversation_id,
                        "status": "error",
                        "message": "Failed to update node status",
                    },
                }
            logger.info(f"Node status updated successfully: {response}")
        else:
            logger.info(
                f"Previous workflow is still running for {request.conversation_id}, delegating wait to background task"
            )

        background_tasks.add_task(
            _process_conversation_background,
            request.conversation_id,
            request.conversation_uri,
            request.conversation_backup_uri,
            request.project_id,
            request.user_id,
            is_previous_running,
            request.model,
            request.theme_id,
            request.analysis_focus_id,
            request.template_id,
            request.project_assets,
        )

        return {
            "success": True,
            "data": {
                "success": True,
                "conversation_id": request.conversation_id,
                "status": "accepted",
                "message": "Workflow queued for background processing",
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Run endpoint failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/status")
async def get_workflow_status(request: StatusRequest):
    """
    Proxy to backend workflow status poller.
    """
    try:
        logger.info(
            "Received status request for conversation %s",
            request.conversation_id,
        )
        headers = {"X-Morpheus-Key": MORPHEUS_API_KEY}
        response = requests.get(
            f"{BACKEND_API_URL}/api/v1/morpheus/workflow-status/{request.conversation_id}",
            params={"project_id": request.project_id},
            headers=headers,
            timeout=10,
        )
        if response.status_code == 200:
            return response.json()
        raise HTTPException(status_code=response.status_code, detail=response.text)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Status proxy failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return await check_health()


@app.post("/api/v1/users/{user_id}/signals/log")
async def silence_lovable_signals(user_id: str, request: Request):
    """
    Silence automated signals from development tools (e.g., lovable-tagger).
    Returns 200 OK to prevent 404 log clutter in Morpheus.
    """
    # Simply consume the signal
    return {"status": "ok", "message": "Signal received"}
