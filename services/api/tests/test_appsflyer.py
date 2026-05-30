import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


USER_ID = "test_user_123"


def run(coro):
    """Run an async coroutine in a synchronous test."""
    return asyncio.run(coro)


def test_validate_valid_token():
    """Valid token should be saved and return True."""
    from app.services.integration_service import IntegrationService

    service = IntegrationService()

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "apps": [
            {"app_id": "com.example.app", "app_name": "Test App", "platform": "android"}
        ]
    }

    with patch(
        "app.services.integration_service.connected_accounts_repo"
    ) as mock_repo, patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=mock_client.return_value
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value.get = AsyncMock(return_value=mock_response)

        result = run(
            service.validate_and_save_appsflyer_token(USER_ID, "valid_token_123")
        )

        assert result is True
        mock_repo.save_connection.assert_called_once()


def test_validate_invalid_token():
    """Invalid token should raise HTTPException with status 400."""
    from fastapi import HTTPException

    from app.services.integration_service import IntegrationService

    service = IntegrationService()

    mock_response = MagicMock()
    mock_response.status_code = 401

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=mock_client.return_value
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value.get = AsyncMock(return_value=mock_response)

        with pytest.raises(HTTPException) as exc_info:
            run(service.validate_and_save_appsflyer_token(USER_ID, "bad_token"))

        assert exc_info.value.status_code == 400


def test_disconnect_removes_token():
    """Disconnect should call delete_connection with the correct provider."""
    from app.services.integration_service import IntegrationService

    service = IntegrationService()

    with patch("app.services.integration_service.connected_accounts_repo") as mock_repo:
        run(service.disconnect_appsflyer(USER_ID))
        mock_repo.delete_connection.assert_called_once_with(USER_ID, "appsflyer")


def test_fetch_apps_no_token():
    """Fetching apps without a saved token should raise HTTPException 401."""
    from fastapi import HTTPException

    from app.services.integration_service import IntegrationService

    service = IntegrationService()

    with patch("app.services.integration_service.connected_accounts_repo") as mock_repo:
        mock_repo.get_connection.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            run(service.fetch_appsflyer_apps(USER_ID))

        assert exc_info.value.status_code == 401


def test_get_connection_status_no_token():
    """Status check with no stored token should return connected: False."""
    from app.services.integration_service import IntegrationService

    service = IntegrationService()

    with patch("app.services.integration_service.connected_accounts_repo") as mock_repo:
        mock_repo.get_connection.return_value = None
        result = run(service.get_appsflyer_connection_status(USER_ID))
        assert result == {"connected": False}


def test_get_connection_status_with_token():
    """Status check with a stored token should return connected: True."""
    from app.services.integration_service import IntegrationService

    service = IntegrationService()

    with patch("app.services.integration_service.connected_accounts_repo") as mock_repo:
        mock_repo.get_connection.return_value = {
            "access_token": "some_token",
            "expires_at": "2036-01-01",
        }
        result = run(service.get_appsflyer_connection_status(USER_ID))
        assert result == {"connected": True}
