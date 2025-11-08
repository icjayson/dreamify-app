"""
Authentication dependencies for FastAPI routes.
"""
from fastapi import Header, HTTPException, status, Query
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


def require_user_header_or_query_token(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
) -> str:
    """
    Require authenticated user via Authorization header or 'token' query parameter.
    - If Authorization: Bearer <token> is present, verify and return user id.
    - Else if token query param is present, verify and return user id.
    - Else 401.
    """
    # Try header first
    if authorization:
        try:
            scheme, bearer = authorization.split(" ", 1)
            if scheme.lower() != "bearer":
                raise ValueError("Invalid authorization scheme")
            return get_clerk_user_id_from_token(bearer)
        except Exception as e:
            # Fall through to query token if provided
            if not token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Authentication failed: {str(e)}",
                    headers={"WWW-Authenticate": "Bearer"},
                )

    # Fallback to query token
    if token:
        try:
            return get_clerk_user_id_from_token(token)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Authentication failed: {str(e)}",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Nothing provided
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authorization header or token query parameter required",
        headers={"WWW-Authenticate": "Bearer"},
    )

