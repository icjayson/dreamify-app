"""
FastAPI authentication routes for Clerk integration.
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from utils.postgres.db import get_db
from utils.postgres.repos import users, sessions, projects
from app.dependencies.auth import require_user
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class SessionResponse(BaseModel):
    """Response model for session endpoint."""
    success: bool
    user_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None
    clerk_session_id: Optional[str] = None


class AccountResponse(BaseModel):
    """Response model for account endpoint."""
    success: bool
    user_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None
    projects_count: int = 0


@router.post("/session", response_model=SessionResponse, tags=["auth"])
async def create_session(
    request: Request,
    db: Session = Depends(get_db),
    clerk_user_id: str = Depends(require_user)
):
    """
    Create or update user session.
    
    This endpoint:
    1. Verifies the Clerk JWT token (done by require_user dependency)
    2. Upserts user in database
    3. Creates a session record
    4. Returns user information
    """
    try:
        # Get user info from Clerk token (we already have clerk_user_id from require_user)
        # For now, we'll extract basic info - in production, you might want to fetch from Clerk API
        # or include it in the JWT claims
        
        # Extract IP and user agent from request
        ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        
        # Get or create user
        # Note: In production, you should fetch full user details from Clerk API
        # For now, we'll create with minimal info
        user = users.get_or_create_user_by_clerk_id(
            db=db,
            clerk_user_id=clerk_user_id
        )
        
        # Create session
        # We need to get the session ID from Clerk token claims
        # For now, we'll use a placeholder - you should extract sid from JWT claims
        clerk_session_id = f"session_{clerk_user_id}_{int(datetime.utcnow().timestamp())}"
        
        session = sessions.create_session(
            db=db,
            user_id=clerk_user_id,
            clerk_session_id=clerk_session_id,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        return SessionResponse(
            success=True,
            user_id=user.id,
            email=user.email,
            name=user.name,
            image_url=user.image_url,
            clerk_session_id=session.clerk_session_id
        )
        
    except Exception as e:
        logger.error(f"Error in create_session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/account", response_model=AccountResponse, tags=["auth"])
async def get_account(
    db: Session = Depends(get_db),
    clerk_user_id: str = Depends(require_user)
):
    """
    Get current user account information.
    
    Returns user profile and basic statistics.
    """
    try:
        user = users.get_user(db=db, clerk_user_id=clerk_user_id)
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get user's projects count
        user_projects = projects.get_projects_for_user(db=db, user_id=clerk_user_id)
        projects_count = len(user_projects)
        
        return AccountResponse(
            success=True,
            user_id=user.id,
            email=user.email,
            name=user.name,
            image_url=user.image_url,
            projects_count=projects_count
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_account: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

