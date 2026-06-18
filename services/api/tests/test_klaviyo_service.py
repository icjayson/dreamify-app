import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_klaviyo_oauth_callback_uses_pkce_encrypts_tokens_and_never_stores_plaintext():
    from app.services.klaviyo_service import (
        KlaviyoLifecycleAdapter,
        KlaviyoLifecycleService,
    )

    adapter = KlaviyoLifecycleAdapter()
    adapter.exchange_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "plain_access",
            "refresh_token": "plain_refresh",
            "expires_in": 3600,
            "scope": "accounts:read metrics:read",
        }
    )
    adapter.fetch_account = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "account_id": "acct_1",
            "account_name": "Dream Lifecycle",
            "timezone": "UTC",
        }
    )
    adapter.fetch_resources = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "metrics": [
                {
                    "id": "metric_placed_order",
                    "attributes": {"name": "Placed Order"},
                }
            ]
        }
    )

    with patch.dict(
        "os.environ",
        {
            "KLAVIYO_CLIENT_ID": "cid",
            "KLAVIYO_CLIENT_SECRET": "shh",
            "KLAVIYO_REDIRECT_URI": "https://api.example.com/callback",
        },
    ), patch("app.services.klaviyo_service.connected_accounts_repo") as repo, patch(
        "app.services.klaviyo_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        service = KlaviyoLifecycleService(adapter=adapter)
        repo.get_connection.return_value = {}
        oauth_url = service.get_oauth_url(USER_ID)
        state = parse_qs(urlparse(oauth_url).query)["state"][0]
        pending = repo.upsert_provider_metadata.call_args.kwargs["metadata"][
            "pending_oauth_states"
        ]
        repo.get_connection.return_value = {"pending_oauth_states": pending}

        run(service.handle_oauth_callback(code="code", state=state))

    adapter.exchange_token.assert_awaited_once()
    assert adapter.exchange_token.call_args.kwargs["code_verifier"]
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:plain_access"
    assert metadata["encrypted_refresh_token"] == "enc:plain_refresh"
    assert metadata["account_id"] == "acct_1"
    assert metadata["default_metric_id"] == "metric_placed_order"
    assert "access_token" not in metadata
    assert "refresh_token" not in metadata
    assert "plain_access" not in str(
        {k: v for k, v in metadata.items() if not k.startswith("encrypted_")}
    )


def test_klaviyo_state_rejects_tampering():
    from app.services.klaviyo_service import KlaviyoLifecycleService

    with patch.dict("os.environ", {"KLAVIYO_CLIENT_SECRET": "shh"}):
        service = KlaviyoLifecycleService()
        state = service._make_state_payload(USER_ID)
        payload = service._verify_state(state)

    assert payload["u"] == USER_ID

    with pytest.raises(ValueError):
        service._verify_state(f"{state}bad")


def test_klaviyo_refreshes_expired_access_token():
    from app.services.klaviyo_service import (
        KlaviyoLifecycleAdapter,
        KlaviyoLifecycleService,
    )

    adapter = KlaviyoLifecycleAdapter()
    adapter.refresh_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "new_access",
            "refresh_token": "new_refresh",
            "expires_in": 3600,
            "scope": "accounts:read metrics:read",
        }
    )
    service = KlaviyoLifecycleService(adapter=adapter)
    expired = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    with patch.dict(
        "os.environ",
        {"KLAVIYO_CLIENT_ID": "cid", "KLAVIYO_CLIENT_SECRET": "secret"},
    ), patch("app.services.klaviyo_service.connected_accounts_repo") as repo, patch(
        "app.services.klaviyo_service._decrypt_secret",
        lambda value: "old_refresh" if "refresh" in value else "old_access",
    ), patch("app.services.klaviyo_service._encrypt_secret", lambda value: f"enc:{value}"):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_access",
            "encrypted_refresh_token": "enc_refresh",
            "expires_at": expired,
        }
        token, _ = run(service._access_token(USER_ID))

    assert token == "new_access"
    adapter.refresh_token.assert_awaited_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:new_access"
    assert metadata["encrypted_refresh_token"] == "enc:new_refresh"


