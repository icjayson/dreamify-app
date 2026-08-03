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


TIKTOK_SHOP_PROVIDER = "tiktok_shop_seller"
TIKTOK_SHOP_ASSET_TYPE = "integration_tiktok_shop_seller"
DEFAULT_API_BASE_URL = "https://open-api.tiktokglobalshop.com"
AUTHORIZATION_URL = "https://services.tiktokshop.com/open/authorize"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

SUPPORTED_REGIONS = {
    "US": "United States",
    "GB": "United Kingdom",
    "VN": "Vietnam",
    "ID": "Indonesia",
    "TH": "Thailand",
    "PH": "Philippines",
    "MY": "Malaysia",
    "SG": "Singapore",
    "MX": "Mexico",
    "BR": "Brazil",
    "DE": "Germany",
    "FR": "France",
    "IT": "Italy",
    "ES": "Spain",
}

VALID_REPORT_TYPES = {
    "sales_overview",
    "orders",
    "order_items",
    "products",
    "inventory",
    "returns",
    "settlements",
}

REPORT_LABELS = {
    "sales_overview": "Sales Overview",
    "orders": "Orders",
    "order_items": "Order Items",
    "products": "Products",
    "inventory": "Inventory",
    "returns": "Returns",
    "settlements": "Settlements",
}

REPORT_ENDPOINTS = {
    "sales_overview": "/order/202309/orders/search",
    "orders": "/order/202309/orders/search",
    "order_items": "/order/202309/orders/search",
    "products": "/product/202309/products/search",
    "inventory": "/product/202309/products/search",
    "returns": "/return_refund/202309/returns/search",
    "settlements": "/finance/202309/settlements/search",
}

