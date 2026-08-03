"""
FastAPI waitlist routes for checking waitlist status via Clerk API.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from urllib.parse import quote
import requests
import logging
from utils.config import config

logger = logging.getLogger(__name__)

router = APIRouter()


class WaitlistStatusResponse(BaseModel):
    """Response model for waitlist status endpoint."""
    success: bool
    status: str
    message: str
    email: str
    invitation_id: Optional[str] = None
    waitlist_entry_id: Optional[str] = None
    can_login: bool = False
    action_required: Optional[str] = None


@router.get("/status", response_model=WaitlistStatusResponse, tags=["waitlist"])
async def check_waitlist_status(email: str = Query(..., description="Email address to check")):
    """
    Check waitlist status for a given email address.
    
    This endpoint:
    1. Checks Clerk users API (if user exists, they can login)
    2. Checks Clerk invitations API
    3. If no invitation, checks Clerk waitlist_entries API
    4. Returns detailed status information
    """
    try:
        # Get Clerk API key
        clerk_api_key = config.clerk.CLERK_SECRET_KEY
        
        # URL encode email
        email_encoded = quote(email)
        headers = {"Authorization": f"Bearer {clerk_api_key}"}
        
        # Step 1: Check users (if user exists, they can login)
        users_url = f"https://api.clerk.dev/v1/users?query={email_encoded}"
        
        try:
            users_resp = requests.get(users_url, headers=headers)
            users_resp.raise_for_status()
            users_data = users_resp.json()
            
            # Check if any user exists
            if isinstance(users_data, list) and len(users_data) > 0:
                user = users_data[0]
                user_id = user.get("id", "")
                
                return WaitlistStatusResponse(
                    success=True,
                    status="accepted",
                    message="You can login now",
                    email=email,
                    invitation_id=user_id,
                    can_login=True,
                    action_required="Login and try Dreamify now"
                )
        except requests.exceptions.RequestException as e:
            logger.error(f"Error checking users: {str(e)}")
            # Continue to check invitations
        
        # Step 2: Check invitations
        invitations_url = f"https://api.clerk.dev/v1/invitations?query={email_encoded}"
        
        try:
            invitations_resp = requests.get(invitations_url, headers=headers)
            invitations_resp.raise_for_status()
            invitations_data = invitations_resp.json()
            
            # Check if any invitation exists
            if isinstance(invitations_data, list) and len(invitations_data) > 0:
                invitation = invitations_data[0]
                invitation_status = invitation.get("status", "")
                invitation_id = invitation.get("id", "")
                
                if invitation_status == "accepted":
                    return WaitlistStatusResponse(
                        success=True,
                        status="accepted",
                        message="You can login now",
                        email=email,
                        invitation_id=invitation_id,
                        can_login=True,
                        action_required="Login and try Dreamify now"
                    )
                elif invitation_status == "pending":
                    return WaitlistStatusResponse(
                        success=True,
                        status="pending_invitation",
                        message="Invitation sent",
                        email=email,
                        invitation_id=invitation_id,
                        can_login=False,
                        action_required="Please check your email (including spam folder) to activate account"
                    )
                elif invitation_status == "revoked":
                    return WaitlistStatusResponse(
                        success=True,
                        status="revoked",
                        message="Invitation revoked",
                        email=email,
                        invitation_id=invitation_id,
                        can_login=False,
                        action_required="Your invitation has been revoked. Please wait for new invitation"
                    )
        except requests.exceptions.RequestException as e:
            logger.error(f"Error checking invitations: {str(e)}")
            # Continue to check waitlist_entries
        
        # Step 3: Check waitlist_entries
        waitlist_url = f"https://api.clerk.dev/v1/waitlist_entries?query={email_encoded}"
        
        try:
            waitlist_resp = requests.get(waitlist_url, headers=headers)
            waitlist_resp.raise_for_status()
            waitlist_data = waitlist_resp.json()
            
            # Check if any waitlist entry exists
            if isinstance(waitlist_data, dict) and "data" in waitlist_data:
                entries = waitlist_data.get("data", [])
                if len(entries) > 0:
                    entry = entries[0]
                    entry_status = entry.get("status", "")
                    entry_id = entry.get("id", "")
                    
                    # Check if entry has invitation
                    invitation = entry.get("invitation")
                    if invitation and invitation.get("status") == "accepted":
                        return WaitlistStatusResponse(
                            success=True,
                            status="accepted",
                            message="You can login now",
                            email=email,
                            waitlist_entry_id=entry_id,
                            invitation_id=invitation.get("id"),
                            can_login=True,
                            action_required="Login and try Dreamify now"
                        )
                    
                    if entry_status == "pending":
                        return WaitlistStatusResponse(
                            success=True,
                            status="pending_waitlist",
                            message="Waiting for acceptance",
                            email=email,
                            waitlist_entry_id=entry_id,
                            can_login=False,
                            action_required="You are in waitlist, please wait for invitation from Dreamify and check your mail frequently"
                        )
                    elif entry_status == "rejected":
                        return WaitlistStatusResponse(
                            success=True,
                            status="rejected",
                            message="Application rejected",
                            email=email,
                            waitlist_entry_id=entry_id,
                            can_login=False,
                            action_required="Your application for waitlist has been rejected by Dreamify"
                        )
        except requests.exceptions.RequestException as e:
            logger.error(f"Error checking waitlist entries: {str(e)}")
        
        # Step 4: Nothing found
        return WaitlistStatusResponse(
            success=True,
            status="not_found",
            message="Email not found",
            email=email,
            can_login=False,
            action_required="Email not found. Join the waitlist below"
        )
        
    except Exception as e:
        logger.error(f"Error in check_waitlist_status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

