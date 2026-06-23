import asyncio
import base64
import csv
import hashlib
import io
import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx
from fastapi import HTTPException

from app.services.warehouse_service import (
    _decrypt_secret,
    _encrypt_secret,
    _sanitize_filename_part,
)
from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import connected_accounts as connected_accounts_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes
from utils.s3.paths import build_asset_key

logger = logging.getLogger(__name__)


MIXPANEL_PROVIDER = "mixpanel"
MIXPANEL_ASSET_TYPE = "integration_mixpanel"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
RAW_EXPORT_API_LIMIT = 100_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

REGION_CONFIG = {
    "US": {
        "query_base_url": "https://mixpanel.com/api/2.0",
        "export_base_url": "https://data.mixpanel.com/api/2.0",
    },
    "EU": {
        "query_base_url": "https://eu.mixpanel.com/api/2.0",
        "export_base_url": "https://data-eu.mixpanel.com/api/2.0",
    },
}

VALID_REPORT_TYPES = {
    "product_overview",
    "events",
    "event_breakdown",
    "funnels",
    "retention",
    "cohorts",
    "users",
}

REPORT_LABELS = {
    "product_overview": "Product Overview",
    "events": "Raw Events",
    "event_breakdown": "Event Breakdown",
    "funnels": "Funnels",
    "retention": "Retention",
    "cohorts": "Cohorts",
    "users": "Users",
}

REPORT_RESOURCES = {
    "product_overview": "all",
    "events": "event",
    "event_breakdown": "event",
    "funnels": "funnel",
    "retention": "cohort",
    "cohorts": "cohort",
    "users": "user",
}

