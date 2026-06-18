import asyncio
import base64
import csv
import gzip
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
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
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


AMAZON_SELLER_PROVIDER = "amazon_seller"
AMAZON_SELLER_ASSET_TYPE = "integration_amazon_seller"
LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024

REGION_CONFIG = {
    "NA": {
        "endpoint": "https://sellingpartnerapi-na.amazon.com",
        "aws_region": "us-east-1",
        "authorize_url": "https://sellercentral.amazon.com/apps/authorize/consent",
        "marketplaces": [
            {"id": "ATVPDKIKX0DER", "name": "Amazon.com", "country_code": "US"},
            {"id": "A2EUQ1WTGCTBG2", "name": "Amazon.ca", "country_code": "CA"},
            {"id": "A1AM78C64UM0Y8", "name": "Amazon.com.mx", "country_code": "MX"},
            {"id": "A2Q3Y263D00KWC", "name": "Amazon.com.br", "country_code": "BR"},
        ],
    },
    "EU": {
        "endpoint": "https://sellingpartnerapi-eu.amazon.com",
        "aws_region": "eu-west-1",
        "authorize_url": "https://sellercentral-europe.amazon.com/apps/authorize/consent",
        "marketplaces": [
            {"id": "A1F83G8C2ARO7P", "name": "Amazon.co.uk", "country_code": "GB"},
            {"id": "A1PA6795UKMFR9", "name": "Amazon.de", "country_code": "DE"},
            {"id": "A13V1IB3VIYZZH", "name": "Amazon.fr", "country_code": "FR"},
            {"id": "APJ6JRA9NG5V4", "name": "Amazon.it", "country_code": "IT"},
            {"id": "A1RKKUPIHCS9HS", "name": "Amazon.es", "country_code": "ES"},
        ],
    },
    "FE": {
        "endpoint": "https://sellingpartnerapi-fe.amazon.com",
        "aws_region": "us-west-2",
        "authorize_url": "https://sellercentral.amazon.co.jp/apps/authorize/consent",
        "marketplaces": [
            {"id": "A1VC38T7YXB528", "name": "Amazon.co.jp", "country_code": "JP"},
            {"id": "A39IBJ37TRP1C6", "name": "Amazon.com.au", "country_code": "AU"},
            {"id": "A19VAU5U5O7RUS", "name": "Amazon.sg", "country_code": "SG"},
        ],
    },
}

VALID_REPORT_TYPES = {
    "sales_overview",
    "orders",
    "order_items",
    "inventory",
    "listings",
    "returns",
}

REPORT_LABELS = {
    "sales_overview": "Sales Overview",
    "orders": "Orders",
    "order_items": "Order Items",
    "inventory": "Inventory",
    "listings": "Listings",
    "returns": "Returns",
}

REPORT_TYPE_VALUES = {
    "sales_overview": "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
    "orders": "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
    "order_items": "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
    "inventory": "GET_MERCHANT_LISTINGS_ALL_DATA",
    "listings": "GET_MERCHANT_LISTINGS_DATA",
    "returns": "GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA",
}

