import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_hubspot_state_rejects_tampering():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    state = service._make_hubspot_state(USER_ID)
    assert service._verify_hubspot_state(state) == USER_ID

    tampered = state.replace(USER_ID, "other_user", 1)
    with pytest.raises(ValueError):
        service._verify_hubspot_state(tampered)


def test_hubspot_status_never_returns_tokens():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    with patch("app.services.integration_service.connected_accounts_repo") as repo:
        repo.get_connection.return_value = {
            "encrypted_access_token": "encrypted_access_secret",
            "encrypted_refresh_token": "encrypted_refresh_secret",
            "portal_id": "123",
            "portal_domain": "example.hubspot.com",
            "account_name": "Example",
        }

        status = run(service.get_hubspot_connection_status(USER_ID))

    assert status["connected"] is True
    assert status["portal_id"] == "123"
    assert "access_token" not in status
    assert "refresh_token" not in status
    assert "encrypted_access_token" not in status
    assert "encrypted_refresh_token" not in status


def test_hubspot_refreshes_expired_access_token():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    expired_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {
        "access_token": "new_access",
        "refresh_token": "new_refresh",
        "expires_in": 1800,
    }

    with patch(
        "app.services.integration_service.connected_accounts_repo"
    ) as repo, patch("httpx.AsyncClient") as mock_client, patch(
        "app.services.integration_service._decrypt_secret"
    ) as decrypt_secret, patch(
        "app.services.integration_service._encrypt_secret"
    ) as encrypt_secret:
        decrypt_secret.side_effect = {
            "encrypted_old_access": "old_access",
            "encrypted_old_refresh": "old_refresh",
        }.__getitem__
        encrypt_secret.side_effect = lambda value: f"encrypted_{value}"
        repo.get_connection.return_value = {
            "encrypted_access_token": "encrypted_old_access",
            "encrypted_refresh_token": "encrypted_old_refresh",
            "expires_at": expired_at,
            "portal_id": "123",
        }
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=mock_client.return_value
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value.post = AsyncMock(return_value=mock_response)

        token = run(service._get_hubspot_access_token(USER_ID))

    assert token == "new_access"
    repo.upsert_provider_metadata.assert_called_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "encrypted_new_access"
    assert metadata["encrypted_refresh_token"] == "encrypted_new_refresh"
    assert metadata["portal_id"] == "123"
    assert "access_token" not in metadata
    assert "refresh_token" not in metadata


def test_hubspot_invalid_report_type_rejected():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    with pytest.raises(HTTPException):
        service._hubspot_report_spec("tickets")


def test_hubspot_sync_caps_rows_and_stores_manifest_without_credentials():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    service._get_hubspot_access_token = AsyncMock(return_value="access_secret")  # type: ignore[method-assign]
    service.fetch_hubspot_pipelines = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            {
                "id": "default",
                "label": "Sales Pipeline",
                "stages": [
                    {"id": "qualified", "label": "Qualified", "probability": "0.5"}
                ],
            }
        ]
    )
    service.fetch_hubspot_owners = AsyncMock(  # type: ignore[method-assign]
        return_value=[{"id": "42", "name": "Ava Seller", "email": "ava@example.com"}]
    )
    service._hubspot_search_objects = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "results": [
                {
                    "id": "deal_1",
                    "properties": {
                        "dealname": "Expansion",
                        "amount": "1000",
                        "deal_currency_code": "USD",
                        "dealstage": "qualified",
                        "pipeline": "default",
                        "hubspot_owner_id": "42",
                        "createdate": "2026-01-01T00:00:00Z",
                        "hs_lastmodifieddate": "2026-01-03T00:00:00Z",
                    },
                },
                {
                    "id": "deal_2",
                    "properties": {
                        "dealname": "Ignored by cap",
                        "hs_lastmodifieddate": "2026-01-03T00:00:00Z",
                    },
                },
            ],
            "paging": {"next": {"after": "next-page"}},
        }
    )
    service._fetch_hubspot_association_summary = AsyncMock(  # type: ignore[method-assign]
        return_value={"associated_companies_ids": "company_1"}
    )
    service._save_integration_asset = MagicMock(  # type: ignore[method-assign]
        return_value={
            "asset_id": "asset_1",
            "filename": "hubspot_sales_pipeline.csv",
            "size_bytes": 128,
            "extension": "csv",
            "project_id": "p1",
        }
    )

    with patch(
        "app.services.integration_service.connected_accounts_repo"
    ) as repo, patch("app.services.integration_service.assets_repo") as assets_repo:
        repo.get_connection.return_value = {
            "portal_id": "123",
            "portal_domain": "example.hubspot.com",
            "account_name": "Example HubSpot",
        }
        result = run(
            service.fetch_hubspot_data(
                user_id=USER_ID,
                report_type="sales_pipeline",
                project_id="p1",
                date_preset="last_30d",
                pipeline_id="default",
                owner_id="42",
                row_limit=1,
                include_associations=True,
            )
        )

    assert result["row_count"] == 1
    assert result["truncated"] is True
    update_metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    assert update_metadata["connector_key"] == "hubspot"
    assert update_metadata["connector_entity_id"] == "hubspot:sales_pipeline:default:42"
    manifest = update_metadata["hubspot_manifest"]
    assert manifest["row_limit"] == 1
    assert manifest["row_count"] == 1
    assert "access_token" not in str(manifest)
    assert "refresh_token" not in str(manifest)
