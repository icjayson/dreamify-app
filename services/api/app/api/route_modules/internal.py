"""
Internal endpoints called by EventBridge Scheduler — NOT accessible by end users.
Protected by X-Internal-Sync-Secret header instead of Clerk JWT.
"""
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from utils.config import config
from utils.dynamodb.repos import sync_schedules as schedules_repo
from utils.dynamodb.repos import sync_runs as runs_repo

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

    end = datetime.utcnow().date()
    start = end - timedelta(days=days)
    return start.isoformat(), end.isoformat()


def _require_internal_secret(x_internal_sync_secret: Optional[str] = Header(None)) -> None:
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

    from app.services.integration_service import TokenExpiredError  # noqa: F811 lazy import

    run = runs_repo.create_run(schedule_id=schedule_id, user_id=user_id, provider=provider)
    run_id = run["run_id"]
    start_date, end_date = _resolve_dates(date_range_preset, provider)
    t0 = time.monotonic()

    status = "failed"
    rows: Optional[int] = None
    columns: Optional[int] = None
    asset_id: Optional[str] = None
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
        asset = result.get("asset", {})
        asset_id = asset.get("asset_id") if asset else None

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

    logger.info(
        "Scheduled sync %s completed: status=%s rows=%s duration=%dms",
        schedule_id, status, rows, duration_ms,
    )
    return {"status": status, "run_id": run_id, "rows": rows, "duration_ms": duration_ms}


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
    from app.services.integration_service import TokenExpiredError, integration_service  # noqa: F401

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

    else:
        raise ValueError(f"Unknown provider: {provider}")
