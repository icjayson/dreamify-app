"""
Clerk JWT authentication using official Clerk SDK.
"""
from fastapi import Request, HTTPException, status
from clerk_backend_api import Clerk
from clerk_backend_api.security import authenticate_request
from clerk_backend_api.security.types import AuthenticateRequestOptions
from utils.config import config


def clerk_auth_jwt(request: Request):
    """
    Authenticate request using Clerk JWT token from Authorization header.
    
    Args:
        request: FastAPI Request object
        
    Returns:
        dict: Full JWT payload from Clerk
        
    Raises:
        HTTPException: If token is missing, invalid, or user is not signed in
    """
    # Get Clerk configuration
    jwt_key = config.clerk.CLERK_JWT_KEY
    secret_key = config.clerk.CLERK_SECRET_KEY
    
    # Initialize Clerk client
    clerk = Clerk()
    
    # Extract Authorization header
    authorization = request.headers.get("Authorization")
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
    
    # Create a request-like object for Clerk SDK
    class ClerkRequest:
        def __init__(self, auth_header: str):
            self.headers = {"Authorization": auth_header}
        
        def header(self, name: str):
            return self.headers.get(name)
    
    clerk_req = ClerkRequest(authorization)
    
    # Authenticate request using Clerk SDK
    try:
        state = clerk.authenticate_request(
            clerk_req,
            AuthenticateRequestOptions(
                jwt_key=jwt_key,
                authorized_parties=None
            )
        )
        
        if not state.is_signed_in:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not signed in or token invalid",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return state.payload
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )





