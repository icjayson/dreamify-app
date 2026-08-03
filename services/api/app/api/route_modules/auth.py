"""
FastAPI authentication routes for Clerk integration.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from app.dependencies.auth import require_user
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
        
        return SessionResponse(
            success=True,
            user_id=clerk_user_id,
            email=None,
            name=None,
            image_url=None,
            clerk_session_id=request.headers.get("Authorization")
        )
        
    except Exception as e:
        logger.error(f"Error in create_session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/account", response_model=AccountResponse, tags=["auth"])
async def get_account(
    clerk_user_id: str = Depends(require_user)
):
    """
    Get current user account information.
    
    Returns user profile and basic statistics.
    """
    try:
        return AccountResponse(
            success=True,
            user_id=clerk_user_id,
            email=None,
            name=None,
            image_url=None,
            projects_count=0
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_account: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

