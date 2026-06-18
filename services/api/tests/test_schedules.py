"""
Tests for the sync scheduling system.
"""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime, timedelta, timezone
import json
import asyncio


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

    def test_lambda_target_payload(self):
        from app.services.scheduler_service import _build_target
        from utils.config import config

        with patch.object(
            config.scheduler,
            "EVENTBRIDGE_ROLE_ARN",
            "arn:aws:iam::123456789012:role/SchedulerRole",
        ), patch.object(
            config.scheduler,
            "TARGET_LAMBDA_ARN",
            "arn:aws:lambda:ap-southeast-1:123456789012:function:dreamify-sync-bridge",
        ):
            target = _build_target("schedule-123")

        assert target["Arn"] == "arn:aws:scheduler:::aws-sdk:lambda:invoke"
        assert target["RoleArn"].endswith(":role/SchedulerRole")
        payload = json.loads(target["Input"])
        assert payload["FunctionName"].endswith(":function:dreamify-sync-bridge")
        assert payload["InvocationType"] == "Event"
        assert json.loads(payload["Payload"]) == {"schedule_id": "schedule-123"}

    def test_lambda_target_requires_config(self):
        from app.services.scheduler_service import _build_target
        from utils.config import config

        with patch.object(config.scheduler, "EVENTBRIDGE_ROLE_ARN", ""), patch.object(
            config.scheduler, "TARGET_LAMBDA_ARN", ""
        ):
            with pytest.raises(RuntimeError):
                _build_target("schedule-123")


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
        with patch.object(
            svc,
            "get_meta_connection_status",
            return_value={"connected": False, "reason": "expired"},
        ):
            with pytest.raises(TokenExpiredError) as exc_info:
                svc.assert_meta_token_valid("user_123")
            assert "meta_ads" in str(exc_info.value)

    def test_meta_passes_when_connected(self):
        svc = self._service()
        with patch.object(
            svc, "get_meta_connection_status", return_value={"connected": True}
        ):
            svc.assert_meta_token_valid("user_123")  # Should not raise

    def test_tiktok_raises_token_expired_when_not_connected(self):
        from app.services.integration_service import TokenExpiredError

        svc = self._service()
        with patch.object(
            svc, "get_tiktok_connection_status", return_value={"connected": False}
        ):
            with pytest.raises(TokenExpiredError):
                svc.assert_tiktok_token_valid("user_123")

    def test_stripe_raises_when_no_record(self):
        from app.services.integration_service import TokenExpiredError

        svc = self._service()
        with patch(
            "app.services.integration_service.connected_accounts_repo"
        ) as mock_repo:
            mock_repo.get_connection.return_value = None
            with pytest.raises(TokenExpiredError):
                svc.assert_stripe_token_valid("user_123")

    def test_appsflyer_raises_when_not_connected(self):
        from app.services.integration_service import TokenExpiredError

        svc = self._service()
        with patch(
            "app.services.integration_service.connected_accounts_repo"
        ) as mock_repo:
            mock_repo.get_connection.return_value = None
            with pytest.raises(TokenExpiredError):
                svc.assert_appsflyer_token_valid("user_123")


# ── Internal trigger endpoint ─────────────────────────────────────────────────


