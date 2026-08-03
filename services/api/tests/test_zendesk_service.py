import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
import httpx
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_zendesk_oauth_callback_encrypts_tokens_and_never_stores_plaintext():
    from app.services.zendesk_service import (
        ZendeskSupportAdapter,
        ZendeskSupportConnectorService,
    )

    adapter = ZendeskSupportAdapter()
    adapter.exchange_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "plain_access",
            "refresh_token": "plain_refresh",
            "expires_in": 3600,
            "scope": "read",
        }
    )
    adapter.fetch_account = AsyncMock(  # type: ignore[method-assign]
        return_value={"account_name": "Dream Support", "timezone": "Asia/Ho_Chi_Minh"}
    )

    with patch.dict(
        "os.environ",
        {
            "ZENDESK_CLIENT_ID": "cid",
            "ZENDESK_CLIENT_SECRET": "shh",
            "ZENDESK_REDIRECT_URI": "https://api.example.com/callback",
        },
    ), patch("app.services.zendesk_service.connected_accounts_repo") as repo, patch(
        "app.services.zendesk_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        service = ZendeskSupportConnectorService(adapter=adapter)
        repo.get_connection.return_value = {}
        oauth_url = service.get_oauth_url(USER_ID, subdomain="dream.zendesk.com")
        state = parse_qs(urlparse(oauth_url).query)["state"][0]
        pending = repo.upsert_provider_metadata.call_args.kwargs["metadata"][
            "pending_oauth_states"
        ]
        repo.get_connection.return_value = {"pending_oauth_states": pending}

        run(service.handle_oauth_callback(code="code", state=state))

    adapter.exchange_token.assert_awaited_once()
    adapter.fetch_account.assert_awaited_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:plain_access"
    assert metadata["encrypted_refresh_token"] == "enc:plain_refresh"
    assert metadata["subdomain"] == "dream"
    assert metadata["account_name"] == "Dream Support"
    assert "access_token" not in metadata
    assert "refresh_token" not in metadata
    assert "plain_access" not in str(
        {k: v for k, v in metadata.items() if not k.startswith("encrypted_")}
    )


def test_zendesk_state_rejects_tampering():
    from app.services.zendesk_service import ZendeskSupportConnectorService

    with patch.dict("os.environ", {"ZENDESK_CLIENT_SECRET": "shh"}):
        service = ZendeskSupportConnectorService()
        state = service._make_state_payload(USER_ID, "dream")
        payload = service._verify_state(state)

    assert payload["u"] == USER_ID
    assert payload["s"] == "dream"
    with pytest.raises(ValueError):
        service._verify_state(f"{state}bad")


def test_zendesk_refreshes_expired_access_token():
    from app.services.zendesk_service import (
        ZendeskSupportAdapter,
        ZendeskSupportConnectorService,
    )

    adapter = ZendeskSupportAdapter()
    adapter.refresh_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "new_access",
            "refresh_token": "new_refresh",
            "expires_in": 3600,
            "scope": "read",
        }
    )
    service = ZendeskSupportConnectorService(adapter=adapter)
    expired = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    with patch.dict(
        "os.environ",
        {"ZENDESK_CLIENT_ID": "cid", "ZENDESK_CLIENT_SECRET": "secret"},
    ), patch("app.services.zendesk_service.connected_accounts_repo") as repo, patch(
        "app.services.zendesk_service._decrypt_secret",
        lambda value: "old_refresh" if "refresh" in value else "old_access",
    ), patch(
        "app.services.zendesk_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_access",
            "encrypted_refresh_token": "enc_refresh",
            "api_base_url": "https://dream.zendesk.com",
            "expires_at": expired,
        }
        token, _ = run(service._access_token(USER_ID))

    assert token == "new_access"
    adapter.refresh_token.assert_awaited_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:new_access"
    assert metadata["encrypted_refresh_token"] == "enc:new_refresh"


def test_zendesk_subdomain_validation_rejects_bad_domains():
    from app.services.zendesk_service import normalize_subdomain

    assert normalize_subdomain("https://dream.zendesk.com/path") == "dream"
    with pytest.raises(HTTPException):
        normalize_subdomain("dream.example.com")
    with pytest.raises(HTTPException):
        normalize_subdomain("-bad")


