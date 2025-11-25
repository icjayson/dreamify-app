"""
Morpheus workflow integration endpoints.
"""
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.dependencies.auth import require_user
from utils.config import config
from utils.dynamodb.repos import conversations as conversations_repo
from utils.dynamodb.repos import projects as projects_repo
from utils.dynamodb.repos import workflow_nodes as workflow_nodes_repo
from utils.logger import logger

router = APIRouter(tags=["morpheus"])


class NodeStatusResponse(BaseModel):
    conversation_id: str
    node_id: str
    status: str
    metadata: Dict
    updated_at: Optional[str] = None


class NodeStatusListResponse(BaseModel):
    nodes: List[NodeStatusResponse]


class NodeStatusUpdateRequest(BaseModel):
    conversation_id: str
    node_id: str
    status: str
    metadata: Optional[Dict] = None


class ProcessedKeyUpdateRequest(BaseModel):
    processed_json_s3_key: str


class MorpheusAssetResponse(BaseModel):
    asset_id: str
    file_id: str
    user_id: str
    project_id: str
    s3_bucket: str
    s3_key: str
    status: str
    processed_json_s3_key: Optional[str] = None
    filename: Optional[str] = None
    extension: Optional[str] = None


class ProjectMetadataUpdateRequest(BaseModel):
    user_id: str
    name: Optional[str] = None
    description: Optional[str] = None
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None


def _map_node(item: Dict) -> NodeStatusResponse:
    logger.info(f"Mapping node: {item}")
    return NodeStatusResponse(
        conversation_id=item["conversation_id"],
        node_id=item["node_id"],
        status=item.get("status", ""),
        metadata=item.get("metadata", {}),
        updated_at=item.get("updated_at"),
    )


def _ensure_morpheus_key(header: Optional[str]) -> None:
    expected_key = config.app.secret_key
    if not header or header != expected_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


# Deprecated: Use workflow-status endpoint instead
# Keeping for backward compatibility but should use workflow-status
@router.get("/morpheus/node-status", response_model=NodeStatusListResponse)
async def list_node_status(
    conversation_id: str,
    project_id: str,
    node_id: Optional[str] = None,
    user_id: str = Depends(require_user),
):
    conversation = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation or conversation.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if node_id:
        node = workflow_nodes_repo.get_node(conversation_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        return NodeStatusListResponse(nodes=[_map_node(node)])
    nodes = workflow_nodes_repo.list_nodes(conversation_id)
    return NodeStatusListResponse(nodes=[_map_node(item) for item in nodes])


@router.get("/morpheus/workflow-status/{conversation_id}", response_model=NodeStatusResponse)
async def get_workflow_status(
    conversation_id: str,
    project_id: str,
    user_id: str = Depends(require_user),
):
    conversation = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation or conversation.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    node = workflow_nodes_repo.get_node(conversation_id, "workflow")
    if not node:
        raise HTTPException(status_code=404, detail="Workflow status not found")
    return _map_node(node)


@router.post("/morpheus/workflow-status", response_model=NodeStatusResponse)
async def upsert_workflow_status(
    request: NodeStatusUpdateRequest,
):
    item = workflow_nodes_repo.upsert_node_status(
        conversation_id=request.conversation_id,
        node_id=request.node_id,
        status=request.status,
        metadata=request.metadata,
    )
    return _map_node(item)


@router.put("/morpheus/asset/{asset_id}/processed-key")
async def update_asset_processed_key(
    asset_id: str,
    request: ProcessedKeyUpdateRequest,
):
    from utils.dynamodb.repos import assets as assets_repo
    asset = assets_repo.set_processed_json_key_by_asset_id(
        asset_id=asset_id,
        processed_key=request.processed_json_s3_key,
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"success": True}


@router.get("/morpheus/asset/{asset_id}", response_model=MorpheusAssetResponse)
async def get_asset_for_morpheus(
    asset_id: str,
):
    from utils.dynamodb.repos import assets as assets_repo
    asset = assets_repo.get_asset_by_id(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return MorpheusAssetResponse(
        asset_id=asset["asset_id"],
        file_id=asset.get("file_id", asset["asset_id"]),
        user_id=asset["user_id"],
        project_id=asset["project_id"],
        s3_bucket=asset["s3_bucket"],
        s3_key=asset["s3_key"],
        status=asset.get("status", ""),
        processed_json_s3_key=asset.get("processed_json_s3_key"),
        filename=asset.get("filename"),
        extension=asset.get("extension"),
    )


@router.put("/morpheus/project/{project_id}/metadata")
async def update_project_metadata(
    project_id: str,
    request: ProjectMetadataUpdateRequest,
    x_morpheus_key: Optional[str] = Header(None),
):
    _ensure_morpheus_key(x_morpheus_key)
    if not request.user_id:
        raise HTTPException(status_code=400, detail="user_id is required")

    updated_project = projects_repo.update_project(
        user_id=request.user_id,
        project_id=project_id,
        name=request.name,
        description=request.description,
        latest_conversation_id=request.latest_conversation_id,
        latest_dashboard_id=request.latest_dashboard_id,
        dashboard_title=request.dashboard_title,
    )
    if not updated_project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


