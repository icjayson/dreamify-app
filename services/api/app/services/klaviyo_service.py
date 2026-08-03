import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import secrets
import uuid
import asyncio
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


KLAVIYO_PROVIDER = "klaviyo"
KLAVIYO_ASSET_TYPE = "integration_klaviyo"
DEFAULT_API_BASE_URL = "https://a.klaviyo.com"
KLAVIYO_AUTHORIZE_URL = "https://www.klaviyo.com/oauth/authorize"
DEFAULT_API_REVISION = "2026-04-15"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

VALID_REPORT_TYPES = {
    "lifecycle_overview",
    "campaigns",
    "flows",
    "profiles",
    "lists",
    "events",
    "metrics",
}

REPORT_LABELS = {
    "lifecycle_overview": "Lifecycle Overview",
    "campaigns": "Campaigns",
    "flows": "Flows",
    "profiles": "Profiles",
    "lists": "Lists",
    "events": "Events",
    "metrics": "Metrics",
}

REPORT_RESOURCES = {
    "lifecycle_overview": "all",
    "campaigns": "campaigns",
    "flows": "flows",
    "profiles": "profiles",
    "lists": "lists",
    "events": "events",
    "metrics": "metrics",
}

REPORT_HEADERS = {
    "lifecycle_overview": [
        "date_start",
        "date_end",
        "account_id",
        "account_name",
        "conversion_metric_id",
        "conversion_metric_name",
        "campaign_count",
        "flow_count",
        "profile_count",
        "list_count",
        "event_count",
        "channel",
    ],
    "campaigns": [
        "campaign_id",
        "campaign_name",
        "channel",
        "status",
        "send_time",
        "subject",
        "message_type",
        "conversion_metric_id",
        "opens",
        "clicks",
        "conversions",
        "revenue",
    ],
    "flows": [
        "flow_id",
        "flow_name",
        "status",
        "trigger_type",
        "updated_at",
        "conversion_metric_id",
        "opens",
        "clicks",
        "conversions",
        "revenue",
    ],
    "profiles": [
        "profile_id",
        "email",
        "phone_number",
        "first_name",
        "last_name",
        "created_at",
        "updated_at",
        "consent_email",
        "consent_sms",
        "predictive_analytics_available",
    ],
    "lists": [
        "list_id",
        "list_name",
        "created_at",
        "updated_at",
        "profile_count",
    ],
    "events": [
        "event_id",
        "event_datetime",
        "metric_id",
        "metric_name",
        "profile_id",
        "value",
        "event_properties",
    ],
    "metrics": [
        "metric_id",
        "name",
        "integration_name",
        "integration_category",
        "created_at",
        "updated_at",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    token = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode(
        "ascii"
    )
    return f"Basic {token}"


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


def _jsonapi_items(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    data = payload.get("data")
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _attributes(item: Dict[str, Any]) -> Dict[str, Any]:
    attrs = item.get("attributes")
    return attrs if isinstance(attrs, dict) else {}


def _relationships(item: Dict[str, Any]) -> Dict[str, Any]:
    rels = item.get("relationships")
    return rels if isinstance(rels, dict) else {}


def _relationship_id(item: Dict[str, Any], name: str) -> str:
    rel = _relationships(item).get(name) or {}
    data = rel.get("data") if isinstance(rel, dict) else None
    if isinstance(data, dict):
        return str(data.get("id") or "")
    return ""


def _nested_get(mapping: Dict[str, Any], path: Sequence[str], default: Any = "") -> Any:
    value: Any = mapping
    for key in path:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
    return default if value is None else value


def _redact_email(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw or "@" not in raw:
        return raw
    local, domain = raw.split("@", 1)
    return f"{local[:1]}***@{domain}"


def _redact_phone(value: Any) -> str:
    raw = str(value or "").strip()
    if len(raw) <= 4:
        return "***" if raw else ""
    return f"***{raw[-4:]}"


def resolve_date_window(
    date_preset: Optional[str], start_date: Optional[str], end_date: Optional[str]
) -> Dict[str, str]:
    today = datetime.now(timezone.utc).date()
    if date_preset and date_preset != "custom":
        days_by_preset = {
            "last_7d": 7,
            "last_14d": 14,
            "last_30d": 30,
            "last_90d": 90,
        }
        days = days_by_preset.get(date_preset, 30)
        return {
            "from": (today - timedelta(days=days)).isoformat(),
            "to": today.isoformat(),
        }
    try:
        start = date.fromisoformat(str(start_date or ""))
        end = date.fromisoformat(str(end_date or ""))
    except ValueError:
        start = today - timedelta(days=30)
        end = today
    if start > end:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    return {"from": start.isoformat(), "to": end.isoformat()}


class KlaviyoLifecycleAdapter:
    async def exchange_token(
        self,
        *,
        client_id: str,
        client_secret: str,
        code: str,
        code_verifier: str,
        redirect_uri: str,
        api_base_url: str,
    ) -> Dict[str, Any]:
        return await self._token_request(
            api_base_url=api_base_url,
            client_id=client_id,
            client_secret=client_secret,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": redirect_uri,
            },
        )

    async def refresh_token(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        api_base_url: str,
    ) -> Dict[str, Any]:
        return await self._token_request(
            api_base_url=api_base_url,
            client_id=client_id,
            client_secret=client_secret,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        )

    async def _token_request(
        self,
        *,
        api_base_url: str,
        client_id: str,
        client_secret: str,
        data: Dict[str, str],
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": _basic_auth_header(client_id, client_secret),
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{api_base_url.rstrip('/')}/oauth/token",
                data=data,
                headers=headers,
            )
        resp.raise_for_status()
        return resp.json()

    async def api_get(
        self,
        *,
        api_base_url: str,
        access_token: str,
        revision: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._request(
            method="GET",
            api_base_url=api_base_url,
            access_token=access_token,
            revision=revision,
            path=path,
            params=params,
        )

    async def api_post(
        self,
        *,
        api_base_url: str,
        access_token: str,
        revision: str,
        path: str,
        json_body: Dict[str, Any],
    ) -> Dict[str, Any]:
        return await self._request(
            method="POST",
            api_base_url=api_base_url,
            access_token=access_token,
            revision=revision,
            path=path,
            json_body=json_body,
        )

    async def _request(
        self,
        *,
        method: str,
        api_base_url: str,
        access_token: str,
        revision: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        url = path if path.startswith("http") else f"{api_base_url.rstrip('/')}{path}"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Revision": revision,
        }
        last_error: Optional[Exception] = None
        async with httpx.AsyncClient(timeout=60.0) as client:
            for attempt in range(max_attempts):
                response = await client.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    headers=headers,
                )
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

    async def paginate(
        self,
        *,
        api_base_url: str,
        access_token: str,
        revision: str,
        path: str,
        params: Optional[Dict[str, Any]],
        row_limit: int,
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        next_path = path
        next_params = dict(params or {})
        while next_path and len(rows) < row_limit:
            payload = await self.api_get(
                api_base_url=api_base_url,
                access_token=access_token,
                revision=revision,
                path=next_path,
                params=next_params,
            )
            rows.extend(_jsonapi_items(payload))
            next_url = _nested_get(payload, ["links", "next"], "")
            next_path = str(next_url or "")
            next_params = {}
            if not next_path:
                break
        return rows[:row_limit]

    async def fetch_account(
        self, *, api_base_url: str, access_token: str, revision: str
    ) -> Dict[str, Any]:
        try:
            payload = await self.api_get(
                api_base_url=api_base_url,
                access_token=access_token,
                revision=revision,
                path="/api/accounts/",
                params={"page[size]": 1},
            )
            account = (_jsonapi_items(payload) or [{}])[0]
            attrs = _attributes(account)
            return {
                "account_id": account.get("id"),
                "account_name": attrs.get("name") or attrs.get("contact_email"),
                "timezone": attrs.get("timezone") or "UTC",
                "currency": attrs.get("preferred_currency"),
            }
        except Exception as exc:
            logger.info("Klaviyo account lookup failed: %s", exc)
            return {"account_id": "all", "account_name": "Klaviyo", "timezone": "UTC"}

    async def fetch_resources(
        self, *, api_base_url: str, access_token: str, revision: str
    ) -> Dict[str, List[Dict[str, Any]]]:
        result: Dict[str, List[Dict[str, Any]]] = {}
        endpoints = {
            "metrics": "/api/metrics/",
            "campaigns": "/api/campaigns/",
            "flows": "/api/flows/",
            "lists": "/api/lists/",
        }
        for name, path in endpoints.items():
            try:
                result[name] = await self.paginate(
                    api_base_url=api_base_url,
                    access_token=access_token,
                    revision=revision,
                    path=path,
                    params={"page[size]": 100},
                    row_limit=100,
                )
            except Exception as exc:
                logger.info("Klaviyo %s resource lookup failed: %s", name, exc)
                result[name] = []
        return result

    async def fetch_report_rows(
        self,
        *,
        api_base_url: str,
        access_token: str,
        revision: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        resource_id: str,
        metric_id: str,
        channel: str,
    ) -> Dict[str, Any]:
        resources = await self.fetch_resources(
            api_base_url=api_base_url, access_token=access_token, revision=revision
        )
        if report_type == "metrics":
            rows = [self._flatten_metric(item) for item in resources.get("metrics", [])]
            return {"rows": rows[:row_limit], "api_mode": "rest", "truncated": False}
        if report_type == "campaigns":
            rows = [
                self._flatten_campaign(item, metric_id)
                for item in resources.get("campaigns", [])
                if self._resource_matches(item, resource_id)
                and self._channel_matches(item, channel)
            ]
            return {"rows": rows[:row_limit], "api_mode": "rest", "truncated": len(rows) > row_limit}
        if report_type == "flows":
            rows = [
                self._flatten_flow(item, metric_id)
                for item in resources.get("flows", [])
                if self._resource_matches(item, resource_id)
            ]
            return {"rows": rows[:row_limit], "api_mode": "rest", "truncated": len(rows) > row_limit}
        if report_type == "lists":
            rows = [self._flatten_list(item) for item in resources.get("lists", [])]
            return {"rows": rows[:row_limit], "api_mode": "rest", "truncated": len(rows) > row_limit}
        if report_type == "profiles":
            items = await self.paginate(
                api_base_url=api_base_url,
                access_token=access_token,
                revision=revision,
                path="/api/profiles/",
                params={"page[size]": min(row_limit, 100)},
                row_limit=row_limit,
            )
            rows = [self._flatten_profile(item, include_pii) for item in items]
            return {"rows": rows, "api_mode": "rest", "truncated": len(rows) >= row_limit}
        if report_type == "events":
            params: Dict[str, Any] = {
                "page[size]": min(row_limit, 100),
                "filter": f"greater-or-equal(datetime,{date_window['from']}T00:00:00Z)",
            }
            items = await self.paginate(
                api_base_url=api_base_url,
                access_token=access_token,
                revision=revision,
                path="/api/events/",
                params=params,
                row_limit=row_limit,
            )
            rows = [self._flatten_event(item) for item in items]
            return {"rows": rows, "api_mode": "rest", "truncated": len(rows) >= row_limit}
        rows = [
            {
                "date_start": date_window["from"],
                "date_end": date_window["to"],
                "account_id": "",
                "account_name": "",
                "conversion_metric_id": metric_id,
                "conversion_metric_name": "",
                "campaign_count": len(resources.get("campaigns", [])),
                "flow_count": len(resources.get("flows", [])),
                "profile_count": "",
                "list_count": len(resources.get("lists", [])),
                "event_count": "",
                "channel": channel or "all",
            }
        ]
        return {"rows": rows, "api_mode": "rest", "truncated": False}

    def _resource_matches(self, item: Dict[str, Any], resource_id: str) -> bool:
        return resource_id in {"", "all"} or str(item.get("id") or "") == resource_id

    def _channel_matches(self, item: Dict[str, Any], channel: str) -> bool:
        if channel in {"", "all"}:
            return True
        attrs = _attributes(item)
        raw = " ".join(
            str(attrs.get(key) or "") for key in ("channel", "send_strategy", "message_type")
        ).lower()
        return channel.lower() in raw

    def _flatten_metric(self, item: Dict[str, Any]) -> Dict[str, Any]:
        attrs = _attributes(item)
        integration = attrs.get("integration") if isinstance(attrs.get("integration"), dict) else {}
        return {
            "metric_id": item.get("id"),
            "name": attrs.get("name"),
            "integration_name": integration.get("name") if isinstance(integration, dict) else "",
            "integration_category": integration.get("category") if isinstance(integration, dict) else "",
            "created_at": attrs.get("created"),
            "updated_at": attrs.get("updated"),
        }

    def _flatten_campaign(self, item: Dict[str, Any], metric_id: str) -> Dict[str, Any]:
        attrs = _attributes(item)
        return {
            "campaign_id": item.get("id"),
            "campaign_name": attrs.get("name"),
            "channel": attrs.get("channel") or attrs.get("send_strategy"),
            "status": attrs.get("status"),
            "send_time": attrs.get("send_time") or attrs.get("scheduled_at"),
            "subject": attrs.get("subject"),
            "message_type": attrs.get("message_type"),
            "conversion_metric_id": metric_id,
            "opens": "",
            "clicks": "",
            "conversions": "",
            "revenue": "",
        }

    def _flatten_flow(self, item: Dict[str, Any], metric_id: str) -> Dict[str, Any]:
        attrs = _attributes(item)
        trigger = attrs.get("trigger_type") or _nested_get(attrs, ["trigger", "type"], "")
        return {
            "flow_id": item.get("id"),
            "flow_name": attrs.get("name"),
            "status": attrs.get("status"),
            "trigger_type": trigger,
            "updated_at": attrs.get("updated"),
            "conversion_metric_id": metric_id,
            "opens": "",
            "clicks": "",
            "conversions": "",
            "revenue": "",
        }

    def _flatten_profile(self, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
        attrs = _attributes(item)
        subscriptions = attrs.get("subscriptions") if isinstance(attrs.get("subscriptions"), dict) else {}
        email = attrs.get("email")
        phone = attrs.get("phone_number")
        return {
            "profile_id": item.get("id"),
            "email": email if include_pii else _redact_email(email),
            "phone_number": phone if include_pii else _redact_phone(phone),
            "first_name": attrs.get("first_name") if include_pii else "",
            "last_name": attrs.get("last_name") if include_pii else "",
            "created_at": attrs.get("created"),
            "updated_at": attrs.get("updated"),
            "consent_email": _nested_get(subscriptions, ["email", "marketing", "consent"], ""),
            "consent_sms": _nested_get(subscriptions, ["sms", "marketing", "consent"], ""),
            "predictive_analytics_available": bool(attrs.get("predictive_analytics")),
        }

    def _flatten_list(self, item: Dict[str, Any]) -> Dict[str, Any]:
        attrs = _attributes(item)
        return {
            "list_id": item.get("id"),
            "list_name": attrs.get("name"),
            "created_at": attrs.get("created"),
            "updated_at": attrs.get("updated"),
            "profile_count": attrs.get("profile_count"),
        }

    def _flatten_event(self, item: Dict[str, Any]) -> Dict[str, Any]:
        attrs = _attributes(item)
        properties = attrs.get("event_properties")
        return {
            "event_id": item.get("id"),
            "event_datetime": attrs.get("datetime") or attrs.get("timestamp"),
            "metric_id": _relationship_id(item, "metric"),
            "metric_name": _nested_get(attrs, ["metric", "name"], ""),
            "profile_id": _relationship_id(item, "profile"),
            "value": attrs.get("value"),
            "event_properties": json.dumps(properties or {}, sort_keys=True),
        }


class KlaviyoLifecycleService:
    def __init__(self, adapter: Optional[KlaviyoLifecycleAdapter] = None):
        self.adapter = adapter or KlaviyoLifecycleAdapter()

    def _klaviyo_config(self) -> Dict[str, str]:
        cfg = getattr(config, "klaviyo", None)
        return {
            "client_id": (getattr(cfg, "client_id", "") if cfg else "")
            or os.environ.get("KLAVIYO_CLIENT_ID", ""),
            "client_secret": (getattr(cfg, "client_secret", "") if cfg else "")
            or os.environ.get("KLAVIYO_CLIENT_SECRET", ""),
            "redirect_uri": (getattr(cfg, "redirect_uri", "") if cfg else "")
            or os.environ.get("KLAVIYO_REDIRECT_URI", ""),
            "api_base_url": (getattr(cfg, "api_base_url", "") if cfg else "")
            or os.environ.get("KLAVIYO_API_BASE_URL", DEFAULT_API_BASE_URL),
            "api_revision": (getattr(cfg, "api_revision", "") if cfg else "")
            or os.environ.get("KLAVIYO_API_REVISION", DEFAULT_API_REVISION),
        }

    def _scopes(self) -> List[str]:
        return [
            "accounts:read",
            "campaigns:read",
            "flows:read",
            "profiles:read",
            "lists:read",
            "events:read",
            "metrics:read",
        ]

    def _make_state_payload(self, user_id: str) -> str:
        cfg = self._klaviyo_config()
        secret = cfg["client_secret"] or config.app.secret_key
        payload = {
            "u": user_id,
            "n": _b64url(secrets.token_bytes(18)),
            "ts": int(datetime.now(timezone.utc).timestamp()),
        }
        body = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        sig = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256)
        return f"{body}.{sig.hexdigest()}"

    def _verify_state(self, state: str, max_age_seconds: int = 900) -> Dict[str, Any]:
        cfg = self._klaviyo_config()
        secret = cfg["client_secret"] or config.app.secret_key
        try:
            body, sig = str(state or "").split(".", 1)
            expected = hmac.new(
                secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(sig, expected):
                raise ValueError("Invalid state signature")
            padded = body + "=" * (-len(body) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
            age = int(datetime.now(timezone.utc).timestamp()) - int(
                payload.get("ts", 0)
            )
            if age > max_age_seconds:
                raise ValueError("State token expired")
            if not payload.get("u"):
                raise ValueError("Invalid state payload")
            return payload
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Invalid state format") from exc

    def _pkce_pair(self) -> Tuple[str, str]:
        verifier = _b64url(secrets.token_bytes(48))
        challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
        return verifier, challenge

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, KLAVIYO_PROVIDER) or {}
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
                "user_id",
                "provider",
                "updated_at",
            }
        }
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=KLAVIYO_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str) -> str:
        cfg = self._klaviyo_config()
        if not cfg["client_id"] or not cfg["redirect_uri"]:
            raise ValueError("Klaviyo client_id or redirect_uri is not configured.")
        state = self._make_state_payload(user_id)
        code_verifier, code_challenge = self._pkce_pair()
        record = connected_accounts_repo.get_connection(user_id, KLAVIYO_PROVIDER) or {}
        pending = dict(record.get("pending_oauth_states") or {})
        now = int(datetime.now(timezone.utc).timestamp())
        pending[state] = {
            "code_verifier": code_verifier,
            "created_at": now,
        }
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
                "scope": " ".join(self._scopes()),
                "state": state,
                "code_challenge_method": "S256",
                "code_challenge": code_challenge,
            }
        )
        return f"{KLAVIYO_AUTHORIZE_URL}?{params}"

    async def handle_oauth_callback(self, code: str, state: str) -> None:
        cfg = self._klaviyo_config()
        if not cfg["client_id"] or not cfg["client_secret"]:
            raise ValueError("Klaviyo OAuth client credentials are not configured.")
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        record = connected_accounts_repo.get_connection(user_id, KLAVIYO_PROVIDER) or {}
        pending = dict(record.get("pending_oauth_states") or {})
        pending_state = pending.pop(state, None)
        code_verifier = str((pending_state or {}).get("code_verifier") or "")
        if not code_verifier:
            raise ValueError("Missing Klaviyo OAuth state.")
        token_data = await self.adapter.exchange_token(
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            code=code,
            code_verifier=code_verifier,
            redirect_uri=cfg["redirect_uri"],
            api_base_url=cfg["api_base_url"],
        )
        access_token = str(token_data.get("access_token") or "")
        refresh_token = str(token_data.get("refresh_token") or "")
        if not access_token or not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="Klaviyo OAuth response did not include access and refresh tokens.",
            )
        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(seconds=int(token_data.get("expires_in") or 3600))
        ).isoformat()
        account = await self.adapter.fetch_account(
            api_base_url=cfg["api_base_url"],
            access_token=access_token,
            revision=cfg["api_revision"],
        )
        resources = await self.adapter.fetch_resources(
            api_base_url=cfg["api_base_url"],
            access_token=access_token,
            revision=cfg["api_revision"],
        )
        default_metric = self._find_default_metric(resources.get("metrics", []))
        self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "encrypted_refresh_token": _encrypt_secret(refresh_token),
                "expires_at": expires_at,
                "scopes": str(token_data.get("scope") or " ".join(self._scopes())).split(),
                "account_id": account.get("account_id") or "all",
                "account_name": account.get("account_name") or "Klaviyo",
                "timezone": account.get("timezone") or "UTC",
                "currency": account.get("currency"),
                "api_base_url": cfg["api_base_url"],
                "api_revision": cfg["api_revision"],
                "default_metric_id": default_metric.get("id"),
                "default_metric_name": default_metric.get("name"),
                "pending_oauth_states": pending,
                "connected_at": _now_iso(),
            },
        )

    async def _access_token(self, user_id: str) -> Tuple[str, Dict[str, Any]]:
        record = connected_accounts_repo.get_connection(user_id, KLAVIYO_PROVIDER) or {}
        encrypted = record.get("encrypted_access_token")
        if not encrypted:
            raise HTTPException(status_code=401, detail="Klaviyo is not connected.")
        expires_at = str(record.get("expires_at") or "")
        if self._is_expired(expires_at):
            return await self._refresh_access_token(user_id, record)
        try:
            return _decrypt_secret(str(encrypted)), record
        except Exception as exc:
            logger.warning("Failed to decrypt Klaviyo access token: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="Klaviyo token could not be decrypted. Please reconnect.",
            ) from exc

    def _is_expired(self, expires_at: str) -> bool:
        if not expires_at:
            return False
        try:
            expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            return datetime.now(timezone.utc) >= expires - timedelta(minutes=2)
        except ValueError:
            return False

    async def _refresh_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any]]:
        cfg = self._klaviyo_config()
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(
                status_code=401, detail="Klaviyo refresh token is missing. Please reconnect."
            )
        refresh_token = _decrypt_secret(str(encrypted_refresh))
        token_data = await self.adapter.refresh_token(
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            refresh_token=refresh_token,
            api_base_url=str(record.get("api_base_url") or cfg["api_base_url"]),
        )
        access_token = str(token_data.get("access_token") or "")
        next_refresh = str(token_data.get("refresh_token") or refresh_token)
        if not access_token:
            raise HTTPException(status_code=401, detail="Klaviyo token refresh failed.")
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
                "scopes": str(token_data.get("scope") or " ".join(self._scopes())).split(),
            },
        )
        return access_token, updated

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, KLAVIYO_PROVIDER) or {}
        return {
            "connected": bool(record.get("encrypted_access_token")),
            "account_id": record.get("account_id"),
            "account_name": record.get("account_name") or "Klaviyo",
            "timezone": record.get("timezone"),
            "currency": record.get("currency"),
            "api_revision": record.get("api_revision") or DEFAULT_API_REVISION,
            "scopes": record.get("scopes") or [],
            "default_metric_id": record.get("default_metric_id"),
            "default_metric_name": record.get("default_metric_name"),
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, KLAVIYO_PROVIDER)

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        access_token, record = await self._access_token(user_id)
        cfg = self._klaviyo_config()
        api_base_url = str(record.get("api_base_url") or cfg["api_base_url"])
        revision = str(record.get("api_revision") or cfg["api_revision"])
        resources = await self.adapter.fetch_resources(
            api_base_url=api_base_url,
            access_token=access_token,
            revision=revision,
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
                "flows",
                "profiles",
                "lists",
                "events",
                "metrics",
            ]
        ]
        return {
            "reports": reports,
            "metrics": [self._resource_summary(item) for item in resources.get("metrics", [])],
            "campaigns": [
                self._resource_summary(item) for item in resources.get("campaigns", [])
            ],
            "flows": [self._resource_summary(item) for item in resources.get("flows", [])],
            "lists": [self._resource_summary(item) for item in resources.get("lists", [])],
            "default_metric_id": record.get("default_metric_id"),
            "default_metric_name": record.get("default_metric_name"),
        }

    def _resource_summary(self, item: Dict[str, Any]) -> Dict[str, Any]:
        attrs = _attributes(item)
        return {
            "id": str(item.get("id") or ""),
            "name": str(attrs.get("name") or item.get("id") or ""),
            "type": str(item.get("type") or ""),
            "status": attrs.get("status"),
            "channel": attrs.get("channel"),
            "updated_at": attrs.get("updated"),
        }

    def _find_default_metric(self, metrics: Sequence[Dict[str, Any]]) -> Dict[str, str]:
        for item in metrics:
            attrs = _attributes(item)
            if str(attrs.get("name") or "").strip().lower() == "placed order":
                return {"id": str(item.get("id") or ""), "name": "Placed Order"}
        return {}

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "klaviyo":
            raise HTTPException(status_code=400, detail="Invalid Klaviyo entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Klaviyo report type")
        return {
            "report_type": report_type,
            "account_id": parts[2] or "all",
            "resource_id": parts[3] or "all",
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, resource_id: str
    ) -> Dict[str, Any]:
        account_id = str(record.get("account_id") or "all")
        account_name = str(record.get("account_name") or "Klaviyo")
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"klaviyo:{report_type}:{account_id}:{resource_id or 'all'}"
        return {
            "id": entity_id,
            "name": f"{account_name} / {label}",
            "type": "report",
            "account_name": account_name,
            "account_id": account_id,
            "report_type": report_type,
            "resource_id": resource_id or "all",
            "connector_key": "klaviyo",
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
            metric_id=str(cfg.get("metric_id") or ""),
            resource_id=str(cfg.get("resource_id") or ""),
            channel=str(cfg.get("channel") or "all"),
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
        metric_id: str = "",
        resource_id: str = "",
        channel: str = "all",
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid report_type. Must be lifecycle_overview, campaigns, "
                    "flows, profiles, lists, events, or metrics."
                ),
            )
        access_token, record = await self._access_token(user_id)
        cfg = self._klaviyo_config()
        api_base_url = str(record.get("api_base_url") or cfg["api_base_url"])
        revision = str(record.get("api_revision") or cfg["api_revision"])
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        resolved_metric_id = metric_id or str(record.get("default_metric_id") or "")
        if report_type in {"lifecycle_overview", "campaigns", "flows"} and not resolved_metric_id:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Klaviyo conversion metric is required. Select a metric from "
                    "resources; Placed Order was not available by default."
                ),
            )
        selected_resource_id = resource_id or "all"
        export = await self.adapter.fetch_report_rows(
            api_base_url=api_base_url,
            access_token=access_token,
            revision=revision,
            report_type=report_type,
            date_window=date_window,
            row_limit=row_cap,
            include_pii=include_pii,
            resource_id=selected_resource_id,
            metric_id=resolved_metric_id,
            channel=channel or "all",
        )
        rows = list(export.get("rows") or [])[:row_cap]
        headers = REPORT_HEADERS[report_type]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="Klaviyo extract exceeded the configured byte cap.",
            )
        return self._save_klaviyo_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            resource_id=selected_resource_id,
            metric_id=resolved_metric_id,
            channel=channel or "all",
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            include_pii=include_pii,
            api_mode=str(export.get("api_mode") or "rest"),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("endpoints_used") or []),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_klaviyo_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        report_type: str,
        resource_id: str,
        metric_id: str,
        channel: str,
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
            "connector_key": "klaviyo",
            "source_type": "klaviyo",
            "account_id": record.get("account_id"),
            "account_name": record.get("account_name"),
            "api_revision": record.get("api_revision") or DEFAULT_API_REVISION,
            "report_type": report_type,
            "date_window": date_window,
            "selected_metric_id": metric_id,
            "selected_metric_name": record.get("default_metric_name"),
            "selected_resource_id": resource_id,
            "channel": channel,
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
            f"klaviyo_{_sanitize_filename_part(report_type)}_"
            f"{date_window['from']}_{date_window['to']}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=KLAVIYO_ASSET_TYPE,
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
            user_id=user_id, provider=KLAVIYO_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "klaviyo",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "klaviyo_account_id": record.get("account_id"),
                "klaviyo_report_type": report_type,
                "klaviyo_manifest_s3_key": manifest_key,
                "klaviyo_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {len(rows)} rows from Klaviyo ({entity['name']}).",
            "asset": updated or asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "entity_id": entity["id"],
            "truncated": truncated,
            "api_mode": api_mode,
        }


klaviyo_service = KlaviyoLifecycleService()
