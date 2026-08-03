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


QUICKBOOKS_PROVIDER = "quickbooks"
QUICKBOOKS_ASSET_TYPE = "integration_quickbooks"
INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2"
INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
PRODUCTION_API_BASE_URL = "https://quickbooks.api.intuit.com"
SANDBOX_API_BASE_URL = "https://sandbox-quickbooks.api.intuit.com"
DEFAULT_ROW_LIMIT = 5_000
MAX_ROW_LIMIT = 10_000
DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 * 1024
DEFAULT_MINOR_VERSION = "75"
REPORT_CHUNK_DAYS = 183

VALID_REPORT_TYPES = {
    "finance_overview",
    "profit_and_loss",
    "balance_sheet",
    "cash_flow",
    "invoices",
    "bills",
    "payments",
    "customers",
    "vendors",
    "items",
    "accounts",
}

REPORT_LABELS = {
    "finance_overview": "Finance Overview",
    "profit_and_loss": "Profit and Loss",
    "balance_sheet": "Balance Sheet",
    "cash_flow": "Cash Flow",
    "invoices": "Invoices",
    "bills": "Bills",
    "payments": "Payments",
    "customers": "Customers",
    "vendors": "Vendors",
    "items": "Items",
    "accounts": "Accounts",
}

STATEMENT_REPORTS = {
    "profit_and_loss": "ProfitAndLoss",
    "balance_sheet": "BalanceSheet",
    "cash_flow": "CashFlow",
}

ENTITY_REPORTS = {
    "invoices": "Invoice",
    "bills": "Bill",
    "payments": "Payment",
    "customers": "Customer",
    "vendors": "Vendor",
    "items": "Item",
    "accounts": "Account",
}

STATEMENT_HEADERS = [
    "report_type",
    "statement_name",
    "row_type",
    "section",
    "label",
    "col_1",
    "col_2",
    "col_3",
    "col_4",
    "col_5",
    "col_6",
    "col_7",
    "col_8",
    "col_9",
    "col_10",
    "col_11",
    "col_12",
]

ENTITY_HEADERS = {
    "invoices": [
        "invoice_id",
        "doc_number",
        "customer_name",
        "txn_date",
        "due_date",
        "currency",
        "total_amount",
        "balance",
        "private_note",
        "updated_at",
    ],
    "bills": [
        "bill_id",
        "doc_number",
        "vendor_name",
        "txn_date",
        "due_date",
        "currency",
        "total_amount",
        "balance",
        "private_note",
        "updated_at",
    ],
    "payments": [
        "payment_id",
        "customer_name",
        "txn_date",
        "currency",
        "total_amount",
        "unapplied_amount",
        "payment_ref_number",
        "updated_at",
    ],
    "customers": [
        "customer_id",
        "display_name",
        "company_name",
        "active",
        "balance",
        "currency",
        "created_at",
        "updated_at",
    ],
    "vendors": [
        "vendor_id",
        "display_name",
        "company_name",
        "active",
        "balance",
        "currency",
        "created_at",
        "updated_at",
    ],
    "items": [
        "item_id",
        "name",
        "type",
        "active",
        "unit_price",
        "purchase_cost",
        "income_account",
        "expense_account",
        "updated_at",
    ],
    "accounts": [
        "account_id",
        "name",
        "account_type",
        "account_sub_type",
        "classification",
        "active",
        "current_balance",
        "currency",
        "updated_at",
    ],
}

