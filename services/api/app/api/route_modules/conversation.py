"""
Conversation management endpoints.
"""

import os
import uuid
import time
import asyncio
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Any
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.dependencies.auth import require_user
from app.services.credit_service import CreditService
from app.services.event_bus import event_bus
from app.services import morpheus_client
from app.services import dashboard_version_service
from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import conversations as conversations_repo
from utils.dynamodb.repos import projects as projects_repo
from utils.dynamodb.repos import workflow_nodes as workflow_nodes_repo
from utils.s3.conversations import save_conversation, load_conversation
from utils.s3.paths import build_conversation_key
from utils.s3.client import download_bytes, upload_bytes
from app.utils.timestamp_utils import utc_now_iso

logger = logging.getLogger(__name__)

router = APIRouter(tags=["conversation"])

credit_service_instance = CreditService()

# Workflow statuses that mean Morpheus did no billable work. Kept generous
# (default: bill) so normal "started"/"running" responses still charge.
_NON_BILLABLE_WORKFLOW_STATUSES = {"failed", "error", "rejected"}


def _is_billable_workflow_result(workflow_status: Optional[Dict[str, Any]]) -> bool:
    """Return False only when Morpheus reported an outright failure."""
    if not isinstance(workflow_status, dict):
        return True
    status = str(workflow_status.get("status", "")).lower()
    return status not in _NON_BILLABLE_WORKFLOW_STATUSES


# Map frontend model aliases to actual Google Generative AI model IDs.
# Verify valid IDs at: https://ai.google.dev/gemini-api/docs/models
# Override via env vars without code changes: DREAMIFY_PRO_MODEL / DREAMIFY_FAST_MODEL
MODEL_ID_MAP = {
    "pro": os.environ.get("DREAMIFY_PRO_MODEL", "gpt-5.4-mini"),
    "fast": os.environ.get("DREAMIFY_FAST_MODEL", "deepseek-v4-flash"),
}

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

VALID_ANALYSIS_FOCUS_IDS = {
    "saas_growth",
    "ecommerce_sales",
    "finance_overview",
    "marketing_funnel",
    "ops_performance",
    "product_analytics",
    "hr_workforce",
    "executive_summary",
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


def _resolve_theme_id(
    theme_id: Optional[str], template_id: Optional[str] = None
) -> Optional[str]:
    resolved = theme_id or (
        LEGACY_TEMPLATE_THEME_MAP.get(template_id or "") if template_id else None
    )
    if resolved and resolved not in VALID_THEME_IDS:
        raise HTTPException(status_code=400, detail=f"Invalid theme_id: {resolved}")
    return resolved


def _resolve_analysis_focus_id(
    analysis_focus_id: Optional[str],
    template_id: Optional[str] = None,
) -> Optional[str]:
    resolved = analysis_focus_id
    if not resolved and template_id in VALID_ANALYSIS_FOCUS_IDS:
        resolved = template_id
    if resolved and resolved not in VALID_ANALYSIS_FOCUS_IDS:
        raise HTTPException(
            status_code=400, detail=f"Invalid analysis_focus_id: {resolved}"
        )
    return resolved


def _apply_theme_fields_to_dashboard(
    dashboard_data: Dict[str, Any],
    theme_id: Optional[str],
    analysis_focus_id: Optional[str] = None,
    legacy_template_id: Optional[str] = None,
    update_analysis_focus: bool = False,
) -> None:
    if theme_id:
        dashboard_data["theme_id"] = theme_id
        styling = dashboard_data.get("styling_recommendations")
        if not isinstance(styling, dict):
            styling = {}
            dashboard_data["styling_recommendations"] = styling
        styling["theme"] = theme_id
    else:
        dashboard_data.pop("theme_id", None)
        styling = dashboard_data.get("styling_recommendations")
        if isinstance(styling, dict):
            styling.pop("theme", None)

    if update_analysis_focus:
        if analysis_focus_id:
            dashboard_data["analysis_focus_id"] = analysis_focus_id
        else:
            dashboard_data.pop("analysis_focus_id", None)

    if legacy_template_id is not None:
        if legacy_template_id:
            dashboard_data["template_id"] = legacy_template_id
        else:
            dashboard_data.pop("template_id", None)


PLACEHOLDER_PROJECT_NAMES = {"", "untitled project", "new project"}
TITLE_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "build",
    "create",
    "dashboard",
    "data",
    "for",
    "from",
    "generate",
    "give",
    "make",
    "me",
    "my",
    "of",
    "please",
    "report",
    "show",
    "the",
    "this",
    "to",
    "use",
    "with",
}


def _is_placeholder_project_name(name: Optional[str]) -> bool:
    normalized = re.sub(r"\s+", " ", (name or "").strip().lower())
    return normalized in PLACEHOLDER_PROJECT_NAMES


def _should_generate_project_name(project: Dict[str, Any]) -> bool:
    if str(project.get("name_source") or "").lower() == "user":
        return False
    return _is_placeholder_project_name(project.get("name"))


def _title_case_words(text: str, max_words: int = 4) -> str:
    cleaned = re.sub(r"[_\-./]+", " ", text)
    cleaned = re.sub(r"[^A-Za-z0-9\s]+", " ", cleaned)
    words = [
        word
        for word in cleaned.split()
        if len(word) > 1 and word.lower() not in TITLE_STOPWORDS
    ]
    if not words:
        return ""
    return " ".join(word[:1].upper() + word[1:].lower() for word in words[:max_words])


def _extract_prompt_text(contents: List[Dict[str, Any]]) -> str:
    for content in contents:
        if content.get("type") == "text":
            text = content.get("data", {}).get("text")
            if isinstance(text, str):
                return text.strip()
    return ""


def _detect_source_label(contents: List[Dict[str, Any]]) -> str:
    raw_values: List[str] = []
    for content in contents:
        data = content.get("data", {}) or {}
        raw_values.extend(
            str(data.get(key) or "")
            for key in ("sourceType", "asset_type", "filename", "name")
        )
    raw = " ".join(raw_values).lower()
    if "ga4" in raw or "google_analytics" in raw or "google analytics" in raw:
        return "GA4"
    if "google ads" in raw or "google_ads" in raw:
        return "Google Ads"
    if "google sheet" in raw or "gsheet" in raw or "google_sheet" in raw:
        return "Google Sheets"
    if "meta" in raw or "facebook" in raw:
        return "Meta Ads"
    if "tiktok" in raw or "tik_tok" in raw:
        return "TikTok Ads"
    if "firebase" in raw:
        return "Firebase"
    if "appsflyer" in raw:
        return "AppsFlyer"
    if "stripe" in raw:
        return "Stripe"
    if "hubspot" in raw:
        return "HubSpot"
    if "salesforce" in raw:
        return "Salesforce"
    if "pipedrive" in raw:
        return "Pipedrive"
    if "supabase" in raw:
        return "Supabase"
    return "CSV"


