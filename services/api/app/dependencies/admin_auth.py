"""
Admin authentication dependencies for FastAPI routes.
"""
import base64
import logging
from fastapi import Request, HTTPException, status
from utils.config import config
from utils.admin_auth import verify_password

logger = logging.getLogger(__name__)


def require_admin(request: Request) -> bool:
    """
    FastAPI dependency to require admin authentication.
    
    Extracts and verifies Basic Auth credentials from Authorization header.
    
    Returns:
        True if authentication successful
        
    Raises:
        HTTPException: If credentials are missing or invalid
    """
    if not config.admin:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin configuration not found"
        )
    
    # Extract Authorization header
    authorization = request.headers.get("Authorization")
    
    # DEBUG: logging for inspection
    logger.debug(f"URL: {request.url} | Header: {authorization}")

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
        )
    
    # Extract credentials from "Basic <base64_encoded_credentials>"
    try:
        scheme, encoded = authorization.split(" ", 1)
        if scheme.lower() != "basic":
            raise ValueError("Invalid authorization scheme")
        
        # Decode base64 credentials
        decoded = base64.b64decode(encoded).decode("utf-8")
        username, password = decoded.split(":", 1)
        logger.debug(f"Parsed: user='{username}', pass='{password}'")
    except (ValueError, UnicodeDecodeError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format. Expected: Basic <base64_encoded_credentials>",
        )
    
    # Verify credentials against list of admins
    admins = config.admin.admins if config.admin else []
    admin_found = None
    
    for admin in admins:
        if admin.get("username") == username:
            admin_found = admin
            break
    
    if not admin_found:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    
    if not verify_password(password, admin_found.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    
    return True

