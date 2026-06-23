import asyncio
import csv
import hashlib
import io
import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

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


POSTHOG_PROVIDER = "posthog"
POSTHOG_ASSET_TYPE = "integration_posthog"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

REGION_BASE_URLS = {
    "US": "https://us.posthog.com",
    "EU": "https://eu.posthog.com",
}

VALID_REPORT_TYPES = {
    "product_overview",
    "events",
    "event_breakdown",
    "insights",
    "funnels",
    "retention",
    "cohorts",
    "persons",
    "feature_flags",
}

REPORT_LABELS = {
    "product_overview": "Product Overview",
    "events": "Events",
    "event_breakdown": "Event Breakdown",
    "insights": "Insights",
    "funnels": "Funnels",
    "retention": "Retention",
    "cohorts": "Cohorts",
    "persons": "Persons",
    "feature_flags": "Feature Flags",
}

REPORT_RESOURCES = {
    "product_overview": "all",
    "events": "event",
    "event_breakdown": "event",
    "insights": "insight",
    "funnels": "insight",
    "retention": "insight",
    "cohorts": "cohort",
    "persons": "person",
    "feature_flags": "feature_flag",
}

REPORT_HEADERS = {
    "product_overview": [
        "date_start",
        "date_end",
        "project_id",
        "region",
        "base_url",
        "event_definition_count",
        "insight_count",
        "cohort_count",
        "feature_flag_count",
        "top_events",
    ],
    "events": [
        "event_time",
        "event_name",
        "distinct_id",
        "uuid",
        "properties_json",
    ],
    "event_breakdown": ["date", "event_name", "count"],
    "insights": [
        "insight_id",
        "name",
        "type",
        "created_at",
        "updated_at",
        "result_json",
    ],
    "funnels": [
        "insight_id",
        "name",
        "type",
        "created_at",
        "updated_at",
        "result_json",
    ],
    "retention": [
        "insight_id",
        "name",
        "type",
        "created_at",
        "updated_at",
        "result_json",
    ],
    "cohorts": [
        "cohort_id",
        "name",
        "count",
        "is_static",
        "created_at",
        "updated_at",
    ],
    "persons": [
        "distinct_id",
        "email",
        "name",
        "phone",
        "created_at",
        "properties_json",
    ],
    "feature_flags": [
        "flag_id",
        "key",
        "name",
        "active",
        "created_at",
        "filters_json",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_region(value: Any) -> str:
    region = str(value or "US").strip().upper()
    if region not in REGION_BASE_URLS:
        raise HTTPException(status_code=400, detail="region must be US or EU.")
    return region


def _normalize_base_url(region: str, base_url: Optional[str]) -> str:
    raw = str(base_url or "").strip().rstrip("/")
    if not raw:
        return REGION_BASE_URLS[region]
    parsed = urlparse(raw)
    hostname = parsed.hostname or ""
    is_local = hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (is_local and parsed.scheme == "http"):
        raise HTTPException(
            status_code=400,
            detail="base_url must be HTTPS, except localhost development URLs.",
        )
    if not hostname:
        raise HTTPException(status_code=400, detail="base_url is invalid.")
    return raw


def _normalize_row_limit(value: Any) -> int:
    try:
        return max(1, min(int(value or DEFAULT_ROW_LIMIT), MAX_ROW_LIMIT))
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
        "$distinct_id",
        "email",
        "$email",
        "name",
        "$name",
        "first_name",
        "last_name",
        "phone",
        "$phone",
        "user_id",
    }
    return {key: value for key, value in properties.items() if key not in pii_keys}


class PostHogAdapter:
    def _headers(self, api_key: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def test_connection(
        self, *, api_key: str, project_id: str, base_url: str
    ) -> Dict[str, Any]:
        payload = await self.api_get(
            base_url=base_url,
            api_key=api_key,
            path=f"/api/projects/{project_id}/",
        )
        return payload if isinstance(payload, dict) else {}

    async def api_get(
        self,
        *,
        base_url: str,
        api_key: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        url = path if path.startswith("http") else f"{base_url}{path}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await self._request_with_retries(
                client.get,
                url,
                params=params,
                headers=self._headers(api_key),
                max_attempts=max_attempts,
            )
        return response.json() if response.content else {}

    async def api_post(
        self,
        *,
        base_url: str,
        api_key: str,
        path: str,
        payload: Dict[str, Any],
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        url = path if path.startswith("http") else f"{base_url}{path}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await self._request_with_retries(
                client.post,
                url,
                json=payload,
                headers=self._headers(api_key),
                max_attempts=max_attempts,
            )
        return response.json() if response.content else {}

    async def _request_with_retries(
        self,
        request_fn,
        url: str,
        max_attempts: int,
        **kwargs,
    ) -> httpx.Response:
        last_error: Optional[Exception] = None
        for attempt in range(max_attempts):
            response = await request_fn(url, **kwargs)
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
        raise HTTPException(status_code=502, detail="PostHog request failed.")

    async def _sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    async def fetch_resources(
        self, *, api_key: str, project_id: str, base_url: str
    ) -> Dict[str, Any]:
        events = await self._safe_paginated_list(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
            path=f"/api/projects/{project_id}/event_definitions/",
        )
        properties = await self._safe_paginated_list(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
            path=f"/api/projects/{project_id}/property_definitions/",
        )
        insights = await self._safe_paginated_list(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
            path=f"/api/projects/{project_id}/insights/",
        )
        cohorts = await self._safe_paginated_list(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
            path=f"/api/projects/{project_id}/cohorts/",
        )
        feature_flags = await self._safe_paginated_list(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
            path=f"/api/projects/{project_id}/feature_flags/",
        )
        return {
            "events": self._normalize_named_resources(events, "event"),
            "properties": self._normalize_named_resources(properties, "property"),
            "insights": self._normalize_named_resources(insights, "insight"),
            "cohorts": self._normalize_named_resources(cohorts, "cohort"),
            "feature_flags": self._normalize_named_resources(
                feature_flags, "feature_flag"
            ),
        }

    async def _safe_paginated_list(
        self,
        *,
        api_key: str,
        project_id: str,
        base_url: str,
        path: str,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        try:
            return await self._paginated_list(
                api_key=api_key,
                base_url=base_url,
                path=path,
                params={"limit": min(limit, 100)},
                limit=limit,
            )
        except Exception as exc:
            logger.info("PostHog resource lookup failed for %s: %s", path, exc)
            return []

    async def _paginated_list(
        self,
        *,
        api_key: str,
        base_url: str,
        path: str,
        params: Dict[str, Any],
        limit: int,
    ) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        next_path: Optional[str] = path
        next_params: Optional[Dict[str, Any]] = dict(params)
        while next_path and len(items) < limit:
            payload = await self.api_get(
                base_url=base_url,
                api_key=api_key,
                path=next_path,
                params=next_params,
            )
            batch = payload.get("results") or payload.get("data") or []
            if isinstance(batch, list):
                items.extend(item for item in batch if isinstance(item, dict))
            next_url = payload.get("next")
            next_path = str(next_url) if next_url else None
            next_params = None
        return items[:limit]

    def _normalize_named_resources(
        self, items: Sequence[Dict[str, Any]], resource_type: str
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for item in items:
            item_id = item.get("id") or item.get("key") or item.get("name")
            name = item.get("name") or item.get("key") or item_id
            if not item_id:
                continue
            normalized.append(
                {
                    "id": str(item_id),
                    "name": str(name or item_id),
                    "type": resource_type,
                    "status": str(item.get("status") or "") or None,
                    "updated_at": item.get("updated_at") or item.get("created_at"),
                }
            )
        return normalized

    async def fetch_report_rows(
        self,
        *,
        api_key: str,
        project_id: str,
        base_url: str,
        region: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
    ) -> Dict[str, Any]:
        if report_type in {"events", "event_breakdown", "persons"}:
            return await self._fetch_query_report(
                api_key=api_key,
                project_id=project_id,
                base_url=base_url,
                report_type=report_type,
                date_window=date_window,
                row_limit=row_limit,
                include_pii=include_pii,
                resource_id=resource_id,
            )
        resources = await self.fetch_resources(
            api_key=api_key, project_id=project_id, base_url=base_url
        )
        if report_type == "product_overview":
            return self._overview_rows(
                project_id, region, base_url, date_window, resources
            )
        if report_type in {"insights", "funnels", "retention"}:
            rows = [
                self._insight_row(item)
                for item in self._filter_insights(
                    resources.get("insights", []), report_type, resource_id
                )
            ][:row_limit]
            return {
                "rows": rows,
                "api_mode": "resources",
                "endpoints_used": [f"GET /api/projects/{project_id}/insights/"],
                "generated_query": "saved insight resource list",
                "truncated": len(rows) >= row_limit,
            }
        if report_type == "cohorts":
            rows = [self._cohort_row(item) for item in resources.get("cohorts", [])][
                :row_limit
            ]
            return {
                "rows": rows,
                "api_mode": "resources",
                "endpoints_used": [f"GET /api/projects/{project_id}/cohorts/"],
                "generated_query": "cohort resource list",
                "truncated": len(rows) >= row_limit,
            }
        if report_type == "feature_flags":
            rows = [
                self._feature_flag_row(item)
                for item in resources.get("feature_flags", [])
            ][:row_limit]
            return {
                "rows": rows,
                "api_mode": "resources",
                "endpoints_used": [f"GET /api/projects/{project_id}/feature_flags/"],
                "generated_query": "feature flag resource list",
                "truncated": len(rows) >= row_limit,
            }
        raise HTTPException(status_code=400, detail="Invalid PostHog report_type.")

    async def _fetch_query_report(
        self,
        *,
        api_key: str,
        project_id: str,
        base_url: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
    ) -> Dict[str, Any]:
        query, values = self._generated_hogql(
            report_type, date_window, row_limit, resource_id
        )
        payload = await self.api_post(
            base_url=base_url,
            api_key=api_key,
            path=f"/api/projects/{project_id}/query/",
            payload={"query": {"kind": "HogQLQuery", "query": query, "values": values}},
        )
        rows = self._rows_from_query_response(payload, report_type, include_pii)[
            :row_limit
        ]
        return {
            "rows": rows,
            "api_mode": "query_api",
            "endpoints_used": [f"POST /api/projects/{project_id}/query/"],
            "generated_query": self._query_summary(report_type, resource_id),
            "truncated": len(rows) >= row_limit,
        }

    def _generated_hogql(
        self,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        resource_id: str,
    ) -> Tuple[str, Dict[str, Any]]:
        values: Dict[str, Any] = {
            "from": f"{date_window['from']} 00:00:00",
            "to": f"{date_window['to']} 23:59:59",
            "limit": row_limit,
        }
        if report_type == "events":
            where = (
                "timestamp >= toDateTime(%(from)s) AND timestamp <= toDateTime(%(to)s)"
            )
            if resource_id and resource_id != "all":
                where += " AND event = %(event)s"
                values["event"] = resource_id
            return (
                "SELECT timestamp, event, distinct_id, uuid, properties "
                f"FROM events WHERE {where} ORDER BY timestamp DESC LIMIT %(limit)s",
                values,
            )
        if report_type == "event_breakdown":
            where = (
                "timestamp >= toDateTime(%(from)s) AND timestamp <= toDateTime(%(to)s)"
            )
            if resource_id and resource_id != "all":
                where += " AND event = %(event)s"
                values["event"] = resource_id
            return (
                "SELECT toDate(timestamp) AS date, event, count() AS count "
                f"FROM events WHERE {where} GROUP BY date, event ORDER BY date DESC, count DESC LIMIT %(limit)s",
                values,
            )
        if report_type == "persons":
            return (
                "SELECT id, distinct_ids, properties, created_at "
                "FROM persons ORDER BY created_at DESC LIMIT %(limit)s",
                values,
            )
        raise HTTPException(
            status_code=400, detail="Unsupported generated PostHog query."
        )

    def _query_summary(self, report_type: str, resource_id: str) -> str:
        if report_type == "events":
            return f"bounded events query for {resource_id or 'all'}"
        if report_type == "event_breakdown":
            return f"daily event breakdown for {resource_id or 'all'}"
        if report_type == "persons":
            return "bounded persons query"
        return report_type

    def _rows_from_query_response(
        self, payload: Dict[str, Any], report_type: str, include_pii: bool
    ) -> List[Dict[str, Any]]:
        raw_rows = payload.get("results") or payload.get("data") or []
        columns = [str(col) for col in payload.get("columns") or []]
        rows: List[Dict[str, Any]] = []
        for raw in raw_rows if isinstance(raw_rows, list) else []:
            item = self._row_object(raw, columns)
            if report_type == "events":
                rows.append(self._event_row(item, include_pii))
            elif report_type == "event_breakdown":
                rows.append(
                    {
                        "date": item.get("date") or item.get("toDate(timestamp)") or "",
                        "event_name": item.get("event") or item.get("event_name") or "",
                        "count": item.get("count") or "",
                    }
                )
            elif report_type == "persons":
                rows.append(self._person_row(item, include_pii))
        return rows

    def _row_object(self, raw: Any, columns: Sequence[str]) -> Dict[str, Any]:
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, list):
            return {
                columns[idx] if idx < len(columns) else str(idx): value
                for idx, value in enumerate(raw)
            }
        return {}

    def _event_row(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        props = (
            item.get("properties") if isinstance(item.get("properties"), dict) else {}
        )
        safe_props = props if include_pii else _strip_pii_properties(props)
        distinct_id = item.get("distinct_id") or props.get("distinct_id")
        return {
            "event_time": item.get("timestamp") or item.get("event_time") or "",
            "event_name": item.get("event") or item.get("event_name") or "",
            "distinct_id": distinct_id if include_pii else _redact_pii(distinct_id),
            "uuid": item.get("uuid") or "",
            "properties_json": _json_text(safe_props),
        }

    def _person_row(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        props = (
            item.get("properties") if isinstance(item.get("properties"), dict) else {}
        )
        safe_props = props if include_pii else _strip_pii_properties(props)
        distinct_ids = (
            item.get("distinct_ids")
            if isinstance(item.get("distinct_ids"), list)
            else []
        )
        distinct_id = (
            distinct_ids[0]
            if distinct_ids
            else item.get("distinct_id") or item.get("id")
        )
        email = props.get("email") or props.get("$email")
        name = props.get("name") or props.get("$name")
        phone = props.get("phone") or props.get("$phone")
        return {
            "distinct_id": distinct_id if include_pii else _redact_pii(distinct_id),
            "email": email if include_pii else _redact_pii(email),
            "name": name if include_pii else _redact_pii(name),
            "phone": phone if include_pii else _redact_pii(phone),
            "created_at": item.get("created_at") or item.get("created") or "",
            "properties_json": _json_text(safe_props),
        }

    def _overview_rows(
        self,
        project_id: str,
        region: str,
        base_url: str,
        date_window: Dict[str, str],
        resources: Dict[str, List[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        events = resources.get("events", [])
        row = {
            "date_start": date_window["from"],
            "date_end": date_window["to"],
            "project_id": project_id,
            "region": region,
            "base_url": base_url,
            "event_definition_count": len(events),
            "insight_count": len(resources.get("insights", [])),
            "cohort_count": len(resources.get("cohorts", [])),
            "feature_flag_count": len(resources.get("feature_flags", [])),
            "top_events": ", ".join(item.get("name", "") for item in events[:10]),
        }
        return {
            "rows": [row],
            "api_mode": "resources_overview",
            "endpoints_used": [
                f"GET /api/projects/{project_id}/event_definitions/",
                f"GET /api/projects/{project_id}/insights/",
                f"GET /api/projects/{project_id}/cohorts/",
                f"GET /api/projects/{project_id}/feature_flags/",
            ],
            "generated_query": "resource overview",
            "truncated": False,
        }

    def _filter_insights(
        self, insights: Sequence[Dict[str, Any]], report_type: str, resource_id: str
    ) -> List[Dict[str, Any]]:
        if resource_id and resource_id != "all":
            return [
                item for item in insights if str(item.get("id")) == str(resource_id)
            ]
        if report_type == "funnels":
            return [
                item
                for item in insights
                if str(item.get("type", "")).lower() == "funnel"
            ]
        if report_type == "retention":
            return [
                item
                for item in insights
                if "retention" in str(item.get("type", "")).lower()
            ]
        return list(insights)

    def _insight_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "insight_id": item.get("id"),
            "name": item.get("name") or item.get("short_id") or item.get("id"),
            "type": item.get("type") or item.get("derived_name") or "",
            "created_at": item.get("created_at") or "",
            "updated_at": item.get("updated_at") or "",
            "result_json": _json_text(item.get("result") or item.get("filters") or {}),
        }

    def _cohort_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "cohort_id": item.get("id"),
            "name": item.get("name"),
            "count": item.get("count") or item.get("people") or "",
            "is_static": (
                item.get("is_static") if item.get("is_static") is not None else ""
            ),
            "created_at": item.get("created_at") or "",
            "updated_at": item.get("last_calculation") or item.get("updated_at") or "",
        }

    def _feature_flag_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "flag_id": item.get("id"),
            "key": item.get("key"),
            "name": item.get("name") or item.get("key"),
            "active": item.get("active"),
            "created_at": item.get("created_at") or "",
            "filters_json": _json_text(item.get("filters") or {}),
        }


class PostHogProductAnalyticsService:
    def __init__(self, adapter: Optional[PostHogAdapter] = None):
        self.adapter = adapter or PostHogAdapter()

    def _posthog_config(self) -> Dict[str, str]:
        cfg = getattr(config, "posthog", None)
        return {
            "api_key": str(
                getattr(cfg, "personal_api_key", None)
                or os.environ.get("POSTHOG_PERSONAL_API_KEY", "")
            ),
            "project_id": str(
                getattr(cfg, "project_id", None)
                or os.environ.get("POSTHOG_PROJECT_ID", "")
            ),
            "region": str(
                getattr(cfg, "region", None) or os.environ.get("POSTHOG_REGION", "US")
            ),
            "base_url": str(
                getattr(cfg, "base_url", None) or os.environ.get("POSTHOG_BASE_URL", "")
            ),
        }

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, POSTHOG_PROVIDER) or {}
        )
        preserved = {
            key: value
            for key, value in existing.items()
            if key
            not in {
                "encrypted_personal_api_key",
                "personal_api_key",
                "user_id",
                "provider",
                "updated_at",
            }
        }
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=POSTHOG_PROVIDER,
            metadata={**preserved, **metadata},
        )

    async def connect(
        self,
        *,
        user_id: str,
        project_id: Optional[str],
        personal_api_key: Optional[str],
        region: Optional[str],
        base_url: Optional[str] = None,
        account_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        cfg = self._posthog_config()
        resolved_project_id = str(project_id or cfg["project_id"]).strip()
        api_key = str(personal_api_key or cfg["api_key"]).strip()
        normalized_region = _normalize_region(region or cfg["region"])
        resolved_base_url = _normalize_base_url(
            normalized_region, base_url or cfg["base_url"]
        )
        if not resolved_project_id or not api_key:
            raise HTTPException(
                status_code=400,
                detail="project_id and personal_api_key are required.",
            )
        await self.adapter.test_connection(
            api_key=api_key,
            project_id=resolved_project_id,
            base_url=resolved_base_url,
        )
        self._save_metadata(
            user_id,
            {
                "encrypted_personal_api_key": _encrypt_secret(api_key),
                "project_id": resolved_project_id,
                "region": normalized_region,
                "base_url": resolved_base_url,
                "account_name": account_name
                or f"PostHog Project {resolved_project_id}",
                "connected_at": _now_iso(),
            },
        )
        return await self.get_connection_status(user_id)

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, POSTHOG_PROVIDER) or {}
        return {
            "connected": bool(record.get("encrypted_personal_api_key")),
            "project_id": record.get("project_id"),
            "region": record.get("region") or "US",
            "base_url": record.get("base_url") or REGION_BASE_URLS["US"],
            "account_name": record.get("account_name") or record.get("project_id"),
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, POSTHOG_PROVIDER)

    async def _credentials(self, user_id: str) -> Tuple[str, Dict[str, Any]]:
        record = connected_accounts_repo.get_connection(user_id, POSTHOG_PROVIDER) or {}
        encrypted_key = record.get("encrypted_personal_api_key")
        if not encrypted_key:
            raise HTTPException(status_code=401, detail="PostHog is not connected.")
        try:
            return _decrypt_secret(str(encrypted_key)), record
        except Exception as exc:
            logger.warning("Failed to decrypt PostHog credentials: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="PostHog credentials could not be decrypted. Please reconnect.",
            ) from exc

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        api_key, record = await self._credentials(user_id)
        project_id = str(record.get("project_id") or "")
        resources = await self.adapter.fetch_resources(
            api_key=api_key,
            project_id=project_id,
            base_url=str(record.get("base_url") or REGION_BASE_URLS["US"]),
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
                "insights",
                "funnels",
                "retention",
                "cohorts",
                "persons",
                "feature_flags",
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
            "name": str(record.get("account_name") or f"PostHog Project {project_id}"),
            "region": str(record.get("region") or "US"),
            "base_url": str(record.get("base_url") or REGION_BASE_URLS["US"]),
        }

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "posthog":
            raise HTTPException(status_code=400, detail="Invalid PostHog entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid PostHog report type")
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
            record.get("account_name") or f"PostHog Project {project_id}"
        )
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"posthog:{report_type}:{project_id}:{resource_id or 'all'}"
        return {
            "id": entity_id,
            "name": f"{account_name} / {label}",
            "type": "report",
            "account_name": account_name,
            "account_id": project_id,
            "project_id": project_id,
            "region": str(record.get("region") or "US"),
            "base_url": str(record.get("base_url") or REGION_BASE_URLS["US"]),
            "report_type": report_type,
            "resource_id": resource_id or "all",
            "connector_key": "posthog",
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
            raise HTTPException(status_code=400, detail="Invalid PostHog report_type.")
        api_key, record = await self._credentials(user_id)
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        export = await self.adapter.fetch_report_rows(
            api_key=api_key,
            project_id=str(record.get("project_id") or ""),
            base_url=str(record.get("base_url") or REGION_BASE_URLS["US"]),
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
                detail="PostHog extract exceeded the configured byte cap.",
            )
        return self._save_posthog_asset(
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
            generated_query=str(export.get("generated_query") or ""),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("endpoints_used") or []),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_posthog_asset(
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
        generated_query: str,
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
            "connector_key": "posthog",
            "source_type": "posthog",
            "project_id": record.get("project_id"),
            "region": record.get("region") or "US",
            "base_url": record.get("base_url") or REGION_BASE_URLS["US"],
            "account_name": record.get("account_name"),
            "report_type": report_type,
            "resource_id": resource_id,
            "date_window": date_window,
            "row_cap": row_limit,
            "byte_cap": max_bytes,
            "row_count": len(rows),
            "truncated": truncated,
            "api_mode": api_mode,
            "generated_query": generated_query,
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
        filename = f"posthog_{_sanitize_filename_part(report_type)}_{manifest['date_window']['from']}_{manifest['date_window']['to']}.csv"
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=POSTHOG_ASSET_TYPE,
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
            user_id=user_id, provider=POSTHOG_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "posthog",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "posthog_project_id": manifest.get("project_id"),
                "posthog_report_type": report_type,
                "posthog_manifest_s3_key": manifest_key,
                "posthog_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {row_count} rows from PostHog ({entity['name']}).",
            "asset": updated or asset,
            "row_count": row_count,
            "column_count": column_count,
            "entity_id": entity["id"],
            "truncated": bool(manifest.get("truncated")),
            "api_mode": manifest.get("api_mode"),
        }


posthog_service = PostHogProductAnalyticsService()
