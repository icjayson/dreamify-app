"""
Tests for the sync scheduling system.
"""
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime, timedelta, timezone


# ── Scheduler service: cron expression generation ────────────────────────────

class TestBuildCronExpression:
    def _build(self, frequency, hour_utc, day_of_week):
        from app.services.scheduler_service import _build_cron_expression
        return _build_cron_expression(frequency, hour_utc, day_of_week)

    def test_daily(self):
        expr = self._build("daily", 9, 0)
        assert expr == "cron(0 9 * * ? *)"

    def test_daily_midnight(self):
        expr = self._build("daily", 0, 0)
        assert expr == "cron(0 0 * * ? *)"

    def test_weekly_monday(self):
        # Monday (0) → EventBridge DOW 2
        expr = self._build("weekly", 9, 0)
        assert expr == "cron(0 9 ? * 2 *)"

    def test_weekly_sunday(self):
        # Sunday (6) → EventBridge DOW 1
        expr = self._build("weekly", 18, 6)
        assert expr == "cron(0 18 ? * 1 *)"

    def test_biweekly(self):
        expr = self._build("biweekly", 9, 0)
        assert expr == "rate(14 days)"

    def test_invalid_frequency(self):
        with pytest.raises(ValueError):
            self._build("monthly", 9, 0)


# ── Internal trigger: date resolution ────────────────────────────────────────

class TestResolveDates:
    def _resolve(self, preset, provider="meta_ads"):
        from app.api.route_modules.internal import _resolve_dates
        return _resolve_dates(preset, provider)

    def test_ga4_uses_relative_format(self):
        start, end = self._resolve("last_7d", "ga4")
        assert start == "7daysAgo"
        assert end == "today"

    def test_ga4_last_30d(self):
        start, end = self._resolve("last_30d", "ga4")
        assert start == "30daysAgo"

    def test_other_provider_returns_iso_dates(self):
        start, end = self._resolve("last_7d", "meta_ads")
        # Should be YYYY-MM-DD format
        datetime.fromisoformat(start)
        datetime.fromisoformat(end)

    def test_date_range_is_correct_length(self):
        start, end = self._resolve("last_30d", "stripe")
        s = datetime.fromisoformat(start)
        e = datetime.fromisoformat(end)
        assert (e - s).days == 30

    def test_last_90d(self):
        start, end = self._resolve("last_90d", "tiktok")
        s = datetime.fromisoformat(start)
        e = datetime.fromisoformat(end)
        assert (e - s).days == 90


# ── Token guards ──────────────────────────────────────────────────────────────

class TestTokenGuards:
    def _service(self):
        from app.services.integration_service import IntegrationService
        return IntegrationService()

    def test_meta_raises_token_expired_when_not_connected(self):
        from app.services.integration_service import TokenExpiredError
        svc = self._service()
        with patch.object(svc, 'get_meta_connection_status', return_value={"connected": False, "reason": "expired"}):
            with pytest.raises(TokenExpiredError) as exc_info:
                svc.assert_meta_token_valid("user_123")
            assert "meta_ads" in str(exc_info.value)

    def test_meta_passes_when_connected(self):
        svc = self._service()
        with patch.object(svc, 'get_meta_connection_status', return_value={"connected": True}):
            svc.assert_meta_token_valid("user_123")  # Should not raise

    def test_tiktok_raises_token_expired_when_not_connected(self):
        from app.services.integration_service import TokenExpiredError
        svc = self._service()
        with patch.object(svc, 'get_tiktok_connection_status', return_value={"connected": False}):
            with pytest.raises(TokenExpiredError):
                svc.assert_tiktok_token_valid("user_123")

    def test_stripe_raises_when_no_record(self):
        from app.services.integration_service import TokenExpiredError
        svc = self._service()
        with patch('app.services.integration_service.connected_accounts_repo') as mock_repo:
            mock_repo.get_connection.return_value = None
            with pytest.raises(TokenExpiredError):
                svc.assert_stripe_token_valid("user_123")

    def test_appsflyer_raises_when_not_connected(self):
        from app.services.integration_service import TokenExpiredError
        svc = self._service()
        with patch.object(svc, 'get_appsflyer_connection_status', return_value={"connected": False}):
            with pytest.raises(TokenExpiredError):
                svc.assert_appsflyer_token_valid("user_123")


