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


def test_lazada_oauth_callback_encrypts_tokens_and_never_stores_plaintext():
    from app.services.lazada_seller_service import (
        LazadaSellerAdapter,
        LazadaSellerConnectorService,
    )

    adapter = LazadaSellerAdapter()
    adapter.exchange_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "plain_access",
            "refresh_token": "plain_refresh",
            "expires_in": 3600,
            "refresh_expires_in": 7200,
            "account_id": "account_123",
            "account": "seller@example.com",
            "country_user_info": [
                {"country": "vn", "seller_id": "seller_123", "user_id": "user_123"}
            ],
        }
    )

    with patch.dict(
        "os.environ",
        {
            "LAZADA_APP_KEY": "app_key_123",
            "LAZADA_APP_SECRET": "shh",
        },
    ), patch("app.services.lazada_seller_service.connected_accounts_repo") as repo, patch(
        "app.services.lazada_seller_service._encrypt_secret",
        lambda value: f"enc:{value}",
    ):
        service = LazadaSellerConnectorService(adapter=adapter)
        repo.get_connection.return_value = {}
        oauth_url = service.get_oauth_url(USER_ID, region="VN")
        query = parse_qs(urlparse(oauth_url).query)
        state = query["state"][0]
        pending = repo.upsert_provider_metadata.call_args.kwargs["metadata"][
            "pending_oauth_states"
        ]
        repo.get_connection.return_value = {"pending_oauth_states": pending}

        run(service.handle_oauth_callback(code="lazada-code", state=state))

    assert query["client_id"][0] == "app_key_123"
    assert query["country"][0] == "vn"
    adapter.exchange_token.assert_awaited_once_with(
        auth_base_url="https://auth.lazada.com",
        app_key="app_key_123",
        app_secret="shh",
        code="lazada-code",
    )
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_refresh_token"] == "enc:plain_refresh"
    assert metadata["account_id"] == "account_123"
    assert metadata["sellers"][0]["id"] == "seller_123"
    assert metadata["region"] == "VN"
    assert "refresh_token" not in metadata
    assert "plain_refresh" not in str(
        {k: v for k, v in metadata.items() if not k.startswith("encrypted_")}
    )


def test_lazada_state_rejects_tampering():
    from app.services.lazada_seller_service import LazadaSellerConnectorService

    with patch.dict("os.environ", {"LAZADA_APP_SECRET": "shh"}):
        service = LazadaSellerConnectorService()
        state = service._make_state_payload(USER_ID, "VN")
        payload = service._verify_state(state)

    assert payload["u"] == USER_ID
    assert payload["r"] == "VN"
    with pytest.raises(ValueError):
        service._verify_state(f"{state}bad")


def test_lazada_refreshes_expired_access_token():
    from app.services.lazada_seller_service import (
        LazadaSellerAdapter,
        LazadaSellerConnectorService,
    )

    adapter = LazadaSellerAdapter()
    adapter.refresh_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "new_access",
            "refresh_token": "new_refresh",
            "expires_in": 3600,
        }
    )
    service = LazadaSellerConnectorService(adapter=adapter)
    expired = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    with patch.dict(
        "os.environ",
        {"LAZADA_APP_KEY": "123456", "LAZADA_APP_SECRET": "secret"},
    ), patch("app.services.lazada_seller_service.connected_accounts_repo") as repo, patch(
        "app.services.lazada_seller_service._decrypt_secret",
        lambda value: "old_refresh" if "refresh" in value else "old_access",
    ), patch(
        "app.services.lazada_seller_service._encrypt_secret",
        lambda value: f"enc:{value}",
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_access",
            "encrypted_refresh_token": "enc_refresh",
            "expires_at": expired,
            "sellers": [{"id": "seller_123", "region": "VN"}],
        }
        token, _ = run(service._access_token(USER_ID))

    assert token == "new_access"
    adapter.refresh_token.assert_awaited_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:new_access"
    assert metadata["encrypted_refresh_token"] == "enc:new_refresh"


