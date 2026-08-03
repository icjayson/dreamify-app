import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_mixpanel_connect_encrypts_credentials_and_never_stores_plaintext():
    from app.services.mixpanel_service import (
        MixpanelAdapter,
        MixpanelProductAnalyticsService,
    )

    adapter = MixpanelAdapter()
    adapter.test_connection = AsyncMock(return_value={})  # type: ignore[method-assign]
    service = MixpanelProductAnalyticsService(adapter=adapter)

    with patch("app.services.mixpanel_service.connected_accounts_repo") as repo, patch(
        "app.services.mixpanel_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        repo.get_connection.side_effect = [
            {},
            {
                "encrypted_service_account_secret": "enc:service_secret",
                "project_id": "12345",
                "region": "US",
                "account_name": "Product Analytics",
            },
        ]

        status = run(
            service.connect(
                user_id=USER_ID,
                project_id="12345",
                service_account_username="service_user",
                service_account_secret="service_secret",
                region="US",
                account_name="Product Analytics",
            )
        )

    assert status["connected"] is True
    adapter.test_connection.assert_awaited_once_with(
        username="service_user",
        secret="service_secret",
        project_id="12345",
        region="US",
    )
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_service_account_username"] == "enc:service_user"
    assert metadata["encrypted_service_account_secret"] == "enc:service_secret"
    assert metadata["project_id"] == "12345"
    assert "service_user" not in str(
        {
            key: value
            for key, value in metadata.items()
            if not key.startswith("encrypted_")
        }
    )
    assert "service_secret" not in str(
        {
            key: value
            for key, value in metadata.items()
            if not key.startswith("encrypted_")
        }
    )


def test_mixpanel_connect_rejects_missing_credentials_and_invalid_region():
    from app.services.mixpanel_service import (
        MixpanelAdapter,
        MixpanelProductAnalyticsService,
    )

    adapter = MixpanelAdapter()
    adapter.test_connection = AsyncMock(return_value={})  # type: ignore[method-assign]
    service = MixpanelProductAnalyticsService(adapter=adapter)

    with pytest.raises(HTTPException):
        run(
            service.connect(
                user_id=USER_ID,
                project_id="12345",
                service_account_username="",
                service_account_secret="",
                region="US",
            )
        )
    with pytest.raises(HTTPException):
        run(
            service.connect(
                user_id=USER_ID,
                project_id="12345",
                service_account_username="svc",
                service_account_secret="secret",
                region="APAC",
            )
        )
    adapter.test_connection.assert_not_awaited()


def test_mixpanel_sync_saves_manifest_without_credentials_and_redacts_by_default():
    from app.services.mixpanel_service import (
        MixpanelAdapter,
        MixpanelProductAnalyticsService,
    )

    adapter = MixpanelAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "distinct_id": "user***",
                    "email": "a***@example.com",
                    "name": "***",
                    "created": "2026-06-01T00:00:00Z",
                    "last_seen": "2026-06-10T00:00:00Z",
                    "properties_json": "{}",
                }
            ],
            "api_mode": "engage",
            "endpoints_used": ["GET /engage"],
            "truncated": False,
        }
    )
    service = MixpanelProductAnalyticsService(adapter=adapter)

    with patch("app.services.mixpanel_service.connected_accounts_repo") as repo, patch(
        "app.services.mixpanel_service.assets_repo"
    ) as assets_repo, patch("app.services.mixpanel_service.upload_bytes"), patch(
        "app.services.mixpanel_service._decrypt_secret",
        side_effect=["plain_user", "plain_secret"],
    ):
        repo.get_connection.return_value = {
            "encrypted_service_account_username": "enc_user",
            "encrypted_service_account_secret": "enc_secret",
            "project_id": "12345",
            "region": "US",
            "account_name": "Product Analytics",
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "mixpanel.csv",
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
                report_type="users",
                date_preset="custom",
                start_date="2026-06-01",
                end_date="2026-06-30",
            )
        )

    assert result["entity_id"] == "mixpanel:users:12345:all"
    adapter.fetch_report_rows.assert_awaited_once()
    assert adapter.fetch_report_rows.call_args.kwargs["include_pii"] is False
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["mixpanel_manifest"]
    assert manifest["connector_key"] == "mixpanel"
    assert manifest["pii_redacted"] is True
    assert manifest["api_endpoints_used"] == ["GET /engage"]
    assert "plain_user" not in str(manifest)
    assert "plain_secret" not in str(manifest)
    assert "enc_user" not in str(manifest)
    assert "enc_secret" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_mixpanel_byte_cap_blocks_large_extract():
    from app.services.mixpanel_service import (
        MixpanelAdapter,
        MixpanelProductAnalyticsService,
    )

    adapter = MixpanelAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "distinct_id": "user_1",
                    "email": "",
                    "name": "",
                    "created": "",
                    "last_seen": "",
                    "properties_json": "x" * 2000,
                }
            ],
            "api_mode": "engage",
            "truncated": False,
        }
    )
    service = MixpanelProductAnalyticsService(adapter=adapter)

    with patch("app.services.mixpanel_service.connected_accounts_repo") as repo, patch(
        "app.services.mixpanel_service._decrypt_secret",
        side_effect=["plain_user", "plain_secret"],
    ):
        repo.get_connection.return_value = {
            "encrypted_service_account_username": "enc_user",
            "encrypted_service_account_secret": "enc_secret",
            "project_id": "12345",
            "region": "US",
            "account_name": "Product Analytics",
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


def test_mixpanel_raw_event_parser_redacts_pii_by_default():
    from app.services.mixpanel_service import MixpanelAdapter

    adapter = MixpanelAdapter()
    rows = adapter._parse_jsonl_events(
        '{"event":"Signup","properties":{"distinct_id":"user_123456","$email":"a@example.com","$insert_id":"i1","$city":"HCMC"}}',
        include_pii=False,
        row_limit=10,
    )

    assert rows[0]["event_name"] == "Signup"
    assert rows[0]["distinct_id"] == "user***"
    assert "$email" not in rows[0]["properties_json"]
    assert "a@example.com" not in rows[0]["properties_json"]


def test_mixpanel_adapter_429_uses_retry_after():
    from app.services.mixpanel_service import MixpanelAdapter

    adapter = MixpanelAdapter()
    adapter._sleep = AsyncMock()  # type: ignore[method-assign]

    class FakeResponse:
        def __init__(self, status_code, payload, headers=None):
            self.status_code = status_code
            self._payload = payload
            self.headers = headers or {}
            self.content = b"{}"
            self.text = "{}"

        def raise_for_status(self):
            if self.status_code >= 400:
                request = httpx.Request("GET", "https://mixpanel.com/api/2.0/test")
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
        "app.services.mixpanel_service.httpx.AsyncClient", return_value=FakeClient()
    ):
        payload = run(
            adapter.api_get(
                region="US",
                username="svc",
                secret="secret",
                path="/events/names",
                params={"project_id": "12345"},
            )
        )

    assert payload == {"ok": True}
    adapter._sleep.assert_awaited_once_with(2.0)


def test_mixpanel_parse_entity_id():
    from app.services.mixpanel_service import MixpanelProductAnalyticsService

    service = MixpanelProductAnalyticsService()

    assert service.parse_entity_id("mixpanel:funnels:12345:funnel_1") == {
        "report_type": "funnels",
        "project_id": "12345",
        "resource_id": "funnel_1",
    }
    with pytest.raises(HTTPException):
        service.parse_entity_id("mixpanel:bad:12345:all")