class TestTriggerEndpoint:
    def test_trigger_rejected_without_secret(self):
        from fastapi import HTTPException
        from app.api.route_modules.internal import trigger_schedule

        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(trigger_schedule("fake-id"))
        assert exc_info.value.status_code == 403

    def test_trigger_returns_not_found_for_unknown_schedule(self):
        from app.api.route_modules.internal import trigger_schedule
        from utils.config import config

        with patch("app.api.route_modules.internal.schedules_repo") as mock_repo:
            mock_repo.get_schedule_by_id.return_value = None
            resp = asyncio.run(
                trigger_schedule(
                    "nonexistent",
                    x_internal_sync_secret=config.scheduler.INTERNAL_SYNC_SECRET,
                )
            )
        assert resp["status"] == "not_found"

    def test_trigger_skips_paused_schedule(self):
        from app.api.route_modules.internal import trigger_schedule
        from utils.config import config

        with patch("app.api.route_modules.internal.schedules_repo") as mock_repo:
            mock_repo.get_schedule_by_id.return_value = {
                "schedule_id": "s1",
                "user_id": "u1",
                "provider": "stripe",
                "status": "paused",
                "connector_config": {},
                "project_id": "p1",
                "date_range_preset": "last_30d",
            }
            resp = asyncio.run(
                trigger_schedule(
                    "s1",
                    x_internal_sync_secret=config.scheduler.INTERNAL_SYNC_SECRET,
                )
            )
        assert resp["status"] == "skipped"

    def test_trigger_records_token_expired_on_failure(self):
        from app.api.route_modules.internal import trigger_schedule
        from app.services.integration_service import TokenExpiredError
        from utils.config import config

        schedule_data = {
            "schedule_id": "s1",
            "user_id": "u1",
            "provider": "meta_ads",
            "status": "active",
            "connector_config": {"ad_account_id": "act_123"},
            "project_id": "p1",
            "date_range_preset": "last_30d",
        }
        run_data = {"schedule_id": "s1", "run_id": "r1"}

        with patch(
            "app.api.route_modules.internal.schedules_repo"
        ) as mock_sched, patch(
            "app.api.route_modules.internal.runs_repo"
        ) as mock_runs, patch(
            "app.api.route_modules.internal._run_sync", new_callable=AsyncMock
        ) as mock_sync:

            mock_sched.get_schedule_by_id.return_value = schedule_data
            mock_runs.create_run.return_value = run_data
            mock_sync.side_effect = TokenExpiredError("meta_ads", "token expired")

            resp = asyncio.run(
                trigger_schedule(
                    "s1",
                    x_internal_sync_secret=config.scheduler.INTERNAL_SYNC_SECRET,
                )
            )

        assert resp["status"] == "token_expired"
        mock_runs.complete_run.assert_called_once()
        call_kwargs = mock_runs.complete_run.call_args.kwargs
        assert call_kwargs["status"] == "token_expired"

    def test_run_now_checks_ownership_and_executes(self):
        from app.api.route_modules.schedules import run_schedule_now

        with patch(
            "app.api.route_modules.schedules.schedules_repo"
        ) as mock_sched, patch(
            "app.api.route_modules.internal.execute_schedule", new_callable=AsyncMock
        ) as mock_execute:
            mock_sched.get_schedule.return_value = {
                "schedule_id": "s1",
                "user_id": "u1",
            }
            mock_execute.return_value = {"status": "success", "run_id": "r1"}
            resp = asyncio.run(run_schedule_now("s1", user_id="u1"))

        assert resp["status"] == "success"
        mock_sched.get_schedule.assert_called_once_with("u1", "s1")
        mock_execute.assert_awaited_once_with("s1")

    def test_run_sync_dispatches_warehouse_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.warehouse_service.warehouse_service"
        ) as mock_warehouse:
            mock_warehouse.sync_scheduled_table.return_value = {
                "success": True,
                "row_count": 3,
                "column_count": 2,
                "asset": {"asset_id": "asset_1"},
            }
            result = asyncio.run(
                _run_sync(
                    provider="warehouse",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "connection_id": "conn_123",
                        "schema": "public",
                        "table": "orders",
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 3
        mock_warehouse.sync_scheduled_table.assert_called_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "connection_id": "conn_123",
                "schema": "public",
                "table": "orders",
            },
        )

    def test_run_sync_dispatches_hubspot_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.integration_service.integration_service"
        ) as mock_service:
            mock_service.assert_hubspot_token_valid = MagicMock()
            mock_service.fetch_hubspot_data = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 4,
                    "column_count": 8,
                    "asset": {"asset_id": "asset_hubspot"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="hubspot",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_pipeline",
                        "pipeline_id": "default",
                        "owner_id": "42",
                        "row_limit": 2500,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 4
        mock_service.assert_hubspot_token_valid.assert_called_once_with("u1")
        mock_service.fetch_hubspot_data.assert_awaited_once_with(
            user_id="u1",
            report_type="sales_pipeline",
            project_id="p1",
            date_preset="last_30d",
            start_date="2026-01-01",
            end_date="2026-01-31",
            pipeline_id="default",
            owner_id="42",
            row_limit=2500,
            include_associations=True,
        )

    def test_run_sync_dispatches_salesforce_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.integration_service.integration_service"
        ) as mock_service:
            mock_service.assert_salesforce_token_valid = MagicMock()
            mock_service.fetch_salesforce_data = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 5,
                    "column_count": 9,
                    "asset": {"asset_id": "asset_salesforce"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="salesforce",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_pipeline",
                        "object_name": "Opportunity",
                        "owner_id": "0051",
                        "row_limit": 2500,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 5
        mock_service.assert_salesforce_token_valid.assert_called_once_with("u1")
        mock_service.fetch_salesforce_data.assert_awaited_once_with(
            user_id="u1",
            report_type="sales_pipeline",
            project_id="p1",
            date_preset="last_30d",
            start_date="2026-01-01",
            end_date="2026-01-31",
            object_name="Opportunity",
            owner_id="0051",
            row_limit=2500,
        )

    def test_run_sync_dispatches_pipedrive_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.integration_service.integration_service"
        ) as mock_service:
            mock_service.assert_pipedrive_token_valid = MagicMock()
            mock_service.fetch_pipedrive_data = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 6,
                    "column_count": 10,
                    "asset": {"asset_id": "asset_pipedrive"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="pipedrive",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_pipeline",
                        "pipeline_id": "10",
                        "owner_id": "42",
                        "row_limit": 2500,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 6
        mock_service.assert_pipedrive_token_valid.assert_called_once_with("u1")
        mock_service.fetch_pipedrive_data.assert_awaited_once_with(
            user_id="u1",
            report_type="sales_pipeline",
            project_id="p1",
            date_preset="last_30d",
            start_date="2026-01-01",
            end_date="2026-01-31",
            pipeline_id="10",
            owner_id="42",
            row_limit=2500,
        )

    def test_run_sync_dispatches_shopify_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch("app.services.shopify_service.shopify_service") as mock_shopify:
            mock_shopify.sync_scheduled_entity = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 7,
                    "column_count": 25,
                    "asset": {"asset_id": "asset_shopify"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="shopify",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_overview",
                        "shop_domain": "demo.myshopify.com",
                        "resource": "orders",
                        "row_limit": 3000,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 7
        mock_shopify.sync_scheduled_entity.assert_awaited_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "report_type": "sales_overview",
                "shop_domain": "demo.myshopify.com",
                "resource": "orders",
                "row_limit": 3000,
            },
            start_date="2026-01-01",
            end_date="2026-01-31",
            date_range_preset="last_30d",
        )

    def test_run_sync_dispatches_klaviyo_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch("app.services.klaviyo_service.klaviyo_service") as mock_klaviyo:
            mock_klaviyo.sync_scheduled_entity = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 8,
                    "column_count": 12,
                    "asset": {"asset_id": "asset_klaviyo"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="klaviyo",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "lifecycle_overview",
                        "account_id": "acct_1",
                        "resource_id": "all",
                        "metric_id": "metric_placed_order",
                        "row_limit": 5000,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 8
        mock_klaviyo.sync_scheduled_entity.assert_awaited_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "report_type": "lifecycle_overview",
                "account_id": "acct_1",
                "resource_id": "all",
                "metric_id": "metric_placed_order",
                "row_limit": 5000,
            },
            start_date="2026-01-01",
            end_date="2026-01-31",
            date_range_preset="last_30d",
        )

    def test_run_sync_dispatches_quickbooks_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch("app.services.quickbooks_service.quickbooks_service") as mock_quickbooks:
            mock_quickbooks.sync_scheduled_entity = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 13,
                    "column_count": 17,
                    "asset": {"asset_id": "asset_quickbooks"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="quickbooks",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "finance_overview",
                        "realm_id": "realm_1",
                        "resource_id": "all",
                        "accounting_basis": "Accrual",
                        "row_limit": 5000,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 13
        mock_quickbooks.sync_scheduled_entity.assert_awaited_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "report_type": "finance_overview",
                "realm_id": "realm_1",
                "resource_id": "all",
                "accounting_basis": "Accrual",
                "row_limit": 5000,
            },
            start_date="2026-01-01",
            end_date="2026-01-31",
            date_range_preset="last_30d",
        )

    def test_run_sync_dispatches_amazon_seller_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.amazon_seller_service.amazon_seller_service"
        ) as mock_amazon:
            mock_amazon.sync_scheduled_entity = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 9,
                    "column_count": 21,
                    "asset": {"asset_id": "asset_amazon"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="amazon_seller",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_overview",
                        "seller_id": "seller_123",
                        "marketplace_id": "ATVPDKIKX0DER",
                        "row_limit": 5000,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 9
        mock_amazon.sync_scheduled_entity.assert_awaited_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "report_type": "sales_overview",
                "seller_id": "seller_123",
                "marketplace_id": "ATVPDKIKX0DER",
                "row_limit": 5000,
            },
            start_date="2026-01-01",
            end_date="2026-01-31",
            date_range_preset="last_30d",
        )

    def test_run_sync_dispatches_tiktok_shop_seller_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.tiktok_shop_seller_service.tiktok_shop_seller_service"
        ) as mock_tiktok_shop:
            mock_tiktok_shop.sync_scheduled_entity = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 10,
                    "column_count": 20,
                    "asset": {"asset_id": "asset_tiktok_shop"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="tiktok_shop_seller",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_overview",
                        "shop_id": "shop_123",
                        "region": "US",
                        "row_limit": 5000,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 10
        mock_tiktok_shop.sync_scheduled_entity.assert_awaited_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "report_type": "sales_overview",
                "shop_id": "shop_123",
                "region": "US",
                "row_limit": 5000,
            },
            start_date="2026-01-01",
            end_date="2026-01-31",
            date_range_preset="last_30d",
        )

    def test_run_sync_dispatches_shopee_seller_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.shopee_seller_service.shopee_seller_service"
        ) as mock_shopee:
            mock_shopee.sync_scheduled_entity = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 11,
                    "column_count": 20,
                    "asset": {"asset_id": "asset_shopee"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="shopee_seller",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_overview",
                        "shop_id": "shop_123",
                        "region": "VN",
                        "row_limit": 5000,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 11
        mock_shopee.sync_scheduled_entity.assert_awaited_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "report_type": "sales_overview",
                "shop_id": "shop_123",
                "region": "VN",
                "row_limit": 5000,
            },
            start_date="2026-01-01",
            end_date="2026-01-31",
            date_range_preset="last_30d",
        )

    def test_run_sync_dispatches_lazada_seller_provider(self):
        from app.api.route_modules.internal import _run_sync

        with patch(
            "app.services.lazada_seller_service.lazada_seller_service"
        ) as mock_lazada:
            mock_lazada.sync_scheduled_entity = AsyncMock(
                return_value={
                    "success": True,
                    "row_count": 12,
                    "column_count": 20,
                    "asset": {"asset_id": "asset_lazada"},
                }
            )
            result = asyncio.run(
                _run_sync(
                    provider="lazada_seller",
                    user_id="u1",
                    project_id="p1",
                    connector_config={
                        "report_type": "sales_overview",
                        "seller_id": "seller_123",
                        "region": "VN",
                        "row_limit": 5000,
                    },
                    start_date="2026-01-01",
                    end_date="2026-01-31",
                    date_range_preset="last_30d",
                )
            )

        assert result["row_count"] == 12
        mock_lazada.sync_scheduled_entity.assert_awaited_once_with(
            user_id="u1",
            project_id="p1",
            connector_config={
                "report_type": "sales_overview",
                "seller_id": "seller_123",
                "region": "VN",
                "row_limit": 5000,
            },
            start_date="2026-01-01",
            end_date="2026-01-31",
            date_range_preset="last_30d",
        )