def test_zendesk_sync_saves_manifest_without_credentials_and_redacts_pii():
    from app.services.zendesk_service import (
        ZendeskSupportAdapter,
        ZendeskSupportConnectorService,
    )

    adapter = ZendeskSupportAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "ticket_id": "1",
                    "subject": "[redacted]",
                    "status": "open",
                    "priority": "high",
                    "created_at": "2026-06-01T00:00:00Z",
                }
            ],
            "api_mode": "incremental_export",
            "truncated": False,
            "endpoints_used": ["GET /api/v2/incremental/tickets/cursor.json"],
            "cursor": "cursor_1",
            "end_time": "1780000000",
        }
    )
    service = ZendeskSupportConnectorService(adapter=adapter)

    with patch("app.services.zendesk_service.connected_accounts_repo") as repo, patch(
        "app.services.zendesk_service.assets_repo"
    ) as assets_repo, patch("app.services.zendesk_service.upload_bytes"), patch(
        "app.services.zendesk_service._decrypt_secret", return_value="plain_access"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_plain_access",
            "subdomain": "dream",
            "account_name": "Dream Support",
            "api_base_url": "https://dream.zendesk.com",
            "timezone": "UTC",
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "zendesk.csv",
            "size_bytes": 100,
            "extension": "csv",
            "project_id": "p1",
        }
        assets_repo.update_asset_metadata.side_effect = (
            lambda user_id, asset_id, metadata: {
                **assets_repo.create_asset.return_value,
                **metadata,
            }
        )

        result = run(
            service.sync(
                user_id=USER_ID,
                project_id="p1",
                report_type="tickets",
                date_preset="custom",
                start_date="2026-06-01",
                end_date="2026-06-30",
            )
        )

    assert result["entity_id"] == "zendesk:tickets:dream:all"
    adapter.fetch_report_rows.assert_awaited_once()
    assert adapter.fetch_report_rows.call_args.kwargs["include_pii"] is False
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["zendesk_manifest"]
    assert manifest["connector_key"] == "zendesk"
    assert manifest["pii_redacted"] is True
    assert manifest["incremental_cursor"] == "cursor_1"
    assert "plain_access" not in str(manifest)
    assert "enc_plain_access" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_zendesk_byte_cap_blocks_large_extract():
    from app.services.zendesk_service import (
        ZendeskSupportAdapter,
        ZendeskSupportConnectorService,
    )

    adapter = ZendeskSupportAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [{"user_id": "1", "name": "x" * 2000}],
            "api_mode": "incremental_export",
            "truncated": False,
        }
    )
    service = ZendeskSupportConnectorService(adapter=adapter)

    with patch("app.services.zendesk_service.connected_accounts_repo") as repo, patch(
        "app.services.zendesk_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "subdomain": "dream",
            "account_name": "Dream Support",
            "api_base_url": "https://dream.zendesk.com",
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="users",
                    max_bytes=32,
                )
            )

    assert exc_info.value.status_code == 413


def test_zendesk_adapter_429_uses_retry_after():
    from app.services.zendesk_service import ZendeskSupportAdapter

    adapter = ZendeskSupportAdapter()
    adapter._sleep = AsyncMock()  # type: ignore[method-assign]

    class FakeResponse:
        def __init__(self, status_code, payload, headers=None):
            self.status_code = status_code
            self._payload = payload
            self.headers = headers or {}
            self.content = b"{}"

        def raise_for_status(self):
            if self.status_code >= 400:
                request = httpx.Request("GET", "https://dream.zendesk.com/test")
                response = httpx.Response(self.status_code, request=request)
                raise httpx.HTTPStatusError("bad", request=request, response=response)

        def json(self):
            return self._payload

    responses = [
        FakeResponse(429, {}, {"Retry-After": "2"}),
        FakeResponse(200, {"ok": True}),
    ]

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, *args, **kwargs):
            return responses.pop(0)

    with patch(
        "app.services.zendesk_service.httpx.AsyncClient", return_value=FakeClient()
    ):
        payload = run(
            adapter.api_get(
                api_base_url="https://dream.zendesk.com",
                access_token="token",
                path="/api/v2/groups.json",
            )
        )

    assert payload == {"ok": True}
    adapter._sleep.assert_awaited_once_with(2.0)