def test_lazada_signed_request_retries_rate_limits_and_sends_access_query():
    from app.services.lazada_seller_service import LazadaSellerAdapter

    request = httpx.Request("GET", "https://api.lazada.vn/rest/test")
    responses = [
        httpx.Response(429, headers={"Retry-After": "0"}, request=request),
        httpx.Response(200, json={"code": 0, "data": {}}, request=request),
    ]
    observed_headers = []
    observed_urls = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def request(self, *args, **kwargs):
            observed_urls.append(args[1])
            observed_headers.append(kwargs.get("headers", {}))
            response = responses[self.calls]
            self.calls += 1
            return response

    adapter = LazadaSellerAdapter()
    with patch("app.services.lazada_seller_service.httpx.AsyncClient", FakeClient), patch.object(
        adapter, "_sleep", new_callable=AsyncMock
    ) as sleep:
        payload = run(
            adapter.api_request(
                method="GET",
                api_base_url="https://api.lazada.vn/rest",
                app_key="app_key_123",
                app_secret="secret",
                access_token="lazada_access",
                path="/test",
                params={"seller_id": "seller_123"},
            )
        )

    assert payload == {"code": 0, "data": {}}
    assert "sign=" in observed_urls[0]
    assert "app_key=app_key_123" in observed_urls[0]
    assert "access_token=lazada_access" in observed_urls[0]
    assert "seller_id=seller_123" in observed_urls[0]
    sleep.assert_awaited_once()


def test_lazada_sync_saves_manifest_without_credentials_and_records_entity():
    from app.services.lazada_seller_service import (
        LazadaSellerAdapter,
        LazadaSellerConnectorService,
    )

    adapter = LazadaSellerAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "order_create_time": "2026-06-01T00:00:00Z",
                    "order_id": "lazada_order_1",
                    "seller_id": "seller_123",
                    "region": "VN",
                    "currency": "VND",
                    "total_amount": "42.50",
                    "order_status": "COMPLETED",
                }
            ],
            "api_mode": "open_api",
            "truncated": False,
            "api_endpoints_used": ["/orders/get"],
        }
    )
    service = LazadaSellerConnectorService(adapter=adapter)

    with patch("app.services.lazada_seller_service.connected_accounts_repo") as repo, patch(
        "app.services.lazada_seller_service.assets_repo"
    ) as assets_repo, patch("app.services.lazada_seller_service.upload_bytes"), patch(
        "app.services.lazada_seller_service._decrypt_secret", return_value="plain_access"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_plain_access",
            "encrypted_refresh_token": "enc_plain_refresh",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "account_id": "acct_123",
            "account_name": "Dream Lazada Seller",
            "region": "VN",
            "sellers": [
                {
                    "id": "seller_123",
                    "name": "Dream Seller",
                    "region": "VN",
                }
            ],
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "lazada.csv",
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
                report_type="sales_overview",
                seller_id="seller_123",
                region="VN",
                date_preset="last_7d",
            )
        )

    assert result["entity_id"] == "lazada_seller:sales_overview:seller_123:VN"
    adapter.fetch_report_rows.assert_awaited_once()
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["lazada_manifest"]
    assert manifest["connector_key"] == "lazada_seller"
    assert manifest["seller_ids"] == ["seller_123"]
    assert manifest["pii_redacted"] is True
    assert manifest["restricted_buyer_data_used"] is False
    assert "plain_access" not in str(manifest)
    assert "enc_plain_refresh" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_lazada_sync_rejects_buyer_pii_export():
    from app.services.lazada_seller_service import LazadaSellerConnectorService

    service = LazadaSellerConnectorService()
    with patch("app.services.lazada_seller_service.connected_accounts_repo") as repo:
        repo.get_connection.return_value = {"encrypted_refresh_token": "enc_refresh"}
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="orders",
                    include_pii=True,
                )
            )

    assert exc_info.value.status_code == 400