def _first_asset_filename_topic(contents: List[Dict[str, Any]]) -> str:
    for content in contents:
        data = content.get("data", {}) or {}
        filename = str(data.get("filename") or data.get("name") or "")
        if filename:
            return _title_case_words(filename.rsplit(".", 1)[0], max_words=3)
    return ""


def _infer_project_topic(prompt: str, source_label: str, filename_topic: str) -> str:
    prompt_l = prompt.lower()
    if re.search(
        r"\b(revenue|sales|orders|ecommerce|gross merchandise|gmv)\b", prompt_l
    ):
        return "Sales Performance"
    if re.search(
        r"\b(ads?|campaign|roas|cpc|ctr|spend|impressions|clicks?)\b", prompt_l
    ):
        return "Campaign Performance"
    if re.search(
        r"\b(acquisition|traffic|sessions?|users?|engagement|ga4|analytics)\b", prompt_l
    ):
        return "Acquisition Overview"
    if re.search(r"\b(subscription|payment|stripe|mrr|arr|invoice)\b", prompt_l):
        return "Revenue Overview"
    if re.search(r"\b(pipeline|deal|crm|opportunity|owner|forecast)\b", prompt_l):
        return "Sales Pipeline"
    if re.search(r"\b(retention|churn|cohort|lifetime|ltv)\b", prompt_l):
        return "Retention Analysis"
    if source_label == "GA4":
        return "Acquisition Overview"
    if source_label in {"Google Ads", "Meta Ads", "TikTok Ads"}:
        return "Campaign Performance"
    if source_label == "Stripe":
        return "Revenue Overview"
    if source_label in {"HubSpot", "Salesforce", "Pipedrive"}:
        return "Sales Pipeline"
    if source_label == "Supabase":
        return "Product Analytics"
    if source_label == "Firebase":
        return "Product Analytics"
    if source_label == "AppsFlyer":
        return "Attribution Overview"
    return filename_topic or _title_case_words(prompt, max_words=3) or "Data Overview"


def _derive_project_name(contents: List[Dict[str, Any]]) -> str:
    prompt = _extract_prompt_text(contents)
    source_label = _detect_source_label(contents)
    filename_topic = _first_asset_filename_topic(contents)
    topic = _infer_project_topic(prompt, source_label, filename_topic)
    if source_label != "CSV" and not topic.startswith(source_label):
        name = f"{source_label} {topic}"
    else:
        name = topic
    if not re.search(
        r"\b(dashboard|overview|report|analysis|analytics|performance)\b", name, re.I
    ):
        name = f"{name} Dashboard"
    return re.sub(r"\s+", " ", name).strip()[:80]


def _conversation_keys(
    user_id: str, project_id: str, conversation_id: str
) -> Dict[str, str]:
    primary = build_conversation_key(user_id, project_id, conversation_id, backup=False)
    backup = build_conversation_key(user_id, project_id, conversation_id, backup=True)
    return {"primary": primary, "backup": backup}


class ConversationChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    project_id: str
    user_node_contents: List[Dict[str, Any]]
    # Metadata for user node - used for selective asset processing
    user_node_metadata: Optional[Dict[str, Any]] = None
    model: Optional[str] = "fast"
    theme_id: Optional[str] = None
    analysis_focus_id: Optional[str] = None
    # Legacy compatibility: old frontend sent use-case template IDs here.
    template_id: Optional[str] = None


class ConversationChatResponse(BaseModel):
    conversation_id: str
    project_id: str
    project_name: Optional[str] = None
    project_name_source: Optional[str] = None
    workflow_status: Dict


class ConversationResponse(BaseModel):
    conversation: Dict[str, Any]


VALID_ASSET_SELECTION_MODES = {"none", "explicit", "all"}


def _load_existing_conversation(
    user_id: str, project_id: str, conversation_id: str
) -> Dict[str, Any]:
    """Load existing conversation from S3."""
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    return load_conversation(s3_bucket, s3_key)


def _asset_ids_from_contents(contents: List[Dict[str, Any]]) -> List[str]:
    asset_ids: List[str] = []
    for content in contents:
        if content.get("type") not in {"asset", "attachment"}:
            continue
        asset_id = str((content.get("data") or {}).get("asset_id") or "").strip()
        if asset_id and asset_id not in asset_ids:
            asset_ids.append(asset_id)
    return asset_ids


def _find_clarification_request(
    conversation: Optional[Dict[str, Any]], clarification_id: str
) -> Optional[Dict[str, Any]]:
    if not conversation or not clarification_id:
        return None
    for node in reversed(conversation.get("nodes", [])):
        if node.get("role") != "assistant":
            continue
        for content in node.get("contents", []):
            if content.get("type") != "clarification_request":
                continue
            data = content.get("data") or {}
            if data.get("clarification_id") == clarification_id:
                return data
    return None


def _validate_asset_ids(user_id: str, project_id: str, asset_ids: List[str]) -> None:
    for asset_id in asset_ids:
        asset = assets_repo.get_asset(user_id, asset_id)
        if not asset:
            raise HTTPException(status_code=400, detail=f"Invalid asset_id: {asset_id}")
        if asset.get("project_id") != project_id:
            raise HTTPException(
                status_code=403, detail=f"Asset is not in this project: {asset_id}"
            )


def _validate_clarification_responses(
    contents: List[Dict[str, Any]],
    existing_conversation: Optional[Dict[str, Any]],
) -> None:
    for content in contents:
        if content.get("type") != "clarification_response":
            continue
        data = content.get("data") or {}
        clarification_id = str(data.get("clarification_id") or "").strip()
        selected_option_id = str(data.get("selected_option_id") or "").strip()
        if not clarification_id:
            raise HTTPException(status_code=400, detail="clarification_id is required")
        request = _find_clarification_request(existing_conversation, clarification_id)
        if not request:
            raise HTTPException(
                status_code=400, detail="Clarification request not found"
            )
        valid_option_ids = {
            str(option.get("id")) for option in request.get("options", [])
        }
        if selected_option_id and selected_option_id not in valid_option_ids:
            raise HTTPException(status_code=400, detail="Invalid clarification option")


