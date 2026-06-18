import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_quickbooks_oauth_callback_encrypts_tokens_and_never_stores_plaintext():
    from app.services.quickbooks_service import QuickBooksAdapter, QuickBooksConnectorService

    adapter = QuickBooksAdapter()
    adapter.exchange_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "plain_access",
            "refresh_token": "plain_refresh",
            "expires_in": 3600,
            "scope": "com.intuit.quickbooks.accounting",
        }
    )
    adapter.fetch_company_info = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "CompanyName": "Dream Finance",
            "Country": "US",
            "CompanyAddr": {"CountrySubDivisionCode": "CA"},
        }
    )

    with patch.dict(
        "os.environ",
        {
            "QUICKBOOKS_CLIENT_ID": "cid",
            "QUICKBOOKS_CLIENT_SECRET": "shh",
            "QUICKBOOKS_REDIRECT_URI": "https://api.example.com/callback",
        },
    ), patch("app.services.quickbooks_service.connected_accounts_repo") as repo, patch(
        "app.services.quickbooks_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        service = QuickBooksConnectorService(adapter=adapter)
        repo.get_connection.return_value = {}
        oauth_url = service.get_oauth_url(USER_ID)
        state = parse_qs(urlparse(oauth_url).query)["state"][0]
        pending = repo.upsert_provider_metadata.call_args.kwargs["metadata"][
            "pending_oauth_states"
        ]
        repo.get_connection.return_value = {"pending_oauth_states": pending}

        run(service.handle_oauth_callback(code="code", state=state, realm_id="realm_1"))

    adapter.exchange_token.assert_awaited_once()
    adapter.fetch_company_info.assert_awaited_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:plain_access"
    assert metadata["encrypted_refresh_token"] == "enc:plain_refresh"
    assert metadata["realm_id"] == "realm_1"
    assert metadata["company_name"] == "Dream Finance"
    assert "access_token" not in metadata
    assert "refresh_token" not in metadata
    assert "plain_access" not in str(
        {k: v for k, v in metadata.items() if not k.startswith("encrypted_")}
    )


def test_quickbooks_state_rejects_tampering():
    from app.services.quickbooks_service import QuickBooksConnectorService

    with patch.dict("os.environ", {"QUICKBOOKS_CLIENT_SECRET": "shh"}):
        service = QuickBooksConnectorService()
        state = service._make_state_payload(USER_ID)
        payload = service._verify_state(state)

    assert payload["u"] == USER_ID

    with pytest.raises(ValueError):
        service._verify_state(f"{state}bad")


def test_quickbooks_refreshes_expired_access_token():
    from app.services.quickbooks_service import QuickBooksAdapter, QuickBooksConnectorService

    adapter = QuickBooksAdapter()
    adapter.refresh_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "new_access",
            "refresh_token": "new_refresh",
            "expires_in": 3600,
            "scope": "com.intuit.quickbooks.accounting",
        }
    )
    service = QuickBooksConnectorService(adapter=adapter)
    expired = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    with patch.dict(
        "os.environ",
        {"QUICKBOOKS_CLIENT_ID": "cid", "QUICKBOOKS_CLIENT_SECRET": "secret"},
    ), patch("app.services.quickbooks_service.connected_accounts_repo") as repo, patch(
        "app.services.quickbooks_service._decrypt_secret",
        lambda value: "old_refresh" if "refresh" in value else "old_access",
    ), patch(
        "app.services.quickbooks_service._encrypt_secret", lambda value: f"enc:{value}"
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
    assert metadata["encrypted_refresh_token"] == "enc:new_refresh"


def test_quickbooks_sync_saves_manifest_without_credentials_and_records_entity():
    from app.services.quickbooks_service import QuickBooksAdapter, QuickBooksConnectorService

    adapter = QuickBooksAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "report_type": "profit_and_loss",
                    "statement_name": "ProfitAndLoss",
                    "row_type": "summary",
                    "section": "Income",
                    "label": "Total Income",
                    "col_1": "1000",
                }
            ],
            "api_mode": "reports_api",
            "truncated": False,
            "endpoints_used": ["GET /v3/company/realm_1/reports/ProfitAndLoss"],
            "chunks": [
                {"from": "2026-01-01", "to": "2026-06-30"},
                {"from": "2026-07-01", "to": "2026-12-31"},
            ],
        }
    )
    service = QuickBooksConnectorService(adapter=adapter)

    with patch("app.services.quickbooks_service.connected_accounts_repo") as repo, patch(
        "app.services.quickbooks_service.assets_repo"
    ) as assets_repo, patch("app.services.quickbooks_service.upload_bytes"), patch(
        "app.services.quickbooks_service._decrypt_secret", return_value="plain_access"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_plain_access",
            "realm_id": "realm_1",
            "company_name": "Dream Finance",
            "api_base_url": "https://quickbooks.api.intuit.com",
            "minor_version": "75",
            "environment": "production",
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "quickbooks.csv",
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
                report_type="finance_overview",
                date_preset="custom",
                start_date="2026-01-01",
                end_date="2026-12-31",
            )
        )

    assert result["entity_id"] == "quickbooks:finance_overview:realm_1:all"
    adapter.fetch_report_rows.assert_awaited_once()
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["quickbooks_manifest"]
    assert manifest["connector_key"] == "quickbooks"
    assert manifest["accounting_basis"] == "Accrual"
    assert len(manifest["report_chunks"]) == 2
    assert manifest["pii_redacted"] is True
    assert "plain_access" not in str(manifest)
    assert "enc_plain_access" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_quickbooks_entity_sync_uses_accounting_api_and_redacts_pii_by_default():
    from app.services.quickbooks_service import QuickBooksAdapter, QuickBooksConnectorService

    adapter = QuickBooksAdapter()
    adapter.fetch_entity_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "invoice_id": "1",
                    "doc_number": "1001",
                    "customer_name": "D***",
                    "txn_date": "2026-06-01",
                }
            ],
            "api_mode": "accounting_api_query",
            "truncated": False,
        }
    )
    service = QuickBooksConnectorService(adapter=adapter)

    with patch("app.services.quickbooks_service.connected_accounts_repo") as repo, patch(
        "app.services.quickbooks_service.assets_repo"
    ) as assets_repo, patch("app.services.quickbooks_service.upload_bytes"), patch(
        "app.services.quickbooks_service._decrypt_secret", return_value="plain_access"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_plain_access",
            "realm_id": "realm_1",
            "company_name": "Dream Finance",
        }
        assets_repo.create_asset.return_value = {"asset_id": "asset_1"}
        assets_repo.update_asset_metadata.side_effect = (
            lambda user_id, asset_id, metadata: {"asset_id": asset_id, **metadata}
        )
        run(
            service.sync(
                user_id=USER_ID,
                project_id="p1",
                report_type="invoices",
            )
        )

    adapter.fetch_entity_rows.assert_awaited_once()
    assert adapter.fetch_entity_rows.call_args.kwargs["include_pii"] is False
    manifest = assets_repo.update_asset_metadata.call_args.kwargs["metadata"][
        "quickbooks_manifest"
    ]
    assert manifest["api_mode"] == "accounting_api_query"
    assert manifest["pii_redacted"] is True