REPORT_HEADERS = {
    "product_overview": [
        "date_start",
        "date_end",
        "project_id",
        "region",
        "event_count",
        "funnel_count",
        "cohort_count",
        "user_sample_count",
        "top_events",
    ],
    "events": [
        "event_time",
        "event_name",
        "distinct_id",
        "insert_id",
        "city",
        "region",
        "country",
        "browser",
        "os",
        "properties_json",
    ],
    "event_breakdown": ["date", "event_name", "segment", "value", "count"],
    "funnels": [
        "funnel_id",
        "funnel_name",
        "step_label",
        "step_index",
        "count",
        "conversion_rate",
        "date_start",
        "date_end",
    ],
    "retention": [
        "cohort_id",
        "cohort_name",
        "date",
        "period",
        "users",
        "retained",
        "retention_rate",
    ],
    "cohorts": ["cohort_id", "name", "type", "count", "updated_at"],
    "users": [
        "distinct_id",
        "email",
        "name",
        "created",
        "last_seen",
        "properties_json",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_region(value: Any) -> str:
    region = str(value or "US").strip().upper()
    if region not in REGION_CONFIG:
        raise HTTPException(status_code=400, detail="region must be US or EU.")
    return region


def _normalize_row_limit(value: Any, raw_export: bool = False) -> int:
    max_limit = RAW_EXPORT_API_LIMIT if raw_export else MAX_ROW_LIMIT
    try:
        return max(1, min(int(value or DEFAULT_ROW_LIMIT), max_limit))
    except (TypeError, ValueError):
        return DEFAULT_ROW_LIMIT


def _normalize_max_bytes(value: Any) -> int:
    try:
        return max(1, int(value or DEFAULT_MAX_EXPORT_BYTES))
    except (TypeError, ValueError):
        return DEFAULT_MAX_EXPORT_BYTES


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def resolve_date_window(
    date_preset: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
) -> Dict[str, str]:
    today = datetime.now(timezone.utc).date()
    preset = str(date_preset or "last_30d")
    if preset == "custom":
        start = _parse_date(start_date)
        end = _parse_date(end_date)
        if not start or not end:
            raise HTTPException(
                status_code=400,
                detail="start_date and end_date are required for custom date ranges.",
            )
    elif preset == "last_7d":
        end = today
        start = today - timedelta(days=7)
    elif preset == "last_14d":
        end = today
        start = today - timedelta(days=14)
    elif preset == "last_90d":
        end = today
        start = today - timedelta(days=90)
    else:
        end = today
        start = today - timedelta(days=30)
    if start > end:
        raise HTTPException(
            status_code=400, detail="start_date must be before end_date."
        )
    return {"from": start.isoformat(), "to": end.isoformat()}


def _schema_fingerprint(headers: Sequence[str]) -> str:
    payload = json.dumps(list(headers), separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _csv_bytes(headers: Sequence[str], rows: Sequence[Dict[str, Any]]) -> bytes:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(headers), extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({header: row.get(header, "") for header in headers})
    return output.getvalue().encode("utf-8")


def _json_text(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return str(value or "")


def _redact_pii(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "@" in raw:
        name, domain = raw.split("@", 1)
        return f"{name[:1]}***@{domain}"
    return f"{raw[:4]}***" if len(raw) > 6 else "***"


def _strip_pii_properties(properties: Dict[str, Any]) -> Dict[str, Any]:
    pii_keys = {
        "distinct_id",
        "$email",
        "email",
        "$name",
        "name",
        "first_name",
        "last_name",
        "$phone",
        "phone",
        "user_id",
    }
    return {key: value for key, value in properties.items() if key not in pii_keys}


class MixpanelAdapter:
    def _auth_header(self, username: str, secret: str) -> str:
        token = base64.b64encode(f"{username}:{secret}".encode("utf-8")).decode("ascii")
        return f"Basic {token}"

    async def test_connection(
        self, *, username: str, secret: str, project_id: str, region: str
    ) -> Dict[str, Any]:
        payload = await self.api_get(
            region=region,
            username=username,
            secret=secret,
            path="/events/names",
            params={"project_id": project_id, "limit": 1},
        )
        return payload if isinstance(payload, dict) else {}

    async def api_get(
        self,
        *,
        region: str,
        username: str,
        secret: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        export: bool = False,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        base_url = REGION_CONFIG[region][
            "export_base_url" if export else "query_base_url"
        ]
        url = path if path.startswith("http") else f"{base_url}{path}"
        headers = {
            "Authorization": self._auth_header(username, secret),
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await self._get_with_retries(
                client, url, params, headers, max_attempts
            )
        if export:
            return {"text": response.text}
        return response.json() if response.content else {}

    async def _get_with_retries(
        self,
        client: httpx.AsyncClient,
        url: str,
        params: Optional[Dict[str, Any]],
        headers: Dict[str, str],
        max_attempts: int,
    ) -> httpx.Response:
        last_error: Optional[Exception] = None
        for attempt in range(max_attempts):
            response = await client.get(url, params=params, headers=headers)
            if response.status_code == 429 and attempt < max_attempts - 1:
                delay = min(float(response.headers.get("Retry-After", "1")), 5.0)
                await self._sleep(delay)
                continue
            try:
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if response.status_code in {429, 503} and attempt < max_attempts - 1:
                    await self._sleep(1.0 + attempt)
                    continue
                raise
        if last_error:
            raise last_error
        raise HTTPException(status_code=502, detail="Mixpanel request failed.")

    async def _sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    async def fetch_resources(
        self, *, username: str, secret: str, project_id: str, region: str
    ) -> Dict[str, Any]:
        events = await self._safe_list(
            username=username,
            secret=secret,
            project_id=project_id,
            region=region,
            path="/events/names",
            key="events",
        )
        funnels = await self._safe_list(
            username=username,
            secret=secret,
            project_id=project_id,
            region=region,
            path="/funnels/list",
            key="funnels",
        )
        cohorts = await self._safe_list(
            username=username,
            secret=secret,
            project_id=project_id,
            region=region,
            path="/cohorts/list",
            key="cohorts",
        )
        return {"events": events, "funnels": funnels, "cohorts": cohorts}

    async def _safe_list(
        self,
        *,
        username: str,
        secret: str,
        project_id: str,
        region: str,
        path: str,
        key: str,
    ) -> List[Dict[str, Any]]:
        try:
            payload = await self.api_get(
                region=region,
                username=username,
                secret=secret,
                path=path,
                params={"project_id": project_id},
            )
        except Exception as exc:
            logger.info("Mixpanel resource lookup failed for %s: %s", path, exc)
            return []
        return self._normalize_resource_list(payload, key)

    def _normalize_resource_list(
        self, payload: Dict[str, Any], key: str
    ) -> List[Dict[str, Any]]:
        raw_items = (
            payload.get(key) or payload.get("results") or payload.get("data") or []
        )
        if isinstance(raw_items, dict):
            raw_items = raw_items.values()
        items: List[Dict[str, Any]] = []
        for item in raw_items if isinstance(raw_items, list) else list(raw_items):
            if isinstance(item, str):
                items.append({"id": item, "name": item})
            elif isinstance(item, dict):
                item_id = item.get("id") or item.get("funnel_id") or item.get("name")
                items.append(
                    {
                        "id": str(item_id or ""),
                        "name": str(item.get("name") or item_id or ""),
                    }
                )
        return [item for item in items if item.get("id")]

    async def fetch_report_rows(
        self,
        *,
        username: str,
        secret: str,
        project_id: str,
        region: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
    ) -> Dict[str, Any]:
        if report_type == "events":
            return await self._fetch_events(
                username,
                secret,
                project_id,
                region,
                date_window,
                row_limit,
                include_pii,
                resource_id,
            )
        if report_type == "event_breakdown":
            return await self._fetch_segmentation(
                username, secret, project_id, region, date_window, resource_id
            )
        if report_type == "funnels":
            return await self._fetch_funnels(
                username, secret, project_id, region, date_window, resource_id
            )
        if report_type in {"retention", "cohorts", "users", "product_overview"}:
            return await self._fetch_resource_backed_report(
                username,
                secret,
                project_id,
                region,
                report_type,
                date_window,
                include_pii,
            )
        raise HTTPException(status_code=400, detail="Invalid Mixpanel report_type.")

    async def _fetch_events(
        self,
        username: str,
        secret: str,
        project_id: str,
        region: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "project_id": project_id,
            "from_date": date_window["from"],
            "to_date": date_window["to"],
            "limit": min(row_limit, RAW_EXPORT_API_LIMIT),
        }
        if resource_id and resource_id != "all":
            params["event"] = json.dumps([resource_id])
        payload = await self.api_get(
            region=region,
            username=username,
            secret=secret,
            path="/export",
            params=params,
            export=True,
        )
        rows = self._parse_jsonl_events(
            str(payload.get("text") or ""), include_pii, row_limit
        )
        return {
            "rows": rows,
            "api_mode": "raw_export",
            "endpoints_used": ["GET /export"],
            "truncated": len(rows) >= row_limit,
        }

    def _parse_jsonl_events(
        self, text: str, include_pii: bool, row_limit: int
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for line in text.splitlines():
            if len(rows) >= row_limit:
                break
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append(self._flatten_event(item, include_pii))
        return rows

    def _flatten_event(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        props = (
            item.get("properties") if isinstance(item.get("properties"), dict) else {}
        )
        safe_props = props if include_pii else _strip_pii_properties(props)
        distinct_id = props.get("distinct_id") or props.get("$distinct_id")
        return {
            "event_time": props.get("time") or item.get("time") or "",
            "event_name": item.get("event") or props.get("event") or "",
            "distinct_id": distinct_id if include_pii else _redact_pii(distinct_id),
            "insert_id": props.get("$insert_id") or props.get("insert_id") or "",
            "city": props.get("$city") or "",
            "region": props.get("$region") or "",
            "country": props.get("$country_code") or props.get("mp_country_code") or "",
            "browser": props.get("$browser") or "",
            "os": props.get("$os") or "",
            "properties_json": _json_text(safe_props),
        }

    async def _fetch_segmentation(
        self,
        username: str,
        secret: str,
        project_id: str,
        region: str,
        date_window: Dict[str, str],
        resource_id: str,
    ) -> Dict[str, Any]:
        event_name = (
            resource_id
            if resource_id and resource_id != "all"
            else "$ae_first_app_open"
        )
        payload = await self.api_get(
            region=region,
            username=username,
            secret=secret,
            path="/segmentation",
            params={
                "project_id": project_id,
                "event": event_name,
                "from_date": date_window["from"],
                "to_date": date_window["to"],
                "unit": "day",
            },
        )
        return {
            "rows": self._flatten_segmentation(payload, event_name),
            "api_mode": "segmentation",
            "endpoints_used": ["GET /segmentation"],
            "truncated": False,
        }

    def _flatten_segmentation(
        self, payload: Dict[str, Any], event_name: str
    ) -> List[Dict[str, Any]]:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        series = data.get("series") if isinstance(data.get("series"), dict) else {}
        values = data.get("values") if isinstance(data.get("values"), dict) else {}
        rows: List[Dict[str, Any]] = []
        for segment, day_counts in values.items():
            if not isinstance(day_counts, dict):
                continue
            for day, count in day_counts.items():
                rows.append(
                    {
                        "date": day,
                        "event_name": event_name,
                        "segment": segment,
                        "value": series.get(segment, segment),
                        "count": count,
                    }
                )
        return rows

    async def _fetch_funnels(
        self,
        username: str,
        secret: str,
        project_id: str,
        region: str,
        date_window: Dict[str, str],
        resource_id: str,
    ) -> Dict[str, Any]:
        if not resource_id or resource_id == "all":
            resources = await self.fetch_resources(
                username=username, secret=secret, project_id=project_id, region=region
            )
            rows = [
                {
                    "funnel_id": item["id"],
                    "funnel_name": item["name"],
                    "step_label": "",
                    "step_index": "",
                    "count": "",
                    "conversion_rate": "",
                    "date_start": date_window["from"],
                    "date_end": date_window["to"],
                }
                for item in resources.get("funnels", [])
            ]
            return {
                "rows": rows,
                "api_mode": "funnels_list",
                "endpoints_used": ["GET /funnels/list"],
                "truncated": False,
            }
        payload = await self.api_get(
            region=region,
            username=username,
            secret=secret,
            path="/funnels",
            params={
                "project_id": project_id,
                "funnel_id": resource_id,
                "from_date": date_window["from"],
                "to_date": date_window["to"],
            },
        )
        return {
            "rows": self._flatten_funnel(payload, resource_id, date_window),
            "api_mode": "funnels",
            "endpoints_used": ["GET /funnels"],
            "truncated": False,
        }

    def _flatten_funnel(
        self, payload: Dict[str, Any], resource_id: str, date_window: Dict[str, str]
    ) -> List[Dict[str, Any]]:
        steps = payload.get("steps") or payload.get("data") or []
        rows: List[Dict[str, Any]] = []
        for idx, step in enumerate(steps if isinstance(steps, list) else []):
            if not isinstance(step, dict):
                continue
            rows.append(
                {
                    "funnel_id": resource_id,
                    "funnel_name": payload.get("name") or resource_id,
                    "step_label": step.get("event")
                    or step.get("name")
                    or f"Step {idx + 1}",
                    "step_index": idx + 1,
                    "count": step.get("count"),
                    "conversion_rate": step.get("conversion_rate"),
                    "date_start": date_window["from"],
                    "date_end": date_window["to"],
                }
            )
        return rows

    async def _fetch_resource_backed_report(
        self,
        username: str,
        secret: str,
        project_id: str,
        region: str,
        report_type: str,
        date_window: Dict[str, str],
        include_pii: bool,
    ) -> Dict[str, Any]:
        resources = await self.fetch_resources(
            username=username, secret=secret, project_id=project_id, region=region
        )
        if report_type == "product_overview":
            return self._overview_rows(project_id, region, date_window, resources)
        if report_type == "cohorts":
            return {
                "rows": [
                    self._cohort_row(item) for item in resources.get("cohorts", [])
                ],
                "api_mode": "cohorts_list",
                "endpoints_used": ["GET /cohorts/list"],
                "truncated": False,
            }
        if report_type == "users":
            return await self._fetch_users(
                username, secret, project_id, region, include_pii
            )
        rows = [
            {
                "cohort_id": item["id"],
                "cohort_name": item["name"],
                "date": date_window["to"],
                "period": "",
                "users": "",
                "retained": "",
                "retention_rate": "",
            }
            for item in resources.get("cohorts", [])
        ]
        return {
            "rows": rows,
            "api_mode": "retention_resources",
            "endpoints_used": ["GET /cohorts/list"],
            "truncated": False,
        }

    def _overview_rows(
        self,
        project_id: str,
        region: str,
        date_window: Dict[str, str],
        resources: Dict[str, List[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        events = resources.get("events", [])
        row = {
            "date_start": date_window["from"],
            "date_end": date_window["to"],
            "project_id": project_id,
            "region": region,
            "event_count": len(events),
            "funnel_count": len(resources.get("funnels", [])),
            "cohort_count": len(resources.get("cohorts", [])),
            "user_sample_count": "",
            "top_events": ", ".join(item.get("name", "") for item in events[:10]),
        }
        return {
            "rows": [row],
            "api_mode": "resources_overview",
            "endpoints_used": [
                "GET /events/names",
                "GET /funnels/list",
                "GET /cohorts/list",
            ],
            "truncated": False,
        }

    def _cohort_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "cohort_id": item.get("id"),
            "name": item.get("name"),
            "type": item.get("type") or "cohort",
            "count": item.get("count") or "",
            "updated_at": item.get("updated_at") or "",
        }

    async def _fetch_users(
        self,
        username: str,
        secret: str,
        project_id: str,
        region: str,
        include_pii: bool,
    ) -> Dict[str, Any]:
        payload = await self.api_get(
            region=region,
            username=username,
            secret=secret,
            path="/engage",
            params={"project_id": project_id},
        )
        raw_items = payload.get("results") or []
        rows = [
            self._flatten_user(item, include_pii)
            for item in raw_items
            if isinstance(item, dict)
        ]
        return {
            "rows": rows,
            "api_mode": "engage",
            "endpoints_used": ["GET /engage"],
            "truncated": False,
        }

    def _flatten_user(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        props = (
            item.get("$properties") if isinstance(item.get("$properties"), dict) else {}
        )
        distinct_id = item.get("$distinct_id") or props.get("distinct_id")
        safe_props = props if include_pii else _strip_pii_properties(props)
        return {
            "distinct_id": distinct_id if include_pii else _redact_pii(distinct_id),
            "email": (
                props.get("$email") if include_pii else _redact_pii(props.get("$email"))
            ),
            "name": (
                props.get("$name") if include_pii else _redact_pii(props.get("$name"))
            ),
            "created": props.get("$created") or props.get("created"),
            "last_seen": props.get("$last_seen") or props.get("last_seen"),
            "properties_json": _json_text(safe_props),
        }


class MixpanelProductAnalyticsService:
    def __init__(self, adapter: Optional[MixpanelAdapter] = None):
        self.adapter = adapter or MixpanelAdapter()

    def _mixpanel_config(self) -> Dict[str, str]:
        cfg = getattr(config, "mixpanel", None)
        return {
            "username": str(
                getattr(cfg, "service_account_username", None)
                or os.environ.get("MIXPANEL_SERVICE_ACCOUNT_USERNAME", "")
            ),
            "secret": str(
                getattr(cfg, "service_account_secret", None)
                or os.environ.get("MIXPANEL_SERVICE_ACCOUNT_SECRET", "")
            ),
            "project_id": str(
                getattr(cfg, "project_id", None)
                or os.environ.get("MIXPANEL_PROJECT_ID", "")
            ),
            "region": str(
                getattr(cfg, "region", None) or os.environ.get("MIXPANEL_REGION", "US")
            ),
        }

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, MIXPANEL_PROVIDER) or {}
        )
        preserved = {
            key: value
            for key, value in existing.items()
            if key
            not in {
                "encrypted_service_account_username",
                "encrypted_service_account_secret",
                "service_account_username",
                "service_account_secret",
                "user_id",
                "provider",
                "updated_at",
            }
        }
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=MIXPANEL_PROVIDER,
            metadata={**preserved, **metadata},
        )

    async def connect(
        self,
        *,
        user_id: str,
        project_id: Optional[str],
        service_account_username: Optional[str],
        service_account_secret: Optional[str],
        region: Optional[str],
        account_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        cfg = self._mixpanel_config()
        resolved_project_id = str(project_id or cfg["project_id"]).strip()
        username = str(service_account_username or cfg["username"]).strip()
        secret = str(service_account_secret or cfg["secret"]).strip()
        normalized_region = _normalize_region(region or cfg["region"])
        if not resolved_project_id or not username or not secret:
            raise HTTPException(
                status_code=400,
                detail="project_id, service_account_username, and service_account_secret are required.",
            )
        await self.adapter.test_connection(
            username=username,
            secret=secret,
            project_id=resolved_project_id,
            region=normalized_region,
        )
        self._save_metadata(
            user_id,
            {
                "encrypted_service_account_username": _encrypt_secret(username),
                "encrypted_service_account_secret": _encrypt_secret(secret),
                "project_id": resolved_project_id,
                "region": normalized_region,
                "account_name": account_name
                or f"Mixpanel Project {resolved_project_id}",
                "connected_at": _now_iso(),
            },
        )
        return await self.get_connection_status(user_id)

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, MIXPANEL_PROVIDER) or {}
        )
        return {
            "connected": bool(record.get("encrypted_service_account_secret")),
            "project_id": record.get("project_id"),
            "region": record.get("region") or "US",
            "account_name": record.get("account_name") or record.get("project_id"),
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, MIXPANEL_PROVIDER)

    async def _credentials(self, user_id: str) -> Tuple[str, str, Dict[str, Any]]:
        record = (
            connected_accounts_repo.get_connection(user_id, MIXPANEL_PROVIDER) or {}
        )
        username = record.get("encrypted_service_account_username")
        secret = record.get("encrypted_service_account_secret")
        if not username or not secret:
            raise HTTPException(status_code=401, detail="Mixpanel is not connected.")
        try:
            return _decrypt_secret(str(username)), _decrypt_secret(str(secret)), record
        except Exception as exc:
            logger.warning("Failed to decrypt Mixpanel credentials: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="Mixpanel credentials could not be decrypted. Please reconnect.",
            ) from exc

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        username, secret, record = await self._credentials(user_id)
        region = _normalize_region(record.get("region") or "US")
        project_id = str(record.get("project_id") or "")
        resources = await self.adapter.fetch_resources(
            username=username, secret=secret, project_id=project_id, region=region
        )
        reports = [
            {
                "report_type": report_type,
                "label": REPORT_LABELS[report_type],
                "resource": REPORT_RESOURCES[report_type],
                "default": report_type == "product_overview",
            }
            for report_type in [
                "product_overview",
                "events",
                "event_breakdown",
                "funnels",
                "retention",
                "cohorts",
                "users",
            ]
        ]
        return {
            "reports": reports,
            "projects": [self._project_record(record)],
            **resources,
        }

    def _project_record(self, record: Dict[str, Any]) -> Dict[str, str]:
        project_id = str(record.get("project_id") or "all")
        return {
            "id": project_id,
            "name": str(record.get("account_name") or f"Mixpanel Project {project_id}"),
            "region": str(record.get("region") or "US"),
        }

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "mixpanel":
            raise HTTPException(status_code=400, detail="Invalid Mixpanel entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Mixpanel report type")
        return {
            "report_type": report_type,
            "project_id": parts[2] or "all",
            "resource_id": parts[3] or "all",
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, resource_id: str
    ) -> Dict[str, Any]:
        project_id = str(record.get("project_id") or "all")
        account_name = str(
            record.get("account_name") or f"Mixpanel Project {project_id}"
        )
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"mixpanel:{report_type}:{project_id}:{resource_id or 'all'}"
        return {
            "id": entity_id,
            "name": f"{account_name} / {label}",
            "type": "report",
            "account_name": account_name,
            "account_id": project_id,
            "project_id": project_id,
            "region": str(record.get("region") or "US"),
            "report_type": report_type,
            "resource_id": resource_id or "all",
            "connector_key": "mixpanel",
        }

    async def sync_entity(
        self,
        user_id: str,
        entity_id: str,
        project_id: str,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        cfg = dict(overrides or {})
        if entity_id:
            parsed = self.parse_entity_id(entity_id)
            cfg.setdefault("report_type", parsed["report_type"])
            cfg.setdefault("resource_id", parsed["resource_id"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "product_overview"),
            date_preset=cfg.get("date_preset"),
            start_date=cfg.get("start_date"),
            end_date=cfg.get("end_date"),
            row_limit=cfg.get("row_limit"),
            include_pii=bool(cfg.get("include_pii", False)),
            max_bytes=cfg.get("max_bytes"),
            resource_id=str(cfg.get("resource_id") or "all"),
        )

    async def sync_scheduled_entity(
        self,
        user_id: str,
        project_id: str,
        connector_config: Dict[str, Any],
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        date_range_preset: Optional[str] = None,
    ) -> Dict[str, Any]:
        cfg = {
            **(connector_config or {}),
            "start_date": start_date,
            "end_date": end_date,
            "date_preset": date_range_preset,
        }
        return await self.sync_entity(
            user_id=user_id,
            entity_id=str(connector_config.get("entity_id") or ""),
            project_id=project_id,
            overrides=cfg,
        )

    async def sync(
        self,
        user_id: str,
        project_id: str,
        report_type: str = "product_overview",
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        row_limit: Any = DEFAULT_ROW_LIMIT,
        include_pii: bool = False,
        max_bytes: Any = None,
        resource_id: str = "all",
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Mixpanel report_type.")
        username, secret, record = await self._credentials(user_id)
        row_cap = _normalize_row_limit(row_limit, raw_export=report_type == "events")
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        export = await self.adapter.fetch_report_rows(
            username=username,
            secret=secret,
            project_id=str(record.get("project_id") or ""),
            region=_normalize_region(record.get("region") or "US"),
            report_type=report_type,
            date_window=date_window,
            row_limit=row_cap,
            include_pii=include_pii,
            resource_id=resource_id or "all",
        )
        rows = list(export.get("rows") or [])[:row_cap]
        headers = REPORT_HEADERS[report_type]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="Mixpanel extract exceeded the configured byte cap.",
            )
        return self._save_mixpanel_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            resource_id=resource_id or "all",
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            include_pii=include_pii,
            api_mode=str(export.get("api_mode") or "query"),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("endpoints_used") or []),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_mixpanel_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        report_type: str,
        resource_id: str,
        date_window: Dict[str, str],
        row_limit: int,
        max_bytes: int,
        include_pii: bool,
        api_mode: str,
        truncated: bool,
        endpoints_used: Sequence[str],
        headers: Sequence[str],
        rows: Sequence[Dict[str, Any]],
        csv_content: bytes,
    ) -> Dict[str, Any]:
        checksum = compute_sha256_checksum(csv_content)
        asset_id = str(uuid.uuid4())
        file_id = str(uuid.uuid4())
        bucket = config.aws.s3.USER_ASSETS_BUCKET
        s3_key = build_asset_key(
            user_id=user_id,
            project_id=project_id,
            asset_id=asset_id,
            file_id=file_id,
            extension="csv",
        )
        upload_bytes(bucket, s3_key, csv_content, "text/csv")
        entity = self._selected_entity(record, report_type, resource_id)
        manifest = {
            "connector_key": "mixpanel",
            "source_type": "mixpanel",
            "project_id": record.get("project_id"),
            "region": record.get("region") or "US",
            "account_name": record.get("account_name"),
            "report_type": report_type,
            "resource_id": resource_id,
            "date_window": date_window,
            "row_cap": row_limit,
            "byte_cap": max_bytes,
            "row_count": len(rows),
            "truncated": truncated,
            "api_mode": api_mode,
            "api_endpoints_used": list(endpoints_used),
            "column_schema": [
                {"name": header, "data_type": "string"} for header in headers
            ],
            "checksum_sha256": checksum,
            "schema_fingerprint": _schema_fingerprint(headers),
            "data_format": "csv",
            "source_timezone": "UTC",
            "pii_redacted": not include_pii,
            "snapshot_time": _now_iso(),
        }
        return self._persist_asset(
            user_id,
            project_id,
            bucket,
            s3_key,
            asset_id,
            file_id,
            report_type,
            csv_content,
            checksum,
            manifest,
            entity,
            len(rows),
            len(headers),
        )

    def _persist_asset(
        self,
        user_id: str,
        project_id: str,
        bucket: str,
        s3_key: str,
        asset_id: str,
        file_id: str,
        report_type: str,
        csv_content: bytes,
        checksum: str,
        manifest: Dict[str, Any],
        entity: Dict[str, Any],
        row_count: int,
        column_count: int,
    ) -> Dict[str, Any]:
        manifest_key = f"{s3_key}.manifest.json"
        upload_bytes(
            bucket,
            manifest_key,
            json.dumps(manifest, sort_keys=True, default=str).encode("utf-8"),
            "application/json",
        )
        filename = f"mixpanel_{_sanitize_filename_part(report_type)}_{manifest['date_window']['from']}_{manifest['date_window']['to']}.csv"
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=MIXPANEL_ASSET_TYPE,
            size_bytes=len(csv_content),
            checksum_sha256=checksum,
            version=config.aws.s3.USER_ASSETS_BUCKET_VERSION,
            content_type="text/csv",
            asset_id=asset_id,
            file_id=file_id,
            original_filename=filename,
            extension="csv",
            row_count=row_count,
            column_count=column_count,
        )
        connected_accounts_repo.append_selected_entity(
            user_id=user_id, provider=MIXPANEL_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "mixpanel",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "mixpanel_project_id": manifest.get("project_id"),
                "mixpanel_report_type": report_type,
                "mixpanel_manifest_s3_key": manifest_key,
                "mixpanel_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {row_count} rows from Mixpanel ({entity['name']}).",
            "asset": updated or asset,
            "row_count": row_count,
            "column_count": column_count,
            "entity_id": entity["id"],
            "truncated": bool(manifest.get("truncated")),
            "api_mode": manifest.get("api_mode"),
        }


mixpanel_service = MixpanelProductAnalyticsService()
