"""
User-facing CRUD routes for data sync schedules.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies.auth import require_user
from app.services import scheduler_service
from utils.dynamodb.repos import sync_schedules as schedules_repo
from utils.dynamodb.repos import sync_runs as runs_repo

logger = logging.getLogger(__name__)
router = APIRouter(tags=["schedules"])


# ── Request / Response models ──────────────────────────────────────────────────


class CreateScheduleRequest(BaseModel):
    provider: str  # ga4 | meta_ads | tiktok | appsflyer | stripe | hubspot | salesforce | pipedrive | shopify | supabase | warehouse
    connector_config: Dict[str, Any]
    project_id: str
    account_name: str = ""
    frequency: str  # daily | weekly | biweekly
    hour_utc: int = Field(ge=0, le=23, default=9)
    day_of_week: int = Field(ge=0, le=6, default=0)  # 0=Mon
    date_range_preset: str = "last_30d"  # last_7d | last_14d | last_30d | last_90d
    # Optional post-sync actions: [{"type": "slack", "channel_id": "C123"}]
    on_complete_actions: Optional[List[Dict[str, Any]]] = None
    # Optional auto-refresh: conversation_id to re-analyze after each sync
    auto_refresh_conversation_id: Optional[str] = None
    auto_refresh_prompt: Optional[str] = None


class UpdateScheduleRequest(BaseModel):
    frequency: Optional[str] = None
    hour_utc: Optional[int] = Field(None, ge=0, le=23)
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    date_range_preset: Optional[str] = None
    account_name: Optional[str] = None
    project_id: Optional[str] = None
    connector_config: Optional[Dict[str, Any]] = None
    on_complete_actions: Optional[List[Dict[str, Any]]] = None
    auto_refresh_conversation_id: Optional[str] = None
    auto_refresh_prompt: Optional[str] = None


_VALID_PROVIDERS = {
    "ga4",
    "meta_ads",
    "tiktok",
    "appsflyer",
    "stripe",
    "hubspot",
    "salesforce",
    "pipedrive",
    "shopify",
    "supabase",
    "warehouse",
}
_VALID_FREQUENCIES = {"daily", "weekly", "biweekly"}
_VALID_DATE_PRESETS = {"last_7d", "last_14d", "last_30d", "last_90d"}
_VALID_STRIPE_REPORT_TYPES = {"charges", "subscriptions", "customers"}
_VALID_HUBSPOT_REPORT_TYPES = {
    "sales_pipeline",
    "contacts",
    "companies",
    "activities",
}
_VALID_SALESFORCE_REPORT_TYPES = {
    "sales_pipeline",
    "leads",
    "accounts_contacts",
    "activities",
    "campaigns",
}
_VALID_PIPEDRIVE_REPORT_TYPES = {
    "sales_pipeline",
    "leads",
    "contacts_organizations",
    "activities",
    "products",
}
_VALID_SHOPIFY_REPORT_TYPES = {
    "sales_overview",
    "orders",
    "products",
    "customers",
    "inventory",
    "discounts",
}
_VALID_SUPABASE_SYNC_MODES = {
    "profile_only",
    "bounded_table_snapshot",
    "aggregated_result",
    "app_profile",
}
_VALID_WAREHOUSE_CONNECTORS = {"postgres", "bigquery", "snowflake", "databricks"}


def _validate_create(req: CreateScheduleRequest) -> None:
    if req.provider not in _VALID_PROVIDERS:
        raise HTTPException(
            400, f"Invalid provider. Must be one of: {', '.join(_VALID_PROVIDERS)}"
        )
    if req.frequency not in _VALID_FREQUENCIES:
        raise HTTPException(
            400, f"Invalid frequency. Must be one of: {', '.join(_VALID_FREQUENCIES)}"
        )
    if req.date_range_preset not in _VALID_DATE_PRESETS:
        raise HTTPException(
            400,
            f"Invalid date_range_preset. Must be one of: {', '.join(_VALID_DATE_PRESETS)}",
        )
    if not req.project_id.strip():
        raise HTTPException(400, "project_id is required")
    _normalize_connector_config(req.provider, req.connector_config)


def _normalize_connector_config(
    provider: str, connector_config: Dict[str, Any]
) -> Dict[str, Any]:
    cfg = dict(connector_config or {})
    if provider == "ga4" and not str(cfg.get("property_id") or "").strip():
        raise HTTPException(
            400, "connector_config.property_id is required for GA4 schedules"
        )
    if (
        provider in {"meta_ads", "tiktok"}
        and not str(cfg.get("ad_account_id") or "").strip()
    ):
        raise HTTPException(
            400, "connector_config.ad_account_id is required for ad account schedules"
        )
    if provider == "appsflyer" and not str(cfg.get("app_id") or "").strip():
        raise HTTPException(
            400, "connector_config.app_id is required for AppsFlyer schedules"
        )
    if provider == "stripe":
        report_type = str(cfg.get("report_type") or "charges").strip()
        if report_type not in _VALID_STRIPE_REPORT_TYPES:
            raise HTTPException(
                400,
                "connector_config.report_type must be charges, subscriptions, or customers",
            )
        cfg["report_type"] = report_type
    if provider == "hubspot":
        report_type = str(cfg.get("report_type") or "sales_pipeline").strip()
        if report_type not in _VALID_HUBSPOT_REPORT_TYPES:
            raise HTTPException(
                400,
                "connector_config.report_type must be sales_pipeline, contacts, companies, or activities",
            )
        pipeline_id = str(cfg.get("pipeline_id") or "all").strip() or "all"
        owner_id = str(cfg.get("owner_id") or "all").strip() or "all"
        try:
            row_limit = int(cfg.get("row_limit") or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        include_associations = cfg.get("include_associations", True)
        cfg["report_type"] = report_type
        cfg["pipeline_id"] = pipeline_id
        cfg["owner_id"] = owner_id
        cfg["row_limit"] = max(1, min(row_limit, 10000))
        cfg["include_associations"] = bool(include_associations)
        cfg["entity_id"] = str(
            cfg.get("entity_id") or f"hubspot:{report_type}:{pipeline_id}:{owner_id}"
        )
        cfg["entity_name"] = str(
            cfg.get("entity_name") or report_type.replace("_", " ").title()
        )
    if provider == "salesforce":
        report_type = str(cfg.get("report_type") or "sales_pipeline").strip()
        if report_type not in _VALID_SALESFORCE_REPORT_TYPES:
            raise HTTPException(
                400,
                "connector_config.report_type must be sales_pipeline, leads, accounts_contacts, activities, or campaigns",
            )
        object_name = str(cfg.get("object_name") or "all").strip() or "all"
        owner_id = str(cfg.get("owner_id") or "all").strip() or "all"
        try:
            row_limit = int(cfg.get("row_limit") or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        cfg["report_type"] = report_type
        cfg["object_name"] = object_name
        cfg["owner_id"] = owner_id
        cfg["row_limit"] = max(1, min(row_limit, 10000))
        cfg["entity_id"] = str(
            cfg.get("entity_id") or f"salesforce:{report_type}:{object_name}:{owner_id}"
        )
        cfg["entity_name"] = str(
            cfg.get("entity_name") or report_type.replace("_", " ").title()
        )
    if provider == "pipedrive":
        report_type = str(cfg.get("report_type") or "sales_pipeline").strip()
        if report_type not in _VALID_PIPEDRIVE_REPORT_TYPES:
            raise HTTPException(
                400,
                "connector_config.report_type must be sales_pipeline, leads, contacts_organizations, activities, or products",
            )
        pipeline_id = str(cfg.get("pipeline_id") or "all").strip() or "all"
        owner_id = str(cfg.get("owner_id") or "all").strip() or "all"
        try:
            row_limit = int(cfg.get("row_limit") or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        cfg["report_type"] = report_type
        cfg["pipeline_id"] = pipeline_id
        cfg["owner_id"] = owner_id
        cfg["row_limit"] = max(1, min(row_limit, 10000))
        cfg["entity_id"] = str(
            cfg.get("entity_id") or f"pipedrive:{report_type}:{pipeline_id}:{owner_id}"
        )
        cfg["entity_name"] = str(
            cfg.get("entity_name") or report_type.replace("_", " ").title()
        )
    if provider == "shopify":
        raw_report_type = str(cfg.get("report_type") or "").strip()
        report_type = raw_report_type or "sales_overview"
        shop_domain = str(cfg.get("shop_domain") or "").strip()
        raw_resource = str(cfg.get("resource") or "").strip()
        resource = str(cfg.get("resource") or "all").strip() or "all"
        entity_id = str(cfg.get("entity_id") or "").strip()
        if entity_id:
            parts = entity_id.split(":")
            if len(parts) == 4 and parts[0] == "shopify":
                report_type = raw_report_type or parts[1] or report_type
                shop_domain = shop_domain or parts[2]
                resource = raw_resource or parts[3] or "all"
        if report_type not in _VALID_SHOPIFY_REPORT_TYPES:
            raise HTTPException(
                400,
                "connector_config.report_type must be sales_overview, orders, products, customers, inventory, or discounts",
            )
        if not shop_domain:
            raise HTTPException(
                400,
                "connector_config.shop_domain is required for Shopify schedules",
            )
        try:
            row_limit = int(cfg.get("row_limit") or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        cfg["report_type"] = report_type
        cfg["shop_domain"] = shop_domain
        cfg["resource"] = resource
        cfg["row_limit"] = max(1, min(row_limit, 10000))
        cfg["include_pii"] = bool(cfg.get("include_pii", False))
        if cfg.get("max_bytes") is not None:
            try:
                cfg["max_bytes"] = max(1, int(cfg.get("max_bytes")))
            except (TypeError, ValueError):
                cfg.pop("max_bytes", None)
        cfg["entity_id"] = str(
            entity_id or f"shopify:{report_type}:{shop_domain}:{resource}"
        )
        cfg["entity_name"] = str(
            cfg.get("entity_name") or report_type.replace("_", " ").title()
        )
    if provider == "supabase":
        connection_id = str(cfg.get("connection_id") or "").strip()
        sync_mode = str(cfg.get("sync_mode") or "bounded_table_snapshot").strip()
        schema_name = str(cfg.get("schema") or cfg.get("schema_name") or "").strip()
        table_name = str(cfg.get("table") or cfg.get("table_name") or "").strip()
        bucket = str(cfg.get("bucket") or "all").strip() or "all"
        entity_id = str(cfg.get("entity_id") or "").strip()
        if entity_id and (not connection_id or not sync_mode):
            parts = entity_id.split(":")
            if len(parts) >= 3 and parts[0] == "supabase":
                connection_id = connection_id or parts[1]
                if parts[2] == "table" and len(parts) == 4:
                    sync_mode = sync_mode or "bounded_table_snapshot"
                    if not schema_name or not table_name:
                        table_path = parts[3]
                        if "." in table_path:
                            schema_from_id, table_from_id = table_path.rsplit(".", 1)
                            schema_name = schema_name or schema_from_id
                            table_name = table_name or table_from_id
                elif parts[2] in {"auth_users", "storage"}:
                    sync_mode = "app_profile"
                    if parts[2] == "storage" and len(parts) == 4:
                        bucket = parts[3] or "all"
                elif parts[2] == "profile":
                    sync_mode = "profile_only"
        if sync_mode not in _VALID_SUPABASE_SYNC_MODES:
            raise HTTPException(
                400,
                "connector_config.sync_mode must be profile_only, bounded_table_snapshot, aggregated_result, or app_profile",
            )
        if not connection_id:
            raise HTTPException(
                400,
                "connector_config.connection_id is required for Supabase schedules",
            )
        if sync_mode in {"bounded_table_snapshot", "aggregated_result"}:
            if not schema_name:
                raise HTTPException(
                    400,
                    "connector_config.schema is required for Supabase table schedules",
                )
            if not table_name:
                raise HTTPException(
                    400,
                    "connector_config.table is required for Supabase table schedules",
                )
        try:
            row_limit = int(cfg.get("row_limit") or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        cfg["connection_id"] = connection_id
        cfg["sync_mode"] = sync_mode
        cfg["schema"] = schema_name
        cfg["table"] = table_name
        cfg["bucket"] = bucket
        cfg["row_limit"] = max(1, min(row_limit, 50000))
        if not entity_id:
            if sync_mode == "app_profile":
                entity_id = f"supabase:{connection_id}:storage:{bucket}"
            elif sync_mode == "profile_only":
                entity_id = f"supabase:{connection_id}:profile"
            else:
                entity_id = f"supabase:{connection_id}:table:{schema_name}.{table_name}"
        cfg["entity_id"] = entity_id
        cfg["entity_name"] = str(
            cfg.get("entity_name")
            or (
                f"{schema_name}.{table_name}"
                if schema_name and table_name
                else (
                    "Supabase App Profile"
                    if sync_mode == "app_profile"
                    else "Supabase Schema Profile"
                )
            )
        )
    if provider == "warehouse":
        connection_id = str(cfg.get("connection_id") or "").strip()
        schema_name = str(cfg.get("schema") or cfg.get("schema_name") or "").strip()
        table_name = str(cfg.get("table") or cfg.get("table_name") or "").strip()
        entity_id = str(cfg.get("entity_id") or "").strip()
        if (not connection_id or not schema_name or not table_name) and entity_id:
            try:
                connection_id_from_id, table_path = entity_id.split(":", 1)
                schema_from_id, table_from_id = table_path.rsplit(".", 1)
                connection_id = connection_id or connection_id_from_id
                schema_name = schema_name or schema_from_id
                table_name = table_name or table_from_id
            except ValueError:
                pass
        connector_key = str(cfg.get("connector_key") or "postgres").strip()
        if connector_key not in _VALID_WAREHOUSE_CONNECTORS:
            raise HTTPException(
                400,
                "connector_config.connector_key must be postgres, bigquery, snowflake, or databricks",
            )
        catalog = str(cfg.get("catalog") or cfg.get("catalog_name") or "").strip()
        if connector_key == "databricks":
            if catalog and schema_name and not schema_name.startswith(f"{catalog}."):
                schema_name = f"{catalog}.{schema_name}"
            elif not catalog and "." in schema_name:
                catalog = schema_name.split(".", 1)[0]
        if not connection_id:
            raise HTTPException(
                400,
                "connector_config.connection_id is required for warehouse schedules",
            )
        if not schema_name:
            raise HTTPException(
                400, "connector_config.schema is required for warehouse schedules"
            )
        if not table_name:
            raise HTTPException(
                400, "connector_config.table is required for warehouse schedules"
            )
        try:
            row_limit = int(cfg.get("row_limit") or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        cfg["connector_key"] = connector_key
        cfg["connection_id"] = connection_id
        if connector_key == "databricks" and catalog:
            cfg["catalog"] = catalog
        cfg["schema"] = schema_name
        cfg["table"] = table_name
        cfg["entity_id"] = str(
            entity_id or f"{connection_id}:{schema_name}.{table_name}"
        )
        cfg["row_limit"] = max(1, min(row_limit, 50000))
    return cfg


def _apply_scheduler_state(
    record: Dict, status: str, error: str = "", rule_name: str = ""
) -> Dict:
    updates: Dict[str, Any] = {
        "scheduler_status": status,
        "scheduler_error": error,
    }
    if rule_name:
        updates["eventbridge_rule_name"] = rule_name
    schedules_repo.update_schedule(record["user_id"], record["schedule_id"], **updates)
    record.update(updates)
    return record


def _configure_eventbridge_schedule(
    record: Dict, frequency: str, hour_utc: int, day_of_week: int
) -> Dict:
    if not scheduler_service.is_scheduler_configured():
        return _apply_scheduler_state(
            record,
            "not_configured",
            "EventBridge Scheduler role or Lambda target is not configured.",
        )

    try:
        rule_name = scheduler_service.create_schedule(
            schedule_id=record["schedule_id"],
            frequency=frequency,
            hour_utc=hour_utc,
            day_of_week=day_of_week,
        )
        return _apply_scheduler_state(record, "configured", "", rule_name)
    except Exception as exc:
        logger.warning("EventBridge schedule creation failed: %s", exc)
        return _apply_scheduler_state(record, "error", str(exc))


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.post("/schedules")
async def create_schedule(
    req: CreateScheduleRequest,
    user_id: str = Depends(require_user),
) -> Dict:
    """Create a new data sync schedule."""
    _validate_create(req)
    connector_config = _normalize_connector_config(req.provider, req.connector_config)
    record = schedules_repo.create_schedule(
        user_id=user_id,
        provider=req.provider,
        connector_config=connector_config,
        project_id=req.project_id,
        account_name=req.account_name,
        frequency=req.frequency,
        hour_utc=req.hour_utc,
        day_of_week=req.day_of_week,
        date_range_preset=req.date_range_preset,
    )
    # Persist optional action/refresh fields if provided
    optional_updates: Dict[str, Any] = {}
    if req.on_complete_actions is not None:
        optional_updates["on_complete_actions"] = req.on_complete_actions
    if req.auto_refresh_conversation_id is not None:
        optional_updates["auto_refresh_conversation_id"] = (
            req.auto_refresh_conversation_id
        )
    if req.auto_refresh_prompt is not None:
        optional_updates["auto_refresh_prompt"] = req.auto_refresh_prompt
    if optional_updates:
        schedules_repo.update_schedule(
            user_id, record["schedule_id"], **optional_updates
        )
        record.update(optional_updates)
    return _configure_eventbridge_schedule(
        record, req.frequency, req.hour_utc, req.day_of_week
    )


@router.get("/schedules")
async def list_schedules(
    user_id: str = Depends(require_user),
) -> List[Dict]:
    """List all sync schedules for the current user."""
    return schedules_repo.list_schedules(user_id)


@router.get("/schedules/{schedule_id}")
async def get_schedule(
    schedule_id: str,
    user_id: str = Depends(require_user),
) -> Dict:
    """Get a single schedule."""
    record = schedules_repo.get_schedule(user_id, schedule_id)
    if not record:
        raise HTTPException(404, "Schedule not found")
    return record


@router.patch("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    req: UpdateScheduleRequest,
    user_id: str = Depends(require_user),
) -> Dict:
    """Update schedule frequency, time, or date range."""
    existing = schedules_repo.get_schedule(user_id, schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found")

    updates = req.model_dump(exclude_none=True)

    # Validate fields when provided
    if "frequency" in updates and updates["frequency"] not in _VALID_FREQUENCIES:
        raise HTTPException(400, f"Invalid frequency")
    if (
        "date_range_preset" in updates
        and updates["date_range_preset"] not in _VALID_DATE_PRESETS
    ):
        raise HTTPException(400, "Invalid date_range_preset")
    if "project_id" in updates and not str(updates["project_id"]).strip():
        raise HTTPException(400, "project_id is required")
    if "connector_config" in updates:
        updates["connector_config"] = _normalize_connector_config(
            existing["provider"], updates["connector_config"]
        )

    # Update EventBridge if timing changed
    timing_changed = any(k in updates for k in ("frequency", "hour_utc", "day_of_week"))
    if timing_changed:
        if scheduler_service.is_scheduler_configured():
            try:
                if existing.get("eventbridge_rule_name"):
                    scheduler_service.update_schedule(
                        rule_name=existing["eventbridge_rule_name"],
                        schedule_id=schedule_id,
                        frequency=updates.get("frequency", existing["frequency"]),
                        hour_utc=updates.get("hour_utc", existing["hour_utc"]),
                        day_of_week=updates.get("day_of_week", existing["day_of_week"]),
                    )
                    updates["scheduler_status"] = "configured"
                    updates["scheduler_error"] = ""
                else:
                    rule_name = scheduler_service.create_schedule(
                        schedule_id=schedule_id,
                        frequency=updates.get("frequency", existing["frequency"]),
                        hour_utc=updates.get("hour_utc", existing["hour_utc"]),
                        day_of_week=updates.get("day_of_week", existing["day_of_week"]),
                    )
                    updates["eventbridge_rule_name"] = rule_name
                    updates["scheduler_status"] = "configured"
                    updates["scheduler_error"] = ""
            except Exception as exc:
                logger.warning("EventBridge update failed: %s", exc)
                updates["scheduler_status"] = "error"
                updates["scheduler_error"] = str(exc)
        else:
            updates["scheduler_status"] = "not_configured"
            updates["scheduler_error"] = (
                "EventBridge Scheduler role or Lambda target is not configured."
            )

    return schedules_repo.update_schedule(user_id, schedule_id, **updates)


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: str,
    user_id: str = Depends(require_user),
) -> None:
    """Delete a schedule and its EventBridge rule."""
    existing = schedules_repo.get_schedule(user_id, schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found")

    if existing.get("eventbridge_rule_name"):
        try:
            scheduler_service.delete_schedule(existing["eventbridge_rule_name"])
        except Exception as exc:
            logger.warning("EventBridge delete failed (non-fatal): %s", exc)

    schedules_repo.delete_schedule(user_id, schedule_id)


@router.post("/schedules/{schedule_id}/pause", status_code=200)
async def pause_schedule(
    schedule_id: str,
    user_id: str = Depends(require_user),
) -> Dict:
    """Pause a schedule (disables EventBridge rule)."""
    existing = schedules_repo.get_schedule(user_id, schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found")

    if existing.get("eventbridge_rule_name"):
        try:
            scheduler_service.pause_schedule(existing["eventbridge_rule_name"])
        except Exception as exc:
            logger.warning("EventBridge pause failed (non-fatal): %s", exc)

    return schedules_repo.update_schedule(user_id, schedule_id, status="paused")


@router.post("/schedules/{schedule_id}/resume", status_code=200)
async def resume_schedule(
    schedule_id: str,
    user_id: str = Depends(require_user),
) -> Dict:
    """Resume a paused schedule."""
    existing = schedules_repo.get_schedule(user_id, schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found")

    if existing.get("eventbridge_rule_name"):
        try:
            scheduler_service.resume_schedule(existing["eventbridge_rule_name"])
        except Exception as exc:
            logger.warning("EventBridge resume failed (non-fatal): %s", exc)

    return schedules_repo.update_schedule(user_id, schedule_id, status="active")


@router.post("/schedules/{schedule_id}/run-now", status_code=200)
async def run_schedule_now(
    schedule_id: str,
    user_id: str = Depends(require_user),
) -> Dict:
    """Run a user's schedule immediately for validation/debugging."""
    existing = schedules_repo.get_schedule(user_id, schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found")

    from app.api.route_modules.internal import execute_schedule

    return await execute_schedule(schedule_id)


@router.get("/schedules/{schedule_id}/runs")
async def get_schedule_runs(
    schedule_id: str,
    limit: int = 20,
    user_id: str = Depends(require_user),
) -> List[Dict]:
    """Return recent run history for a specific schedule."""
    existing = schedules_repo.get_schedule(user_id, schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found")
    return runs_repo.list_runs_for_schedule(schedule_id, limit=min(limit, 100))


@router.get("/sync-runs")
async def get_all_sync_runs(
    limit: int = 50,
    last_key: Optional[str] = None,
    user_id: str = Depends(require_user),
) -> Dict:
    """Return paginated sync run history across all schedules for the current user."""
    import json

    last_evaluated_key = json.loads(last_key) if last_key else None
    items, next_key = runs_repo.list_runs_for_user(
        user_id, limit=min(limit, 100), last_evaluated_key=last_evaluated_key
    )
    return {
        "items": items,
        "next_key": json.dumps(next_key) if next_key else None,
    }