REPORT_HEADERS = {
    "sales_overview": [
        "purchase_date",
        "amazon_order_id",
        "marketplace_id",
        "order_status",
        "fulfillment_channel",
        "sales_channel",
        "currency",
        "item_total",
        "item_tax",
        "shipping_price",
        "promotion_discount",
        "order_total",
        "number_of_items_shipped",
        "number_of_items_unshipped",
        "is_business_order",
        "buyer_email",
        "buyer_name",
        "ship_city",
        "ship_state",
        "ship_postal_code",
        "ship_country",
    ],
    "orders": [
        "amazon_order_id",
        "purchase_date",
        "last_update_date",
        "marketplace_id",
        "order_status",
        "fulfillment_channel",
        "sales_channel",
        "ship_service_level",
        "currency",
        "order_total",
        "number_of_items_shipped",
        "number_of_items_unshipped",
        "payment_method",
        "is_replacement_order",
        "is_business_order",
        "buyer_email",
        "buyer_name",
        "ship_city",
        "ship_state",
        "ship_postal_code",
        "ship_country",
    ],
    "order_items": [
        "amazon_order_id",
        "purchase_date",
        "marketplace_id",
        "asin",
        "seller_sku",
        "title",
        "quantity_ordered",
        "quantity_shipped",
        "currency",
        "item_price",
        "item_tax",
        "shipping_price",
        "promotion_discount",
        "condition_id",
        "is_gift",
    ],
    "inventory": [
        "seller_sku",
        "asin",
        "product_name",
        "quantity",
        "price",
        "currency",
        "fulfillment_channel",
        "status",
    ],
    "listings": [
        "seller_sku",
        "asin",
        "product_name",
        "status",
        "price",
        "currency",
        "quantity",
        "item_condition",
    ],
    "returns": [
        "return_date",
        "amazon_order_id",
        "asin",
        "seller_sku",
        "fnsku",
        "product_name",
        "quantity",
        "fulfillment_center_id",
        "detailed_disposition",
        "reason",
        "status",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _normalize_region(value: Any) -> str:
    region = str(value or "NA").strip().upper()
    if region not in REGION_CONFIG:
        raise HTTPException(status_code=400, detail="region must be NA, EU, or FE")
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


def _as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _money_amount(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("Amount") or value.get("amount") or "")
    return str(value or "")


def _money_currency(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("CurrencyCode") or value.get("currencyCode") or "")
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


def _window_days(date_window: Dict[str, str]) -> int:
    try:
        start = date.fromisoformat(date_window["from"])
        end = date.fromisoformat(date_window["to"])
        return max(1, (end - start).days + 1)
    except Exception:
        return 30


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


class AmazonSellerAdapter:
    async def exchange_token(
        self,
        *,
        client_id: str,
        client_secret: str,
        code: str,
        redirect_uri: str,
    ) -> Dict[str, Any]:
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
        }
        if redirect_uri:
            data["redirect_uri"] = redirect_uri
        return await self._token_request(data)

    async def refresh_token(
        self, *, client_id: str, client_secret: str, refresh_token: str
    ) -> Dict[str, Any]:
        return await self._token_request(
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            }
        )

    async def _token_request(self, data: Dict[str, str]) -> Dict[str, Any]:
        headers = {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(LWA_TOKEN_URL, data=data, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def _signed_headers(
        self,
        *,
        method: str,
        url: str,
        aws_region: str,
        access_key: str,
        secret_key: str,
        lwa_access_token: str,
        body: bytes,
    ) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "DreamifyAmazonSellerConnector/1.0",
            "x-amz-access-token": lwa_access_token,
        }
        if body:
            headers["Content-Type"] = "application/json"
        request = AWSRequest(method=method, url=url, data=body or None, headers=headers)
        SigV4Auth(
            Credentials(access_key, secret_key), "execute-api", aws_region
        ).add_auth(request)
        return dict(request.headers.items())

    async def sp_api_request(
        self,
        *,
        method: str,
        endpoint: str,
        aws_region: str,
        access_key: str,
        secret_key: str,
        lwa_access_token: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        base_url = f"{endpoint.rstrip('/')}{path}"
        query = urlencode(params or {}, doseq=True)
        url = f"{base_url}?{query}" if query else base_url
        body = (
            json.dumps(json_body, separators=(",", ":")).encode("utf-8")
            if json_body is not None
            else b""
        )
        last_error: Optional[Exception] = None
        async with httpx.AsyncClient(timeout=90.0) as client:
            for attempt in range(max_attempts):
                headers = self._signed_headers(
                    method=method,
                    url=url,
                    aws_region=aws_region,
                    access_key=access_key,
                    secret_key=secret_key,
                    lwa_access_token=lwa_access_token,
                    body=body,
                )
                response = await client.request(method, url, content=body, headers=headers)
                if response.status_code in {429, 503} and attempt < max_attempts - 1:
                    await self._sleep(self._retry_delay(response, attempt))
                    continue
                try:
                    response.raise_for_status()
                    return response.json() if response.content else {}
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

    async def fetch_marketplaces(self, ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
        try:
            payload = await self.sp_api_request(
                method="GET",
                path="/sellers/v1/marketplaceParticipations",
                params=None,
                **ctx,
            )
            marketplaces: List[Dict[str, Any]] = []
            for item in payload.get("payload") or []:
                marketplace = item.get("marketplace") or {}
                marketplace_id = str(marketplace.get("id") or "")
                if not marketplace_id:
                    continue
                marketplaces.append(
                    {
                        "id": marketplace_id,
                        "name": marketplace.get("name") or marketplace_id,
                        "country_code": marketplace.get("countryCode") or "",
                    }
                )
            if marketplaces:
                return marketplaces
        except Exception as exc:
            logger.info("Amazon Seller marketplace lookup failed: %s", exc)
        return list(REGION_CONFIG[ctx["selling_region"]]["marketplaces"])

    async def fetch_orders(
        self,
        *,
        ctx: Dict[str, Any],
        marketplace_ids: Sequence[str],
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        next_token = ""
        endpoints = ["/orders/v0/orders"]
        while len(rows) < row_limit:
            params: Dict[str, Any] = (
                {"NextToken": next_token}
                if next_token
                else {
                    "MarketplaceIds": ",".join(marketplace_ids),
                    "CreatedAfter": f"{date_window['from']}T00:00:00Z",
                    "CreatedBefore": f"{date_window['to']}T23:59:59Z",
                    "MaxResultsPerPage": min(row_limit, 100),
                }
            )
            payload = await self.sp_api_request(
                method="GET",
                path="/orders/v0/orders",
                params=params,
                **ctx,
            )
            order_payload = payload.get("payload") or {}
            for order in order_payload.get("Orders") or []:
                rows.append(self._flatten_order(order))
                if len(rows) >= row_limit:
                    break
            next_token = str(order_payload.get("NextToken") or "")
            if not next_token:
                break
        return {
            "rows": rows,
            "api_mode": "orders_api",
            "truncated": len(rows) >= row_limit and bool(next_token),
            "api_endpoints_used": endpoints,
            "report_ids": [],
            "report_document_ids": [],
        }

    async def create_report(
        self,
        *,
        ctx: Dict[str, Any],
        report_type_value: str,
        marketplace_ids: Sequence[str],
        date_window: Dict[str, str],
    ) -> str:
        payload = await self.sp_api_request(
            method="POST",
            path="/reports/2021-06-30/reports",
            json_body={
                "reportType": report_type_value,
                "marketplaceIds": list(marketplace_ids),
                "dataStartTime": f"{date_window['from']}T00:00:00Z",
                "dataEndTime": f"{date_window['to']}T23:59:59Z",
            },
            **ctx,
        )
        report_id = str(payload.get("reportId") or "")
        if not report_id:
            raise HTTPException(502, "Amazon Reports API did not return reportId.")
        return report_id

    async def wait_for_report(
        self, *, ctx: Dict[str, Any], report_id: str, max_attempts: int = 20
    ) -> Dict[str, Any]:
        terminal_failures = {"CANCELLED", "FATAL"}
        for attempt in range(max_attempts):
            payload = await self.sp_api_request(
                method="GET",
                path=f"/reports/2021-06-30/reports/{report_id}",
                **ctx,
            )
            status = str(payload.get("processingStatus") or "").upper()
            if status == "DONE":
                return payload
            if status in terminal_failures:
                raise HTTPException(502, f"Amazon report ended with {status}.")
            await self._sleep(min(2.0 + attempt, 10.0))
        raise HTTPException(504, "Amazon report polling timed out.")

    async def download_report_document(
        self, *, ctx: Dict[str, Any], report_document_id: str
    ) -> bytes:
        payload = await self.sp_api_request(
            method="GET",
            path=f"/reports/2021-06-30/documents/{report_document_id}",
            **ctx,
        )
        url = str(payload.get("url") or "")
        if not url:
            raise HTTPException(502, "Amazon report document did not include a URL.")
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(url)
        response.raise_for_status()
        content = response.content
        if str(payload.get("compressionAlgorithm") or "").upper() == "GZIP":
            content = gzip.decompress(content)
        return content

    async def fetch_report_rows(
        self,
        *,
        ctx: Dict[str, Any],
        report_type: str,
        marketplace_ids: Sequence[str],
        date_window: Dict[str, str],
        row_limit: int,
    ) -> Dict[str, Any]:
        if report_type in {"sales_overview", "orders"} and _window_days(date_window) <= 14:
            export = await self.fetch_orders(
                ctx=ctx,
                marketplace_ids=marketplace_ids,
                date_window=date_window,
                row_limit=row_limit,
            )
            if report_type == "sales_overview":
                export["rows"] = [self._sales_overview_from_order(row) for row in export["rows"]]
            return export

        report_id = await self.create_report(
            ctx=ctx,
            report_type_value=REPORT_TYPE_VALUES[report_type],
            marketplace_ids=marketplace_ids,
            date_window=date_window,
        )
        report = await self.wait_for_report(ctx=ctx, report_id=report_id)
        document_id = str(report.get("reportDocumentId") or "")
        if not document_id:
            return {
                "rows": [],
                "api_mode": "reports_api",
                "truncated": False,
                "api_endpoints_used": [
                    "/reports/2021-06-30/reports",
                    f"/reports/2021-06-30/reports/{report_id}",
                ],
                "report_ids": [report_id],
                "report_document_ids": [],
            }
        content = await self.download_report_document(
            ctx=ctx, report_document_id=document_id
        )
        parsed_rows = self.parse_report_document(content)
        rows = [self._flatten_report_row(report_type, row) for row in parsed_rows]
        return {
            "rows": rows[:row_limit],
            "api_mode": "reports_api",
            "truncated": len(rows) > row_limit,
            "api_endpoints_used": [
                "/reports/2021-06-30/reports",
                f"/reports/2021-06-30/reports/{report_id}",
                f"/reports/2021-06-30/documents/{document_id}",
            ],
            "report_ids": [report_id],
            "report_document_ids": [document_id],
        }

    def parse_report_document(self, content: bytes) -> List[Dict[str, Any]]:
        text = content.decode("utf-8-sig", errors="replace").strip()
        if not text:
            return []
        if text.startswith("[") or text.startswith("{"):
            payload = json.loads(text)
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, dict)]
            if isinstance(payload, dict):
                for key in ("data", "rows", "payload"):
                    value = payload.get(key)
                    if isinstance(value, list):
                        return [item for item in value if isinstance(item, dict)]
                return [payload]
        sample = text[:4096]
        delimiter = "\t" if sample.count("\t") >= sample.count(",") else ","
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        return [dict(row) for row in reader]

    def _flatten_order(self, order: Dict[str, Any]) -> Dict[str, Any]:
        order_total = order.get("OrderTotal") or {}
        return {
            "amazon_order_id": order.get("AmazonOrderId"),
            "purchase_date": order.get("PurchaseDate"),
            "last_update_date": order.get("LastUpdateDate"),
            "marketplace_id": order.get("MarketplaceId"),
            "order_status": order.get("OrderStatus"),
            "fulfillment_channel": order.get("FulfillmentChannel"),
            "sales_channel": order.get("SalesChannel"),
            "ship_service_level": order.get("ShipServiceLevel"),
            "currency": order_total.get("CurrencyCode"),
            "order_total": order_total.get("Amount"),
            "number_of_items_shipped": order.get("NumberOfItemsShipped"),
            "number_of_items_unshipped": order.get("NumberOfItemsUnshipped"),
            "payment_method": order.get("PaymentMethod"),
            "is_replacement_order": order.get("IsReplacementOrder"),
            "is_business_order": order.get("IsBusinessOrder"),
            "buyer_email": "",
            "buyer_name": "",
            "ship_city": "",
            "ship_state": "",
            "ship_postal_code": "",
            "ship_country": "",
        }

    def _sales_overview_from_order(self, order: Dict[str, Any]) -> Dict[str, Any]:
        total = _as_float(order.get("order_total"))
        return {
            "purchase_date": order.get("purchase_date"),
            "amazon_order_id": order.get("amazon_order_id"),
            "marketplace_id": order.get("marketplace_id"),
            "order_status": order.get("order_status"),
            "fulfillment_channel": order.get("fulfillment_channel"),
            "sales_channel": order.get("sales_channel"),
            "currency": order.get("currency"),
            "item_total": total,
            "item_tax": "",
            "shipping_price": "",
            "promotion_discount": "",
            "order_total": total,
            "number_of_items_shipped": order.get("number_of_items_shipped"),
            "number_of_items_unshipped": order.get("number_of_items_unshipped"),
            "is_business_order": order.get("is_business_order"),
            "buyer_email": "",
            "buyer_name": "",
            "ship_city": "",
            "ship_state": "",
            "ship_postal_code": "",
            "ship_country": "",
        }

    def _flatten_report_row(self, report_type: str, row: Dict[str, Any]) -> Dict[str, Any]:
        if report_type in {"sales_overview", "orders"}:
            order_total = _lookup(row, "order_total", "item_price", "item_price_amount")
            base = {
                "amazon_order_id": _lookup(row, "amazon_order_id", "order_id"),
                "purchase_date": _lookup(row, "purchase_date", "payments_date"),
                "last_update_date": _lookup(row, "last_update_date"),
                "marketplace_id": _lookup(row, "marketplace_id", "sales_channel"),
                "order_status": _lookup(row, "order_status", "order_status_code"),
                "fulfillment_channel": _lookup(row, "fulfillment_channel"),
                "sales_channel": _lookup(row, "sales_channel"),
                "ship_service_level": _lookup(row, "ship_service_level"),
                "currency": _lookup(row, "currency", "currency_code"),
                "order_total": order_total,
                "number_of_items_shipped": _lookup(row, "quantity", "number_of_items_shipped"),
                "number_of_items_unshipped": _lookup(row, "number_of_items_unshipped"),
                "payment_method": _lookup(row, "payment_method"),
                "is_replacement_order": _lookup(row, "is_replacement_order"),
                "is_business_order": _lookup(row, "is_business_order"),
                "buyer_email": "",
                "buyer_name": "",
                "ship_city": "",
                "ship_state": "",
                "ship_postal_code": "",
                "ship_country": "",
            }
            if report_type == "sales_overview":
                return {**self._sales_overview_from_order(base), "item_total": order_total}
            return base
        if report_type == "order_items":
            return {
                "amazon_order_id": _lookup(row, "amazon_order_id", "order_id"),
                "purchase_date": _lookup(row, "purchase_date"),
                "marketplace_id": _lookup(row, "marketplace_id", "sales_channel"),
                "asin": _lookup(row, "asin"),
                "seller_sku": _lookup(row, "sku", "seller_sku"),
                "title": _lookup(row, "product_name", "item_name", "title"),
                "quantity_ordered": _lookup(row, "quantity", "quantity_ordered"),
                "quantity_shipped": _lookup(row, "quantity_shipped"),
                "currency": _lookup(row, "currency", "currency_code"),
                "item_price": _lookup(row, "item_price", "item_price_amount"),
                "item_tax": _lookup(row, "item_tax", "item_tax_amount"),
                "shipping_price": _lookup(row, "shipping_price", "shipping_price_amount"),
                "promotion_discount": _lookup(row, "promotion_discount"),
                "condition_id": _lookup(row, "condition_id"),
                "is_gift": _lookup(row, "is_gift"),
            }
        if report_type in {"inventory", "listings"}:
            return {
                "seller_sku": _lookup(row, "seller_sku", "sku"),
                "asin": _lookup(row, "asin", "product_id"),
                "product_name": _lookup(row, "product_name", "item_name", "title"),
                "quantity": _lookup(row, "quantity", "afn_total_quantity"),
                "price": _lookup(row, "price", "standard_price"),
                "currency": _lookup(row, "currency", "currency_code"),
                "fulfillment_channel": _lookup(row, "fulfillment_channel"),
                "status": _lookup(row, "status", "item_is_marketplace"),
                "item_condition": _lookup(row, "item_condition", "condition"),
            }
        return {
            "return_date": _lookup(row, "return_date", "return_request_date"),
            "amazon_order_id": _lookup(row, "amazon_order_id", "order_id"),
            "asin": _lookup(row, "asin"),
            "seller_sku": _lookup(row, "seller_sku", "sku"),
            "fnsku": _lookup(row, "fnsku"),
            "product_name": _lookup(row, "product_name", "title"),
            "quantity": _lookup(row, "quantity"),
            "fulfillment_center_id": _lookup(row, "fulfillment_center_id"),
            "detailed_disposition": _lookup(row, "detailed_disposition"),
            "reason": _lookup(row, "reason"),
            "status": _lookup(row, "status"),
        }


class AmazonSellerConnectorService:
    def __init__(self, adapter: Optional[AmazonSellerAdapter] = None):
        self.adapter = adapter or AmazonSellerAdapter()

    def _amazon_config(self) -> Dict[str, str]:
        cfg = getattr(config, "amazon_seller", None)
        return {
            "client_id": (getattr(cfg, "client_id", "") if cfg else "")
            or os.environ.get("AMAZON_SELLER_CLIENT_ID", ""),
            "client_secret": (getattr(cfg, "client_secret", "") if cfg else "")
            or os.environ.get("AMAZON_SELLER_CLIENT_SECRET", ""),
            "redirect_uri": (getattr(cfg, "redirect_uri", "") if cfg else "")
            or os.environ.get("AMAZON_SELLER_REDIRECT_URI", ""),
            "aws_access_key_id": (
                getattr(cfg, "aws_access_key_id", "") if cfg else ""
            )
            or os.environ.get("AMAZON_SELLER_AWS_ACCESS_KEY_ID", ""),
            "aws_secret_access_key": (
                getattr(cfg, "aws_secret_access_key", "") if cfg else ""
            )
            or os.environ.get("AMAZON_SELLER_AWS_SECRET_ACCESS_KEY", ""),
            "role_arn": (getattr(cfg, "role_arn", "") if cfg else "")
            or os.environ.get("AMAZON_SELLER_ROLE_ARN", ""),
            "default_region": (getattr(cfg, "default_region", "") if cfg else "")
            or os.environ.get("AMAZON_SELLER_DEFAULT_REGION", "NA"),
        }

    def _make_state_payload(self, user_id: str, region: str) -> str:
        cfg = self._amazon_config()
        secret = cfg["client_secret"] or config.app.secret_key
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
        cfg = self._amazon_config()
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
            payload["r"] = _normalize_region(payload.get("r"))
            return payload
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Invalid state format") from exc

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
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
                "user_id",
                "provider",
                "updated_at",
            }
        }
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=AMAZON_SELLER_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str, region: str = "NA") -> str:
        cfg = self._amazon_config()
        selling_region = _normalize_region(region or cfg["default_region"])
        if not cfg["client_id"]:
            raise ValueError("Amazon Seller client_id is not configured.")
        state = self._make_state_payload(user_id, selling_region)
        record = (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
            or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        now = int(datetime.now(timezone.utc).timestamp())
        pending[state] = {"region": selling_region, "created_at": now}
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
        params = urlencode({"application_id": cfg["client_id"], "state": state})
        return f"{REGION_CONFIG[selling_region]['authorize_url']}?{params}"

    async def handle_oauth_callback(
        self, code: str, state: str, selling_partner_id: Optional[str] = None
    ) -> None:
        cfg = self._amazon_config()
        if not cfg["client_id"] or not cfg["client_secret"]:
            raise ValueError("Amazon Seller OAuth credentials are not configured.")
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        selling_region = _normalize_region(payload.get("r"))
        record = (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
            or {}
        )
        pending = dict(record.get("pending_oauth_states") or {})
        if not pending.pop(state, None):
            raise ValueError("Missing Amazon Seller OAuth state.")
        token_data = await self.adapter.exchange_token(
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            code=code,
            redirect_uri=cfg["redirect_uri"],
        )
        access_token = str(token_data.get("access_token") or "")
        refresh_token = str(token_data.get("refresh_token") or "")
        if not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="Amazon OAuth response did not include a refresh token.",
            )
        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(seconds=int(token_data.get("expires_in") or 3600))
        ).isoformat()
        base_marketplaces = list(REGION_CONFIG[selling_region]["marketplaces"])
        metadata = self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token)
                if access_token
                else "",
                "encrypted_refresh_token": _encrypt_secret(refresh_token),
                "expires_at": expires_at,
                "seller_id": selling_partner_id or record.get("seller_id") or "all",
                "seller_name": record.get("seller_name") or "Amazon Seller",
                "selling_region": selling_region,
                "sp_api_endpoint": REGION_CONFIG[selling_region]["endpoint"],
                "aws_region": REGION_CONFIG[selling_region]["aws_region"],
                "marketplaces": base_marketplaces,
                "pending_oauth_states": pending,
                "connected_at": _now_iso(),
                "scopes": ["sellingpartnerapi::notifications"],
            },
        )
        try:
            ctx = await self._sp_api_context(user_id, metadata)
            marketplaces = await self.adapter.fetch_marketplaces(ctx)
            self._save_metadata(user_id, {"marketplaces": marketplaces})
        except Exception as exc:
            logger.info("Amazon Seller post-connect marketplace lookup failed: %s", exc)

    async def _sp_api_context(
        self, user_id: str, record: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        cfg = self._amazon_config()
        record = record or (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
            or {}
        )
        access_token, current = await self._access_token(user_id, record)
        selling_region = _normalize_region(current.get("selling_region") or "NA")
        region_cfg = REGION_CONFIG[selling_region]
        return {
            "endpoint": str(current.get("sp_api_endpoint") or region_cfg["endpoint"]),
            "aws_region": str(current.get("aws_region") or region_cfg["aws_region"]),
            "access_key": cfg["aws_access_key_id"],
            "secret_key": cfg["aws_secret_access_key"],
            "lwa_access_token": access_token,
            "selling_region": selling_region,
        }

    async def _access_token(
        self, user_id: str, record: Optional[Dict[str, Any]] = None
    ) -> Tuple[str, Dict[str, Any]]:
        record = record or (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
            or {}
        )
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(status_code=401, detail="Amazon Seller is not connected.")
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
        cfg = self._amazon_config()
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(
                status_code=401,
                detail="Amazon Seller refresh token is missing. Please reconnect.",
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
                status_code=401, detail="Amazon Seller token refresh failed."
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
            },
        )
        return access_token, updated

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
            or {}
        )
        return {
            "connected": bool(record.get("encrypted_refresh_token")),
            "seller_id": record.get("seller_id"),
            "seller_name": record.get("seller_name") or "Amazon Seller",
            "selling_region": record.get("selling_region"),
            "marketplaces": record.get("marketplaces") or [],
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, AMAZON_SELLER_PROVIDER)

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        record = (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
            or {}
        )
        if not record.get("encrypted_refresh_token"):
            raise HTTPException(status_code=401, detail="Amazon Seller is not connected.")
        marketplaces = record.get("marketplaces") or REGION_CONFIG[
            _normalize_region(record.get("selling_region") or "NA")
        ]["marketplaces"]
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
                "inventory",
                "listings",
                "returns",
            ]
        ]
        return {"reports": reports, "marketplaces": marketplaces}

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "amazon_seller":
            raise HTTPException(status_code=400, detail="Invalid Amazon Seller entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Amazon Seller report type")
        return {
            "report_type": report_type,
            "seller_id": parts[2] or "all",
            "marketplace_id": parts[3] or "all",
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, marketplace_id: str
    ) -> Dict[str, Any]:
        seller_id = str(record.get("seller_id") or "all")
        seller_name = str(record.get("seller_name") or "Amazon Seller")
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        market = marketplace_id or "all"
        return {
            "id": f"amazon_seller:{report_type}:{seller_id}:{market}",
            "name": f"{seller_name} / {label}",
            "type": "report",
            "account_name": seller_name,
            "seller_id": seller_id,
            "report_type": report_type,
            "marketplace_id": market,
            "connector_key": "amazon_seller",
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
            cfg.setdefault("marketplace_id", parsed["marketplace_id"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "sales_overview"),
            date_preset=cfg.get("date_preset"),
            start_date=cfg.get("start_date"),
            end_date=cfg.get("end_date"),
            row_limit=cfg.get("row_limit"),
            marketplace_id=str(cfg.get("marketplace_id") or "all"),
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
        marketplace_id: str = "all",
        include_pii: bool = False,
        max_bytes: Any = None,
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid report_type. Must be sales_overview, orders, "
                    "order_items, inventory, listings, or returns."
                ),
            )
        if include_pii:
            raise HTTPException(
                status_code=400,
                detail="Amazon Seller v1 does not support restricted buyer PII export.",
            )
        record = (
            connected_accounts_repo.get_connection(user_id, AMAZON_SELLER_PROVIDER)
            or {}
        )
        if not record.get("encrypted_refresh_token"):
            raise HTTPException(status_code=401, detail="Amazon Seller is not connected.")
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        marketplace_ids = self._resolve_marketplaces(record, marketplace_id)
        ctx = await self._sp_api_context(user_id, record)
        export = await self.adapter.fetch_report_rows(
            ctx=ctx,
            report_type=report_type,
            marketplace_ids=marketplace_ids,
            date_window=date_window,
            row_limit=row_cap,
        )
        headers = REPORT_HEADERS[report_type]
        rows = list(export.get("rows") or [])[:row_cap]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="Amazon Seller extract exceeded the configured byte cap.",
            )
        return self._save_amazon_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            marketplace_id=marketplace_id or "all",
            marketplace_ids=marketplace_ids,
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            api_mode=str(export.get("api_mode") or "reports_api"),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("api_endpoints_used") or []),
            report_ids=list(export.get("report_ids") or []),
            report_document_ids=list(export.get("report_document_ids") or []),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _resolve_marketplaces(
        self, record: Dict[str, Any], marketplace_id: str
    ) -> List[str]:
        if marketplace_id and marketplace_id != "all":
            return [marketplace_id]
        marketplaces = record.get("marketplaces")
        if isinstance(marketplaces, list):
            ids = [str(item.get("id") or "") for item in marketplaces if item.get("id")]
            if ids:
                return ids
        region = _normalize_region(record.get("selling_region") or "NA")
        return [str(item["id"]) for item in REGION_CONFIG[region]["marketplaces"]]

    def _save_amazon_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        report_type: str,
        marketplace_id: str,
        marketplace_ids: Sequence[str],
        date_window: Dict[str, str],
        row_limit: int,
        max_bytes: int,
        api_mode: str,
        truncated: bool,
        endpoints_used: Sequence[str],
        report_ids: Sequence[str],
        report_document_ids: Sequence[str],
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
        entity = self._selected_entity(record, report_type, marketplace_id)
        manifest = {
            "connector_key": "amazon_seller",
            "source_type": "amazon_seller",
            "seller_id": record.get("seller_id"),
            "seller_name": record.get("seller_name") or "Amazon Seller",
            "selling_region": record.get("selling_region"),
            "sp_api_endpoint": record.get("sp_api_endpoint"),
            "marketplace_ids": list(marketplace_ids),
            "report_type": report_type,
            "amazon_report_type_value": REPORT_TYPE_VALUES[report_type],
            "amazon_report_ids": list(report_ids),
            "amazon_report_document_ids": list(report_document_ids),
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
            "pii_redacted": True,
            "restricted_data_token_used": False,
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
            f"amazon_seller_{_sanitize_filename_part(report_type)}_"
            f"{date_window['from']}_{date_window['to']}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=AMAZON_SELLER_ASSET_TYPE,
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
            user_id=user_id, provider=AMAZON_SELLER_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "amazon_seller",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "amazon_seller_id": record.get("seller_id"),
                "amazon_seller_report_type": report_type,
                "amazon_seller_manifest_s3_key": manifest_key,
                "amazon_seller_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": (
                f"Successfully synced {len(rows)} rows from Amazon Seller "
                f"({entity['name']})."
            ),
            "asset": updated or asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "entity_id": entity["id"],
            "truncated": truncated,
            "api_mode": api_mode,
        }


amazon_seller_service = AmazonSellerConnectorService()