def _normalize_user_node_metadata(
    contents: List[Dict[str, Any]],
    metadata: Optional[Dict[str, Any]],
    user_id: str,
    project_id: str,
) -> Dict[str, Any]:
    normalized = dict(metadata or {})
    content_asset_ids = _asset_ids_from_contents(contents)
    selected_asset_ids = [
        str(asset_id)
        for asset_id in normalized.get("selected_asset_ids", [])
        if str(asset_id).strip()
    ]
    for asset_id in content_asset_ids:
        if asset_id not in selected_asset_ids:
            selected_asset_ids.append(asset_id)

    selection_mode = normalized.get("asset_selection")
    if not selection_mode:
        selection_mode = "explicit" if selected_asset_ids else "none"
    if selection_mode not in VALID_ASSET_SELECTION_MODES:
        raise HTTPException(status_code=400, detail="Invalid asset_selection")

    if selection_mode == "none" and selected_asset_ids:
        raise HTTPException(
            status_code=400,
            detail="selected_asset_ids are not allowed when asset_selection is none",
        )
    if selection_mode == "explicit" and not selected_asset_ids:
        raise HTTPException(
            status_code=400,
            detail="selected_asset_ids are required when asset_selection is explicit",
        )
    if selected_asset_ids:
        _validate_asset_ids(user_id, project_id, selected_asset_ids)
        normalized["selected_asset_ids"] = selected_asset_ids
    else:
        normalized.pop("selected_asset_ids", None)
    normalized["asset_selection"] = selection_mode
    return normalized


def _project_asset_summaries(user_id: str, project_id: str) -> List[Dict[str, Any]]:
    assets = assets_repo.list_assets(user_id=user_id, project_id=project_id)
    summaries: List[Dict[str, Any]] = []
    for asset in assets:
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
                "row_count": (
                    int(asset["row_count"])
                    if asset.get("row_count") is not None
                    else None
                ),
                "column_count": (
                    int(asset["column_count"])
                    if asset.get("column_count") is not None
                    else None
                ),
                "status": asset.get("status"),
            }
        )
    return summaries


