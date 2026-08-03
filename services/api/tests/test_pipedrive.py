import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_pipedrive_state_rejects_tampering():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    state = service._make_pipedrive_state(USER_ID)
    assert service._verify_pipedrive_state(state) == USER_ID

    tampered = state.replace(USER_ID, "other_user", 1)
    with pytest.raises(ValueError):
        service._verify_pipedrive_state(tampered)


def test_pipedrive_status_never_returns_tokens():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    with patch("app.services.integration_service.connected_accounts_repo") as repo:
        repo.get_connection.return_value = {
            "encrypted_access_token": "encrypted_access_secret",
            "encrypted_refresh_token": "encrypted_refresh_secret",
            "company_id": "123",
            "company_domain": "dreamify.pipedrive.com",
            "company_name": "Dreamify CRM",
            "account_name": "Dreamify CRM",
        }

        status = run(service.get_pipedrive_connection_status(USER_ID))

    assert status["connected"] is True
    assert status["company_id"] == "123"
    assert "access_token" not in status
    assert "refresh_token" not in status
    assert "encrypted_access_token" not in status
    assert "encrypted_refresh_token" not in status


def test_pipedrive_refreshes_expired_access_token_with_basic_auth():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    expired_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {
        "access_token": "new_access",
        "refresh_token": "new_refresh",
        "expires_in": 3599,
        "api_domain": "https://dreamify.pipedrive.com",
    }

    with patch(
        "app.services.integration_service.connected_accounts_repo"
    ) as repo, patch("httpx.AsyncClient") as mock_client, patch(
        "app.services.integration_service._decrypt_secret"
    ) as decrypt_secret, patch(
        "app.services.integration_service._encrypt_secret"
    ) as encrypt_secret, patch.dict(
        "os.environ",
        {"PIPEDRIVE_CLIENT_ID": "cid", "PIPEDRIVE_CLIENT_SECRET": "secret"},
    ):
        decrypt_secret.side_effect = {
            "encrypted_old_access": "old_access",
            "encrypted_old_refresh": "old_refresh",
        }.__getitem__
        encrypt_secret.side_effect = lambda value: f"encrypted_{value}"
        repo.get_connection.return_value = {
            "encrypted_access_token": "encrypted_old_access",
            "encrypted_refresh_token": "encrypted_old_refresh",
            "expires_at": expired_at,
            "company_id": "123",
        }
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=mock_client.return_value
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value.post = AsyncMock(return_value=mock_response)

        token = run(service._get_pipedrive_access_token(USER_ID))

    assert token == "new_access"
    headers = mock_client.return_value.post.call_args.kwargs["headers"]
    assert headers["Authorization"].startswith("Basic ")
    repo.upsert_provider_metadata.assert_called_once()
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "encrypted_new_access"
    assert metadata["encrypted_refresh_token"] == "encrypted_new_refresh"
    assert metadata["company_id"] == "123"
    assert metadata["api_base_url"] == "https://dreamify.pipedrive.com/api/v1"
    assert "access_token" not in metadata
    assert "refresh_token" not in metadata


def test_pipedrive_invalid_report_type_rejected():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    with pytest.raises(HTTPException):
        service._pipedrive_report_spec("tickets")


def test_pipedrive_invalid_object_name_rejected():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    with pytest.raises(HTTPException):
        service._pipedrive_validate_object_name("unsafe;drop")


def test_pipedrive_request_retries_429_once():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    rate_limited = MagicMock(status_code=429, headers={"Retry-After": "0"})
    ok = MagicMock(status_code=200, headers={})
    ok.json.return_value = {"success": True, "data": [{"id": 1}]}
    ok.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client, patch(
        "app.services.integration_service.asyncio.sleep", new_callable=AsyncMock
    ) as sleep_mock:
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=mock_client.return_value
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value.request = AsyncMock(side_effect=[rate_limited, ok])

        result = run(
            service._pipedrive_request(
                {
                    "access_token": "access_secret",
                    "api_base_url": "https://api.pipedrive.com/api/v1",
                },
                "deals/collection",
                params={"limit": 1},
            )
        )

    assert result["success"] is True
    assert sleep_mock.await_count == 1
    assert mock_client.return_value.request.await_count == 2


def test_pipedrive_sync_caps_rows_and_stores_manifest_without_credentials():
    from app.services.integration_service import IntegrationService

    service = IntegrationService()
    service._pipedrive_context = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "access_secret",
            "api_base_url": "https://dreamify.pipedrive.com/api/v1",
            "company_id": "123",
            "company_domain": "dreamify.pipedrive.com",
            "company_name": "Dreamify CRM",
            "account_name": "Dreamify CRM",
        }
    )
    service.fetch_pipedrive_pipelines = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            {
                "id": "10",
                "label": "Sales Pipeline",
                "stages": [{"id": "20", "label": "Qualified", "probability": 50}],
            }
        ]
    )
    service.fetch_pipedrive_users = AsyncMock(  # type: ignore[method-assign]
        return_value=[{"id": "42", "name": "Ava Seller", "email": "ava@example.com"}]
    )
    service.fetch_pipedrive_fields = AsyncMock(  # type: ignore[method-assign]
        return_value=[{"key": "custom_source", "name": "Source", "field_type": "text"}]
    )
    service._pipedrive_get_paginated = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "id": "1",
                    "title": "Expansion",
                    "value": "1000",
                    "currency": "USD",
                    "status": "open",
                    "pipeline_id": "10",
                    "stage_id": "20",
                    "user_id": "42",
                    "pipeline_label": "Sales Pipeline",
                    "stage_label": "Qualified",
                    "owner_name": "Ava Seller",
                    "weighted_value": "500.00",
                    "organization_name": "Acme",
                    "person_name": "Jane Buyer",
                }
            ],
            "truncated": True,
        }
    )
    service._save_integration_asset = MagicMock(  # type: ignore[method-assign]
        return_value={
            "asset_id": "asset_1",
            "filename": "pipedrive_sales_pipeline.csv",
            "size_bytes": 128,
            "extension": "csv",
            "project_id": "p1",
        }
    )

    with patch(
        "app.services.integration_service.connected_accounts_repo"
    ) as repo, patch("app.services.integration_service.assets_repo") as assets_repo:
        repo.get_connection.return_value = {
            "company_id": "123",
            "company_domain": "dreamify.pipedrive.com",
            "company_name": "Dreamify CRM",
            "account_name": "Dreamify CRM",
        }
        result = run(
            service.fetch_pipedrive_data(
                user_id=USER_ID,
                report_type="sales_pipeline",
                project_id="p1",
                date_preset="last_30d",
                pipeline_id="10",
                owner_id="42",
                row_limit=1,
            )
        )

    assert result["row_count"] == 1
    assert result["truncated"] is True
    update_metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    assert update_metadata["connector_key"] == "pipedrive"
    assert update_metadata["connector_entity_id"] == "pipedrive:sales_pipeline:10:42"
    manifest = update_metadata["pipedrive_manifest"]
    assert manifest["row_limit"] == 1
    assert manifest["row_count"] == 1
    assert manifest["company_domain"] == "dreamify.pipedrive.com"
    assert manifest["custom_field_label_mapping"]["custom_source"] == "Source"
    assert "access_token" not in str(manifest)
    assert "refresh_token" not in str(manifest)
