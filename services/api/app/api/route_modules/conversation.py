"""
Conversation management endpoints.
"""
import uuid
import time
import asyncio
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
from utils.s3.conversations import save_conversation, load_conversation
from utils.s3.paths import build_conversation_key
from utils.s3.client import download_bytes

router = APIRouter(tags=["conversation"])

MORPHEUS_SERVICE_URL = "http://localhost:8000"


def _conversation_keys(user_id: str, project_id: str, conversation_id: str) -> Dict[str, str]:
    primary = build_conversation_key(user_id, project_id, conversation_id, backup=False)
    backup = build_conversation_key(user_id, project_id, conversation_id, backup=True)
    return {"primary": primary, "backup": backup}


class ConversationChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    project_id: str
    asset_id: str
    user_node_contents: List[Dict[str, Any]]


class ConversationChatResponse(BaseModel):
    conversation_id: str
    project_id: str
    asset_id: str
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


def _update_conversation_with_user_node(conversation: Dict[str, Any], user_node: Dict[str, Any]) -> Dict[str, Any]:
    """Append user node and update timestamps."""
    conversation.setdefault("nodes", []).append(user_node)
    conversation["updated_at"] = datetime.utcnow().isoformat()
    return conversation


def _save_conversation_to_s3_and_dynamodb(
    user_id: str,
    project_id: str,
    conversation_id: str,
    conversation: Dict[str, Any],
    conversation_bucket: str,
    conversation_keys: Dict[str, str],
    asset_id: str,
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
            metadata={"asset_id": asset_id},
            conversation_id=conversation_id,
        )
    else:
        # Update existing conversation metadata
        conversations_repo.update_conversation_metadata(
            project_id=project_id,
            conversation_id=conversation_id,
            metadata={"asset_id": asset_id},
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

    asset = assets_repo.get_asset(user_id, request.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    assets_repo.update_asset_status(user_id, request.asset_id, "processing")

    conversation_bucket = config.aws.s3.USER_ASSETS_BUCKET
    now_iso = datetime.utcnow().isoformat()
    
    user_node = _create_user_node(request.user_node_contents)
    
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
            "asset": {
                "asset_id": asset["asset_id"],
                "file_id": asset.get("file_id"),
                "s3_bucket": asset["s3_bucket"],
                "s3_key": asset["s3_key"],
                "extension": asset.get("extension"),
                "filename": asset.get("filename"),
            },
            "project": {
                "project_id": request.project_id,
                "user_id": user_id,
            },
        }
        
        conversation = {
            "user_id": user_id,
            "project_id": request.project_id,
            "conversation_id": conversation_id,
            "asset_id": request.asset_id,
            "created_at": now_iso,
            "updated_at": now_iso,
            "metadata": metadata,
            "nodes": [user_node],
            "dashboards": [],
        }
    
    _save_conversation_to_s3_and_dynamodb(
        user_id=user_id,
        project_id=request.project_id,
        conversation_id=conversation_id,
        conversation=conversation,
        conversation_bucket=conversation_bucket,
        conversation_keys=conversation_keys,
        asset_id=request.asset_id,
        is_new=is_new_conversation,
    )

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
        asset_id=request.asset_id,
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
    dashboard_id: str
    dashboard_data: Dict[str, Any]


@router.get("/conversation/{conversation_id}/dashboard", response_model=DashboardDataResponse)
async def get_conversation_dashboard(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    """Get dashboard data from the latest dashboard in conversation."""
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_meta.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)
    
    # Get the latest dashboard
    dashboards = conversation.get("dashboards", [])
    if not dashboards:
        raise HTTPException(status_code=404, detail="No dashboard found in conversation")
    
    latest_dashboard = dashboards[-1]
    dashboard_id = latest_dashboard.get("dashboard_id")
    s3_uri = latest_dashboard.get("s3_uri")
    
    if not dashboard_id or not s3_uri:
        raise HTTPException(status_code=404, detail="Dashboard metadata incomplete")
    
    # Parse s3://bucket/key format
    if not s3_uri.startswith("s3://"):
        raise HTTPException(status_code=400, detail="Invalid S3 URI format")
    
    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid S3 URI format")
    
    bucket = uri_parts[0]
    key = uri_parts[1].lstrip("/")
    
    try:
        dashboard_bytes = download_bytes(bucket, key)
        dashboard_data = json.loads(dashboard_bytes.decode("utf-8"))
        
        return DashboardDataResponse(
            dashboard_id=dashboard_id,
            dashboard_data=dashboard_data,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Dashboard data not found in S3")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load dashboard: {str(e)}")

