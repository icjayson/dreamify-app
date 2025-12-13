"""
Admin monitoring endpoints for tracking and debugging AnalyzeCSVWorkflow LLM execution.
"""
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.admin_auth import require_admin
from utils.dynamodb.repos import conversations as conversations_repo
from utils.s3.conversations import load_conversation

router = APIRouter(prefix="/admin", tags=["admin"])


class ConversationListItem(BaseModel):
    """Conversation metadata for list view."""
    conversation_id: str
    project_id: str
    user_id: str
    title: str
    created_at: str
    updated_at: str
    s3_bucket: Optional[str] = None
    s3_key: Optional[str] = None


class ConversationDetailResponse(BaseModel):
    """Full conversation JSON response."""
    conversation: Dict[str, Any]


class NodeListResponse(BaseModel):
    """Nodes array response."""
    nodes: List[Dict[str, Any]]


class ConversationListResponse(BaseModel):
    """List of conversations with pagination."""
    conversations: List[ConversationListItem]
    total: int
    last_key: Optional[str] = None


@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations(
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Number of results per page"),
    _: bool = Depends(require_admin),
):
    """
    List all conversations or filter by project_id with pagination.
    
    Returns conversation metadata for tracking and debugging.
    """
    try:
        # Get all conversations (we'll paginate in memory for simplicity)
        all_items = []
        
        if project_id:
            # Filter by project_id - get all matching items
            all_items = conversations_repo.scan_conversations_by_project(project_id, limit=None)
        else:
            # Get all conversations using paginated scan
            all_items = []
            last_key = None
            while True:
                result = conversations_repo.scan_all_conversations(limit=1000, last_evaluated_key=last_key)
                items = result.get("Items", [])
                all_items.extend(items)
                last_key = result.get("LastEvaluatedKey")
                if not last_key:
                    break
        
        # Sort by created_at descending
        all_items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        # Calculate pagination
        total = len(all_items)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = all_items[start_idx:end_idx]
        
        conversations = [
            ConversationListItem(
                conversation_id=item.get("conversation_id", ""),
                project_id=item.get("project_id", ""),
                user_id=item.get("user_id", ""),
                title=item.get("title", "Conversation"),
                created_at=item.get("created_at", ""),
                updated_at=item.get("updated_at", ""),
                s3_bucket=item.get("s3_bucket"),
                s3_key=item.get("s3_key"),
            )
            for item in paginated_items
        ]
        
        return ConversationListResponse(
            conversations=conversations,
            total=total,
            last_key=None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list conversations: {str(e)}")


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation_by_id(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID (required to get conversation from DynamoDB)"),
    _: bool = Depends(require_admin),
):
    """
    Get full conversation JSON by conversation_id.
    
    Loads the complete conversation data from S3 for tracking and debugging.
    """
    try:
        # Get conversation metadata from DynamoDB
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Load full conversation JSON from S3
        s3_bucket = conversation_meta.get("s3_bucket")
        s3_key = conversation_meta.get("s3_key")
        
        if not s3_bucket or not s3_key:
            raise HTTPException(status_code=404, detail="Conversation S3 location not found")
        
        conversation = load_conversation(s3_bucket, s3_key)
        
        return ConversationDetailResponse(conversation=conversation)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load conversation: {str(e)}")


@router.get("/conversations/{conversation_id}/nodes", response_model=NodeListResponse)
async def get_conversation_nodes(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID (required to get conversation from DynamoDB)"),
    _: bool = Depends(require_admin),
):
    """
    Get conversation nodes array.
    
    Returns the nodes array from the conversation JSON showing the full conversation flow.
    """
    try:
        # Get conversation metadata from DynamoDB
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Load full conversation JSON from S3
        s3_bucket = conversation_meta.get("s3_bucket")
        s3_key = conversation_meta.get("s3_key")
        
        if not s3_bucket or not s3_key:
            raise HTTPException(status_code=404, detail="Conversation S3 location not found")
        
        conversation = load_conversation(s3_bucket, s3_key)
        
        # Extract nodes array
        nodes = conversation.get("nodes", [])
        
        return NodeListResponse(nodes=nodes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load conversation nodes: {str(e)}")

