"""
Authentication dependencies for FastAPI routes.
"""
from fastapi import Header, HTTPException, status
from typing import Optional
from app.auth.clerk import verify_clerk_jwt, get_clerk_user_id_from_token


def require_user(authorization: Optional[str] = Header(None)) -> str:
    """
    FastAPI dependency to require authenticated user.
    
    Extracts and verifies Clerk JWT token from Authorization header.
    
    Returns:
        Clerk user ID (str)
        
    Raises:
        HTTPException: If token is missing or invalid
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Extract token from "Bearer <token>"
    try:
        scheme, token = authorization.split(" ", 1)
        if scheme.lower() != "bearer":
            raise ValueError("Invalid authorization scheme")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format. Expected: Bearer <token>",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verify token and get user ID
    try:
        clerk_user_id = get_clerk_user_id_from_token(token)
        return clerk_user_id
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