REPORT_HEADERS = {
    "finance_overview": STATEMENT_HEADERS,
    "profit_and_loss": STATEMENT_HEADERS,
    "balance_sheet": STATEMENT_HEADERS,
    "cash_flow": STATEMENT_HEADERS,
    **ENTITY_HEADERS,
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
    elif preset == "last_90d":
        end = today
        start = today - timedelta(days=90)
    elif preset == "last_180d":
        end = today
        start = today - timedelta(days=180)
    else:
        end = today
        start = today - timedelta(days=30)
    if start > end:
        raise HTTPException(status_code=400, detail="start_date must be before end_date.")
    return {"from": start.isoformat(), "to": end.isoformat()}


def _date_chunks(date_window: Dict[str, str]) -> List[Dict[str, str]]:
    start = _parse_date(date_window.get("from"))
    end = _parse_date(date_window.get("to"))
    if not start or not end:
        return [date_window]
    chunks: List[Dict[str, str]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=REPORT_CHUNK_DAYS - 1), end)
        chunks.append({"from": cursor.isoformat(), "to": chunk_end.isoformat()})
        cursor = chunk_end + timedelta(days=1)
    return chunks or [date_window]


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


def _nested_get(mapping: Dict[str, Any], path: Sequence[str], default: Any = "") -> Any:
    value: Any = mapping
    for key in path:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
    return default if value is None else value


def _ref_name(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("value") or "")
    return ""


def _money(value: Any) -> Any:
    if isinstance(value, dict):
        return value.get("value") or value.get("amount") or ""
    return "" if value is None else value


def _redact_name(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) <= 2:
        return "***"
    return f"{raw[:1]}***"


def _query_response_items(payload: Dict[str, Any], entity_name: str) -> List[Dict[str, Any]]:
    response = payload.get("QueryResponse")
    if not isinstance(response, dict):
        return []
    data = response.get(entity_name)
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def _report_columns(payload: Dict[str, Any]) -> List[str]:
    columns = _nested_get(payload, ["Columns", "Column"], [])
    if not isinstance(columns, list):
        return []
    result = []
    for column in columns:
        if isinstance(column, dict):
            result.append(str(column.get("ColTitle") or column.get("ColType") or ""))
    return result


def _coldata_values(row: Dict[str, Any]) -> List[str]:
    coldata = row.get("ColData")
    if not isinstance(coldata, list):
        return []
    return [str(item.get("value") or "") for item in coldata if isinstance(item, dict)]


def _flatten_statement_rows(
    report_type: str,
    statement_name: str,
    payload: Dict[str, Any],
) -> List[Dict[str, Any]]:
    rows = _nested_get(payload, ["Rows", "Row"], [])
    if not isinstance(rows, list):
        return []

    flattened: List[Dict[str, Any]] = []
    column_labels = _report_columns(payload)

    def visit(items: Sequence[Dict[str, Any]], section: str = "") -> None:
        for row in items:
            if not isinstance(row, dict):
                continue
            header_values = _coldata_values(row.get("Header") or {})
            current_section = header_values[0] if header_values else section
            values = _coldata_values(row)
            summary_values = _coldata_values(row.get("Summary") or {})
            if values:
                flattened.append(
                    _statement_row(
                        report_type,
                        statement_name,
                        "data",
                        current_section,
                        values,
                        column_labels,
                    )
                )
            child_rows = _nested_get(row, ["Rows", "Row"], [])
            if isinstance(child_rows, list):
                visit(child_rows, current_section)
            if summary_values:
                flattened.append(
                    _statement_row(
                        report_type,
                        statement_name,
                        "summary",
                        current_section,
                        summary_values,
                        column_labels,
                    )
                )

    visit(rows)
    return flattened


def _statement_row(
    report_type: str,
    statement_name: str,
    row_type: str,
    section: str,
    values: Sequence[str],
    column_labels: Sequence[str],
) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "report_type": report_type,
        "statement_name": statement_name,
        "row_type": row_type,
        "section": section,
        "label": values[0] if values else "",
    }
    payload = list(values[1:] or column_labels[:0])
    for idx in range(12):
        row[f"col_{idx + 1}"] = payload[idx] if idx < len(payload) else ""
    return row


