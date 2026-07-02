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


CUSTOMER_IO_PROVIDER = "customer_io"
CUSTOMER_IO_ASSET_TYPE = "integration_customer_io"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

REGION_BASE_URLS = {
    "US": "https://api.customer.io/v1",
    "EU": "https://api-eu.customer.io/v1",
}

VALID_REPORT_TYPES = {
    "lifecycle_overview",
    "campaigns",
    "campaign_actions",
    "newsletters",
    "segments",
    "people",
    "events",
    "message_metrics",
}

REPORT_LABELS = {
    "lifecycle_overview": "Lifecycle Overview",
    "campaigns": "Campaigns",
    "campaign_actions": "Campaign Actions",
    "newsletters": "Newsletters",
    "segments": "Segments",
    "people": "People",
    "events": "Events",
    "message_metrics": "Message Metrics",
}

REPORT_RESOURCES = {
    "lifecycle_overview": "all",
    "campaigns": "campaign",
    "campaign_actions": "campaign",
    "newsletters": "newsletter",
    "segments": "segment",
    "people": "person",
    "events": "event",
    "message_metrics": "metric",
}

REPORT_HEADERS = {
    "lifecycle_overview": [
        "date_start",
        "date_end",
        "workspace_id",
        "account_name",
        "region",
        "campaign_count",
        "newsletter_count",
        "segment_count",
        "people_sample_count",
        "top_campaigns",
    ],
    "campaigns": [
        "campaign_id",
        "name",
        "state",
        "type",
        "created_at",
        "updated_at",
        "sent_count",
        "opened_count",
        "clicked_count",
        "converted_count",
    ],
    "campaign_actions": [
        "campaign_id",
        "action_id",
        "name",
        "type",
        "state",
        "created_at",
        "updated_at",
    ],
    "newsletters": [
        "newsletter_id",
        "name",
        "subject",
        "state",
        "created_at",
        "updated_at",
        "sent_count",
        "opened_count",
        "clicked_count",
        "converted_count",
    ],
    "segments": [
        "segment_id",
        "name",
        "description",
        "type",
        "created_at",
        "updated_at",
        "member_count",
    ],
    "people": [
        "person_id",
        "email",
        "name",
        "created_at",
        "updated_at",
        "last_emailed_at",
        "attributes_json",
    ],
    "events": [
        "event_id",
        "event_name",
        "person_id",
        "email",
        "timestamp",
        "properties_json",
    ],
    "message_metrics": [
        "message_id",
        "resource_id",
        "resource_type",
        "channel",
        "sent",
        "opened",
        "clicked",
        "converted",
        "unsubscribed",
        "bounced",
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
            detail="api_base_url must be HTTPS, except localhost development URLs.",
        )
    if not hostname:
        raise HTTPException(status_code=400, detail="api_base_url is invalid.")
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
        "email",
        "name",
        "first_name",
        "last_name",
        "phone",
        "phone_number",
        "user_id",
        "customer_id",
        "cio_id",
        "id",
    }
    return {key: value for key, value in properties.items() if key not in pii_keys}


