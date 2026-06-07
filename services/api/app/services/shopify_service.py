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
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import HTTPException

from app.services.warehouse_service import (
    _encrypt_secret,
    _decrypt_secret,
    _sanitize_filename_part,
)
from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import connected_accounts as connected_accounts_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes
from utils.s3.paths import build_asset_key

logger = logging.getLogger(__name__)


SHOPIFY_PROVIDER = "shopify"
SHOPIFY_ASSET_TYPE = "integration_shopify"
DEFAULT_API_VERSION = "2026-04"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024
BULK_THRESHOLD_ROWS = 2_500
SHOPIFY_ORDERS_DEFAULT_DAYS = 60

VALID_REPORT_TYPES = {
    "sales_overview",
    "orders",
    "products",
    "customers",
    "inventory",
    "discounts",
}

REPORT_LABELS = {
    "sales_overview": "Sales Overview",
    "orders": "Orders",
    "products": "Products",
    "customers": "Customers",
    "inventory": "Inventory",
    "discounts": "Discounts",
}

REPORT_RESOURCES = {
    "sales_overview": "orders",
    "orders": "orders",
    "products": "products",
    "customers": "customers",
    "inventory": "inventory",
    "discounts": "discounts",
}

REPORT_HEADERS = {
    "sales_overview": [
        "order_date",
        "order_id",
        "order_name",
        "currency",
        "subtotal",
        "discounts",
        "tax",
        "shipping",
        "refunds",
        "total",
        "channel",
        "source_name",
        "landing_site",
        "referring_site",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "customer_id",
        "customer_type",
        "customer_email",
        "customer_name",
        "product_sku_summary",
        "product_title_summary",
        "fulfillment_status",
        "financial_status",
    ],
    "orders": [
        "order_date",
        "order_id",
        "order_name",
        "currency",
        "subtotal",
        "discounts",
        "tax",
        "shipping",
        "refunds",
        "total",
        "channel",
        "source_name",
        "customer_id",
        "customer_type",
        "customer_email",
        "customer_name",
        "product_sku_summary",
        "product_title_summary",
        "fulfillment_status",
        "financial_status",
    ],
    "products": [
        "product_id",
        "title",
        "handle",
        "status",
        "vendor",
        "product_type",
        "total_inventory",
        "variant_count",
        "sku_summary",
        "created_at",
        "updated_at",
    ],
    "customers": [
        "customer_id",
        "display_name",
        "email",
        "created_at",
        "updated_at",
        "orders_count",
        "amount_spent",
        "currency",
        "state",
        "tags",
    ],
    "inventory": [
        "product_id",
        "product_title",
        "variant_id",
        "variant_title",
        "sku",
        "inventory_quantity",
        "price",
        "vendor",
        "status",
        "updated_at",
    ],
    "discounts": [
        "discount_id",
        "title",
        "status",
        "starts_at",
        "ends_at",
        "usage_count",
        "summary",
        "created_at",
        "updated_at",
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _gid_tail(value: Any) -> str:
    raw = str(value or "")
    return raw.rsplit("/", 1)[-1] if raw else ""


def _first_nested(record: Dict[str, Any], *paths: str) -> Any:
    for path in paths:
        current: Any = record
        ok = True
        for part in path.split("."):
            if isinstance(current, dict) and part in current:
                current = current.get(part)
            else:
                ok = False
                break
        if ok and current not in (None, ""):
            return current
    return ""


def _money_amount(value: Any) -> str:
    if isinstance(value, dict):
        amount = _first_nested(
            value, "shopMoney.amount", "presentmentMoney.amount", "amount"
        )
        return str(amount or "")
    return str(value or "")


def _edges(connection: Any) -> List[Dict[str, Any]]:
    if not isinstance(connection, dict):
        return []
    rows = []
    for edge in connection.get("edges") or []:
        node = edge.get("node") if isinstance(edge, dict) else None
        if isinstance(node, dict):
            rows.append(node)
    return rows


def _join_values(values: Sequence[Any]) -> str:
    return "; ".join(str(value) for value in values if value not in (None, ""))


def _normalize_row_limit(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_ROW_LIMIT
    return max(1, min(parsed, MAX_ROW_LIMIT))


def _normalize_max_bytes(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_EXPORT_BYTES
    return max(1, parsed)


def normalize_shop_domain(shop: str) -> str:
    raw = str(shop or "").strip().lower()
    if not raw:
        raise HTTPException(status_code=400, detail="Shopify shop domain is required.")
    if "://" in raw:
        parsed = urlparse(raw)
        raw = parsed.hostname or ""
    raw = raw.split("/", 1)[0].strip()
    if "." not in raw:
        raw = f"{raw}.myshopify.com"
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*\.myshopify\.com", raw):
        raise HTTPException(
            status_code=400,
            detail="Shopify shop must be a valid *.myshopify.com domain.",
        )
    return raw


def verify_shopify_hmac(query_params: Dict[str, Any], client_secret: str) -> bool:
    supplied = str(query_params.get("hmac") or "")
    if not supplied or not client_secret:
        return False
    message = "&".join(
        f"{key}={value}"
        for key, value in sorted(query_params.items())
        if key not in {"hmac", "signature"} and value is not None
    )
    expected = hmac.new(
        client_secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(supplied, expected)


def _parse_date(value: Optional[str], field_name: str) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"{field_name} must be YYYY-MM-DD"
        ) from exc


def resolve_date_window(
    date_preset: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
    report_type: str,
    has_read_all_orders: bool,
) -> Dict[str, str]:
    today = datetime.now(timezone.utc).date()
    if date_preset == "custom" or start_date or end_date:
        start = _parse_date(start_date, "start_date")
        end = _parse_date(end_date, "end_date")
        if not start or not end:
            raise HTTPException(
                status_code=400,
                detail="start_date and end_date are required for custom date ranges.",
            )
    else:
        days = {"last_7d": 7, "last_30d": 30, "last_90d": 90}.get(
            str(date_preset or "last_30d"), 30
        )
        start = today - timedelta(days=days)
        end = today
    if start > end:
        raise HTTPException(
            status_code=400, detail="start_date must be before end_date."
        )
    if (
        report_type in {"sales_overview", "orders"}
        and not has_read_all_orders
        and (today - start).days > SHOPIFY_ORDERS_DEFAULT_DAYS
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Shopify only allows the last 60 days of orders by default. "
                "Enable read_all_orders after Shopify approval for older order history."
            ),
        )
    return {"from": start.isoformat(), "to": end.isoformat()}


def _schema_fingerprint(headers: Sequence[str]) -> str:
    return hashlib.sha256(json.dumps(list(headers)).encode("utf-8")).hexdigest()


def _csv_bytes(headers: Sequence[str], rows: Sequence[Dict[str, Any]]) -> bytes:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(headers), extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, "") for key in headers})
    return output.getvalue().encode("utf-8")