def _create_user_node(
    contents: List[Dict[str, Any]], metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Create user node matching existing structure."""
    now_iso = utc_now_iso()
    node = {
        "node_id": f"node_{uuid.uuid4().hex[:8]}",
        "role": "user",
        "status": "completed",
        "created_at": now_iso,
        "contents": contents,
    }
    if metadata:
        node["metadata"] = metadata
    return node


def _has_no_answer_clarification_response(
    conversation: Dict[str, Any], clarification_id: str
) -> bool:
    for node in conversation.get("nodes", []):
        if node.get("role") != "user":
            continue
        for content in node.get("contents", []):
            data = content.get("data") or {}
            if (
                content.get("type") == "clarification_response"
                and data.get("clarification_id") == clarification_id
                and data.get("answer_status") == "no_answer"
            ):
                return True
    return False


def _create_no_answer_clarification_node(clarification_id: str) -> Dict[str, Any]:
    return _create_user_node(
        [
            {
                "type": "clarification_response",
                "data": {
                    "clarification_id": clarification_id,
                    "selected_option_id": None,
                    "answer_status": "no_answer",
                    "free_text": None,
                },
            }
        ],
        {
            "hidden": True,
            "clarification_id": clarification_id,
            "clarification_answer_status": "no_answer",
        },
    )


def _create_greeting_node() -> Dict[str, Any]:
    """Create initial greeting message node."""
    now_iso = utc_now_iso()
    return {
        "node_id": f"node_{uuid.uuid4().hex[:8]}",
        "role": "assistant",
        "status": "completed",
        "created_at": now_iso,
        "contents": [
            {
                "type": "text",
                "data": {
                    "text": "Hi! I'm Morpheus, your analytics intern. Upload data, visualise motion-rich dashboard in seconds!",
                },
            }
        ],
    }


def _update_conversation_with_user_node(
    conversation: Dict[str, Any], user_node: Dict[str, Any]
) -> Dict[str, Any]:
    """Append user node and update timestamps."""
    conversation.setdefault("nodes", []).append(user_node)
    conversation["updated_at"] = utc_now_iso()
    return conversation


def _enrich_asset_content(content: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    """Enrich asset/attachment content with full asset data from database."""
    content_type = content.get("type")

    # Only process asset or attachment content types
    if content_type not in ["asset", "attachment"]:
        return content

    asset_data = content.get("data", {})
    asset_id = asset_data.get("asset_id")

    if not asset_id:
        logger.warning(f"Asset content missing asset_id, skipping enrichment")
        return content

    try:
        # Fetch full asset data from database
        asset = assets_repo.get_asset(user_id, asset_id)

        if not asset:
            logger.warning(
                f"Asset {asset_id} not found in database, skipping enrichment"
            )
            return content

        # Enrich content data with all required fields
        enriched_data = {
            "asset_id": asset.get("asset_id"),
            "file_id": asset.get("file_id"),
            "s3_bucket": asset.get("s3_bucket"),
            "s3_key": asset.get("s3_key"),
            "extension": asset.get("extension", ""),
            "filename": asset.get("filename", ""),
        }

        # Preserve any additional fields from original data (like kind, name, project_id)
        for key, value in asset_data.items():
            if key not in enriched_data:
                enriched_data[key] = value

        # Normalize type to "asset" for consistency
        enriched_content = {
            "type": "asset",
            "data": enriched_data,
        }

        logger.info(f"Enriched asset content for asset_id: {asset_id}")

        return enriched_content

    except Exception as e:
        logger.error(
            f"Failed to enrich asset content for asset_id {asset_id}: {e}",
            exc_info=True,
        )
        # Return original content if enrichment fails
        return content


def _enrich_user_node_contents(
    contents: List[Dict[str, Any]], user_id: str
) -> List[Dict[str, Any]]:
    """Enrich all asset/attachment content items in user_node_contents with full asset data."""
    enriched_contents = []

    for content in contents:
        enriched_content = _enrich_asset_content(content, user_id)
        enriched_contents.append(enriched_content)

    return enriched_contents


def _save_conversation_to_s3_and_dynamodb(
    user_id: str,
    project_id: str,
    conversation_id: str,
    conversation: Dict[str, Any],
    conversation_bucket: str,
    conversation_keys: Dict[str, str],
    title: Optional[str] = None,
    is_new: bool = True,
) -> None:
    """Save conversation to both S3 and DynamoDB."""
    save_conversation(conversation_bucket, conversation_keys["primary"], conversation)
    save_conversation(conversation_bucket, conversation_keys["backup"], conversation)

    if is_new:
        conversations_repo.create_conversation(
            project_id=project_id,
            user_id=user_id,
            s3_bucket=conversation_bucket,
            s3_key=conversation_keys["primary"],
            title=title or "Conversation",
            metadata={},
            conversation_id=conversation_id,
            node_count=len(conversation.get("nodes", [])),
        )


@router.post("/conversation/chat", response_model=ConversationChatResponse)
async def conversation_chat(
    request: ConversationChatRequest,
    user_id: str = Depends(require_user),
):
    """Chat endpoint that creates or updates conversation and calls morpheus."""
    project = projects_repo.get_project(user_id, request.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    existing_conversation: Optional[Dict[str, Any]] = None
    if request.conversation_id:
        existing_conversation = _load_existing_conversation(
            user_id, request.project_id, request.conversation_id
        )

    _validate_clarification_responses(request.user_node_contents, existing_conversation)
    user_node_metadata = _normalize_user_node_metadata(
        request.user_node_contents,
        request.user_node_metadata,
        user_id,
        request.project_id,
    )

    # Extract assets from user_node_contents and update their status
    assets_to_process = []
    for content in request.user_node_contents:
        if content.get("type") in ["asset", "attachment"]:
            asset_data = content.get("data", {})
            asset_id = asset_data.get("asset_id")
            if asset_id:
                asset = assets_repo.get_asset(user_id, asset_id)
                if asset:
                    assets_repo.update_asset_status(user_id, asset_id, "processing")
                    assets_to_process.append(asset_id)

    # Enrich asset/attachment content with full asset data before saving
    enriched_contents = _enrich_user_node_contents(request.user_node_contents, user_id)

    conversation_bucket = config.aws.s3.USER_ASSETS_BUCKET
    now_iso = utc_now_iso()

    model_alias = request.model or "fast"
    resolved_model = MODEL_ID_MAP.get(model_alias, MODEL_ID_MAP["fast"])
    theme_id = _resolve_theme_id(request.theme_id, request.template_id)
    analysis_focus_id = _resolve_analysis_focus_id(
        request.analysis_focus_id, request.template_id
    )

    user_node_metadata["chat_mode"] = model_alias
    user_node_metadata["resolved_model"] = resolved_model
    if theme_id:
        user_node_metadata["theme_id"] = theme_id
    if analysis_focus_id:
        user_node_metadata["analysis_focus_id"] = analysis_focus_id

    user_node = _create_user_node(enriched_contents, user_node_metadata)

    is_new_conversation = False
    if request.conversation_id:
        # Load existing conversation and update
        conversation = existing_conversation or _load_existing_conversation(
            user_id, request.project_id, request.conversation_id
        )
        conversation = _update_conversation_with_user_node(conversation, user_node)
        conversation_id = request.conversation_id
        conversation_keys = _conversation_keys(
            user_id, request.project_id, conversation_id
        )

        # Update DynamoDB metadata so admin list views have the latest model info
        existing_meta = conversations_repo.get_conversation(
            request.project_id, conversation_id
        )
        if existing_meta:
            dynamo_metadata = existing_meta.get("metadata", {})
            dynamo_metadata["chat_mode"] = model_alias
            dynamo_metadata["resolved_model"] = resolved_model
            if theme_id:
                dynamo_metadata["theme_id"] = theme_id
            if analysis_focus_id:
                dynamo_metadata["analysis_focus_id"] = analysis_focus_id
            if request.template_id:
                dynamo_metadata["template_id"] = request.template_id
            conversations_repo.update_conversation_metadata(
                request.project_id, conversation_id, dynamo_metadata
            )

            # Also update conversation object to persist theme/focus metadata in S3
            conversation.setdefault("metadata", {})
            if theme_id:
                conversation["metadata"]["theme_id"] = theme_id
            if analysis_focus_id:
                conversation["metadata"]["analysis_focus_id"] = analysis_focus_id
            conversation["metadata"]["template_id"] = (
                request.template_id or conversation["metadata"].get("template_id")
            )
            conversation["metadata"]["chat_mode"] = model_alias
            conversation["metadata"]["resolved_model"] = resolved_model
    else:
        # Create new conversation
        is_new_conversation = True
        conversation_id = str(uuid.uuid4())
        conversation_keys = _conversation_keys(
            user_id, request.project_id, conversation_id
        )

        metadata = {
            "status": "active",
            "chat_mode": model_alias,
            "resolved_model": resolved_model,
            "project": {
                "project_id": request.project_id,
                "user_id": user_id,
            },
        }

        greeting_node = _create_greeting_node()
        conversation = {
            "user_id": user_id,
            "project_id": request.project_id,
            "conversation_id": conversation_id,
            "created_at": now_iso,
            "updated_at": now_iso,
            "metadata": {
                **metadata,
                "theme_id": theme_id,
                "analysis_focus_id": analysis_focus_id,
                "template_id": request.template_id,
            },
            "nodes": [greeting_node, user_node],
            "dashboards": [],
        }

    _save_conversation_to_s3_and_dynamodb(
        user_id=user_id,
        project_id=request.project_id,
        conversation_id=conversation_id,
        conversation=conversation,
        conversation_bucket=conversation_bucket,
        conversation_keys=conversation_keys,
        is_new=is_new_conversation,
    )

    # Keep project metadata in sync so frontend can restore conversations
    project_name = project.get("name")
    project_name_source = project.get("name_source")
    try:
        logger.info(
            f"Updating project {request.project_id} with conversation {conversation_id}"
        )
        next_project_name = _derive_project_name(enriched_contents)
        should_name_project = _should_generate_project_name(project) and bool(
            next_project_name
        )
        updated = projects_repo.update_project(
            user_id=user_id,
            project_id=request.project_id,
            name=next_project_name if should_name_project else None,
            name_source="generated" if should_name_project else None,
            latest_conversation_id=conversation_id,
        )
        if updated:
            project_name = updated.get("name", project_name)
            project_name_source = updated.get("name_source", project_name_source)
            logger.info(f"Successfully updated project {request.project_id} metadata")
        else:
            logger.warning(f"Project update returned None for {request.project_id}")
    except Exception as exc:
        # Do not block chat flow if metadata update fails
        logger.error(
            f"Failed to update project conversation metadata: {exc}", exc_info=True
        )

    # Small delay to help with S3 eventual consistency
    await asyncio.sleep(0.5)

    morpheus_payload = {
        "conversation_id": conversation_id,
        "conversation_uri": f"s3://{conversation_bucket}/{conversation_keys['primary']}",
        "conversation_backup_uri": f"s3://{conversation_bucket}/{conversation_keys['backup']}",
        "project_id": request.project_id,
        "user_id": user_id,
        "model": resolved_model,
        "theme_id": theme_id,
        "analysis_focus_id": analysis_focus_id,
        "template_id": request.template_id,
        "project_assets": _project_asset_summaries(user_id, request.project_id),
    }

    try:
        workflow_status = await morpheus_client.run_workflow(morpheus_payload)
    except morpheus_client.MorpheusUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc.detail)) from exc
    except morpheus_client.MorpheusTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc.detail)) from exc
    except morpheus_client.MorpheusError as exc:
        raise HTTPException(status_code=502, detail=str(exc.detail)) from exc

    # Deduct credits only after Morpheus accepted the run AND did not report an
    # outright failure, so timeouts/errors don't silently drain the allowance.
    if _is_billable_workflow_result(workflow_status):
        credit_cost = credit_service_instance.get_model_cost(model_alias)
        credit_service_instance.consume_credits(user_id, credit_cost)
    else:
        logger.info(
            "Skipping credit deduction: non-billable workflow status %s",
            (
                workflow_status.get("status")
                if isinstance(workflow_status, dict)
                else None
            ),
        )

    return ConversationChatResponse(
        conversation_id=conversation_id,
        project_id=request.project_id,
        project_name=project_name,
        project_name_source=project_name_source,
        workflow_status=workflow_status,
    )


class WorkflowStatusResponse(BaseModel):
    conversation_id: str
    node_id: str
    status: str
    metadata: Dict[str, Any]
    updated_at: Optional[str] = None


class ThinkingEventResponse(BaseModel):
    id: str
    run_id: str
    sequence: int
    phase: str
    status: str
    title: str
    summary: Optional[str] = None
    detail: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[float] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class WorkflowEventsResponse(BaseModel):
    conversation_id: str
    status: Optional[WorkflowStatusResponse] = None
    events: List[ThinkingEventResponse]


def _map_workflow_node(item: Dict[str, Any]) -> WorkflowStatusResponse:
    return WorkflowStatusResponse(
        conversation_id=item["conversation_id"],
        node_id=item["node_id"],
        status=item.get("status", ""),
        metadata=item.get("metadata", {}),
        updated_at=item.get("updated_at"),
    )


def _map_thinking_event(item: Dict[str, Any]) -> ThinkingEventResponse:
    metadata = item.get("metadata", {}) or {}
    node_id = item.get("node_id", "")
    return ThinkingEventResponse(
        id=str(metadata.get("id") or node_id),
        run_id=str(metadata.get("run_id") or ""),
        sequence=int(metadata.get("sequence") or 0),
        phase=str(metadata.get("phase") or "analysis"),
        status=str(metadata.get("status") or item.get("status") or "completed"),
        title=str(metadata.get("title") or "Thinking"),
        summary=metadata.get("summary"),
        detail=metadata.get("detail"),
        started_at=metadata.get("started_at"),
        completed_at=metadata.get("completed_at"),
        duration_ms=metadata.get("duration_ms"),
        metadata=metadata.get("metadata") or {},
    )


# NOTE: Workflow helper routes MUST be declared before /conversation/{conversation_id}
# to avoid FastAPI matching static path segments as a conversation_id.
@router.get(
    "/conversation/workflow-status/{conversation_id}",
    response_model=WorkflowStatusResponse,
)
async def get_conversation_workflow_status(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    """Get workflow status for a conversation.

    Returns a 'starting' status (HTTP 200) instead of 404 when Morpheus
    hasn't posted its first status update yet. This prevents the frontend
    from treating the initial polling race as a hard failure.
    """
    conversation = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation or conversation.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    node = workflow_nodes_repo.get_node(conversation_id, "workflow")
    if not node:
        # Morpheus hasn't written its first status update yet — return a
        # synthetic 'starting' response so the frontend keeps polling.
        return WorkflowStatusResponse(
            conversation_id=conversation_id,
            node_id="workflow",
            status="starting",
            metadata={"step": "initializing"},
        )
    return _map_workflow_node(node)


@router.get(
    "/conversation/workflow-events/{conversation_id}",
    response_model=WorkflowEventsResponse,
)
async def get_conversation_workflow_events(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    conversation = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation or conversation.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    status_item = workflow_nodes_repo.get_node(conversation_id, "workflow")
    events = workflow_nodes_repo.list_workflow_events(conversation_id)
    return WorkflowEventsResponse(
        conversation_id=conversation_id,
        status=_map_workflow_node(status_item) if status_item else None,
        events=[_map_thinking_event(item) for item in events],
    )


_TERMINAL_STATUSES = {
    "completed",
    "finished",
    "failed",
    "error",
    "stopped",
    "awaiting_user_input",
}
_SSE_POLL_INTERVAL_SECONDS = 2.0


def _sse_frame(event_type: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"


def _event_payload(item: Dict[str, Any]) -> Dict[str, Any]:
    return _map_thinking_event(item).model_dump()


def _status_payload(item: Dict[str, Any]) -> Dict[str, Any]:
    return _map_workflow_node(item).model_dump()


@router.get("/conversation/{conversation_id}/stream")
async def stream_conversation_workflow(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    """Stream workflow status + thinking events to the client over SSE.

    Additive alternative to the polling endpoints. On connect we replay the
    current workflow node + existing events (so a late subscriber is caught up
    and the callback-before-subscribe race is avoided), then live-tail via the
    in-process event bus. A short DynamoDB poll also runs so correctness does
    not depend on the in-process bus (Gunicorn workers each have their own).
    """
    conversation = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    async def generator():
        queue = await event_bus.subscribe(conversation_id)
        seen_event_node_ids: set = set()
        last_status_updated_at: Optional[str] = None
        terminal = False
        try:
            # (a) Replay current state so a late subscriber is caught up.
            status_item = workflow_nodes_repo.get_node(conversation_id, "workflow")
            if status_item:
                last_status_updated_at = status_item.get("updated_at")
                yield _sse_frame("status", _status_payload(status_item))
                if str(status_item.get("status", "")).lower() in _TERMINAL_STATUSES:
                    terminal = True
            for event_item in workflow_nodes_repo.list_workflow_events(conversation_id):
                seen_event_node_ids.add(event_item.get("node_id"))
                yield _sse_frame("event", _event_payload(event_item))

            # (b)+(c) Live-tail the bus, falling back to DynamoDB polling.
            while not terminal:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=_SSE_POLL_INTERVAL_SECONDS
                    )
                except asyncio.TimeoutError:
                    item = None

                if item is not None:
                    item_type = item.get("type", "event")
                    if item_type == "status":
                        last_status_updated_at = item.get("updated_at")
                        yield _sse_frame("status", _status_payload(item))
                        if str(item.get("status", "")).lower() in _TERMINAL_STATUSES:
                            terminal = True
                    else:
                        node_id = item.get("node_id")
                        if node_id not in seen_event_node_ids:
                            seen_event_node_ids.add(node_id)
                            yield _sse_frame("event", _event_payload(item))
                    continue

                # Poll tick (also doubles as ~keep-alive interval). Emit any
                # rows newer than what we've already streamed.
                yield ": keep-alive\n\n"
                for event_item in workflow_nodes_repo.list_workflow_events(
                    conversation_id
                ):
                    node_id = event_item.get("node_id")
                    if node_id not in seen_event_node_ids:
                        seen_event_node_ids.add(node_id)
                        yield _sse_frame("event", _event_payload(event_item))

                polled_status = workflow_nodes_repo.get_node(
                    conversation_id, "workflow"
                )
                if polled_status:
                    polled_updated_at = polled_status.get("updated_at")
                    if polled_updated_at != last_status_updated_at:
                        last_status_updated_at = polled_updated_at
                        yield _sse_frame("status", _status_payload(polled_status))
                    if (
                        str(polled_status.get("status", "")).lower()
                        in _TERMINAL_STATUSES
                    ):
                        terminal = True
        finally:
            await event_bus.unsubscribe(conversation_id, queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversation/{conversation_id}", response_model=ConversationResponse)
async def load_conversation_endpoint(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    """Load full conversation from S3."""
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)

    return ConversationResponse(conversation=conversation)


class DashboardDataResponse(BaseModel):
    dashboard_id: Optional[str] = None
    dashboard_data: Optional[Dict[str, Any]] = None
    # Phase 6: chart-edit explainer surfaced alongside the dashboard. All
    # optional so older clients are unaffected.
    change_summary: Optional[Dict[str, Any]] = None
    computed_values: Optional[Dict[str, Any]] = None
    version: Optional[int] = None
    # Phase: activity transparency — per-step analysis trail surfaced on reload.
    analysis_steps: Optional[List[Dict[str, Any]]] = None


def _latest_edit_explainer(conversation_id: str) -> Dict[str, Optional[Any]]:
    """Pull the most recent chart-edit explainer from the workflow status node.

    Morpheus attaches ``change_summary`` and ``data_provenance`` to the terminal
    workflow-status metadata for chart modifications. Returns empty values when
    none are present (e.g. a full dashboard generation).
    """
    try:
        node = workflow_nodes_repo.get_node(conversation_id, "workflow")
    except Exception:
        node = None
    metadata = (node or {}).get("metadata") or {}
    return {
        "change_summary": metadata.get("change_summary"),
        "computed_values": metadata.get("data_provenance")
        or metadata.get("computed_values"),
        "analysis_steps": metadata.get("analysis_steps"),
    }


class StopWorkflowResponse(BaseModel):
    success: bool
    message: str
    conversation_id: str


class ClarificationDismissResponse(BaseModel):
    success: bool
    message: str
    conversation_id: str
    clarification_id: str


@router.get(
    "/conversation/{conversation_id}/dashboard", response_model=DashboardDataResponse
)
async def get_conversation_dashboard(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID"),
    dashboard_id: Optional[str] = Query(
        None, description="Specific dashboard ID to fetch"
    ),
    user_id: str = Depends(require_user),
):
    """Get dashboard data from a specific dashboard or the latest dashboard in conversation."""
    logger.info(
        "Fetching dashboard for conversation: project_id=%s, conversation_id=%s, dashboard_id=%s, user_id=%s",
        project_id,
        conversation_id,
        dashboard_id,
        user_id,
    )

    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        logger.warning(
            "Conversation not found for dashboard request: project_id=%s, conversation_id=%s, user_id=%s",
            project_id,
            conversation_id,
            user_id,
        )
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        logger.warning(
            "Unauthorized dashboard access attempt: project_id=%s, conversation_id=%s, user_id=%s, owner_id=%s",
            project_id,
            conversation_id,
            user_id,
            conversation_meta.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="Unauthorized")

    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)

    # Get dashboards list
    dashboards = conversation.get("dashboards", [])
    if not dashboards:
        logger.info(
            "No dashboards present in conversation: project_id=%s, conversation_id=%s",
            project_id,
            conversation_id,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)

    # Select specific dashboard if ID provided, otherwise get latest
    if dashboard_id:
        target_dashboard = next(
            (d for d in dashboards if d.get("dashboard_id") == dashboard_id), None
        )
        if not target_dashboard:
            logger.warning(
                "Dashboard not found: project_id=%s, conversation_id=%s, dashboard_id=%s",
                project_id,
                conversation_id,
                dashboard_id,
            )
            raise HTTPException(
                status_code=404, detail=f"Dashboard {dashboard_id} not found"
            )
    else:
        target_dashboard = dashboards[-1]

    dashboard_id = target_dashboard.get("dashboard_id")
    s3_uri = target_dashboard.get("s3_uri")

    if not dashboard_id or not s3_uri:
        logger.warning(
            "Dashboard metadata incomplete for conversation: project_id=%s, conversation_id=%s, dashboard=%s",
            project_id,
            conversation_id,
            target_dashboard,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)

    # Parse s3://bucket/key format
    if not s3_uri.startswith("s3://"):
        logger.error(
            "Invalid S3 URI format for dashboard: project_id=%s, conversation_id=%s, dashboard_id=%s, s3_uri=%s",
            project_id,
            conversation_id,
            dashboard_id,
            s3_uri,
        )
        raise HTTPException(
            status_code=500, detail="Invalid S3 URI format for dashboard"
        )

    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        logger.error(
            "Invalid S3 URI format (missing key) for dashboard: project_id=%s, conversation_id=%s, dashboard_id=%s, s3_uri=%s",
            project_id,
            conversation_id,
            dashboard_id,
            s3_uri,
        )
        raise HTTPException(
            status_code=500, detail="Invalid S3 URI format for dashboard"
        )

    bucket = uri_parts[0]
    key = uri_parts[1].lstrip("/")

    try:
        dashboard_bytes = download_bytes(bucket, key)
        dashboard_data = json.loads(dashboard_bytes.decode("utf-8"))

        logger.info(
            "Successfully loaded dashboard from S3: bucket=%s, key=%s, dashboard_id=%s",
            bucket,
            key,
            dashboard_id,
        )

        explainer = _latest_edit_explainer(conversation_id)
        return DashboardDataResponse(
            dashboard_id=dashboard_id,
            dashboard_data=dashboard_data,
            change_summary=explainer.get("change_summary"),
            computed_values=explainer.get("computed_values"),
            analysis_steps=explainer.get("analysis_steps"),
        )
    except FileNotFoundError:
        logger.warning(
            "Dashboard data not found in S3, treating as no dashboard yet: bucket=%s, key=%s, dashboard_id=%s",
            bucket,
            key,
            dashboard_id,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    except Exception as e:
        logger.error(
            "Failed to load dashboard from S3: bucket=%s, key=%s, dashboard_id=%s, error=%s",
            bucket,
            key,
            dashboard_id,
            str(e),
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to load dashboard: {str(e)}"
        )


class UpdateDashboardTemplateRequest(BaseModel):
    project_id: str
    template_id: Optional[str] = None


class UpdateDashboardThemeRequest(BaseModel):
    project_id: str
    theme_id: Optional[str] = None


def _load_dashboard_artifact_for_update(
    conversation_id: str,
    dashboard_id: str,
    project_id: str,
    user_id: str,
) -> tuple[str, str, Dict[str, Any]]:
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)

    dashboards = conversation.get("dashboards", [])
    target = next(
        (d for d in dashboards if d.get("dashboard_id") == dashboard_id), None
    )
    if not target:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    s3_uri = target.get("s3_uri", "")
    if not s3_uri.startswith("s3://"):
        raise HTTPException(status_code=500, detail="Invalid dashboard S3 URI")

    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        raise HTTPException(status_code=500, detail="Invalid dashboard S3 URI")

    bucket = uri_parts[0]
    key = uri_parts[1].lstrip("/")

    try:
        dashboard_bytes = download_bytes(bucket, key)
        dashboard_data = json.loads(dashboard_bytes.decode("utf-8"))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Dashboard data not found in S3")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load dashboard: {str(e)}"
        )

    return bucket, key, dashboard_data


def _save_dashboard_artifact_update(
    bucket: str,
    key: str,
    dashboard_data: Dict[str, Any],
) -> None:
    try:
        updated_bytes = json.dumps(dashboard_data, ensure_ascii=False, indent=2).encode(
            "utf-8"
        )
        upload_bytes(bucket, key, updated_bytes, content_type="application/json")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save dashboard: {str(e)}"
        )


@router.put("/conversation/{conversation_id}/dashboard/{dashboard_id}/theme")
async def update_dashboard_theme(
    conversation_id: str,
    dashboard_id: str,
    request: UpdateDashboardThemeRequest,
    user_id: str = Depends(require_user),
):
    """Update the visual theme inside a saved dashboard JSON in S3."""
    theme_id = _resolve_theme_id(request.theme_id)
    bucket, key, dashboard_data = _load_dashboard_artifact_for_update(
        conversation_id, dashboard_id, request.project_id, user_id
    )
    _apply_theme_fields_to_dashboard(dashboard_data, theme_id)
    _save_dashboard_artifact_update(bucket, key, dashboard_data)

    return {"success": True}


@router.put("/conversation/{conversation_id}/dashboard/{dashboard_id}/template")
async def update_dashboard_template(
    conversation_id: str,
    dashboard_id: str,
    request: UpdateDashboardTemplateRequest,
    user_id: str = Depends(require_user),
):
    """Legacy wrapper: map old template_id to theme_id/focus fields."""
    theme_id = _resolve_theme_id(None, request.template_id)
    analysis_focus_id = _resolve_analysis_focus_id(None, request.template_id)
    bucket, key, dashboard_data = _load_dashboard_artifact_for_update(
        conversation_id, dashboard_id, request.project_id, user_id
    )
    _apply_theme_fields_to_dashboard(
        dashboard_data,
        theme_id,
        analysis_focus_id,
        request.template_id,
        update_analysis_focus=True,
    )
    _save_dashboard_artifact_update(bucket, key, dashboard_data)

    return {"success": True}


class SaveDashboardDataRequest(BaseModel):
    project_id: str
    dashboard_data: Dict[str, Any]
    # Phase 7: optional version-history controls. Both optional so older clients
    # keep working unchanged.
    edit_summary: Optional[str] = None
    expected_version: Optional[int] = None


class DashboardVersionInfo(BaseModel):
    version: int
    created_at: str
    edit_summary: Optional[str] = None
    source: str


class DashboardVersionListResponse(BaseModel):
    dashboard_id: str
    current_version: int
    versions: List[DashboardVersionInfo]


class RevertRequest(BaseModel):
    project_id: str
    target_version: int


class RevertResponse(BaseModel):
    success: bool
    dashboard_id: str
    new_version: int
    reverted_to: int


def _locate_dashboard_entry(
    conversation: Dict[str, Any], dashboard_id: str
) -> Dict[str, Any]:
    """Find a dashboard manifest entry by id, raising 404 if absent."""
    target = next(
        (
            d
            for d in conversation.get("dashboards", [])
            if d.get("dashboard_id") == dashboard_id
        ),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return target


def _parse_dashboard_s3_uri(target_dashboard_entry: Dict[str, Any]) -> tuple[str, str]:
    """Split a dashboard entry's ``s3_uri`` into (bucket, key)."""
    s3_uri = target_dashboard_entry.get("s3_uri", "")
    if not s3_uri.startswith("s3://"):
        raise HTTPException(status_code=500, detail="Invalid dashboard S3 URI")
    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        raise HTTPException(status_code=500, detail="Invalid dashboard S3 URI")
    return uri_parts[0], uri_parts[1].lstrip("/")


@router.put("/conversation/{conversation_id}/dashboard/{dashboard_id}/data")
async def save_dashboard_data(
    conversation_id: str,
    dashboard_id: str,
    request: SaveDashboardDataRequest,
    user_id: str = Depends(require_user),
):
    """Overwrite a saved dashboard JSON in S3 with new data (manual edits).

    Phase 7: snapshots the current dashboard state to an immutable version key
    BEFORE overwriting, and supports optimistic-concurrency via
    ``expected_version``.
    """
    conversation_meta = conversations_repo.get_conversation(
        request.project_id, conversation_id
    )
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)

    target = _locate_dashboard_entry(conversation, dashboard_id)
    bucket, key = _parse_dashboard_s3_uri(target)

    if request.expected_version is not None:
        head = dashboard_version_service.current_version(target)
        if request.expected_version != head:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Dashboard was modified: expected version "
                    f"{request.expected_version}, current is {head}"
                ),
            )

    # Snapshot the current state before we overwrite it (manual edit).
    dashboard_version_service.snapshot_current(
        bucket,
        key,
        user_id,
        request.project_id,
        dashboard_id,
        conversation,
        target,
        source="manual",
        edit_summary=request.edit_summary,
        conversation_bucket=s3_bucket,
        conversation_key=s3_key,
    )

    try:
        updated_bytes = json.dumps(
            request.dashboard_data, ensure_ascii=False, indent=2
        ).encode("utf-8")
        upload_bytes(bucket, key, updated_bytes, content_type="application/json")
    except Exception as e:
        logger.error(
            "Failed to save dashboard data: dashboard_id=%s, error=%s",
            dashboard_id,
            str(e),
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to save dashboard: {str(e)}"
        )

    logger.info(
        "Dashboard saved: conversation_id=%s, dashboard_id=%s",
        conversation_id,
        dashboard_id,
    )
    return {"success": True}


