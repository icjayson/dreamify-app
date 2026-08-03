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


def test_amazon_oauth_callback_encrypts_refresh_token_and_never_stores_plaintext():
    from app.services.amazon_seller_service import (
        AmazonSellerAdapter,
        AmazonSellerConnectorService,
    )

    adapter = AmazonSellerAdapter()
    adapter.exchange_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "plain_access",
            "refresh_token": "plain_refresh",
            "expires_in": 3600,
        }
    )
    adapter.fetch_marketplaces = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            {"id": "ATVPDKIKX0DER", "name": "Amazon.com", "country_code": "US"}
        ]
    )

    with patch.dict(
        "os.environ",
        {
            "AMAZON_SELLER_CLIENT_ID": "amzn-app-id",
            "AMAZON_SELLER_CLIENT_SECRET": "shh",
            "AMAZON_SELLER_AWS_ACCESS_KEY_ID": "AKIA",
            "AMAZON_SELLER_AWS_SECRET_ACCESS_KEY": "SECRET",
        },
    ), patch("app.services.amazon_seller_service.connected_accounts_repo") as repo, patch(
        "app.services.amazon_seller_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        service = AmazonSellerConnectorService(adapter=adapter)
        repo.get_connection.return_value = {}
        oauth_url = service.get_oauth_url(USER_ID, region="NA")
        query = parse_qs(urlparse(oauth_url).query)
        state = query["state"][0]
        pending = repo.upsert_provider_metadata.call_args.kwargs["metadata"][
            "pending_oauth_states"
        ]
        repo.get_connection.return_value = {"pending_oauth_states": pending}

        run(
            service.handle_oauth_callback(
                code="spapi-code",
                state=state,
                selling_partner_id="seller_123",
            )
        )

    assert query["application_id"][0] == "amzn-app-id"
    adapter.exchange_token.assert_awaited_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_refresh_token"] == "enc:plain_refresh"
    assert metadata["seller_id"] == "seller_123"
    assert metadata["selling_region"] == "NA"
    assert "refresh_token" not in metadata
    assert "plain_refresh" not in str(
        {k: v for k, v in metadata.items() if not k.startswith("encrypted_")}
    )


def test_amazon_state_rejects_tampering():
    from app.services.amazon_seller_service import AmazonSellerConnectorService

    with patch.dict("os.environ", {"AMAZON_SELLER_CLIENT_SECRET": "shh"}):
        service = AmazonSellerConnectorService()
        state = service._make_state_payload(USER_ID, "EU")
        payload = service._verify_state(state)

    assert payload["u"] == USER_ID
    assert payload["r"] == "EU"
    with pytest.raises(ValueError):
        service._verify_state(f"{state}bad")


def test_amazon_refreshes_expired_lwa_access_token():
    from app.services.amazon_seller_service import (
        AmazonSellerAdapter,
        AmazonSellerConnectorService,
    )

    adapter = AmazonSellerAdapter()
    adapter.refresh_token = AsyncMock(  # type: ignore[method-assign]
        return_value={"access_token": "new_access", "expires_in": 3600}
    )
    service = AmazonSellerConnectorService(adapter=adapter)
    expired = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    with patch.dict(
        "os.environ",
        {"AMAZON_SELLER_CLIENT_ID": "cid", "AMAZON_SELLER_CLIENT_SECRET": "secret"},
    ), patch("app.services.amazon_seller_service.connected_accounts_repo") as repo, patch(
        "app.services.amazon_seller_service._decrypt_secret",
        lambda value: "old_refresh" if "refresh" in value else "old_access",
    ), patch(
        "app.services.amazon_seller_service._encrypt_secret",
        lambda value: f"enc:{value}",
    ):
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


def test_amazon_sigv4_request_retries_rate_limits_and_signs_headers():
    from app.services.amazon_seller_service import AmazonSellerAdapter

    request = httpx.Request("GET", "https://sellingpartnerapi-na.amazon.com/orders")
    responses = [
        httpx.Response(429, headers={"Retry-After": "0"}, request=request),
        httpx.Response(200, json={"payload": {}}, request=request),
    ]
    observed_headers = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def request(self, *args, **kwargs):
            observed_headers.append(kwargs.get("headers", {}))
            response = responses[self.calls]
            self.calls += 1
            return response

    adapter = AmazonSellerAdapter()
    with patch("app.services.amazon_seller_service.httpx.AsyncClient", FakeClient), patch.object(
        adapter, "_sleep", new_callable=AsyncMock
    ) as sleep:
        payload = run(
            adapter.sp_api_request(
                method="GET",
                endpoint="https://sellingpartnerapi-na.amazon.com",
                aws_region="us-east-1",
                access_key="AKIA_TEST",
                secret_key="SECRET_TEST",
                lwa_access_token="lwa_token",
                path="/orders",
            )
        )

    assert payload == {"payload": {}}
    assert observed_headers[0]["x-amz-access-token"] == "lwa_token"
    assert "Authorization" in observed_headers[0]
    sleep.assert_awaited_once()


def test_amazon_parse_report_document_supports_tsv_and_json():
    from app.services.amazon_seller_service import AmazonSellerAdapter

    adapter = AmazonSellerAdapter()
    tsv_rows = adapter.parse_report_document(
        b"amazon-order-id\tpurchase-date\n111\t2026-06-01\n"
    )
    json_rows = adapter.parse_report_document(
        b'{"rows":[{"amazon_order_id":"222","purchase_date":"2026-06-02"}]}'
    )

    assert tsv_rows == [{"amazon-order-id": "111", "purchase-date": "2026-06-01"}]
    assert json_rows == [{"amazon_order_id": "222", "purchase_date": "2026-06-02"}]


def test_amazon_sync_saves_manifest_without_credentials_and_records_entity():
    from app.services.amazon_seller_service import (
        AmazonSellerAdapter,
        AmazonSellerConnectorService,
    )

    adapter = AmazonSellerAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "purchase_date": "2026-06-01",
                    "amazon_order_id": "111-123",
                    "marketplace_id": "ATVPDKIKX0DER",
                    "order_status": "Shipped",
                    "currency": "USD",
                    "order_total": "42.50",
                }
            ],
            "api_mode": "orders_api",
            "truncated": False,
            "api_endpoints_used": ["/orders/v0/orders"],
            "report_ids": [],
            "report_document_ids": [],
        }
    )
    service = AmazonSellerConnectorService(adapter=adapter)

    with patch("app.services.amazon_seller_service.connected_accounts_repo") as repo, patch(
        "app.services.amazon_seller_service.assets_repo"
    ) as assets_repo, patch("app.services.amazon_seller_service.upload_bytes"), patch(
        "app.services.amazon_seller_service._decrypt_secret", return_value="plain_access"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_plain_access",
            "encrypted_refresh_token": "enc_plain_refresh",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "seller_id": "seller_123",
            "seller_name": "Dream Seller",
            "selling_region": "NA",
            "sp_api_endpoint": "https://sellingpartnerapi-na.amazon.com",
            "aws_region": "us-east-1",
            "marketplaces": [
                {"id": "ATVPDKIKX0DER", "name": "Amazon.com", "country_code": "US"}
            ],
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "amazon.csv",
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
                marketplace_id="ATVPDKIKX0DER",
                date_preset="last_7d",
            )
        )

    assert result["entity_id"] == "amazon_seller:sales_overview:seller_123:ATVPDKIKX0DER"
    adapter.fetch_report_rows.assert_awaited_once()
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["amazon_seller_manifest"]
    assert manifest["connector_key"] == "amazon_seller"
    assert manifest["marketplace_ids"] == ["ATVPDKIKX0DER"]
    assert manifest["pii_redacted"] is True
    assert manifest["restricted_data_token_used"] is False
    assert "plain_access" not in str(manifest)
    assert "enc_plain_refresh" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_amazon_sync_rejects_restricted_pii_export():
    from app.services.amazon_seller_service import AmazonSellerConnectorService

    service = AmazonSellerConnectorService()
    with patch("app.services.amazon_seller_service.connected_accounts_repo") as repo:
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
