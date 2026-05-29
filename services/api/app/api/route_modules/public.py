"""
Public endpoints for preview access without authentication.
"""
import asyncio
import json
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from clerk_backend_api import Clerk

from app.api.route_modules.user import ProjectResponse, _map_project
from app.api.route_modules.conversation import DashboardDataResponse
from app.dependencies.auth import optional_user
from utils.dynamodb.repos import projects as projects_repo
from utils.dynamodb.repos import conversations as conversations_repo
from utils.s3.conversations import load_conversation
from utils.s3.client import download_bytes
from utils.config import config

logger = logging.getLogger(__name__)

router = APIRouter(tags=["public"])

_clerk_client = Clerk(bearer_auth=config.clerk.CLERK_SECRET_KEY)


async def _get_clerk_email(user_id: str) -> Optional[str]:
    """Resolve primary email for a Clerk user_id. Returns None on any error."""
    try:
        user = await asyncio.to_thread(_clerk_client.users.get, user_id=user_id)
        if user.email_addresses:
            return user.email_addresses[0].email_address
    except Exception:
        pass
    return None


def _check_access(project: dict, user_id: Optional[str], user_email: Optional[str]) -> bool:
    """Return True if user_id/user_email is allowed to view this project."""
    if project.get("is_preview_public", False):
        return True
    owner_id = project.get("user_id")
    if user_id and user_id == owner_id:
        return True
    allowed = project.get("allowed") or []
    for entry in allowed:
        if not isinstance(entry, dict):
            continue
        if user_id and entry.get("user_id") == user_id:
            return True
        if user_email and entry.get("email") == user_email:
            return True
    return False


@router.get("/public/project/{project_id}", response_model=ProjectResponse)
async def get_public_project(
    project_id: str,
    user_id: Optional[str] = Depends(optional_user),
):
    """Get project data for public preview or allowed users."""
    logger.info(f"Public project access request: project_id={project_id}, user_id={user_id}")
    
    # Get project by project_id
    project = projects_repo.get_project_by_id(project_id)
    if not project:
        logger.warning(f"Project not found for public access: project_id={project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if project is public or user is allowed (user_id OR email match)
    user_email = await _get_clerk_email(user_id) if user_id else None
    if not _check_access(project, user_id, user_email):
        logger.warning(
            f"Attempted public access to private project without permission: project_id={project_id}, user_id={user_id}"
        )
        raise HTTPException(status_code=403, detail="Project preview is not public")

    return _map_project(project)


@router.get("/public/conversation/{conversation_id}/dashboard", response_model=DashboardDataResponse)
async def get_public_conversation_dashboard(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID"),
    dashboard_id: Optional[str] = Query(None, description="Specific dashboard ID to fetch"),
    user_id: Optional[str] = Depends(optional_user),
):
    """Get dashboard data for public preview or allowed users."""
    logger.info(
        f"Public dashboard access request: project_id={project_id}, conversation_id={conversation_id}, dashboard_id={dashboard_id}, user_id={user_id}"
    )
    
    # Verify project exists
    project = projects_repo.get_project_by_id(project_id)
    if not project:
        logger.warning(f"Project not found for public dashboard access: project_id={project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    
    user_email = await _get_clerk_email(user_id) if user_id else None
    if not _check_access(project, user_id, user_email):
        logger.warning(
            f"Attempted dashboard access to private project without permission: project_id={project_id}, user_id={user_id}"
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

