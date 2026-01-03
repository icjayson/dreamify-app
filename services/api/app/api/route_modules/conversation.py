"""
Conversation management endpoints.
"""
import uuid
import time
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
import json
import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.dependencies.auth import require_user
from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import conversations as conversations_repo
from utils.dynamodb.repos import projects as projects_repo
from utils.dynamodb.repos import workflow_nodes as workflow_nodes_repo
from utils.s3.conversations import save_conversation, load_conversation
from utils.s3.paths import build_conversation_key
from utils.s3.client import download_bytes

logger = logging.getLogger(__name__)

router = APIRouter(tags=["conversation"])

MORPHEUS_SERVICE_URL = "http://localhost:8000"


def _conversation_keys(user_id: str, project_id: str, conversation_id: str) -> Dict[str, str]:
    primary = build_conversation_key(user_id, project_id, conversation_id, backup=False)
    backup = build_conversation_key(user_id, project_id, conversation_id, backup=True)
    return {"primary": primary, "backup": backup}


class ConversationChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    project_id: str
    user_node_contents: List[Dict[str, Any]]


class ConversationChatResponse(BaseModel):
    conversation_id: str
    project_id: str
    workflow_status: Dict


class ConversationResponse(BaseModel):
    conversation: Dict[str, Any]


def _load_existing_conversation(user_id: str, project_id: str, conversation_id: str) -> Dict[str, Any]:
    """Load existing conversation from S3."""
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    return load_conversation(s3_bucket, s3_key)


def _create_user_node(contents: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Create user node matching existing structure."""
    now_iso = datetime.utcnow().isoformat()
    return {
        "node_id": f"node_{uuid.uuid4().hex[:8]}",
        "role": "user",
        "status": "completed",
        "created_at": now_iso,
        "contents": contents,
    }


def _create_greeting_node() -> Dict[str, Any]:
    """Create initial greeting message node."""
    now_iso = datetime.utcnow().isoformat()
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


def _update_conversation_with_user_node(conversation: Dict[str, Any], user_node: Dict[str, Any]) -> Dict[str, Any]:
    """Append user node and update timestamps."""
    conversation.setdefault("nodes", []).append(user_node)
    conversation["updated_at"] = datetime.utcnow().isoformat()
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
            logger.warning(f"Asset {asset_id} not found in database, skipping enrichment")
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
        logger.error(f"Failed to enrich asset content for asset_id {asset_id}: {e}", exc_info=True)
        # Return original content if enrichment fails
        return content


def _enrich_user_node_contents(contents: List[Dict[str, Any]], user_id: str) -> List[Dict[str, Any]]:
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
    now_iso = datetime.utcnow().isoformat()
    
    user_node = _create_user_node(enriched_contents)
    
    is_new_conversation = False
    if request.conversation_id:
        # Load existing conversation and update
        conversation = _load_existing_conversation(user_id, request.project_id, request.conversation_id)
        conversation = _update_conversation_with_user_node(conversation, user_node)
        conversation_id = request.conversation_id
        conversation_keys = _conversation_keys(user_id, request.project_id, conversation_id)
    else:
        # Create new conversation
        is_new_conversation = True
        conversation_id = str(uuid.uuid4())
        conversation_keys = _conversation_keys(user_id, request.project_id, conversation_id)
        
        metadata = {
            "status": "active",
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
            "metadata": metadata,
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
    try:
        logger.info(f"Updating project {request.project_id} with conversation {conversation_id}")
        updated = projects_repo.update_project(
            user_id=user_id,
            project_id=request.project_id,
            latest_conversation_id=conversation_id,
        )
        if updated:
            logger.info(f"Successfully updated project {request.project_id} metadata")
        else:
            logger.warning(f"Project update returned None for {request.project_id}")
    except Exception as exc:
        # Do not block chat flow if metadata update fails
        logger.error(f"Failed to update project conversation metadata: {exc}", exc_info=True)

    # Small delay to help with S3 eventual consistency
    await asyncio.sleep(0.5)

    morpheus_payload = {
        "conversation_id": conversation_id,
        "conversation_uri": f"s3://{conversation_bucket}/{conversation_keys['primary']}",
        "conversation_backup_uri": f"s3://{conversation_bucket}/{conversation_keys['backup']}",
        "project_id": request.project_id,
        "user_id": user_id,
    }

    try:
        # Run synchronous request in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: requests.post(
                f"{MORPHEUS_SERVICE_URL}/run",
                json=morpheus_payload,
                timeout=30,
            )
        )
        response.raise_for_status()
        workflow_status = response.json()
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail="Morpheus service unavailable")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Morpheus service timeout")
    except requests.exceptions.RequestException as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return ConversationChatResponse(
        conversation_id=conversation_id,
        project_id=request.project_id,
        workflow_status=workflow_status,
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


class StopWorkflowResponse(BaseModel):
    success: bool
    message: str
    conversation_id: str


@router.get("/conversation/{conversation_id}/dashboard", response_model=DashboardDataResponse)
async def get_conversation_dashboard(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    """Get dashboard data from the latest dashboard in conversation."""
    logger.info(
        "Fetching dashboard for conversation: project_id=%s, conversation_id=%s, user_id=%s",
        project_id,
        conversation_id,
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
    
    # Get the latest dashboard
    dashboards = conversation.get("dashboards", [])
    if not dashboards:
        logger.info(
            "No dashboards present in conversation: project_id=%s, conversation_id=%s",
            project_id,
            conversation_id,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    
    latest_dashboard = dashboards[-1]
    dashboard_id = latest_dashboard.get("dashboard_id")
    s3_uri = latest_dashboard.get("s3_uri")
    
    if not dashboard_id or not s3_uri:
        logger.warning(
            "Dashboard metadata incomplete for conversation: project_id=%s, conversation_id=%s, dashboard=%s",
            project_id,
            conversation_id,
            latest_dashboard,
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
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        logger.error(
            "Invalid S3 URI format (missing key) for dashboard: project_id=%s, conversation_id=%s, dashboard_id=%s, s3_uri=%s",
            project_id,
            conversation_id,
            dashboard_id,
            s3_uri,
        )
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
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

        return DashboardDataResponse(
            dashboard_id=dashboard_id,
            dashboard_data=dashboard_data,
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
        raise HTTPException(status_code=500, detail=f"Failed to load dashboard: {str(e)}")


@router.post("/conversation/{conversation_id}/stop", response_model=StopWorkflowResponse)
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
    
    # Update workflow status to stopped
    now_iso = datetime.utcnow().isoformat()
    workflow_nodes_repo.upsert_node_status(
        conversation_id=conversation_id,
        node_id="workflow",
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

