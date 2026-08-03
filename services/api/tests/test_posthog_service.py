import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_posthog_connect_encrypts_api_key_and_never_stores_plaintext():
    from app.services.posthog_service import (
        PostHogAdapter,
        PostHogProductAnalyticsService,
    )

    adapter = PostHogAdapter()
    adapter.test_connection = AsyncMock(return_value={})  # type: ignore[method-assign]
    service = PostHogProductAnalyticsService(adapter=adapter)

    with patch("app.services.posthog_service.connected_accounts_repo") as repo, patch(
        "app.services.posthog_service._encrypt_secret", lambda value: f"enc:{value}"
    ):
        repo.get_connection.side_effect = [
            {},
            {
                "encrypted_personal_api_key": "enc:phx_secret",
                "project_id": "12345",
                "region": "US",
                "base_url": "https://us.posthog.com",
                "account_name": "Product Analytics",
            },
        ]

        status = run(
            service.connect(
                user_id=USER_ID,
                project_id="12345",
                personal_api_key="phx_secret",
                region="US",
                base_url="https://us.posthog.com",
                account_name="Product Analytics",
            )
        )

    assert status["connected"] is True
    adapter.test_connection.assert_awaited_once_with(
        api_key="phx_secret",
        project_id="12345",
        base_url="https://us.posthog.com",
    )
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_personal_api_key"] == "enc:phx_secret"
    assert metadata["project_id"] == "12345"
    assert metadata["base_url"] == "https://us.posthog.com"
    assert "phx_secret" not in str(
        {
            key: value
            for key, value in metadata.items()
            if not key.startswith("encrypted_")
        }
    )


def test_posthog_connect_rejects_missing_credentials_region_and_base_url():
    from app.services.posthog_service import (
        PostHogAdapter,
        PostHogProductAnalyticsService,
    )

    adapter = PostHogAdapter()
    adapter.test_connection = AsyncMock(return_value={})  # type: ignore[method-assign]
    service = PostHogProductAnalyticsService(adapter=adapter)

    with pytest.raises(HTTPException):
        run(
            service.connect(
                user_id=USER_ID,
                project_id="",
                personal_api_key="",
                region="US",
            )
        )
    with pytest.raises(HTTPException):
        run(
            service.connect(
                user_id=USER_ID,
                project_id="12345",
                personal_api_key="phx_secret",
                region="APAC",
            )
        )
    with pytest.raises(HTTPException):
        run(
            service.connect(
                user_id=USER_ID,
                project_id="12345",
                personal_api_key="phx_secret",
                region="US",
                base_url="http://example.com",
            )
        )
    adapter.test_connection.assert_not_awaited()


