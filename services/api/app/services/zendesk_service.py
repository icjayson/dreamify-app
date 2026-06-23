import asyncio
import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlencode

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


ZENDESK_PROVIDER = "zendesk"
ZENDESK_ASSET_TYPE = "integration_zendesk"
DEFAULT_API_BASE_URL_TEMPLATE = "https://{subdomain}.zendesk.com"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

VALID_REPORT_TYPES = {
    "support_overview",
    "tickets",
    "ticket_events",
    "users",
    "organizations",
    "groups",
    "satisfaction_ratings",
}

REPORT_LABELS = {
    "support_overview": "Support Overview",
    "tickets": "Tickets",
    "ticket_events": "Ticket Events",
    "users": "Users",
    "organizations": "Organizations",
    "groups": "Groups",
    "satisfaction_ratings": "Satisfaction Ratings",
}

REPORT_RESOURCES = {
    "support_overview": "all",
    "tickets": "tickets",
    "ticket_events": "ticket_events",
    "users": "users",
    "organizations": "organizations",
    "groups": "groups",
    "satisfaction_ratings": "satisfaction_ratings",
}

REPORT_HEADERS = {
    "support_overview": [
        "date_start",
        "date_end",
        "subdomain",
        "account_name",
        "ticket_count",
        "open_ticket_count",
        "pending_ticket_count",
        "solved_ticket_count",
        "closed_ticket_count",
        "urgent_ticket_count",
        "high_ticket_count",
        "csat_good_count",
        "csat_bad_count",
        "organization_count",
        "user_count",
    ],
    "tickets": [
        "ticket_id",
        "subject",
        "status",
        "priority",
        "type",
        "requester_id",
        "submitter_id",
        "assignee_id",
        "organization_id",
        "group_id",
        "created_at",
        "updated_at",
        "solved_at",
        "tags",
        "via_channel",
        "brand_id",
        "url",
    ],
    "ticket_events": [
        "event_id",
        "ticket_id",
        "event_type",
        "author_id",
        "created_at",
        "changes",
    ],
    "users": [
        "user_id",
        "name",
        "email",
        "role",
        "active",
        "organization_id",
        "created_at",
        "updated_at",
        "locale",
        "time_zone",
    ],
    "organizations": [
        "organization_id",
        "name",
        "domain_names",
        "details",
        "notes",
        "created_at",
        "updated_at",
    ],
    "groups": ["group_id", "name", "default", "deleted", "created_at", "updated_at"],
    "satisfaction_ratings": [
        "rating_id",
        "ticket_id",
        "assignee_id",
        "requester_id",
        "score",
        "reason",
        "comment",
        "created_at",
        "updated_at",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


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


def normalize_subdomain(value: str) -> str:
    raw = str(value or "").strip().lower()
    raw = re.sub(r"^https?://", "", raw).split("/")[0]
    if raw.endswith(".zendesk.com"):
        raw = raw[: -len(".zendesk.com")]
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", raw or ""):
        raise HTTPException(status_code=400, detail="Invalid Zendesk subdomain.")
    return raw


def _api_base_url(template: str, subdomain: str) -> str:
    source = template or DEFAULT_API_BASE_URL_TEMPLATE
    if "{subdomain}" in source:
        return source.format(subdomain=subdomain).rstrip("/")
    return source.rstrip("/")


def _date_to_epoch(date_value: str) -> int:
    parsed = _parse_date(date_value)
    if not parsed:
        return 0
    return int(datetime.combine(parsed, datetime.min.time(), timezone.utc).timestamp())


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


def _redact_email(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw or "@" not in raw:
        return ""
    name, domain = raw.split("@", 1)
    return f"{name[:1]}***@{domain}"


def _redact_name(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return f"{raw[:1]}***" if len(raw) > 1 else "***"


def _redact_text(value: Any) -> str:
    return "" if value is None else "[redacted]"


def _json_list(value: Any) -> str:
    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True)
    return str(value or "")


class ZendeskSupportAdapter:
    async def exchange_token(
        self,
        *,
        api_base_url: str,
        client_id: str,
        client_secret: str,
        code: str,
        redirect_uri: str,
    ) -> Dict[str, Any]:
        return await self._token_request(
            api_base_url=api_base_url,
            payload={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "scope": "read",
            },
        )

    async def refresh_token(
        self,
        *,
        api_base_url: str,
        client_id: str,
        client_secret: str,
        refresh_token: str,
    ) -> Dict[str, Any]:
        return await self._token_request(
            api_base_url=api_base_url,
            payload={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )

    async def _token_request(
        self, *, api_base_url: str, payload: Dict[str, str]
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{api_base_url}/oauth/tokens",
                json=payload,
                headers={"Accept": "application/json"},
            )
        response.raise_for_status()
        return response.json()

    async def api_get(
        self,
        *,
        api_base_url: str,
        access_token: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        url = path if path.startswith("http") else f"{api_base_url}{path}"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }
        last_error: Optional[Exception] = None
        async with httpx.AsyncClient(timeout=60.0) as client:
            for attempt in range(max_attempts):
                response = await client.get(url, params=params, headers=headers)
                if response.status_code == 429 and attempt < max_attempts - 1:
                    delay = min(float(response.headers.get("Retry-After", "1")), 5.0)
                    await self._sleep(delay)
                    continue
                try:
                    response.raise_for_status()
                    return response.json() if response.content else {}
                except httpx.HTTPStatusError as exc:
                    last_error = exc
                    if response.status_code == 429 and attempt < max_attempts - 1:
                        await self._sleep(1.0 + attempt)
                        continue
                    raise
        if last_error:
            raise last_error
        return {}

    async def _sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    async def fetch_account(
        self, *, api_base_url: str, access_token: str, subdomain: str
    ) -> Dict[str, Any]:
        try:
            payload = await self.api_get(
                api_base_url=api_base_url,
                access_token=access_token,
                path="/api/v2/account/settings.json",
            )
            settings = payload.get("settings") if isinstance(payload, dict) else {}
            account = settings.get("account") if isinstance(settings, dict) else {}
            return {
                "account_name": account.get("name") or subdomain,
                "timezone": account.get("time_zone")
                or account.get("timezone")
                or "UTC",
            }
        except Exception as exc:
            logger.info("Zendesk account lookup failed: %s", exc)
            return {"account_name": subdomain, "timezone": "UTC"}

    async def fetch_report_rows(
        self,
        *,
        api_base_url: str,
        access_token: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
        account_name: str,
        subdomain: str,
    ) -> Dict[str, Any]:
        if report_type == "support_overview":
            return await self._fetch_support_overview(
                api_base_url=api_base_url,
                access_token=access_token,
                date_window=date_window,
                row_limit=row_limit,
                account_name=account_name,
                subdomain=subdomain,
            )
        if report_type in {"tickets", "ticket_events", "users", "organizations"}:
            export = await self._fetch_incremental(
                api_base_url=api_base_url,
                access_token=access_token,
                report_type=report_type,
                date_window=date_window,
                row_limit=row_limit,
            )
            rows = [
                self._flatten_incremental_item(report_type, item, include_pii)
                for item in export["items"]
                if self._resource_matches(report_type, item, resource_id)
            ]
            return {
                **export,
                "rows": rows[:row_limit],
                "api_mode": "incremental_export",
            }
        if report_type == "groups":
            items, endpoints = await self._fetch_paginated(
                api_base_url=api_base_url,
                access_token=access_token,
                path="/api/v2/groups.json",
                key="groups",
                row_limit=row_limit,
            )
            rows = [self._flatten_group(item) for item in items]
            return {
                "rows": rows,
                "api_mode": "rest",
                "endpoints_used": endpoints,
                "cursor": "",
                "end_time": "",
                "truncated": len(rows) >= row_limit,
            }
        items, endpoints = await self._fetch_paginated(
            api_base_url=api_base_url,
            access_token=access_token,
            path="/api/v2/satisfaction_ratings.json",
            key="satisfaction_ratings",
            row_limit=row_limit,
        )
        rows = [self._flatten_satisfaction(item, include_pii) for item in items]
        return {
            "rows": rows,
            "api_mode": "rest",
            "endpoints_used": endpoints,
            "cursor": "",
            "end_time": "",
            "truncated": len(rows) >= row_limit,
        }

    async def _fetch_incremental(
        self,
        *,
        api_base_url: str,
        access_token: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        key_by_report = {
            "tickets": "tickets",
            "ticket_events": "ticket_events",
            "users": "users",
            "organizations": "organizations",
        }
        path_by_report = {
            "tickets": "/api/v2/incremental/tickets/cursor.json",
            "ticket_events": "/api/v2/incremental/ticket_events.json",
            "users": "/api/v2/incremental/users/cursor.json",
            "organizations": "/api/v2/incremental/organizations/cursor.json",
        }
        key = key_by_report[report_type]
        path = path_by_report[report_type]
        start_time = _date_to_epoch(date_window["from"])
        items: List[Dict[str, Any]] = []
        endpoints = [f"GET {path}"]
        params: Dict[str, Any] = {"start_time": start_time}
        cursor = ""
        end_time = ""
        for _ in range(100):
            payload = await self.api_get(
                api_base_url=api_base_url,
                access_token=access_token,
                path=path,
                params=params,
            )
            batch = payload.get(key)
            if isinstance(batch, list):
                items.extend(item for item in batch if isinstance(item, dict))
            cursor = str(payload.get("after_cursor") or payload.get("cursor") or cursor)
            end_time = str(payload.get("end_time") or end_time)
            if len(items) >= row_limit or payload.get("end_of_stream") is True:
                break
            if cursor:
                params = {"cursor": cursor}
            elif end_time:
                params = {"start_time": end_time}
            else:
                break
        return {
            "items": items[:row_limit],
            "endpoints_used": endpoints,
            "cursor": cursor,
            "end_time": end_time,
            "truncated": len(items) >= row_limit,
        }

    async def _fetch_paginated(
        self,
        *,
        api_base_url: str,
        access_token: str,
        path: str,
        key: str,
        row_limit: int,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        items: List[Dict[str, Any]] = []
        endpoints = [f"GET {path}"]
        next_path = path
        params: Dict[str, Any] = {"page[size]": min(row_limit, 100)}
        while next_path and len(items) < row_limit:
            payload = await self.api_get(
                api_base_url=api_base_url,
                access_token=access_token,
                path=next_path,
                params=params,
            )
            batch = payload.get(key)
            if isinstance(batch, list):
                items.extend(item for item in batch if isinstance(item, dict))
            next_url = payload.get("next_page") or payload.get("next")
            next_path = str(next_url or "")
            params = {}
            if not next_path:
                break
        return items[:row_limit], endpoints

    async def _fetch_support_overview(
        self,
        *,
        api_base_url: str,
        access_token: str,
        date_window: Dict[str, str],
        row_limit: int,
        account_name: str,
        subdomain: str,
    ) -> Dict[str, Any]:
        tickets = await self._fetch_incremental(
            api_base_url=api_base_url,
            access_token=access_token,
            report_type="tickets",
            date_window=date_window,
            row_limit=row_limit,
        )
        users = await self._fetch_incremental(
            api_base_url=api_base_url,
            access_token=access_token,
            report_type="users",
            date_window=date_window,
            row_limit=min(row_limit, 1000),
        )
        orgs = await self._fetch_incremental(
            api_base_url=api_base_url,
            access_token=access_token,
            report_type="organizations",
            date_window=date_window,
            row_limit=min(row_limit, 1000),
        )
        ratings, rating_endpoints = await self._fetch_paginated(
            api_base_url=api_base_url,
            access_token=access_token,
            path="/api/v2/satisfaction_ratings.json",
            key="satisfaction_ratings",
            row_limit=min(row_limit, 1000),
        )
        ticket_rows = tickets["items"]
        row = {
            "date_start": date_window["from"],
            "date_end": date_window["to"],
            "subdomain": subdomain,
            "account_name": account_name,
            "ticket_count": len(ticket_rows),
            "open_ticket_count": self._count_by(ticket_rows, "status", "open"),
            "pending_ticket_count": self._count_by(ticket_rows, "status", "pending"),
            "solved_ticket_count": self._count_by(ticket_rows, "status", "solved"),
            "closed_ticket_count": self._count_by(ticket_rows, "status", "closed"),
            "urgent_ticket_count": self._count_by(ticket_rows, "priority", "urgent"),
            "high_ticket_count": self._count_by(ticket_rows, "priority", "high"),
            "csat_good_count": self._count_by(ratings, "score", "good"),
            "csat_bad_count": self._count_by(ratings, "score", "bad"),
            "organization_count": len(orgs["items"]),
            "user_count": len(users["items"]),
        }
        endpoints = list(tickets.get("endpoints_used") or [])
        endpoints.extend(users.get("endpoints_used") or [])
        endpoints.extend(orgs.get("endpoints_used") or [])
        endpoints.extend(rating_endpoints)
        return {
            "rows": [row],
            "api_mode": "overview",
            "endpoints_used": endpoints,
            "cursor": tickets.get("cursor") or "",
            "end_time": tickets.get("end_time") or "",
            "truncated": bool(tickets.get("truncated")),
        }

    def _count_by(self, rows: Sequence[Dict[str, Any]], key: str, value: str) -> int:
        return sum(1 for row in rows if str(row.get(key) or "").lower() == value)

    def _resource_matches(
        self, report_type: str, item: Dict[str, Any], resource_id: str
    ) -> bool:
        if resource_id in {"", "all"}:
            return True
        if report_type == "tickets":
            return (
                str(item.get("group_id") or item.get("organization_id") or "")
                == resource_id
            )
        if report_type == "users":
            return str(item.get("organization_id") or "") == resource_id
        if report_type == "organizations":
            return str(item.get("id") or "") == resource_id
        return True

    def _flatten_incremental_item(
        self, report_type: str, item: Dict[str, Any], include_pii: bool
    ) -> Dict[str, Any]:
        if report_type == "tickets":
            return self._flatten_ticket(item, include_pii)
        if report_type == "ticket_events":
            return {
                "event_id": item.get("id"),
                "ticket_id": item.get("ticket_id"),
                "event_type": item.get("type") or item.get("event_type"),
                "author_id": item.get("author_id") or item.get("updater_id"),
                "created_at": item.get("created_at"),
                "changes": _json_list(item.get("child_events") or item.get("events")),
            }
        if report_type == "users":
            return self._flatten_user(item, include_pii)
        return self._flatten_organization(item, include_pii)

    def _flatten_ticket(
        self, item: Dict[str, Any], include_pii: bool
    ) -> Dict[str, Any]:
        via = item.get("via") if isinstance(item.get("via"), dict) else {}
        return {
            "ticket_id": item.get("id"),
            "subject": (
                item.get("subject")
                if include_pii
                else _redact_text(item.get("subject"))
            ),
            "status": item.get("status"),
            "priority": item.get("priority"),
            "type": item.get("type"),
            "requester_id": item.get("requester_id"),
            "submitter_id": item.get("submitter_id"),
            "assignee_id": item.get("assignee_id"),
            "organization_id": item.get("organization_id"),
            "group_id": item.get("group_id"),
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
            "solved_at": item.get("solved_at"),
            "tags": _json_list(item.get("tags")),
            "via_channel": via.get("channel"),
            "brand_id": item.get("brand_id"),
            "url": item.get("url"),
        }

    def _flatten_user(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        return {
            "user_id": item.get("id"),
            "name": item.get("name") if include_pii else _redact_name(item.get("name")),
            "email": (
                item.get("email") if include_pii else _redact_email(item.get("email"))
            ),
            "role": item.get("role"),
            "active": item.get("active"),
            "organization_id": item.get("organization_id"),
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
            "locale": item.get("locale"),
            "time_zone": item.get("time_zone"),
        }

    def _flatten_organization(
        self, item: Dict[str, Any], include_pii: bool
    ) -> Dict[str, Any]:
        return {
            "organization_id": item.get("id"),
            "name": item.get("name"),
            "domain_names": _json_list(item.get("domain_names")),
            "details": item.get("details") if include_pii else "",
            "notes": item.get("notes") if include_pii else "",
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
        }

    def _flatten_group(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "group_id": item.get("id"),
            "name": item.get("name"),
            "default": item.get("default"),
            "deleted": item.get("deleted"),
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
        }

    def _flatten_satisfaction(
        self, item: Dict[str, Any], include_pii: bool
    ) -> Dict[str, Any]:
        reason = item.get("reason") if isinstance(item.get("reason"), dict) else {}
        return {
            "rating_id": item.get("id"),
            "ticket_id": item.get("ticket_id"),
            "assignee_id": item.get("assignee_id"),
            "requester_id": item.get("requester_id"),
            "score": item.get("score"),
            "reason": reason.get("text") or reason.get("id") or "",
            "comment": item.get("comment") if include_pii else "",
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
        }


class ZendeskSupportConnectorService:
    def __init__(self, adapter: Optional[ZendeskSupportAdapter] = None):
        self.adapter = adapter or ZendeskSupportAdapter()

    def _zendesk_config(self) -> Dict[str, str]:
        cfg = getattr(config, "zendesk", None)
        return {
            "client_id": str(
                getattr(cfg, "client_id", None)
                or os.environ.get("ZENDESK_CLIENT_ID", "")
            ),
            "client_secret": str(
                getattr(cfg, "client_secret", None)
                or os.environ.get("ZENDESK_CLIENT_SECRET", "")
            ),
            "redirect_uri": str(
                getattr(cfg, "redirect_uri", None)
                or os.environ.get("ZENDESK_REDIRECT_URI", "")
            ),
            "api_base_url_template": str(
                getattr(cfg, "api_base_url_template", None)
                or os.environ.get(
                    "ZENDESK_API_BASE_URL_TEMPLATE",
                    DEFAULT_API_BASE_URL_TEMPLATE,
                )
            ),
        }

    def _state_secret(self) -> str:
        cfg = self._zendesk_config()
        return cfg["client_secret"] or os.environ.get("APP_SECRET") or "zendesk-dev"

    def _make_state_payload(self, user_id: str, subdomain: str) -> str:
        payload = {
            "u": user_id,
            "s": subdomain,
            "nonce": secrets.token_urlsafe(12),
            "iat": int(datetime.now(timezone.utc).timestamp()),
        }
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        encoded = _b64url(raw)
        sig = hmac.new(
            self._state_secret().encode("utf-8"),
            encoded.encode("ascii"),
            hashlib.sha256,
        ).digest()
        return f"{encoded}.{_b64url(sig)}"

    def _verify_state(self, state: str) -> Dict[str, Any]:
        try:
            encoded, signature = state.split(".", 1)
            expected = _b64url(
                hmac.new(
                    self._state_secret().encode("utf-8"),
                    encoded.encode("ascii"),
                    hashlib.sha256,
                ).digest()
            )
            if not hmac.compare_digest(signature, expected):
                raise ValueError("Invalid Zendesk OAuth state signature.")
            payload = json.loads(
                base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
            )
            issued_at = int(payload.get("iat") or 0)
            if int(datetime.now(timezone.utc).timestamp()) - issued_at > 900:
                raise ValueError("Zendesk OAuth state expired.")
            return payload
        except Exception as exc:
            raise ValueError("Invalid Zendesk OAuth state.") from exc

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, ZENDESK_PROVIDER) or {}
        )
        preserved = {
            key: value
            for key, value in existing.items()
            if key
            not in {
                "access_token",
                "refresh_token",
                "encrypted_access_token",
                "encrypted_refresh_token",
                "expires_at",
                "pending_oauth_states",
                "user_id",
                "provider",
                "updated_at",
            }
        }
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=ZENDESK_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str, subdomain: str) -> str:
        cfg = self._zendesk_config()
        if not cfg["client_id"] or not cfg["redirect_uri"]:
            raise ValueError("Zendesk client_id or redirect_uri is not configured.")
        normalized = normalize_subdomain(subdomain)
        api_base_url = _api_base_url(cfg["api_base_url_template"], normalized)
        state = self._make_state_payload(user_id, normalized)
        record = connected_accounts_repo.get_connection(user_id, ZENDESK_PROVIDER) or {}
        pending = dict(record.get("pending_oauth_states") or {})
        now = int(datetime.now(timezone.utc).timestamp())
        pending[state] = {"created_at": now, "subdomain": normalized}
        self._save_metadata(
            user_id,
            {
                "pending_oauth_states": {
                    key: value
                    for key, value in pending.items()
                    if now - int(value.get("created_at", 0)) <= 900
                }
            },
        )
        params = urlencode(
            {
                "response_type": "code",
                "client_id": cfg["client_id"],
                "redirect_uri": cfg["redirect_uri"],
                "scope": "read",
                "state": state,
            }
        )
        return f"{api_base_url}/oauth/authorizations/new?{params}"

    async def handle_oauth_callback(self, code: str, state: str) -> None:
        cfg = self._zendesk_config()
        if not cfg["client_id"] or not cfg["client_secret"]:
            raise ValueError("Zendesk OAuth client credentials are not configured.")
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        subdomain = normalize_subdomain(str(payload.get("s") or ""))
        record = connected_accounts_repo.get_connection(user_id, ZENDESK_PROVIDER) or {}
        pending = dict(record.get("pending_oauth_states") or {})
        if not pending.pop(state, None):
            raise ValueError("Missing Zendesk OAuth state.")
        api_base_url = _api_base_url(cfg["api_base_url_template"], subdomain)
        token_data = await self.adapter.exchange_token(
            api_base_url=api_base_url,
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            code=code,
            redirect_uri=cfg["redirect_uri"],
        )
        access_token = str(token_data.get("access_token") or "")
        refresh_token = str(token_data.get("refresh_token") or "")
        if not access_token:
            raise HTTPException(
                status_code=400,
                detail="Zendesk OAuth response did not include an access token.",
            )
        expires_in = token_data.get("expires_in")
        expires_at = ""
        if expires_in:
            expires_at = (
                datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
            ).isoformat()
        account = await self.adapter.fetch_account(
            api_base_url=api_base_url,
            access_token=access_token,
            subdomain=subdomain,
        )
        self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "encrypted_refresh_token": (
                    _encrypt_secret(refresh_token) if refresh_token else ""
                ),
                "expires_at": expires_at,
                "subdomain": subdomain,
                "api_base_url": api_base_url,
                "account_name": account.get("account_name") or subdomain,
                "timezone": account.get("timezone") or "UTC",
                "scopes": str(token_data.get("scope") or "read").split(),
                "pending_oauth_states": pending,
                "connected_at": _now_iso(),
            },
        )

    def _is_expired(self, expires_at: str) -> bool:
        if not expires_at:
            return False
        try:
            expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            return datetime.now(timezone.utc) >= expires - timedelta(minutes=2)
        except ValueError:
            return False

    async def _access_token(self, user_id: str) -> Tuple[str, Dict[str, Any]]:
        record = connected_accounts_repo.get_connection(user_id, ZENDESK_PROVIDER) or {}
        encrypted = record.get("encrypted_access_token")
        if not encrypted:
            raise HTTPException(status_code=401, detail="Zendesk is not connected.")
        if self._is_expired(str(record.get("expires_at") or "")):
            return await self._refresh_access_token(user_id, record)
        try:
            return _decrypt_secret(str(encrypted)), record
        except Exception as exc:
            logger.warning("Failed to decrypt Zendesk access token: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="Zendesk token could not be decrypted. Please reconnect.",
            ) from exc

    async def _refresh_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any]]:
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            return _decrypt_secret(str(record.get("encrypted_access_token"))), record
        cfg = self._zendesk_config()
        refresh_token = _decrypt_secret(str(encrypted_refresh))
        token_data = await self.adapter.refresh_token(
            api_base_url=str(record.get("api_base_url") or ""),
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            refresh_token=refresh_token,
        )
        access_token = str(token_data.get("access_token") or "")
        next_refresh = str(token_data.get("refresh_token") or refresh_token)
        if not access_token:
            raise HTTPException(status_code=401, detail="Zendesk token refresh failed.")
        expires_at = ""
        if token_data.get("expires_in"):
            expires_at = (
                datetime.now(timezone.utc)
                + timedelta(seconds=int(token_data.get("expires_in") or 3600))
            ).isoformat()
        updated = self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "encrypted_refresh_token": _encrypt_secret(next_refresh),
                "expires_at": expires_at,
                "scopes": str(token_data.get("scope") or "read").split(),
            },
        )
        return access_token, updated

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, ZENDESK_PROVIDER) or {}
        return {
            "connected": bool(record.get("encrypted_access_token")),
            "subdomain": record.get("subdomain"),
            "account_name": record.get("account_name") or record.get("subdomain"),
            "timezone": record.get("timezone") or "UTC",
            "scopes": record.get("scopes") or [],
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, ZENDESK_PROVIDER)

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        _, record = await self._access_token(user_id)
        reports = [
            {
                "report_type": report_type,
                "label": REPORT_LABELS[report_type],
                "resource": REPORT_RESOURCES[report_type],
                "default": report_type == "support_overview",
            }
            for report_type in [
                "support_overview",
                "tickets",
                "ticket_events",
                "users",
                "organizations",
                "groups",
                "satisfaction_ratings",
            ]
        ]
        return {
            "reports": reports,
            "accounts": [
                {
                    "id": str(record.get("subdomain") or "all"),
                    "name": str(record.get("account_name") or "Zendesk"),
                    "subdomain": str(record.get("subdomain") or ""),
                }
            ],
        }

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "zendesk":
            raise HTTPException(status_code=400, detail="Invalid Zendesk entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Zendesk report type")
        return {
            "report_type": report_type,
            "subdomain": parts[2] or "all",
            "resource_id": parts[3] or "all",
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, resource_id: str
    ) -> Dict[str, Any]:
        subdomain = str(record.get("subdomain") or "all")
        account_name = str(record.get("account_name") or subdomain or "Zendesk")
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"zendesk:{report_type}:{subdomain}:{resource_id or 'all'}"
        return {
            "id": entity_id,
            "name": f"{account_name} / {label}",
            "type": "report",
            "account_name": account_name,
            "subdomain": subdomain,
            "report_type": report_type,
            "resource_id": resource_id or "all",
            "connector_key": "zendesk",
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
            cfg.setdefault("subdomain", parsed["subdomain"])
            cfg.setdefault("resource_id", parsed["resource_id"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "support_overview"),
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
        report_type: str = "support_overview",
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        row_limit: Any = DEFAULT_ROW_LIMIT,
        include_pii: bool = False,
        max_bytes: Any = None,
        resource_id: str = "all",
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Zendesk report_type.")
        access_token, record = await self._access_token(user_id)
        subdomain = str(record.get("subdomain") or "")
        if not subdomain:
            raise HTTPException(status_code=400, detail="Zendesk subdomain is missing.")
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        export = await self.adapter.fetch_report_rows(
            api_base_url=str(record.get("api_base_url") or ""),
            access_token=access_token,
            report_type=report_type,
            date_window=date_window,
            row_limit=row_cap,
            include_pii=include_pii,
            resource_id=resource_id,
            account_name=str(record.get("account_name") or subdomain),
            subdomain=subdomain,
        )
        rows = list(export.get("rows") or [])[:row_cap]
        headers = REPORT_HEADERS[report_type]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="Zendesk extract exceeded the configured byte cap.",
            )
        return self._save_zendesk_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            resource_id=resource_id or "all",
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            include_pii=include_pii,
            api_mode=str(export.get("api_mode") or "rest"),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("endpoints_used") or []),
            cursor=str(export.get("cursor") or ""),
            end_time=str(export.get("end_time") or ""),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_zendesk_asset(
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
        cursor: str,
        end_time: str,
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
            "connector_key": "zendesk",
            "source_type": "zendesk",
            "subdomain": record.get("subdomain"),
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
            "incremental_cursor": cursor,
            "incremental_end_time": end_time,
            "column_schema": [
                {"name": header, "data_type": "string"} for header in headers
            ],
            "checksum_sha256": checksum,
            "schema_fingerprint": _schema_fingerprint(headers),
            "data_format": "csv",
            "source_timezone": record.get("timezone") or "UTC",
            "pii_redacted": not include_pii,
            "snapshot_time": _now_iso(),
        }
        manifest_key = f"{s3_key}.manifest.json"
        upload_bytes(
            bucket=bucket,
            key=manifest_key,
            data=json.dumps(manifest, sort_keys=True, default=str).encode("utf-8"),
            content_type="application/json",
        )
        filename = (
            f"zendesk_{_sanitize_filename_part(report_type)}_"
            f"{date_window['from']}_{date_window['to']}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=ZENDESK_ASSET_TYPE,
            size_bytes=len(csv_content),
            checksum_sha256=checksum,
            version=config.aws.s3.USER_ASSETS_BUCKET_VERSION,
            content_type="text/csv",
            asset_id=asset_id,
            file_id=file_id,
            original_filename=filename,
            extension="csv",
            row_count=len(rows),
            column_count=len(headers),
        )
        connected_accounts_repo.append_selected_entity(
            user_id=user_id, provider=ZENDESK_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "zendesk",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "zendesk_subdomain": record.get("subdomain"),
                "zendesk_report_type": report_type,
                "zendesk_manifest_s3_key": manifest_key,
                "zendesk_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {len(rows)} rows from Zendesk ({entity['name']}).",
            "asset": updated or asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "entity_id": entity["id"],
            "truncated": truncated,
            "api_mode": api_mode,
        }


zendesk_service = ZendeskSupportConnectorService()
