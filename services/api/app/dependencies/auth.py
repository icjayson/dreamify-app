"""
Authentication dependencies for FastAPI routes.
"""
import logging
from typing import Optional
from fastapi import Request, HTTPException, status
from utils.clerk_auth import clerk_auth_jwt

logger = logging.getLogger(__name__)


def require_user(request: Request) -> str:
    """
    FastAPI dependency to require authenticated user.
    
    Extracts and verifies Clerk JWT token from Authorization header.
    
    Returns:
        Clerk user ID (str) from token payload 'sub' claim
        
    Raises:
        HTTPException: If token is missing or invalid
    """
    # Get full payload from Clerk authentication
    payload = clerk_auth_jwt(request)
    
    # Extract user ID from payload
    user_id = payload.get('sub')
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user ID",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user_id


def optional_user(request: Request) -> Optional[str]:
    """
    FastAPI dependency for optional authentication.
    
    Returns Clerk user ID if a valid Bearer token is present, None otherwise.
    Never raises — suitable for endpoints that serve both public and authenticated users.
    """
    try:
        payload = clerk_auth_jwt(request)
        return payload.get('sub')
    except Exception:
        # If there's no auth header, invalid token, etc., we gracefully return None
        return None


def require_admin(request: Request) -> dict:
    """
    FastAPI dependency to require admin authentication via Clerk SDK JWT claims.
    
    Reads user's public_metadata directly from the JWT payload.
    Ensures zero extra latency by avoiding Clerk API calls.
    """
    payload = clerk_auth_jwt(request)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user ID",
        )

    # 2. Check admin role
    if payload.get("role") != "admin":
        logger.warning(f"User {user_id} attempted admin access without admin role.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions. Admin role required.",
        )
        
    # 3. Return user context (include email if mapped in JWT template)
    return {
        "user_id": user_id,
        "role": "admin",
    }
