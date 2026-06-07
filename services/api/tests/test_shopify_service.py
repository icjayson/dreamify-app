import asyncio
import hashlib
import hmac
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def _callback_params(secret: str, **values):
    params = {key: str(value) for key, value in values.items()}
    message = "&".join(f"{key}={value}" for key, value in sorted(params.items()))
    params["hmac"] = hmac.new(
        secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return params


def test_shopify_state_and_hmac_reject_tampering():
    from app.services.shopify_service import (
        ShopifyConnectorService,
        verify_shopify_hmac,
    )

    with patch.dict(
        "os.environ",
        {"SHOPIFY_CLIENT_SECRET": "shh"},
    ):
        service = ShopifyConnectorService()
        state = service._make_state_payload(USER_ID, "demo.myshopify.com")
        payload = service._verify_state(state)

    assert payload["u"] == USER_ID
    assert payload["s"] == "demo.myshopify.com"

    with patch.dict("os.environ", {"SHOPIFY_CLIENT_SECRET": "shh"}):
        with pytest.raises(ValueError):
            service._verify_state(f"{state}bad")

    params = _callback_params(
        "shh",
        code="code",
        shop="demo.myshopify.com",
        state=state,
        timestamp="1900000000",
    )
    assert verify_shopify_hmac(params, "shh") is True
    params["shop"] = "evil.myshopify.com"
    assert verify_shopify_hmac(params, "shh") is False


def test_shopify_domain_validation_accepts_bare_shop_and_rejects_non_shopify():
    from app.services.shopify_service import normalize_shop_domain

    assert normalize_shop_domain("Demo") == "demo.myshopify.com"
    assert (
        normalize_shop_domain("https://demo.myshopify.com/admin")
        == "demo.myshopify.com"
    )
    with pytest.raises(HTTPException):
        normalize_shop_domain("demo.example.com")


def test_shopify_oauth_callback_encrypts_token_and_never_stores_plain_token():
    from app.services.shopify_service import (
        ShopifyCommerceAdapter,
        ShopifyConnectorService,
    )

    adapter = ShopifyCommerceAdapter()
    adapter.exchange_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "plain_access",
            "scope": "read_orders,read_products",
        }
    )
    adapter.fetch_shop = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "shop_id": "gid://shopify/Shop/1",
            "shop_name": "Dream Store",
            "shop_domain": "demo.myshopify.com",
            "currency": "USD",
            "timezone": "America/Los_Angeles",
        }
    )

    with patch.dict(
        "os.environ",
        {
            "SHOPIFY_CLIENT_ID": "cid",
            "SHOPIFY_CLIENT_SECRET": "shh",
            "SHOPIFY_REDIRECT_URI": "https://api.example.com/callback",
        },
    ), patch("app.services.shopify_service.connected_accounts_repo") as repo, patch(
        "app.services.shopify_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        service = ShopifyConnectorService(adapter=adapter)
        state = service._make_state_payload(USER_ID, "demo.myshopify.com")
        repo.get_connection.return_value = {
            "pending_oauth_states": {
                state: {
                    "shop_domain": "demo.myshopify.com",
                    "created_at": 1_900_000_000,
                }
            }
        }
        params = _callback_params(
            "shh",
            code="code",
            shop="demo.myshopify.com",
            state=state,
            timestamp="1900000000",
        )

        run(
            service.handle_oauth_callback(
                code="code", state=state, shop="demo.myshopify.com", query_params=params
            )
        )

    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:plain_access"
    assert metadata["shop_domain"] == "demo.myshopify.com"
    assert "access_token" not in metadata
    assert "plain_access" not in str(
        {k: v for k, v in metadata.items() if k != "encrypted_access_token"}
    )


def test_shopify_sync_blocks_old_orders_without_read_all_orders():
    from app.services.shopify_service import ShopifyConnectorService

    service = ShopifyConnectorService()
    with patch("app.services.shopify_service.connected_accounts_repo") as repo, patch(
        "app.services.shopify_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "shop_domain": "demo.myshopify.com",
            "shop_name": "Dream Store",
            "read_all_orders_enabled": False,
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="orders",
                    date_preset="last_90d",
                )
            )

    assert exc_info.value.status_code == 403