def test_klaviyo_sync_saves_manifest_without_credentials_and_records_entity():
    from app.services.klaviyo_service import (
        KlaviyoLifecycleAdapter,
        KlaviyoLifecycleService,
    )

    adapter = KlaviyoLifecycleAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "date_start": "2026-06-01",
                    "date_end": "2026-06-30",
                    "account_id": "acct_1",
                    "account_name": "Dream Lifecycle",
                    "conversion_metric_id": "metric_placed_order",
                    "campaign_count": 4,
                    "flow_count": 3,
                    "channel": "all",
                }
            ],
            "api_mode": "rest",
            "truncated": False,
        }
    )
    service = KlaviyoLifecycleService(adapter=adapter)

    with patch("app.services.klaviyo_service.connected_accounts_repo") as repo, patch(
        "app.services.klaviyo_service.assets_repo"
    ) as assets_repo, patch("app.services.klaviyo_service.upload_bytes"), patch(
        "app.services.klaviyo_service._decrypt_secret", return_value="plain_access"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_plain_access",
            "account_id": "acct_1",
            "account_name": "Dream Lifecycle",
            "api_revision": "2026-04-15",
            "api_base_url": "https://a.klaviyo.com",
            "default_metric_id": "metric_placed_order",
            "default_metric_name": "Placed Order",
            "timezone": "UTC",
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "klaviyo.csv",
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
                report_type="lifecycle_overview",
                date_preset="last_30d",
            )
        )

    assert result["entity_id"] == "klaviyo:lifecycle_overview:acct_1:all"
    adapter.fetch_report_rows.assert_awaited_once()
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["klaviyo_manifest"]
    assert manifest["connector_key"] == "klaviyo"
    assert manifest["selected_metric_id"] == "metric_placed_order"
    assert manifest["pii_redacted"] is True
    assert "plain_access" not in str(manifest)
    assert "enc_plain_access" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_klaviyo_requires_conversion_metric_for_lifecycle_reports():
    from app.services.klaviyo_service import KlaviyoLifecycleService

    service = KlaviyoLifecycleService()
    with patch("app.services.klaviyo_service.connected_accounts_repo") as repo, patch(
        "app.services.klaviyo_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "account_id": "acct_1",
            "account_name": "Dream Lifecycle",
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="lifecycle_overview",
                )
            )

    assert exc_info.value.status_code == 400


def test_klaviyo_byte_cap_blocks_large_extract():
    from app.services.klaviyo_service import (
        KlaviyoLifecycleAdapter,
        KlaviyoLifecycleService,
    )

    adapter = KlaviyoLifecycleAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [{"name": "x" * 2000}],
            "api_mode": "rest",
            "truncated": False,
        }
    )
    service = KlaviyoLifecycleService(adapter=adapter)

    with patch("app.services.klaviyo_service.connected_accounts_repo") as repo, patch(
        "app.services.klaviyo_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "account_id": "acct_1",
            "account_name": "Dream Lifecycle",
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="metrics",
                    max_bytes=32,
                )
            )

    assert exc_info.value.status_code == 413


def test_klaviyo_429_responses_retry_before_success():
    from app.services.klaviyo_service import KlaviyoLifecycleAdapter

    request = httpx.Request("GET", "https://a.klaviyo.com/api/metrics/")
    responses = [
        httpx.Response(429, headers={"Retry-After": "0"}, request=request),
        httpx.Response(200, json={"data": []}, request=request),
    ]

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def request(self, *args, **kwargs):
            response = responses[self.calls]
            self.calls += 1
            return response

    adapter = KlaviyoLifecycleAdapter()

    with patch("app.services.klaviyo_service.httpx.AsyncClient", FakeClient), patch.object(
        adapter, "_sleep", new_callable=AsyncMock
    ) as sleep:
        payload = run(
            adapter.api_get(
                api_base_url="https://a.klaviyo.com",
                access_token="token",
                revision="2026-04-15",
                path="/api/metrics/",
            )
        )

    assert payload == {"data": []}
    sleep.assert_awaited_once()
