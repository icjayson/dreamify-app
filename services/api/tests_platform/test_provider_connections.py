import base64
import logging

import pytest

from app.platform.database import Database
from app.platform.errors import ApiError
from app.platform.models import ProviderConnection
from app.platform.provider_crypto import ProviderSecretCipher, ProviderSecretContext
from app.platform.providers import ProviderCredentialVerifier
from app.platform.settings import Settings


def _accept_provider(
    _self: ProviderCredentialVerifier,
    _provider: str,
    _api_key: str,
    _model: str,
) -> None:
    return None


async def _project(client, headers, name: str) -> str:
    response = await client.post(
        "/api/v1/projects",
        json={"name": name},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _run(client, headers, project_id: str) -> str:
    response = await client.post(
        "/api/v1/workflow-runs",
        json={"project_id": project_id, "input": {"prompt": "hello"}},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.anyio
async def test_provider_connection_is_encrypted_redacted_and_pinned_to_run(
    client,
    auth_headers,
    runtime_settings,
    monkeypatch,
):
    monkeypatch.setattr(ProviderCredentialVerifier, "verify", _accept_provider)
    credential = "local-provider-credential-123456"
    headers = auth_headers("tenant-a")
    configured = await client.put(
        "/api/v1/provider-connections/openai",
        json={"api_key": credential, "model": "gpt-test", "activate": True},
        headers=headers,
    )

    assert configured.status_code == 200
    assert configured.json()["provider"] == "openai"
    assert configured.json()["is_active"] is True
    assert credential not in configured.text
    assert "encrypted_api_key" not in configured.text

    capabilities = await client.get("/api/v1/capabilities", headers=headers)
    assert capabilities.json()["model"] == {
        "mode": "byok",
        "active_provider": "openai",
        "providers": ["demo", "openai"],
    }

    database = Database(runtime_settings)
    with database.session() as session:
        stored = session.query(ProviderConnection).one()
        assert stored.encrypted_api_key.startswith("aesgcm:test-v1:")
        assert credential not in stored.encrypted_api_key
    database.dispose()

    project_id = await _project(client, headers, "Provider project")
    run_id = await _run(client, headers, project_id)
    updated = await client.put(
        "/api/v1/provider-connections/openai",
        json={
            "api_key": "replacement-provider-credential-654321",
            "model": "gpt-replacement",
            "activate": True,
        },
        headers=headers,
    )
    assert updated.status_code == 200
    in_use = await client.delete(
        "/api/v1/provider-connections/openai",
        headers=headers,
    )
    assert in_use.status_code == 409
    assert in_use.json()["error"]["code"] == "PROVIDER_CONNECTION_IN_USE"
    resolved = await client.post(
        f"/api/v1/internal/workflow/runs/{run_id}/provider/resolve",
        json={},
        headers={"X-Internal-Service-Secret": "internal-secret"},
    )
    assert resolved.status_code == 200
    assert resolved.headers["cache-control"] == "no-store, private"
    assert resolved.json() == {
        "mode": "byok",
        "provider": "openai",
        "model": "gpt-test",
        "api_key": credential,
    }
    replacement_run_id = await _run(client, headers, project_id)
    replacement = await client.post(
        f"/api/v1/internal/workflow/runs/{replacement_run_id}/provider/resolve",
        json={},
        headers={"X-Internal-Service-Secret": "internal-secret"},
    )
    assert replacement.json() == {
        "mode": "byok",
        "provider": "openai",
        "model": "gpt-replacement",
        "api_key": "replacement-provider-credential-654321",
    }


@pytest.mark.anyio
async def test_provider_connections_are_tenant_isolated_and_demo_is_default(
    client,
    auth_headers,
    monkeypatch,
):
    monkeypatch.setattr(ProviderCredentialVerifier, "verify", _accept_provider)
    await client.put(
        "/api/v1/provider-connections/gemini",
        json={"api_key": "tenant-a-provider-credential", "activate": True},
        headers=auth_headers("tenant-a"),
    )

    tenant_b = await client.get(
        "/api/v1/provider-connections", headers=auth_headers("tenant-b")
    )
    assert tenant_b.status_code == 200
    assert tenant_b.json()["connections"] == []
    assert tenant_b.json()["model_mode"] == "demo"
    denied = await client.delete(
        "/api/v1/provider-connections/gemini",
        headers=auth_headers("tenant-b"),
    )
    assert denied.status_code == 404

    project_id = await _project(client, auth_headers("tenant-b"), "Demo project")
    run_id = await _run(client, auth_headers("tenant-b"), project_id)
    resolved = await client.post(
        f"/api/v1/internal/workflow/runs/{run_id}/provider/resolve",
        json={},
        headers={"X-Internal-Service-Secret": "internal-secret"},
    )
    assert resolved.json() == {
        "mode": "demo",
        "provider": "demo",
        "model": "deterministic-v1",
        "api_key": None,
    }


@pytest.mark.anyio
async def test_only_one_provider_can_be_active_per_tenant(
    client,
    auth_headers,
    monkeypatch,
):
    monkeypatch.setattr(ProviderCredentialVerifier, "verify", _accept_provider)
    headers = auth_headers("tenant-a")
    for provider in ("openai", "gemini"):
        response = await client.put(
            f"/api/v1/provider-connections/{provider}",
            json={"api_key": f"{provider}-provider-credential", "activate": True},
            headers=headers,
        )
        assert response.status_code == 200

    status = await client.get("/api/v1/provider-connections", headers=headers)
    assert status.headers["cache-control"] == "private, no-store"
    active = [
        item["provider"] for item in status.json()["connections"] if item["is_active"]
    ]
    assert active == ["gemini"]


@pytest.mark.anyio
async def test_activation_fails_closed_when_provider_smoke_test_fails(
    client,
    auth_headers,
    monkeypatch,
):
    monkeypatch.setattr(ProviderCredentialVerifier, "verify", _accept_provider)
    headers = auth_headers("tenant-a")
    for provider, activate in (("openai", True), ("gemini", False)):
        response = await client.put(
            f"/api/v1/provider-connections/{provider}",
            json={
                "api_key": f"{provider}-provider-credential",
                "activate": activate,
            },
            headers=headers,
        )
        assert response.status_code == 200

    def reject(*_args, **_kwargs):
        raise ApiError(
            422,
            "PROVIDER_CREDENTIAL_INVALID",
            "The model provider rejected this credential",
        )

    monkeypatch.setattr(ProviderCredentialVerifier, "verify", reject)
    failed = await client.post(
        "/api/v1/provider-connections/gemini/activate",
        headers=headers,
    )
    assert failed.status_code == 422

    status = await client.get("/api/v1/provider-connections", headers=headers)
    active = [
        item["provider"] for item in status.json()["connections"] if item["is_active"]
    ]
    assert active == ["openai"]


def test_provider_cipher_roundtrip_rotation_and_wrong_key_are_safe():
    old_key = base64.b64encode(b"o" * 32).decode()
    new_key = base64.b64encode(b"n" * 32).decode()
    context = ProviderSecretContext("connection-1", "tenant-a", "openai")
    old_cipher = ProviderSecretCipher({"old": old_key}, "old")
    token = old_cipher.encrypt("private-credential-value", context)
    rotating = ProviderSecretCipher({"old": old_key, "new": new_key}, "new")

    plaintext, needs_rotation = rotating.decrypt(token, context)
    assert plaintext == "private-credential-value"
    assert needs_rotation is True
    with pytest.raises(ApiError) as failure:
        ProviderSecretCipher({"old": new_key}, "old").decrypt(token, context)
    assert failure.value.code == "PROVIDER_SECRET_UNAVAILABLE"
    assert "private-credential-value" not in failure.value.message


def test_provider_keyring_accepts_server_only_vercel_json(monkeypatch):
    encoded_key = base64.b64encode(b"v" * 32).decode()
    monkeypatch.setenv("PROVIDER_ENCRYPTION_KEYS", f'{{"v2":"{encoded_key}"}}')
    monkeypatch.setenv("PROVIDER_CURRENT_KEY_VERSION", "v2")

    settings = Settings()

    assert settings.provider_encryption_keys == {"v2": encoded_key}
    assert encoded_key not in repr(settings)


@pytest.mark.anyio
async def test_provider_verification_failures_never_log_or_return_credentials(
    client,
    auth_headers,
    monkeypatch,
    caplog,
):
    credential = "never-log-this-provider-credential"

    def reject(*_args, **_kwargs):
        raise ApiError(
            422,
            "PROVIDER_CREDENTIAL_INVALID",
            "The model provider rejected this credential",
        )

    monkeypatch.setattr(ProviderCredentialVerifier, "verify", reject)
    with caplog.at_level(logging.DEBUG):
        response = await client.put(
            "/api/v1/provider-connections/openai",
            json={"api_key": credential},
            headers=auth_headers("tenant-a"),
        )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PROVIDER_CREDENTIAL_INVALID"
    assert credential not in response.text
    assert credential not in caplog.text
