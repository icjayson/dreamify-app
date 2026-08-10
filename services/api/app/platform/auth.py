"""Clerk JWT authentication with an explicitly gated demo bootstrap mode."""

import re
import secrets
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, Optional

import jwt
from fastapi import Depends, Request
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from app.platform.database import (
    ensure_database_write_capacity,
    get_runtime_settings,
    get_session,
)
from app.platform.errors import ApiError
from app.platform.models import AppUser
from app.platform.repositories import UserRepository
from app.platform.settings import Settings

DEMO_USER_PATTERN = re.compile(r"^[A-Za-z0-9_.:@-]{1,128}$")
MAX_CLERK_SUBJECT_LENGTH = 255
MAX_CLERK_EMAIL_LENGTH = 320
MAX_CLERK_NAME_LENGTH = 160
CLERK_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+$")


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None


@lru_cache(maxsize=8)
def jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(url, cache_keys=True)


def _bearer_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "AUTH_REQUIRED", "A valid bearer token is required")
    return token


def _decode_token(token: str, settings: Settings) -> Dict[str, Any]:
    key: Any = settings.clerk_jwt_public_key
    if key:
        key = key.replace("\\n", "\n")
    elif settings.clerk_jwks_url:
        key = jwks_client(settings.clerk_jwks_url).get_signing_key_from_jwt(token).key
    options = {
        "require": ["exp", "sub"],
        "verify_aud": bool(settings.clerk_audience),
        "verify_iss": bool(settings.clerk_issuer),
    }
    return jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        audience=settings.clerk_audience,
        issuer=settings.clerk_issuer,
        options=options,
    )


def _optional_display_name(claims: Dict[str, Any]) -> Optional[str]:
    candidates = (claims.get("name"), claims.get("fullName"))
    provided = [candidate for candidate in candidates if candidate is not None]
    for candidate in provided:
        if (
            isinstance(candidate, str)
            and candidate.strip()
            and len(candidate.strip()) <= MAX_CLERK_NAME_LENGTH
        ):
            return candidate.strip()
    if provided:
        raise ApiError(
            401,
            "AUTH_NAME_CLAIM_INVALID",
            "Optional Clerk name claim is invalid",
        )
    return None


def _optional_email(claims: Dict[str, Any]) -> Optional[str]:
    """Accept Clerk's default token while validating a configured email claim."""

    email = claims.get("email")
    if email is None:
        return None
    if (
        not isinstance(email, str)
        or not email.strip()
        or len(email.strip()) > MAX_CLERK_EMAIL_LENGTH
        or not CLERK_EMAIL_PATTERN.fullmatch(email.strip())
    ):
        raise ApiError(
            401,
            "AUTH_EMAIL_CLAIM_INVALID",
            "Optional Clerk email claim is invalid",
        )
    return email.strip().lower()


def _principal_from_claims(claims: Dict[str, Any], settings: Settings) -> Principal:
    authorized_parties = settings.clerk_authorized_parties
    if authorized_parties and claims.get("azp") not in authorized_parties:
        raise ApiError(401, "AUTH_INVALID", "Token authorized party is not allowed")
    user_id = claims.get("sub")
    if (
        not isinstance(user_id, str)
        or not user_id.strip()
        or len(user_id.strip()) > MAX_CLERK_SUBJECT_LENGTH
    ):
        raise ApiError(401, "AUTH_INVALID", "Token subject is missing")
    return Principal(
        user_id=user_id.strip(),
        email=_optional_email(claims),
        display_name=_optional_display_name(claims),
    )


def get_principal(
    request: Request,
    settings: Settings = Depends(get_runtime_settings),
) -> Principal:
    if settings.demo_auth_mode:
        user_id = request.headers.get("x-demo-user", "")
        if not DEMO_USER_PATTERN.fullmatch(user_id):
            raise ApiError(
                401, "DEMO_USER_REQUIRED", "X-Demo-User is required in demo mode"
            )
        return Principal(user_id=user_id)
    try:
        return _principal_from_claims(
            _decode_token(_bearer_token(request), settings), settings
        )
    except ApiError:
        raise
    except jwt.PyJWTError as exc:
        raise ApiError(401, "AUTH_INVALID", "Bearer token is invalid") from exc
    except Exception as exc:
        raise ApiError(
            503, "AUTH_UNAVAILABLE", "Authentication keys are unavailable"
        ) from exc


def get_current_user(
    principal: Principal = Depends(get_principal),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
) -> AppUser:
    return _ensure_current_user(principal, session, settings)


def _ensure_current_user(
    principal: Principal, session: Session, settings: Settings
) -> AppUser:
    current = session.get(AppUser, principal.user_id)
    normalized_email = principal.email.strip().lower() if principal.email else None
    identity_changed = current is None or (
        (normalized_email and current.email != normalized_email)
        or (principal.display_name and current.display_name != principal.display_name)
    )
    if identity_changed:
        ensure_database_write_capacity(session, settings)
    return UserRepository(session).ensure(
        principal.user_id,
        email=principal.email,
        display_name=principal.display_name,
    )


def get_optional_current_user(
    request: Request,
    settings: Settings = Depends(get_runtime_settings),
    session: Session = Depends(get_session),
) -> Optional[AppUser]:
    """Resolve a supplied identity while keeping public capability reads public."""

    auth_header = "x-demo-user" if settings.demo_auth_mode else "authorization"
    if not request.headers.get(auth_header):
        return None
    principal = get_principal(request, settings)
    return _ensure_current_user(principal, session, settings)


def require_owner_admin(
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
) -> AppUser:
    """Allow only an explicitly configured owner identity; fail closed."""

    allowed = set(settings.owner_admin_allowlist)
    identities = {user.id.strip().lower()}
    if user.email:
        identities.add(user.email.strip().lower())
    if not allowed or identities.isdisjoint(allowed):
        raise ApiError(
            403,
            "OWNER_ADMIN_REQUIRED",
            "Owner administrator access is required",
        )
    return user


def require_blob_gateway(
    request: Request,
    settings: Settings = Depends(get_runtime_settings),
) -> None:
    expected = settings.blob_gateway_shared_secret
    supplied = request.headers.get("x-blob-gateway-secret")
    if not expected or not supplied or not secrets.compare_digest(expected, supplied):
        raise ApiError(
            401, "GATEWAY_AUTH_INVALID", "Blob gateway authentication failed"
        )


def require_internal_service(
    request: Request,
    settings: Settings = Depends(get_runtime_settings),
) -> None:
    expected = settings.internal_service_shared_secret
    supplied = request.headers.get("x-internal-service-secret")
    if not expected or not supplied or not secrets.compare_digest(expected, supplied):
        raise ApiError(
            401,
            "SERVICE_AUTH_INVALID",
            "Internal service authentication failed",
        )