def test_shopify_sync_saves_manifest_without_credentials_and_records_entity():
    from app.services.shopify_service import (
        ShopifyCommerceAdapter,
        ShopifyConnectorService,
    )

    adapter = ShopifyCommerceAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "order_date": "2026-06-01T00:00:00Z",
                    "order_id": "1",
                    "order_name": "#1001",
                    "currency": "USD",
                    "total": "99.00",
                }
            ],
            "api_mode": "graphql",
            "truncated": False,
        }
    )
    service = ShopifyConnectorService(adapter=adapter)

    with patch("app.services.shopify_service.connected_accounts_repo") as repo, patch(
        "app.services.shopify_service.assets_repo"
    ) as assets_repo, patch("app.services.shopify_service.upload_bytes"), patch(
        "app.services.shopify_service._decrypt_secret", return_value="plain_access"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_plain_access",
            "shop_id": "gid://shopify/Shop/1",
            "shop_domain": "demo.myshopify.com",
            "shop_name": "Dream Store",
            "api_version": "2026-04",
            "scopes": ["read_orders"],
            "read_all_orders_enabled": True,
            "timezone": "UTC",
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "shopify.csv",
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
                date_preset="last_30d",
                row_limit=5000,
            )
        )

    assert result["entity_id"] == "shopify:sales_overview:demo.myshopify.com:orders"
    adapter.fetch_report_rows.assert_awaited_once()
    assert adapter.fetch_report_rows.call_args.kwargs["include_pii"] is False
    assert adapter.fetch_report_rows.call_args.kwargs["force_bulk"] is True
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["shopify_manifest"]
    assert manifest["connector_key"] == "shopify"
    assert manifest["pii_redacted"] is True
    assert "plain_access" not in str(manifest)
    assert "enc_plain_access" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_shopify_byte_cap_blocks_large_extract():
    from app.services.shopify_service import (
        ShopifyCommerceAdapter,
        ShopifyConnectorService,
    )

    adapter = ShopifyCommerceAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [{"title": "x" * 2000}],
            "api_mode": "graphql",
            "truncated": False,
        }
    )
    service = ShopifyConnectorService(adapter=adapter)

    with patch("app.services.shopify_service.connected_accounts_repo") as repo, patch(
        "app.services.shopify_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "shop_domain": "demo.myshopify.com",
            "shop_name": "Dream Store",
            "read_all_orders_enabled": True,
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="products",
                    max_bytes=32,
                )
            )

    assert exc_info.value.status_code == 413


def test_shopify_bulk_mode_selected_for_large_row_limit():
    from app.services.shopify_service import (
        ShopifyCommerceAdapter,
        ShopifyConnectorService,
    )

    adapter = ShopifyCommerceAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={"rows": [], "api_mode": "bulk_operation", "truncated": False}
    )
    service = ShopifyConnectorService(adapter=adapter)

    with patch("app.services.shopify_service.connected_accounts_repo") as repo, patch(
        "app.services.shopify_service.assets_repo"
    ) as assets_repo, patch("app.services.shopify_service.upload_bytes"), patch(
        "app.services.shopify_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "shop_domain": "demo.myshopify.com",
            "shop_name": "Dream Store",
            "read_all_orders_enabled": True,
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "shopify.csv",
            "size_bytes": 1,
            "extension": "csv",
            "project_id": "p1",
        }
        assets_repo.update_asset_metadata.return_value = (
            assets_repo.create_asset.return_value
        )

        run(
            service.sync(
                user_id=USER_ID,
                project_id="p1",
                report_type="orders",
                row_limit=3000,
            )
        )

    assert adapter.fetch_report_rows.call_args.kwargs["force_bulk"] is True
