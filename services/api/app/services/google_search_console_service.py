import asyncio
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
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
from urllib.parse import quote, urlencode

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


GOOGLE_SEARCH_CONSOLE_PROVIDER = "google_search_console"
GOOGLE_SEARCH_CONSOLE_ASSET_TYPE = "integration_google_search_console"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024
GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SEARCH_CONSOLE_API_BASE_URL = "https://www.googleapis.com/webmasters/v3"
DEFAULT_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]

VALID_REPORT_TYPES = {
    "search_overview",
    "queries",
    "pages",
    "countries",
    "devices",
    "dates",
    "query_page",
}
VALID_SEARCH_TYPES = {"web", "image", "video", "news", "discover", "googleNews"}

REPORT_LABELS = {
    "search_overview": "Search Overview",
    "queries": "Queries",
    "pages": "Pages",
    "countries": "Countries",
    "devices": "Devices",
    "dates": "Dates",
    "query_page": "Query + Page",
}

REPORT_DIMENSIONS = {
    "search_overview": [],
    "queries": ["query"],
    "pages": ["page"],
    "countries": ["country"],
    "devices": ["device"],
    "dates": ["date"],
    "query_page": ["query", "page"],
}

METRIC_HEADERS = ["clicks", "impressions", "ctr", "position"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def site_key_for_url(site_url: str) -> str:
    return _b64url(str(site_url).encode("utf-8"))


def site_url_from_key(site_key: str) -> str:
    try:
        raw = base64.urlsafe_b64decode(
            str(site_key).encode("ascii") + b"=" * (-len(str(site_key)) % 4)
        )
        return raw.decode("utf-8")
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="Invalid Search Console site key."
        ) from exc


def normalize_site_url(value: str) -> str:
    site_url = str(value or "").strip()
    if not site_url:
        raise HTTPException(status_code=400, detail="site_url is required.")
    if site_url.startswith("sc-domain:"):
        return site_url
    if site_url.startswith("http://") or site_url.startswith("https://"):
        return site_url
    raise HTTPException(
        status_code=400,
        detail="site_url must be a URL-prefix property or sc-domain property.",
    )


def normalize_search_type(value: Any) -> str:
    search_type = str(value or "web").strip() or "web"
    if search_type not in VALID_SEARCH_TYPES:
        raise HTTPException(
            status_code=400,
            detail="search_type must be web, image, video, news, discover, or googleNews.",
        )
    return search_type


def normalize_report_type(value: Any) -> str:
    report_type = str(value or "search_overview").strip() or "search_overview"
    if report_type not in VALID_REPORT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid Google Search Console report_type.",
        )
    return report_type


def normalize_row_limit(value: Any) -> int:
    try:
        return max(1, min(int(value or DEFAULT_ROW_LIMIT), MAX_ROW_LIMIT))
    except (TypeError, ValueError):
        return DEFAULT_ROW_LIMIT


def normalize_max_bytes(value: Any) -> int:
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


def _headers_for_report(report_type: str) -> List[str]:
    dimensions = REPORT_DIMENSIONS[report_type]
    if report_type == "search_overview":
        return ["site_url", "search_type", "date_start", "date_end", *METRIC_HEADERS]
    return ["site_url", *dimensions, "search_type", *METRIC_HEADERS]


