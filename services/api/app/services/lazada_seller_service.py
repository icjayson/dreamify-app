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


LAZADA_PROVIDER = "lazada_seller"
LAZADA_ASSET_TYPE = "integration_lazada_seller"
DEFAULT_AUTH_BASE_URL = "https://auth.lazada.com"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

SUPPORTED_REGIONS = {
    "VN": "Vietnam",
    "SG": "Singapore",
    "MY": "Malaysia",
    "TH": "Thailand",
    "ID": "Indonesia",
    "PH": "Philippines",
}

REGION_API_ENDPOINTS = {
    "VN": "https://api.lazada.vn/rest",
    "SG": "https://api.lazada.sg/rest",
    "MY": "https://api.lazada.com.my/rest",
    "TH": "https://api.lazada.co.th/rest",
    "ID": "https://api.lazada.co.id/rest",
    "PH": "https://api.lazada.com.ph/rest",
}

VALID_REPORT_TYPES = {
    "sales_overview",
    "orders",
    "order_items",
    "products",
    "inventory",
    "returns",
    "finance",
}

REPORT_LABELS = {
    "sales_overview": "Sales Overview",
    "orders": "Orders",
    "order_items": "Order Items",
    "products": "Products",
    "inventory": "Inventory",
    "returns": "Returns",
    "finance": "Finance",
}

REPORT_ENDPOINTS = {
    "sales_overview": "/orders/get",
    "orders": "/orders/get",
    "order_items": "/order/items/get",
    "products": "/products/get",
    "inventory": "/products/get",
    "returns": "/reverse/order/list",
    "finance": "/finance/transaction/details/get",
}