def test_posthog_sync_saves_manifest_without_credentials_and_redacts_by_default():
    from app.services.posthog_service import (
        PostHogAdapter,
        PostHogProductAnalyticsService,
    )

    adapter = PostHogAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "event_time": "2026-06-01T00:00:00Z",
                    "event_name": "Signup",
                    "distinct_id": "user***",
                    "uuid": "event_1",
                    "properties_json": "{}",
                }
            ],
            "api_mode": "query_api",
            "endpoints_used": ["POST /api/projects/12345/query/"],
            "generated_query": "bounded events query for all",
            "truncated": False,
        }
    )
    service = PostHogProductAnalyticsService(adapter=adapter)

    with patch("app.services.posthog_service.connected_accounts_repo") as repo, patch(
        "app.services.posthog_service.assets_repo"
    ) as assets_repo, patch("app.services.posthog_service.upload_bytes"), patch(
        "app.services.posthog_service._decrypt_secret",
        return_value="plain_key",
    ):
        repo.get_connection.return_value = {
            "encrypted_personal_api_key": "enc_key",
            "project_id": "12345",
            "region": "US",
            "base_url": "https://us.posthog.com",
            "account_name": "Product Analytics",
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "posthog.csv",
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
                report_type="events",
                date_preset="custom",
                start_date="2026-06-01",
                end_date="2026-06-30",
            )
        )

    assert result["entity_id"] == "posthog:events:12345:all"
    adapter.fetch_report_rows.assert_awaited_once()
    assert adapter.fetch_report_rows.call_args.kwargs["include_pii"] is False
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["posthog_manifest"]
    assert manifest["connector_key"] == "posthog"
    assert manifest["pii_redacted"] is True
    assert manifest["api_endpoints_used"] == ["POST /api/projects/12345/query/"]
    assert manifest["generated_query"] == "bounded events query for all"
    assert "plain_key" not in str(manifest)
    assert "enc_key" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_posthog_byte_cap_blocks_large_extract():
    from app.services.posthog_service import (
        PostHogAdapter,
        PostHogProductAnalyticsService,
    )

    adapter = PostHogAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "event_time": "2026-06-01T00:00:00Z",
                    "event_name": "Signup",
                    "distinct_id": "user_1",
                    "uuid": "event_1",
                    "properties_json": "x" * 2000,
                }
            ],
            "api_mode": "query_api",
            "truncated": False,
        }
    )
    service = PostHogProductAnalyticsService(adapter=adapter)

    with patch("app.services.posthog_service.connected_accounts_repo") as repo, patch(
        "app.services.posthog_service._decrypt_secret",
        return_value="plain_key",
    ):
        repo.get_connection.return_value = {
            "encrypted_personal_api_key": "enc_key",
            "project_id": "12345",
            "region": "US",
            "base_url": "https://us.posthog.com",
            "account_name": "Product Analytics",
        }
        with pytest.raises(HTTPException) as exc_info:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="events",
                    max_bytes=32,
                )
            )

    assert exc_info.value.status_code == 413


def test_posthog_generated_hogql_uses_values_not_raw_user_query():
    from app.services.posthog_service import PostHogAdapter

    adapter = PostHogAdapter()
    query, values = adapter._generated_hogql(
        "events",
        {"from": "2026-06-01", "to": "2026-06-30"},
        100,
        "Signup'); DROP TABLE events; --",
    )

    assert "DROP TABLE" not in query
    assert "Signup" not in query
    assert values["event"] == "Signup'); DROP TABLE events; --"
    assert "%(event)s" in query
    with pytest.raises(HTTPException):
        adapter._generated_hogql(
            "jql",
            {"from": "2026-06-01", "to": "2026-06-30"},
            100,
            "all",
        )


def test_posthog_query_response_redacts_pii_by_default():
    from app.services.posthog_service import PostHogAdapter

    adapter = PostHogAdapter()
    rows = adapter._rows_from_query_response(
        {
            "columns": ["timestamp", "event", "distinct_id", "uuid", "properties"],
            "results": [
                [
                    "2026-06-01T00:00:00Z",
                    "Signup",
                    "user_123456",
                    "event_1",
                    {"email": "a@example.com", "plan": "pro"},
                ]
            ],
        },
        "events",
        include_pii=False,
    )

    assert rows[0]["event_name"] == "Signup"
    assert rows[0]["distinct_id"] == "user***"
    assert "a@example.com" not in rows[0]["properties_json"]
    assert "plan" in rows[0]["properties_json"]


def test_posthog_adapter_429_uses_retry_after():
    from app.services.posthog_service import PostHogAdapter

    adapter = PostHogAdapter()
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
                request = httpx.Request("GET", "https://us.posthog.com/api/test")
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
        "app.services.posthog_service.httpx.AsyncClient", return_value=FakeClient()
    ):
        payload = run(
            adapter.api_get(
                base_url="https://us.posthog.com",
                api_key="phx_secret",
                path="/api/test",
            )
        )

    assert payload == {"ok": True}
    adapter._sleep.assert_awaited_once_with(2.0)


def test_posthog_parse_entity_id():
    from app.services.posthog_service import PostHogProductAnalyticsService

    service = PostHogProductAnalyticsService()

    assert service.parse_entity_id("posthog:feature_flags:12345:flag_1") == {
        "report_type": "feature_flags",
        "project_id": "12345",
        "resource_id": "flag_1",
    }
    with pytest.raises(HTTPException):
        service.parse_entity_id("posthog:jql:12345:all")