def _entity_row(report_type: str, item: Dict[str, Any], include_pii: bool) -> Dict[str, Any]:
    if report_type == "invoices":
        customer = _ref_name(item.get("CustomerRef"))
        return {
            "invoice_id": item.get("Id"),
            "doc_number": item.get("DocNumber"),
            "customer_name": customer if include_pii else _redact_name(customer),
            "txn_date": item.get("TxnDate"),
            "due_date": item.get("DueDate"),
            "currency": _ref_name(item.get("CurrencyRef")),
            "total_amount": item.get("TotalAmt"),
            "balance": item.get("Balance"),
            "private_note": "" if not include_pii else item.get("PrivateNote"),
            "updated_at": _nested_get(item, ["MetaData", "LastUpdatedTime"]),
        }
    if report_type == "bills":
        vendor = _ref_name(item.get("VendorRef"))
        return {
            "bill_id": item.get("Id"),
            "doc_number": item.get("DocNumber"),
            "vendor_name": vendor if include_pii else _redact_name(vendor),
            "txn_date": item.get("TxnDate"),
            "due_date": item.get("DueDate"),
            "currency": _ref_name(item.get("CurrencyRef")),
            "total_amount": item.get("TotalAmt"),
            "balance": item.get("Balance"),
            "private_note": "" if not include_pii else item.get("PrivateNote"),
            "updated_at": _nested_get(item, ["MetaData", "LastUpdatedTime"]),
        }
    if report_type == "payments":
        customer = _ref_name(item.get("CustomerRef"))
        return {
            "payment_id": item.get("Id"),
            "customer_name": customer if include_pii else _redact_name(customer),
            "txn_date": item.get("TxnDate"),
            "currency": _ref_name(item.get("CurrencyRef")),
            "total_amount": item.get("TotalAmt"),
            "unapplied_amount": item.get("UnappliedAmt"),
            "payment_ref_number": item.get("PaymentRefNum"),
            "updated_at": _nested_get(item, ["MetaData", "LastUpdatedTime"]),
        }
    if report_type == "customers":
        display_name = item.get("DisplayName")
        return {
            "customer_id": item.get("Id"),
            "display_name": display_name if include_pii else _redact_name(display_name),
            "company_name": item.get("CompanyName") if include_pii else "",
            "active": item.get("Active"),
            "balance": item.get("Balance"),
            "currency": _ref_name(item.get("CurrencyRef")),
            "created_at": _nested_get(item, ["MetaData", "CreateTime"]),
            "updated_at": _nested_get(item, ["MetaData", "LastUpdatedTime"]),
        }
    if report_type == "vendors":
        display_name = item.get("DisplayName")
        return {
            "vendor_id": item.get("Id"),
            "display_name": display_name if include_pii else _redact_name(display_name),
            "company_name": item.get("CompanyName") if include_pii else "",
            "active": item.get("Active"),
            "balance": item.get("Balance"),
            "currency": _ref_name(item.get("CurrencyRef")),
            "created_at": _nested_get(item, ["MetaData", "CreateTime"]),
            "updated_at": _nested_get(item, ["MetaData", "LastUpdatedTime"]),
        }
    if report_type == "items":
        return {
            "item_id": item.get("Id"),
            "name": item.get("Name"),
            "type": item.get("Type"),
            "active": item.get("Active"),
            "unit_price": item.get("UnitPrice"),
            "purchase_cost": item.get("PurchaseCost"),
            "income_account": _ref_name(item.get("IncomeAccountRef")),
            "expense_account": _ref_name(item.get("ExpenseAccountRef")),
            "updated_at": _nested_get(item, ["MetaData", "LastUpdatedTime"]),
        }
    return {
        "account_id": item.get("Id"),
        "name": item.get("Name"),
        "account_type": item.get("AccountType"),
        "account_sub_type": item.get("AccountSubType"),
        "classification": item.get("Classification"),
        "active": item.get("Active"),
        "current_balance": item.get("CurrentBalance"),
        "currency": _ref_name(item.get("CurrencyRef")),
        "updated_at": _nested_get(item, ["MetaData", "LastUpdatedTime"]),
    }