# ── Schedules CRUD validation ─────────────────────────────────────────────────


class TestScheduleValidation:
    def test_invalid_provider_rejected(self):
        from app.api.route_modules.schedules import (
            _validate_create,
            CreateScheduleRequest,
        )
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

    def test_missing_provider_config_rejected(self):
        from app.api.route_modules.schedules import (
            _validate_create,
            CreateScheduleRequest,
        )
        from fastapi import HTTPException

        req = CreateScheduleRequest(
            provider="ga4",
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

    def test_empty_project_rejected(self):
        from app.api.route_modules.schedules import (
            _validate_create,
            CreateScheduleRequest,
        )
        from fastapi import HTTPException

        req = CreateScheduleRequest(
            provider="stripe",
            connector_config={"report_type": "charges"},
            project_id="",
            frequency="daily",
            hour_utc=9,
            day_of_week=0,
            date_range_preset="last_30d",
        )
        with pytest.raises(HTTPException):
            _validate_create(req)

    def test_stripe_defaults_to_charges(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        assert _normalize_connector_config("stripe", {}) == {"report_type": "charges"}

    def test_hubspot_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "hubspot",
            {
                "report_type": "sales_pipeline",
                "pipeline_id": "default",
                "owner_id": "42",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_pipeline"
        assert cfg["pipeline_id"] == "default"
        assert cfg["owner_id"] == "42"
        assert cfg["entity_id"] == "hubspot:sales_pipeline:default:42"
        assert cfg["row_limit"] == 10000

    def test_hubspot_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config("hubspot", {"report_type": "tickets"})

    def test_salesforce_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "salesforce",
            {
                "report_type": "sales_pipeline",
                "object_name": "Opportunity",
                "owner_id": "0051",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_pipeline"
        assert cfg["object_name"] == "Opportunity"
        assert cfg["owner_id"] == "0051"
        assert cfg["entity_id"] == "salesforce:sales_pipeline:Opportunity:0051"
        assert cfg["row_limit"] == 10000

    def test_salesforce_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config("salesforce", {"report_type": "tickets"})

    def test_pipedrive_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "pipedrive",
            {
                "report_type": "sales_pipeline",
                "pipeline_id": "10",
                "owner_id": "42",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_pipeline"
        assert cfg["pipeline_id"] == "10"
        assert cfg["owner_id"] == "42"
        assert cfg["entity_id"] == "pipedrive:sales_pipeline:10:42"
        assert cfg["row_limit"] == 10000

    def test_pipedrive_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config("pipedrive", {"report_type": "tickets"})

    def test_shopify_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "shopify",
            {
                "report_type": "sales_overview",
                "shop_domain": "demo.myshopify.com",
                "resource": "orders",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_overview"
        assert cfg["shop_domain"] == "demo.myshopify.com"
        assert cfg["resource"] == "orders"
        assert cfg["entity_id"] == "shopify:sales_overview:demo.myshopify.com:orders"
        assert cfg["row_limit"] == 10000

    def test_shopify_config_can_parse_entity_id_only(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "shopify",
            {"entity_id": "shopify:products:demo.myshopify.com:products"},
        )

        assert cfg["report_type"] == "products"
        assert cfg["shop_domain"] == "demo.myshopify.com"
        assert cfg["resource"] == "products"

    def test_shopify_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "shopify",
                {"report_type": "payments", "shop_domain": "demo.myshopify.com"},
            )

    def test_klaviyo_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "klaviyo",
            {
                "report_type": "lifecycle_overview",
                "account_id": "acct_1",
                "resource_id": "all",
                "metric_id": "metric_placed_order",
                "channel": "email",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "lifecycle_overview"
        assert cfg["account_id"] == "acct_1"
        assert cfg["resource_id"] == "all"
        assert cfg["metric_id"] == "metric_placed_order"
        assert cfg["channel"] == "email"
        assert cfg["entity_id"] == "klaviyo:lifecycle_overview:acct_1:all"
        assert cfg["row_limit"] == 10000

    def test_klaviyo_config_can_parse_entity_id_only(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "klaviyo",
            {"entity_id": "klaviyo:campaigns:acct_1:campaign_123"},
        )

        assert cfg["report_type"] == "campaigns"
        assert cfg["account_id"] == "acct_1"
        assert cfg["resource_id"] == "campaign_123"

    def test_klaviyo_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config("klaviyo", {"report_type": "segments"})

    def test_quickbooks_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "quickbooks",
            {
                "report_type": "finance_overview",
                "realm_id": "realm_1",
                "resource_id": "all",
                "accounting_basis": "cash",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "finance_overview"
        assert cfg["realm_id"] == "realm_1"
        assert cfg["resource_id"] == "all"
        assert cfg["accounting_basis"] == "Cash"
        assert cfg["entity_id"] == "quickbooks:finance_overview:realm_1:all"
        assert cfg["row_limit"] == 10000

    def test_quickbooks_config_can_parse_entity_id_only(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "quickbooks",
            {"entity_id": "quickbooks:invoices:realm_1:all"},
        )

        assert cfg["report_type"] == "invoices"
        assert cfg["realm_id"] == "realm_1"
        assert cfg["resource_id"] == "all"

    def test_quickbooks_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config("quickbooks", {"report_type": "payroll"})

    def test_quickbooks_config_rejects_unknown_accounting_basis(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "quickbooks", {"accounting_basis": "ModifiedCash"}
            )

    def test_amazon_seller_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "amazon_seller",
            {
                "report_type": "sales_overview",
                "seller_id": "seller_123",
                "marketplace_id": "ATVPDKIKX0DER",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_overview"
        assert cfg["seller_id"] == "seller_123"
        assert cfg["marketplace_id"] == "ATVPDKIKX0DER"
        assert (
            cfg["entity_id"]
            == "amazon_seller:sales_overview:seller_123:ATVPDKIKX0DER"
        )
        assert cfg["row_limit"] == 10000

    def test_amazon_seller_config_can_parse_entity_id_only(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "amazon_seller",
            {"entity_id": "amazon_seller:inventory:seller_123:all"},
        )

        assert cfg["report_type"] == "inventory"
        assert cfg["seller_id"] == "seller_123"
        assert cfg["marketplace_id"] == "all"

    def test_amazon_seller_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "amazon_seller", {"report_type": "brand_analytics"}
            )

    def test_tiktok_shop_seller_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "tiktok_shop_seller",
            {
                "report_type": "sales_overview",
                "shop_id": "shop_123",
                "region": "us",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_overview"
        assert cfg["shop_id"] == "shop_123"
        assert cfg["region"] == "US"
        assert (
            cfg["entity_id"]
            == "tiktok_shop_seller:sales_overview:shop_123:US"
        )
        assert cfg["row_limit"] == 10000

    def test_tiktok_shop_seller_config_can_parse_entity_id_only(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "tiktok_shop_seller",
            {"entity_id": "tiktok_shop_seller:inventory:shop_123:VN"},
        )

        assert cfg["report_type"] == "inventory"
        assert cfg["shop_id"] == "shop_123"
        assert cfg["region"] == "VN"

    def test_tiktok_shop_seller_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "tiktok_shop_seller", {"report_type": "creator_affiliate"}
            )

    def test_shopee_seller_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "shopee_seller",
            {
                "report_type": "sales_overview",
                "shop_id": "shop_123",
                "region": "vn",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_overview"
        assert cfg["shop_id"] == "shop_123"
        assert cfg["region"] == "VN"
        assert cfg["entity_id"] == "shopee_seller:sales_overview:shop_123:VN"
        assert cfg["row_limit"] == 10000

    def test_shopee_seller_config_can_parse_entity_id_only(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "shopee_seller",
            {"entity_id": "shopee_seller:inventory:shop_123:ID"},
        )

        assert cfg["report_type"] == "inventory"
        assert cfg["shop_id"] == "shop_123"
        assert cfg["region"] == "ID"

    def test_shopee_seller_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "shopee_seller", {"report_type": "vouchers"}
            )

    def test_lazada_seller_config_normalizes_report_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "lazada_seller",
            {
                "report_type": "sales_overview",
                "seller_id": "seller_123",
                "region": "vn",
                "row_limit": 999999,
            },
        )

        assert cfg["report_type"] == "sales_overview"
        assert cfg["seller_id"] == "seller_123"
        assert cfg["region"] == "VN"
        assert cfg["entity_id"] == "lazada_seller:sales_overview:seller_123:VN"
        assert cfg["row_limit"] == 10000

    def test_lazada_seller_config_can_parse_entity_id_only(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "lazada_seller",
            {"entity_id": "lazada_seller:finance:seller_123:SG"},
        )

        assert cfg["report_type"] == "finance"
        assert cfg["seller_id"] == "seller_123"
        assert cfg["region"] == "SG"

    def test_lazada_seller_config_rejects_unknown_report_type(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "lazada_seller", {"report_type": "sponsored_solutions"}
            )

    def test_supabase_config_normalizes_table_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "supabase",
            {
                "connection_id": "conn_123",
                "sync_mode": "bounded_table_snapshot",
                "schema_name": "public",
                "table_name": "profiles",
                "row_limit": 999999,
            },
        )

        assert cfg["connection_id"] == "conn_123"
        assert cfg["sync_mode"] == "bounded_table_snapshot"
        assert cfg["schema"] == "public"
        assert cfg["table"] == "profiles"
        assert cfg["entity_id"] == "supabase:conn_123:table:public.profiles"
        assert cfg["row_limit"] == 50000

    def test_supabase_config_accepts_app_profile_entity(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "supabase",
            {
                "connection_id": "conn_123",
                "sync_mode": "app_profile",
                "bucket": "all",
            },
        )

        assert cfg["entity_id"] == "supabase:conn_123:storage:all"
        assert cfg["entity_name"] == "Supabase App Profile"

    def test_supabase_config_rejects_invalid_sync_mode(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "supabase",
                {
                    "connection_id": "conn_123",
                    "sync_mode": "raw_sql",
                },
            )

    def test_warehouse_config_normalizes_entity_and_caps_rows(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "warehouse",
            {
                "connection_id": "conn_123",
                "schema_name": "public",
                "table_name": "orders",
                "row_limit": 999999,
            },
        )

        assert cfg["connector_key"] == "postgres"
        assert cfg["schema"] == "public"
        assert cfg["table"] == "orders"
        assert cfg["entity_id"] == "conn_123:public.orders"
        assert cfg["row_limit"] == 50000

    def test_warehouse_config_accepts_bigquery_connector(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "warehouse",
            {
                "connector_key": "bigquery",
                "connection_id": "conn_123",
                "schema": "analytics",
                "table": "events",
            },
        )

        assert cfg["connector_key"] == "bigquery"
        assert cfg["entity_id"] == "conn_123:analytics.events"

    def test_warehouse_config_accepts_snowflake_connector(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "warehouse",
            {
                "connector_key": "snowflake",
                "connection_id": "conn_123",
                "schema": "PUBLIC",
                "table": "ORDERS",
            },
        )

        assert cfg["connector_key"] == "snowflake"
        assert cfg["entity_id"] == "conn_123:PUBLIC.ORDERS"

    def test_warehouse_config_accepts_databricks_connector(self):
        from app.api.route_modules.schedules import _normalize_connector_config

        cfg = _normalize_connector_config(
            "warehouse",
            {
                "connector_key": "databricks",
                "connection_id": "conn_123",
                "catalog": "main",
                "schema": "analytics",
                "table": "events",
            },
        )

        assert cfg["connector_key"] == "databricks"
        assert cfg["catalog"] == "main"
        assert cfg["schema"] == "main.analytics"
        assert cfg["entity_id"] == "conn_123:main.analytics.events"

    def test_warehouse_config_rejects_unknown_connector_key(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config(
                "warehouse",
                {
                    "connector_key": "redshift",
                    "connection_id": "conn_123",
                    "schema": "analytics",
                    "table": "events",
                },
            )

    def test_warehouse_config_requires_table_identity(self):
        from app.api.route_modules.schedules import _normalize_connector_config
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _normalize_connector_config("warehouse", {"connection_id": "conn_123"})

    def test_invalid_frequency_rejected(self):
        from app.api.route_modules.schedules import (
            _validate_create,
            CreateScheduleRequest,
        )
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
        from app.api.route_modules.schedules import (
            _validate_create,
            CreateScheduleRequest,
        )

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


def test_run_sync_dispatches_supabase_provider():
    from app.api.route_modules.internal import _run_sync

    with patch("app.services.supabase_service.supabase_service") as mock_supabase:
        mock_supabase.sync_scheduled_entity.return_value = {
            "success": True,
            "row_count": 2,
            "column_count": 3,
            "asset": {"asset_id": "asset_1"},
        }
        result = asyncio.run(
            _run_sync(
                provider="supabase",
                user_id="u1",
                project_id="p1",
                connector_config={
                    "connection_id": "conn_123",
                    "sync_mode": "bounded_table_snapshot",
                    "schema": "public",
                    "table": "profiles",
                    "entity_id": "supabase:conn_123:table:public.profiles",
                },
                start_date="2026-01-01",
                end_date="2026-01-31",
                date_range_preset="last_30d",
            )
        )

    assert result["row_count"] == 2
    mock_supabase.sync_scheduled_entity.assert_called_once_with(
        user_id="u1",
        project_id="p1",
        connector_config={
            "connection_id": "conn_123",
            "sync_mode": "bounded_table_snapshot",
            "schema": "public",
            "table": "profiles",
            "entity_id": "supabase:conn_123:table:public.profiles",
        },
    )