@router.get(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/versions",
    response_model=DashboardVersionListResponse,
)
async def list_dashboard_versions(
    conversation_id: str,
    dashboard_id: str,
    project_id: str = Query(..., description="Project ID"),
    user_id: str = Depends(require_user),
):
    """List the version-history manifest for a dashboard."""
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    conversation = load_conversation(
        conversation_meta["s3_bucket"], conversation_meta["s3_key"]
    )
    target = _locate_dashboard_entry(conversation, dashboard_id)

    manifest = dashboard_version_service.list_versions(conversation, dashboard_id)
    return DashboardVersionListResponse(
        dashboard_id=dashboard_id,
        current_version=dashboard_version_service.current_version(target),
        versions=[
            DashboardVersionInfo(
                version=entry["version"],
                created_at=entry["created_at"],
                edit_summary=entry.get("edit_summary"),
                source=entry.get("source", "manual"),
            )
            for entry in manifest
        ],
    )


@router.get(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/versions/{version}",
    response_model=DashboardDataResponse,
)
async def get_dashboard_version(
    conversation_id: str,
    dashboard_id: str,
    version: int,
    project_id: str = Query(..., description="Project ID"),
    user_id: str = Depends(require_user),
):
    """Return the dashboard data captured in a specific version snapshot."""
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    conversation = load_conversation(
        conversation_meta["s3_bucket"], conversation_meta["s3_key"]
    )
    target = _locate_dashboard_entry(conversation, dashboard_id)
    bucket, _ = _parse_dashboard_s3_uri(target)

    try:
        dashboard_data = dashboard_version_service.get_version_data(
            bucket, user_id, project_id, dashboard_id, version
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404, detail=f"Dashboard version {version} not found"
        )

    return DashboardDataResponse(
        dashboard_id=dashboard_id,
        dashboard_data=dashboard_data,
        version=version,
    )


