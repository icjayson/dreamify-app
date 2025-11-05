"""
Clerk JWT verification utilities.
"""
import os
import jwt
import requests
from typing import Dict, Optional
from datetime import datetime, timedelta
from fastapi import HTTPException, status
from cachetools import TTLCache

# Cache for JWKS (1 hour TTL)
jwks_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)

# Get Clerk domain from environment or use default
CLERK_DOMAIN = os.getenv("CLERK_DOMAIN", "clerk.accounts.dev")
CLERK_FRONTEND_API = os.getenv("CLERK_FRONTEND_API", "")


def get_clerk_jwks() -> Dict:
    """Fetch and cache Clerk JWKS."""
    # Check cache first
    if "jwks" in jwks_cache:
        return jwks_cache["jwks"]
    
    # Construct JWKS URL
    # Format: https://{tenant}.clerk.accounts.dev/.well-known/jwks.json
    # Or: https://clerk.{tenant}.lcl.dev/.well-known/jwks.json for local
    if CLERK_FRONTEND_API:
        # Use the frontend API domain
        jwks_url = f"https://{CLERK_FRONTEND_API}/.well-known/jwks.json"
    else:
        # Fallback to default format
        jwks_url = f"https://{CLERK_DOMAIN}/.well-known/jwks.json"
    
    try:
        response = requests.get(jwks_url, timeout=10)
        response.raise_for_status()
        jwks = response.json()
        jwks_cache["jwks"] = jwks
        return jwks
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch Clerk JWKS: {str(e)}"
        )


def get_jwks_key(jwks: Dict, kid: str) -> Optional[Dict]:
    """Get the key from JWKS by key ID."""
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def verify_clerk_jwt(token: str) -> Dict:
    """
    Verify Clerk JWT token and return claims.
    
    Args:
        token: JWT token string
        
    Returns:
        Decoded JWT claims
        
    Raises:
        HTTPException: If token is invalid
    """
    try:
        # Decode header to get key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        
        if not kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing key ID"
            )
        
        # Get JWKS
        jwks = get_clerk_jwks()
        
        # Find the key
        key = get_jwks_key(jwks, kid)
        if not key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: key not found"
            )
        
        # Construct RSA public key from JWK
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend
        import base64
        
        # Convert JWK to RSA public key
        n = base64.urlsafe_b64decode(key["n"] + "==")
        e = base64.urlsafe_b64decode(key["e"] + "==")
        
        n_int = int.from_bytes(n, "big")
        e_int = int.from_bytes(e, "big")
        
        public_key = rsa.RSAPublicNumbers(e_int, n_int).public_key(default_backend())
        
        # Serialize to PEM format
        pem_public_key = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        
        # Verify and decode token
        # Clerk tokens typically have "iss" claim with Clerk domain
        # We'll verify without issuer check for now, but you can add it
        claims = jwt.decode(
            token,
            pem_public_key,
            algorithms=["RS256"],
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
            }
        )
        
        return claims
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {str(e)}"
        )


def get_clerk_user_id_from_token(token: str) -> str:
    """
    Extract Clerk user ID from token.
    
    Args:
        token: JWT token string
        
    Returns:
        Clerk user ID (sub claim)
    """
    claims = verify_clerk_jwt(token)
    clerk_user_id = claims.get("sub")
    
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user ID"
        )
    
    return clerk_user_id

