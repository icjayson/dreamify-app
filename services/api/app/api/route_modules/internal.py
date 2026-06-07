"""
Internal endpoints called by EventBridge Scheduler — NOT accessible by end users.
Protected by X-Internal-Sync-Secret header instead of Clerk JWT.
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from utils.config import config
from utils.dynamodb.repos import sync_schedules as schedules_repo
from utils.dynamodb.repos import sync_runs as runs_repo
from utils.dynamodb.repos import notifications as notifications_repo

logger = logging.getLogger(__name__)
router = APIRouter(tags=["internal"])


def _resolve_dates(date_range_preset: str, provider: str):
    """
    Resolve a date preset to (start_date, end_date) strings.
    GA4 accepts relative format (e.g. '30daysAgo'); others use YYYY-MM-DD.
    """
    preset_days = {
        "last_7d": 7,
        "last_14d": 14,
        "last_30d": 30,
        "last_90d": 90,
    }
    days = preset_days.get(date_range_preset, 30)

    if provider == "ga4":
        return f"{days}daysAgo", "today"

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    return start.isoformat(), end.isoformat()


def _require_internal_secret(
    x_internal_sync_secret: Optional[str] = Header(None),
) -> None:
    if x_internal_sync_secret != config.scheduler.INTERNAL_SYNC_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/internal/schedules/{schedule_id}/trigger")
async def trigger_schedule(
    schedule_id: str,
    x_internal_sync_secret: Optional[str] = Header(None),
) -> dict:
    """
    Trigger endpoint called by AWS EventBridge Scheduler.
    Looks up the schedule, runs the appropriate connector sync, and records the result.
    """
    _require_internal_secret(x_internal_sync_secret)
    return await execute_schedule(schedule_id)


async def execute_schedule(schedule_id: str) -> dict:
    """Run one schedule by id and persist run/schedule/notification state."""
    schedule = schedules_repo.get_schedule_by_id(schedule_id)
    if not schedule:
        logger.warning("Trigger received for unknown schedule_id: %s", schedule_id)
        return {"status": "not_found"}

    if schedule.get("status") != "active":
        logger.info("Schedule %s is paused — skipping", schedule_id)
        return {"status": "skipped", "reason": "paused"}

    user_id = schedule["user_id"]
    provider = schedule["provider"]
    connector_config = schedule.get("connector_config", {})
    project_id = schedule.get("project_id", "")
    date_range_preset = schedule.get("date_range_preset", "last_30d")

    from app.services.integration_service import (
        TokenExpiredError,
    )  # noqa: F811 lazy import

    run = runs_repo.create_run(
        schedule_id=schedule_id, user_id=user_id, provider=provider
    )
    run_id = run["run_id"]
    start_date, end_date = _resolve_dates(date_range_preset, provider)
    t0 = time.monotonic()

    status = "failed"
    rows: Optional[int] = None
    columns: Optional[int] = None
    asset_id: Optional[str] = None
    asset_obj: dict = {}
    error_message: Optional[str] = None

    try:
        result = await _run_sync(
            provider=provider,
            user_id=user_id,
            project_id=project_id,
            connector_config=connector_config,
            start_date=start_date,
            end_date=end_date,
            date_range_preset=date_range_preset,
        )
        status = "success"
        rows = result.get("row_count")
        columns = result.get("column_count")
        asset_obj = result.get("asset") or {}
        asset_id = asset_obj.get("asset_id") if asset_obj else None

    except TokenExpiredError as exc:
        status = "token_expired"
        error_message = str(exc)
        logger.warning("Token expired during scheduled sync %s: %s", schedule_id, exc)

    except Exception as exc:
        status = "failed"
        error_message = str(exc)
        logger.error("Scheduled sync %s failed: %s", schedule_id, exc, exc_info=True)

    duration_ms = int((time.monotonic() - t0) * 1000)

    runs_repo.complete_run(
        schedule_id=schedule_id,
        run_id=run_id,
        status=status,
        rows_fetched=rows,
        columns_fetched=columns,
        asset_id=asset_id,
        error_message=error_message,
        duration_ms=duration_ms,
        date_range_start=start_date,
        date_range_end=end_date,
    )
    schedules_repo.update_last_run(
        user_id=user_id,
        schedule_id=schedule_id,
        status=status,
        rows=rows,
        error=error_message,
    )

    # Write in-app notification
    _write_notification(
        user_id=user_id,
        schedule=schedule,
        run_id=run_id,
        status=status,
        rows=rows,
        asset_id=asset_id,
        error_message=error_message,
    )

    logger.info(
        "Scheduled sync %s completed: status=%s rows=%s duration=%dms",
        schedule_id,
        status,
        rows,
        duration_ms,
    )

    # Fire auto-refresh (re-analyze existing conversation with new asset)
    if status == "success" and asset_obj:
        auto_refresh_conv_id = schedule.get("auto_refresh_conversation_id")
        if auto_refresh_conv_id:
            import asyncio as _asyncio
            from app.services.chat_platform_service import trigger_auto_refresh

            _asyncio.ensure_future(
                trigger_auto_refresh(
                    user_id=user_id,
                    project_id=project_id,
                    conversation_id=auto_refresh_conv_id,
                    asset=asset_obj,
                    prompt=schedule.get(
                        "auto_refresh_prompt",
                        "Refresh this dashboard with the latest synced data.",
                    ),
                )
            )

    # Fire post-sync Slack action(s) in the background (success only)
    if status == "success" and asset_obj:
        on_complete_actions = schedule.get("on_complete_actions") or []
        for action in on_complete_actions:
            if action.get("type") == "slack" and action.get("channel_id"):
                import asyncio as _asyncio
                from app.services.chat_platform_service import post_sync_to_slack

                _asyncio.ensure_future(
                    post_sync_to_slack(
                        user_id=user_id,
                        project_id=project_id,
                        channel_id=action["channel_id"],
                        provider=provider,
                        account_name=schedule.get("account_name", provider),
                        rows_fetched=rows,
                        asset=asset_obj,
                    )
                )

    return {
        "status": status,
        "run_id": run_id,
        "rows": rows,
        "duration_ms": duration_ms,
    }


async def _run_sync(
    provider: str,
    user_id: str,
    project_id: str,
    connector_config: dict,
    start_date: str,
    end_date: str,
    date_range_preset: str,
) -> dict:
    """Dispatch to the appropriate IntegrationService method based on provider."""
    # Lazy import to avoid loading google/stripe SDKs at module import time
    from app.services.integration_service import (
        TokenExpiredError,
        integration_service,
    )  # noqa: F401

    if provider == "ga4":
        property_id = connector_config.get("property_id", "")
        account_name = connector_config.get("account_name", "")
        property_name = connector_config.get("property_name", "")
        return await integration_service.fetch_google_analytics_data(
            user_id=user_id,
            property_id=property_id,
            project_id=project_id,
            start_date=start_date,
            end_date=end_date,
            account_name=account_name,
            property_name=property_name,
        )

    elif provider == "meta_ads":
        integration_service.assert_meta_token_valid(user_id)
        ad_account_id = connector_config.get("ad_account_id", "")
        account_name = connector_config.get("account_name", "")
        adset_ids = connector_config.get("adset_ids")
        campaign_ids = connector_config.get("campaign_ids")
        return await integration_service.fetch_meta_ads_data(
            user_id=user_id,
            ad_account_id=ad_account_id,
            project_id=project_id,
            date_preset=date_range_preset,
            start_date=None,
            end_date=None,
            account_name=account_name,
            adset_ids=adset_ids,
            campaign_ids=campaign_ids,
        )

    elif provider == "tiktok":
        integration_service.assert_tiktok_token_valid(user_id)
        ad_account_id = connector_config.get("ad_account_id", "")
        account_name = connector_config.get("account_name", "")
        return await integration_service.fetch_tiktok_ads_data(
            user_id=user_id,
            ad_account_id=ad_account_id,
            project_id=project_id,
            date_preset=date_range_preset,
            start_date=None,
            end_date=None,
            account_name=account_name,
        )

    elif provider == "appsflyer":
        integration_service.assert_appsflyer_token_valid(user_id)
        app_id = connector_config.get("app_id", "")
        app_name = connector_config.get("app_name", "")
        return await integration_service.fetch_appsflyer_data(
            user_id=user_id,
            app_id=app_id,
            app_name=app_name,
            project_id=project_id,
            date_preset=date_range_preset,
            start_date=None,
            end_date=None,
        )

    elif provider == "stripe":
        integration_service.assert_stripe_token_valid(user_id)
        report_type = connector_config.get("report_type", "charges")
        return await integration_service.fetch_stripe_data(
            user_id=user_id,
            report_type=report_type,
            project_id=project_id,
            date_preset=date_range_preset,
            start_date=None,
            end_date=None,
        )

    elif provider == "hubspot":
        integration_service.assert_hubspot_token_valid(user_id)
        return await integration_service.fetch_hubspot_data(
            user_id=user_id,
            report_type=connector_config.get("report_type", "sales_pipeline"),
            project_id=project_id,
            date_preset=date_range_preset,
            start_date=start_date,
            end_date=end_date,
            pipeline_id=connector_config.get("pipeline_id", "all"),
            owner_id=connector_config.get("owner_id", "all"),
            row_limit=int(connector_config.get("row_limit") or 5000),
            include_associations=bool(
                connector_config.get("include_associations", True)
            ),
        )

    elif provider == "salesforce":
        integration_service.assert_salesforce_token_valid(user_id)
        return await integration_service.fetch_salesforce_data(
            user_id=user_id,
            report_type=connector_config.get("report_type", "sales_pipeline"),
            project_id=project_id,
            date_preset=date_range_preset,
            start_date=start_date,
            end_date=end_date,
            object_name=connector_config.get("object_name", "all"),
            owner_id=connector_config.get("owner_id", "all"),
            row_limit=int(connector_config.get("row_limit") or 5000),
        )

    elif provider == "pipedrive":
        integration_service.assert_pipedrive_token_valid(user_id)
        return await integration_service.fetch_pipedrive_data(
            user_id=user_id,
            report_type=connector_config.get("report_type", "sales_pipeline"),
            project_id=project_id,
            date_preset=date_range_preset,
            start_date=start_date,
            end_date=end_date,
            pipeline_id=connector_config.get("pipeline_id", "all"),
            owner_id=connector_config.get("owner_id", "all"),
            row_limit=int(connector_config.get("row_limit") or 5000),
        )

    elif provider == "shopify":
        from app.services.shopify_service import shopify_service

        return await shopify_service.sync_scheduled_entity(
            user_id=user_id,
            project_id=project_id,
            connector_config=connector_config,
            start_date=start_date,
            end_date=end_date,
            date_range_preset=date_range_preset,
        )

    elif provider == "supabase":
        from app.services.supabase_service import supabase_service

        return supabase_service.sync_scheduled_entity(
            user_id=user_id,
            project_id=project_id,
            connector_config=connector_config,
        )

    elif provider == "warehouse":
        from app.services.warehouse_service import warehouse_service

        return warehouse_service.sync_scheduled_table(
            user_id=user_id,
            project_id=project_id,
            connector_config=connector_config,
        )

    else:
        raise ValueError(f"Unknown provider: {provider}")


_PROVIDER_LABELS: dict = {
    "ga4": "Google Analytics 4",
    "meta_ads": "Meta Ads",
    "tiktok": "TikTok Ads",
    "appsflyer": "AppsFlyer",
    "stripe": "Stripe",
    "hubspot": "HubSpot",
    "salesforce": "Salesforce",
    "pipedrive": "Pipedrive",
    "shopify": "Shopify",
    "supabase": "Supabase",
    "warehouse": "Warehouse",
}


def _write_notification(
    user_id: str,
    schedule: dict,
    run_id: str,
    status: str,
    rows: Optional[int],
    asset_id: Optional[str],
    error_message: Optional[str],
) -> None:
    """Create a notification record after a sync run completes."""
    provider = schedule.get("provider", "")
    account_name = schedule.get("account_name") or _PROVIDER_LABELS.get(
        provider, provider
    )
    project_id = schedule.get("project_id")
    schedule_id = schedule.get("schedule_id")
    label = _PROVIDER_LABELS.get(provider, provider)

    if status == "success":
        rows_str = f" · {rows:,} rows" if rows is not None else ""
        title = f"{account_name} synced{rows_str}"
        body = f"{label} data fetched successfully and is ready for analysis."
        notification_type = "sync_success"
    elif status == "token_expired":
        title = f"{account_name} — reconnect required"
        body = f"Your {label} token has expired. Reconnect the account to resume automatic syncs."
        notification_type = "token_expired"
    else:
        title = f"{account_name} sync failed"
        body = error_message or f"{label} scheduled sync encountered an error."
        notification_type = "sync_failed"

    try:
        notifications_repo.create_notification(
            user_id=user_id,
            notification_type=notification_type,
            title=title,
            body=body,
            schedule_id=schedule_id,
            run_id=run_id,
            provider=provider,
            asset_id=asset_id if status == "success" else None,
            project_id=project_id,
        )
    except Exception as exc:
        # Notification failure must never break the sync result
        logger.warning("Failed to create notification for run %s: %s", run_id, exc)