REPORT_HEADERS = {
    "sales_overview": [
        "order_create_time",
        "order_id",
        "shop_id",
        "region",
        "currency",
        "subtotal",
        "discount",
        "shipping_fee",
        "tax",
        "total_amount",
        "payment_method",
        "order_status",
        "fulfillment_status",
        "cancel_status",
        "return_status",
        "product_count",
        "buyer_email",
        "buyer_name",
        "buyer_phone",
        "buyer_address",
    ],
    "orders": [
        "order_id",
        "create_time",
        "update_time",
        "shop_id",
        "region",
        "status",
        "fulfillment_type",
        "warehouse_id",
        "currency",
        "total_amount",
        "payment_method",
        "cancellation_reason",
        "buyer_email",
        "buyer_name",
        "buyer_phone",
        "buyer_address",
    ],
    "order_items": [
        "order_id",
        "order_create_time",
        "shop_id",
        "product_id",
        "sku_id",
        "seller_sku",
        "product_name",
        "sku_name",
        "quantity",
        "currency",
        "item_price",
        "item_tax",
        "discount",
        "platform_discount",
        "seller_discount",
        "fulfillment_status",
    ],
    "products": [
        "product_id",
        "title",
        "status",
        "shop_id",
        "category_name",
        "brand_name",
        "seller_sku",
        "sku_id",
        "sku_name",
        "currency",
        "price",
        "available_stock",
        "sales_count",
    ],
    "inventory": [
        "shop_id",
        "product_id",
        "product_name",
        "sku_id",
        "seller_sku",
        "sku_name",
        "available_stock",
        "reserved_stock",
        "warehouse_id",
        "update_time",
    ],
    "returns": [
        "return_id",
        "order_id",
        "shop_id",
        "product_id",
        "sku_id",
        "quantity",
        "reason",
        "status",
        "refund_amount",
        "currency",
        "create_time",
        "update_time",
    ],
    "settlements": [
        "settlement_id",
        "order_id",
        "shop_id",
        "currency",
        "revenue",
        "fees",
        "refund_amount",
        "net_amount",
        "settlement_time",
        "status",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _normalize_region(value: Any) -> str:
    region = str(value or "US").strip().upper()
    if region not in SUPPORTED_REGIONS:
        raise HTTPException(status_code=400, detail="Unsupported TikTok Shop region")
    return region


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


def _money_amount(value: Any) -> Any:
    if isinstance(value, dict):
        return value.get("amount") or value.get("Amount") or value.get("value") or ""
    return value or ""


def _money_currency(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("currency") or value.get("CurrencyCode") or "")
    return ""


def _as_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    return []


def _lookup(row: Dict[str, Any], *keys: str) -> Any:
    if not isinstance(row, dict):
        return ""
    normalized = {
        str(key).strip().lower().replace(" ", "_").replace("-", "_"): value
        for key, value in row.items()
    }
    for key in keys:
        needle = key.strip().lower().replace(" ", "_").replace("-", "_")
        if needle in normalized:
            return normalized[needle]
    return ""


def resolve_date_window(
    date_preset: Optional[str], start_date: Optional[str], end_date: Optional[str]
) -> Dict[str, str]:
    today = datetime.now(timezone.utc).date()
    if date_preset and date_preset != "custom":
        days = {
            "last_7d": 7,
            "last_14d": 14,
            "last_30d": 30,
            "last_90d": 90,
        }.get(date_preset, 30)
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


class TikTokShopSellerAdapter:
    async def exchange_token(
        self,
        *,
        api_base_url: str,
        app_key: str,
        app_secret: str,
        code: str,
    ) -> Dict[str, Any]:
        params = {
            "app_key": app_key,
            "app_secret": app_secret,
            "auth_code": code,
            "grant_type": "authorized_code",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{api_base_url.rstrip('/')}/api/v2/token/get", params=params
            )
        resp.raise_for_status()
        return resp.json()

    async def refresh_token(
        self,
        *,
        api_base_url: str,
        app_key: str,
        app_secret: str,
        refresh_token: str,
    ) -> Dict[str, Any]:
        params = {
            "app_key": app_key,
            "app_secret": app_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{api_base_url.rstrip('/')}/api/v2/token/refresh", params=params
            )
        resp.raise_for_status()
        return resp.json()

    def sign_request(
        self,
        *,
        path: str,
        params: Dict[str, Any],
        body: bytes,
        app_secret: str,
    ) -> str:
        canonical = path
        for key in sorted(k for k in params.keys() if k not in {"sign", "access_token"}):
            value = params[key]
            if isinstance(value, list):
                value = ",".join(str(item) for item in value)
            canonical += f"{key}{value}"
        if body:
            canonical += body.decode("utf-8")
        raw = f"{app_secret}{canonical}{app_secret}".encode("utf-8")
        return hmac.new(app_secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()

    async def api_request(
        self,
        *,
        method: str,
        api_base_url: str,
        app_key: str,
        app_secret: str,
        access_token: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        query_params = dict(params or {})
        query_params["app_key"] = app_key
        query_params["timestamp"] = int(datetime.now(timezone.utc).timestamp())
        body = (
            json.dumps(json_body, separators=(",", ":")).encode("utf-8")
            if json_body is not None
            else b""
        )
        query_params["sign"] = self.sign_request(
            path=path, params=query_params, body=body, app_secret=app_secret
        )
        url = f"{api_base_url.rstrip('/')}{path}?{urlencode(query_params, doseq=True)}"
        headers = {
            "Accept": "application/json",
            "User-Agent": "DreamifyTikTokShopSellerConnector/1.0",
            "x-tts-access-token": access_token,
        }
        if body:
            headers["Content-Type"] = "application/json"
        last_error: Optional[Exception] = None
        async with httpx.AsyncClient(timeout=90.0) as client:
            for attempt in range(max_attempts):
                response = await client.request(
                    method, url, content=body or None, headers=headers
                )
                if response.status_code in {429, 503} and attempt < max_attempts - 1:
                    await self._sleep(self._retry_delay(response, attempt))
                    continue
                try:
                    response.raise_for_status()
                    payload = response.json() if response.content else {}
                    code = payload.get("code")
                    if code not in {None, 0, "0"}:
                        message = payload.get("message") or payload.get("msg") or "TikTok Shop API error"
                        raise HTTPException(status_code=502, detail=str(message))
                    return payload
                except httpx.HTTPStatusError as exc:
                    last_error = exc
                    if response.status_code in {429, 503} and attempt < max_attempts - 1:
                        await self._sleep(self._retry_delay(response, attempt))
                        continue
                    raise
        if last_error:
            raise last_error
        return {}

    def _retry_delay(self, response: httpx.Response, attempt: int) -> float:
        raw = response.headers.get("Retry-After")
        if raw:
            try:
                return min(float(raw), 10.0)
            except ValueError:
                pass
        return min(1.0 + attempt * 2.0, 10.0)

    async def _sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    async def fetch_shops(self, ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
        try:
            payload = await self.api_request(
                method="GET",
                path="/authorization/202309/shops",
                params=None,
                **ctx,
            )
            data = payload.get("data") or payload.get("payload") or {}
            raw_shops = data.get("shops") or data.get("authorized_shops") or []
            shops = [self._flatten_shop(item, ctx.get("region")) for item in raw_shops]
            return [shop for shop in shops if shop.get("id")]
        except Exception as exc:
            logger.info("TikTok Shop authorized shop lookup failed: %s", exc)
            return []

    async def fetch_report_rows(
        self,
        *,
        ctx: Dict[str, Any],
        report_type: str,
        shops: Sequence[Dict[str, Any]],
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        endpoints: List[str] = []
        target_shops = list(shops) or [{"id": "all", "region": ctx.get("region") or "US"}]
        for shop in target_shops:
            if len(rows) >= row_limit:
                break
            export = await self._fetch_report_for_shop(
                ctx=ctx,
                report_type=report_type,
                shop=shop,
                date_window=date_window,
                row_limit=row_limit - len(rows),
            )
            rows.extend(export["rows"])
            endpoints.extend(export["api_endpoints_used"])
        return {
            "rows": rows[:row_limit],
            "api_mode": "open_api",
            "truncated": len(rows) > row_limit or len(rows) >= row_limit,
            "api_endpoints_used": sorted(set(endpoints)),
            "report_ids": [],
            "report_document_ids": [],
        }

    async def _fetch_report_for_shop(
        self,
        *,
        ctx: Dict[str, Any],
        report_type: str,
        shop: Dict[str, Any],
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        path = REPORT_ENDPOINTS[report_type]
        body = self._request_body(report_type, date_window, row_limit)
        params = self._shop_params(shop)
        rows: List[Dict[str, Any]] = []
        next_page_token = ""
        while len(rows) < row_limit:
            request_body = dict(body)
            if next_page_token:
                request_body["page_token"] = next_page_token
            payload = await self.api_request(
                method="POST",
                path=path,
                params=params,
                json_body=request_body,
                **ctx,
            )
            data = payload.get("data") or payload.get("payload") or {}
            raw_rows = self._extract_rows(report_type, data)
            rows.extend(
                self._flatten_report_row(report_type, item, shop) for item in raw_rows
            )
            next_page_token = str(data.get("next_page_token") or "")
            if not next_page_token or not raw_rows:
                break
        return {"rows": rows[:row_limit], "api_endpoints_used": [path]}

    def _request_body(
        self, report_type: str, date_window: Dict[str, str], row_limit: int
    ) -> Dict[str, Any]:
        page_size = min(row_limit, 100)
        start_ts = int(
            datetime.fromisoformat(f"{date_window['from']}T00:00:00+00:00").timestamp()
        )
        end_ts = int(
            datetime.fromisoformat(f"{date_window['to']}T23:59:59+00:00").timestamp()
        )
        if report_type in {"products", "inventory"}:
            return {"page_size": page_size}
        return {
            "page_size": page_size,
            "create_time_ge": start_ts,
            "create_time_lt": end_ts,
        }

    def _shop_params(self, shop: Dict[str, Any]) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        shop_cipher = shop.get("shop_cipher")
        if shop_cipher:
            params["shop_cipher"] = shop_cipher
        return params

    def _extract_rows(self, report_type: str, data: Dict[str, Any]) -> List[Any]:
        candidates = {
            "sales_overview": ("orders", "order_list", "items"),
            "orders": ("orders", "order_list", "items"),
            "order_items": ("orders", "order_list", "items"),
            "products": ("products", "product_list", "items"),
            "inventory": ("products", "product_list", "items"),
            "returns": ("returns", "return_orders", "items"),
            "settlements": ("settlements", "records", "items"),
        }[report_type]
        for key in candidates:
            value = data.get(key)
            if isinstance(value, list):
                return value
        return []

    def _flatten_shop(self, item: Dict[str, Any], fallback_region: Any) -> Dict[str, Any]:
        return {
            "id": str(item.get("shop_id") or item.get("id") or ""),
            "name": item.get("shop_name") or item.get("name") or "TikTok Shop",
            "region": _normalize_region(item.get("region") or fallback_region or "US"),
            "shop_cipher": item.get("shop_cipher") or item.get("cipher") or "",
        }

    def _flatten_report_row(
        self, report_type: str, item: Dict[str, Any], shop: Dict[str, Any]
    ) -> Dict[str, Any]:
        if report_type in {"sales_overview", "orders"}:
            return self._flatten_order(item, shop, sales_overview=report_type == "sales_overview")
        if report_type == "order_items":
            return self._flatten_order_items(item, shop)
        if report_type in {"products", "inventory"}:
            return self._flatten_product(item, shop, inventory=report_type == "inventory")
        if report_type == "returns":
            return {
                "return_id": _lookup(item, "return_id", "id"),
                "order_id": _lookup(item, "order_id"),
                "shop_id": shop.get("id"),
                "product_id": _lookup(item, "product_id"),
                "sku_id": _lookup(item, "sku_id"),
                "quantity": _lookup(item, "quantity"),
                "reason": _lookup(item, "reason", "return_reason"),
                "status": _lookup(item, "status", "return_status"),
                "refund_amount": _money_amount(_lookup(item, "refund_amount", "refund_total")),
                "currency": _money_currency(_lookup(item, "refund_amount", "refund_total"))
                or _lookup(item, "currency"),
                "create_time": _lookup(item, "create_time", "return_create_time"),
                "update_time": _lookup(item, "update_time"),
            }
        return {
            "settlement_id": _lookup(item, "settlement_id", "id"),
            "order_id": _lookup(item, "order_id"),
            "shop_id": shop.get("id"),
            "currency": _lookup(item, "currency"),
            "revenue": _lookup(item, "revenue", "gross_revenue"),
            "fees": _lookup(item, "fees", "platform_fees"),
            "refund_amount": _lookup(item, "refund_amount"),
            "net_amount": _lookup(item, "net_amount", "settlement_amount"),
            "settlement_time": _lookup(item, "settlement_time", "create_time"),
            "status": _lookup(item, "status"),
        }

    def _flatten_order(
        self, order: Dict[str, Any], shop: Dict[str, Any], sales_overview: bool
    ) -> Dict[str, Any]:
        payment = order.get("payment") or {}
        total = order.get("total_amount") or payment.get("total_amount")
        currency = _money_currency(total) or _lookup(order, "currency")
        row = {
            "order_id": _lookup(order, "order_id", "id"),
            "create_time": _lookup(order, "create_time", "order_create_time"),
            "update_time": _lookup(order, "update_time"),
            "shop_id": shop.get("id"),
            "region": shop.get("region"),
            "status": _lookup(order, "status", "order_status"),
            "fulfillment_type": _lookup(order, "fulfillment_type"),
            "warehouse_id": _lookup(order, "warehouse_id"),
            "currency": currency,
            "total_amount": _money_amount(total),
            "payment_method": _lookup(order, "payment_method"),
            "cancellation_reason": _lookup(order, "cancellation_reason"),
            "buyer_email": "",
            "buyer_name": "",
            "buyer_phone": "",
            "buyer_address": "",
        }
        if not sales_overview:
            return row
        line_items = _as_list(order.get("line_items") or order.get("items"))
        subtotal = order.get("subtotal") or payment.get("subtotal")
        return {
            "order_create_time": row["create_time"],
            "order_id": row["order_id"],
            "shop_id": row["shop_id"],
            "region": row["region"],
            "currency": currency,
            "subtotal": _money_amount(subtotal),
            "discount": _money_amount(order.get("discount") or payment.get("discount")),
            "shipping_fee": _money_amount(order.get("shipping_fee") or payment.get("shipping_fee")),
            "tax": _money_amount(order.get("tax") or payment.get("tax")),
            "total_amount": row["total_amount"],
            "payment_method": row["payment_method"],
            "order_status": row["status"],
            "fulfillment_status": _lookup(order, "fulfillment_status"),
            "cancel_status": _lookup(order, "cancel_status"),
            "return_status": _lookup(order, "return_status"),
            "product_count": len(line_items) or _lookup(order, "product_count"),
            "buyer_email": "",
            "buyer_name": "",
            "buyer_phone": "",
            "buyer_address": "",
        }

    def _flatten_order_items(
        self, order: Dict[str, Any], shop: Dict[str, Any]
    ) -> Dict[str, Any]:
        rows = _as_list(order.get("line_items") or order.get("items"))
        item = rows[0] if rows and isinstance(rows[0], dict) else order
        price = item.get("sale_price") or item.get("item_price") or item.get("price")
        return {
            "order_id": _lookup(order, "order_id", "id"),
            "order_create_time": _lookup(order, "create_time", "order_create_time"),
            "shop_id": shop.get("id"),
            "product_id": _lookup(item, "product_id"),
            "sku_id": _lookup(item, "sku_id"),
            "seller_sku": _lookup(item, "seller_sku", "sku"),
            "product_name": _lookup(item, "product_name", "name", "title"),
            "sku_name": _lookup(item, "sku_name", "variation"),
            "quantity": _lookup(item, "quantity"),
            "currency": _money_currency(price) or _lookup(order, "currency"),
            "item_price": _money_amount(price),
            "item_tax": _money_amount(item.get("tax")),
            "discount": _money_amount(item.get("discount")),
            "platform_discount": _money_amount(item.get("platform_discount")),
            "seller_discount": _money_amount(item.get("seller_discount")),
            "fulfillment_status": _lookup(item, "fulfillment_status"),
        }

    def _flatten_product(
        self, product: Dict[str, Any], shop: Dict[str, Any], inventory: bool
    ) -> Dict[str, Any]:
        skus = _as_list(product.get("skus") or product.get("sku_list"))
        sku = skus[0] if skus and isinstance(skus[0], dict) else product
        stock = sku.get("stock_infos") or sku.get("inventory") or {}
        if isinstance(stock, list):
            stock = stock[0] if stock and isinstance(stock[0], dict) else {}
        price = sku.get("price") or product.get("price")
        if inventory:
            return {
                "shop_id": shop.get("id"),
                "product_id": _lookup(product, "product_id", "id"),
                "product_name": _lookup(product, "title", "product_name"),
                "sku_id": _lookup(sku, "sku_id", "id"),
                "seller_sku": _lookup(sku, "seller_sku", "sku"),
                "sku_name": _lookup(sku, "sku_name", "name"),
                "available_stock": _lookup(stock, "available_stock", "quantity"),
                "reserved_stock": _lookup(stock, "reserved_stock"),
                "warehouse_id": _lookup(stock, "warehouse_id"),
                "update_time": _lookup(product, "update_time"),
            }
        return {
            "product_id": _lookup(product, "product_id", "id"),
            "title": _lookup(product, "title", "product_name"),
            "status": _lookup(product, "status"),
            "shop_id": shop.get("id"),
            "category_name": _lookup(product, "category_name"),
            "brand_name": _lookup(product, "brand_name"),
            "seller_sku": _lookup(sku, "seller_sku", "sku"),
            "sku_id": _lookup(sku, "sku_id", "id"),
            "sku_name": _lookup(sku, "sku_name", "name"),
            "currency": _money_currency(price),
            "price": _money_amount(price),
            "available_stock": _lookup(stock, "available_stock", "quantity"),
            "sales_count": _lookup(product, "sales_count"),
        }


class TikTokShopSellerConnectorService:
    def __init__(self, adapter: Optional[TikTokShopSellerAdapter] = None):
        self.adapter = adapter or TikTokShopSellerAdapter()

    def _tiktok_shop_config(self) -> Dict[str, str]:
        cfg = getattr(config, "tiktok_shop", None)
        return {
            "app_key": (getattr(cfg, "app_key", "") if cfg else "")
            or os.environ.get("TIKTOK_SHOP_APP_KEY", ""),
            "app_secret": (getattr(cfg, "app_secret", "") if cfg else "")
            or os.environ.get("TIKTOK_SHOP_APP_SECRET", ""),
            "redirect_uri": (getattr(cfg, "redirect_uri", "") if cfg else "")
            or os.environ.get("TIKTOK_SHOP_REDIRECT_URI", ""),
            "api_base_url": (getattr(cfg, "api_base_url", "") if cfg else "")
            or os.environ.get("TIKTOK_SHOP_API_BASE_URL", DEFAULT_API_BASE_URL),
            "default_region": (getattr(cfg, "default_region", "") if cfg else "")
            or os.environ.get("TIKTOK_SHOP_DEFAULT_REGION", "US"),
        }

    def _make_state_payload(self, user_id: str, region: str) -> str:
        cfg = self._tiktok_shop_config()
        secret = cfg["app_secret"] or config.app.secret_key
        payload = {
            "u": user_id,
            "r": region,
            "n": _b64url(secrets.token_bytes(18)),
            "ts": int(datetime.now(timezone.utc).timestamp()),
        }
        body = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        sig = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256)
        return f"{body}.{sig.hexdigest()}"

    def _verify_state(self, state: str, max_age_seconds: int = 900) -> Dict[str, Any]:
        cfg = self._tiktok_shop_config()
        secret = cfg["app_secret"] or config.app.secret_key
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
            payload["r"] = _normalize_region(payload.get("r"))
            return payload
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Invalid state format") from exc

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
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
            provider=TIKTOK_SHOP_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str, region: str = "US") -> str:
        cfg = self._tiktok_shop_config()
        selected_region = _normalize_region(region or cfg["default_region"])
        if not cfg["app_key"]:
            raise ValueError("TikTok Shop app_key is not configured.")
        state = self._make_state_payload(user_id, selected_region)
        record = (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        now = int(datetime.now(timezone.utc).timestamp())
        pending[state] = {"region": selected_region, "created_at": now}
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
        params = {
            "service_id": cfg["app_key"],
            "state": state,
            "region": selected_region,
        }
        if cfg["redirect_uri"]:
            params["redirect_uri"] = cfg["redirect_uri"]
        return f"{AUTHORIZATION_URL}?{urlencode(params)}"

    async def handle_oauth_callback(self, code: str, state: str) -> None:
        cfg = self._tiktok_shop_config()
        if not cfg["app_key"] or not cfg["app_secret"]:
            raise ValueError("TikTok Shop OAuth credentials are not configured.")
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        region = _normalize_region(payload.get("r"))
        record = (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        if not pending.pop(state, None):
            raise ValueError("Missing TikTok Shop OAuth state.")
        token_response = await self.adapter.exchange_token(
            api_base_url=cfg["api_base_url"],
            app_key=cfg["app_key"],
            app_secret=cfg["app_secret"],
            code=code,
        )
        token_data = self._token_data(token_response)
        access_token = str(token_data.get("access_token") or "")
        refresh_token = str(token_data.get("refresh_token") or "")
        if not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="TikTok Shop OAuth response did not include a refresh token.",
            )
        expires_at = self._expires_at(token_data, "access_token_expire_in", 3600)
        refresh_expires_at = self._expires_at(
            token_data, "refresh_token_expire_in", 365 * 24 * 3600
        )
        metadata = self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token)
                if access_token
                else "",
                "encrypted_refresh_token": _encrypt_secret(refresh_token),
                "expires_at": expires_at,
                "refresh_expires_at": refresh_expires_at,
                "account_id": token_data.get("open_id") or record.get("account_id") or "all",
                "account_name": record.get("account_name") or "TikTok Shop Seller",
                "region": region,
                "api_base_url": cfg["api_base_url"],
                "shops": [],
                "pending_oauth_states": pending,
                "connected_at": _now_iso(),
            },
        )
        try:
            ctx = await self._api_context(user_id, metadata)
            shops = await self.adapter.fetch_shops(ctx)
            if shops:
                self._save_metadata(user_id, {"shops": shops})
        except Exception as exc:
            logger.info("TikTok Shop post-connect shop lookup failed: %s", exc)

    def _token_data(self, response: Dict[str, Any]) -> Dict[str, Any]:
        data = response.get("data") if isinstance(response, dict) else {}
        return data if isinstance(data, dict) else response

    def _expires_at(
        self, token_data: Dict[str, Any], key: str, default_seconds: int
    ) -> str:
        raw = token_data.get(key) or token_data.get(key.replace("_in", "_at"))
        try:
            value = int(raw or default_seconds)
        except (TypeError, ValueError):
            value = default_seconds
        if value > 10_000_000_000:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
        if value > 1_000_000_000:
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        return (datetime.now(timezone.utc) + timedelta(seconds=value)).isoformat()

    async def _api_context(
        self, user_id: str, record: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        cfg = self._tiktok_shop_config()
        record = record or (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
        )
        access_token, current = await self._access_token(user_id, record)
        return {
            "api_base_url": str(current.get("api_base_url") or cfg["api_base_url"]),
            "app_key": cfg["app_key"],
            "app_secret": cfg["app_secret"],
            "access_token": access_token,
            "region": _normalize_region(current.get("region") or cfg["default_region"]),
        }

    async def _access_token(
        self, user_id: str, record: Optional[Dict[str, Any]] = None
    ) -> Tuple[str, Dict[str, Any]]:
        record = record or (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
        )
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(status_code=401, detail="TikTok Shop is not connected.")
        encrypted_access = record.get("encrypted_access_token")
        if encrypted_access and not self._is_expired(str(record.get("expires_at") or "")):
            return _decrypt_secret(str(encrypted_access)), record
        return await self._refresh_access_token(user_id, record)

    def _is_expired(self, expires_at: str) -> bool:
        if not expires_at:
            return True
        try:
            expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            return datetime.now(timezone.utc) >= expires - timedelta(minutes=2)
        except ValueError:
            return True

    async def _refresh_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any]]:
        cfg = self._tiktok_shop_config()
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(
                status_code=401,
                detail="TikTok Shop refresh token is missing. Please reconnect.",
            )
        token_response = await self.adapter.refresh_token(
            api_base_url=str(record.get("api_base_url") or cfg["api_base_url"]),
            app_key=cfg["app_key"],
            app_secret=cfg["app_secret"],
            refresh_token=_decrypt_secret(str(encrypted_refresh)),
        )
        token_data = self._token_data(token_response)
        access_token = str(token_data.get("access_token") or "")
        if not access_token:
            raise HTTPException(status_code=401, detail="TikTok Shop token refresh failed.")
        updated = self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "expires_at": self._expires_at(token_data, "access_token_expire_in", 3600),
            },
        )
        return access_token, updated

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
        )
        return {
            "connected": bool(record.get("encrypted_refresh_token")),
            "account_id": record.get("account_id"),
            "account_name": record.get("account_name") or "TikTok Shop Seller",
            "region": record.get("region"),
            "shops": record.get("shops") or [],
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, TIKTOK_SHOP_PROVIDER)

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
        )
        if not record.get("encrypted_refresh_token"):
            raise HTTPException(status_code=401, detail="TikTok Shop is not connected.")
        shops = record.get("shops") or []
        reports = [
            {
                "report_type": report_type,
                "label": REPORT_LABELS[report_type],
                "default": report_type == "sales_overview",
            }
            for report_type in [
                "sales_overview",
                "orders",
                "order_items",
                "products",
                "inventory",
                "returns",
                "settlements",
            ]
        ]
        return {"reports": reports, "shops": shops, "regions": SUPPORTED_REGIONS}

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "tiktok_shop_seller":
            raise HTTPException(status_code=400, detail="Invalid TikTok Shop entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid TikTok Shop report type")
        return {
            "report_type": report_type,
            "shop_id": parts[2] or "all",
            "region": _normalize_region(parts[3] or "US"),
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, shop_id: str, region: str
    ) -> Dict[str, Any]:
        account_name = str(record.get("account_name") or "TikTok Shop Seller")
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        return {
            "id": f"tiktok_shop_seller:{report_type}:{shop_id or 'all'}:{region}",
            "name": f"{account_name} / {label}",
            "type": "report",
            "account_name": account_name,
            "account_id": record.get("account_id") or "all",
            "shop_id": shop_id or "all",
            "region": region,
            "report_type": report_type,
            "connector_key": "tiktok_shop_seller",
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
            cfg.setdefault("shop_id", parsed["shop_id"])
            cfg.setdefault("region", parsed["region"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "sales_overview"),
            date_preset=cfg.get("date_preset"),
            start_date=cfg.get("start_date"),
            end_date=cfg.get("end_date"),
            row_limit=cfg.get("row_limit"),
            shop_id=str(cfg.get("shop_id") or "all"),
            region=str(cfg.get("region") or "US"),
            include_pii=bool(cfg.get("include_pii", False)),
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
        report_type: str = "sales_overview",
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        row_limit: Any = DEFAULT_ROW_LIMIT,
        shop_id: str = "all",
        region: str = "US",
        include_pii: bool = False,
        max_bytes: Any = None,
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid report_type. Must be sales_overview, orders, order_items, "
                    "products, inventory, returns, or settlements."
                ),
            )
        if include_pii:
            raise HTTPException(
                status_code=400,
                detail="TikTok Shop Seller v1 does not support buyer PII export.",
            )
        selected_region = _normalize_region(region)
        record = (
            connected_accounts_repo.get_connection(user_id, TIKTOK_SHOP_PROVIDER) or {}
        )
        if not record.get("encrypted_refresh_token"):
            raise HTTPException(status_code=401, detail="TikTok Shop is not connected.")
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        shops = self._resolve_shops(record, shop_id, selected_region)
        ctx = await self._api_context(user_id, record)
        export = await self.adapter.fetch_report_rows(
            ctx=ctx,
            report_type=report_type,
            shops=shops,
            date_window=date_window,
            row_limit=row_cap,
        )
        headers = REPORT_HEADERS[report_type]
        rows = list(export.get("rows") or [])[:row_cap]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="TikTok Shop extract exceeded the configured byte cap.",
            )
        return self._save_tiktok_shop_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            shop_id=shop_id or "all",
            shops=shops,
            region=selected_region,
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            api_mode=str(export.get("api_mode") or "open_api"),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("api_endpoints_used") or []),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _resolve_shops(
        self, record: Dict[str, Any], shop_id: str, region: str
    ) -> List[Dict[str, Any]]:
        shops = record.get("shops")
        if isinstance(shops, list):
            normalized = [
                {
                    "id": str(item.get("id") or item.get("shop_id") or ""),
                    "name": item.get("name") or item.get("shop_name") or "TikTok Shop",
                    "region": _normalize_region(item.get("region") or region),
                    "shop_cipher": item.get("shop_cipher") or "",
                }
                for item in shops
                if item.get("id") or item.get("shop_id")
            ]
            if shop_id and shop_id != "all":
                matched = [item for item in normalized if item["id"] == shop_id]
                if matched:
                    return matched
                raise HTTPException(status_code=400, detail="Unknown TikTok Shop shop_id.")
            if normalized:
                return normalized
        return [{"id": shop_id or "all", "name": "TikTok Shop", "region": region}]

    def _save_tiktok_shop_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        report_type: str,
        shop_id: str,
        shops: Sequence[Dict[str, Any]],
        region: str,
        date_window: Dict[str, str],
        row_limit: int,
        max_bytes: int,
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
        entity = self._selected_entity(record, report_type, shop_id, region)
        shop_ids = [str(shop.get("id") or "") for shop in shops if shop.get("id")]
        manifest = {
            "connector_key": "tiktok_shop_seller",
            "source_type": "tiktok_shop_seller",
            "account_id": record.get("account_id"),
            "account_name": record.get("account_name") or "TikTok Shop Seller",
            "region": region,
            "shop_id": shop_id,
            "shop_ids": shop_ids,
            "report_type": report_type,
            "api_base_url": record.get("api_base_url"),
            "api_paths_used": list(endpoints_used),
            "date_window": date_window,
            "row_cap": row_limit,
            "byte_cap": max_bytes,
            "row_count": len(rows),
            "truncated": truncated,
            "api_mode": api_mode,
            "column_schema": [
                {"name": header, "data_type": "string"} for header in headers
            ],
            "checksum_sha256": checksum,
            "schema_fingerprint": _schema_fingerprint(headers),
            "data_format": "csv",
            "source_timezone": "UTC",
            "pii_redacted": True,
            "restricted_buyer_data_used": False,
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
            f"tiktok_shop_seller_{_sanitize_filename_part(report_type)}_"
            f"{date_window['from']}_{date_window['to']}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=TIKTOK_SHOP_ASSET_TYPE,
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
            user_id=user_id, provider=TIKTOK_SHOP_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "tiktok_shop_seller",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "tiktok_shop_report_type": report_type,
                "tiktok_shop_region": region,
                "tiktok_shop_manifest_s3_key": manifest_key,
                "tiktok_shop_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": (
                f"Successfully synced {len(rows)} rows from TikTok Shop "
                f"({entity['name']})."
            ),
            "asset": updated or asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "entity_id": entity["id"],
            "truncated": truncated,
            "api_mode": api_mode,
        }


tiktok_shop_seller_service = TikTokShopSellerConnectorService()