@router.post(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/revert",
    response_model=RevertResponse,
)
async def revert_dashboard_version(
    conversation_id: str,
    dashboard_id: str,
    request: RevertRequest,
    user_id: str = Depends(require_user),
):
    """Restore a prior dashboard version (non-destructive: revert is a new head)."""
    conversation_meta = conversations_repo.get_conversation(
        request.project_id, conversation_id
    )
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)
    target = _locate_dashboard_entry(conversation, dashboard_id)
    bucket, key = _parse_dashboard_s3_uri(target)

    try:
        new_version = dashboard_version_service.revert(
            bucket,
            key,
            user_id,
            request.project_id,
            dashboard_id,
            conversation,
            target,
            request.target_version,
            conversation_bucket=s3_bucket,
            conversation_key=s3_key,
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Dashboard version {request.target_version} not found",
        )

    return RevertResponse(
        success=True,
        dashboard_id=dashboard_id,
        new_version=new_version,
        reverted_to=request.target_version,
    )


@router.post(
    "/conversation/{conversation_id}/clarification/{clarification_id}/dismiss",
    response_model=ClarificationDismissResponse,
)
async def dismiss_clarification(
    conversation_id: str,
    clarification_id: str,
    project_id: str = Query(..., description="Project ID"),
    user_id: str = Depends(require_user),
):
    """Persist a no-answer clarification response and stop the pending workflow."""
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)

    clarification = _find_clarification_request(conversation, clarification_id)
    if not clarification:
        raise HTTPException(status_code=404, detail="Clarification request not found")

    if not _has_no_answer_clarification_response(conversation, clarification_id):
        conversation.setdefault("nodes", []).append(
            _create_no_answer_clarification_node(clarification_id)
        )
        conversation["updated_at"] = utc_now_iso()
        save_conversation(s3_bucket, s3_key, conversation)
        backup_key = _conversation_keys(user_id, project_id, conversation_id)["backup"]
        if backup_key != s3_key:
            save_conversation(s3_bucket, backup_key, conversation)

    now_iso = utc_now_iso()
    stop_metadata = {
        "step": "clarification_dismissed",
        "message": "Clarification dismissed without an answer",
        "clarification_id": clarification_id,
        "reason_code": clarification.get("reason_code"),
        "answer_status": "no_answer",
        "stopped_at": now_iso,
        "stopped_by": user_id,
    }
    workflow_nodes_repo.upsert_node_status(
        conversation_id=conversation_id,
        node_id="workflow",
        status="stopped",
        metadata=stop_metadata,
    )
    workflow_nodes_repo.upsert_node_status(
        conversation_id=conversation_id,
        node_id="stop_signal",
        status="stopped",
        metadata=stop_metadata,
    )

    return ClarificationDismissResponse(
        success=True,
        message="Clarification dismissed",
        conversation_id=conversation_id,
        clarification_id=clarification_id,
    )


@router.post(
    "/conversation/{conversation_id}/stop", response_model=StopWorkflowResponse
)
async def stop_workflow(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    """Stop a running workflow for a conversation."""
    logger.info(
        "Stop workflow request: project_id=%s, conversation_id=%s, user_id=%s",
        project_id,
        conversation_id,
        user_id,
    )

    # Validate conversation exists and belongs to user
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    # Write stop signal to a SEPARATE node_id so Morpheus progress updates
    # (which write to node_id="workflow") don't overwrite it
    now_iso = utc_now_iso()
    workflow_nodes_repo.upsert_node_status(
        conversation_id=conversation_id,
        node_id="stop_signal",
        status="stopped",
        metadata={
            "stopped_at": now_iso,
            "stopped_by": user_id,
        },
    )

    logger.info(
        "Workflow stopped successfully: project_id=%s, conversation_id=%s, user_id=%s",
        project_id,
        conversation_id,
        user_id,
    )

    return StopWorkflowResponse(
        success=True,
        message="Workflow stopped successfully",
        conversation_id=conversation_id,
    )