class QuickBooksAdapter:
    async def exchange_token(
        self,
        client_id: str,
        client_secret: str,
        code: str,
        redirect_uri: str,
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                INTUIT_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={
                    "Authorization": _basic_auth_header(client_id, client_secret),
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            response.raise_for_status()
            return response.json()

    async def refresh_token(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                INTUIT_TOKEN_URL,
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                headers={
                    "Authorization": _basic_auth_header(client_id, client_secret),
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            response.raise_for_status()
            return response.json()

    async def fetch_company_info(
        self,
        api_base_url: str,
        access_token: str,
        realm_id: str,
        minor_version: str,
    ) -> Dict[str, Any]:
        payload = await self._get(
            api_base_url=api_base_url,
            access_token=access_token,
            path=f"/v3/company/{realm_id}/companyinfo/{realm_id}",
            params={"minorversion": minor_version},
        )
        info = payload.get("CompanyInfo")
        return info if isinstance(info, dict) else {}

    async def fetch_report_rows(
        self,
        api_base_url: str,
        access_token: str,
        realm_id: str,
        minor_version: str,
        report_type: str,
        date_window: Dict[str, str],
        accounting_basis: str,
        row_limit: int,
    ) -> Dict[str, Any]:
        reports = ["profit_and_loss", "balance_sheet", "cash_flow"]
        if report_type != "finance_overview":
            reports = [report_type]
        rows: List[Dict[str, Any]] = []
        endpoints: List[str] = []
        chunks = _date_chunks(date_window)
        for chunk in chunks:
            for statement_type in reports:
                report_name = STATEMENT_REPORTS[statement_type]
                params = {
                    "start_date": chunk["from"],
                    "end_date": chunk["to"],
                    "accounting_method": accounting_basis,
                    "minorversion": minor_version,
                }
                payload = await self._get(
                    api_base_url=api_base_url,
                    access_token=access_token,
                    path=f"/v3/company/{realm_id}/reports/{report_name}",
                    params=params,
                )
                endpoints.append(f"GET /v3/company/{realm_id}/reports/{report_name}")
                rows.extend(_flatten_statement_rows(statement_type, report_name, payload))
                if len(rows) >= row_limit:
                    return {
                        "rows": rows[:row_limit],
                        "truncated": True,
                        "api_mode": "reports_api",
                        "endpoints_used": endpoints,
                        "chunks": chunks,
                    }
        return {
            "rows": rows[:row_limit],
            "truncated": len(rows) > row_limit,
            "api_mode": "reports_api",
            "endpoints_used": endpoints,
            "chunks": chunks,
        }

    async def fetch_entity_rows(
        self,
        api_base_url: str,
        access_token: str,
        realm_id: str,
        minor_version: str,
        report_type: str,
        date_window: Dict[str, str],
        row_limit: int,
        include_pii: bool,
    ) -> Dict[str, Any]:
        entity_name = ENTITY_REPORTS[report_type]
        rows: List[Dict[str, Any]] = []
        start_position = 1
        endpoints: List[str] = []
        while len(rows) < row_limit:
            max_results = min(1000, row_limit - len(rows))
            query = (
                f"select * from {entity_name} "
                f"where MetaData.LastUpdatedTime >= '{date_window['from']}' "
                f"and MetaData.LastUpdatedTime <= '{date_window['to']}T23:59:59Z' "
                f"startposition {start_position} maxresults {max_results}"
            )
            payload = await self._get(
                api_base_url=api_base_url,
                access_token=access_token,
                path=f"/v3/company/{realm_id}/query",
                params={"query": query, "minorversion": minor_version},
            )
            endpoints.append(f"GET /v3/company/{realm_id}/query:{entity_name}")
            items = _query_response_items(payload, entity_name)
            rows.extend(_entity_row(report_type, item, include_pii) for item in items)
            if len(items) < max_results:
                break
            start_position += len(items)
        return {
            "rows": rows[:row_limit],
            "truncated": len(rows) >= row_limit,
            "api_mode": "accounting_api_query",
            "endpoints_used": endpoints,
            "chunks": [date_window],
        }

    async def _get(
        self,
        api_base_url: str,
        access_token: str,
        path: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        url = f"{api_base_url.rstrip('/')}{path}"
        async with httpx.AsyncClient(timeout=45.0) as client:
            for attempt in range(4):
                response = await client.get(
                    url,
                    params=params,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                )
                if response.status_code in {429, 500, 502, 503, 504} and attempt < 3:
                    retry_after = response.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after else 0.5 * (2**attempt)
                    import asyncio

                    await asyncio.sleep(delay)
                    continue
                response.raise_for_status()
                return response.json()
        raise HTTPException(status_code=502, detail="QuickBooks API request failed.")


class QuickBooksConnectorService:
    def __init__(self, adapter: Optional[QuickBooksAdapter] = None):
        self.adapter = adapter or QuickBooksAdapter()

    def _quickbooks_config(self) -> Dict[str, str]:
        cfg = getattr(config, "quickbooks", None)
        environment = str(
            getattr(cfg, "environment", None)
            or os.environ.get("QUICKBOOKS_ENVIRONMENT", "production")
        ).lower()
        if environment not in {"production", "sandbox"}:
            environment = "production"
        return {
            "client_id": str(
                getattr(cfg, "client_id", None)
                or os.environ.get("QUICKBOOKS_CLIENT_ID", "")
            ),
            "client_secret": str(
                getattr(cfg, "client_secret", None)
                or os.environ.get("QUICKBOOKS_CLIENT_SECRET", "")
            ),
            "redirect_uri": str(
                getattr(cfg, "redirect_uri", None)
                or os.environ.get("QUICKBOOKS_REDIRECT_URI", "")
            ),
            "environment": environment,
            "minor_version": str(
                getattr(cfg, "minor_version", None)
                or os.environ.get("QUICKBOOKS_MINOR_VERSION", DEFAULT_MINOR_VERSION)
            ),
            "api_base_url": (
                SANDBOX_API_BASE_URL if environment == "sandbox" else PRODUCTION_API_BASE_URL
            ),
        }

    def _state_secret(self) -> str:
        cfg = self._quickbooks_config()
        return cfg["client_secret"] or os.environ.get("APP_SECRET") or "quickbooks-dev"

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
                raise ValueError("Invalid QuickBooks OAuth state signature.")
            payload = json.loads(
                base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
            )
            issued_at = int(payload.get("iat") or 0)
            if int(datetime.now(timezone.utc).timestamp()) - issued_at > 900:
                raise ValueError("QuickBooks OAuth state expired.")
            return payload
        except Exception as exc:
            raise ValueError("Invalid QuickBooks OAuth state.") from exc

    def _scopes(self) -> List[str]:
        return ["com.intuit.quickbooks.accounting"]

    def _save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        existing = connected_accounts_repo.get_connection(user_id, QUICKBOOKS_PROVIDER) or {}
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
            provider=QUICKBOOKS_PROVIDER,
            metadata={**preserved, **metadata},
        )

    def get_oauth_url(self, user_id: str) -> str:
        cfg = self._quickbooks_config()
        if not cfg["client_id"] or not cfg["redirect_uri"]:
            raise ValueError("QuickBooks client_id or redirect_uri is not configured.")
        state = self._make_state_payload(user_id)
        record = connected_accounts_repo.get_connection(user_id, QUICKBOOKS_PROVIDER) or {}
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
                "client_id": cfg["client_id"],
                "scope": " ".join(self._scopes()),
                "redirect_uri": cfg["redirect_uri"],
                "response_type": "code",
                "state": state,
            }
        )
        return f"{INTUIT_AUTHORIZE_URL}?{params}"

    async def handle_oauth_callback(self, code: str, state: str, realm_id: str) -> None:
        cfg = self._quickbooks_config()
        if not cfg["client_id"] or not cfg["client_secret"]:
            raise ValueError("QuickBooks OAuth client credentials are not configured.")
        if not realm_id:
            raise ValueError("QuickBooks OAuth response did not include realmId.")
        payload = self._verify_state(state)
        user_id = str(payload["u"])
        record = connected_accounts_repo.get_connection(user_id, QUICKBOOKS_PROVIDER) or {}
        pending = dict(record.get("pending_oauth_states") or {})
        if not pending.pop(state, None):
            raise ValueError("Missing QuickBooks OAuth state.")
        token_data = await self.adapter.exchange_token(
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            code=code,
            redirect_uri=cfg["redirect_uri"],
        )
        access_token = str(token_data.get("access_token") or "")
        refresh_token = str(token_data.get("refresh_token") or "")
        if not access_token or not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="QuickBooks OAuth response did not include access and refresh tokens.",
            )
        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(seconds=int(token_data.get("expires_in") or 3600))
        ).isoformat()
        company = await self.adapter.fetch_company_info(
            api_base_url=cfg["api_base_url"],
            access_token=access_token,
            realm_id=realm_id,
            minor_version=cfg["minor_version"],
        )
        self._save_metadata(
            user_id,
            {
                "encrypted_access_token": _encrypt_secret(access_token),
                "encrypted_refresh_token": _encrypt_secret(refresh_token),
                "expires_at": expires_at,
                "realm_id": realm_id,
                "company_name": company.get("CompanyName") or "QuickBooks",
                "country": company.get("Country"),
                "currency": company.get("CompanyAddr", {}).get("CountrySubDivisionCode"),
                "environment": cfg["environment"],
                "api_base_url": cfg["api_base_url"],
                "minor_version": cfg["minor_version"],
                "scopes": str(token_data.get("scope") or " ".join(self._scopes())).split(),
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
        record = connected_accounts_repo.get_connection(user_id, QUICKBOOKS_PROVIDER) or {}
        encrypted = record.get("encrypted_access_token")
        if not encrypted:
            raise HTTPException(status_code=401, detail="QuickBooks is not connected.")
        expires_at = str(record.get("expires_at") or "")
        if self._is_expired(expires_at):
            return await self._refresh_access_token(user_id, record)
        try:
            return _decrypt_secret(str(encrypted)), record
        except Exception as exc:
            logger.warning("Failed to decrypt QuickBooks access token: %s", exc)
            raise HTTPException(
                status_code=401,
                detail="QuickBooks token could not be decrypted. Please reconnect.",
            ) from exc

    async def _refresh_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any]]:
        cfg = self._quickbooks_config()
        encrypted_refresh = record.get("encrypted_refresh_token")
        if not encrypted_refresh:
            raise HTTPException(
                status_code=401,
                detail="QuickBooks refresh token is missing. Please reconnect.",
            )
        refresh_token = _decrypt_secret(str(encrypted_refresh))
        token_data = await self.adapter.refresh_token(
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            refresh_token=refresh_token,
        )
        access_token = str(token_data.get("access_token") or "")
        next_refresh = str(token_data.get("refresh_token") or refresh_token)
        if not access_token:
            raise HTTPException(status_code=401, detail="QuickBooks token refresh failed.")
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
        record = connected_accounts_repo.get_connection(user_id, QUICKBOOKS_PROVIDER) or {}
        return {
            "connected": bool(record.get("encrypted_access_token")),
            "realm_id": record.get("realm_id"),
            "company_name": record.get("company_name") or "QuickBooks",
            "environment": record.get("environment") or "production",
            "minor_version": record.get("minor_version") or DEFAULT_MINOR_VERSION,
            "country": record.get("country"),
            "currency": record.get("currency"),
            "scopes": record.get("scopes") or [],
            "selected_entities": record.get("selected_entities", []),
            "connected_at": record.get("connected_at"),
        }

    async def disconnect(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, QUICKBOOKS_PROVIDER)

    async def list_resources(self, user_id: str) -> Dict[str, Any]:
        _, record = await self._access_token(user_id)
        reports = [
            {
                "report_type": report_type,
                "label": REPORT_LABELS[report_type],
                "resource": "reports" if report_type in STATEMENT_REPORTS or report_type == "finance_overview" else ENTITY_REPORTS.get(report_type, "all"),
                "default": report_type == "finance_overview",
            }
            for report_type in [
                "finance_overview",
                "profit_and_loss",
                "balance_sheet",
                "cash_flow",
                "invoices",
                "bills",
                "payments",
                "customers",
                "vendors",
                "items",
                "accounts",
            ]
        ]
        return {
            "reports": reports,
            "realms": [
                {
                    "id": str(record.get("realm_id") or "all"),
                    "name": str(record.get("company_name") or "QuickBooks"),
                    "environment": str(record.get("environment") or "production"),
                }
            ],
        }

    def parse_entity_id(self, entity_id: str) -> Dict[str, str]:
        parts = str(entity_id or "").split(":")
        if len(parts) != 4 or parts[0] != "quickbooks":
            raise HTTPException(status_code=400, detail="Invalid QuickBooks entity id")
        report_type = parts[1]
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid QuickBooks report type")
        return {
            "report_type": report_type,
            "realm_id": parts[2] or "all",
            "resource_id": parts[3] or "all",
        }

    def _selected_entity(
        self, record: Dict[str, Any], report_type: str, resource_id: str
    ) -> Dict[str, Any]:
        realm_id = str(record.get("realm_id") or "all")
        company_name = str(record.get("company_name") or "QuickBooks")
        label = REPORT_LABELS.get(report_type, report_type.replace("_", " ").title())
        entity_id = f"quickbooks:{report_type}:{realm_id}:{resource_id or 'all'}"
        return {
            "id": entity_id,
            "name": f"{company_name} / {label}",
            "type": "report",
            "account_name": company_name,
            "realm_id": realm_id,
            "report_type": report_type,
            "resource_id": resource_id or "all",
            "connector_key": "quickbooks",
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
            cfg.setdefault("realm_id", parsed["realm_id"])
            cfg.setdefault("resource_id", parsed["resource_id"])
        return await self.sync(
            user_id=user_id,
            project_id=project_id,
            report_type=str(cfg.get("report_type") or "finance_overview"),
            date_preset=cfg.get("date_preset"),
            start_date=cfg.get("start_date"),
            end_date=cfg.get("end_date"),
            row_limit=cfg.get("row_limit"),
            include_pii=bool(cfg.get("include_pii", False)),
            max_bytes=cfg.get("max_bytes"),
            accounting_basis=str(cfg.get("accounting_basis") or "Accrual"),
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
        report_type: str = "finance_overview",
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        row_limit: Any = DEFAULT_ROW_LIMIT,
        include_pii: bool = False,
        max_bytes: Any = None,
        accounting_basis: str = "Accrual",
        resource_id: str = "all",
    ) -> Dict[str, Any]:
        if report_type not in VALID_REPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid QuickBooks report_type.")
        basis = str(accounting_basis or "Accrual").strip().lower()
        if basis not in {"accrual", "cash"}:
            raise HTTPException(
                status_code=400, detail="accounting_basis must be Accrual or Cash."
            )
        access_token, record = await self._access_token(user_id)
        realm_id = str(record.get("realm_id") or "")
        if not realm_id:
            raise HTTPException(status_code=400, detail="QuickBooks realm_id is missing.")
        api_base_url = str(record.get("api_base_url") or PRODUCTION_API_BASE_URL)
        minor_version = str(record.get("minor_version") or DEFAULT_MINOR_VERSION)
        row_cap = _normalize_row_limit(row_limit)
        byte_cap = _normalize_max_bytes(max_bytes or DEFAULT_MAX_EXPORT_BYTES)
        date_window = resolve_date_window(date_preset, start_date, end_date)
        if report_type in STATEMENT_REPORTS or report_type == "finance_overview":
            export = await self.adapter.fetch_report_rows(
                api_base_url=api_base_url,
                access_token=access_token,
                realm_id=realm_id,
                minor_version=minor_version,
                report_type=report_type,
                date_window=date_window,
                accounting_basis=basis.title(),
                row_limit=row_cap,
            )
        else:
            export = await self.adapter.fetch_entity_rows(
                api_base_url=api_base_url,
                access_token=access_token,
                realm_id=realm_id,
                minor_version=minor_version,
                report_type=report_type,
                date_window=date_window,
                row_limit=row_cap,
                include_pii=include_pii,
            )
        rows = list(export.get("rows") or [])[:row_cap]
        headers = REPORT_HEADERS[report_type]
        csv_content = _csv_bytes(headers, rows)
        if len(csv_content) > byte_cap:
            raise HTTPException(
                status_code=413,
                detail="QuickBooks extract exceeded the configured byte cap.",
            )
        return self._save_quickbooks_asset(
            user_id=user_id,
            project_id=project_id,
            record=record,
            report_type=report_type,
            resource_id=resource_id or "all",
            date_window=date_window,
            row_limit=row_cap,
            max_bytes=byte_cap,
            include_pii=include_pii,
            accounting_basis=basis.title(),
            api_mode=str(export.get("api_mode") or "accounting_api"),
            truncated=bool(export.get("truncated")) or len(rows) >= row_cap,
            endpoints_used=list(export.get("endpoints_used") or []),
            report_chunks=list(export.get("chunks") or [date_window]),
            headers=headers,
            rows=rows,
            csv_content=csv_content,
        )

    def _save_quickbooks_asset(
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
        accounting_basis: str,
        api_mode: str,
        truncated: bool,
        endpoints_used: Sequence[str],
        report_chunks: Sequence[Dict[str, str]],
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
            "connector_key": "quickbooks",
            "source_type": "quickbooks",
            "realm_id": record.get("realm_id"),
            "company_name": record.get("company_name"),
            "environment": record.get("environment") or "production",
            "minor_version": record.get("minor_version") or DEFAULT_MINOR_VERSION,
            "report_type": report_type,
            "resource_id": resource_id,
            "date_window": date_window,
            "accounting_basis": accounting_basis,
            "currency": record.get("currency"),
            "row_cap": row_limit,
            "byte_cap": max_bytes,
            "row_count": len(rows),
            "truncated": truncated,
            "api_mode": api_mode,
            "api_endpoints_used": list(endpoints_used),
            "report_chunks": list(report_chunks),
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
        manifest_key = f"{s3_key}.manifest.json"
        upload_bytes(
            bucket=bucket,
            key=manifest_key,
            data=json.dumps(manifest, sort_keys=True, default=str).encode("utf-8"),
            content_type="application/json",
        )
        filename = (
            f"quickbooks_{_sanitize_filename_part(report_type)}_"
            f"{date_window['from']}_{date_window['to']}.csv"
        )
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=QUICKBOOKS_ASSET_TYPE,
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
            user_id=user_id, provider=QUICKBOOKS_PROVIDER, entity=entity
        )
        updated = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_id,
            metadata={
                "connector_key": "quickbooks",
                "connector_entity_id": entity["id"],
                "connector_entity_name": entity["name"],
                "connector_account_name": entity["account_name"],
                "quickbooks_realm_id": record.get("realm_id"),
                "quickbooks_report_type": report_type,
                "quickbooks_manifest_s3_key": manifest_key,
                "quickbooks_manifest": manifest,
            },
        )
        return {
            "success": True,
            "message": f"Successfully synced {len(rows)} rows from QuickBooks ({entity['name']}).",
            "asset": updated or asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "entity_id": entity["id"],
            "truncated": truncated,
            "api_mode": api_mode,
        }


quickbooks_service = QuickBooksConnectorService()
