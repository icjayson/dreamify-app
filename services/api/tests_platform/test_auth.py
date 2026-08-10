import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import func, select

from app.main import create_app
from app.platform.models import AppUser
from app.platform.settings import Settings

MISSING = object()


def signing_keys() -> tuple[bytes, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem.decode("utf-8")


def token(
    private_key: bytes,
    authorized_party: str,
    *,
    email: Any = "person@example.test",
    name: Any = MISSING,
    full_name: Any = MISSING,
    audience: Any = MISSING,
) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": "user_clerk_123",
        "iss": "https://clerk.example.test",
        "azp": authorized_party,
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    if email is not MISSING:
        claims["email"] = email
    if name is not MISSING:
        claims["name"] = name
    if full_name is not MISSING:
        claims["fullName"] = full_name
    if audience is not MISSING:
        claims["aud"] = audience
    return jwt.encode(claims, private_key, algorithm="RS256")


def authorization_headers(private_key: bytes, **claims: Any) -> dict[str, str]:
    session_token = token(private_key, "https://app.example.test", **claims)
    return {"Authorization": f"Bearer {session_token}"}


@pytest.mark.anyio
async def test_parallel_first_login_is_an_idempotent_user_upsert(client, app):
    responses = await asyncio.gather(
        *(
            client.get("/api/v1/users/me", headers={"X-Demo-User": "parallel-user"})
            for _ in range(6)
        )
    )

    assert [response.status_code for response in responses] == [200] * 6
    with app.state.database.session() as session:
        count = session.scalar(
            select(func.count())
            .select_from(AppUser)
            .where(AppUser.id == "parallel-user")
        )
    assert count == 1


@pytest.mark.anyio
async def test_clerk_default_session_contract_and_negative_paths(tmp_path: Path):
    private_key, public_key = signing_keys()
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'auth.sqlite'}",
        cors_origins=["https://app.example.test"],
        auto_create_schema=True,
        clerk_jwt_public_key=public_key,
        clerk_issuer="https://clerk.example.test",
        clerk_authorized_parties=["https://app.example.test"],
        local_storage_path=tmp_path / "objects",
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://api.test"
        ) as api:
            missing = await api.get("/api/v1/users/me")
            assert missing.status_code == 401
            valid = await api.get(
                "/api/v1/users/me",
                headers={
                    "Authorization": f"Bearer {token(private_key, 'https://app.example.test')}"
                },
            )
            assert valid.status_code == 200, valid.text
            assert valid.json()["id"] == "user_clerk_123"
            assert valid.json()["email"] == "person@example.test"
            assert valid.json()["display_name"] is None

            default_claims = await api.get(
                "/api/v1/users/me",
                headers=authorization_headers(private_key, email=MISSING),
            )
            assert default_claims.status_code == 200, default_claims.text
            assert default_claims.json()["id"] == "user_clerk_123"
            assert default_claims.json()["email"] == "person@example.test"

            named = await api.get(
                "/api/v1/users/me",
                headers=authorization_headers(private_key, name="Test Person"),
            )
            assert named.status_code == 200, named.text
            assert named.json()["display_name"] == "Test Person"

            full_name = await api.get(
                "/api/v1/users/me",
                headers=authorization_headers(private_key, full_name="Full Name"),
            )
            assert full_name.status_code == 200, full_name.text
            assert full_name.json()["display_name"] == "Full Name"
            wrong_party = await api.get(
                "/api/v1/users/me",
                headers={
                    "Authorization": f"Bearer {token(private_key, 'https://evil.example')}"
                },
            )
            assert wrong_party.status_code == 401
            assert wrong_party.json()["error"]["code"] == "AUTH_INVALID"

            for overrides in (
                {"email": ""},
                {"email": "not-an-email"},
            ):
                invalid_identity = await api.get(
                    "/api/v1/users/me",
                    headers=authorization_headers(private_key, **overrides),
                )
                assert invalid_identity.status_code == 401
                assert (
                    invalid_identity.json()["error"]["code"]
                    == "AUTH_EMAIL_CLAIM_INVALID"
                )

            for invalid_name in ("", "x" * 161, 123):
                invalid_identity = await api.get(
                    "/api/v1/users/me",
                    headers=authorization_headers(private_key, name=invalid_name),
                )
                assert invalid_identity.status_code == 401
                assert (
                    invalid_identity.json()["error"]["code"]
                    == "AUTH_NAME_CLAIM_INVALID"
                )


@pytest.mark.anyio
async def test_clerk_custom_audience_is_verified_only_when_configured(
    tmp_path: Path,
) -> None:
    private_key, public_key = signing_keys()
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'audience.sqlite'}",
        cors_origins=["https://app.example.test"],
        auto_create_schema=True,
        clerk_jwt_public_key=public_key,
        clerk_issuer="https://clerk.example.test",
        clerk_audience="dreamify-api",
        clerk_authorized_parties=["https://app.example.test"],
        local_storage_path=tmp_path / "objects",
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://api.test"
        ) as api:
            matching = await api.get(
                "/api/v1/users/me",
                headers=authorization_headers(private_key, audience="dreamify-api"),
            )
            assert matching.status_code == 200, matching.text

            missing = await api.get(
                "/api/v1/users/me",
                headers={
                    "Authorization": f"Bearer {token(private_key, 'https://app.example.test')}"
                },
            )
            assert missing.status_code == 401
            assert missing.json()["error"]["code"] == "AUTH_INVALID"

            wrong = await api.get(
                "/api/v1/users/me",
                headers=authorization_headers(private_key, audience="another-api"),
            )
            assert wrong.status_code == 401
            assert wrong.json()["error"]["code"] == "AUTH_INVALID"
