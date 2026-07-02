import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_google_search_console_oauth_state_rejects_tampering():
    from app.services.google_search_console_service import (
        GoogleSearchConsoleMarketingService,
    )

    service = GoogleSearchConsoleMarketingService()
    state = service._make_state_payload(USER_ID)

    with pytest.raises(ValueError):
        service._verify_state(f"{state}x")


def test_google_search_console_callback_encrypts_tokens_and_never_stores_plaintext():
    from app.services.google_search_console_service import (
        GoogleSearchConsoleAdapter,
        GoogleSearchConsoleMarketingService,
    )

    adapter = GoogleSearchConsoleAdapter()
    adapter.exchange_token = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "access_token": "access_secret",
            "refresh_token": "refresh_secret",
            "expires_in": 3600,
            "scope": "https://www.googleapis.com/auth/webmasters.readonly",
        }
    )
    adapter.fetch_sites = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            {
                "site_url": "https://example.com/",
                "site_key": "site_key",
                "permission_level": "siteFullUser",
            }
        ]
    )
    service = GoogleSearchConsoleMarketingService(adapter=adapter)

    with patch.dict(
        "os.environ",
        {
            "GOOGLE_SEARCH_CONSOLE_CLIENT_ID": "client_id",
            "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET": "client_secret",
            "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI": "https://api.example.com/callback",
        },
    ), patch(
        "app.services.google_search_console_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.google_search_console_service._encrypt_secret",
        lambda value: f"enc:{value}",
    ):
        state = service._make_state_payload(USER_ID)
        repo.get_connection.return_value = {
            "pending_oauth_states": {state: {"created_at": 1}}
        }

        run(service.handle_oauth_callback(code="code", state=state))

    adapter.exchange_token.assert_awaited_once()
    adapter.fetch_sites.assert_awaited_once_with(access_token="access_secret")
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["encrypted_access_token"] == "enc:access_secret"
    assert metadata["encrypted_refresh_token"] == "enc:refresh_secret"
    assert "access_secret" not in str(
        {
            key: value
            for key, value in metadata.items()
            if not key.startswith("encrypted_")
        }
    )
    assert "refresh_secret" not in str(
        {
            key: value
            for key, value in metadata.items()
            if not key.startswith("encrypted_")
        }
    )


def test_google_search_console_sync_saves_manifest_without_credentials():
    from app.services.google_search_console_service import (
        GoogleSearchConsoleAdapter,
        GoogleSearchConsoleMarketingService,
        site_key_for_url,
    )

    site_url = "https://example.com/"
    site_key = site_key_for_url(site_url)
    adapter = GoogleSearchConsoleAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "site_url": site_url,
                    "query": "dreamify",
                    "search_type": "web",
                    "clicks": 10,
                    "impressions": 100,
                    "ctr": 0.1,
                    "position": 3.2,
                }
            ],
            "api_mode": "search_analytics",
            "endpoints_used": ["POST /sites/example/searchAnalytics/query"],
            "generated_query": '{"dimensions":["query"]}',
            "truncated": False,
        }
    )
    service = GoogleSearchConsoleMarketingService(adapter=adapter)

    with patch(
        "app.services.google_search_console_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.google_search_console_service.assets_repo"
    ) as assets_repo, patch(
        "app.services.google_search_console_service.upload_bytes"
    ), patch(
        "app.services.google_search_console_service._decrypt_secret",
        return_value="plain_access_token",
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_access",
            "encrypted_refresh_token": "enc_refresh",
            "expires_at": "2999-01-01T00:00:00+00:00",
            "account_name": "Google Search Console",
            "sites": [
                {
                    "site_url": site_url,
                    "site_key": site_key,
                    "permission_level": "siteFullUser",
                }
            ],
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "gsc.csv",
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
                report_type="queries",
                site_key=site_key,
                search_type="web",
                date_preset="custom",
                start_date="2026-06-01",
                end_date="2026-06-30",
            )
        )

    assert result["entity_id"] == f"google_search_console:queries:{site_key}:web"
    adapter.fetch_report_rows.assert_awaited_once()
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["google_search_console_manifest"]
    assert manifest["connector_key"] == "google_search_console"
    assert manifest["site_url"] == site_url
    assert manifest["dimensions"] == ["query"]
    assert manifest["api_endpoints_used"] == [
        "POST /sites/example/searchAnalytics/query"
    ]
    assert "plain_access_token" not in str(manifest)
    assert "enc_access" not in str(manifest)
    assert "enc_refresh" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_google_search_console_byte_cap_blocks_large_extract():
    from app.services.google_search_console_service import (
        GoogleSearchConsoleAdapter,
        GoogleSearchConsoleMarketingService,
        site_key_for_url,
    )

    site_url = "https://example.com/"
    adapter = GoogleSearchConsoleAdapter()
    adapter.fetch_report_rows = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "rows": [
                {
                    "site_url": site_url,
                    "page": "https://example.com/" + ("x" * 2000),
                    "search_type": "web",
                    "clicks": 1,
                    "impressions": 2,
                    "ctr": 0.5,
                    "position": 1,
                }
            ],
            "api_mode": "search_analytics",
            "truncated": False,
        }
    )
    service = GoogleSearchConsoleMarketingService(adapter=adapter)

    with patch(
        "app.services.google_search_console_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.google_search_console_service._decrypt_secret",
        return_value="plain_access_token",
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_access",
            "expires_at": "2999-01-01T00:00:00+00:00",
            "sites": [
                {
                    "site_url": site_url,
                    "site_key": site_key_for_url(site_url),
                    "permission_level": "siteFullUser",
                }
            ],
        }

        with pytest.raises(HTTPException) as exc:
            run(
                service.sync(
                    user_id=USER_ID,
                    project_id="p1",
                    report_type="pages",
                    site_url=site_url,
                    max_bytes=100,
                )
            )

    assert exc.value.status_code == 413


