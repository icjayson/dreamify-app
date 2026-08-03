import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_salesforce_state_rejects_tampering():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    state = service._make_salesforce_state(USER_ID)
    assert service._verify_salesforce_state(state) == USER_ID

    tampered = state.replace(USER_ID, "other_user", 1)
    with pytest.raises(ValueError):
        service._verify_salesforce_state(tampered)


def test_salesforce_status_never_returns_tokens():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    with patch("app.services.integration_service.connected_accounts_repo") as repo:
        repo.get_connection.return_value = {
            "encrypted_access_token": "encrypted_access_secret",
            "encrypted_refresh_token": "encrypted_refresh_secret",
            "org_id": "00D123",
            "instance_url": "https://dreamify.my.salesforce.com",
            "username": "revops@example.com",
            "account_name": "Dreamify Salesforce",
        }

        status = run(service.get_salesforce_connection_status(USER_ID))

    assert status["connected"] is True
    assert status["org_id"] == "00D123"
    assert "access_token" not in status
    assert "refresh_token" not in status
    assert "encrypted_access_token" not in status
    assert "encrypted_refresh_token" not in status


def test_salesforce_refreshes_expired_access_token():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    expired_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {
        "access_token": "new_access",
        "instance_url": "https://dreamify.my.salesforce.com",
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
            "org_id": "00D123",
        }
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=mock_client.return_value
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value.post = AsyncMock(return_value=mock_response)

        token = run(service._get_salesforce_access_token(USER_ID))

    assert token == "new_access"
    repo.upsert_provider_metadata.assert_called_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "encrypted_new_access"
    assert metadata["encrypted_refresh_token"] == "encrypted_old_refresh"
    assert metadata["org_id"] == "00D123"
    assert "access_token" not in metadata
    assert "refresh_token" not in metadata


def test_salesforce_invalid_report_type_rejected():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    with pytest.raises(HTTPException):
        service._salesforce_report_spec("tickets")


def test_salesforce_soql_rejects_unknown_object_name():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    spec = service._salesforce_report_spec("sales_pipeline")
    with pytest.raises(HTTPException):
        service._build_salesforce_soql(
            report_type="sales_pipeline",
            spec=spec,
            date_window={
                "from_iso": "2026-01-01T00:00:00Z",
                "to_iso": "2026-01-31T23:59:59Z",
            },
            owner_id="all",
            row_limit=100,
            object_name="Lead",
        )


def test_salesforce_sync_caps_rows_and_stores_manifest_without_credentials():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    service._salesforce_context = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "access_secret",
            "instance_url": "https://dreamify.my.salesforce.com",
            "api_version": "v60.0",
            "org_id": "00D123",
            "instance_domain": "dreamify.my.salesforce.com",
            "account_name": "Dreamify Salesforce",
        }
    )
    service._salesforce_rest_query_all = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "Id": "0061",
                    "Name": "Expansion",
                    "Amount": "1000",
                    "StageName": "Negotiation",
                    "OwnerId": "0051",
                    "Owner.Name": "Ava Seller",
                }
            ],
            "truncated": True,
            "api_mode": "rest",
        }
    )
    service._save_integration_asset = MagicMock(  # type: ignore[method-assign]
        return_value={
            "asset_id": "asset_1",
            "filename": "salesforce_sales_pipeline.csv",
            "size_bytes": 128,
            "extension": "csv",
            "project_id": "p1",
        }
    )

    with patch(
        "app.services.integration_service.connected_accounts_repo"
    ) as repo, patch("app.services.integration_service.assets_repo") as assets_repo:
        repo.get_connection.return_value = {
            "org_id": "00D123",
            "instance_domain": "dreamify.my.salesforce.com",
            "account_name": "Dreamify Salesforce",
        }
        result = run(
            service.fetch_salesforce_data(
                user_id=USER_ID,
                report_type="sales_pipeline",
                project_id="p1",
                date_preset="last_30d",
                object_name="Opportunity",
                owner_id="0051",
                row_limit=1,
            )
        )

    assert result["row_count"] == 1
    assert result["truncated"] is True
    update_metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    assert update_metadata["connector_key"] == "salesforce"
    assert (
        update_metadata["connector_entity_id"]
        == "salesforce:sales_pipeline:Opportunity:0051"
    )
    manifest = update_metadata["salesforce_manifest"]
    assert manifest["row_limit"] == 1
    assert manifest["row_count"] == 1
    assert manifest["api_mode"] == "rest"
    assert "access_token" not in str(manifest)
    assert "refresh_token" not in str(manifest)
