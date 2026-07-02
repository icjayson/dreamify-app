import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_customer_io_connect_encrypts_app_api_key_and_never_stores_plaintext():
    from app.services.customer_io_service import (
        CustomerIOAdapter,
        CustomerIOLifecycleService,
    )

    adapter = CustomerIOAdapter()
    adapter.test_connection = AsyncMock(return_value={})  # type: ignore[method-assign]
    service = CustomerIOLifecycleService(adapter=adapter)

    with patch(
        "app.services.customer_io_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.customer_io_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        repo.get_connection.side_effect = [
            {},
            {
                "encrypted_app_api_key": "enc:cio_secret",
                "workspace_id": "workspace_1",
                "region": "US",
                "api_base_url": "https://api.customer.io/v1",
                "account_name": "Lifecycle",
            },
        ]

        status = run(
            service.connect(
                user_id=USER_ID,
                app_api_key="cio_secret",
                region="US",
                account_name="Lifecycle",
                workspace_id="workspace_1",
            )
        )

    assert status["connected"] is True
    adapter.test_connection.assert_awaited_once_with(
        app_api_key="cio_secret", base_url="https://api.customer.io/v1"
    )
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_app_api_key"] == "enc:cio_secret"
    assert metadata["workspace_id"] == "workspace_1"
    assert "cio_secret" not in str(
        {
            key: value
            for key, value in metadata.items()
            if not key.startswith("encrypted_")
        }
    )


def test_customer_io_connect_rejects_missing_key_region_and_base_url():
    from app.services.customer_io_service import (
        CustomerIOAdapter,
        CustomerIOLifecycleService,
    )

    adapter = CustomerIOAdapter()
    adapter.test_connection = AsyncMock(return_value={})  # type: ignore[method-assign]
    service = CustomerIOLifecycleService(adapter=adapter)

    with pytest.raises(HTTPException):
        run(service.connect(user_id=USER_ID, app_api_key="", region="US"))
    with pytest.raises(HTTPException):
        run(service.connect(user_id=USER_ID, app_api_key="cio_secret", region="APAC"))
    with pytest.raises(HTTPException):
        run(
            service.connect(
                user_id=USER_ID,
                app_api_key="cio_secret",
                region="US",
                api_base_url="http://example.com",
            )
        )
    adapter.test_connection.assert_not_awaited()


def test_customer_io_sync_saves_manifest_without_credentials_and_redacts_by_default():
    from app.services.customer_io_service import (
        CustomerIOAdapter,
        CustomerIOLifecycleService,
    )

    adapter = CustomerIOAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "person_id": "user***",
                    "email": "a***@example.com",
                    "name": "***",
                    "created_at": "2026-06-01T00:00:00Z",
                    "updated_at": "2026-06-10T00:00:00Z",
                    "last_emailed_at": "2026-06-11T00:00:00Z",
                    "attributes_json": "{}",
                }
            ],
            "api_mode": "resources",
            "endpoints_used": ["GET /customers"],
            "generated_query": "bounded people resource list",
            "truncated": False,
        }
    )
    service = CustomerIOLifecycleService(adapter=adapter)

    with patch(
        "app.services.customer_io_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.customer_io_service.assets_repo"
    ) as assets_repo, patch(
        "app.services.customer_io_service.upload_bytes"
    ), patch(
        "app.services.customer_io_service._decrypt_secret",
        return_value="plain_key",
    ):
        repo.get_connection.return_value = {
            "encrypted_app_api_key": "enc_key",
            "workspace_id": "workspace_1",
            "region": "US",
            "api_base_url": "https://api.customer.io/v1",
            "account_name": "Lifecycle",
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "customer_io.csv",
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
                report_type="people",
                date_preset="custom",
                start_date="2026-06-01",
                end_date="2026-06-30",
            )
        )

    assert result["entity_id"] == "customer_io:people:workspace_1:all"
    adapter.fetch_report_rows.assert_awaited_once()
    assert adapter.fetch_report_rows.call_args.kwargs["include_pii"] is False
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["customer_io_manifest"]
    assert manifest["connector_key"] == "customer_io"
    assert manifest["pii_redacted"] is True
    assert manifest["api_endpoints_used"] == ["GET /customers"]
    assert manifest["generated_query"] == "bounded people resource list"
    assert "plain_key" not in str(manifest)
    assert "enc_key" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_customer_io_byte_cap_blocks_large_extract():
    from app.services.customer_io_service import (
        CustomerIOAdapter,
        CustomerIOLifecycleService,
    )

    adapter = CustomerIOAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "event_id": "event_1",
                    "event_name": "Signup",
                    "person_id": "user_1",
                    "email": "user@example.com",
                    "timestamp": "2026-06-01T00:00:00Z",
                    "properties_json": "x" * 2000,
                }
            ],
            "api_mode": "resources",
            "truncated": False,
        }
    )
    service = CustomerIOLifecycleService(adapter=adapter)

    with patch(
        "app.services.customer_io_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.customer_io_service._decrypt_secret",
        return_value="plain_key",
    ):
        repo.get_connection.return_value = {
            "encrypted_app_api_key": "enc_key",
            "workspace_id": "workspace_1",
            "region": "US",
            "api_base_url": "https://api.customer.io/v1",
            "account_name": "Lifecycle",
        }

        with pytest.raises(HTTPException) as exc:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="events",
                    max_bytes=100,
                )
            )

    assert exc.value.status_code == 413


def test_customer_io_list_resources_returns_workspace_and_reports():
    from app.services.customer_io_service import (
        CustomerIOAdapter,
        CustomerIOLifecycleService,
    )

    adapter = CustomerIOAdapter()
    adapter.fetch_resources = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "campaigns": [{"id": "c1", "name": "Onboarding"}],
            "newsletters": [],
            "segments": [],
            "people": [],
        }
    )
    service = CustomerIOLifecycleService(adapter=adapter)

    with patch(
        "app.services.customer_io_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.customer_io_service._decrypt_secret", return_value="plain_key"
    ):
        repo.get_connection.return_value = {
            "encrypted_app_api_key": "enc_key",
            "workspace_id": "workspace_1",
            "region": "EU",
            "api_base_url": "https://api-eu.customer.io/v1",
            "account_name": "Lifecycle",
        }

        resources = run(service.list_resources(USER_ID))

    assert resources["workspaces"][0]["id"] == "workspace_1"
    assert resources["reports"][0]["report_type"] == "lifecycle_overview"
    assert resources["campaigns"][0]["id"] == "c1"


def test_customer_io_adapter_retries_429_with_retry_after():
    from app.services.customer_io_service import CustomerIOAdapter

    adapter = CustomerIOAdapter()
    adapter._sleep = AsyncMock()  # type: ignore[method-assign]
    http_request = httpx.Request("GET", "https://api.customer.io/v1/campaigns")
    responses = [
        httpx.Response(429, headers={"Retry-After": "0.01"}, request=http_request),
        httpx.Response(200, json={"campaigns": []}, request=http_request),
    ]
    request = AsyncMock(side_effect=responses)

    response = run(
        adapter._request_with_retries(
            request,
            "https://api.customer.io/v1/campaigns",
            max_attempts=2,
        )
    )

    assert response.status_code == 200
    adapter._sleep.assert_awaited_once()


def test_customer_io_parse_entity_id():
    from app.services.customer_io_service import CustomerIOLifecycleService

    parsed = CustomerIOLifecycleService().parse_entity_id(
        "customer_io:campaigns:workspace_1:all"
    )

    assert parsed == {
        "report_type": "campaigns",
        "workspace_id": "workspace_1",
        "resource_id": "all",
    }