def test_google_search_console_list_resources_returns_sites_and_reports():
    from app.services.google_search_console_service import (
        GoogleSearchConsoleAdapter,
        GoogleSearchConsoleMarketingService,
        site_key_for_url,
    )

    site_url = "sc-domain:example.com"
    adapter = GoogleSearchConsoleAdapter()
    adapter.fetch_sites = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            {
                "site_url": site_url,
                "site_key": site_key_for_url(site_url),
                "permission_level": "siteOwner",
            }
        ]
    )
    service = GoogleSearchConsoleMarketingService(adapter=adapter)

    with patch(
        "app.services.google_search_console_service.connected_accounts_repo"
    ) as repo, patch(
        "app.services.google_search_console_service._decrypt_secret",
        return_value="plain_access_token",
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_access",
            "expires_at": "2999-01-01T00:00:00+00:00",
            "account_name": "GSC",
        }

        resources = run(service.list_resources(USER_ID))

    assert resources["sites"][0]["site_url"] == site_url
    assert resources["reports"][0]["report_type"] == "search_overview"
    assert resources["search_types"][0]["id"] == "web"
    repo.upsert_provider_metadata.assert_called()


def test_google_search_console_adapter_retries_429_with_retry_after():
    from app.services.google_search_console_service import GoogleSearchConsoleAdapter

    adapter = GoogleSearchConsoleAdapter()
    adapter._sleep = AsyncMock()  # type: ignore[method-assign]
    http_request = httpx.Request(
        "GET", "https://www.googleapis.com/webmasters/v3/sites"
    )
    responses = [
        httpx.Response(429, headers={"Retry-After": "0.01"}, request=http_request),
        httpx.Response(200, json={"siteEntry": []}, request=http_request),
    ]
    request = AsyncMock(side_effect=responses)

    response = run(
        adapter._request_with_retries(
            request,
            "https://www.googleapis.com/webmasters/v3/sites",
            max_attempts=2,
        )
    )

    assert response.status_code == 200
    adapter._sleep.assert_awaited_once()


def test_google_search_console_parse_entity_id():
    from app.services.google_search_console_service import (
        GoogleSearchConsoleMarketingService,
        site_key_for_url,
    )

    site_url = "https://example.com/"
    site_key = site_key_for_url(site_url)
    parsed = GoogleSearchConsoleMarketingService().parse_entity_id(
        f"google_search_console:query_page:{site_key}:image"
    )

    assert parsed == {
        "report_type": "query_page",
        "site_key": site_key,
        "site_url": site_url,
        "search_type": "image",
    }