class ShopifyCommerceAdapter:
    def __init__(self, api_version: str = DEFAULT_API_VERSION):
        self.api_version = api_version

    def _graphql_url(self, shop_domain: str, api_version: str) -> str:
        return f"https://{shop_domain}/admin/api/{api_version}/graphql.json"

    async def exchange_token(
        self, shop_domain: str, client_id: str, client_secret: str, code: str
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"https://{shop_domain}/admin/oauth/access_token",
                json={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                },
                headers={"Accept": "application/json"},
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Shopify OAuth token exchange failed: {resp.text}",
            )
        return resp.json()

    async def graphql(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str,
        query: str,
        variables: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = self._graphql_url(shop_domain, api_version)
        for attempt in range(4):
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    url,
                    json={"query": query, "variables": variables or {}},
                    headers={
                        "X-Shopify-Access-Token": access_token,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                )
            if resp.status_code == 429 and attempt < 3:
                retry_after = int(resp.headers.get("Retry-After") or "1")
                time.sleep(max(0, min(retry_after, 5)))
                continue
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"Shopify API error: {resp.text}",
                )
            payload = resp.json()
            errors = payload.get("errors") or []
            if errors and any(
                "THROTTLED" in json.dumps(error).upper() for error in errors
            ):
                if attempt < 3:
                    time.sleep(1 + attempt)
                    continue
                raise HTTPException(
                    status_code=429,
                    detail="Shopify GraphQL rate limit exceeded. Please retry later.",
                )
            if errors:
                raise HTTPException(
                    status_code=400,
                    detail=f"Shopify GraphQL error: {errors[0].get('message') or errors[0]}",
                )
            throttle = (
                payload.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            )
            if int(throttle.get("currentlyAvailable") or 1000) < 50:
                time.sleep(1)
            return payload.get("data") or {}
        raise HTTPException(status_code=429, detail="Shopify API rate limit exceeded.")

    async def fetch_shop(
        self, shop_domain: str, access_token: str, api_version: str
    ) -> Dict[str, Any]:
        data = await self.graphql(
            shop_domain,
            access_token,
            api_version,
            """
            query DreamifyShopInfo {
              shop {
                id
                name
                myshopifyDomain
                url
                email
                currencyCode
                ianaTimezone
              }
            }
            """,
        )
        shop = data.get("shop") or {}
        return {
            "shop_id": str(shop.get("id") or ""),
            "shop_name": str(shop.get("name") or shop_domain),
            "shop_domain": str(shop.get("myshopifyDomain") or shop_domain),
            "shop_url": shop.get("url"),
            "shop_email": shop.get("email"),
            "currency": shop.get("currencyCode"),
            "timezone": shop.get("ianaTimezone") or "UTC",
        }

    async def fetch_report_rows(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
        force_bulk: bool = False,
    ) -> Dict[str, Any]:
        use_bulk = force_bulk or row_limit > BULK_THRESHOLD_ROWS
        if use_bulk:
            rows = await self._fetch_bulk_rows(
                shop_domain, access_token, api_version, report_type, date_window
            )
            return {
                "rows": rows[:row_limit],
                "api_mode": "bulk_operation",
                "truncated": len(rows) > row_limit,
            }
        rows = await self._fetch_paginated_rows(
            shop_domain=shop_domain,
            access_token=access_token,
            api_version=api_version,
            report_type=report_type,
            date_window=date_window,
            row_limit=row_limit,
            include_pii=include_pii,
        )
        return {
            "rows": rows,
            "api_mode": "graphql",
            "truncated": len(rows) >= row_limit,
        }

    async def _fetch_paginated_rows(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
    ) -> List[Dict[str, Any]]:
        if report_type in {"sales_overview", "orders"}:
            return await self._fetch_orders(
                shop_domain,
                access_token,
                api_version,
                date_window,
                row_limit,
                include_pii,
            )
        if report_type in {"products", "inventory"}:
            return await self._fetch_products(
                shop_domain, access_token, api_version, report_type, row_limit
            )
        if report_type == "customers":
            return await self._fetch_customers(
                shop_domain, access_token, api_version, row_limit, include_pii
            )
        if report_type == "discounts":
            return await self._fetch_discounts(
                shop_domain, access_token, api_version, row_limit
            )
        raise HTTPException(status_code=400, detail="Invalid Shopify report_type.")

    async def _fetch_orders(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
    ) -> List[Dict[str, Any]]:
        query_text = (
            f"created_at:>={date_window['from']} created_at:<={date_window['to']}"
        )
        query = """
        query DreamifyOrders($first: Int!, $after: String, $query: String!) {
          orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
            edges {
              cursor
              node {
                id
                name
                createdAt
                updatedAt
                currencyCode
                subtotalPriceSet { shopMoney { amount currencyCode } }
                totalDiscountsSet { shopMoney { amount currencyCode } }
                totalTaxSet { shopMoney { amount currencyCode } }
                totalShippingPriceSet { shopMoney { amount currencyCode } }
                totalRefundedSet { shopMoney { amount currencyCode } }
                totalPriceSet { shopMoney { amount currencyCode } }
                displayFinancialStatus
                displayFulfillmentStatus
                sourceName
                landingPageUrl
                referrerUrl
                customer { id displayName email numberOfOrders }
                customerJourneySummary {
                  firstVisit { utmParameters { source medium campaign } }
                  lastVisit { utmParameters { source medium campaign } }
                }
                lineItems(first: 10) {
                  edges {
                    node {
                      title
                      sku
                      quantity
                      variant { sku title }
                      product { title vendor productType }
                    }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        """
        rows: List[Dict[str, Any]] = []
        after = None
        while len(rows) < row_limit:
            data = await self.graphql(
                shop_domain,
                access_token,
                api_version,
                query,
                {
                    "first": min(100, row_limit - len(rows)),
                    "after": after,
                    "query": query_text,
                },
            )
            orders = data.get("orders") or {}
            for node in _edges(orders):
                rows.append(self._flatten_order(node, include_pii))
                if len(rows) >= row_limit:
                    break
            page = orders.get("pageInfo") or {}
            if not page.get("hasNextPage") or not page.get("endCursor"):
                break
            after = page.get("endCursor")
        return rows

    async def _fetch_products(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str,
        report_type: str,
        row_limit: int,
    ) -> List[Dict[str, Any]]:
        query = """
        query DreamifyProducts($first: Int!, $after: String) {
          products(first: $first, after: $after, sortKey: UPDATED_AT) {
            edges {
              cursor
              node {
                id
                title
                handle
                status
                vendor
                productType
                totalInventory
                createdAt
                updatedAt
                variants(first: 25) {
                  edges {
                    node { id title sku price inventoryQuantity }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        """
        rows: List[Dict[str, Any]] = []
        after = None
        while len(rows) < row_limit:
            data = await self.graphql(
                shop_domain,
                access_token,
                api_version,
                query,
                {"first": min(100, row_limit - len(rows)), "after": after},
            )
            products = data.get("products") or {}
            for product in _edges(products):
                if report_type == "inventory":
                    for row in self._flatten_inventory(product):
                        rows.append(row)
                        if len(rows) >= row_limit:
                            break
                else:
                    rows.append(self._flatten_product(product))
                if len(rows) >= row_limit:
                    break
            page = products.get("pageInfo") or {}
            if not page.get("hasNextPage") or not page.get("endCursor"):
                break
            after = page.get("endCursor")
        return rows

    async def _fetch_customers(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str,
        row_limit: int,
        include_pii: bool,
    ) -> List[Dict[str, Any]]:
        query = """
        query DreamifyCustomers($first: Int!, $after: String) {
          customers(first: $first, after: $after, sortKey: UPDATED_AT) {
            edges {
              cursor
              node {
                id
                displayName
                email
                createdAt
                updatedAt
                numberOfOrders
                amountSpent { amount currencyCode }
                state
                tags
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        """
        rows: List[Dict[str, Any]] = []
        after = None
        while len(rows) < row_limit:
            data = await self.graphql(
                shop_domain,
                access_token,
                api_version,
                query,
                {"first": min(100, row_limit - len(rows)), "after": after},
            )
            customers = data.get("customers") or {}
            for customer in _edges(customers):
                rows.append(
                    {
                        "customer_id": _gid_tail(customer.get("id")),
                        "display_name": (
                            customer.get("displayName") if include_pii else ""
                        ),
                        "email": customer.get("email") if include_pii else "",
                        "created_at": customer.get("createdAt"),
                        "updated_at": customer.get("updatedAt"),
                        "orders_count": customer.get("numberOfOrders"),
                        "amount_spent": _first_nested(customer, "amountSpent.amount"),
                        "currency": _first_nested(customer, "amountSpent.currencyCode"),
                        "state": customer.get("state"),
                        "tags": _join_values(customer.get("tags") or []),
                    }
                )
                if len(rows) >= row_limit:
                    break
            page = customers.get("pageInfo") or {}
            if not page.get("hasNextPage") or not page.get("endCursor"):
                break
            after = page.get("endCursor")
        return rows

    async def _fetch_discounts(
        self, shop_domain: str, access_token: str, api_version: str, row_limit: int
    ) -> List[Dict[str, Any]]:
        query = """
        query DreamifyDiscounts($first: Int!, $after: String) {
          discountNodes(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                discount {
                  __typename
                  ... on DiscountCodeBasic {
                    title status startsAt endsAt usageCount summary createdAt updatedAt
                  }
                  ... on DiscountAutomaticBasic {
                    title status startsAt endsAt summary createdAt updatedAt
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        """
        rows: List[Dict[str, Any]] = []
        after = None
        while len(rows) < row_limit:
            data = await self.graphql(
                shop_domain,
                access_token,
                api_version,
                query,
                {"first": min(100, row_limit - len(rows)), "after": after},
            )
            nodes = data.get("discountNodes") or {}
            for node in _edges(nodes):
                discount = node.get("discount") or {}
                rows.append(
                    {
                        "discount_id": _gid_tail(node.get("id")),
                        "title": discount.get("title"),
                        "status": discount.get("status"),
                        "starts_at": discount.get("startsAt"),
                        "ends_at": discount.get("endsAt"),
                        "usage_count": discount.get("usageCount"),
                        "summary": discount.get("summary"),
                        "created_at": discount.get("createdAt"),
                        "updated_at": discount.get("updatedAt"),
                    }
                )
                if len(rows) >= row_limit:
                    break
            page = nodes.get("pageInfo") or {}
            if not page.get("hasNextPage") or not page.get("endCursor"):
                break
            after = page.get("endCursor")
        return rows

    async def _fetch_bulk_rows(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str,
        report_type: str,
        date_window: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        # v1 bulk support is intentionally conservative. The generated query
        # remains allowlisted; callers never pass raw GraphQL.
        if report_type not in {"sales_overview", "orders"}:
            return await self._fetch_paginated_rows(
                shop_domain,
                access_token,
                api_version,
                report_type,
                date_window,
                MAX_ROW_LIMIT,
                include_pii=False,
            )
        bulk_query = f"""
        {{
          orders(query: "created_at:>={date_window['from']} created_at:<={date_window['to']}") {{
            edges {{
              node {{
                id name createdAt updatedAt currencyCode sourceName
                subtotalPriceSet {{ shopMoney {{ amount currencyCode }} }}
                totalDiscountsSet {{ shopMoney {{ amount currencyCode }} }}
                totalTaxSet {{ shopMoney {{ amount currencyCode }} }}
                totalShippingPriceSet {{ shopMoney {{ amount currencyCode }} }}
                totalRefundedSet {{ shopMoney {{ amount currencyCode }} }}
                totalPriceSet {{ shopMoney {{ amount currencyCode }} }}
                displayFinancialStatus displayFulfillmentStatus
              }}
            }}
          }}
        }}
        """
        mutation = """
        mutation DreamifyBulk($query: String!) {
          bulkOperationRunQuery(query: $query) {
            bulkOperation { id status }
            userErrors { field message }
          }
        }
        """
        data = await self.graphql(
            shop_domain,
            access_token,
            api_version,
            mutation,
            {"query": bulk_query},
        )
        errors = (data.get("bulkOperationRunQuery") or {}).get("userErrors") or []
        if errors:
            raise HTTPException(
                status_code=400,
                detail=f"Shopify bulk operation error: {errors[0].get('message')}",
            )
        status_query = """
        query DreamifyBulkStatus {
          currentBulkOperation { id status errorCode url }
        }
        """
        bulk = {}
        for _ in range(30):
            status_data = await self.graphql(
                shop_domain, access_token, api_version, status_query
            )
            bulk = status_data.get("currentBulkOperation") or {}
            if bulk.get("status") in {"COMPLETED", "FAILED", "CANCELED"}:
                break
            time.sleep(2)
        if bulk.get("status") != "COMPLETED" or not bulk.get("url"):
            raise HTTPException(
                status_code=400,
                detail=f"Shopify bulk operation did not complete: {bulk.get('status') or 'unknown'}",
            )
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(str(bulk["url"]))
        if resp.status_code != 200:
            raise HTTPException(
                status_code=400, detail="Failed to download Shopify bulk result."
            )
        rows = []
        for line in resp.text.splitlines():
            if not line.strip():
                continue
            rows.append(self._flatten_order(json.loads(line), include_pii=False))
        return rows

    def _flatten_order(
        self, order: Dict[str, Any], include_pii: bool
    ) -> Dict[str, Any]:
        customer = order.get("customer") or {}
        line_items = _edges(order.get("lineItems"))
        skus = [
            item.get("sku") or _first_nested(item, "variant.sku") or item.get("title")
            for item in line_items
        ]
        titles = [
            _first_nested(item, "product.title") or item.get("title")
            for item in line_items
        ]
        journey = order.get("customerJourneySummary") or {}
        first_visit = journey.get("firstVisit") or {}
        last_visit = journey.get("lastVisit") or {}
        utm = last_visit.get("utmParameters") or first_visit.get("utmParameters") or {}
        orders_count = customer.get("numberOfOrders") or 0
        try:
            customer_type = "new" if int(orders_count) <= 1 else "returning"
        except (TypeError, ValueError):
            customer_type = ""
        return {
            "order_date": order.get("createdAt"),
            "order_id": _gid_tail(order.get("id")),
            "order_name": order.get("name"),
            "currency": order.get("currencyCode")
            or _first_nested(order, "totalPriceSet.shopMoney.currencyCode"),
            "subtotal": _money_amount(order.get("subtotalPriceSet")),
            "discounts": _money_amount(order.get("totalDiscountsSet")),
            "tax": _money_amount(order.get("totalTaxSet")),
            "shipping": _money_amount(order.get("totalShippingPriceSet")),
            "refunds": _money_amount(order.get("totalRefundedSet")),
            "total": _money_amount(order.get("totalPriceSet")),
            "channel": order.get("sourceName"),
            "source_name": order.get("sourceName"),
            "landing_site": order.get("landingPageUrl"),
            "referring_site": order.get("referrerUrl"),
            "utm_source": utm.get("source"),
            "utm_medium": utm.get("medium"),
            "utm_campaign": utm.get("campaign"),
            "customer_id": _gid_tail(customer.get("id")),
            "customer_type": customer_type,
            "customer_email": customer.get("email") if include_pii else "",
            "customer_name": customer.get("displayName") if include_pii else "",
            "product_sku_summary": _join_values(skus),
            "product_title_summary": _join_values(titles),
            "fulfillment_status": order.get("displayFulfillmentStatus"),
            "financial_status": order.get("displayFinancialStatus"),
        }

    def _flatten_product(self, product: Dict[str, Any]) -> Dict[str, Any]:
        variants = _edges(product.get("variants"))
        return {
            "product_id": _gid_tail(product.get("id")),
            "title": product.get("title"),
            "handle": product.get("handle"),
            "status": product.get("status"),
            "vendor": product.get("vendor"),
            "product_type": product.get("productType"),
            "total_inventory": product.get("totalInventory"),
            "variant_count": len(variants),
            "sku_summary": _join_values(
                [variant.get("sku") or variant.get("title") for variant in variants]
            ),
            "created_at": product.get("createdAt"),
            "updated_at": product.get("updatedAt"),
        }

    def _flatten_inventory(self, product: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = []
        for variant in _edges(product.get("variants")):
            rows.append(
                {
                    "product_id": _gid_tail(product.get("id")),
                    "product_title": product.get("title"),
                    "variant_id": _gid_tail(variant.get("id")),
                    "variant_title": variant.get("title"),
                    "sku": variant.get("sku"),
                    "inventory_quantity": variant.get("inventoryQuantity"),
                    "price": variant.get("price"),
                    "vendor": product.get("vendor"),
                    "status": product.get("status"),
                    "updated_at": product.get("updatedAt"),
                }
            )
        return rows


class ShopifyConnectorService:
    def __init__(self, adapter: Optional[ShopifyCommerceAdapter] = None):
        self.adapter = adapter or ShopifyCommerceAdapter()

    def _shopify_config(self) -> Dict[str, Any]:
        cfg = getattr(config, "shopify", None)
        return {
            "client_id": (getattr(cfg, "client_id", "") if cfg else "")
            or os.environ.get("SHOPIFY_CLIENT_ID", ""),
            "client_secret": (getattr(cfg, "client_secret", "") if cfg else "")
            or os.environ.get("SHOPIFY_CLIENT_SECRET", ""),
            "redirect_uri": (getattr(cfg, "redirect_uri", "") if cfg else "")
            or os.environ.get("SHOPIFY_REDIRECT_URI", ""),
            "api_version": (getattr(cfg, "api_version", "") if cfg else "")
            or os.environ.get("SHOPIFY_API_VERSION", DEFAULT_API_VERSION),
            "enable_read_all_orders": bool(
                getattr(cfg, "enable_read_all_orders", False) if cfg else False
            )
            or _truthy(os.environ.get("SHOPIFY_ENABLE_READ_ALL_ORDERS")),
        }

    def _scopes(self) -> List[str]:
        scopes = [
            "read_orders",
            "read_products",
            "read_customers",
            "read_inventory",
            "read_fulfillments",
            "read_discounts",
        ]
        if self._shopify_config()["enable_read_all_orders"]:
            scopes.append("read_all_orders")
        return scopes

    def _make_state_payload(self, user_id: str, shop_domain: str) -> str:
        cfg = self._shopify_config()
        secret = cfg["client_secret"] or config.app.secret_key
        payload = {
            "u": user_id,
            "s": shop_domain,
            "n": _b64url(secrets.token_bytes(18)),
            "ts": int(datetime.now(timezone.utc).timestamp()),
        }
        body = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        sig = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256)
        return f"{body}.{sig.hexdigest()}"

    def _verify_state(self, state: str, max_age_seconds: int = 900) -> Dict[str, Any]:
        cfg = self._shopify_config()
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
            if not payload.get("u") or not payload.get("s"):
                raise ValueError("Invalid state payload")
            return payload
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Invalid state format") from exc

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = (
            connected_accounts_repo.get_connection(user_id, SHOPIFY_PROVIDER) or {}
        )
        preserved = {
            key: value
            for key, value in existing.items()
            if key
            not in {
                "access_token",
                "encrypted_access_token",
                "user_id",
                "provider",
                "updated_at",
            }
        }
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider=SHOPIFY_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str, shop: str) -> str:
        cfg = self._shopify_config()
        if not cfg["client_id"] or not cfg["redirect_uri"]:
            raise ValueError("Shopify client_id or redirect_uri is not configured.")
        shop_domain = normalize_shop_domain(shop)
        state = self._make_state_payload(user_id, shop_domain)
        record = connected_accounts_repo.get_connection(user_id, SHOPIFY_PROVIDER) or {}
        pending = dict(record.get("pending_oauth_states") or {})
        now = int(datetime.now(timezone.utc).timestamp())
        pending[state] = {"shop_domain": shop_domain, "created_at": now}
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
                "client_id": cfg["client_id"],
                "scope": ",".join(self._scopes()),
                "redirect_uri": cfg["redirect_uri"],
                "state": state,
                "grant_options[]": "per-user",
            }
        )
        return f"https://{shop_domain}/admin/oauth/authorize?{params}"

    async def handle_oauth_callback(
        self, code: str, state: str, shop: str, query_params: Dict[str, Any]
    ) -> None:
        cfg = self._shopify_config()
        if not cfg["client_id"] or not cfg["client_secret"]:
            raise ValueError("Shopify OAuth client credentials are not configured.")
        if not verify_shopify_hmac(query_params, cfg["client_secret"]):
            raise ValueError("Invalid Shopify OAuth HMAC.")
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        shop_domain = normalize_shop_domain(shop or payload["s"])
        if shop_domain != normalize_shop_domain(str(payload["s"])):
            raise ValueError("Shopify OAuth shop does not match state.")
        record = connected_accounts_repo.get_connection(user_id, SHOPIFY_PROVIDER) or {}
        pending = dict(record.get("pending_oauth_states") or {})
        pending_state = pending.pop(state, None)
        if (
            not pending_state
            or normalize_shop_domain(pending_state.get("shop_domain", ""))
            != shop_domain
        ):
            raise ValueError("Missing Shopify OAuth state.")
        token_data = await self.adapter.exchange_token(
            shop_domain=shop_domain,
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            code=code,
        )
        access_token = str(token_data.get("access_token") or "")
        if not access_token:
            raise HTTPException(
                status_code=400,
                detail="Shopify OAuth response did not include an access token.",
            )
        granted_scope = str(token_data.get("scope") or ",".join(self._scopes()))
        shop_info = await self.adapter.fetch_shop(
            shop_domain, access_token, cfg["api_version"]
        )
        self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "shop_domain": shop_info.get("shop_domain") or shop_domain,
                "shop_id": shop_info.get("shop_id"),
                "shop_name": shop_info.get("shop_name") or shop_domain,
                "shop_url": shop_info.get("shop_url"),
                "shop_email": shop_info.get("shop_email"),
                "currency": shop_info.get("currency"),
                "timezone": shop_info.get("timezone") or "UTC",
                "api_version": cfg["api_version"],
                "scopes": [
                    scope.strip() for scope in granted_scope.split(",") if scope.strip()
                ],
                "read_all_orders_enabled": "read_all_orders"
                in granted_scope.split(","),
                "pending_oauth_states": pending,
                "connected_at": _now_iso(),
            },
        )

    async def _access_token(self, user_id: str) -> Tuple[str, Dict[str, Any]]:
        record = connected_accounts_repo.get_connection(user_id, SHOPIFY_PROVIDER) or {}
        encrypted = record.get("encrypted_access_token")
        if not encrypted:
            raise HTTPException(status_code=401, detail="Shopify is not connected.")
        try:
            return _decrypt_secret(str(encrypted)), record
        except Exception as exc:
            logger.warning("Failed to decrypt Shopify access token: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="Shopify token could not be decrypted. Please reconnect.",
            ) from exc

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, SHOPIFY_PROVIDER) or {}
        return {
            "connected": bool(record.get("encrypted_access_token")),
            "shop_id": record.get("shop_id"),
            "shop_domain": record.get("shop_domain"),
            "shop_name": record.get("shop_name"),
            "shop_url": record.get("shop_url"),
            "currency": record.get("currency"),
            "timezone": record.get("timezone"),
            "account_name": record.get("shop_name") or record.get("shop_domain"),
            "scopes": record.get("scopes") or [],
            "read_all_orders_enabled": bool(record.get("read_all_orders_enabled")),
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, SHOPIFY_PROVIDER)

    async def get_shop(self, user_id: str) -> Dict[str, Any]:
        _, record = await self._access_token(user_id)
        return {
            "shop_id": record.get("shop_id"),
            "shop_domain": record.get("shop_domain"),
            "shop_name": record.get("shop_name"),
            "shop_url": record.get("shop_url"),
            "currency": record.get("currency"),
            "timezone": record.get("timezone") or "UTC",
            "read_all_orders_enabled": bool(record.get("read_all_orders_enabled")),
            "scopes": record.get("scopes") or [],
        }

    async def list_resources(self, user_id: str) -> List[Dict[str, Any]]:
        await self._access_token(user_id)
        return [
            {
                "report_type": report_type,
                "label": REPORT_LABELS[report_type],
                "resource": REPORT_RESOURCES[report_type],
                "default": report_type == "sales_overview",
            }
            for report_type in [
                "sales_overview",
                "orders",
                "products",
                "customers",
                "inventory",
                "discounts",
            ]
        ]

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "shopify":
            raise HTTPException(status_code=400, detail="Invalid Shopify entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid Shopify report type")
        return {
            "report_type": report_type,
            "shop_domain": normalize_shop_domain(parts[2]),
            "resource": parts[3] or REPORT_RESOURCES[report_type],
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, resource: str
    ) -> Dict[str, Any]:
        shop_domain = normalize_shop_domain(str(record.get("shop_domain") or ""))
        shop_name = str(record.get("shop_name") or shop_domain)
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"shopify:{report_type}:{shop_domain}:{resource or 'all'}"
        return {
            "id": entity_id,
            "name": f"{shop_name} / {label}",
            "type": "report",
            "account_name": shop_name,
            "shop_domain": shop_domain,
            "report_type": report_type,
            "resource": resource or "all",
            "connector_key": "shopify",
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
            cfg.setdefault("shop_domain", parsed["shop_domain"])
            cfg.setdefault("resource", parsed["resource"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "sales_overview"),
            date_preset=cfg.get("date_preset"),
            start_date=cfg.get("start_date"),
            end_date=cfg.get("end_date"),
            row_limit=cfg.get("row_limit"),
            include_pii=bool(cfg.get("include_pii", False)),
            max_bytes=cfg.get("max_bytes"),
            resource=str(cfg.get("resource") or ""),
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
        include_pii: bool = False,
        max_bytes: Any = None,
        resource: str = "",
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid report_type. Must be sales_overview, orders, products, "
                    "customers, inventory, or discounts."
                ),
            )
        access_token, record = await self._access_token(user_id)
        shop_domain = normalize_shop_domain(str(record.get("shop_domain") or ""))
        api_version = str(
            record.get("api_version") or self._shopify_config()["api_version"]
        )
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        has_read_all = bool(record.get("read_all_orders_enabled"))
        date_window = resolve_date_window(
            date_preset=date_preset,
            start_date=start_date,
            end_date=end_date,
            report_type=report_type,
            has_read_all_orders=has_read_all,
        )
        force_bulk = row_cap > BULK_THRESHOLD_ROWS or (
            report_type in {"sales_overview", "orders"}
            and (
                date.fromisoformat(date_window["to"])
                - date.fromisoformat(date_window["from"])
            ).days
            > 31
        )
        export = await self.adapter.fetch_report_rows(
            shop_domain=shop_domain,
            access_token=access_token,
            api_version=api_version,
            report_type=report_type,
            date_window=date_window,
            row_limit=row_cap,
            include_pii=include_pii,
            force_bulk=force_bulk,
        )
        rows = list(export.get("rows") or [])[:row_cap]
        headers = REPORT_HEADERS[report_type]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="Shopify extract exceeded the configured byte cap.",
            )
        selected_resource = resource or REPORT_RESOURCES[report_type]
        return self._save_shopify_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            resource=selected_resource,
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            include_pii=include_pii,
            api_mode=str(export.get("api_mode") or "graphql"),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_shopify_asset(
        self,
        user_id: str,
        project_id: str,
        record: Dict[str, Any],
        report_type: str,
        resource: str,
        date_window: Dict[str, str],
        row_limit: int,
        max_bytes: int,
        include_pii: bool,
        api_mode: str,
        truncated: bool,
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
        entity = self._selected_entity(record, report_type, resource)
        manifest = {
            "connector_key": "shopify",
            "source_type": "shopify",
            "shop_id": record.get("shop_id"),
            "shop_domain": record.get("shop_domain"),
            "shop_name": record.get("shop_name"),
            "api_version": record.get("api_version") or DEFAULT_API_VERSION,
            "report_type": report_type,
            "resource": resource,
            "scopes": record.get("scopes") or [],
            "date_window": date_window,
            "filters": {"date_field": "created_at"},
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
            "source_timezone": record.get("timezone") or "UTC",
            "pii_redacted": not include_pii,
            "read_all_orders_enabled": bool(record.get("read_all_orders_enabled")),
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
            f"shopify_{_sanitize_filename_part(report_type)}_"
            f"{date_window['from']}_{date_window['to']}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=SHOPIFY_ASSET_TYPE,
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
            user_id=user_id, provider=SHOPIFY_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "shopify",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "shopify_shop_domain": record.get("shop_domain"),
                "shopify_report_type": report_type,
                "shopify_manifest_s3_key": manifest_key,
                "shopify_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {len(rows)} rows from Shopify ({entity['name']}).",
            "asset": updated or asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "entity_id": entity["id"],
            "truncated": truncated,
            "api_mode": api_mode,
        }


shopify_service = ShopifyConnectorService()
