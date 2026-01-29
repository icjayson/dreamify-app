"""
Public endpoints for preview access without authentication.
"""
import json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from app.api.route_modules.user import ProjectResponse, _map_project
from app.api.route_modules.conversation import DashboardDataResponse
from utils.dynamodb.repos import projects as projects_repo
from utils.dynamodb.repos import conversations as conversations_repo
from utils.s3.conversations import load_conversation
from utils.s3.client import download_bytes

logger = logging.getLogger(__name__)

router = APIRouter(tags=["public"])


@router.get("/public/project/{project_id}", response_model=ProjectResponse)
async def get_public_project(project_id: str):
    """Get project data for public preview (no authentication required)."""
    logger.info(f"Public project access request: project_id={project_id}")
    
    # Get project by project_id
    project = projects_repo.get_project_by_id(project_id)
    if not project:
        logger.warning(f"Project not found for public access: project_id={project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if project is public
    is_preview_public = project.get("is_preview_public", False)
    if not is_preview_public:
        logger.warning(
            f"Attempted public access to private project: project_id={project_id}"
        )
        raise HTTPException(status_code=403, detail="Project preview is not public")
    
    # Map project to response
    return _map_project(project)


@router.get("/public/conversation/{conversation_id}/dashboard", response_model=DashboardDataResponse)
async def get_public_conversation_dashboard(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID"),
    dashboard_id: Optional[str] = Query(None, description="Specific dashboard ID to fetch"),
):
    """Get dashboard data for public preview (no authentication required)."""
    logger.info(
        f"Public dashboard access request: project_id={project_id}, conversation_id={conversation_id}, dashboard_id={dashboard_id}"
    )
    
    # First verify project is public
    project = projects_repo.get_project_by_id(project_id)
    if not project:
        logger.warning(f"Project not found for public dashboard access: project_id={project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    
    is_preview_public = project.get("is_preview_public", False)
    if not is_preview_public:
        logger.warning(
            f"Attempted public dashboard access to private project: project_id={project_id}"
        )
        raise HTTPException(status_code=403, detail="Project preview is not public")
    
    # Get conversation metadata
    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        logger.warning(
            f"Conversation not found for public dashboard: project_id={project_id}, conversation_id={conversation_id}"
        )
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)
    
    # Get dashboards list
    dashboards = conversation.get("dashboards", [])
    if not dashboards:
        logger.info(
            f"No dashboards present in conversation: project_id={project_id}, conversation_id={conversation_id}"
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    
    # Select specific dashboard if ID provided, otherwise get latest
    if dashboard_id:
        target_dashboard = next((d for d in dashboards if d.get("dashboard_id") == dashboard_id), None)
        if not target_dashboard:
            logger.warning(
                f"Dashboard not found: project_id={project_id}, conversation_id={conversation_id}, dashboard_id={dashboard_id}"
            )
            raise HTTPException(status_code=404, detail=f"Dashboard {dashboard_id} not found")
    else:
        target_dashboard = dashboards[-1]
    
    dashboard_id = target_dashboard.get("dashboard_id")
    s3_uri = target_dashboard.get("s3_uri")
    
    if not dashboard_id or not s3_uri:
        logger.warning(
            f"Dashboard metadata incomplete for conversation: project_id={project_id}, conversation_id={conversation_id}, dashboard={target_dashboard}"
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    
    # Parse s3://bucket/key format
    if not s3_uri.startswith("s3://"):
        logger.error(
            f"Invalid S3 URI format for dashboard: project_id={project_id}, conversation_id={conversation_id}, dashboard_id={dashboard_id}, s3_uri={s3_uri}"
        )
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        logger.error(
            f"Invalid S3 URI format (missing key) for dashboard: project_id={project_id}, conversation_id={conversation_id}, dashboard_id={dashboard_id}, s3_uri={s3_uri}"
        )
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
    bucket = uri_parts[0]
    key = uri_parts[1].lstrip("/")
    
    try:
        dashboard_bytes = download_bytes(bucket, key)
        dashboard_data = json.loads(dashboard_bytes.decode("utf-8"))
        
        logger.info(
            f"Successfully loaded public dashboard from S3: bucket={bucket}, key={key}, dashboard_id={dashboard_id}"
        )

        return DashboardDataResponse(
            dashboard_id=dashboard_id,
            dashboard_data=dashboard_data,
        )
    except FileNotFoundError:
        logger.warning(
            f"Dashboard data not found in S3: bucket={bucket}, key={key}, dashboard_id={dashboard_id}"
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    except Exception as e:
        logger.error(
            f"Failed to load public dashboard from S3: bucket={bucket}, key={key}, dashboard_id={dashboard_id}, error={str(e)}"
        )
        raise HTTPException(status_code=500, detail=f"Failed to load dashboard: {str(e)}")