# ── Internal trigger endpoint ─────────────────────────────────────────────────

class TestTriggerEndpoint:
    @pytest.mark.asyncio
    async def test_trigger_rejected_without_secret(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post("/api/v1/internal/schedules/fake-id/trigger")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_trigger_returns_not_found_for_unknown_schedule(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from utils.config import config
        client = TestClient(app)
        with patch('app.api.route_modules.internal.schedules_repo') as mock_repo:
            mock_repo.get_schedule_by_id.return_value = None
            resp = client.post(
                "/api/v1/internal/schedules/nonexistent/trigger",
                headers={"X-Internal-Sync-Secret": config.scheduler.INTERNAL_SYNC_SECRET},
            )
        assert resp.status_code == 200
        assert resp.json()["status"] == "not_found"

    @pytest.mark.asyncio
    async def test_trigger_skips_paused_schedule(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from utils.config import config
        client = TestClient(app)
        with patch('app.api.route_modules.internal.schedules_repo') as mock_repo:
            mock_repo.get_schedule_by_id.return_value = {
                "schedule_id": "s1", "user_id": "u1", "provider": "stripe",
                "status": "paused", "connector_config": {}, "project_id": "p1",
                "date_range_preset": "last_30d",
            }
            resp = client.post(
                "/api/v1/internal/schedules/s1/trigger",
                headers={"X-Internal-Sync-Secret": config.scheduler.INTERNAL_SYNC_SECRET},
            )
        assert resp.status_code == 200
        assert resp.json()["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_trigger_records_token_expired_on_failure(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.integration_service import TokenExpiredError
        from utils.config import config
        client = TestClient(app)

        schedule_data = {
            "schedule_id": "s1", "user_id": "u1", "provider": "meta_ads",
            "status": "active", "connector_config": {"ad_account_id": "act_123"},
            "project_id": "p1", "date_range_preset": "last_30d",
        }
        run_data = {"schedule_id": "s1", "run_id": "r1"}

        with patch('app.api.route_modules.internal.schedules_repo') as mock_sched, \
             patch('app.api.route_modules.internal.runs_repo') as mock_runs, \
             patch('app.api.route_modules.internal._run_sync', new_callable=AsyncMock) as mock_sync:

            mock_sched.get_schedule_by_id.return_value = schedule_data
            mock_runs.create_run.return_value = run_data
            mock_sync.side_effect = TokenExpiredError("meta_ads", "token expired")

            resp = client.post(
                "/api/v1/internal/schedules/s1/trigger",
                headers={"X-Internal-Sync-Secret": config.scheduler.INTERNAL_SYNC_SECRET},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "token_expired"
        mock_runs.complete_run.assert_called_once()
        call_kwargs = mock_runs.complete_run.call_args.kwargs
        assert call_kwargs["status"] == "token_expired"


# ── Schedules CRUD validation ─────────────────────────────────────────────────

class TestScheduleValidation:
    def test_invalid_provider_rejected(self):
        from app.api.route_modules.schedules import _validate_create, CreateScheduleRequest
        from fastapi import HTTPException
        req = CreateScheduleRequest(
            provider="invalid",  # type: ignore
            connector_config={},
            project_id="p1",
            frequency="daily",
            hour_utc=9,
            day_of_week=0,
            date_range_preset="last_30d",
        )
        with pytest.raises(HTTPException) as exc_info:
            _validate_create(req)
        assert exc_info.value.status_code == 400

    def test_invalid_frequency_rejected(self):
        from app.api.route_modules.schedules import _validate_create, CreateScheduleRequest
        from fastapi import HTTPException
        req = CreateScheduleRequest(
            provider="stripe",
            connector_config={},
            project_id="p1",
            frequency="monthly",  # type: ignore
            hour_utc=9,
            day_of_week=0,
            date_range_preset="last_30d",
        )
        with pytest.raises(HTTPException):
            _validate_create(req)

    def test_valid_request_passes_validation(self):
        from app.api.route_modules.schedules import _validate_create, CreateScheduleRequest
        req = CreateScheduleRequest(
            provider="stripe",
            connector_config={"report_type": "charges"},
            project_id="p1",
            frequency="daily",
            hour_utc=9,
            day_of_week=0,
            date_range_preset="last_30d",
        )
        _validate_create(req)  # Should not raise