class GoogleSearchConsoleAdapter:
    def __init__(self, api_base_url: str = GOOGLE_SEARCH_CONSOLE_API_BASE_URL):
        self.api_base_url = api_base_url.rstrip("/")
        self._sleep = asyncio.sleep

    async def _request_with_retries(
        self,
        request_fn: Callable[..., Any],
        url: str,
        *,
        max_attempts: int = 3,
        **kwargs: Any,
    ) -> httpx.Response:
        last_response: Optional[httpx.Response] = None
        for attempt in range(max_attempts):
            response = await request_fn(url, **kwargs)
            last_response = response
            if response.status_code not in {429, 500, 502, 503, 504}:
                return response
            if attempt == max_attempts - 1:
                return response
            retry_after = response.headers.get("Retry-After")
            try:
                delay = float(retry_after) if retry_after else 0.5 * (2**attempt)
            except ValueError:
                delay = 0.5 * (2**attempt)
            await self._sleep(min(delay, 5.0))
        assert last_response is not None
        return last_response

    async def exchange_token(
        self,
        *,
        client_id: str,
        client_secret: str,
        code: str,
        redirect_uri: str,
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await self._request_with_retries(
                client.post,
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
        response.raise_for_status()
        return dict(response.json())

    async def refresh_token(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await self._request_with_retries(
                client.post,
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
        response.raise_for_status()
        return dict(response.json())

    async def fetch_sites(self, *, access_token: str) -> List[Dict[str, str]]:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await self._request_with_retries(
                client.get,
                f"{self.api_base_url}/sites",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        response.raise_for_status()
        payload = response.json()
        sites: List[Dict[str, str]] = []
        for item in payload.get("siteEntry", []) or []:
            site_url = normalize_site_url(str(item.get("siteUrl") or ""))
            sites.append(
                {
                    "site_url": site_url,
                    "site_key": site_key_for_url(site_url),
                    "permission_level": str(item.get("permissionLevel") or ""),
                }
            )
        return sites

    async def fetch_report_rows(
        self,
        *,
        access_token: str,
        site_url: str,
        report_type: str,
        search_type: str,
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        dimensions = REPORT_DIMENSIONS[report_type]
        rows: List[Dict[str, Any]] = []
        start_row = 0
        page_size = min(5_000, row_limit)
        endpoint = f"/sites/{quote(site_url, safe='')}/searchAnalytics/query"
        request_url = f"{self.api_base_url}{endpoint}"
        body_base = {
            "startDate": date_window["from"],
            "endDate": date_window["to"],
            "dimensions": dimensions,
            "type": search_type,
            "dataState": "final",
        }
        while len(rows) < row_limit:
            remaining = row_limit - len(rows)
            body = {
                **body_base,
                "rowLimit": min(page_size, remaining),
                "startRow": start_row,
            }
            async with httpx.AsyncClient(timeout=45) as client:
                response = await self._request_with_retries(
                    client.post,
                    request_url,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
            response.raise_for_status()
            payload = response.json()
            batch = payload.get("rows", []) or []
            for item in batch:
                rows.append(
                    self._row_from_response(
                        site_url=site_url,
                        report_type=report_type,
                        search_type=search_type,
                        date_window=date_window,
                        dimensions=dimensions,
                        item=item,
                    )
                )
            if len(batch) < body["rowLimit"]:
                break
            start_row += len(batch)
            if len(rows) >= row_limit:
                break
        return {
            "rows": rows[:row_limit],
            "api_mode": "search_analytics",
            "endpoints_used": [f"POST {endpoint}"],
            "generated_query": json.dumps(body_base, sort_keys=True),
            "truncated": len(rows) >= row_limit,
        }

    def _row_from_response(
        self,
        *,
        site_url: str,
        report_type: str,
        search_type: str,
        date_window: Dict[str, str],
        dimensions: Sequence[str],
        item: Dict[str, Any],
    ) -> Dict[str, Any]:
        row = {
            "site_url": site_url,
            "search_type": search_type,
            "clicks": item.get("clicks", 0),
            "impressions": item.get("impressions", 0),
            "ctr": item.get("ctr", 0),
            "position": item.get("position", 0),
        }
        if report_type == "search_overview":
            row["date_start"] = date_window["from"]
            row["date_end"] = date_window["to"]
            return row
        keys = list(item.get("keys") or [])
        for index, dimension in enumerate(dimensions):
            row[dimension] = keys[index] if index < len(keys) else ""
        return row


class GoogleSearchConsoleMarketingService:
    def __init__(self, adapter: Optional[GoogleSearchConsoleAdapter] = None):
        self.adapter = adapter or GoogleSearchConsoleAdapter()

    def _google_search_console_config(self) -> Dict[str, Any]:
        cfg = getattr(config, "google_search_console", None)
        scopes = getattr(cfg, "scopes", None)
        if isinstance(scopes, str):
            resolved_scopes = [item for item in scopes.split() if item]
        elif isinstance(scopes, list):
            resolved_scopes = [str(item) for item in scopes if str(item).strip()]
        else:
            env_scopes = os.environ.get("GOOGLE_SEARCH_CONSOLE_SCOPES", "")
            resolved_scopes = env_scopes.split() if env_scopes else DEFAULT_SCOPES
        return {
            "client_id": str(
                getattr(cfg, "client_id", None)
                or os.environ.get("GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "")
            ),
            "client_secret": str(
                getattr(cfg, "client_secret", None)
                or os.environ.get("GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", "")
            ),
            "redirect_uri": str(
                getattr(cfg, "redirect_uri", None)
                or os.environ.get("GOOGLE_SEARCH_CONSOLE_REDIRECT_URI", "")
            ),
            "scopes": resolved_scopes or DEFAULT_SCOPES,
        }

    def _state_secret(self) -> str:
        cfg = self._google_search_console_config()
        return (
            cfg["client_secret"]
            or getattr(config.app, "secret_key", "")
            or "google-search-console-dev"
        )

    def _make_state_payload(self, user_id: str) -> str:
        payload = {
            "u": user_id,
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
                raise ValueError("Invalid Google Search Console OAuth state signature.")
            payload = json.loads(
                base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
            )
            issued_at = int(payload.get("iat") or 0)
            if int(datetime.now(timezone.utc).timestamp()) - issued_at > 900:
                raise ValueError("Google Search Console OAuth state expired.")
            return payload
        except Exception as exc:
            raise ValueError("Invalid Google Search Console OAuth state.") from exc

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(
                user_id, GOOGLE_SEARCH_CONSOLE_PROVIDER
            )
            or {}
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
            provider=GOOGLE_SEARCH_CONSOLE_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str) -> str:
        cfg = self._google_search_console_config()
        if not cfg["client_id"] or not cfg["redirect_uri"]:
            raise ValueError(
                "Google Search Console client_id or redirect_uri is not configured."
            )
        state = self._make_state_payload(user_id)
        record = (
            connected_accounts_repo.get_connection(
                user_id, GOOGLE_SEARCH_CONSOLE_PROVIDER
            )
            or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        now = int(datetime.now(timezone.utc).timestamp())
        pending[state] = {"created_at": now}
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
                "scope": " ".join(cfg["scopes"]),
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
                "state": state,
            }
        )
        return f"{GOOGLE_AUTH_BASE_URL}?{params}"

    async def handle_oauth_callback(self, code: str, state: str) -> None:
        cfg = self._google_search_console_config()
        if not cfg["client_id"] or not cfg["client_secret"]:
            raise ValueError(
                "Google Search Console OAuth client credentials are not configured."
            )
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        record = (
            connected_accounts_repo.get_connection(
                user_id, GOOGLE_SEARCH_CONSOLE_PROVIDER
            )
            or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        if not pending.pop(state, None):
            raise ValueError("Missing Google Search Console OAuth state.")
        token_data = await self.adapter.exchange_token(
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
                detail="Google OAuth response did not include an access token.",
            )
        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(seconds=int(token_data.get("expires_in") or 3600))
        ).isoformat()
        sites = await self.adapter.fetch_sites(access_token=access_token)
        self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "encrypted_refresh_token": (
                    _encrypt_secret(refresh_token) if refresh_token else ""
                ),
                "expires_at": expires_at,
                "scopes": str(
                    token_data.get("scope") or " ".join(cfg["scopes"])
                ).split(),
                "sites": sites,
                "account_name": "Google Search Console",
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
        record = (
            connected_accounts_repo.get_connection(
                user_id, GOOGLE_SEARCH_CONSOLE_PROVIDER
            )
            or {}
        )
        encrypted = record.get("encrypted_access_token")
        if not encrypted:
            raise HTTPException(
                status_code=401, detail="Google Search Console is not connected."
            )
        if self._is_expired(str(record.get("expires_at") or "")):
            return await self._refresh_access_token(user_id, record)
        try:
            return _decrypt_secret(str(encrypted)), record
        except Exception as exc:
            logger.warning("Failed to decrypt Search Console token: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="Google Search Console token could not be decrypted. Please reconnect.",
            ) from exc

    async def _refresh_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any]]:
        cfg = self._google_search_console_config()
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(
                status_code=401,
                detail="Google Search Console refresh token is missing. Please reconnect.",
            )
        refresh_token = _decrypt_secret(str(encrypted_refresh))
        token_data = await self.adapter.refresh_token(
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            refresh_token=refresh_token,
        )
        access_token = str(token_data.get("access_token") or "")
        if not access_token:
            raise HTTPException(
                status_code=401, detail="Google Search Console token refresh failed."
            )
        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(seconds=int(token_data.get("expires_in") or 3600))
        ).isoformat()
        updated = self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "expires_at": expires_at,
                "scopes": str(
                    token_data.get("scope") or " ".join(cfg["scopes"])
                ).split(),
            },
        )
        return access_token, updated

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(
                user_id, GOOGLE_SEARCH_CONSOLE_PROVIDER
            )
            or {}
        )
        return {
            "connected": bool(record.get("encrypted_access_token")),
            "account_name": record.get("account_name") or "Google Search Console",
            "scopes": record.get("scopes") or [],
            "site_count": len(record.get("sites") or []),
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(
            user_id, GOOGLE_SEARCH_CONSOLE_PROVIDER
        )

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        access_token, record = await self._access_token(user_id)
        sites = await self.adapter.fetch_sites(access_token=access_token)
        self._save_metadata(user_id, {"sites": sites})
        reports = [
            {
                "report_type": report_type,
                "label": REPORT_LABELS[report_type],
                "dimensions": REPORT_DIMENSIONS[report_type],
                "default": report_type == "search_overview",
            }
            for report_type in [
                "search_overview",
                "queries",
                "pages",
                "countries",
                "devices",
                "dates",
                "query_page",
            ]
        ]
        return {
            "reports": reports,
            "sites": sites,
            "search_types": [
                {"id": value, "label": value}
                for value in ["web", "image", "video", "news", "discover", "googleNews"]
            ],
            "account_name": record.get("account_name") or "Google Search Console",
        }

    def _site_url_from_record(self, record: Dict[str, Any], site_key: str) -> str:
        for site in record.get("sites") or []:
            if str(site.get("site_key") or "") == site_key:
                return normalize_site_url(str(site.get("site_url") or ""))
        return normalize_site_url(site_url_from_key(site_key))

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "google_search_console":
            raise HTTPException(
                status_code=400, detail="Invalid Google Search Console entity id"
            )
        report_type = normalize_report_type(parts[1])
        site_key = parts[2] or ""
        search_type = normalize_search_type(parts[3] or "web")
        site_url = site_url_from_key(site_key) if site_key else ""
        return {
            "report_type": report_type,
            "site_key": site_key,
            "site_url": site_url,
            "search_type": search_type,
        }

    def _selected_entity(
        self,
        record: Dict[str, Any],
        site_url: str,
        report_type: str,
        search_type: str,
    ) -> Dict[str, Any]:
        account_name = str(record.get("account_name") or "Google Search Console")
        site_key = site_key_for_url(site_url)
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"google_search_console:{report_type}:{site_key}:{search_type}"
        return {
            "id": entity_id,
            "name": f"{site_url} / {label} ({search_type})",
            "type": "report",
            "account_name": account_name,
            "site_url": site_url,
            "site_key": site_key,
            "search_type": search_type,
            "report_type": report_type,
            "connector_key": GOOGLE_SEARCH_CONSOLE_PROVIDER,
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
            cfg.setdefault("site_key", parsed["site_key"])
            cfg.setdefault("site_url", parsed["site_url"])
            cfg.setdefault("search_type", parsed["search_type"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "search_overview"),
            site_url=str(cfg.get("site_url") or ""),
            site_key=str(cfg.get("site_key") or ""),
            search_type=str(cfg.get("search_type") or "web"),
            date_preset=cfg.get("date_preset"),
            start_date=cfg.get("start_date"),
            end_date=cfg.get("end_date"),
            row_limit=cfg.get("row_limit"),
            max_bytes=cfg.get("max_bytes"),
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
        report_type: str = "search_overview",
        site_url: str = "",
        site_key: str = "",
        search_type: str = "web",
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        row_limit: Any = DEFAULT_ROW_LIMIT,
        max_bytes: Any = None,
    ) -> Dict[str, Any]:
        report = normalize_report_type(report_type)
        resolved_search_type = normalize_search_type(search_type)
        access_token, record = await self._access_token(user_id)
        resolved_site_url = (
            normalize_site_url(site_url)
            if site_url
            else self._site_url_from_record(record, site_key)
        )
        row_cap = normalize_row_limit(row_limit)
        byte_cap = normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        export = await self.adapter.fetch_report_rows(
            access_token=access_token,
            site_url=resolved_site_url,
            report_type=report,
            search_type=resolved_search_type,
            date_window=date_window,
            row_limit=row_cap,
        )
        rows = list(export.get("rows") or [])[:row_cap]
        headers = _headers_for_report(report)
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="Google Search Console extract exceeded the configured byte cap.",
            )
        return self._save_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            site_url=resolved_site_url,
            report_type=report,
            search_type=resolved_search_type,
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            api_mode=str(export.get("api_mode") or "search_analytics"),
            generated_query=str(export.get("generated_query") or ""),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("endpoints_used") or []),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_asset(
        self,
        *,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        site_url: str,
        report_type: str,
        search_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        max_bytes: int,
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
        entity = self._selected_entity(record, site_url, report_type, search_type)
        manifest = {
            "connector_key": GOOGLE_SEARCH_CONSOLE_PROVIDER,
            "source_type": GOOGLE_SEARCH_CONSOLE_PROVIDER,
            "site_url": site_url,
            "site_key": entity["site_key"],
            "permission_level": self._permission_for_site(record, site_url),
            "account_name": record.get("account_name") or "Google Search Console",
            "report_type": report_type,
            "dimensions": REPORT_DIMENSIONS[report_type],
            "search_type": search_type,
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
            "source_timezone": "America/Los_Angeles",
            "privacy_notes": [
                "Search Console may omit anonymized/private queries.",
                "Fresh data is not included in v1 syncs; finalized data is used by default.",
            ],
            "snapshot_time": _now_iso(),
        }
        return self._persist_asset(
            user_id=user_id,
            project_id=project_id,
            bucket=bucket,
            s3_key=s3_key,
            asset_id=asset_id,
            file_id=file_id,
            report_type=report_type,
            csv_content=csv_content,
            checksum=checksum,
            manifest=manifest,
            entity=entity,
            row_count=len(rows),
            column_count=len(headers),
        )

    def _permission_for_site(self, record: Dict[str, Any], site_url: str) -> str:
        for site in record.get("sites") or []:
            if str(site.get("site_url") or "") == site_url:
                return str(site.get("permission_level") or "")
        return ""

    def _persist_asset(
        self,
        *,
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
        filename = f"google_search_console_{_sanitize_filename_part(report_type)}_{manifest['date_window']['from']}_{manifest['date_window']['to']}.csv"
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=GOOGLE_SEARCH_CONSOLE_ASSET_TYPE,
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
            user_id=user_id,
            provider=GOOGLE_SEARCH_CONSOLE_PROVIDER,
            entity=entity,
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": GOOGLE_SEARCH_CONSOLE_PROVIDER,
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "google_search_console_site_url": manifest.get("site_url"),
                "google_search_console_site_key": manifest.get("site_key"),
                "google_search_console_report_type": report_type,
                "google_search_console_manifest_s3_key": manifest_key,
                "google_search_console_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {row_count} rows from Google Search Console ({entity['name']}).",
            "asset": updated or asset,
            "row_count": row_count,
            "column_count": column_count,
            "entity_id": entity["id"],
            "truncated": bool(manifest.get("truncated")),
            "api_mode": manifest.get("api_mode"),
        }


google_search_console_service = GoogleSearchConsoleMarketingService()
