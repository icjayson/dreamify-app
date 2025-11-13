"""
Authentication dependencies for FastAPI routes.
"""
from fastapi import Request, HTTPException, status, Depends
from utils.clerk_auth import clerk_auth_jwt


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