class CustomerIOAdapter:
    def _headers(self, app_api_key: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {app_api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def test_connection(
        self, *, app_api_key: str, base_url: str
    ) -> Dict[str, Any]:
        payload = await self.api_get(
            app_api_key=app_api_key,
            base_url=base_url,
            path="/campaigns",
            params={"limit": 1},
        )
        return payload if isinstance(payload, dict) else {}

    async def api_get(
        self,
        *,
        app_api_key: str,
        base_url: str,
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
                headers=self._headers(app_api_key),
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
        raise HTTPException(status_code=502, detail="Customer.io request failed.")

    async def _sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    async def fetch_resources(
        self, *, app_api_key: str, base_url: str
    ) -> Dict[str, Any]:
        campaigns = await self._safe_paginated_list(
            app_api_key=app_api_key, base_url=base_url, path="/campaigns"
        )
        newsletters = await self._safe_paginated_list(
            app_api_key=app_api_key, base_url=base_url, path="/newsletters"
        )
        segments = await self._safe_paginated_list(
            app_api_key=app_api_key, base_url=base_url, path="/segments"
        )
        people = await self._safe_paginated_list(
            app_api_key=app_api_key, base_url=base_url, path="/customers", limit=50
        )
        return {
            "campaigns": self._normalize_named_resources(campaigns, "campaign"),
            "newsletters": self._normalize_named_resources(newsletters, "newsletter"),
            "segments": self._normalize_named_resources(segments, "segment"),
            "people": self._normalize_named_resources(people, "person"),
        }

    async def _safe_paginated_list(
        self,
        *,
        app_api_key: str,
        base_url: str,
        path: str,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        try:
            return await self._paginated_list(
                app_api_key=app_api_key,
                base_url=base_url,
                path=path,
                params={"limit": min(limit, 100)},
                limit=limit,
            )
        except Exception as exc:
            logger.info("Customer.io resource lookup failed for %s: %s", path, exc)
            return []

    async def _paginated_list(
        self,
        *,
        app_api_key: str,
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
                app_api_key=app_api_key,
                base_url=base_url,
                path=next_path,
                params=next_params,
            )
            batch = self._extract_items(payload)
            items.extend(item for item in batch if isinstance(item, dict))
            next_url = (
                payload.get("next")
                or payload.get("next_page")
                or (payload.get("links") or {}).get("next")
            )
            next_path = str(next_url) if next_url else None
            next_params = None
        return items[:limit]

    def _extract_items(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        for key in (
            "results",
            "data",
            "items",
            "campaigns",
            "newsletters",
            "segments",
            "customers",
            "people",
        ):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []

    def _normalize_named_resources(
        self, items: Sequence[Dict[str, Any]], resource_type: str
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for item in items:
            item_id = item.get("id") or item.get("identifier") or item.get("name")
            name = item.get("name") or item.get("title") or item.get("email") or item_id
            if not item_id:
                continue
            normalized.append(
                {
                    "id": str(item_id),
                    "name": str(name or item_id),
                    "type": resource_type,
                    "status": str(item.get("state") or item.get("status") or "")
                    or None,
                    "updated_at": item.get("updated_at") or item.get("created_at"),
                }
            )
        return normalized

    async def fetch_report_rows(
        self,
        *,
        app_api_key: str,
        base_url: str,
        workspace_id: str,
        account_name: str,
        region: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
    ) -> Dict[str, Any]:
        if report_type == "people":
            return await self._fetch_people(
                app_api_key, base_url, row_limit, include_pii, resource_id
            )
        if report_type == "events":
            return await self._fetch_events(
                app_api_key, base_url, date_window, row_limit, include_pii, resource_id
            )
        if report_type == "message_metrics":
            return await self._fetch_message_metrics(
                app_api_key, base_url, date_window, row_limit, resource_id
            )
        resources = await self.fetch_resources(
            app_api_key=app_api_key, base_url=base_url
        )
        if report_type == "lifecycle_overview":
            return self._overview_rows(
                workspace_id, account_name, region, date_window, resources
            )
        if report_type == "campaigns":
            rows = [
                self._campaign_row(item)
                for item in self._filter_by_resource(
                    resources.get("campaigns", []), resource_id
                )
            ][:row_limit]
            return {
                "rows": rows,
                "api_mode": "resources",
                "endpoints_used": ["GET /campaigns"],
                "generated_query": "campaign resource list",
                "truncated": len(rows) >= row_limit,
            }
        if report_type == "campaign_actions":
            rows = await self._campaign_action_rows(
                app_api_key,
                base_url,
                resources.get("campaigns", []),
                resource_id,
                row_limit,
            )
            return {
                "rows": rows,
                "api_mode": "resources",
                "endpoints_used": ["GET /campaigns", "GET /campaigns/{id}/actions"],
                "generated_query": "campaign action resource list",
                "truncated": len(rows) >= row_limit,
            }
        if report_type == "newsletters":
            rows = [
                self._newsletter_row(item)
                for item in self._filter_by_resource(
                    resources.get("newsletters", []), resource_id
                )
            ][:row_limit]
            return {
                "rows": rows,
                "api_mode": "resources",
                "endpoints_used": ["GET /newsletters"],
                "generated_query": "newsletter resource list",
                "truncated": len(rows) >= row_limit,
            }
        if report_type == "segments":
            rows = [
                self._segment_row(item)
                for item in self._filter_by_resource(
                    resources.get("segments", []), resource_id
                )
            ][:row_limit]
            return {
                "rows": rows,
                "api_mode": "resources",
                "endpoints_used": ["GET /segments"],
                "generated_query": "segment resource list",
                "truncated": len(rows) >= row_limit,
            }
        raise HTTPException(status_code=400, detail="Invalid Customer.io report_type.")

    async def _fetch_people(
        self,
        app_api_key: str,
        base_url: str,
        row_limit: int,
        include_pii: bool,
        resource_id: str,
    ) -> Dict[str, Any]:
        path = (
            f"/customers/{resource_id}"
            if resource_id and resource_id != "all"
            else "/customers"
        )
        payload = await self.api_get(
            app_api_key=app_api_key,
            base_url=base_url,
            path=path,
            params={"limit": min(row_limit, 100)} if resource_id == "all" else None,
        )
        items = [payload] if resource_id != "all" else self._extract_items(payload)
        rows = [self._person_row(item, include_pii) for item in items[:row_limit]]
        return {
            "rows": rows,
            "api_mode": "resources",
            "endpoints_used": [f"GET {path}"],
            "generated_query": "bounded people resource list",
            "truncated": len(rows) >= row_limit,
        }

    async def _fetch_events(
        self,
        app_api_key: str,
        base_url: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
    ) -> Dict[str, Any]:
        params = {
            "start": date_window["from"],
            "end": date_window["to"],
            "limit": min(row_limit, 100),
        }
        if resource_id and resource_id != "all":
            params["name"] = resource_id
        payload = await self.api_get(
            app_api_key=app_api_key,
            base_url=base_url,
            path="/events",
            params=params,
        )
        rows = [
            self._event_row(item, include_pii)
            for item in self._extract_items(payload)[:row_limit]
        ]
        return {
            "rows": rows,
            "api_mode": "resources",
            "endpoints_used": ["GET /events"],
            "generated_query": "bounded event resource list",
            "truncated": len(rows) >= row_limit,
        }

    async def _fetch_message_metrics(
        self,
        app_api_key: str,
        base_url: str,
        date_window: Dict[str, str],
        row_limit: int,
        resource_id: str,
    ) -> Dict[str, Any]:
        params = {
            "start": date_window["from"],
            "end": date_window["to"],
            "limit": min(row_limit, 100),
        }
        if resource_id and resource_id != "all":
            params["resource_id"] = resource_id
        payload = await self.api_get(
            app_api_key=app_api_key,
            base_url=base_url,
            path="/reports/messages",
            params=params,
        )
        rows = [
            self._metric_row(item) for item in self._extract_items(payload)[:row_limit]
        ]
        return {
            "rows": rows,
            "api_mode": "resources",
            "endpoints_used": ["GET /reports/messages"],
            "generated_query": "bounded message metrics report",
            "truncated": len(rows) >= row_limit,
        }

    async def _campaign_action_rows(
        self,
        app_api_key: str,
        base_url: str,
        campaigns: Sequence[Dict[str, Any]],
        resource_id: str,
        row_limit: int,
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        campaign_items = self._filter_by_resource(campaigns, resource_id)
        for campaign in campaign_items:
            if len(rows) >= row_limit:
                break
            campaign_id = str(campaign.get("id") or "")
            actions = (
                campaign.get("actions")
                if isinstance(campaign.get("actions"), list)
                else []
            )
            if not actions and campaign_id:
                actions = await self._safe_paginated_list(
                    app_api_key=app_api_key,
                    base_url=base_url,
                    path=f"/campaigns/{campaign_id}/actions",
                    limit=row_limit - len(rows),
                )
            for action in actions:
                if len(rows) >= row_limit:
                    break
                if isinstance(action, dict):
                    rows.append(self._campaign_action_row(campaign_id, action))
        return rows

    def _filter_by_resource(
        self, items: Sequence[Dict[str, Any]], resource_id: str
    ) -> List[Dict[str, Any]]:
        if resource_id and resource_id != "all":
            return [item for item in items if str(item.get("id")) == str(resource_id)]
        return list(items)

    def _overview_rows(
        self,
        workspace_id: str,
        account_name: str,
        region: str,
        date_window: Dict[str, str],
        resources: Dict[str, List[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        campaigns = resources.get("campaigns", [])
        row = {
            "date_start": date_window["from"],
            "date_end": date_window["to"],
            "workspace_id": workspace_id,
            "account_name": account_name,
            "region": region,
            "campaign_count": len(campaigns),
            "newsletter_count": len(resources.get("newsletters", [])),
            "segment_count": len(resources.get("segments", [])),
            "people_sample_count": len(resources.get("people", [])),
            "top_campaigns": ", ".join(item.get("name", "") for item in campaigns[:10]),
        }
        return {
            "rows": [row],
            "api_mode": "resources_overview",
            "endpoints_used": [
                "GET /campaigns",
                "GET /newsletters",
                "GET /segments",
                "GET /customers",
            ],
            "generated_query": "resource overview",
            "truncated": False,
        }

    def _campaign_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        metrics = item.get("metrics") if isinstance(item.get("metrics"), dict) else {}
        return {
            "campaign_id": item.get("id"),
            "name": item.get("name") or item.get("title") or item.get("id"),
            "state": item.get("state") or item.get("status") or "",
            "type": item.get("type") or "",
            "created_at": item.get("created_at") or "",
            "updated_at": item.get("updated_at") or "",
            "sent_count": metrics.get("sent") or item.get("sent") or "",
            "opened_count": metrics.get("opened") or item.get("opened") or "",
            "clicked_count": metrics.get("clicked") or item.get("clicked") or "",
            "converted_count": metrics.get("converted") or item.get("converted") or "",
        }

    def _campaign_action_row(
        self, campaign_id: str, item: Dict[str, Any]
    ) -> Dict[str, Any]:
        return {
            "campaign_id": campaign_id,
            "action_id": item.get("id"),
            "name": item.get("name") or item.get("type") or item.get("id"),
            "type": item.get("type") or "",
            "state": item.get("state") or item.get("status") or "",
            "created_at": item.get("created_at") or "",
            "updated_at": item.get("updated_at") or "",
        }

    def _newsletter_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        row = self._campaign_row(item)
        return {
            "newsletter_id": row.get("campaign_id"),
            "name": row.get("name"),
            "subject": item.get("subject") or "",
            "state": row.get("state"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "sent_count": row.get("sent_count"),
            "opened_count": row.get("opened_count"),
            "clicked_count": row.get("clicked_count"),
            "converted_count": row.get("converted_count"),
        }

    def _segment_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "segment_id": item.get("id"),
            "name": item.get("name") or item.get("id"),
            "description": item.get("description") or "",
            "type": item.get("type") or "",
            "created_at": item.get("created_at") or "",
            "updated_at": item.get("updated_at") or "",
            "member_count": item.get("member_count") or item.get("count") or "",
        }

    def _person_row(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        attrs = (
            item.get("attributes") if isinstance(item.get("attributes"), dict) else item
        )
        safe_attrs = attrs if include_pii else _strip_pii_properties(dict(attrs))
        email = item.get("email") or attrs.get("email")
        name = item.get("name") or attrs.get("name")
        person_id = item.get("id") or item.get("identifier") or attrs.get("id")
        return {
            "person_id": person_id if include_pii else _redact_pii(person_id),
            "email": email if include_pii else _redact_pii(email),
            "name": name if include_pii else _redact_pii(name),
            "created_at": item.get("created_at") or attrs.get("created_at") or "",
            "updated_at": item.get("updated_at") or attrs.get("updated_at") or "",
            "last_emailed_at": item.get("last_emailed_at")
            or attrs.get("last_emailed_at")
            or "",
            "attributes_json": _json_text(safe_attrs),
        }

    def _event_row(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        props = (
            item.get("properties") if isinstance(item.get("properties"), dict) else {}
        )
        safe_props = props if include_pii else _strip_pii_properties(props)
        email = item.get("email") or props.get("email")
        person_id = item.get("person_id") or item.get("customer_id") or props.get("id")
        return {
            "event_id": item.get("id") or item.get("event_id") or "",
            "event_name": item.get("name")
            or item.get("event")
            or item.get("type")
            or "",
            "person_id": person_id if include_pii else _redact_pii(person_id),
            "email": email if include_pii else _redact_pii(email),
            "timestamp": item.get("timestamp") or item.get("created_at") or "",
            "properties_json": _json_text(safe_props),
        }

    def _metric_row(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "message_id": item.get("message_id") or item.get("id") or "",
            "resource_id": item.get("resource_id")
            or item.get("campaign_id")
            or item.get("newsletter_id")
            or "",
            "resource_type": item.get("resource_type") or item.get("type") or "",
            "channel": item.get("channel") or "",
            "sent": item.get("sent") or "",
            "opened": item.get("opened") or "",
            "clicked": item.get("clicked") or "",
            "converted": item.get("converted") or "",
            "unsubscribed": item.get("unsubscribed") or "",
            "bounced": item.get("bounced") or "",
        }


class CustomerIOLifecycleService:
    def __init__(self, adapter: Optional[CustomerIOAdapter] = None):
        self.adapter = adapter or CustomerIOAdapter()

    def _customer_io_config(self) -> Dict[str, str]:
        cfg = getattr(config, "customer_io", None)
        return {
            "app_api_key": str(
                getattr(cfg, "app_api_key", None)
                or os.environ.get("CUSTOMER_IO_APP_API_KEY", "")
            ),
            "region": str(
                getattr(cfg, "region", None)
                or os.environ.get("CUSTOMER_IO_REGION", "US")
            ),
            "api_base_url": str(
                getattr(cfg, "api_base_url", None)
                or os.environ.get("CUSTOMER_IO_API_BASE_URL", "")
            ),
        }

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, CUSTOMER_IO_PROVIDER) or {}
        )
        preserved = {
            key: value
            for key, value in existing.items()
            if key
            not in {
                "encrypted_app_api_key",
                "app_api_key",
                "user_id",
                "provider",
                "updated_at",
            }
        }
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=CUSTOMER_IO_PROVIDER,
            metadata={**preserved, **metadata},
        )

    async def connect(
        self,
        *,
        user_id: str,
        app_api_key: Optional[str],
        region: Optional[str],
        api_base_url: Optional[str] = None,
        account_name: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        cfg = self._customer_io_config()
        api_key = str(app_api_key or cfg["app_api_key"]).strip()
        normalized_region = _normalize_region(region or cfg["region"])
        resolved_base_url = _normalize_base_url(
            normalized_region, api_base_url or cfg["api_base_url"]
        )
        if not api_key:
            raise HTTPException(status_code=400, detail="app_api_key is required.")
        await self.adapter.test_connection(
            app_api_key=api_key, base_url=resolved_base_url
        )
        resolved_workspace_id = str(workspace_id or "all").strip() or "all"
        self._save_metadata(
            user_id,
            {
                "encrypted_app_api_key": _encrypt_secret(api_key),
                "workspace_id": resolved_workspace_id,
                "region": normalized_region,
                "api_base_url": resolved_base_url,
                "account_name": account_name or "Customer.io Workspace",
                "connected_at": _now_iso(),
            },
        )
        return await self.get_connection_status(user_id)

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, CUSTOMER_IO_PROVIDER) or {}
        )
        return {
            "connected": bool(record.get("encrypted_app_api_key")),
            "workspace_id": record.get("workspace_id") or "all",
            "region": record.get("region") or "US",
            "api_base_url": record.get("api_base_url") or REGION_BASE_URLS["US"],
            "account_name": record.get("account_name") or "Customer.io",
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, CUSTOMER_IO_PROVIDER)

    async def _credentials(self, user_id: str) -> Tuple[str, Dict[str, Any]]:
        record = (
            connected_accounts_repo.get_connection(user_id, CUSTOMER_IO_PROVIDER) or {}
        )
        encrypted_key = record.get("encrypted_app_api_key")
        if not encrypted_key:
            raise HTTPException(status_code=401, detail="Customer.io is not connected.")
        try:
            return _decrypt_secret(str(encrypted_key)), record
        except Exception as exc:
            logger.warning("Failed to decrypt Customer.io credentials: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="Customer.io credentials could not be decrypted. Please reconnect.",
            ) from exc

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        app_api_key, record = await self._credentials(user_id)
        resources = await self.adapter.fetch_resources(
            app_api_key=app_api_key,
            base_url=str(record.get("api_base_url") or REGION_BASE_URLS["US"]),
        )
        reports = [
            {
                "report_type": report_type,
                "label": REPORT_LABELS[report_type],
                "resource": REPORT_RESOURCES[report_type],
                "default": report_type == "lifecycle_overview",
            }
            for report_type in [
                "lifecycle_overview",
                "campaigns",
                "campaign_actions",
                "newsletters",
                "segments",
                "people",
                "events",
                "message_metrics",
            ]
        ]
        return {
            "reports": reports,
            "workspaces": [self._workspace_record(record)],
            **resources,
        }

    def _workspace_record(self, record: Dict[str, Any]) -> Dict[str, str]:
        workspace_id = str(record.get("workspace_id") or "all")
        return {
            "id": workspace_id,
            "name": str(record.get("account_name") or "Customer.io Workspace"),
            "region": str(record.get("region") or "US"),
            "api_base_url": str(record.get("api_base_url") or REGION_BASE_URLS["US"]),
        }

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "customer_io":
            raise HTTPException(status_code=400, detail="Invalid Customer.io entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(
                status_code=400, detail="Invalid Customer.io report type"
            )
        return {
            "report_type": report_type,
            "workspace_id": parts[2] or "all",
            "resource_id": parts[3] or "all",
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, resource_id: str
    ) -> Dict[str, Any]:
        workspace_id = str(record.get("workspace_id") or "all")
        account_name = str(record.get("account_name") or "Customer.io Workspace")
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"customer_io:{report_type}:{workspace_id}:{resource_id or 'all'}"
        return {
            "id": entity_id,
            "name": f"{account_name} / {label}",
            "type": "report",
            "account_name": account_name,
            "account_id": workspace_id,
            "workspace_id": workspace_id,
            "region": str(record.get("region") or "US"),
            "base_url": str(record.get("api_base_url") or REGION_BASE_URLS["US"]),
            "report_type": report_type,
            "resource_id": resource_id or "all",
            "connector_key": "customer_io",
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
            report_type=str(cfg.get("report_type") or "lifecycle_overview"),
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
        report_type: str = "lifecycle_overview",
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        row_limit: Any = DEFAULT_ROW_LIMIT,
        include_pii: bool = False,
        max_bytes: Any = None,
        resource_id: str = "all",
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(
                status_code=400, detail="Invalid Customer.io report_type."
            )
        app_api_key, record = await self._credentials(user_id)
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        export = await self.adapter.fetch_report_rows(
            app_api_key=app_api_key,
            base_url=str(record.get("api_base_url") or REGION_BASE_URLS["US"]),
            workspace_id=str(record.get("workspace_id") or "all"),
            account_name=str(record.get("account_name") or "Customer.io Workspace"),
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
                detail="Customer.io extract exceeded the configured byte cap.",
            )
        return self._save_customer_io_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            resource_id=resource_id or "all",
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            include_pii=include_pii,
            api_mode=str(export.get("api_mode") or "resources"),
            generated_query=str(export.get("generated_query") or ""),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("endpoints_used") or []),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_customer_io_asset(
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
            "connector_key": "customer_io",
            "source_type": "customer_io",
            "workspace_id": record.get("workspace_id") or "all",
            "region": record.get("region") or "US",
            "api_base_url": record.get("api_base_url") or REGION_BASE_URLS["US"],
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
        filename = f"customer_io_{_sanitize_filename_part(report_type)}_{manifest['date_window']['from']}_{manifest['date_window']['to']}.csv"
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=CUSTOMER_IO_ASSET_TYPE,
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
            user_id=user_id, provider=CUSTOMER_IO_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "customer_io",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "customer_io_workspace_id": manifest.get("workspace_id"),
                "customer_io_report_type": report_type,
                "customer_io_manifest_s3_key": manifest_key,
                "customer_io_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {row_count} rows from Customer.io ({entity['name']}).",
            "asset": updated or asset,
            "row_count": row_count,
            "column_count": column_count,
            "entity_id": entity["id"],
            "truncated": bool(manifest.get("truncated")),
            "api_mode": manifest.get("api_mode"),
        }


customer_io_service = CustomerIOLifecycleService()