def test_quickbooks_sync_rejects_invalid_accounting_basis():
    from app.services.quickbooks_service import QuickBooksConnectorService

    service = QuickBooksConnectorService()
    with patch("app.services.quickbooks_service.connected_accounts_repo") as repo, patch(
        "app.services.quickbooks_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "realm_id": "realm_1",
            "company_name": "Dream Finance",
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="finance_overview",
                    accounting_basis="ModifiedCash",
                )
            )

    assert exc_info.value.status_code == 400


def test_quickbooks_byte_cap_blocks_large_extract():
    from app.services.quickbooks_service import QuickBooksAdapter, QuickBooksConnectorService

    adapter = QuickBooksAdapter()
    adapter.fetch_entity_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [{"customer_id": "1", "display_name": "x" * 2000}],
            "api_mode": "accounting_api_query",
            "truncated": False,
        }
    )
    service = QuickBooksConnectorService(adapter=adapter)

    with patch("app.services.quickbooks_service.connected_accounts_repo") as repo, patch(
        "app.services.quickbooks_service._decrypt_secret", return_value="token"
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc",
            "realm_id": "realm_1",
            "company_name": "Dream Finance",
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="customers",
                    max_bytes=32,
                )
            )

    assert exc_info.value.status_code == 413


def test_quickbooks_report_chunks_use_six_month_windows():
    from app.services.quickbooks_service import _date_chunks

    chunks = _date_chunks({"from": "2026-01-01", "to": "2026-12-31"})

    assert chunks == [
        {"from": "2026-01-01", "to": "2026-07-02"},
        {"from": "2026-07-03", "to": "2026-12-31"},
    ]