REPORT_HEADERS = {
    "sales_overview": [
        "order_create_time",
        "order_id",
        "seller_id",
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
        "seller_id",
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
        "seller_id",
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
        "seller_id",
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
        "seller_id",
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
        "seller_id",
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
    "finance": [
        "transaction_id",
        "order_id",
        "seller_id",
        "currency",
        "revenue",
        "fees",
        "refund_amount",
        "net_amount",
        "finance_time",
        "status",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _normalize_region(value: Any) -> str:
    region = str(value or "VN").strip().upper()
    if region not in SUPPORTED_REGIONS:
        raise HTTPException(status_code=400, detail="Unsupported Lazada Seller region")
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


class LazadaSellerAdapter:
    async def exchange_token(
        self,
        *,
        auth_base_url: str,
        app_key: str,
        app_secret: str,
        code: str,
    ) -> Dict[str, Any]:
        path = "/auth/token/create"
        url = self._signed_url(
            api_base_url=f"{auth_base_url.rstrip('/')}/rest",
            path=path,
            app_key=app_key,
            app_secret=app_secret,
            params={"code": code},
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url)
        resp.raise_for_status()
        return resp.json()

    async def refresh_token(
        self,
        *,
        auth_base_url: str,
        app_key: str,
        app_secret: str,
        refresh_token: str,
    ) -> Dict[str, Any]:
        path = "/auth/token/refresh"
        url = self._signed_url(
            api_base_url=f"{auth_base_url.rstrip('/')}/rest",
            path=path,
            app_key=app_key,
            app_secret=app_secret,
            params={"refresh_token": refresh_token},
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url)
        resp.raise_for_status()
        return resp.json()

    def _signed_url(
        self,
        *,
        api_base_url: str,
        path: str,
        app_key: str,
        app_secret: str,
        access_token: str = "",
        params: Optional[Dict[str, Any]] = None,
    ) -> str:
        query_params = dict(params or {})
        query_params["app_key"] = app_key
        query_params["timestamp"] = datetime.now(timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        query_params["sign_method"] = "sha256"
        if access_token:
            query_params["access_token"] = access_token
        query_params["sign"] = self.sign_request(
            path=path,
            app_secret=app_secret,
            params=query_params,
        )
        return f"{api_base_url.rstrip('/')}{path}?{urlencode(query_params, doseq=True)}"

    def sign_request(
        self,
        *,
        path: str,
        app_secret: str,
        params: Dict[str, Any],
    ) -> str:
        parts = [path]
        for key in sorted(params):
            if key == "sign":
                continue
            value = params[key]
            if value is None:
                continue
            parts.append(f"{key}{value}")
        base = "".join(parts)
        return hmac.new(
            app_secret.encode("utf-8"), base.encode("utf-8"), hashlib.sha256
        ).hexdigest().upper()

    async def api_request(
        self,
        *,
        method: str,
        api_base_url: str,
        app_key: str,
        app_secret: str,
        access_token: str,
        path: str,
        region: Optional[str] = None,
        sellers: Optional[Sequence[Dict[str, Any]]] = None,
        seller_id: Optional[str] = None,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        query_params = dict(params or {})
        selected_seller_id = str(query_params.pop("seller_id", "") or seller_id or "")
        if selected_seller_id and selected_seller_id != "all":
            query_params.setdefault("seller_id", selected_seller_id)
        body = (
            json.dumps(json_body, separators=(",", ":")).encode("utf-8")
            if json_body is not None
            else b""
        )
        url = self._signed_url(
            api_base_url=api_base_url,
            path=path,
            app_key=app_key,
            app_secret=app_secret,
            access_token=access_token,
            params=query_params,
        )
        headers = {
            "Accept": "application/json",
            "User-Agent": "DreamifyLazadaSellerConnector/1.0",
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
                    error = payload.get("error")
                    code = payload.get("code")
                    if error or code not in {None, 0, "0"}:
                        message = (
                            payload.get("message")
                            or payload.get("msg")
                            or error
                            or "Lazada Seller API error"
                        )
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

    async def fetch_sellers(self, ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
        known_sellers = ctx.get("sellers") if isinstance(ctx.get("sellers"), list) else []
        target_sellers = known_sellers or [{"id": ctx.get("seller_id"), "region": ctx.get("region")}]
        enriched: List[Dict[str, Any]] = []
        for seller in target_sellers:
            if not seller.get("id"):
                continue
            enriched_seller = dict(seller)
            try:
                payload = await self.api_request(
                    method="GET",
                    path="/api/v2/seller/get_seller_info",
                    params={"seller_id": str(seller.get("id"))},
                    **ctx,
                )
                data = payload.get("response") or payload.get("data") or {}
                enriched_seller["name"] = (
                    data.get("seller_name")
                    or data.get("name")
                    or enriched_seller.get("name")
                    or "Lazada Seller"
                )
            except Exception as exc:
                logger.info("Lazada Seller seller info lookup failed: %s", exc)
            enriched.append(self._flatten_seller(enriched_seller, ctx.get("region")))
        if enriched:
            return [seller for seller in enriched if seller.get("id")]
        try:
            payload = await self.api_request(
                method="GET",
                path="/api/v2/seller/get_seller_info",
                params=None,
                **ctx,
            )
            data = payload.get("response") or payload.get("data") or {}
            raw_sellers = data.get("sellers") or data.get("seller_list") or []
            if not raw_sellers and data:
                raw_sellers = [data]
            sellers = [self._flatten_seller(item, ctx.get("region")) for item in raw_sellers]
            return [seller for seller in sellers if seller.get("id")]
        except Exception as exc:
            logger.info("Lazada Seller authorized seller lookup failed: %s", exc)
            return []

    async def fetch_report_rows(
        self,
        *,
        ctx: Dict[str, Any],
        report_type: str,
        sellers: Sequence[Dict[str, Any]],
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        endpoints: List[str] = []
        target_sellers = list(sellers) or [{"id": "all", "region": ctx.get("region") or "VN"}]
        for seller in target_sellers:
            if len(rows) >= row_limit:
                break
            export = await self._fetch_report_for_seller(
                ctx=ctx,
                report_type=report_type,
                seller=seller,
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

    async def _fetch_report_for_seller(
        self,
        *,
        ctx: Dict[str, Any],
        report_type: str,
        seller: Dict[str, Any],
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        path = REPORT_ENDPOINTS[report_type]
        body = self._request_body(report_type, date_window, row_limit)
        params = self._seller_params(seller)
        rows: List[Dict[str, Any]] = []
        cursor = ""
        seller_ctx = {
            **ctx,
            "api_base_url": self._api_base_url_for_seller(ctx, seller),
            "region": _normalize_region(seller.get("region") or ctx.get("region")),
        }
        while len(rows) < row_limit:
            request_body = dict(body)
            if cursor:
                request_body["cursor"] = cursor
            payload = await self.api_request(
                method="POST",
                path=path,
                params=params,
                json_body=request_body,
                **seller_ctx,
            )
            data = payload.get("response") or payload.get("data") or {}
            raw_rows = self._extract_rows(report_type, data)
            rows.extend(
                self._flatten_report_row(report_type, item, seller) for item in raw_rows
            )
            cursor = str(data.get("next_cursor") or data.get("more") or "")
            if cursor.lower() == "true":
                cursor = str(data.get("next_cursor") or "")
            if not cursor or not raw_rows:
                break
        return {"rows": rows[:row_limit], "api_endpoints_used": [path]}

    def _api_base_url_for_seller(
        self, ctx: Dict[str, Any], seller: Dict[str, Any]
    ) -> str:
        region = _normalize_region(seller.get("region") or ctx.get("region"))
        return REGION_API_ENDPOINTS[region]

    def _request_body(
        self, report_type: str, date_window: Dict[str, str], row_limit: int
    ) -> Dict[str, Any]:
        page_size = min(row_limit, 100)
        start_time = f"{date_window['from']}T00:00:00+00:00"
        end_time = f"{date_window['to']}T23:59:59+00:00"
        if report_type in {"products", "inventory"}:
            return {"limit": page_size, "offset": 0}
        if report_type == "finance":
            return {"limit": page_size, "start_time": start_time, "end_time": end_time}
        return {
            "limit": page_size,
            "created_after": start_time,
            "created_before": end_time,
        }

    def _seller_params(self, seller: Dict[str, Any]) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        seller_id = seller.get("id") or seller.get("seller_id")
        if seller_id and seller_id != "all":
            params["seller_id"] = str(seller_id)
        return params

    def _extract_rows(self, report_type: str, data: Dict[str, Any]) -> List[Any]:
        candidates = {
            "sales_overview": ("orders", "order_list", "items"),
            "orders": ("orders", "order_list", "items"),
            "order_items": ("orders", "order_list", "items"),
            "products": ("item", "items", "product_list", "products"),
            "inventory": ("item", "items", "product_list", "products"),
            "returns": ("return", "returns", "return_list", "items"),
            "finance": (
                "transactions",
                "transaction_details",
                "finance",
                "records",
                "items",
            ),
        }[report_type]
        for key in candidates:
            value = data.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                return [value]
        return []

    def _flatten_seller(self, item: Dict[str, Any], fallback_region: Any) -> Dict[str, Any]:
        return {
            "id": str(item.get("seller_id") or item.get("id") or ""),
            "name": item.get("seller_name") or item.get("name") or "Lazada Seller",
            "region": _normalize_region(item.get("region") or fallback_region or "VN"),
        }

    def _flatten_report_row(
        self, report_type: str, item: Dict[str, Any], seller: Dict[str, Any]
    ) -> Dict[str, Any]:
        if report_type in {"sales_overview", "orders"}:
            return self._flatten_order(item, seller, sales_overview=report_type == "sales_overview")
        if report_type == "order_items":
            return self._flatten_order_items(item, seller)
        if report_type in {"products", "inventory"}:
            return self._flatten_product(item, seller, inventory=report_type == "inventory")
        if report_type == "returns":
            return {
                "return_id": _lookup(item, "return_id", "id"),
                "order_id": _lookup(item, "order_id"),
                "seller_id": seller.get("id"),
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
            "transaction_id": _lookup(
                item, "transaction_id", "transaction_number", "finance_id", "id"
            ),
            "order_id": _lookup(item, "order_id", "order_sn"),
            "seller_id": seller.get("id"),
            "currency": _lookup(item, "currency"),
            "revenue": _lookup(item, "revenue", "gross_revenue", "amount"),
            "fees": _lookup(item, "fees", "platform_fees", "commission_fee"),
            "refund_amount": _lookup(item, "refund_amount", "buyer_refund_amount"),
            "net_amount": _lookup(item, "net_amount", "settlement_amount"),
            "finance_time": _lookup(
                item, "finance_time", "transaction_date", "settlement_time", "create_time"
            ),
            "status": _lookup(item, "status"),
        }

    def _flatten_order(
        self, order: Dict[str, Any], seller: Dict[str, Any], sales_overview: bool
    ) -> Dict[str, Any]:
        payment = order.get("payment") or {}
        total = order.get("total_amount") or payment.get("total_amount")
        currency = _money_currency(total) or _lookup(order, "currency")
        row = {
            "order_id": _lookup(order, "order_id", "order_sn", "id"),
            "create_time": _lookup(order, "create_time", "order_create_time"),
            "update_time": _lookup(order, "update_time"),
            "seller_id": seller.get("id"),
            "region": seller.get("region"),
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
        line_items = _as_list(
            order.get("line_items") or order.get("items") or order.get("item_list")
        )
        subtotal = order.get("subtotal") or payment.get("subtotal")
        return {
            "order_create_time": row["create_time"],
            "order_id": row["order_id"],
            "seller_id": row["seller_id"],
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
        self, order: Dict[str, Any], seller: Dict[str, Any]
    ) -> Dict[str, Any]:
        rows = _as_list(order.get("line_items") or order.get("items") or order.get("item_list"))
        item = rows[0] if rows and isinstance(rows[0], dict) else order
        price = item.get("sale_price") or item.get("item_price") or item.get("price")
        return {
            "order_id": _lookup(order, "order_id", "order_sn", "id"),
            "order_create_time": _lookup(order, "create_time", "order_create_time"),
            "seller_id": seller.get("id"),
            "product_id": _lookup(item, "product_id", "item_id"),
            "sku_id": _lookup(item, "sku_id", "model_id"),
            "seller_sku": _lookup(item, "seller_sku", "model_sku", "item_sku", "sku"),
            "product_name": _lookup(item, "product_name", "item_name", "name", "title"),
            "sku_name": _lookup(item, "sku_name", "model_name", "variation"),
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
        self, product: Dict[str, Any], seller: Dict[str, Any], inventory: bool
    ) -> Dict[str, Any]:
        skus = _as_list(product.get("skus") or product.get("sku_list") or product.get("models"))
        sku = skus[0] if skus and isinstance(skus[0], dict) else product
        stock = sku.get("stock_infos") or sku.get("inventory") or sku.get("stock_info") or {}
        if isinstance(stock, list):
            stock = stock[0] if stock and isinstance(stock[0], dict) else {}
        price = sku.get("price") or product.get("price")
        if inventory:
            return {
                "seller_id": seller.get("id"),
                "product_id": _lookup(product, "product_id", "item_id", "id"),
                "product_name": _lookup(product, "title", "product_name", "item_name"),
                "sku_id": _lookup(sku, "sku_id", "model_id", "id"),
                "seller_sku": _lookup(sku, "seller_sku", "model_sku", "item_sku", "sku"),
                "sku_name": _lookup(sku, "sku_name", "model_name", "name"),
                "available_stock": _lookup(stock, "available_stock", "normal_stock", "quantity"),
                "reserved_stock": _lookup(stock, "reserved_stock"),
                "warehouse_id": _lookup(stock, "warehouse_id"),
                "update_time": _lookup(product, "update_time"),
            }
        return {
            "product_id": _lookup(product, "product_id", "item_id", "id"),
            "title": _lookup(product, "title", "product_name", "item_name"),
            "status": _lookup(product, "status", "item_status"),
            "seller_id": seller.get("id"),
            "category_name": _lookup(product, "category_name"),
            "brand_name": _lookup(product, "brand_name"),
            "seller_sku": _lookup(sku, "seller_sku", "model_sku", "item_sku", "sku"),
            "sku_id": _lookup(sku, "sku_id", "model_id", "id"),
            "sku_name": _lookup(sku, "sku_name", "model_name", "name"),
            "currency": _money_currency(price),
            "price": _money_amount(price),
            "available_stock": _lookup(stock, "available_stock", "normal_stock", "quantity"),
            "sales_count": _lookup(product, "sales_count"),
        }


class LazadaSellerConnectorService:
    def __init__(self, adapter: Optional[LazadaSellerAdapter] = None):
        self.adapter = adapter or LazadaSellerAdapter()

    def _lazada_config(self) -> Dict[str, str]:
        cfg = getattr(config, "lazada_seller", None)
        return {
            "app_key": (getattr(cfg, "app_key", "") if cfg else "")
            or os.environ.get("LAZADA_APP_KEY", ""),
            "app_secret": (getattr(cfg, "app_secret", "") if cfg else "")
            or os.environ.get("LAZADA_APP_SECRET", ""),
            "redirect_uri": (getattr(cfg, "redirect_uri", "") if cfg else "")
            or os.environ.get("LAZADA_REDIRECT_URI", ""),
            "auth_base_url": (getattr(cfg, "auth_base_url", "") if cfg else "")
            or os.environ.get("LAZADA_AUTH_BASE_URL", DEFAULT_AUTH_BASE_URL),
            "default_region": (getattr(cfg, "default_region", "") if cfg else "")
            or os.environ.get("LAZADA_DEFAULT_REGION", "VN"),
        }

    def _region_api_base_url(self, region: str) -> str:
        return REGION_API_ENDPOINTS[_normalize_region(region)]

    def _make_state_payload(self, user_id: str, region: str) -> str:
        cfg = self._lazada_config()
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
        cfg = self._lazada_config()
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
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
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
            provider=LAZADA_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str, region: str = "VN") -> str:
        cfg = self._lazada_config()
        selected_region = _normalize_region(region or cfg["default_region"])
        if not cfg["app_key"] or not cfg["app_secret"]:
            raise ValueError("Lazada Seller app credentials are not configured.")
        state = self._make_state_payload(user_id, selected_region)
        record = (
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
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
        params: Dict[str, Any] = {
            "client_id": cfg["app_key"],
            "response_type": "code",
            "force_auth": "true",
            "state": state,
            "country": selected_region.lower(),
        }
        if cfg["redirect_uri"]:
            params["redirect_uri"] = cfg["redirect_uri"]
        return f"{cfg['auth_base_url'].rstrip('/')}/oauth/authorize?{urlencode(params)}"

    async def handle_oauth_callback(
        self, code: str, state: str
    ) -> None:
        cfg = self._lazada_config()
        if not cfg["app_key"] or not cfg["app_secret"]:
            raise ValueError("Lazada Seller OAuth credentials are not configured.")
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        region = _normalize_region(payload.get("r"))
        record = (
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        if not pending.pop(state, None):
            raise ValueError("Missing Lazada Seller OAuth state.")
        token_response = await self.adapter.exchange_token(
            auth_base_url=cfg["auth_base_url"],
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
                detail="Lazada Seller OAuth response did not include a refresh token.",
            )
        expires_at = self._expires_at(token_data, "expires_in", 3600)
        refresh_expires_at = self._expires_at(
            token_data, "refresh_expires_in", 180 * 24 * 3600
        )
        sellers = self._sellers_from_token(token_data, region)
        primary_seller_id = sellers[0]["id"] if sellers else str(
            token_data.get("seller_id") or token_data.get("account_id") or "all"
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
                "account_id": token_data.get("account_id") or primary_seller_id,
                "account_name": token_data.get("account")
                or record.get("account_name")
                or "Lazada Seller",
                "region": region,
                "auth_base_url": cfg["auth_base_url"],
                "sellers": sellers
                or [{"id": primary_seller_id, "name": "Lazada Seller", "region": region}],
                "pending_oauth_states": pending,
                "connected_at": _now_iso(),
            },
        )

    def _sellers_from_token(
        self, token_data: Dict[str, Any], fallback_region: str
    ) -> List[Dict[str, Any]]:
        raw_sellers = token_data.get("country_user_info")
        sellers: List[Dict[str, Any]] = []
        if isinstance(raw_sellers, list):
            for item in raw_sellers:
                if not isinstance(item, dict):
                    continue
                seller_id = str(item.get("seller_id") or item.get("user_id") or "")
                if not seller_id:
                    continue
                region = _normalize_region(item.get("country") or fallback_region)
                sellers.append(
                    {
                        "id": seller_id,
                        "name": f"Lazada Seller {seller_id}",
                        "region": region,
                    }
                )
        return sellers

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
        cfg = self._lazada_config()
        record = record or (
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
        )
        access_token, current = await self._access_token(user_id, record)
        sellers = current.get("sellers") if isinstance(current.get("sellers"), list) else []
        primary_seller_id = str((sellers[0] or {}).get("id") or "") if sellers else ""
        selected_region = _normalize_region(current.get("region") or cfg["default_region"])
        return {
            "api_base_url": self._region_api_base_url(selected_region),
            "app_key": cfg["app_key"],
            "app_secret": cfg["app_secret"],
            "access_token": access_token,
            "region": selected_region,
            "sellers": sellers,
            "seller_id": primary_seller_id,
        }

    async def _access_token(
        self, user_id: str, record: Optional[Dict[str, Any]] = None
    ) -> Tuple[str, Dict[str, Any]]:
        record = record or (
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
        )
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(status_code=401, detail="Lazada Seller is not connected.")
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
        cfg = self._lazada_config()
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(
                status_code=401,
                detail="Lazada Seller refresh token is missing. Please reconnect.",
            )
        sellers = record.get("sellers") if isinstance(record.get("sellers"), list) else []
        seller_id = str((sellers[0] or {}).get("id") or "") if sellers else ""
        token_response = await self.adapter.refresh_token(
            auth_base_url=str(record.get("auth_base_url") or cfg["auth_base_url"]),
            app_key=cfg["app_key"],
            app_secret=cfg["app_secret"],
            refresh_token=_decrypt_secret(str(encrypted_refresh)),
        )
        token_data = self._token_data(token_response)
        access_token = str(token_data.get("access_token") or "")
        if not access_token:
            raise HTTPException(status_code=401, detail="Lazada Seller token refresh failed.")
        refresh_token = str(token_data.get("refresh_token") or "")
        metadata = {
            "encrypted_access_token": _encrypt_secret(access_token),
            "expires_at": self._expires_at(token_data, "expires_in", 3600),
        }
        if refresh_token:
            metadata["encrypted_refresh_token"] = _encrypt_secret(refresh_token)
            metadata["refresh_expires_at"] = self._expires_at(
                token_data, "refresh_expires_in", 180 * 24 * 3600
            )
        updated = self._save_metadata(
            user_id,
            metadata,
        )
        return access_token, updated

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
        )
        return {
            "connected": bool(record.get("encrypted_refresh_token")),
            "account_id": record.get("account_id"),
            "account_name": record.get("account_name") or "Lazada Seller",
            "region": record.get("region"),
            "sellers": record.get("sellers") or [],
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, LAZADA_PROVIDER)

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
        )
        if not record.get("encrypted_refresh_token"):
            raise HTTPException(status_code=401, detail="Lazada Seller is not connected.")
        sellers = record.get("sellers") or []
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
                "finance",
            ]
        ]
        return {"reports": reports, "sellers": sellers, "regions": SUPPORTED_REGIONS}

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "lazada_seller":
            raise HTTPException(status_code=400, detail="Invalid Lazada Seller entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Lazada Seller report type")
        return {
            "report_type": report_type,
            "seller_id": parts[2] or "all",
            "region": _normalize_region(parts[3] or "VN"),
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, seller_id: str, region: str
    ) -> Dict[str, Any]:
        account_name = str(record.get("account_name") or "Lazada Seller")
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        return {
            "id": f"lazada_seller:{report_type}:{seller_id or 'all'}:{region}",
            "name": f"{account_name} / {label}",
            "type": "report",
            "account_name": account_name,
            "account_id": record.get("account_id") or "all",
            "seller_id": seller_id or "all",
            "region": region,
            "report_type": report_type,
            "connector_key": "lazada_seller",
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
            cfg.setdefault("seller_id", parsed["seller_id"])
            cfg.setdefault("region", parsed["region"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "sales_overview"),
            date_preset=cfg.get("date_preset"),
            start_date=cfg.get("start_date"),
            end_date=cfg.get("end_date"),
            row_limit=cfg.get("row_limit"),
            seller_id=str(cfg.get("seller_id") or "all"),
            region=str(cfg.get("region") or "VN"),
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
        seller_id: str = "all",
        region: str = "VN",
        include_pii: bool = False,
        max_bytes: Any = None,
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid report_type. Must be sales_overview, orders, order_items, "
                    "products, inventory, returns, or finance."
                ),
            )
        if include_pii:
            raise HTTPException(
                status_code=400,
                detail="Lazada Seller v1 does not support buyer PII export.",
            )
        selected_region = _normalize_region(region)
        record = (
            connected_accounts_repo.get_connection(user_id, LAZADA_PROVIDER) or {}
        )
        if not record.get("encrypted_refresh_token"):
            raise HTTPException(status_code=401, detail="Lazada Seller is not connected.")
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        sellers = self._resolve_sellers(record, seller_id, selected_region)
        ctx = await self._api_context(user_id, record)
        export = await self.adapter.fetch_report_rows(
            ctx=ctx,
            report_type=report_type,
            sellers=sellers,
            date_window=date_window,
            row_limit=row_cap,
        )
        headers = REPORT_HEADERS[report_type]
        rows = list(export.get("rows") or [])[:row_cap]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="Lazada Seller extract exceeded the configured byte cap.",
            )
        return self._save_lazada_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            seller_id=seller_id or "all",
            sellers=sellers,
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

    def _resolve_sellers(
        self, record: Dict[str, Any], seller_id: str, region: str
    ) -> List[Dict[str, Any]]:
        sellers = record.get("sellers")
        if isinstance(sellers, list):
            normalized = [
                {
                    "id": str(item.get("id") or item.get("seller_id") or ""),
                    "name": item.get("name") or item.get("seller_name") or "Lazada Seller",
                    "region": _normalize_region(item.get("region") or region),
                }
                for item in sellers
                if item.get("id") or item.get("seller_id")
            ]
            if seller_id and seller_id != "all":
                matched = [item for item in normalized if item["id"] == seller_id]
                if matched:
                    return matched
                raise HTTPException(status_code=400, detail="Unknown Lazada Seller seller_id.")
            if normalized:
                return normalized
        return [{"id": seller_id or "all", "name": "Lazada Seller", "region": region}]

    def _save_lazada_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        report_type: str,
        seller_id: str,
        sellers: Sequence[Dict[str, Any]],
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
        entity = self._selected_entity(record, report_type, seller_id, region)
        seller_ids = [str(seller.get("id") or "") for seller in sellers if seller.get("id")]
        manifest = {
            "connector_key": "lazada_seller",
            "source_type": "lazada_seller",
            "account_id": record.get("account_id"),
            "account_name": record.get("account_name") or "Lazada Seller",
            "region": region,
            "seller_id": seller_id,
            "seller_ids": seller_ids,
            "report_type": report_type,
            "api_base_url": REGION_API_ENDPOINTS[region],
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
            f"lazada_seller_{_sanitize_filename_part(report_type)}_"
            f"{date_window['from']}_{date_window['to']}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=LAZADA_ASSET_TYPE,
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
            user_id=user_id, provider=LAZADA_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "lazada_seller",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "lazada_report_type": report_type,
                "lazada_region": region,
                "lazada_manifest_s3_key": manifest_key,
                "lazada_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": (
                f"Successfully synced {len(rows)} rows from Lazada Seller "
                f"({entity['name']})."
            ),
            "asset": updated or asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "entity_id": entity["id"],
            "truncated": truncated,
            "api_mode": api_mode,
        }


lazada_seller_service = LazadaSellerConnectorService()
