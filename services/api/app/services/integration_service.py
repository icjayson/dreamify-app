import io
import csv
import uuid
import json
import base64
import logging
import time
import asyncio
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

from clerk_backend_api import Clerk

from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import connected_accounts as connected_accounts_repo
from utils.dynamodb.repos import conversations as conversations_repo
from utils.dynamodb.repos import projects as projects_repo
from utils.dynamodb.repos import sync_runs as sync_runs_repo
from utils.dynamodb.repos import sync_schedules as sync_schedules_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes
from utils.s3.paths import build_asset_key
from app.services.warehouse_service import _decrypt_secret, _encrypt_secret

logger = logging.getLogger(__name__)


class TokenExpiredError(Exception):
    """Raised when a connector OAuth token is expired or missing during a scheduled sync."""

    def __init__(self, provider: str, reason: str = "Token expired or missing"):
        self.provider = provider
        super().__init__(f"{provider}: {reason}")


class IntegrationService:
    def __init__(self):
        self.clerk = Clerk(bearer_auth=config.clerk.CLERK_SECRET_KEY)

    def _hubspot_stored_token(
        self, record: Dict[str, Any], token_key: str
    ) -> Optional[str]:
        encrypted = record.get(f"encrypted_{token_key}")
        if encrypted:
            try:
                return _decrypt_secret(str(encrypted))
            except Exception as exc:
                logger.warning("Failed to decrypt HubSpot %s: %s", token_key, exc)
                raise HTTPException(
                    status_code=401,
                    detail="HubSpot token could not be decrypted. Please reconnect.",
                )
        token = record.get(token_key)
        return str(token) if token else None

    def _hubspot_token_metadata(
        self, access_token: str, refresh_token: str
    ) -> Dict[str, str]:
        return {
            "encrypted_access_token": _encrypt_secret(access_token),
            "encrypted_refresh_token": _encrypt_secret(refresh_token),
        }

    def _save_hubspot_metadata(
        self, user_id: str, metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        existing = connected_accounts_repo.get_connection(user_id, "hubspot") or {}
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
        connected_accounts_repo.delete_connection(user_id, "hubspot")
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider="hubspot",
            metadata={**preserved, **metadata},
        )

    def _salesforce_stored_token(
        self, record: Dict[str, Any], token_key: str
    ) -> Optional[str]:
        encrypted = record.get(f"encrypted_{token_key}")
        if encrypted:
            try:
                return _decrypt_secret(str(encrypted))
            except Exception as exc:
                logger.warning("Failed to decrypt Salesforce %s: %s", token_key, exc)
                raise HTTPException(
                    status_code=401,
                    detail="Salesforce token could not be decrypted. Please reconnect.",
                )
        token = record.get(token_key)
        return str(token) if token else None

    def _salesforce_token_metadata(
        self, access_token: str, refresh_token: str
    ) -> Dict[str, str]:
        return {
            "encrypted_access_token": _encrypt_secret(access_token),
            "encrypted_refresh_token": _encrypt_secret(refresh_token),
        }

    def _save_salesforce_metadata(
        self, user_id: str, metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        existing = connected_accounts_repo.get_connection(user_id, "salesforce") or {}
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
        connected_accounts_repo.delete_connection(user_id, "salesforce")
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider="salesforce",
            metadata={**preserved, **metadata},
        )

    def _pipedrive_stored_token(
        self, record: Dict[str, Any], token_key: str
    ) -> Optional[str]:
        encrypted = record.get(f"encrypted_{token_key}")
        if encrypted:
            try:
                return _decrypt_secret(str(encrypted))
            except Exception as exc:
                logger.warning("Failed to decrypt Pipedrive %s: %s", token_key, exc)
                raise HTTPException(
                    status_code=401,
                    detail="Pipedrive token could not be decrypted. Please reconnect.",
                )
        token = record.get(token_key)
        return str(token) if token else None

    def _pipedrive_token_metadata(
        self, access_token: str, refresh_token: str
    ) -> Dict[str, str]:
        return {
            "encrypted_access_token": _encrypt_secret(access_token),
            "encrypted_refresh_token": _encrypt_secret(refresh_token),
        }

    def _save_pipedrive_metadata(
        self, user_id: str, metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        existing = connected_accounts_repo.get_connection(user_id, "pipedrive") or {}
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
        connected_accounts_repo.delete_connection(user_id, "pipedrive")
        return connected_accounts_repo.upsert_provider_metadata(
            user_id=user_id,
            provider="pipedrive",
            metadata={**preserved, **metadata},
        )

    async def _get_google_access_token(self, user_id: str) -> Optional[str]:
        """Fetch the Google OAuth access token from Clerk for a given user."""
        try:
            # Clerk's API endpoint to get oauth access tokens
            # https://api.clerk.com/v1/users/{user_id}/oauth_access_tokens/{provider}
            response = await self.clerk.users.get_o_auth_access_token_async(
                user_id=user_id, provider="oauth_google"
            )
            # The response might be a paginated list or directly a list of tokens depending on version
            tokens = (
                getattr(response, "data", response)
                if hasattr(response, "data")
                else response
            )

            if tokens and len(tokens) > 0:
                # Return the top token
                return getattr(
                    tokens[0],
                    "token",
                    tokens[0].get("token") if isinstance(tokens[0], dict) else None,
                )
            return None
        except Exception as e:
            logger.error(
                f"Failed to fetch Google OAuth token from Clerk for user {user_id}: {e}"
            )
            return None

    async def fetch_google_analytics_data(
        self,
        user_id: str,
        property_id: str,
        project_id: str,
        start_date: str = "30daysAgo",
        end_date: str = "today",
        account_name: str = "",
        property_name: str = "",
    ) -> Dict[str, Any]:
        """Fetch Google Analytics data and save it as an asset."""
        access_token = await self._get_google_access_token(user_id)
        if not access_token:
            raise ValueError(
                "Google OAuth token not found for user. Please connect your Google account."
            )

        try:
            from google.oauth2.credentials import Credentials
            from google.analytics.data_v1beta import BetaAnalyticsDataAsyncClient
            from google.analytics.data_v1beta.types import (
                DateRange,
                Dimension,
                Metric,
                RunReportRequest,
            )

            # Create standard google credentials object with the token
            credentials = Credentials(token=access_token)

            # Initialize the Google Analytics Data API async client
            client = BetaAnalyticsDataAsyncClient(credentials=credentials)

            # Create a request to fetch traffic metrics over the specified date range
            request = RunReportRequest(
                property=f"properties/{property_id}",
                dimensions=[
                    Dimension(name="date"),
                    Dimension(name="region"),
                    Dimension(name="sessionSource"),
                    Dimension(name="deviceCategory"),
                ],
                metrics=[
                    Metric(name="sessions"),
                    Metric(name="activeUsers"),
                    Metric(name="newUsers"),
                    Metric(name="screenPageViews"),
                    Metric(name="bounceRate"),
                    Metric(name="averageSessionDuration"),
                ],
                date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
            )

            response = await client.run_report(request)

            # Structure the raw data into CSV format
            headers = [
                "Date",
                "Region",
                "Session Source",
                "Device Category",
                "Sessions",
                "Active Users",
                "New Users",
                "Page Views",
                "Bounce Rate",
                "Avg Session Duration",
            ]
            rows = []

            for row in response.rows:
                # Dimensions
                date_val = row.dimension_values[0].value
                region = row.dimension_values[1].value
                source = row.dimension_values[2].value
                device = row.dimension_values[3].value

                # Metrics
                sessions = row.metric_values[0].value
                active_users = row.metric_values[1].value
                new_users = row.metric_values[2].value
                page_views = row.metric_values[3].value
                bounce_rate = row.metric_values[4].value
                avg_session_duration = row.metric_values[5].value

                rows.append(
                    [
                        date_val,
                        region,
                        source,
                        device,
                        sessions,
                        active_users,
                        new_users,
                        page_views,
                        bounce_rate,
                        avg_session_duration,
                    ]
                )

            # Create a CSV in memory
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(headers)
            writer.writerows(rows)

            csv_content = output.getvalue().encode("utf-8")

            # Save the CSV as an asset using existing infrastructure
            asset_info = self._save_analytics_asset(
                user_id,
                project_id,
                csv_content,
                account_name,
                property_name,
                row_count=len(rows),
                column_count=len(headers),
            )
            connected_accounts_repo.append_selected_entity(
                user_id=user_id,
                provider="ga4",
                entity={
                    "id": str(property_id),
                    "name": property_name or f"Property {property_id}",
                    "type": "property",
                    "account_name": account_name,
                },
            )
            assets_repo.update_asset_metadata(
                user_id=user_id,
                asset_id=asset_info.get("asset_id"),
                metadata={
                    "connector_key": "ga4",
                    "connector_entity_id": str(property_id),
                    "connector_entity_name": property_name or f"Property {property_id}",
                },
            )

            return {
                "success": True,
                "message": "Google Analytics data synced successfully",
                "asset": asset_info,
                "row_count": len(rows),
                "column_count": len(headers),
            }

        except Exception as e:
            logger.error(f"Failed to fetch Google Analytics data: {e}")
            raise Exception(f"Failed to fetch Google Analytics data: {str(e)}")

    async def fetch_google_analytics_properties(self, user_id: str) -> Dict[str, Any]:
        """Fetch all Google Analytics accounts and their properties for the user."""
        t0 = time.time()
        access_token = await self._get_google_access_token(user_id)
        logger.info(
            f"[Perf] _get_google_access_token (Clerk) took {time.time() - t0:.2f}s"
        )

        if not access_token:
            logger.warning(
                f"No Google OAuth token available for user {user_id} - user needs to reconnect Google account"
            )
            return {
                "success": False,
                "accounts": [],
                "error": "Your Google account connection has expired or was not found. Please reconnect your Google account in your profile settings and ensure you grant Google Analytics access.",
            }

        try:
            from google.oauth2.credentials import Credentials
            from google.analytics.admin import AnalyticsAdminServiceAsyncClient

            # Create standard google credentials object with the token
            credentials = Credentials(token=access_token)

            # Initialize the modern Google Analytics Admin client asynchronously
            admin_client = AnalyticsAdminServiceAsyncClient(credentials=credentials)

            # 1. First, list all accounts the user has access to
            t1 = time.time()
            accounts_request = await admin_client.list_accounts()

            accounts = []
            async for account in accounts_request:
                accounts.append((account.name, account.display_name))
            logger.info(
                f"[Perf] list_accounts (GA) took {time.time() - t1:.2f}s, found {len(accounts)} accounts"
            )

            t2 = time.time()

            # Helper async function to fetch properties for a single account
            async def fetch_properties_for_account(account_name, account_display_name):
                properties_request = await admin_client.list_properties(
                    request={"filter": f"parent:{account_name}"}
                )
                prop_list = []
                async for prop in properties_request:
                    prop_name_full = prop.name
                    prop_id = prop_name_full.split("/")[-1] if prop_name_full else ""

                    prop_list.append(
                        {
                            "property_id": prop_id,
                            "display_name": prop.display_name,
                            "industry_category": str(prop.industry_category),
                            "time_zone": prop.time_zone,
                        }
                    )
                return {
                    "account_id": account_name.split("/")[-1] if account_name else "",
                    "account_name": account_display_name,
                    "properties": prop_list,
                }

            # 2. For each account, list its properties concurrently
            tasks = [
                fetch_properties_for_account(name, display)
                for name, display in accounts
            ]
            result_accounts = await asyncio.gather(*tasks)

            logger.info(
                f"[Perf] list_properties parallel (GA) took {time.time() - t2:.2f}s for {len(accounts)} accounts"
            )

            return {"success": True, "accounts": result_accounts}

        except Exception as e:
            error_str = str(e)
            logger.error(f"Failed to fetch Google Analytics properties: {error_str}")

            # Detect insufficient scope errors from Google
            if (
                "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in error_str
                or "insufficient authentication scopes" in error_str.lower()
            ):
                return {
                    "success": False,
                    "accounts": [],
                    "error": "Your Google account does not have Google Analytics access. Please reconnect your Google account and grant Analytics permissions when prompted.",
                }

            return {
                "success": False,
                "accounts": [],
                "error": f"Failed to load Google Analytics properties. Please try again later.",
            }

    def _save_integration_asset(
        self,
        user_id: str,
        project_id: str,
        file_content: bytes,
        filename: str,
        asset_type: str,
        extension: str,
        row_count: Optional[int] = None,
        column_count: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Save generic integration asset content as a user asset in S3 and DynamoDB."""
        asset_id = str(uuid.uuid4())
        file_id = str(uuid.uuid4())

        file_size = len(file_content)
        checksum = compute_sha256_checksum(file_content)
        content_type = "text/csv" if extension == "csv" else "application/octet-stream"

        bucket = config.aws.s3.USER_ASSETS_BUCKET
        s3_key = build_asset_key(
            user_id=user_id,
            project_id=project_id,
            asset_id=asset_id,
            file_id=file_id,
            extension=extension,
        )

        # Upload to S3
        upload_bytes(
            bucket=bucket,
            key=s3_key,
            data=file_content,
            content_type=content_type,
        )

        # Save to DynamoDB
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type=asset_type,
            size_bytes=file_size,
            checksum_sha256=checksum,
            version=config.aws.s3.USER_ASSETS_BUCKET_VERSION,
            content_type=content_type,
            asset_id=asset_id,
            file_id=file_id,
            original_filename=filename,
            extension=extension,
            row_count=row_count,
            column_count=column_count,
        )

        return asset

    def _save_analytics_asset(
        self,
        user_id: str,
        project_id: str,
        csv_content: bytes,
        account_name: str,
        property_name: str,
        row_count: Optional[int] = None,
        column_count: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Save the generated CSV content as a user asset in S3 and DynamoDB."""
        return self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_content,
            filename=f"{account_name}/{property_name}.csv",
            asset_type="integration_ga4",
            extension="csv",
            row_count=row_count,
            column_count=column_count,
        )

    async def fetch_google_sheet_data(
        self,
        user_id: str,
        file_id: str,
        project_id: str,
        access_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch Google Sheet data via the Drive API and save it as a CSV asset."""
        if not access_token:
            access_token = await self._get_google_access_token(user_id)
        if not access_token:
            raise ValueError(
                "Google OAuth token not found for user. Please connect your Google account."
            )

        try:
            async with httpx.AsyncClient() as client:
                # Get spreadsheet name from Drive API
                meta_resp = await client.get(
                    f"https://www.googleapis.com/drive/v3/files/{file_id}",
                    params={
                        "fields": "name",
                        "supportsAllDrives": "true",
                        "includeItemsFromAllDrives": "true",
                    },
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if meta_resp.status_code == 403:
                    raise ValueError(
                        "Google Drive access denied. Please re-open the spreadsheet via the Google Sheets picker or reconnect your account with the required permissions."
                    )
                if meta_resp.status_code == 404:
                    raise ValueError(
                        f"Google Sheet file not found (ID: {file_id}). Ensure the file exists and has not been deleted or moved."
                    )
                meta_resp.raise_for_status()
                filename = meta_resp.json().get("name", "google_sheet")
                if not filename.endswith(".csv"):
                    filename += ".csv"

                # Export first sheet as CSV via Drive API export endpoint
                export_resp = await client.get(
                    f"https://www.googleapis.com/drive/v3/files/{file_id}/export",
                    params={"mimeType": "text/csv", "supportsAllDrives": "true"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if export_resp.status_code == 403:
                    raise ValueError(
                        "Export access denied. You may need 'Editor' permissions on the spreadsheet to export it as CSV."
                    )
                export_resp.raise_for_status()
                csv_content = export_resp.content

            # Parse the CSV to get row/column counts
            try:
                reader = csv.reader(
                    io.StringIO(csv_content.decode("utf-8-sig"))
                )  # Handle BOM if present
                rows = list(reader)
            except UnicodeDecodeError:
                # Fallback for other encodings if UTF-8 fails
                reader = csv.reader(io.StringIO(csv_content.decode("latin-1")))
                rows = list(reader)

            headers = rows[0] if rows else []
            row_count = max(len(rows) - 1, 0)  # exclude header row
            column_count = len(headers)

            if not rows:
                raise Exception("The Google Sheet is empty")

            asset_info = self._save_integration_asset(
                user_id=user_id,
                project_id=project_id,
                file_content=csv_content,
                filename=filename,
                asset_type="integration_gsheets",
                extension="csv",
                row_count=row_count,
                column_count=column_count,
            )
            connected_accounts_repo.append_selected_entity(
                user_id=user_id,
                provider="google_sheets",
                entity={
                    "id": str(file_id),
                    "name": filename.replace(".csv", ""),
                    "type": "sheet",
                },
            )
            assets_repo.update_asset_metadata(
                user_id=user_id,
                asset_id=asset_info.get("asset_id"),
                metadata={
                    "connector_key": "google_sheets",
                    "connector_entity_id": str(file_id),
                    "connector_entity_name": filename.replace(".csv", ""),
                },
            )

            return {
                "success": True,
                "message": "Google Sheet data synced successfully",
                "asset": asset_info,
                "row_count": row_count,
                "column_count": column_count,
            }
        except httpx.HTTPStatusError as e:
            error_msg = (
                f"Google API error ({e.response.status_code}): {e.response.text}"
            )
            logger.error(f"Failed to fetch Google Sheet data: {error_msg}")
            raise Exception(error_msg)
        except Exception as e:
            logger.error(f"Failed to fetch Google Sheet data: {e}")
            raise Exception(str(e))

    # ── Meta OAuth helpers ────────────────────────────────────────────────────

    def _meta_config(self):
        if not config.meta:
            raise ValueError(
                "Meta configuration is missing from config.yaml. Add app_id, app_secret, and redirect_uri under the 'meta:' key."
            )
        return config.meta

    def _make_meta_state(self, user_id: str) -> str:
        """Create a signed, time-limited state token for CSRF protection."""
        ts = int(datetime.now(timezone.utc).timestamp())
        payload = f"{user_id}:{ts}"
        sig = hmac.new(
            config.app.secret_key.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"{payload}:{sig}"

    def _verify_meta_state(
        self, state: str, max_age_seconds: int = 600
    ) -> Optional[str]:
        """Verify the state token and return the user_id, or None if invalid."""
        try:
            parts = state.split(":")
            if len(parts) != 3:
                return None
            user_id, ts_str, sig = parts
            expected = hmac.new(
                config.app.secret_key.encode(),
                f"{user_id}:{ts_str}".encode(),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(sig, expected):
                return None
            age = int(datetime.now(timezone.utc).timestamp()) - int(ts_str)
            if age > max_age_seconds:
                return None
            return user_id
        except Exception:
            return None

    def get_meta_oauth_url(self, user_id: str) -> str:
        """Return the Facebook OAuth URL for the user to authorize."""
        meta = self._meta_config()
        state = self._make_meta_state(user_id)
        params = {
            "client_id": meta.app_id,
            "redirect_uri": meta.redirect_uri,
            "scope": "ads_read,business_management",
            "response_type": "code",
            "state": state,
        }
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"https://www.facebook.com/v21.0/dialog/oauth?{query}"

    async def handle_meta_oauth_callback(self, code: str, state: str) -> str:
        """Exchange the authorization code for a long-lived token, store it, return user_id."""
        user_id = self._verify_meta_state(state)
        if not user_id:
            raise ValueError("Invalid or expired OAuth state.")

        meta = self._meta_config()
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: exchange code for short-lived token
            resp = await client.get(
                "https://graph.facebook.com/v21.0/oauth/access_token",
                params={
                    "client_id": meta.app_id,
                    "client_secret": meta.app_secret,
                    "redirect_uri": meta.redirect_uri,
                    "code": code,
                },
            )
            resp.raise_for_status()
            short_lived_token = resp.json()["access_token"]

            # Step 2: exchange for long-lived token (~60 days)
            resp2 = await client.get(
                "https://graph.facebook.com/v21.0/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": meta.app_id,
                    "client_secret": meta.app_secret,
                    "fb_exchange_token": short_lived_token,
                },
            )
            resp2.raise_for_status()
            data = resp2.json()
            long_lived_token = data["access_token"]
            expires_in = data.get("expires_in", 5184000)  # default 60 days
            expires_at = (
                datetime.now(timezone.utc) + timedelta(seconds=expires_in)
            ).isoformat()

        connected_accounts_repo.save_connection(
            user_id=user_id,
            provider="facebook",
            access_token=long_lived_token,
            expires_at=expires_at,
        )
        return user_id

    def _get_facebook_access_token(self, user_id: str) -> Optional[str]:
        """Retrieve the stored Facebook access token from DynamoDB."""
        record = connected_accounts_repo.get_connection(user_id, "facebook")
        if not record:
            return None
        # Check expiry
        try:
            expires_at = datetime.fromisoformat(
                record["expires_at"].replace("Z", "+00:00")
            )
            if datetime.now(timezone.utc) >= expires_at:
                logger.warning(f"Facebook token expired for user {user_id}")
                return None
        except Exception:
            pass
        return record.get("access_token")

    def get_meta_connection_status(self, user_id: str) -> Dict[str, Any]:
        """Return whether the user has a valid stored Facebook token."""
        record = connected_accounts_repo.get_connection(user_id, "facebook")
        if not record:
            return {"connected": False}
        try:
            expires_at = datetime.fromisoformat(
                record["expires_at"].replace("Z", "+00:00")
            )
            if datetime.now(timezone.utc) >= expires_at:
                return {"connected": False, "reason": "expired"}
        except Exception:
            pass
        return {"connected": True, "expires_at": record.get("expires_at")}

    def disconnect_meta(self, user_id: str) -> None:
        """Remove the stored Facebook token."""
        connected_accounts_repo.delete_connection(user_id, "facebook")

    # ── Meta Ads data ─────────────────────────────────────────────────────────

    @staticmethod
    def _base_account_fields(acct: Dict) -> Dict:
        return {
            "id": acct.get("id", ""),
            "name": acct.get("name", ""),
            "account_status": acct.get("account_status", 0),
            "currency": acct.get("currency", ""),
            "timezone_name": acct.get("timezone_name", ""),
        }

    async def fetch_meta_ad_accounts(self, user_id: str) -> Dict[str, Any]:
        """Fetch personal + Business Suite ad accounts, merged and deduplicated."""
        access_token = self._get_facebook_access_token(user_id)
        if not access_token:
            return {
                "success": False,
                "ad_accounts": [],
                "has_business_management": False,
                "error": "Facebook account not connected or token expired. Please connect via the Meta Ads modal.",
            }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:

                async def _fetch_personal() -> List[Dict]:
                    r = await client.get(
                        "https://graph.facebook.com/v21.0/me/adaccounts",
                        params={
                            "fields": "id,name,account_status,currency,timezone_name",
                            "access_token": access_token,
                        },
                    )
                    r.raise_for_status()
                    return r.json().get("data", [])

                async def _fetch_businesses() -> tuple:
                    """Returns (businesses_list, has_business_management).
                    Gracefully returns ([], False) for tokens without business_management scope.
                    """
                    r = await client.get(
                        "https://graph.facebook.com/v21.0/me/businesses",
                        params={"fields": "id,name", "access_token": access_token},
                    )
                    body = r.json()
                    # Facebook returns permissions errors with an "error" key in the body,
                    # sometimes as HTTP 400 and sometimes as HTTP 200.
                    if "error" in body:
                        fb_code = body["error"].get("code")
                        if fb_code in (
                            200,
                            190,
                            10,
                        ):  # permission denied / bad token / app denied
                            return [], False
                        r.raise_for_status()
                    r.raise_for_status()
                    return body.get("data", []), True

                async def _fetch_business_accounts(biz: Dict) -> List[Dict]:
                    r = await client.get(
                        f"https://graph.facebook.com/v21.0/{biz['id']}/adaccounts",
                        params={
                            "fields": "id,name,account_status,currency,timezone_name",
                            "access_token": access_token,
                        },
                    )
                    if r.status_code in (400, 403):
                        logger.warning(
                            f"No access to ad accounts for business {biz['id']}: {r.text}"
                        )
                        return []
                    r.raise_for_status()
                    accounts = r.json().get("data", [])
                    for acct in accounts:
                        acct["_biz_id"] = biz["id"]
                        acct["_biz_name"] = biz["name"]
                    return accounts

                # Step 1: personal accounts + businesses list concurrently
                personal_raw, (businesses, has_biz_mgmt) = await asyncio.gather(
                    _fetch_personal(), _fetch_businesses()
                )

                # Step 2: all business account lists concurrently
                biz_batches = (
                    list(
                        await asyncio.gather(
                            *[_fetch_business_accounts(b) for b in businesses]
                        )
                    )
                    if businesses
                    else []
                )

            # Step 3: merge + deduplicate (personal wins on conflict)
            seen: set = set()
            accounts: List[Dict] = []

            for acct in personal_raw:
                aid = acct.get("id", "")
                if aid in seen:
                    continue
                seen.add(aid)
                accounts.append(
                    {
                        **self._base_account_fields(acct),
                        "source_type": "personal",
                        "business_id": None,
                        "business_name": None,
                    }
                )

            for batch in biz_batches:
                for acct in batch:
                    aid = acct.get("id", "")
                    if aid in seen:
                        continue
                    seen.add(aid)
                    accounts.append(
                        {
                            **self._base_account_fields(acct),
                            "source_type": "business",
                            "business_id": acct.get("_biz_id"),
                            "business_name": acct.get("_biz_name"),
                        }
                    )

            return {
                "success": True,
                "ad_accounts": accounts,
                "has_business_management": has_biz_mgmt,
            }

        except httpx.HTTPStatusError as e:
            error_body = e.response.text
            logger.error(
                f"Meta API error fetching ad accounts: {e.response.status_code} {error_body}"
            )
            if e.response.status_code in (401, 403):
                return {
                    "success": False,
                    "ad_accounts": [],
                    "has_business_management": False,
                    "error": "Facebook access denied. Please reconnect your Facebook account.",
                }
            return {
                "success": False,
                "ad_accounts": [],
                "has_business_management": False,
                "error": f"Meta API error ({e.response.status_code}). Please try again later.",
            }
        except Exception as e:
            logger.error(f"Failed to fetch Meta ad accounts: {e}")
            return {
                "success": False,
                "ad_accounts": [],
                "has_business_management": False,
                "error": "Failed to load Meta ad accounts. Please try again later.",
            }

    def _extract_action(self, actions: List[Dict], action_type: str) -> str:
        """Extract the value of a specific action type from Meta's actions array."""
        for action in actions or []:
            if action.get("action_type") == action_type:
                return action.get("value", "0")
        return "0"

    async def fetch_meta_campaigns(
        self,
        user_id: str,
        ad_account_id: str,
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch Meta Campaigns that have impressions/spend within a date range."""
        access_token = self._get_facebook_access_token(user_id)
        if not access_token:
            return {"success": False, "error": "Facebook account not connected."}

        try:
            params: Dict[str, Any] = {
                "fields": "campaign_id,campaign_name,objective",
                "level": "campaign",
                "limit": 500,
                "access_token": access_token,
            }

            if start_date and end_date:
                params["time_range"] = json.dumps(
                    {"since": start_date, "until": end_date}
                )
            else:
                params["date_preset"] = date_preset or "last_30d"

            url = f"https://graph.facebook.com/v21.0/{ad_account_id}/insights"
            all_campaigns = {}

            async with httpx.AsyncClient(timeout=30.0) as client:
                while url:
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    data = response.json()

                    for row in data.get("data", []):
                        camp_id = row.get("campaign_id")
                        if camp_id and camp_id not in all_campaigns:
                            all_campaigns[camp_id] = {
                                "id": camp_id,
                                "name": row.get("campaign_name", ""),
                                "objective": row.get("objective", ""),
                                "status": "ACTIVE",  # Since we're fetching from insights, they are somewhat active
                            }

                    paging = data.get("paging", {})
                    url = paging.get("next")
                    params = {}

            # Fallback if insights empty, just fetch recent campaigns? Or return empty.
            # Usually users might want to see campaigns even with no spend recently.
            # But per the design doc, fetching via insights is preferred to align with time_range.
            # Let's also fetch standard campaigns to get true status (ACTIVE/PAUSED).
            cmp_url = f"https://graph.facebook.com/v21.0/{ad_account_id}/campaigns"
            cmp_params = {
                "fields": "id,name,effective_status,objective",
                "limit": 500,
                "access_token": access_token,
            }
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(cmp_url, params=cmp_params)
                    if resp.status_code == 200:
                        cmp_data = resp.json().get("data", [])
                        cmp_map = {c["id"]: c for c in cmp_data}
                        # Merge statuses into the ones we found via insights
                        for camp_id, cmp in all_campaigns.items():
                            if camp_id in cmp_map:
                                cmp["status"] = cmp_map[camp_id].get(
                                    "effective_status", cmp["status"]
                                )
                                cmp["objective"] = cmp_map[camp_id].get(
                                    "objective", cmp["objective"]
                                )
            except Exception:
                pass  # Ignore if this fallback fails

            return {"success": True, "campaigns": list(all_campaigns.values())}
        except httpx.HTTPStatusError as e:
            logger.error(
                f"Meta API error fetching campaigns: {e.response.status_code} {e.response.text}"
            )
            return {
                "success": False,
                "error": f"Meta API error ({e.response.status_code})",
            }
        except Exception as e:
            logger.error(f"Failed to fetch Meta campaigns: {e}")
            return {"success": False, "error": str(e)}

    async def fetch_meta_adsets(
        self,
        user_id: str,
        ad_account_id: str,
        campaign_ids: List[str],
    ) -> Dict[str, Any]:
        """Fetch AdSets belonging to given campaigns."""
        access_token = self._get_facebook_access_token(user_id)
        if not access_token:
            return {"success": False, "error": "Facebook account not connected."}

        if not campaign_ids:
            return {"success": True, "adsets": []}

        try:
            params: Dict[str, Any] = {
                "fields": "id,name,effective_status,campaign_id",
                "limit": 500,
                "filtering": json.dumps(
                    [{"field": "campaign.id", "operator": "IN", "value": campaign_ids}]
                ),
                "access_token": access_token,
            }

            url = f"https://graph.facebook.com/v21.0/{ad_account_id}/adsets"
            all_adsets = []

            async with httpx.AsyncClient(timeout=30.0) as client:
                while url:
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    data = response.json()

                    for row in data.get("data", []):
                        all_adsets.append(
                            {
                                "id": row.get("id", ""),
                                "name": row.get("name", ""),
                                "status": row.get("effective_status", ""),
                                "campaign_id": row.get("campaign_id", ""),
                            }
                        )

                    paging = data.get("paging", {})
                    url = paging.get("next")
                    params = {}

            return {"success": True, "adsets": all_adsets}
        except httpx.HTTPStatusError as e:
            logger.error(
                f"Meta API error fetching adsets: {e.response.status_code} {e.response.text}"
            )
            return {
                "success": False,
                "error": f"Meta API error ({e.response.status_code})",
            }
        except Exception as e:
            logger.error(f"Failed to fetch Meta adsets: {e}")
            return {"success": False, "error": str(e)}

    async def fetch_meta_ads_data(
        self,
        user_id: str,
        ad_account_id: str,
        project_id: str,
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        account_name: str = "",
        adset_ids: Optional[List[str]] = None,
        campaign_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Fetch Meta Ads insights data and save it as a CSV asset."""
        access_token = self._get_facebook_access_token(user_id)
        if not access_token:
            raise ValueError(
                "Facebook account not connected or token expired. Please reconnect via the Meta Ads modal."
            )

        try:
            # We fetch adset level insights if we are syncing adsets, otherwise campaign
            sync_level = "adset" if adset_ids else "campaign"
            fields = (
                f"{sync_level}_id,{sync_level}_name,campaign_id,campaign_name,date_start,date_stop,"
                "impressions,clicks,reach,spend,ctr,cpc,cpm,frequency,actions"
            )
            params: Dict[str, Any] = {
                "fields": fields,
                "level": sync_level,
                "limit": 500,
                "access_token": access_token,
            }

            filtering = []
            if adset_ids:
                filtering.append(
                    {"field": "adset.id", "operator": "IN", "value": adset_ids}
                )
            elif campaign_ids:
                filtering.append(
                    {"field": "campaign.id", "operator": "IN", "value": campaign_ids}
                )

            if filtering:
                params["filtering"] = json.dumps(filtering)

            if start_date and end_date:
                params["time_range"] = json.dumps(
                    {"since": start_date, "until": end_date}
                )
            else:
                params["date_preset"] = date_preset or "last_30d"

            url = f"https://graph.facebook.com/v21.0/{ad_account_id}/insights"
            all_rows = []

            async with httpx.AsyncClient(timeout=60.0) as client:
                while url:
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    data = response.json()
                    all_rows.extend(data.get("data", []))

                    paging = data.get("paging", {})
                    url = paging.get("next")
                    params = {}  # next URL already contains all params

            headers = [
                f"{sync_level}_id",
                f"{sync_level}_name",
                "campaign_id",
                "campaign_name",
                "date_start",
                "date_stop",
                "impressions",
                "clicks",
                "reach",
                "spend",
                "ctr",
                "cpc",
                "cpm",
                "frequency",
                "link_clicks",
                "post_engagements",
                "purchases",
                "leads",
            ]

            csv_rows = []
            for row in all_rows:
                actions = row.get("actions", [])
                csv_rows.append(
                    [
                        row.get(f"{sync_level}_id", ""),
                        row.get(f"{sync_level}_name", ""),
                        row.get("campaign_id", ""),
                        row.get("campaign_name", ""),
                        row.get("date_start", ""),
                        row.get("date_stop", ""),
                        row.get("impressions", "0"),
                        row.get("clicks", "0"),
                        row.get("reach", "0"),
                        row.get("spend", "0"),
                        row.get("ctr", "0"),
                        row.get("cpc", "0"),
                        row.get("cpm", "0"),
                        row.get("frequency", "0"),
                        self._extract_action(actions, "link_click"),
                        self._extract_action(actions, "post_engagement"),
                        self._extract_action(actions, "purchase"),
                        self._extract_action(actions, "lead"),
                    ]
                )

            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(headers)
            writer.writerows(csv_rows)
            csv_content = output.getvalue().encode("utf-8")

            safe_account_name = account_name.replace("/", "_") or "meta_ads"
            asset_info = self._save_integration_asset(
                user_id=user_id,
                project_id=project_id,
                file_content=csv_content,
                filename=f"{safe_account_name}.csv",
                asset_type="integration_meta_ads",
                extension="csv",
                row_count=len(csv_rows),
                column_count=len(headers),
            )
            connected_accounts_repo.append_selected_entity(
                user_id=user_id,
                provider="meta_ads",
                entity={
                    "id": str(ad_account_id),
                    "name": account_name or f"Account {ad_account_id}",
                    "type": "account",
                },
            )
            assets_repo.update_asset_metadata(
                user_id=user_id,
                asset_id=asset_info.get("asset_id"),
                metadata={
                    "connector_key": "meta_ads",
                    "connector_entity_id": str(ad_account_id),
                    "connector_entity_name": account_name or f"Account {ad_account_id}",
                },
            )

            return {
                "success": True,
                "message": "Meta Ads data synced successfully",
                "asset": asset_info,
                "row_count": len(csv_rows),
                "column_count": len(headers),
            }

        except httpx.HTTPStatusError as e:
            logger.error(
                f"Meta API error fetching ads data: {e.response.status_code} {e.response.text}"
            )
            raise Exception(
                f"Meta API error ({e.response.status_code}): {e.response.text}"
            )
        except Exception as e:
            logger.error(f"Failed to fetch Meta Ads data: {e}")
            raise Exception(f"Failed to fetch Meta Ads data: {str(e)}")

    # ── TikTok OAuth helpers ────────────────────────────────────────────────────

    def _tiktok_config(self):
        if not config.tiktok:
            raise ValueError(
                "TikTok configuration is missing from config.yaml. Add app_id, app_secret, and redirect_uri under the 'tiktok:' key."
            )
        return config.tiktok

    def _make_tiktok_state(self, user_id: str) -> str:
        """Create a signed, time-limited state token for CSRF protection."""
        ts = int(datetime.now(timezone.utc).timestamp())
        payload = f"{user_id}:{ts}"
        sig = hmac.new(
            config.app.secret_key.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"{payload}:{sig}"

    def _verify_tiktok_state(
        self, state: str, max_age_seconds: int = 600
    ) -> Optional[str]:
        """Verify the state token and return the user_id, or None if invalid."""
        try:
            parts = state.split(":")
            if len(parts) != 3:
                return None
            user_id, ts_str, sig = parts
            expected = hmac.new(
                config.app.secret_key.encode(),
                f"{user_id}:{ts_str}".encode(),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(sig, expected):
                return None
            age = int(datetime.now(timezone.utc).timestamp()) - int(ts_str)
            if age > max_age_seconds:
                return None
            return user_id
        except Exception:
            return None

    def get_tiktok_oauth_url(self, user_id: str) -> str:
        """Return the TikTok OAuth URL for the user to authorize."""
        tiktok = self._tiktok_config()
        state = self._make_tiktok_state(user_id)
        params = {
            "app_id": tiktok.app_id,
            "redirect_uri": tiktok.redirect_uri,
            "state": state,
        }
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"https://business-api.tiktok.com/portal/auth?{query}"

    async def handle_tiktok_oauth_callback(self, auth_code: str, state: str) -> str:
        """Exchange the authorization code for an access token, store it, return user_id."""
        user_id = self._verify_tiktok_state(state)
        if not user_id:
            raise ValueError("Invalid or expired OAuth state.")

        tiktok = self._tiktok_config()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
                json={
                    "app_id": tiktok.app_id,
                    "secret": tiktok.app_secret,
                    "auth_code": auth_code,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise ValueError(f"TikTok OAuth error: {data.get('message')}")

            token_data = data.get("data", {})
            access_token = token_data.get("access_token")
            # TikTok tokens default to not expiring or long lived, but let's assume standard behavior
            # or we just mark them far in the future if no expires_in is provided
            expires_in = token_data.get(
                "expires_in", 31536000
            )  # assume 1 year if not provided
            expires_at = (
                datetime.now(timezone.utc) + timedelta(seconds=expires_in)
            ).isoformat()

        connected_accounts_repo.save_connection(
            user_id=user_id,
            provider="tiktok",
            access_token=access_token,
            expires_at=expires_at,
        )
        return user_id

    def _get_tiktok_access_token(self, user_id: str) -> Optional[str]:
        """Retrieve the stored TikTok access token from DynamoDB."""
        record = connected_accounts_repo.get_connection(user_id, "tiktok")
        if not record:
            return None
        try:
            expires_at = datetime.fromisoformat(
                record["expires_at"].replace("Z", "+00:00")
            )
            if datetime.now(timezone.utc) >= expires_at:
                logger.warning(f"TikTok token expired for user {user_id}")
                return None
        except Exception:
            pass
        return record.get("access_token")

    def get_tiktok_connection_status(self, user_id: str) -> Dict[str, Any]:
        """Return whether the user has a valid stored TikTok token."""
        record = connected_accounts_repo.get_connection(user_id, "tiktok")
        if not record:
            return {"connected": False}
        try:
            expires_at = datetime.fromisoformat(
                record["expires_at"].replace("Z", "+00:00")
            )
            if datetime.now(timezone.utc) >= expires_at:
                return {"connected": False, "reason": "expired"}
        except Exception:
            pass
        return {"connected": True, "expires_at": record.get("expires_at")}

    def disconnect_tiktok(self, user_id: str) -> None:
        """Remove the stored TikTok token."""
        connected_accounts_repo.delete_connection(user_id, "tiktok")

    # ── TikTok Ads data ─────────────────────────────────────────────────────────

    async def fetch_tiktok_ad_accounts(self, user_id: str) -> Dict[str, Any]:
        """Fetch TikTok ad accounts using the Advertiser API."""
        access_token = self._get_tiktok_access_token(user_id)
        if not access_token:
            return {
                "success": False,
                "ad_accounts": [],
                "error": "TikTok account not connected or token expired. Please connect via the TikTok modal.",
            }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.get(
                    "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/",
                    headers={"Access-Token": access_token},
                    params={
                        "app_id": self._tiktok_config().app_id,
                        "secret": self._tiktok_config().app_secret,
                    },
                )
                r.raise_for_status()
                data = r.json()

                if data.get("code") != 0:
                    return {
                        "success": False,
                        "ad_accounts": [],
                        "error": f"TikTok API error: {data.get('message')}",
                    }

                accounts = data.get("data", {}).get("list", [])

                mapped_accounts = []
                for acct in accounts:
                    mapped_accounts.append(
                        {
                            "id": str(acct.get("advertiser_id", "")),
                            "name": acct.get("advertiser_name", ""),
                            "account_status": 1,  # assuming ok
                            "currency": "",
                            "timezone_name": "",
                            "source_type": "business",
                        }
                    )

                return {
                    "success": True,
                    "ad_accounts": mapped_accounts,
                }
        except Exception as e:
            logger.error(f"Failed to fetch TikTok ad accounts: {e}")
            return {
                "success": False,
                "ad_accounts": [],
                "error": "Failed to load TikTok ad accounts. Please try again later.",
            }

    async def fetch_tiktok_ads_data(
        self,
        user_id: str,
        ad_account_id: str,
        project_id: str,
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        account_name: str = "",
    ) -> Dict[str, Any]:
        """Fetch TikTok Ads insights data and save it as a CSV asset."""
        access_token = self._get_tiktok_access_token(user_id)
        if not access_token:
            raise ValueError("TikTok account not connected or token expired.")

        try:
            if not start_date or not end_date:
                # default to last 30 days if not provided
                end = datetime.now(timezone.utc)
                start = end - timedelta(days=30)
                start_date = start.strftime("%Y-%m-%d")
                end_date = end.strftime("%Y-%m-%d")

            params: Dict[str, Any] = {
                "advertiser_id": ad_account_id,
                "data_level": "AUCTION_CAMPAIGN",
                "report_type": "BASIC",
                "start_date": start_date,
                "end_date": end_date,
                "page_size": 1000,
            }

            headers = {"Access-Token": access_token}

            url = "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/"

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.get(url, params=params, headers=headers)
                response.raise_for_status()
                data = response.json()

                if data.get("code") != 0:
                    raise Exception(f"TikTok API error: {data.get('message')}")

                all_rows = data.get("data", {}).get("list", [])

            csv_headers = [
                "campaign_id",
                "campaign_name",
                "date_start",
                "date_stop",
                "impressions",
                "clicks",
                "reach",
                "spend",
                "ctr",
                "cpc",
                "cpm",
                "frequency",
                "link_clicks",
                "post_engagements",
                "purchases",
                "leads",
            ]

            csv_rows = []
            for row in all_rows:
                metrics = row.get("metrics", {})
                dimensions = row.get("dimensions", {})
                csv_rows.append(
                    [
                        dimensions.get("campaign_id", ""),
                        dimensions.get("campaign_name", ""),
                        start_date,  # dimensions doesn't always have date
                        end_date,
                        metrics.get("impressions", "0"),
                        metrics.get("clicks", "0"),
                        metrics.get("reach", "0"),
                        metrics.get("spend", "0"),
                        metrics.get("ctr", "0"),
                        metrics.get("cpc", "0"),
                        metrics.get("cpm", "0"),
                        metrics.get("frequency", "0"),
                        metrics.get("conversion", "0"),  # link_clicks roughly
                        metrics.get("likes", "0"),  # post_engagements roughly
                        metrics.get("checkout", "0"),  # purchases
                        metrics.get("form", "0"),  # leads roughly
                    ]
                )

            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(csv_headers)
            writer.writerows(csv_rows)
            csv_content = output.getvalue().encode("utf-8")

            safe_account_name = account_name.replace("/", "_") or "tiktok_ads"
            asset_info = self._save_integration_asset(
                user_id=user_id,
                project_id=project_id,
                file_content=csv_content,
                filename=f"{safe_account_name}.csv",
                asset_type="integration_tiktok_ads",
                extension="csv",
                row_count=len(csv_rows),
                column_count=len(csv_headers),
            )
            connected_accounts_repo.append_selected_entity(
                user_id=user_id,
                provider="tiktok",
                entity={
                    "id": str(ad_account_id),
                    "name": account_name or f"Account {ad_account_id}",
                    "type": "account",
                },
            )
            assets_repo.update_asset_metadata(
                user_id=user_id,
                asset_id=asset_info.get("asset_id"),
                metadata={
                    "connector_key": "tiktok_ads",
                    "connector_entity_id": str(ad_account_id),
                    "connector_entity_name": account_name or f"Account {ad_account_id}",
                },
            )

            return {
                "success": True,
                "message": "TikTok Ads data synced successfully",
                "asset": asset_info,
                "row_count": len(csv_rows),
                "column_count": len(csv_headers),
            }

        except Exception as e:
            logger.error(f"Failed to fetch TikTok Ads data: {e}")
            raise Exception(f"Failed to fetch TikTok Ads data: {str(e)}")

    # ── AppsFlyer ─────────────────────────────────────────────────────────────

    async def validate_and_save_appsflyer_token(
        self, user_id: str, api_token: str
    ) -> bool:
        """Validate AppsFlyer API token via App List API, then store in DynamoDB."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://hq1.appsflyer.com/api/mng/apps",
                headers={"Authorization": f"Bearer {api_token}"},
            )
        if response.status_code in (401, 403):
            raise HTTPException(
                status_code=400,
                detail="Invalid AppsFlyer API token. Please check and try again.",
            )
        if response.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"AppsFlyer API error: {response.status_code}",
            )
        far_future = (datetime.now(timezone.utc) + timedelta(days=3650)).isoformat()
        connected_accounts_repo.save_connection(
            user_id=user_id,
            provider="appsflyer",
            access_token=api_token,
            expires_at=far_future,
        )
        return True

    async def get_appsflyer_connection_status(self, user_id: str) -> dict:
        """Return whether a valid AppsFlyer token exists for this user."""
        record = connected_accounts_repo.get_connection(user_id, "appsflyer")
        return {"connected": record is not None}

    async def fetch_appsflyer_apps(self, user_id: str) -> list:
        """Fetch list of apps from AppsFlyer using stored token."""
        record = connected_accounts_repo.get_connection(user_id, "appsflyer")
        if not record:
            raise HTTPException(
                status_code=401,
                detail="AppsFlyer not connected. Please add your API token first.",
            )
        api_token = record["access_token"]
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://hq1.appsflyer.com/api/mng/apps",
                headers={"Authorization": f"Bearer {api_token}"},
            )
        if response.status_code in (401, 403):
            connected_accounts_repo.delete_connection(user_id, "appsflyer")
            raise HTTPException(
                status_code=401,
                detail="AppsFlyer token is invalid or expired. Please reconnect.",
            )
        response.raise_for_status()
        data = response.json()
        apps = data.get("apps", [])
        return [
            {
                "app_id": app.get("app_id", ""),
                "app_name": app.get("app_name", app.get("app_id", "")),
                "platform": app.get("platform", "unknown"),
            }
            for app in apps
        ]

    async def fetch_appsflyer_data(
        self,
        user_id: str,
        app_id: str,
        app_name: str,
        project_id: str,
        date_preset: Optional[str],
        start_date: Optional[str],
        end_date: Optional[str],
    ) -> Dict[str, Any]:
        """Fetch AppsFlyer partners aggregate report and save as CSV asset."""
        record = connected_accounts_repo.get_connection(user_id, "appsflyer")
        if not record:
            raise HTTPException(status_code=401, detail="AppsFlyer not connected.")
        api_token = record["access_token"]

        today = datetime.now(timezone.utc).date()
        if date_preset and date_preset != "custom":
            if date_preset == "last_7d":
                from_date = today - timedelta(days=7)
                to_date = today - timedelta(days=1)
            elif date_preset == "last_30d":
                from_date = today - timedelta(days=30)
                to_date = today - timedelta(days=1)
            elif date_preset == "last_90d":
                from_date = today - timedelta(days=90)
                to_date = today - timedelta(days=1)
            elif date_preset == "this_month":
                from_date = today.replace(day=1)
                to_date = today
            elif date_preset == "last_month":
                first_this = today.replace(day=1)
                last_prev = first_this - timedelta(days=1)
                from_date = last_prev.replace(day=1)
                to_date = last_prev
            else:
                from_date = today - timedelta(days=30)
                to_date = today - timedelta(days=1)
        else:
            try:
                from_date = (
                    datetime.strptime(start_date, "%Y-%m-%d").date()
                    if start_date
                    else today - timedelta(days=30)
                )
                to_date = (
                    datetime.strptime(end_date, "%Y-%m-%d").date()
                    if end_date
                    else today - timedelta(days=1)
                )
            except (ValueError, TypeError):
                from_date = today - timedelta(days=30)
                to_date = today - timedelta(days=1)

        url = f"https://hq1.appsflyer.com/api/raw-data/export/app/{app_id}/partners_report/v5"
        params = {
            "from": from_date.strftime("%Y-%m-%d"),
            "to": to_date.strftime("%Y-%m-%d"),
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {api_token}"},
            )
        if response.status_code in (401, 403):
            raise HTTPException(
                status_code=401, detail="AppsFlyer token rejected. Please reconnect."
            )
        response.raise_for_status()

        csv_text = response.text
        csv_bytes = csv_text.encode("utf-8")

        # Count rows and columns from the CSV content
        reader_io = io.StringIO(csv_text)
        reader = csv.reader(reader_io)
        rows = list(reader)
        row_count = max(0, len(rows) - 1)  # exclude header
        column_count = len(rows[0]) if rows else 0

        filename = f"appsflyer_{app_id}_{from_date}_{to_date}.csv"
        asset = self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_bytes,
            filename=filename,
            asset_type="integration_appsflyer",
            extension="csv",
            row_count=row_count,
            column_count=column_count,
        )
        connected_accounts_repo.append_selected_entity(
            user_id=user_id,
            provider="appsflyer",
            entity={
                "id": str(app_id),
                "name": app_name or str(app_id),
                "type": "app",
            },
        )
        assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset.get("asset_id"),
            metadata={
                "connector_key": "appsflyer",
                "connector_entity_id": str(app_id),
                "connector_entity_name": app_name or str(app_id),
            },
        )
        return {
            "asset": asset,
            "row_count": row_count,
            "column_count": column_count,
            "message": f"Successfully synced {row_count} rows from AppsFlyer.",
        }

    async def disconnect_appsflyer(self, user_id: str) -> None:
        """Remove stored AppsFlyer token."""
        connected_accounts_repo.delete_connection(user_id, "appsflyer")

    # ── Stripe Connect ────────────────────────────────────────────────────────

    def _make_stripe_state(self, user_id: str) -> str:
        """Create a short-lived HMAC-signed state token to prevent CSRF."""
        ts = int(datetime.now(timezone.utc).timestamp())
        payload = f"{user_id}:{ts}"
        sig = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        return f"{payload}:{sig}"

    def _verify_stripe_state(self, state: str) -> str:
        """Verify state token and return user_id. Raises ValueError on failure."""
        parts = state.split(":")
        if len(parts) != 3:
            raise ValueError("Invalid state format")
        user_id, ts_str, sig = parts
        payload = f"{user_id}:{ts_str}"
        expected = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ValueError("Invalid state signature")
        if int(datetime.now(timezone.utc).timestamp()) - int(ts_str) > 600:
            raise ValueError("State token expired")
        return user_id

    def get_stripe_oauth_url(self, user_id: str) -> str:
        """Build the Stripe Connect OAuth authorization URL."""
        if not config.stripe.client_id:
            raise ValueError("Stripe Connect client_id is not configured.")
        state = self._make_stripe_state(user_id)
        redirect_uri = config.stripe.redirect_uri
        params = urlencode(
            {
                "client_id": config.stripe.client_id,
                "scope": "read_write",
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "state": state,
            }
        )
        return f"https://connect.stripe.com/oauth/authorize?{params}"

    async def handle_stripe_oauth_callback(self, code: str, state: str) -> None:
        """Exchange authorization code for stripe_user_id and persist it."""
        user_id = self._verify_stripe_state(state)

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://connect.stripe.com/oauth/token",
                data={
                    "client_secret": config.stripe.secret_key,
                    "code": code,
                    "grant_type": "authorization_code",
                },
            )

        if resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Stripe OAuth token exchange failed: {resp.text}",
            )

        data = resp.json()
        if "error" in data:
            raise HTTPException(
                status_code=400,
                detail=data.get("error_description", data["error"]),
            )

        stripe_user_id = data["stripe_user_id"]
        far_future = (datetime.now(timezone.utc) + timedelta(days=3650)).isoformat()
        connected_accounts_repo.save_connection(
            user_id=user_id,
            provider="stripe",
            access_token=stripe_user_id,
            expires_at=far_future,
        )

    async def get_stripe_connection_status(self, user_id: str) -> dict:
        """Return whether a valid Stripe connection exists for this user."""
        record = connected_accounts_repo.get_connection(user_id, "stripe")
        return {"connected": record is not None}

    # ── HubSpot CRM & Sales ──────────────────────────────────────────────────

    def _hubspot_config(self) -> Dict[str, Any]:
        """Resolve HubSpot OAuth config from config.yaml or environment."""
        hubspot_cfg = getattr(config, "hubspot", None)
        scopes = (
            list(getattr(hubspot_cfg, "scopes", []) or [])
            if hubspot_cfg
            else [
                "crm.objects.contacts.read",
                "crm.objects.companies.read",
                "crm.objects.deals.read",
                "crm.objects.owners.read",
            ]
        )
        return {
            "client_id": (getattr(hubspot_cfg, "client_id", "") if hubspot_cfg else "")
            or os.environ.get("HUBSPOT_CLIENT_ID", ""),
            "client_secret": (
                getattr(hubspot_cfg, "client_secret", "") if hubspot_cfg else ""
            )
            or os.environ.get("HUBSPOT_CLIENT_SECRET", ""),
            "redirect_uri": (
                getattr(hubspot_cfg, "redirect_uri", "") if hubspot_cfg else ""
            )
            or os.environ.get("HUBSPOT_REDIRECT_URI", ""),
            "scopes": scopes,
        }

    def _make_hubspot_state(self, user_id: str) -> str:
        ts = int(datetime.now(timezone.utc).timestamp())
        payload = f"{user_id}:{ts}"
        sig = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        return f"{payload}:{sig}"

    def _verify_hubspot_state(self, state: str) -> str:
        parts = state.split(":")
        if len(parts) != 3:
            raise ValueError("Invalid state format")
        user_id, ts_str, sig = parts
        payload = f"{user_id}:{ts_str}"
        expected = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ValueError("Invalid state signature")
        if int(datetime.now(timezone.utc).timestamp()) - int(ts_str) > 600:
            raise ValueError("State token expired")
        return user_id

    def get_hubspot_oauth_url(self, user_id: str) -> str:
        hubspot = self._hubspot_config()
        if not hubspot["client_id"] or not hubspot["redirect_uri"]:
            raise ValueError(
                "HubSpot OAuth client_id or redirect_uri is not configured."
            )
        params = urlencode(
            {
                "client_id": hubspot["client_id"],
                "redirect_uri": hubspot["redirect_uri"],
                "scope": " ".join(hubspot["scopes"]),
                "state": self._make_hubspot_state(user_id),
            }
        )
        return f"https://app.hubspot.com/oauth/authorize?{params}"

    async def handle_hubspot_oauth_callback(self, code: str, state: str) -> None:
        """Exchange HubSpot authorization code and persist token metadata."""
        user_id = self._verify_hubspot_state(state)
        hubspot = self._hubspot_config()
        if not hubspot["client_id"] or not hubspot["client_secret"]:
            raise ValueError("HubSpot OAuth client credentials are not configured.")

        async with httpx.AsyncClient(timeout=20.0) as client:
            token_resp = await client.post(
                "https://api.hubapi.com/oauth/v1/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": hubspot["client_id"],
                    "client_secret": hubspot["client_secret"],
                    "redirect_uri": hubspot["redirect_uri"],
                    "code": code,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"HubSpot OAuth token exchange failed: {token_resp.text}",
            )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        if not access_token or not refresh_token:
            raise HTTPException(
                status_code=400, detail="HubSpot OAuth response did not include tokens."
            )

        expires_in = int(token_data.get("expires_in") or 1800)
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=max(60, expires_in - 60))
        ).isoformat()
        account_metadata = await self._fetch_hubspot_account_metadata(access_token)
        self._save_hubspot_metadata(
            user_id=user_id,
            metadata={
                **self._hubspot_token_metadata(access_token, refresh_token),
                "expires_at": expires_at,
                **account_metadata,
            },
        )

    async def _fetch_hubspot_account_metadata(
        self, access_token: str
    ) -> Dict[str, Any]:
        """Fetch portal metadata for display/status without exposing tokens."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"https://api.hubapi.com/oauth/v1/access-tokens/{access_token}"
                )
            if resp.status_code != 200:
                return {}
            data = resp.json()
            portal_id = str(data.get("hub_id") or data.get("portalId") or "")
            portal_domain = str(data.get("hub_domain") or data.get("hubDomain") or "")
            return {
                "portal_id": portal_id,
                "portal_domain": portal_domain,
                "account_name": portal_domain
                or (f"HubSpot {portal_id}" if portal_id else "HubSpot"),
            }
        except Exception:
            return {}

    async def _get_hubspot_access_token(self, user_id: str) -> str:
        record = connected_accounts_repo.get_connection(user_id, "hubspot")
        if not record:
            raise HTTPException(status_code=401, detail="HubSpot not connected.")
        access_token = self._hubspot_stored_token(record, "access_token")
        refresh_token = self._hubspot_stored_token(record, "refresh_token")
        expires_at_raw = record.get("expires_at")
        if access_token and expires_at_raw:
            try:
                expires_at = datetime.fromisoformat(
                    str(expires_at_raw).replace("Z", "+00:00")
                )
                if datetime.now(timezone.utc) < expires_at:
                    return str(access_token)
            except Exception:
                pass
        if not refresh_token:
            raise HTTPException(
                status_code=401, detail="HubSpot token expired. Please reconnect."
            )
        return await self._refresh_hubspot_access_token(user_id, record)

    async def _refresh_hubspot_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> str:
        hubspot = self._hubspot_config()
        refresh_token = self._hubspot_stored_token(record, "refresh_token")
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.hubapi.com/oauth/v1/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": hubspot["client_id"],
                    "client_secret": hubspot["client_secret"],
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code != 200:
            connected_accounts_repo.delete_connection(user_id, "hubspot")
            raise HTTPException(
                status_code=401,
                detail="HubSpot token refresh failed. Please reconnect.",
            )
        data = resp.json()
        access_token = data.get("access_token")
        next_refresh_token = data.get("refresh_token") or refresh_token
        if not access_token or not next_refresh_token:
            raise HTTPException(
                status_code=401,
                detail="HubSpot token refresh response was incomplete. Please reconnect.",
            )
        expires_in = int(data.get("expires_in") or 1800)
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=max(60, expires_in - 60))
        ).isoformat()
        self._save_hubspot_metadata(
            user_id=user_id,
            metadata={
                **self._hubspot_token_metadata(
                    str(access_token), str(next_refresh_token)
                ),
                "expires_at": expires_at,
            },
        )
        return str(access_token)

    async def get_hubspot_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, "hubspot")
        if not record:
            return {"connected": False}
        return {
            "connected": bool(
                record.get("encrypted_access_token")
                or record.get("encrypted_refresh_token")
                or record.get("access_token")
                or record.get("refresh_token")
            ),
            "portal_id": record.get("portal_id"),
            "portal_domain": record.get("portal_domain"),
            "account_name": record.get("account_name") or "HubSpot",
        }

    async def disconnect_hubspot(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, "hubspot")

    async def fetch_hubspot_pipelines(self, user_id: str) -> List[Dict[str, Any]]:
        token = await self._get_hubspot_access_token(user_id)
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                "https://api.hubapi.com/crm/v3/pipelines/deals",
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code == 401:
            connected_accounts_repo.delete_connection(user_id, "hubspot")
            raise HTTPException(status_code=401, detail="HubSpot access revoked.")
        resp.raise_for_status()
        return [
            {
                "id": str(p.get("id") or ""),
                "label": p.get("label") or p.get("id") or "",
                "stages": [
                    {
                        "id": str(stage.get("id") or ""),
                        "label": stage.get("label") or stage.get("id") or "",
                        "probability": (stage.get("metadata") or {}).get("probability"),
                    }
                    for stage in p.get("stages", [])
                ],
            }
            for p in resp.json().get("results", [])
        ]

    async def fetch_hubspot_owners(self, user_id: str) -> List[Dict[str, Any]]:
        token = await self._get_hubspot_access_token(user_id)
        owners: List[Dict[str, Any]] = []
        after: Optional[str] = None
        async with httpx.AsyncClient(timeout=20.0) as client:
            while True:
                params = {"limit": 100}
                if after:
                    params["after"] = after
                resp = await client.get(
                    "https://api.hubapi.com/crm/v3/owners/",
                    params=params,
                    headers={"Authorization": f"Bearer {token}"},
                )
                if resp.status_code == 401:
                    connected_accounts_repo.delete_connection(user_id, "hubspot")
                    raise HTTPException(
                        status_code=401, detail="HubSpot access revoked."
                    )
                resp.raise_for_status()
                data = resp.json()
                for owner in data.get("results", []):
                    first = owner.get("firstName") or ""
                    last = owner.get("lastName") or ""
                    name = (
                        f"{first} {last}".strip()
                        or owner.get("email")
                        or owner.get("id")
                    )
                    owners.append(
                        {
                            "id": str(owner.get("id") or ""),
                            "email": owner.get("email") or "",
                            "name": name,
                        }
                    )
                after = (data.get("paging") or {}).get("next", {}).get("after")
                if not after:
                    break
        return owners

    # ── Salesforce CRM & Sales Cloud ─────────────────────────────────────────

    def _salesforce_config(self) -> Dict[str, Any]:
        """Resolve Salesforce OAuth config from config.yaml or environment."""
        salesforce_cfg = getattr(config, "salesforce", None)
        scopes = (
            list(getattr(salesforce_cfg, "scopes", []) or [])
            if salesforce_cfg
            else ["refresh_token", "api"]
        )
        return {
            "client_id": (
                getattr(salesforce_cfg, "client_id", "") if salesforce_cfg else ""
            )
            or os.environ.get("SALESFORCE_CLIENT_ID", ""),
            "client_secret": (
                getattr(salesforce_cfg, "client_secret", "") if salesforce_cfg else ""
            )
            or os.environ.get("SALESFORCE_CLIENT_SECRET", ""),
            "redirect_uri": (
                getattr(salesforce_cfg, "redirect_uri", "") if salesforce_cfg else ""
            )
            or os.environ.get("SALESFORCE_REDIRECT_URI", ""),
            "login_base_url": (
                getattr(salesforce_cfg, "login_base_url", "") if salesforce_cfg else ""
            )
            or os.environ.get(
                "SALESFORCE_LOGIN_BASE_URL", "https://login.salesforce.com"
            ),
            "api_version": (
                getattr(salesforce_cfg, "api_version", "") if salesforce_cfg else ""
            )
            or os.environ.get("SALESFORCE_API_VERSION", "v60.0"),
            "scopes": scopes,
        }

    def _make_salesforce_state(self, user_id: str) -> str:
        ts = int(datetime.now(timezone.utc).timestamp())
        payload = f"{user_id}:{ts}"
        sig = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        return f"{payload}:{sig}"

    def _verify_salesforce_state(self, state: str) -> str:
        parts = state.split(":")
        if len(parts) != 3:
            raise ValueError("Invalid state format")
        user_id, ts_str, sig = parts
        payload = f"{user_id}:{ts_str}"
        expected = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ValueError("Invalid state signature")
        if int(datetime.now(timezone.utc).timestamp()) - int(ts_str) > 600:
            raise ValueError("State token expired")
        return user_id

    def get_salesforce_oauth_url(self, user_id: str) -> str:
        salesforce = self._salesforce_config()
        if not salesforce["client_id"] or not salesforce["redirect_uri"]:
            raise ValueError(
                "Salesforce OAuth client_id or redirect_uri is not configured."
            )
        params = urlencode(
            {
                "response_type": "code",
                "client_id": salesforce["client_id"],
                "redirect_uri": salesforce["redirect_uri"],
                "scope": " ".join(salesforce["scopes"]),
                "state": self._make_salesforce_state(user_id),
            }
        )
        return f"{salesforce['login_base_url'].rstrip('/')}/services/oauth2/authorize?{params}"

    async def handle_salesforce_oauth_callback(self, code: str, state: str) -> None:
        """Exchange Salesforce authorization code and persist token metadata."""
        user_id = self._verify_salesforce_state(state)
        salesforce = self._salesforce_config()
        if not salesforce["client_id"] or not salesforce["client_secret"]:
            raise ValueError("Salesforce OAuth client credentials are not configured.")

        async with httpx.AsyncClient(timeout=20.0) as client:
            token_resp = await client.post(
                f"{salesforce['login_base_url'].rstrip('/')}/services/oauth2/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": salesforce["client_id"],
                    "client_secret": salesforce["client_secret"],
                    "redirect_uri": salesforce["redirect_uri"],
                    "code": code,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Salesforce OAuth token exchange failed: {token_resp.text}",
            )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        instance_url = str(token_data.get("instance_url") or "").rstrip("/")
        if not access_token or not refresh_token or not instance_url:
            raise HTTPException(
                status_code=400,
                detail="Salesforce OAuth response did not include tokens and instance_url.",
            )

        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=55)).isoformat()
        account_metadata = await self._fetch_salesforce_account_metadata(
            access_token=access_token,
            instance_url=instance_url,
            id_url=token_data.get("id"),
        )
        self._save_salesforce_metadata(
            user_id=user_id,
            metadata={
                **self._salesforce_token_metadata(access_token, refresh_token),
                "expires_at": expires_at,
                "instance_url": instance_url,
                "api_version": salesforce["api_version"],
                **account_metadata,
            },
        )

    async def _fetch_salesforce_account_metadata(
        self,
        access_token: str,
        instance_url: str,
        id_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch org/user metadata for display/status without exposing tokens."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                if id_url:
                    resp = await client.get(
                        str(id_url),
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                else:
                    resp = await client.get(
                        f"{instance_url}/services/oauth2/userinfo",
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
            if resp.status_code != 200:
                return {}
            data = resp.json()
            org_id = str(
                data.get("organization_id")
                or data.get("organizationId")
                or data.get("org_id")
                or ""
            )
            username = str(data.get("username") or data.get("preferred_username") or "")
            display_name = str(data.get("display_name") or data.get("name") or "")
            domain = instance_url.replace("https://", "").replace("http://", "")
            return {
                "org_id": org_id,
                "username": username,
                "instance_domain": domain,
                "account_name": display_name or username or domain or "Salesforce",
            }
        except Exception:
            return {}

    async def _get_salesforce_access_token(self, user_id: str) -> str:
        record = connected_accounts_repo.get_connection(user_id, "salesforce")
        if not record:
            raise HTTPException(status_code=401, detail="Salesforce not connected.")
        access_token = self._salesforce_stored_token(record, "access_token")
        refresh_token = self._salesforce_stored_token(record, "refresh_token")
        expires_at_raw = record.get("expires_at")
        if access_token and expires_at_raw:
            try:
                expires_at = datetime.fromisoformat(
                    str(expires_at_raw).replace("Z", "+00:00")
                )
                if datetime.now(timezone.utc) < expires_at:
                    return str(access_token)
            except Exception:
                pass
        if not refresh_token:
            raise HTTPException(
                status_code=401, detail="Salesforce token expired. Please reconnect."
            )
        return await self._refresh_salesforce_access_token(user_id, record)

    async def _refresh_salesforce_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> str:
        salesforce = self._salesforce_config()
        refresh_token = self._salesforce_stored_token(record, "refresh_token")
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{salesforce['login_base_url'].rstrip('/')}/services/oauth2/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": salesforce["client_id"],
                    "client_secret": salesforce["client_secret"],
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code != 200:
            connected_accounts_repo.delete_connection(user_id, "salesforce")
            raise HTTPException(
                status_code=401,
                detail="Salesforce token refresh failed. Please reconnect.",
            )
        data = resp.json()
        access_token = data.get("access_token")
        next_refresh_token = data.get("refresh_token") or refresh_token
        if not access_token or not next_refresh_token:
            raise HTTPException(
                status_code=401,
                detail="Salesforce token refresh response was incomplete. Please reconnect.",
            )
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=55)).isoformat()
        metadata: Dict[str, Any] = {
            **self._salesforce_token_metadata(
                str(access_token), str(next_refresh_token)
            ),
            "expires_at": expires_at,
        }
        if data.get("instance_url"):
            metadata["instance_url"] = str(data.get("instance_url")).rstrip("/")
        self._save_salesforce_metadata(user_id=user_id, metadata=metadata)
        return str(access_token)

    async def _salesforce_context(self, user_id: str) -> Dict[str, Any]:
        token = await self._get_salesforce_access_token(user_id)
        record = connected_accounts_repo.get_connection(user_id, "salesforce") or {}
        instance_url = str(record.get("instance_url") or "").rstrip("/")
        if not instance_url:
            raise HTTPException(
                status_code=401,
                detail="Salesforce instance URL missing. Please reconnect.",
            )
        return {
            "access_token": token,
            "instance_url": instance_url,
            "api_version": str(
                record.get("api_version") or self._salesforce_config()["api_version"]
            ),
            "org_id": record.get("org_id"),
            "instance_domain": record.get("instance_domain"),
            "account_name": record.get("account_name") or "Salesforce",
        }

    async def get_salesforce_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, "salesforce")
        if not record:
            return {"connected": False}
        return {
            "connected": bool(
                record.get("encrypted_access_token")
                or record.get("encrypted_refresh_token")
                or record.get("access_token")
                or record.get("refresh_token")
            ),
            "org_id": record.get("org_id"),
            "instance_url": record.get("instance_url"),
            "instance_domain": record.get("instance_domain"),
            "username": record.get("username"),
            "account_name": record.get("account_name") or "Salesforce",
        }

    async def disconnect_salesforce(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, "salesforce")

    async def fetch_salesforce_objects(self, user_id: str) -> List[Dict[str, Any]]:
        ctx = await self._salesforce_context(user_id)
        url = f"{ctx['instance_url']}/services/data/{ctx['api_version']}/sobjects"
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                url, headers={"Authorization": f"Bearer {ctx['access_token']}"}
            )
        if resp.status_code == 401:
            connected_accounts_repo.delete_connection(user_id, "salesforce")
            raise HTTPException(status_code=401, detail="Salesforce access revoked.")
        resp.raise_for_status()
        objects = []
        for item in resp.json().get("sobjects", []):
            if not item.get("queryable"):
                continue
            objects.append(
                {
                    "name": str(item.get("name") or ""),
                    "label": item.get("label") or item.get("name") or "",
                    "label_plural": item.get("labelPlural") or "",
                    "queryable": bool(item.get("queryable")),
                    "custom": bool(item.get("custom")),
                }
            )
        return objects

    async def fetch_salesforce_fields(
        self, user_id: str, object_name: str
    ) -> List[Dict[str, Any]]:
        clean_object = self._salesforce_validate_object_name(object_name)
        ctx = await self._salesforce_context(user_id)
        url = (
            f"{ctx['instance_url']}/services/data/{ctx['api_version']}"
            f"/sobjects/{clean_object}/describe"
        )
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                url, headers={"Authorization": f"Bearer {ctx['access_token']}"}
            )
        if resp.status_code == 401:
            connected_accounts_repo.delete_connection(user_id, "salesforce")
            raise HTTPException(status_code=401, detail="Salesforce access revoked.")
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Salesforce object not found.")
        resp.raise_for_status()
        fields = []
        for field in resp.json().get("fields", []):
            fields.append(
                {
                    "name": str(field.get("name") or ""),
                    "label": field.get("label") or field.get("name") or "",
                    "type": field.get("type") or "",
                    "filterable": bool(field.get("filterable")),
                    "sortable": bool(field.get("sortable")),
                    "nillable": bool(field.get("nillable")),
                    "custom": bool(field.get("custom")),
                }
            )
        return fields

    async def fetch_salesforce_owners(self, user_id: str) -> List[Dict[str, Any]]:
        ctx = await self._salesforce_context(user_id)
        soql = (
            "SELECT Id, Name, Email, IsActive FROM User "
            "WHERE IsActive = true ORDER BY Name LIMIT 500"
        )
        page = await self._salesforce_rest_query(ctx, soql)
        return [
            {
                "id": str(row.get("Id") or ""),
                "name": str(row.get("Name") or row.get("Email") or row.get("Id") or ""),
                "email": row.get("Email") or "",
            }
            for row in page.get("records", [])
            if row.get("Id")
        ]

    # ── Pipedrive CRM & Sales Pipeline ───────────────────────────────────────

    def _pipedrive_config(self) -> Dict[str, str]:
        pipedrive_cfg = getattr(config, "pipedrive", None)
        return {
            "client_id": (
                getattr(pipedrive_cfg, "client_id", "") if pipedrive_cfg else ""
            )
            or os.environ.get("PIPEDRIVE_CLIENT_ID", ""),
            "client_secret": (
                getattr(pipedrive_cfg, "client_secret", "") if pipedrive_cfg else ""
            )
            or os.environ.get("PIPEDRIVE_CLIENT_SECRET", ""),
            "redirect_uri": (
                getattr(pipedrive_cfg, "redirect_uri", "") if pipedrive_cfg else ""
            )
            or os.environ.get("PIPEDRIVE_REDIRECT_URI", ""),
            "oauth_base_url": (
                getattr(pipedrive_cfg, "oauth_base_url", "") if pipedrive_cfg else ""
            )
            or os.environ.get(
                "PIPEDRIVE_OAUTH_BASE_URL", "https://oauth.pipedrive.com/oauth"
            ),
            "api_base_url": (
                getattr(pipedrive_cfg, "api_base_url", "") if pipedrive_cfg else ""
            )
            or os.environ.get(
                "PIPEDRIVE_API_BASE_URL", "https://api.pipedrive.com/api/v1"
            ),
        }

    def _make_pipedrive_state(self, user_id: str) -> str:
        ts = int(datetime.now(timezone.utc).timestamp())
        payload = f"{user_id}:{ts}"
        sig = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        return f"{payload}:{sig}"

    def _verify_pipedrive_state(self, state: str) -> str:
        parts = state.split(":")
        if len(parts) != 3:
            raise ValueError("Invalid state format")
        user_id, ts_str, sig = parts
        payload = f"{user_id}:{ts_str}"
        expected = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ValueError("Invalid state signature")
        if int(datetime.now(timezone.utc).timestamp()) - int(ts_str) > 600:
            raise ValueError("State token expired")
        return user_id

    def _pipedrive_basic_auth_header(self, client_id: str, client_secret: str) -> str:
        raw = f"{client_id}:{client_secret}".encode("utf-8")
        return f"Basic {base64.b64encode(raw).decode('ascii')}"

    def get_pipedrive_oauth_url(self, user_id: str) -> str:
        pipedrive = self._pipedrive_config()
        if not pipedrive["client_id"] or not pipedrive["redirect_uri"]:
            raise ValueError(
                "Pipedrive OAuth client_id or redirect_uri is not configured."
            )
        params = urlencode(
            {
                "client_id": pipedrive["client_id"],
                "redirect_uri": pipedrive["redirect_uri"],
                "state": self._make_pipedrive_state(user_id),
            }
        )
        return f"{pipedrive['oauth_base_url'].rstrip('/')}/authorize?{params}"

    async def handle_pipedrive_oauth_callback(self, code: str, state: str) -> None:
        user_id = self._verify_pipedrive_state(state)
        pipedrive = self._pipedrive_config()
        if not pipedrive["client_id"] or not pipedrive["client_secret"]:
            raise ValueError("Pipedrive OAuth client credentials are not configured.")

        async with httpx.AsyncClient(timeout=20.0) as client:
            token_resp = await client.post(
                f"{pipedrive['oauth_base_url'].rstrip('/')}/token",
                data={
                    "grant_type": "authorization_code",
                    "redirect_uri": pipedrive["redirect_uri"],
                    "code": code,
                },
                headers={
                    "Authorization": self._pipedrive_basic_auth_header(
                        pipedrive["client_id"], pipedrive["client_secret"]
                    ),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Pipedrive OAuth token exchange failed: {token_resp.text}",
            )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        if not access_token or not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="Pipedrive OAuth response did not include tokens.",
            )
        expires_in = int(token_data.get("expires_in") or 3599)
        api_base_url = self._pipedrive_api_base_url(
            token_data.get("api_domain"), pipedrive["api_base_url"]
        )
        account_metadata = await self._fetch_pipedrive_account_metadata(
            access_token=str(access_token), api_base_url=api_base_url
        )
        self._save_pipedrive_metadata(
            user_id=user_id,
            metadata={
                **self._pipedrive_token_metadata(str(access_token), str(refresh_token)),
                "expires_at": (
                    datetime.now(timezone.utc)
                    + timedelta(seconds=max(60, expires_in - 60))
                ).isoformat(),
                "api_base_url": api_base_url,
                **account_metadata,
            },
        )

    def _pipedrive_api_base_url(
        self, api_domain: Optional[str], fallback_api_base_url: str
    ) -> str:
        domain = str(api_domain or "").rstrip("/")
        if domain:
            return f"{domain}/api/v1"
        return str(fallback_api_base_url or "https://api.pipedrive.com/api/v1").rstrip(
            "/"
        )

    async def _fetch_pipedrive_account_metadata(
        self, access_token: str, api_base_url: str
    ) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{api_base_url.rstrip('/')}/users/me",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            if resp.status_code != 200:
                return {}
            data = resp.json().get("data") or {}
            api_domain = api_base_url.replace("/api/v1", "")
            company_domain = str(data.get("company_domain") or "")
            return {
                "company_id": str(data.get("company_id") or ""),
                "company_name": str(data.get("company_name") or ""),
                "company_domain": company_domain
                or api_domain.replace("https://", "").replace("http://", ""),
                "pipedrive_user_id": str(data.get("id") or ""),
                "user_email": str(data.get("email") or ""),
                "account_name": str(data.get("company_name") or "")
                or company_domain
                or "Pipedrive",
            }
        except Exception:
            return {}

    async def _get_pipedrive_access_token(self, user_id: str) -> str:
        record = connected_accounts_repo.get_connection(user_id, "pipedrive")
        if not record:
            raise HTTPException(status_code=401, detail="Pipedrive not connected.")
        access_token = self._pipedrive_stored_token(record, "access_token")
        refresh_token = self._pipedrive_stored_token(record, "refresh_token")
        expires_at_raw = record.get("expires_at")
        if access_token and expires_at_raw:
            try:
                expires_at = datetime.fromisoformat(
                    str(expires_at_raw).replace("Z", "+00:00")
                )
                if datetime.now(timezone.utc) < expires_at:
                    return str(access_token)
            except Exception:
                pass
        if not refresh_token:
            raise HTTPException(
                status_code=401, detail="Pipedrive token expired. Please reconnect."
            )
        return await self._refresh_pipedrive_access_token(user_id, record)

    async def _refresh_pipedrive_access_token(
        self, user_id: str, record: Dict[str, Any]
    ) -> str:
        pipedrive = self._pipedrive_config()
        refresh_token = self._pipedrive_stored_token(record, "refresh_token")
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{pipedrive['oauth_base_url'].rstrip('/')}/token",
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                headers={
                    "Authorization": self._pipedrive_basic_auth_header(
                        pipedrive["client_id"], pipedrive["client_secret"]
                    ),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
        if resp.status_code != 200:
            connected_accounts_repo.delete_connection(user_id, "pipedrive")
            raise HTTPException(
                status_code=401,
                detail="Pipedrive token refresh failed. Please reconnect.",
            )
        data = resp.json()
        access_token = data.get("access_token")
        next_refresh_token = data.get("refresh_token") or refresh_token
        if not access_token or not next_refresh_token:
            raise HTTPException(
                status_code=401,
                detail="Pipedrive token refresh response was incomplete. Please reconnect.",
            )
        expires_in = int(data.get("expires_in") or 3599)
        metadata = {
            **self._pipedrive_token_metadata(
                str(access_token), str(next_refresh_token)
            ),
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(seconds=max(60, expires_in - 60))
            ).isoformat(),
        }
        if data.get("api_domain"):
            metadata["api_base_url"] = self._pipedrive_api_base_url(
                data.get("api_domain"), str(record.get("api_base_url") or "")
            )
        self._save_pipedrive_metadata(user_id=user_id, metadata=metadata)
        return str(access_token)

    async def _pipedrive_context(self, user_id: str) -> Dict[str, Any]:
        token = await self._get_pipedrive_access_token(user_id)
        record = connected_accounts_repo.get_connection(user_id, "pipedrive") or {}
        api_base_url = str(
            record.get("api_base_url") or self._pipedrive_config()["api_base_url"]
        ).rstrip("/")
        return {
            "access_token": token,
            "api_base_url": api_base_url,
            "company_id": record.get("company_id"),
            "company_domain": record.get("company_domain"),
            "company_name": record.get("company_name"),
            "account_name": record.get("account_name") or "Pipedrive",
        }

    async def get_pipedrive_connection_status(self, user_id: str) -> Dict[str, Any]:
        record = connected_accounts_repo.get_connection(user_id, "pipedrive")
        if not record:
            return {"connected": False}
        return {
            "connected": bool(
                record.get("encrypted_access_token")
                or record.get("encrypted_refresh_token")
                or record.get("access_token")
                or record.get("refresh_token")
            ),
            "company_id": record.get("company_id"),
            "company_domain": record.get("company_domain"),
            "company_name": record.get("company_name"),
            "user_email": record.get("user_email"),
            "account_name": record.get("account_name") or "Pipedrive",
        }

    async def disconnect_pipedrive(self, user_id: str) -> None:
        connected_accounts_repo.delete_connection(user_id, "pipedrive")

    async def _pipedrive_request(
        self,
        ctx: Dict[str, Any],
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        method: str = "GET",
        json_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = f"{str(ctx['api_base_url']).rstrip('/')}/{endpoint.lstrip('/')}"
        headers = {"Authorization": f"Bearer {ctx['access_token']}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            for attempt in range(3):
                resp = await client.request(
                    method, url, params=params, json=json_body, headers=headers
                )
                if resp.status_code == 429 and attempt < 2:
                    retry_after = float(resp.headers.get("Retry-After") or 0)
                    await asyncio.sleep(min(retry_after or 0.5 * (attempt + 1), 2.0))
                    continue
                if resp.status_code == 401:
                    raise HTTPException(
                        status_code=401,
                        detail="Pipedrive access revoked. Please reconnect.",
                    )
                if resp.status_code == 429:
                    raise HTTPException(
                        status_code=429,
                        detail="Pipedrive rate limit reached. Please retry later.",
                    )
                resp.raise_for_status()
                return resp.json()
        return {"success": False, "data": []}

    async def fetch_pipedrive_pipelines(self, user_id: str) -> List[Dict[str, Any]]:
        ctx = await self._pipedrive_context(user_id)
        pipelines_data = await self._pipedrive_request(ctx, "pipelines")
        stages_data = await self._pipedrive_request(ctx, "stages")
        stages_by_pipeline: Dict[str, List[Dict[str, Any]]] = {}
        for stage in stages_data.get("data") or []:
            pipeline_id = str(stage.get("pipeline_id") or "")
            stages_by_pipeline.setdefault(pipeline_id, []).append(
                {
                    "id": str(stage.get("id") or ""),
                    "label": str(stage.get("name") or stage.get("id") or ""),
                    "probability": stage.get("deal_probability"),
                }
            )
        return [
            {
                "id": str(pipeline.get("id") or ""),
                "label": str(pipeline.get("name") or pipeline.get("id") or ""),
                "stages": stages_by_pipeline.get(str(pipeline.get("id") or ""), []),
            }
            for pipeline in pipelines_data.get("data") or []
            if pipeline.get("id")
        ]

    async def fetch_pipedrive_users(self, user_id: str) -> List[Dict[str, Any]]:
        ctx = await self._pipedrive_context(user_id)
        page = await self._pipedrive_request(ctx, "users", params={"limit": 500})
        return [
            {
                "id": str(user.get("id") or ""),
                "name": str(user.get("name") or user.get("email") or user.get("id")),
                "email": str(user.get("email") or ""),
                "active": bool(user.get("active_flag", True)),
            }
            for user in page.get("data") or []
            if user.get("id")
        ]

    async def fetch_pipedrive_fields(
        self, user_id: str, object_name: str
    ) -> List[Dict[str, Any]]:
        object_key = self._pipedrive_validate_object_name(object_name)
        ctx = await self._pipedrive_context(user_id)
        endpoint = {
            "deal": "dealFields",
            "lead": "leadFields",
            "person": "personFields",
            "organization": "organizationFields",
            "activity": "activityFields",
            "product": "productFields",
        }[object_key]
        page = await self._pipedrive_request(ctx, endpoint, params={"limit": 500})
        return [
            {
                "key": str(field.get("key") or field.get("id") or ""),
                "name": str(field.get("name") or field.get("key") or ""),
                "field_type": str(field.get("field_type") or field.get("type") or ""),
                "custom": not bool(field.get("mandatory_flag", False))
                and str(field.get("key") or "").startswith(str(field.get("id") or "")),
                "options": field.get("options") or [],
            }
            for field in page.get("data") or []
            if field.get("key") or field.get("id")
        ]

    def _hubspot_report_label(
        self, report_type: str, pipeline_id: str = "all", owner_id: str = "all"
    ) -> str:
        labels = {
            "sales_pipeline": "Sales Pipeline",
            "contacts": "Contacts",
            "companies": "Companies",
            "activities": "Activities",
        }
        base = labels.get(report_type, report_type.replace("_", " ").title())
        filters = []
        if pipeline_id and pipeline_id != "all":
            filters.append(f"Pipeline {pipeline_id}")
        if owner_id and owner_id != "all":
            filters.append(f"Owner {owner_id}")
        return f"{base} ({', '.join(filters)})" if filters else base

    def _entity(self, entity_id: str, name: str, entity_type: str) -> Dict[str, str]:
        return {"id": str(entity_id), "name": str(name), "type": entity_type}

    def _connector_to_provider(self, connector_key: str) -> str:
        mapping = {
            "meta_ads": "meta_ads",
            "tiktok_ads": "tiktok",
            "google_ads": "google_ads",
            "ga4": "ga4",
            "appsflyer": "appsflyer",
            "firebase": "firebase",
            "google_sheets": "google_sheets",
            "stripe": "stripe",
            "hubspot": "hubspot",
            "salesforce": "salesforce",
            "pipedrive": "pipedrive",
            "shopify": "shopify",
            "klaviyo": "klaviyo",
            "quickbooks": "quickbooks",
            "zendesk": "zendesk",
            "mixpanel": "mixpanel",
            "posthog": "posthog",
            "amazon_seller": "amazon_seller",
            "tiktok_shop_seller": "tiktok_shop_seller",
            "shopee_seller": "shopee_seller",
            "lazada_seller": "lazada_seller",
            "supabase": "supabase",
            "postgres": "warehouse",
            "bigquery": "warehouse",
            "snowflake": "warehouse",
            "databricks": "warehouse",
        }
        if connector_key not in mapping:
            raise HTTPException(
                status_code=404, detail=f"Unsupported connector: {connector_key}"
            )
        return mapping[connector_key]

    def _connector_asset_type(self, connector_key: str) -> str:
        mapping = {
            "meta_ads": "integration_meta_ads",
            "tiktok_ads": "integration_tiktok_ads",
            "google_ads": "integration_google_ads",
            "ga4": "integration_ga4",
            "appsflyer": "integration_appsflyer",
            "firebase": "integration_firebase",
            "google_sheets": "integration_gsheets",
            "stripe": "integration_stripe",
            "hubspot": "integration_hubspot",
            "salesforce": "integration_salesforce",
            "pipedrive": "integration_pipedrive",
            "shopify": "integration_shopify",
            "klaviyo": "integration_klaviyo",
            "quickbooks": "integration_quickbooks",
            "zendesk": "integration_zendesk",
            "mixpanel": "integration_mixpanel",
            "posthog": "integration_posthog",
            "amazon_seller": "integration_amazon_seller",
            "tiktok_shop_seller": "integration_tiktok_shop_seller",
            "shopee_seller": "integration_shopee_seller",
            "lazada_seller": "integration_lazada_seller",
            "supabase": "integration_supabase",
            "postgres": "warehouse_extract",
            "bigquery": "warehouse_extract",
            "snowflake": "warehouse_extract",
            "databricks": "warehouse_extract",
        }
        return mapping.get(connector_key, "")

    def _extract_entity_id_from_schedule(
        self, provider: str, connector_config: Dict[str, Any]
    ) -> Optional[str]:
        if provider in {"meta_ads", "tiktok", "google_ads"}:
            return connector_config.get("ad_account_id")
        if provider == "ga4":
            return connector_config.get("property_id")
        if provider == "google_sheets":
            return connector_config.get("file_id")
        if provider == "appsflyer":
            return connector_config.get("app_id")
        if provider == "firebase":
            return connector_config.get("firebase_project_id")
        if provider == "hubspot":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_pipeline"
            pipeline_id = connector_config.get("pipeline_id") or "all"
            owner_id = connector_config.get("owner_id") or "all"
            return f"hubspot:{report_type}:{pipeline_id}:{owner_id}"
        if provider == "salesforce":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_pipeline"
            object_name = connector_config.get("object_name") or "all"
            owner_id = connector_config.get("owner_id") or "all"
            return f"salesforce:{report_type}:{object_name}:{owner_id}"
        if provider == "pipedrive":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_pipeline"
            pipeline_id = connector_config.get("pipeline_id") or "all"
            owner_id = connector_config.get("owner_id") or "all"
            return f"pipedrive:{report_type}:{pipeline_id}:{owner_id}"
        if provider == "shopify":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_overview"
            shop_domain = connector_config.get("shop_domain") or "shopify"
            resource = connector_config.get("resource") or "all"
            return f"shopify:{report_type}:{shop_domain}:{resource}"
        if provider == "klaviyo":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "lifecycle_overview"
            account_id = connector_config.get("account_id") or "all"
            resource_id = connector_config.get("resource_id") or "all"
            return f"klaviyo:{report_type}:{account_id}:{resource_id}"
        if provider == "quickbooks":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "finance_overview"
            realm_id = connector_config.get("realm_id") or "all"
            resource_id = connector_config.get("resource_id") or "all"
            return f"quickbooks:{report_type}:{realm_id}:{resource_id}"
        if provider == "zendesk":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "support_overview"
            subdomain = connector_config.get("subdomain") or "all"
            resource_id = connector_config.get("resource_id") or "all"
            return f"zendesk:{report_type}:{subdomain}:{resource_id}"
        if provider == "mixpanel":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "product_overview"
            project_id = connector_config.get("project_id") or "all"
            resource_id = connector_config.get("resource_id") or "all"
            return f"mixpanel:{report_type}:{project_id}:{resource_id}"
        if provider == "posthog":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "product_overview"
            project_id = connector_config.get("project_id") or "all"
            resource_id = connector_config.get("resource_id") or "all"
            return f"posthog:{report_type}:{project_id}:{resource_id}"
        if provider == "amazon_seller":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_overview"
            seller_id = connector_config.get("seller_id") or "all"
            marketplace_id = connector_config.get("marketplace_id") or "all"
            return f"amazon_seller:{report_type}:{seller_id}:{marketplace_id}"
        if provider == "tiktok_shop_seller":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_overview"
            shop_id = connector_config.get("shop_id") or "all"
            region = connector_config.get("region") or "US"
            return f"tiktok_shop_seller:{report_type}:{shop_id}:{region}"
        if provider == "shopee_seller":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_overview"
            shop_id = connector_config.get("shop_id") or "all"
            region = connector_config.get("region") or "VN"
            return f"shopee_seller:{report_type}:{shop_id}:{region}"
        if provider == "lazada_seller":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            report_type = connector_config.get("report_type") or "sales_overview"
            seller_id = connector_config.get("seller_id") or "all"
            region = connector_config.get("region") or "VN"
            return f"lazada_seller:{report_type}:{seller_id}:{region}"
        if provider == "supabase":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return str(entity_id)
            connection_id = connector_config.get("connection_id")
            sync_mode = connector_config.get("sync_mode") or "bounded_table_snapshot"
            schema = connector_config.get("schema") or connector_config.get(
                "schema_name"
            )
            table = connector_config.get("table") or connector_config.get("table_name")
            bucket = connector_config.get("bucket") or "all"
            if connection_id and sync_mode == "app_profile":
                return f"supabase:{connection_id}:storage:{bucket}"
            if connection_id and sync_mode == "profile_only":
                return f"supabase:{connection_id}:profile"
            if connection_id and schema and table:
                return f"supabase:{connection_id}:table:{schema}.{table}"
        if provider == "warehouse":
            entity_id = connector_config.get("entity_id")
            if entity_id:
                return entity_id
            connection_id = connector_config.get("connection_id")
            schema = connector_config.get("schema") or connector_config.get(
                "schema_name"
            )
            table = connector_config.get("table") or connector_config.get("table_name")
            if connection_id and schema and table:
                return f"{connection_id}:{schema}.{table}"
        return None

    def _find_schedule_for_entity(
        self,
        user_id: str,
        connector_key: str,
        entity_id: str,
    ) -> Optional[Dict[str, Any]]:
        provider = self._connector_to_provider(connector_key)
        schedules = sync_schedules_repo.list_active_schedules_by_provider(user_id).get(
            provider, []
        )
        for schedule in schedules:
            config = schedule.get("connector_config") or {}
            if str(
                self._extract_entity_id_from_schedule(provider, config) or ""
            ) == str(entity_id):
                return schedule
        # Fallback: if there is any active schedule for connector, use latest as template.
        return schedules[0] if schedules else None

    def _latest_asset_for_entity(
        self, user_id: str, connector_key: str, entity_id: str
    ) -> Optional[Dict[str, Any]]:
        assets = assets_repo.list_assets(
            user_id=user_id, asset_type=self._connector_asset_type(connector_key)
        )
        entity_assets = [
            a
            for a in assets
            if str(a.get("connector_entity_id", "")) == str(entity_id)
            and not a.get("cloned_from_asset_id")
        ]
        if entity_assets:
            entity_assets.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return entity_assets[0]
        if not assets:
            return None
        assets.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return assets[0]

    def _extract_selected_entities_from_schedule(
        self, schedule: Dict[str, Any]
    ) -> List[Dict[str, str]]:
        connector_config = schedule.get("connector_config") or {}
        provider = schedule.get("provider")
        account_name = (schedule.get("account_name") or "").strip()

        if provider == "ga4":
            property_id = connector_config.get("property_id")
            if property_id:
                property_name = (
                    connector_config.get("property_name")
                    or account_name
                    or f"Property {property_id}"
                )
                return [self._entity(str(property_id), str(property_name), "property")]

        if provider in {"meta_ads", "tiktok", "google_ads"}:
            ad_account_id = connector_config.get("ad_account_id")
            if ad_account_id:
                ad_account_name = account_name or f"Account {ad_account_id}"
                return [
                    self._entity(str(ad_account_id), str(ad_account_name), "account")
                ]

        if provider == "appsflyer":
            app_id = connector_config.get("app_id")
            if app_id:
                app_name = (
                    connector_config.get("app_name") or account_name or str(app_id)
                )
                return [self._entity(str(app_id), str(app_name), "app")]

        if provider == "firebase":
            project_id = connector_config.get("firebase_project_id")
            if project_id:
                project_name = (
                    connector_config.get("app_name") or account_name or str(project_id)
                )
                return [self._entity(str(project_id), str(project_name), "project")]

        if provider == "google_sheets":
            file_id = connector_config.get("file_id")
            if file_id:
                file_name = (
                    connector_config.get("file_name") or account_name or str(file_id)
                )
                return [self._entity(str(file_id), str(file_name), "sheet")]

        if provider == "warehouse":
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            schema = connector_config.get("schema") or connector_config.get(
                "schema_name"
            )
            table = connector_config.get("table") or connector_config.get("table_name")
            connector_key = connector_config.get("connector_key") or "postgres"
            if entity_id and schema and table:
                return [
                    {
                        "id": str(entity_id),
                        "name": f"{schema}.{table}",
                        "type": "table",
                        "account_name": account_name,
                        "connection_id": str(
                            connector_config.get("connection_id") or ""
                        ),
                        "connector_key": str(connector_key),
                        "database_type": str(connector_key),
                        "schema_name": str(schema),
                        "table_name": str(table),
                    }
                ]

        if provider == "stripe" and account_name:
            return [self._entity(account_name, account_name, "account")]

        if provider == "hubspot":
            report_type = str(connector_config.get("report_type") or "sales_pipeline")
            pipeline_id = str(connector_config.get("pipeline_id") or "all")
            owner_id = str(connector_config.get("owner_id") or "all")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or self._hubspot_report_label(report_type, pipeline_id, owner_id)
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "report_type": report_type,
                        "pipeline_id": pipeline_id,
                        "owner_id": owner_id,
                    }
                ]

        if provider == "salesforce":
            report_type = str(connector_config.get("report_type") or "sales_pipeline")
            object_name = str(connector_config.get("object_name") or "all")
            owner_id = str(connector_config.get("owner_id") or "all")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or self._salesforce_report_label(report_type, object_name, owner_id)
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "report_type": report_type,
                        "object_name": object_name,
                        "owner_id": owner_id,
                    }
                ]

        if provider == "pipedrive":
            report_type = str(connector_config.get("report_type") or "sales_pipeline")
            pipeline_id = str(connector_config.get("pipeline_id") or "all")
            owner_id = str(connector_config.get("owner_id") or "all")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or self._pipedrive_report_label(report_type, pipeline_id, owner_id)
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "report_type": report_type,
                        "pipeline_id": pipeline_id,
                        "owner_id": owner_id,
                    }
                ]

        if provider == "shopify":
            report_type = str(connector_config.get("report_type") or "sales_overview")
            shop_domain = str(connector_config.get("shop_domain") or "")
            resource = str(connector_config.get("resource") or "all")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "shop_domain": shop_domain,
                        "report_type": report_type,
                        "resource": resource,
                        "connector_key": "shopify",
                    }
                ]

        if provider == "klaviyo":
            report_type = str(
                connector_config.get("report_type") or "lifecycle_overview"
            )
            account_id = str(connector_config.get("account_id") or "all")
            resource_id = str(connector_config.get("resource_id") or "all")
            metric_id = str(connector_config.get("metric_id") or "")
            channel = str(connector_config.get("channel") or "all")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "account_id": account_id,
                        "report_type": report_type,
                        "resource_id": resource_id,
                        "metric_id": metric_id,
                        "channel": channel,
                        "connector_key": "klaviyo",
                    }
                ]

        if provider == "quickbooks":
            report_type = str(connector_config.get("report_type") or "finance_overview")
            realm_id = str(connector_config.get("realm_id") or "all")
            resource_id = str(connector_config.get("resource_id") or "all")
            accounting_basis = str(
                connector_config.get("accounting_basis") or "Accrual"
            )
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "realm_id": realm_id,
                        "report_type": report_type,
                        "resource_id": resource_id,
                        "accounting_basis": accounting_basis,
                        "connector_key": "quickbooks",
                    }
                ]

        if provider == "zendesk":
            report_type = str(connector_config.get("report_type") or "support_overview")
            subdomain = str(connector_config.get("subdomain") or "all")
            resource_id = str(connector_config.get("resource_id") or "all")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "subdomain": subdomain,
                        "report_type": report_type,
                        "resource_id": resource_id,
                        "connector_key": "zendesk",
                    }
                ]

        if provider == "mixpanel":
            report_type = str(connector_config.get("report_type") or "product_overview")
            project_id = str(connector_config.get("project_id") or "all")
            resource_id = str(connector_config.get("resource_id") or "all")
            region = str(connector_config.get("region") or "US")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "account_id": project_id,
                        "project_id": project_id,
                        "region": region,
                        "report_type": report_type,
                        "resource_id": resource_id,
                        "connector_key": "mixpanel",
                    }
                ]

        if provider == "posthog":
            report_type = str(connector_config.get("report_type") or "product_overview")
            project_id = str(connector_config.get("project_id") or "all")
            resource_id = str(connector_config.get("resource_id") or "all")
            region = str(connector_config.get("region") or "US")
            base_url = str(connector_config.get("base_url") or "")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "account_id": project_id,
                        "project_id": project_id,
                        "region": region,
                        "base_url": base_url,
                        "report_type": report_type,
                        "resource_id": resource_id,
                        "connector_key": "posthog",
                    }
                ]

        if provider == "amazon_seller":
            report_type = str(connector_config.get("report_type") or "sales_overview")
            seller_id = str(connector_config.get("seller_id") or "all")
            marketplace_id = str(connector_config.get("marketplace_id") or "all")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "seller_id": seller_id,
                        "report_type": report_type,
                        "marketplace_id": marketplace_id,
                        "connector_key": "amazon_seller",
                    }
                ]

        if provider == "tiktok_shop_seller":
            report_type = str(connector_config.get("report_type") or "sales_overview")
            shop_id = str(connector_config.get("shop_id") or "all")
            region = str(connector_config.get("region") or "US")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "shop_id": shop_id,
                        "region": region,
                        "report_type": report_type,
                        "connector_key": "tiktok_shop_seller",
                    }
                ]

        if provider == "shopee_seller":
            report_type = str(connector_config.get("report_type") or "sales_overview")
            shop_id = str(connector_config.get("shop_id") or "all")
            region = str(connector_config.get("region") or "VN")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "shop_id": shop_id,
                        "region": region,
                        "report_type": report_type,
                        "connector_key": "shopee_seller",
                    }
                ]

        if provider == "lazada_seller":
            report_type = str(connector_config.get("report_type") or "sales_overview")
            seller_id = str(connector_config.get("seller_id") or "all")
            region = str(connector_config.get("region") or "VN")
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            entity_name = (
                connector_config.get("entity_name")
                or account_name
                or report_type.replace("_", " ").title()
            )
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "report",
                        "account_name": account_name,
                        "seller_id": seller_id,
                        "region": region,
                        "report_type": report_type,
                        "connector_key": "lazada_seller",
                    }
                ]

        if provider == "supabase":
            entity_id = self._extract_entity_id_from_schedule(
                provider, connector_config
            )
            sync_mode = str(
                connector_config.get("sync_mode") or "bounded_table_snapshot"
            )
            schema = connector_config.get("schema") or connector_config.get(
                "schema_name"
            )
            table = connector_config.get("table") or connector_config.get("table_name")
            connection_id = str(connector_config.get("connection_id") or "")
            entity_name = connector_config.get("entity_name")
            if not entity_name:
                if schema and table:
                    entity_name = f"{schema}.{table}"
                elif sync_mode == "app_profile":
                    entity_name = "App Profile"
                else:
                    entity_name = "Schema Profile"
            if entity_id:
                return [
                    {
                        "id": str(entity_id),
                        "name": str(entity_name),
                        "type": "table" if schema and table else "profile",
                        "account_name": account_name,
                        "connection_id": connection_id,
                        "connector_key": "supabase",
                        "database_type": "supabase",
                        "schema_name": str(schema or ""),
                        "table_name": str(table or ""),
                        "sync_mode": sync_mode,
                    }
                ]

        return []

    def _unique_entities(self, entities: List[Dict[str, str]]) -> List[Dict[str, str]]:
        deduped: List[Dict[str, str]] = []
        index_by_id: Dict[str, int] = {}

        def _name_score(entity: Dict[str, str]) -> int:
            return self._entity_name_score(
                str(entity.get("name", "")), str(entity.get("id", ""))
            )

        for entity in entities:
            key = str(entity.get("id", ""))
            if key in index_by_id:
                idx = index_by_id[key]
                current = deduped[idx]
                if _name_score(entity) > _name_score(current):
                    merged = dict(current)
                    merged.update(entity)
                    deduped[idx] = merged
                continue
            index_by_id[key] = len(deduped)
            deduped.append(entity)
        return deduped

    def _entity_name_score(self, name: str, entity_id: str) -> int:
        raw_name = str(name or "").strip()
        raw_id = str(entity_id or "").strip()
        if not raw_name:
            return 0
        if raw_name == raw_id:
            return 1
        if raw_name.lower() == f"property {raw_id}".lower():
            return 2
        if raw_name.isdigit():
            return 3
        return 10

    def _pick_best_entity_name(self, entity_id: str, *candidates: Any) -> str:
        best = ""
        best_score = -1
        for candidate in candidates:
            candidate_name = str(candidate or "").strip()
            score = self._entity_name_score(candidate_name, str(entity_id))
            if score > best_score:
                best = candidate_name
                best_score = score
        return best or str(entity_id)

    async def fetch_connectors_overview(self, user_id: str) -> Dict[str, Any]:
        """
        Return connector connection state with selected entities only.
        """
        status_map: Dict[str, bool] = {}
        selected_entities_map: Dict[str, List[Dict[str, str]]] = {
            "meta_ads": [],
            "tiktok_ads": [],
            "google_ads": [],
            "ga4": [],
            "appsflyer": [],
            "firebase": [],
            "google_sheets": [],
            "stripe": [],
            "hubspot": [],
            "salesforce": [],
            "pipedrive": [],
            "shopify": [],
            "klaviyo": [],
            "quickbooks": [],
            "zendesk": [],
            "mixpanel": [],
            "posthog": [],
            "amazon_seller": [],
            "tiktok_shop_seller": [],
            "shopee_seller": [],
            "lazada_seller": [],
            "supabase": [],
            "postgres": [],
            "bigquery": [],
            "snowflake": [],
            "databricks": [],
        }

        # Connection statuses
        status_map["meta_ads"] = bool(
            self.get_meta_connection_status(user_id).get("connected")
        )
        status_map["tiktok_ads"] = bool(
            self.get_tiktok_connection_status(user_id).get("connected")
        )
        status_map["appsflyer"] = bool(
            (await self.get_appsflyer_connection_status(user_id)).get("connected")
        )
        status_map["stripe"] = bool(
            (await self.get_stripe_connection_status(user_id)).get("connected")
        )
        status_map["hubspot"] = bool(
            (await self.get_hubspot_connection_status(user_id)).get("connected")
        )
        status_map["salesforce"] = bool(
            (await self.get_salesforce_connection_status(user_id)).get("connected")
        )
        status_map["pipedrive"] = bool(
            (await self.get_pipedrive_connection_status(user_id)).get("connected")
        )
        from app.services.shopify_service import shopify_service

        status_map["shopify"] = bool(
            (await shopify_service.get_connection_status(user_id)).get("connected")
        )
        from app.services.klaviyo_service import klaviyo_service

        status_map["klaviyo"] = bool(
            (await klaviyo_service.get_connection_status(user_id)).get("connected")
        )
        from app.services.quickbooks_service import quickbooks_service

        status_map["quickbooks"] = bool(
            (await quickbooks_service.get_connection_status(user_id)).get("connected")
        )
        from app.services.zendesk_service import zendesk_service

        status_map["zendesk"] = bool(
            (await zendesk_service.get_connection_status(user_id)).get("connected")
        )
        from app.services.mixpanel_service import mixpanel_service

        status_map["mixpanel"] = bool(
            (await mixpanel_service.get_connection_status(user_id)).get("connected")
        )
        from app.services.posthog_service import posthog_service

        status_map["posthog"] = bool(
            (await posthog_service.get_connection_status(user_id)).get("connected")
        )
        from app.services.amazon_seller_service import amazon_seller_service

        status_map["amazon_seller"] = bool(
            (await amazon_seller_service.get_connection_status(user_id)).get(
                "connected"
            )
        )
        from app.services.tiktok_shop_seller_service import tiktok_shop_seller_service

        status_map["tiktok_shop_seller"] = bool(
            (await tiktok_shop_seller_service.get_connection_status(user_id)).get(
                "connected"
            )
        )
        from app.services.shopee_seller_service import shopee_seller_service

        status_map["shopee_seller"] = bool(
            (await shopee_seller_service.get_connection_status(user_id)).get(
                "connected"
            )
        )
        from app.services.lazada_seller_service import lazada_seller_service

        status_map["lazada_seller"] = bool(
            (await lazada_seller_service.get_connection_status(user_id)).get(
                "connected"
            )
        )
        from app.services.supabase_service import supabase_service

        status_map["supabase"] = bool(
            (await supabase_service.get_connection_status(user_id)).get("connected")
        )

        google_connected = bool(await self._get_google_access_token(user_id))
        status_map["ga4"] = google_connected
        status_map["google_sheets"] = google_connected
        status_map["google_ads"] = google_connected
        status_map["firebase"] = google_connected
        from app.services.warehouse_service import warehouse_service

        status_map["postgres"] = bool(
            warehouse_service.list_connections(user_id, connector_key="postgres")
        )
        status_map["bigquery"] = bool(
            warehouse_service.list_connections(user_id, connector_key="bigquery")
        )
        status_map["snowflake"] = bool(
            warehouse_service.list_connections(user_id, connector_key="snowflake")
        )
        status_map["databricks"] = bool(
            warehouse_service.list_connections(user_id, connector_key="databricks")
        )

        # Primary source: selected entities persisted at modal sync-time in DynamoDB.
        metadata_provider_map = {
            "meta_ads": "meta_ads",
            "tiktok_ads": "tiktok",
            "google_ads": "google_ads",
            "ga4": "ga4",
            "appsflyer": "appsflyer",
            "firebase": "firebase",
            "google_sheets": "google_sheets",
            "stripe": "stripe",
            "hubspot": "hubspot",
            "salesforce": "salesforce",
            "pipedrive": "pipedrive",
            "shopify": "shopify",
            "klaviyo": "klaviyo",
            "quickbooks": "quickbooks",
            "zendesk": "zendesk",
            "mixpanel": "mixpanel",
            "posthog": "posthog",
            "amazon_seller": "amazon_seller",
            "tiktok_shop_seller": "tiktok_shop_seller",
            "shopee_seller": "shopee_seller",
            "lazada_seller": "lazada_seller",
            "supabase": "supabase",
        }
        for connector_key, provider in metadata_provider_map.items():
            record = connected_accounts_repo.get_connection(user_id, provider) or {}
            entities = record.get("selected_entities", [])
            if isinstance(entities, list):
                selected_entities_map[connector_key].extend(entities)

        warehouse_record = (
            connected_accounts_repo.get_connection(user_id, "warehouse") or {}
        )
        warehouse_entities = warehouse_record.get("selected_entities", [])
        if isinstance(warehouse_entities, list):
            for entity in warehouse_entities:
                entity_connector = str(entity.get("connector_key") or "postgres")
                if entity_connector in {
                    "postgres",
                    "bigquery",
                    "snowflake",
                    "databricks",
                }:
                    selected_entities_map[entity_connector].append(entity)

        # Legacy fallback: infer previously selected entities from schedule connector_config.
        schedules_by_provider = sync_schedules_repo.list_active_schedules_by_provider(
            user_id
        )
        provider_to_connector = {
            "meta_ads": "meta_ads",
            "tiktok": "tiktok_ads",
            "ga4": "ga4",
            "appsflyer": "appsflyer",
            "stripe": "stripe",
            "hubspot": "hubspot",
            "salesforce": "salesforce",
            "pipedrive": "pipedrive",
            "shopify": "shopify",
            "klaviyo": "klaviyo",
            "quickbooks": "quickbooks",
            "zendesk": "zendesk",
            "mixpanel": "mixpanel",
            "posthog": "posthog",
            "amazon_seller": "amazon_seller",
            "tiktok_shop_seller": "tiktok_shop_seller",
            "shopee_seller": "shopee_seller",
            "lazada_seller": "lazada_seller",
            "supabase": "supabase",
            "google_ads": "google_ads",
            "firebase": "firebase",
            "google_sheets": "google_sheets",
        }
        for provider, schedules in schedules_by_provider.items():
            if provider == "warehouse":
                for schedule in schedules:
                    entities = self._extract_selected_entities_from_schedule(schedule)
                    for entity in entities:
                        entity_connector = str(
                            entity.get("connector_key") or "postgres"
                        )
                        if entity_connector in {
                            "postgres",
                            "bigquery",
                            "snowflake",
                            "databricks",
                        }:
                            selected_entities_map[entity_connector].append(entity)
                continue
            connector_key = provider_to_connector.get(provider)
            if not connector_key:
                continue
            for schedule in schedules:
                selected_entities_map[connector_key].extend(
                    self._extract_selected_entities_from_schedule(schedule)
                )

        connectors = [
            {"connector_key": "meta_ads", "display_name": "Meta Ads"},
            {"connector_key": "tiktok_ads", "display_name": "TikTok Ads"},
            {"connector_key": "google_ads", "display_name": "Google Ads"},
            {"connector_key": "ga4", "display_name": "GA4"},
            {"connector_key": "appsflyer", "display_name": "AppsFlyer"},
            {"connector_key": "firebase", "display_name": "Firebase"},
            {"connector_key": "google_sheets", "display_name": "Google Sheets"},
            {"connector_key": "hubspot", "display_name": "HubSpot"},
            {"connector_key": "salesforce", "display_name": "Salesforce"},
            {"connector_key": "pipedrive", "display_name": "Pipedrive"},
            {"connector_key": "shopify", "display_name": "Shopify"},
            {"connector_key": "klaviyo", "display_name": "Klaviyo"},
            {"connector_key": "quickbooks", "display_name": "QuickBooks"},
            {"connector_key": "zendesk", "display_name": "Zendesk"},
            {"connector_key": "mixpanel", "display_name": "Mixpanel"},
            {"connector_key": "posthog", "display_name": "PostHog"},
            {"connector_key": "amazon_seller", "display_name": "Amazon Seller"},
            {
                "connector_key": "tiktok_shop_seller",
                "display_name": "TikTok Shop Seller",
            },
            {"connector_key": "shopee_seller", "display_name": "Shopee Seller"},
            {"connector_key": "lazada_seller", "display_name": "Lazada Seller"},
            {"connector_key": "supabase", "display_name": "Supabase"},
            {"connector_key": "postgres", "display_name": "PostgreSQL"},
            {"connector_key": "bigquery", "display_name": "BigQuery"},
            {"connector_key": "snowflake", "display_name": "Snowflake"},
            {"connector_key": "databricks", "display_name": "Databricks"},
            {"connector_key": "stripe", "display_name": "Stripe"},
        ]

        overview_items = []
        for connector in connectors:
            key = connector["connector_key"]
            overview_items.append(
                {
                    "connector_key": key,
                    "display_name": connector["display_name"],
                    "connected": status_map.get(key, False),
                    "selected_entities": self._unique_entities(
                        selected_entities_map.get(key, [])
                    ),
                }
            )

        return {"success": True, "connectors": overview_items}

    async def get_connector_entity_detail(
        self, user_id: str, connector_key: str, entity_id: str
    ) -> Dict[str, Any]:
        provider = self._connector_to_provider(connector_key)
        connection = connected_accounts_repo.get_connection(user_id, provider) or {}
        sync_version_name_map = (connection.get("sync_version_names") or {}).get(
            str(entity_id), {}
        ) or {}
        selected_entities = connection.get("selected_entities", []) or []
        entity = next(
            (e for e in selected_entities if str(e.get("id", "")) == str(entity_id)),
            None,
        )
        if not entity:
            # Fallback to schedule-derived selection
            schedule = self._find_schedule_for_entity(user_id, connector_key, entity_id)
            if schedule:
                entities = self._extract_selected_entities_from_schedule(schedule)
                entity = next(
                    (e for e in entities if str(e.get("id", "")) == str(entity_id)),
                    None,
                )
        if not entity:
            entity = {"id": str(entity_id), "name": str(entity_id), "type": "entity"}

        schedule = self._find_schedule_for_entity(user_id, connector_key, entity_id)
        latest_asset = self._latest_asset_for_entity(user_id, connector_key, entity_id)

        # ── Resolve account_name from schedule or connection metadata ──────
        account_name = ""
        if schedule:
            account_name = (schedule.get("account_name") or "").strip()
        if not account_name and entity:
            account_name = (entity.get("account_name") or "").strip()
        if not account_name:
            # Try to derive from connection metadata or entity name
            account_name = (connection.get("account_name") or "").strip()

        related_projects = []
        assets = assets_repo.list_assets(
            user_id=user_id, asset_type=self._connector_asset_type(connector_key)
        )
        entity_assets = [
            a for a in assets if str(a.get("connector_entity_id", "")) == str(entity_id)
        ]
        entity_assets.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        project_latest_entity_asset = {}
        for asset in entity_assets:
            pid = asset.get("project_id")
            if pid and pid not in project_latest_entity_asset:
                project_latest_entity_asset[pid] = asset

        # Resolve run_id by asset_id so we can map custom sync version names.
        asset_id_to_run_id: Dict[str, str] = {}
        runs, _ = sync_runs_repo.list_runs_for_user(user_id=user_id, limit=500)
        for run in runs:
            if run.get("provider") != provider:
                continue
            run_asset_id = str(run.get("asset_id") or "")
            if not run_asset_id:
                continue
            schedule_id = run.get("schedule_id")
            if not schedule_id:
                continue
            sched = sync_schedules_repo.get_schedule(user_id, schedule_id)
            cfg: Dict[str, Any] = (sched or {}).get("connector_config") or {}
            snapshot = run.get("config_snapshot") or {}
            run_entity_id = self._extract_entity_id_from_schedule(
                provider, cfg
            ) or snapshot.get("entity_id")
            if str(run_entity_id or "") != str(entity_id):
                continue
            asset_id_to_run_id[run_asset_id] = str(run.get("run_id"))

        def _resolve_sync_version_name_for_asset(
            asset_rec: Dict[str, Any],
        ) -> Optional[str]:
            """Resolve sync version name for an asset, following cloned_from_asset_id chain."""
            aid = str(asset_rec.get("asset_id") or "")
            if not aid:
                return None
            name = sync_version_name_map.get(f"asset-{aid}")
            if not name:
                mapped_run = asset_id_to_run_id.get(aid)
                if mapped_run:
                    name = sync_version_name_map.get(mapped_run)
            if not name:
                source_aid = str(asset_rec.get("cloned_from_asset_id") or "")
                if source_aid:
                    name = sync_version_name_map.get(f"asset-{source_aid}")
                    if not name:
                        mapped_run = asset_id_to_run_id.get(source_aid)
                        if mapped_run:
                            name = sync_version_name_map.get(mapped_run)
            return name

        project_ids = []
        seen_projects = set()
        for asset in entity_assets:
            pid = asset.get("project_id")
            if not pid or pid in seen_projects:
                continue
            seen_projects.add(pid)
            project_ids.append(pid)
        if (
            latest_asset
            and latest_asset.get("project_id")
            and latest_asset.get("project_id") not in seen_projects
        ):
            project_ids.insert(0, latest_asset.get("project_id"))

        for pid in project_ids:
            project = projects_repo.get_project(user_id, pid)
            if not project:
                continue
            # Only show projects that have an actual conversation or dashboard.
            # This filters out auto-created placeholder projects from initial sync.
            has_conversation = bool(project.get("latest_conversation_id"))
            has_dashboard = bool(project.get("latest_dashboard_id"))
            if not has_conversation and not has_dashboard:
                continue

            project_asset = project_latest_entity_asset.get(pid) or {}
            sync_version_name = _resolve_sync_version_name_for_asset(project_asset)
            entity_label = (
                project_asset.get("connector_entity_name")
                or entity.get("name")
                or str(entity_id)
            )
            input_data_file_name = (
                f"{entity_label} - {sync_version_name}"
                if sync_version_name
                else entity_label
            )

            # ── Collect all dashboards across all conversations in this project ──
            dashboard_cards = []
            conversation_id = project.get("latest_conversation_id")
            if conversation_id:
                convos = conversations_repo.list_conversations(pid)
                for convo in convos:
                    convo_id = convo.get("conversation_id")
                    if not convo_id:
                        continue
                    # Load the conversation from S3 to read its dashboards list
                    try:
                        from utils.s3.conversations import (
                            load_conversation as _load_conv,
                        )

                        conv_data = _load_conv(
                            convo.get("s3_bucket", ""), convo.get("s3_key", "")
                        )
                        dashboards_list = (
                            conv_data.get("dashboards", []) if conv_data else []
                        )
                        for dash in dashboards_list:
                            dash_id = dash.get("dashboard_id")
                            dash_title = dash.get("title") or dash.get(
                                "dashboard_title"
                            )
                            if dash_id:
                                dashboard_cards.append(
                                    {
                                        "dashboard_id": dash_id,
                                        "dashboard_title": dash_title
                                        or "Untitled dashboard",
                                        "conversation_id": convo_id,
                                    }
                                )
                    except Exception:
                        pass

            if dashboard_cards:
                # One card per dashboard
                for dash_card in dashboard_cards:
                    related_projects.append(
                        {
                            "project_id": project.get("project_id"),
                            "project_name": project.get("name") or "Untitled Project",
                            "project_created_at": project.get("created_at"),
                            "latest_dashboard_id": dash_card["dashboard_id"],
                            "dashboard_title": dash_card["dashboard_title"],
                            "dashboard_preview_key": project.get(
                                "dashboard_preview_key"
                            ),
                            "conversation_id": dash_card.get("conversation_id"),
                            "input_data_file_name": input_data_file_name,
                            "sync_version_name": sync_version_name,
                        }
                    )
            else:
                # Project with conversation but no dashboard yet
                related_projects.append(
                    {
                        "project_id": project.get("project_id"),
                        "project_name": project.get("name") or "Untitled Project",
                        "project_created_at": project.get("created_at"),
                        "latest_dashboard_id": project.get("latest_dashboard_id"),
                        "dashboard_title": project.get("dashboard_title"),
                        "dashboard_preview_key": project.get("dashboard_preview_key"),
                        "input_data_file_name": input_data_file_name,
                        "sync_version_name": sync_version_name,
                    }
                )

        status_map = await self.fetch_connectors_overview(user_id)
        overview_item = next(
            (
                item
                for item in status_map.get("connectors", [])
                if item.get("connector_key") == connector_key
            ),
            None,
        )

        return {
            "success": True,
            "connector_key": connector_key,
            "display_name": (
                overview_item.get("display_name") if overview_item else connector_key
            ),
            "connected": (
                bool(overview_item.get("connected"))
                if overview_item
                else bool(connection)
            ),
            "entity": entity,
            "latest_asset": latest_asset,
            "latest_schedule": schedule,
            "related_projects": related_projects,
            "last_synced_at": (latest_asset or {}).get("created_at"),
            "account_name": account_name,
        }

    async def get_connector_entity_history(
        self, user_id: str, connector_key: str, entity_id: str, limit: int = 50
    ) -> Dict[str, Any]:
        provider = self._connector_to_provider(connector_key)
        connection = connected_accounts_repo.get_connection(user_id, provider) or {}
        sync_version_name_map = (connection.get("sync_version_names") or {}).get(
            str(entity_id), {}
        ) or {}
        runs, _ = sync_runs_repo.list_runs_for_user(
            user_id=user_id, limit=max(limit, 100)
        )
        matched = []
        seen_asset_ids = set()
        for run in runs:
            if run.get("provider") != provider:
                continue
            schedule_id = run.get("schedule_id")
            if not schedule_id:
                continue
            schedule = sync_schedules_repo.get_schedule(user_id, schedule_id)
            cfg: Dict[str, Any] = {}
            if schedule:
                cfg = schedule.get("connector_config") or {}
            snapshot = run.get("config_snapshot") or {}
            run_entity_id = self._extract_entity_id_from_schedule(
                provider, cfg
            ) or snapshot.get("entity_id")
            if str(run_entity_id or "") != str(entity_id):
                continue
            asset = None
            if run.get("asset_id"):
                asset = assets_repo.get_asset_by_id(run.get("asset_id"))
            matched.append(
                {
                    "run_id": run.get("run_id"),
                    "schedule_id": schedule_id,
                    "status": run.get("status"),
                    "triggered_at": run.get("triggered_at"),
                    "completed_at": run.get("completed_at"),
                    "rows_fetched": run.get("rows_fetched"),
                    "columns_fetched": run.get("columns_fetched"),
                    "asset_id": run.get("asset_id"),
                    "asset_filename": (asset or {}).get("filename"),
                    "date_range_start": run.get("date_range_start"),
                    "date_range_end": run.get("date_range_end"),
                    "config_snapshot": snapshot,
                    "sync_version_name": sync_version_name_map.get(
                        str(run.get("run_id"))
                    ),
                    "_s3_key": (asset or {}).get(
                        "s3_key"
                    ),  # internal: for s3_key dedup below
                }
            )
            if run.get("asset_id"):
                seen_asset_ids.add(str(run.get("asset_id")))
            if len(matched) >= limit:
                break

        assets = assets_repo.list_assets(
            user_id=user_id, asset_type=self._connector_asset_type(connector_key)
        )
        entity_assets = [
            a
            for a in assets
            if str(a.get("connector_entity_id", "")) == str(entity_id)
            and not a.get(
                "cloned_from_asset_id"
            )  # skip cloned copies created by "add to new project"
        ]
        entity_assets.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        # Also deduplicate by s3_key to catch pre-existing cloned assets that
        # don't have the cloned_from_asset_id field.
        seen_s3_keys: set = set()
        for m in matched:
            s3k = m.pop("_s3_key", None)
            if s3k:
                seen_s3_keys.add(str(s3k))
        for asset in entity_assets:
            asset_id = str(asset.get("asset_id", ""))
            s3_key = str(asset.get("s3_key", ""))
            if not asset_id or asset_id in seen_asset_ids:
                continue
            # Skip if another asset with the same S3 key is already in the history
            if s3_key and s3_key in seen_s3_keys:
                continue
            if s3_key:
                seen_s3_keys.add(s3_key)
            matched.append(
                {
                    "run_id": f"asset-{asset_id}",
                    "schedule_id": None,
                    "status": "success",
                    "triggered_at": asset.get("created_at"),
                    "completed_at": asset.get("created_at"),
                    "rows_fetched": asset.get("row_count"),
                    "columns_fetched": asset.get("column_count"),
                    "asset_id": asset.get("asset_id"),
                    "asset_filename": asset.get("filename"),
                    "date_range_start": None,
                    "date_range_end": None,
                    "config_snapshot": {
                        "entity_id": str(entity_id),
                        "entity_name": asset.get("connector_entity_name")
                        or str(entity_id),
                        "rows": asset.get("row_count"),
                        "columns": asset.get("column_count"),
                        "size_bytes": asset.get("size_bytes"),
                    },
                    "sync_version_name": sync_version_name_map.get(f"asset-{asset_id}"),
                }
            )
            if len(matched) >= limit:
                break
        matched.sort(
            key=lambda item: (
                1 if str(item.get("run_id", "")).startswith("asset-") else 0,
                (item.get("completed_at") or item.get("triggered_at") or ""),
            ),
            reverse=False,
        )
        # Real runs newest first, synthetic asset-only entries always at bottom.
        real_runs = [
            m for m in matched if not str(m.get("run_id", "")).startswith("asset-")
        ]
        asset_only_runs = [
            m for m in matched if str(m.get("run_id", "")).startswith("asset-")
        ]
        real_runs.sort(
            key=lambda item: item.get("completed_at") or item.get("triggered_at") or "",
            reverse=True,
        )
        asset_only_runs.sort(
            key=lambda item: item.get("completed_at") or item.get("triggered_at") or "",
            reverse=False,
        )
        matched = real_runs + asset_only_runs
        if len(matched) > limit:
            matched = matched[:limit]
        return {"success": True, "runs": matched}

    async def update_connector_sync_version_name(
        self,
        user_id: str,
        connector_key: str,
        entity_id: str,
        run_id: str,
        sync_version_name: str,
    ) -> Dict[str, Any]:
        provider = self._connector_to_provider(connector_key)
        # Ensure run belongs to this user+entity before updating metadata.
        history = await self.get_connector_entity_history(
            user_id=user_id,
            connector_key=connector_key,
            entity_id=entity_id,
            limit=500,
        )
        runs = history.get("runs", []) or []
        if not any(str(r.get("run_id", "")) == str(run_id) for r in runs):
            raise HTTPException(
                status_code=404, detail="Sync run not found for this connector entity."
            )
        connected_accounts_repo.set_sync_version_name(
            user_id=user_id,
            provider=provider,
            connector_entity_id=str(entity_id),
            run_id=str(run_id),
            sync_version_name=sync_version_name,
        )
        return {
            "success": True,
            "run_id": str(run_id),
            "sync_version_name": str(sync_version_name).strip(),
        }

    async def remove_connector_entity(
        self, user_id: str, connector_key: str, entity_id: str
    ) -> Dict[str, Any]:
        provider = self._connector_to_provider(connector_key)
        connected_accounts_repo.remove_selected_entity(
            user_id=user_id,
            provider=provider,
            entity_id=str(entity_id),
        )
        return {"success": True}

    def _resolve_refresh_dates(
        self,
        date_preset: Optional[str],
        start_date: Optional[str],
        end_date: Optional[str],
    ) -> Dict[str, Optional[str]]:
        if start_date and end_date:
            return {
                "date_preset": "custom",
                "start_date": start_date,
                "end_date": end_date,
            }
        return {
            "date_preset": date_preset or "last_30d",
            "start_date": start_date,
            "end_date": end_date,
        }

    async def refresh_connector_entity(
        self,
        user_id: str,
        connector_key: str,
        entity_id: str,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        schedule = self._find_schedule_for_entity(user_id, connector_key, entity_id)
        overrides = overrides or {}
        latest_asset = self._latest_asset_for_entity(user_id, connector_key, entity_id)
        if not schedule and not latest_asset:
            raise HTTPException(
                status_code=400, detail="No saved connector config for this entity."
            )

        cfg = schedule.get("connector_config") if schedule else {}
        cfg = cfg or {}
        project_id = (
            (schedule or {}).get("project_id")
            or (latest_asset or {}).get("project_id")
            or projects_repo.create_project(
                user_id=user_id,
                name="Untitled Project",
                description="Auto-created project",
            ).get("project_id")
        )
        date_preset = (
            overrides.get("date_preset")
            or (schedule or {}).get("date_range_preset")
            or "last_30d"
        )
        start_date = overrides.get("start_date")
        end_date = overrides.get("end_date")
        dates = self._resolve_refresh_dates(
            date_preset=date_preset, start_date=start_date, end_date=end_date
        )
        account_name = (schedule or {}).get("account_name") or ""
        resolved_cfg = {**cfg}
        prior_asset_name = (latest_asset or {}).get("connector_entity_name")
        prior_selected_name = ""
        connection = (
            connected_accounts_repo.get_connection(
                user_id, self._connector_to_provider(connector_key)
            )
            or {}
        )
        selected_entities = connection.get("selected_entities", []) or []
        existing_entity = next(
            (e for e in selected_entities if str(e.get("id", "")) == str(entity_id)),
            None,
        )
        if existing_entity:
            prior_selected_name = str(existing_entity.get("name", ""))
        preferred_entity_name = self._pick_best_entity_name(
            str(entity_id),
            prior_selected_name,
            prior_asset_name,
            cfg.get("property_name"),
            cfg.get("app_name"),
            account_name,
            str(entity_id),
        )

        if connector_key == "meta_ads":
            if overrides.get("campaign_ids") is not None:
                resolved_cfg["campaign_ids"] = overrides.get("campaign_ids")
            if overrides.get("adset_ids") is not None:
                resolved_cfg["adset_ids"] = overrides.get("adset_ids")
        if connector_key in {
            "tiktok_ads",
            "google_ads",
            "ga4",
            "appsflyer",
            "firebase",
            "stripe",
            "hubspot",
            "salesforce",
            "pipedrive",
            "shopify",
            "klaviyo",
            "quickbooks",
            "zendesk",
            "mixpanel",
            "posthog",
            "amazon_seller",
            "tiktok_shop_seller",
            "shopee_seller",
            "lazada_seller",
            "supabase",
        }:
            # only date overrides are supported for these in refresh modal
            pass

        schedule_id = (schedule or {}).get(
            "schedule_id"
        ) or f"manual#{connector_key}#{entity_id}"
        run = sync_runs_repo.create_run(
            schedule_id=schedule_id,
            user_id=user_id,
            provider=self._connector_to_provider(connector_key),
        )
        run_id = run.get("run_id")

        try:
            if connector_key == "meta_ads":
                result = await self.fetch_meta_ads_data(
                    user_id=user_id,
                    ad_account_id=str(cfg.get("ad_account_id") or entity_id),
                    project_id=project_id,
                    date_preset=dates.get("date_preset"),
                    start_date=dates.get("start_date"),
                    end_date=dates.get("end_date"),
                    account_name=account_name,
                    adset_ids=resolved_cfg.get("adset_ids"),
                    campaign_ids=resolved_cfg.get("campaign_ids"),
                )
            elif connector_key == "tiktok_ads":
                result = await self.fetch_tiktok_ads_data(
                    user_id=user_id,
                    ad_account_id=str(cfg.get("ad_account_id") or entity_id),
                    project_id=project_id,
                    date_preset=dates.get("date_preset"),
                    start_date=dates.get("start_date"),
                    end_date=dates.get("end_date"),
                    account_name=account_name,
                )
            elif connector_key == "google_ads":
                result = await self.fetch_google_ads_data(
                    user_id=user_id,
                    ad_account_id=str(cfg.get("ad_account_id") or entity_id),
                    project_id=project_id,
                    start_date=dates.get("start_date") or "30daysAgo",
                    end_date=dates.get("end_date") or "today",
                    account_name=account_name,
                )
            elif connector_key == "ga4":
                try:
                    result = await self.fetch_google_analytics_data(
                        user_id=user_id,
                        property_id=str(cfg.get("property_id") or entity_id),
                        project_id=project_id,
                        start_date=dates.get("start_date") or "30daysAgo",
                        end_date=dates.get("end_date") or "today",
                        account_name=cfg.get("account_name") or account_name or "GA4",
                        property_name=preferred_entity_name,
                    )
                except Exception as ga4_err:
                    message = str(ga4_err)
                    if "Google OAuth token not found" in message:
                        raise HTTPException(status_code=401, detail=message)
                    if (
                        "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in message
                        or "insufficient" in message.lower()
                    ):
                        raise HTTPException(status_code=403, detail=message)
                    raise
            elif connector_key == "google_sheets":
                result = await self.fetch_google_sheet_data(
                    user_id=user_id,
                    file_id=str(cfg.get("file_id") or entity_id),
                    project_id=project_id,
                )
            elif connector_key == "appsflyer":
                result = await self.fetch_appsflyer_data(
                    user_id=user_id,
                    app_id=str(cfg.get("app_id") or entity_id),
                    app_name=cfg.get("app_name") or account_name or str(entity_id),
                    project_id=project_id,
                    date_preset=dates.get("date_preset"),
                    start_date=dates.get("start_date"),
                    end_date=dates.get("end_date"),
                )
            elif connector_key == "firebase":
                result = await self.fetch_firebase_data(
                    user_id=user_id,
                    firebase_project_id=str(
                        cfg.get("firebase_project_id") or entity_id
                    ),
                    project_id=project_id,
                    start_date=dates.get("start_date") or "30daysAgo",
                    end_date=dates.get("end_date") or "today",
                    expected_app_name=cfg.get("app_name")
                    or account_name
                    or str(entity_id),
                )
            elif connector_key == "stripe":
                result = await self.fetch_stripe_data(
                    user_id=user_id,
                    report_type=cfg.get("report_type") or "charges",
                    project_id=project_id,
                    date_preset=dates.get("date_preset"),
                    start_date=dates.get("start_date"),
                    end_date=dates.get("end_date"),
                )
            elif connector_key == "hubspot":
                result = await self.fetch_hubspot_data(
                    user_id=user_id,
                    report_type=str(cfg.get("report_type") or "sales_pipeline"),
                    project_id=project_id,
                    date_preset=dates.get("date_preset"),
                    start_date=dates.get("start_date"),
                    end_date=dates.get("end_date"),
                    pipeline_id=str(cfg.get("pipeline_id") or "all"),
                    owner_id=str(cfg.get("owner_id") or "all"),
                    row_limit=int(cfg.get("row_limit") or 5000),
                    include_associations=bool(cfg.get("include_associations", True)),
                )
            elif connector_key == "salesforce":
                result = await self.fetch_salesforce_data(
                    user_id=user_id,
                    report_type=str(cfg.get("report_type") or "sales_pipeline"),
                    project_id=project_id,
                    date_preset=dates.get("date_preset"),
                    start_date=dates.get("start_date"),
                    end_date=dates.get("end_date"),
                    object_name=str(cfg.get("object_name") or "all"),
                    owner_id=str(cfg.get("owner_id") or "all"),
                    row_limit=int(cfg.get("row_limit") or 5000),
                )
            elif connector_key == "pipedrive":
                result = await self.fetch_pipedrive_data(
                    user_id=user_id,
                    report_type=str(cfg.get("report_type") or "sales_pipeline"),
                    project_id=project_id,
                    date_preset=dates.get("date_preset"),
                    start_date=dates.get("start_date"),
                    end_date=dates.get("end_date"),
                    pipeline_id=str(cfg.get("pipeline_id") or "all"),
                    owner_id=str(cfg.get("owner_id") or "all"),
                    row_limit=int(cfg.get("row_limit") or 5000),
                )
            elif connector_key == "shopify":
                from app.services.shopify_service import shopify_service

                result = await shopify_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "klaviyo":
                from app.services.klaviyo_service import klaviyo_service

                result = await klaviyo_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "quickbooks":
                from app.services.quickbooks_service import quickbooks_service

                result = await quickbooks_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "zendesk":
                from app.services.zendesk_service import zendesk_service

                result = await zendesk_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "mixpanel":
                from app.services.mixpanel_service import mixpanel_service

                result = await mixpanel_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "posthog":
                from app.services.posthog_service import posthog_service

                result = await posthog_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "amazon_seller":
                from app.services.amazon_seller_service import amazon_seller_service

                result = await amazon_seller_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "tiktok_shop_seller":
                from app.services.tiktok_shop_seller_service import (
                    tiktok_shop_seller_service,
                )

                result = await tiktok_shop_seller_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "shopee_seller":
                from app.services.shopee_seller_service import shopee_seller_service

                result = await shopee_seller_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "lazada_seller":
                from app.services.lazada_seller_service import lazada_seller_service

                result = await lazada_seller_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key == "supabase":
                from app.services.supabase_service import supabase_service

                result = supabase_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            elif connector_key in {"postgres", "bigquery", "snowflake", "databricks"}:
                from app.services.warehouse_service import warehouse_service

                result = warehouse_service.sync_entity(
                    user_id=user_id,
                    entity_id=str(entity_id),
                    project_id=project_id,
                    overrides={**resolved_cfg, **overrides},
                )
            else:
                raise HTTPException(
                    status_code=404, detail=f"Unsupported connector: {connector_key}"
                )
        except Exception as err:
            sync_runs_repo.complete_run(
                schedule_id=schedule_id,
                run_id=run_id,
                status="failed",
                error_message=str(err),
                date_range_start=dates.get("start_date"),
                date_range_end=dates.get("end_date"),
                config_snapshot={
                    "connector_key": connector_key,
                    "entity_id": str(entity_id),
                    "date_preset": dates.get("date_preset"),
                    "start_date": dates.get("start_date"),
                    "end_date": dates.get("end_date"),
                    "campaign_ids": resolved_cfg.get("campaign_ids"),
                    "adset_ids": resolved_cfg.get("adset_ids"),
                },
            )
            raise

        # Tag freshly created asset with connector entity metadata for detail/history.
        asset = result.get("asset")
        if asset and connector_key not in {
            "postgres",
            "bigquery",
            "snowflake",
            "databricks",
            "supabase",
            "shopify",
            "klaviyo",
            "quickbooks",
            "zendesk",
            "mixpanel",
            "posthog",
            "amazon_seller",
            "tiktok_shop_seller",
            "shopee_seller",
            "lazada_seller",
        }:
            stable_entity_name = self._pick_best_entity_name(
                str(entity_id),
                (existing_entity or {}).get("name"),
                (asset or {}).get("connector_entity_name"),
                preferred_entity_name,
                cfg.get("property_name"),
                cfg.get("app_name"),
                account_name,
                str(entity_id),
            )
            connected_accounts_repo.append_selected_entity(
                user_id=user_id,
                provider=self._connector_to_provider(connector_key),
                entity={
                    "id": str(entity_id),
                    "name": stable_entity_name,
                    "type": (existing_entity or {}).get("type") or "entity",
                },
            )
            assets_repo.update_asset_metadata(
                user_id=user_id,
                asset_id=asset.get("asset_id"),
                metadata={
                    "connector_key": connector_key,
                    "connector_entity_id": str(entity_id),
                    "connector_entity_name": stable_entity_name,
                },
            )

        sync_runs_repo.complete_run(
            schedule_id=schedule_id,
            run_id=run_id,
            status="success",
            rows_fetched=result.get("row_count"),
            columns_fetched=result.get("column_count"),
            asset_id=(asset or {}).get("asset_id"),
            date_range_start=dates.get("start_date"),
            date_range_end=dates.get("end_date"),
            config_snapshot={
                "connector_key": connector_key,
                "entity_id": str(entity_id),
                "entity_name": (asset or {}).get("connector_entity_name")
                or cfg.get("property_name")
                or cfg.get("app_name")
                or account_name
                or str(entity_id),
                "date_preset": dates.get("date_preset"),
                "start_date": dates.get("start_date"),
                "end_date": dates.get("end_date"),
                "campaign_ids": resolved_cfg.get("campaign_ids"),
                "adset_ids": resolved_cfg.get("adset_ids"),
                "report_type": cfg.get("report_type"),
                "rows": result.get("row_count"),
                "columns": result.get("column_count"),
                "size_bytes": (asset or {}).get("size_bytes"),
            },
        )

        return {"success": True, **result}

    async def add_connector_entity_to_new_project(
        self,
        user_id: str,
        connector_key: str,
        entity_id: str,
        project_name: str,
        prompt: str,
        asset_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        source_asset = None
        if asset_id:
            candidate = assets_repo.get_asset_by_id(asset_id)
            if (
                candidate
                and str(candidate.get("user_id", "")) == str(user_id)
                and str(candidate.get("connector_key", "")) == str(connector_key)
                and str(candidate.get("connector_entity_id", "")) == str(entity_id)
            ):
                source_asset = candidate
            else:
                raise HTTPException(
                    status_code=404, detail="Selected sync data version was not found."
                )
        if not source_asset:
            source_asset = self._latest_asset_for_entity(
                user_id, connector_key, entity_id
            )
        if not source_asset:
            raise HTTPException(
                status_code=404,
                detail="No synced asset found for this connector entity.",
            )
        project = projects_repo.create_project(
            user_id=user_id,
            name=project_name or "Untitled Project",
            description=f"Created from {connector_key}",
        )
        cloned = assets_repo.clone_asset_to_project(
            user_id=user_id,
            source_asset=source_asset,
            project_id=project["project_id"],
        )
        assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=cloned["asset_id"],
            metadata={
                "connector_key": connector_key,
                "connector_entity_id": str(entity_id),
                "connector_entity_name": source_asset.get(
                    "connector_entity_name", str(entity_id)
                ),
                "cloned_from_asset_id": str(source_asset.get("asset_id", "")),
            },
        )
        return {"success": True, "project": project, "asset": cloned, "prompt": prompt}

    def _resolve_hubspot_dates(
        self,
        date_preset: Optional[str],
        start_date: Optional[str],
        end_date: Optional[str],
    ) -> Dict[str, str]:
        from_d, to_d, _, _ = self._resolve_stripe_dates(
            date_preset, start_date, end_date
        )
        return {
            "from": from_d.strftime("%Y-%m-%d"),
            "to": to_d.strftime("%Y-%m-%d"),
            "from_iso": datetime(
                from_d.year, from_d.month, from_d.day, tzinfo=timezone.utc
            )
            .isoformat()
            .replace("+00:00", "Z"),
            "to_iso": datetime(
                to_d.year, to_d.month, to_d.day, 23, 59, 59, tzinfo=timezone.utc
            )
            .isoformat()
            .replace("+00:00", "Z"),
        }

    def _hubspot_report_spec(self, report_type: str) -> Dict[str, Any]:
        specs = {
            "sales_pipeline": {
                "object_type": "deals",
                "date_property": "hs_lastmodifieddate",
                "properties": [
                    "dealname",
                    "amount",
                    "deal_currency_code",
                    "dealstage",
                    "pipeline",
                    "hubspot_owner_id",
                    "createdate",
                    "hs_lastmodifieddate",
                    "closedate",
                    "hs_deal_stage_probability",
                ],
            },
            "contacts": {
                "object_type": "contacts",
                "date_property": "lastmodifieddate",
                "properties": [
                    "firstname",
                    "lastname",
                    "email",
                    "company",
                    "phone",
                    "lifecyclestage",
                    "hubspot_owner_id",
                    "createdate",
                    "lastmodifieddate",
                ],
            },
            "companies": {
                "object_type": "companies",
                "date_property": "hs_lastmodifieddate",
                "properties": [
                    "name",
                    "domain",
                    "industry",
                    "city",
                    "country",
                    "hubspot_owner_id",
                    "createdate",
                    "hs_lastmodifieddate",
                ],
            },
            "activities": {
                "object_type": "tasks",
                "date_property": "hs_lastmodifieddate",
                "properties": [
                    "hs_task_subject",
                    "hs_task_status",
                    "hs_task_priority",
                    "hs_timestamp",
                    "hubspot_owner_id",
                    "hs_createdate",
                    "hs_lastmodifieddate",
                ],
            },
        }
        if report_type not in specs:
            raise HTTPException(
                status_code=400,
                detail="Invalid report_type. Must be sales_pipeline, contacts, companies, or activities.",
            )
        return specs[report_type]

    def _build_hubspot_search_payload(
        self,
        report_type: str,
        spec: Dict[str, Any],
        date_window: Dict[str, str],
        pipeline_id: str,
        owner_id: str,
        page_limit: int,
        after: Optional[str],
    ) -> Dict[str, Any]:
        filters: List[Dict[str, str]] = [
            {
                "propertyName": spec["date_property"],
                "operator": "BETWEEN",
                "value": date_window["from_iso"],
                "highValue": date_window["to_iso"],
            }
        ]
        if report_type == "sales_pipeline" and pipeline_id != "all":
            filters.append(
                {
                    "propertyName": "pipeline",
                    "operator": "EQ",
                    "value": pipeline_id,
                }
            )
        if owner_id != "all":
            filters.append(
                {
                    "propertyName": "hubspot_owner_id",
                    "operator": "EQ",
                    "value": owner_id,
                }
            )
        payload: Dict[str, Any] = {
            "limit": page_limit,
            "properties": spec["properties"],
            "filterGroups": [{"filters": filters}],
        }
        if after:
            payload["after"] = after
        return payload

    async def _hubspot_search_objects(
        self,
        access_token: str,
        object_type: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for attempt in range(3):
                resp = await client.post(
                    f"https://api.hubapi.com/crm/v3/objects/{object_type}/search",
                    json=payload,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if resp.status_code == 429 and attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                if resp.status_code == 401:
                    raise HTTPException(
                        status_code=401,
                        detail="HubSpot access revoked. Please reconnect.",
                    )
                resp.raise_for_status()
                return resp.json()
        return {"results": []}

    async def _fetch_hubspot_association_summary(
        self, access_token: str, deal_id: str
    ) -> Dict[str, str]:
        summary: Dict[str, str] = {}
        async with httpx.AsyncClient(timeout=10.0) as client:
            for assoc_type in ("companies", "contacts"):
                try:
                    assoc_resp = await client.get(
                        f"https://api.hubapi.com/crm/v4/objects/deals/{deal_id}/associations/{assoc_type}",
                        headers={"Authorization": f"Bearer {access_token}"},
                        params={"limit": 10},
                    )
                    if assoc_resp.status_code != 200:
                        continue
                    ids = [
                        str(item.get("toObjectId") or "")
                        for item in assoc_resp.json().get("results", [])
                        if item.get("toObjectId")
                    ]
                    summary[f"associated_{assoc_type}_ids"] = ",".join(ids)
                except Exception:
                    continue
        return summary

    def _hubspot_safe_float(self, value: Any) -> Optional[float]:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _hubspot_format_weighted_amount(self, amount: Any, probability: Any) -> str:
        amount_f = self._hubspot_safe_float(amount)
        prob_f = self._hubspot_safe_float(probability)
        if amount_f is None or prob_f is None:
            return ""
        if prob_f > 1:
            prob_f = prob_f / 100
        return f"{amount_f * prob_f:.2f}"

    async def fetch_hubspot_data(
        self,
        user_id: str,
        report_type: str,
        project_id: str,
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        pipeline_id: str = "all",
        owner_id: str = "all",
        row_limit: int = 5000,
        include_associations: bool = True,
    ) -> Dict[str, Any]:
        """Fetch HubSpot CRM data and save a flattened CSV asset."""
        spec = self._hubspot_report_spec(report_type)
        try:
            row_limit = int(row_limit or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        row_limit = max(1, min(row_limit, 10000))
        access_token = await self._get_hubspot_access_token(user_id)
        date_window = self._resolve_hubspot_dates(date_preset, start_date, end_date)

        pipelines = await self.fetch_hubspot_pipelines(user_id)
        owners = await self.fetch_hubspot_owners(user_id)
        stage_labels: Dict[str, str] = {}
        stage_probabilities: Dict[str, Any] = {}
        pipeline_labels = {"all": "All pipelines"}
        for pipeline in pipelines:
            pipeline_labels[str(pipeline.get("id"))] = str(pipeline.get("label") or "")
            for stage in pipeline.get("stages", []):
                stage_id = str(stage.get("id") or "")
                stage_labels[stage_id] = str(stage.get("label") or stage_id)
                stage_probabilities[stage_id] = stage.get("probability")
        owner_labels = {"all": "All owners"}
        for owner in owners:
            owner_labels[str(owner.get("id"))] = str(
                owner.get("name") or owner.get("email") or owner.get("id")
            )

        rows: List[Dict[str, Any]] = []
        after: Optional[str] = None
        truncated = False
        while len(rows) < row_limit:
            page_limit = min(200, row_limit - len(rows))
            payload = self._build_hubspot_search_payload(
                report_type=report_type,
                spec=spec,
                date_window=date_window,
                pipeline_id=pipeline_id,
                owner_id=owner_id,
                page_limit=page_limit,
                after=after,
            )
            page = await self._hubspot_search_objects(
                access_token=access_token,
                object_type=spec["object_type"],
                payload=payload,
            )
            objects = page.get("results", []) or []
            for obj in objects:
                props = obj.get("properties") or {}
                row: Dict[str, Any] = {"id": obj.get("id", "")}
                for prop in spec["properties"]:
                    row[prop] = props.get(prop, "")
                owner_value = str(row.get("hubspot_owner_id") or "")
                row["owner_name"] = owner_labels.get(owner_value, owner_value)
                if report_type == "sales_pipeline":
                    stage_id = str(row.get("dealstage") or "")
                    pipeline_value = str(row.get("pipeline") or "")
                    probability = row.get(
                        "hs_deal_stage_probability"
                    ) or stage_probabilities.get(stage_id)
                    row["pipeline_label"] = pipeline_labels.get(
                        pipeline_value, pipeline_value
                    )
                    row["stage_label"] = stage_labels.get(stage_id, stage_id)
                    row["stage_probability"] = probability or ""
                    row["weighted_amount"] = self._hubspot_format_weighted_amount(
                        row.get("amount"), probability
                    )
                    if include_associations:
                        row.update(
                            await self._fetch_hubspot_association_summary(
                                access_token, str(obj.get("id") or "")
                            )
                        )
                rows.append(row)
                if len(rows) >= row_limit:
                    break
            after = (page.get("paging") or {}).get("next", {}).get("after")
            if not after:
                break
        if after:
            truncated = True

        headers = list(rows[0].keys()) if rows else ["id", *spec["properties"]]
        if report_type == "sales_pipeline":
            for header in [
                "owner_name",
                "pipeline_label",
                "stage_label",
                "stage_probability",
                "weighted_amount",
                "associated_companies_ids",
                "associated_contacts_ids",
            ]:
                if header not in headers:
                    headers.append(header)
        elif "owner_name" not in headers:
            headers.append("owner_name")

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        csv_bytes = output.getvalue().encode("utf-8")

        entity_id = f"hubspot:{report_type}:{pipeline_id or 'all'}:{owner_id or 'all'}"
        entity_name = self._hubspot_report_label(report_type, pipeline_id, owner_id)
        filename = (
            f"hubspot_{report_type}_{date_window['from']}_{date_window['to']}.csv"
        )
        asset = self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_bytes,
            filename=filename,
            asset_type="integration_hubspot",
            extension="csv",
            row_count=len(rows),
            column_count=len(headers),
        )

        connection = connected_accounts_repo.get_connection(user_id, "hubspot") or {}
        manifest = {
            "source_type": "hubspot",
            "portal_id": connection.get("portal_id"),
            "portal_domain": connection.get("portal_domain"),
            "report_type": report_type,
            "entity_id": entity_id,
            "pipeline_id": pipeline_id or "all",
            "owner_id": owner_id or "all",
            "date_preset": date_preset or "last_30d",
            "start_date": date_window["from"],
            "end_date": date_window["to"],
            "requested_properties": spec["properties"],
            "row_limit": row_limit,
            "row_count": len(rows),
            "column_schema": headers,
            "truncated": truncated,
            "query_summary": {
                "object_type": spec["object_type"],
                "date_property": spec["date_property"],
            },
            "schema_fingerprint": hashlib.sha256(
                json.dumps(headers, sort_keys=True).encode("utf-8")
            ).hexdigest(),
        }
        connected_accounts_repo.append_selected_entity(
            user_id=user_id,
            provider="hubspot",
            entity={
                "id": entity_id,
                "name": entity_name,
                "type": "report",
                "account_name": connection.get("account_name") or "HubSpot",
                "report_type": report_type,
                "pipeline_id": pipeline_id or "all",
                "owner_id": owner_id or "all",
            },
        )
        assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset.get("asset_id"),
            metadata={
                "connector_key": "hubspot",
                "connector_entity_id": entity_id,
                "connector_entity_name": entity_name,
                "hubspot_report_type": report_type,
                "hubspot_manifest": manifest,
            },
        )
        asset.update(
            {
                "connector_key": "hubspot",
                "connector_entity_id": entity_id,
                "connector_entity_name": entity_name,
                "hubspot_report_type": report_type,
                "hubspot_manifest": manifest,
            }
        )
        return {
            "success": True,
            "asset": asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "message": f"Successfully synced {len(rows)} rows from HubSpot ({entity_name}).",
            "entity_id": entity_id,
            "truncated": truncated,
        }

    def _salesforce_validate_object_name(self, object_name: str) -> str:
        clean = str(object_name or "").strip()
        if not clean or not clean.replace("_", "").isalnum():
            raise HTTPException(
                status_code=400, detail="Invalid Salesforce object name."
            )
        return clean

    def _salesforce_escape_literal(self, value: Any) -> str:
        return str(value).replace("\\", "\\\\").replace("'", "\\'")

    def _salesforce_report_label(
        self, report_type: str, object_name: str = "all", owner_id: str = "all"
    ) -> str:
        labels = {
            "sales_pipeline": "Sales Pipeline",
            "leads": "Leads",
            "accounts_contacts": "Accounts & Contacts",
            "activities": "Activities",
            "campaigns": "Campaigns",
        }
        base = labels.get(report_type, report_type.replace("_", " ").title())
        filters = []
        if object_name and object_name != "all":
            filters.append(object_name)
        if owner_id and owner_id != "all":
            filters.append(f"Owner {owner_id}")
        return f"{base} ({', '.join(filters)})" if filters else base

    def _salesforce_report_spec(self, report_type: str) -> Dict[str, Any]:
        specs = {
            "sales_pipeline": {
                "primary_object": "Opportunity",
                "date_field": "LastModifiedDate",
                "owner_field": "OwnerId",
                "fields": [
                    "Id",
                    "Name",
                    "Amount",
                    "CurrencyIsoCode",
                    "StageName",
                    "Probability",
                    "ForecastCategoryName",
                    "Type",
                    "LeadSource",
                    "CloseDate",
                    "CreatedDate",
                    "LastModifiedDate",
                    "OwnerId",
                    "Owner.Name",
                    "AccountId",
                    "Account.Name",
                    "CampaignId",
                    "Campaign.Name",
                ],
            },
            "leads": {
                "primary_object": "Lead",
                "date_field": "LastModifiedDate",
                "owner_field": "OwnerId",
                "fields": [
                    "Id",
                    "Name",
                    "Company",
                    "Status",
                    "Rating",
                    "LeadSource",
                    "Email",
                    "Phone",
                    "CreatedDate",
                    "LastModifiedDate",
                    "OwnerId",
                    "Owner.Name",
                    "ConvertedDate",
                    "ConvertedAccountId",
                    "ConvertedOpportunityId",
                ],
            },
            "accounts_contacts": {
                "primary_object": "Contact",
                "date_field": "LastModifiedDate",
                "owner_field": "OwnerId",
                "fields": [
                    "Id",
                    "Name",
                    "Email",
                    "Phone",
                    "Title",
                    "CreatedDate",
                    "LastModifiedDate",
                    "OwnerId",
                    "Owner.Name",
                    "AccountId",
                    "Account.Name",
                    "Account.Industry",
                    "Account.Type",
                    "Account.BillingCountry",
                ],
            },
            "activities": {
                "primary_object": "Task",
                "date_field": "LastModifiedDate",
                "owner_field": "OwnerId",
                "fields": [
                    "Id",
                    "Subject",
                    "Status",
                    "Priority",
                    "ActivityDate",
                    "Type",
                    "CallDurationInSeconds",
                    "CreatedDate",
                    "LastModifiedDate",
                    "OwnerId",
                    "Owner.Name",
                    "WhoId",
                    "WhatId",
                ],
            },
            "campaigns": {
                "primary_object": "Campaign",
                "date_field": "LastModifiedDate",
                "owner_field": "OwnerId",
                "fields": [
                    "Id",
                    "Name",
                    "Status",
                    "Type",
                    "StartDate",
                    "EndDate",
                    "ExpectedRevenue",
                    "BudgetedCost",
                    "ActualCost",
                    "NumberOfLeads",
                    "NumberOfConvertedLeads",
                    "NumberOfContacts",
                    "NumberOfResponses",
                    "CreatedDate",
                    "LastModifiedDate",
                    "OwnerId",
                    "Owner.Name",
                ],
            },
        }
        if report_type not in specs:
            raise HTTPException(
                status_code=400,
                detail="Invalid report_type. Must be sales_pipeline, leads, accounts_contacts, activities, or campaigns.",
            )
        return specs[report_type]

    def _build_salesforce_soql(
        self,
        report_type: str,
        spec: Dict[str, Any],
        date_window: Dict[str, str],
        owner_id: str,
        row_limit: int,
        object_name: str = "all",
    ) -> str:
        primary_object = spec["primary_object"]
        if object_name and object_name != "all":
            clean_object = self._salesforce_validate_object_name(object_name)
            if clean_object != primary_object:
                raise HTTPException(
                    status_code=400,
                    detail=f"{report_type} supports object_name=all or {primary_object}.",
                )
        fields = list(spec["fields"])
        date_field = spec["date_field"]
        where = [
            f"{date_field} >= {date_window['from_iso']}",
            f"{date_field} <= {date_window['to_iso']}",
        ]
        if owner_id and owner_id != "all":
            where.append(
                f"{spec['owner_field']} = '{self._salesforce_escape_literal(owner_id)}'"
            )
        return (
            f"SELECT {', '.join(fields)} FROM {primary_object} "
            f"WHERE {' AND '.join(where)} ORDER BY {date_field} DESC LIMIT {row_limit + 1}"
        )

    def _flatten_salesforce_record(
        self, record: Dict[str, Any], prefix: str = ""
    ) -> Dict[str, Any]:
        flat: Dict[str, Any] = {}
        for key, value in (record or {}).items():
            if key == "attributes":
                continue
            out_key = f"{prefix}.{key}" if prefix else key
            if isinstance(value, dict):
                flat.update(self._flatten_salesforce_record(value, out_key))
            else:
                flat[out_key] = value if value is not None else ""
        return flat

    async def _salesforce_rest_query(
        self, ctx: Dict[str, Any], soql: str
    ) -> Dict[str, Any]:
        url = f"{ctx['instance_url']}/services/data/{ctx['api_version']}/query"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                url,
                params={"q": soql},
                headers={"Authorization": f"Bearer {ctx['access_token']}"},
            )
        if resp.status_code == 401:
            raise HTTPException(
                status_code=401, detail="Salesforce access revoked. Please reconnect."
            )
        resp.raise_for_status()
        return resp.json()

    async def _salesforce_rest_query_all(
        self, ctx: Dict[str, Any], soql: str, row_limit: int
    ) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        page = await self._salesforce_rest_query(ctx, soql)
        next_url = page.get("nextRecordsUrl")
        while True:
            for record in page.get("records", []):
                rows.append(self._flatten_salesforce_record(record))
                if len(rows) > row_limit:
                    return {
                        "rows": rows[:row_limit],
                        "truncated": True,
                        "api_mode": "rest",
                    }
            if not next_url:
                break
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    f"{ctx['instance_url']}{next_url}",
                    headers={"Authorization": f"Bearer {ctx['access_token']}"},
                )
            if resp.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="Salesforce access revoked. Please reconnect.",
                )
            resp.raise_for_status()
            page = resp.json()
            next_url = page.get("nextRecordsUrl")
        return {"rows": rows, "truncated": False, "api_mode": "rest"}

    async def _salesforce_bulk_query(
        self, ctx: Dict[str, Any], soql: str, row_limit: int
    ) -> Dict[str, Any]:
        jobs_url = (
            f"{ctx['instance_url']}/services/data/{ctx['api_version']}/jobs/query"
        )
        headers = {
            "Authorization": f"Bearer {ctx['access_token']}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            create_resp = await client.post(
                jobs_url,
                json={"operation": "query", "query": soql, "contentType": "CSV"},
                headers=headers,
            )
            if create_resp.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="Salesforce access revoked. Please reconnect.",
                )
            create_resp.raise_for_status()
            job_id = create_resp.json().get("id")
            if not job_id:
                raise HTTPException(
                    status_code=502,
                    detail="Salesforce Bulk API did not return a job id.",
                )
            state = ""
            for _ in range(20):
                status_resp = await client.get(f"{jobs_url}/{job_id}", headers=headers)
                status_resp.raise_for_status()
                state = str(status_resp.json().get("state") or "")
                if state in {"JobComplete", "Failed", "Aborted"}:
                    break
                await asyncio.sleep(0.5)
            if state != "JobComplete":
                raise HTTPException(
                    status_code=502,
                    detail=f"Salesforce Bulk API job ended as {state or 'unknown'}.",
                )
            result_resp = await client.get(
                f"{jobs_url}/{job_id}/results",
                headers={
                    "Authorization": f"Bearer {ctx['access_token']}",
                    "Accept": "text/csv",
                },
            )
            result_resp.raise_for_status()
        reader = csv.DictReader(io.StringIO(result_resp.text))
        rows = list(reader)
        truncated = len(rows) > row_limit
        return {"rows": rows[:row_limit], "truncated": truncated, "api_mode": "bulk"}

    async def fetch_salesforce_data(
        self,
        user_id: str,
        report_type: str,
        project_id: str,
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        object_name: str = "all",
        owner_id: str = "all",
        row_limit: int = 5000,
    ) -> Dict[str, Any]:
        """Fetch Salesforce CRM data and save a flattened CSV asset."""
        spec = self._salesforce_report_spec(report_type)
        try:
            row_limit = int(row_limit or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        row_limit = max(1, min(row_limit, 10000))
        date_window = self._resolve_hubspot_dates(date_preset, start_date, end_date)
        object_filter = str(object_name or "all").strip() or "all"
        owner_filter = str(owner_id or "all").strip() or "all"
        soql = self._build_salesforce_soql(
            report_type=report_type,
            spec=spec,
            date_window=date_window,
            owner_id=owner_filter,
            row_limit=row_limit,
            object_name=object_filter,
        )
        ctx = await self._salesforce_context(user_id)
        if row_limit > 5000:
            query_result = await self._salesforce_bulk_query(ctx, soql, row_limit)
        else:
            query_result = await self._salesforce_rest_query_all(ctx, soql, row_limit)
        rows: List[Dict[str, Any]] = query_result["rows"]
        headers = list(rows[0].keys()) if rows else list(spec["fields"])

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        csv_bytes = output.getvalue().encode("utf-8")

        entity_id = f"salesforce:{report_type}:{object_filter}:{owner_filter}"
        entity_name = self._salesforce_report_label(
            report_type, object_filter, owner_filter
        )
        filename = (
            f"salesforce_{report_type}_{date_window['from']}_{date_window['to']}.csv"
        )
        asset = self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_bytes,
            filename=filename,
            asset_type="integration_salesforce",
            extension="csv",
            row_count=len(rows),
            column_count=len(headers),
        )

        connection = connected_accounts_repo.get_connection(user_id, "salesforce") or {}
        manifest = {
            "source_type": "salesforce",
            "org_id": connection.get("org_id"),
            "instance_domain": connection.get("instance_domain"),
            "report_type": report_type,
            "entity_id": entity_id,
            "objects": [spec["primary_object"]],
            "object_name": object_filter,
            "owner_id": owner_filter,
            "date_preset": date_preset or "last_30d",
            "start_date": date_window["from"],
            "end_date": date_window["to"],
            "selected_fields": spec["fields"],
            "generated_soql": soql,
            "row_limit": row_limit,
            "row_count": len(rows),
            "column_schema": headers,
            "truncated": bool(query_result.get("truncated")),
            "api_mode": query_result.get("api_mode"),
            "checksum": compute_sha256_checksum(csv_bytes),
            "schema_fingerprint": hashlib.sha256(
                json.dumps(headers, sort_keys=True).encode("utf-8")
            ).hexdigest(),
        }
        connected_accounts_repo.append_selected_entity(
            user_id=user_id,
            provider="salesforce",
            entity={
                "id": entity_id,
                "name": entity_name,
                "type": "report",
                "account_name": connection.get("account_name") or "Salesforce",
                "report_type": report_type,
                "object_name": object_filter,
                "owner_id": owner_filter,
            },
        )
        assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset.get("asset_id"),
            metadata={
                "connector_key": "salesforce",
                "connector_entity_id": entity_id,
                "connector_entity_name": entity_name,
                "salesforce_report_type": report_type,
                "salesforce_manifest": manifest,
            },
        )
        asset.update(
            {
                "connector_key": "salesforce",
                "connector_entity_id": entity_id,
                "connector_entity_name": entity_name,
                "salesforce_report_type": report_type,
                "salesforce_manifest": manifest,
            }
        )
        return {
            "success": True,
            "asset": asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "message": f"Successfully synced {len(rows)} rows from Salesforce ({entity_name}).",
            "entity_id": entity_id,
            "truncated": bool(query_result.get("truncated")),
        }

    def _pipedrive_validate_object_name(self, object_name: str) -> str:
        object_key = str(object_name or "").strip().lower()
        mapping = {
            "deal": "deal",
            "deals": "deal",
            "lead": "lead",
            "leads": "lead",
            "person": "person",
            "persons": "person",
            "contact": "person",
            "contacts": "person",
            "organization": "organization",
            "organizations": "organization",
            "activity": "activity",
            "activities": "activity",
            "product": "product",
            "products": "product",
        }
        if object_key not in mapping:
            raise HTTPException(
                status_code=400,
                detail="Invalid Pipedrive object_name. Must be deal, lead, person, organization, activity, or product.",
            )
        return mapping[object_key]

    def _pipedrive_report_label(
        self, report_type: str, pipeline_id: str = "all", owner_id: str = "all"
    ) -> str:
        labels = {
            "sales_pipeline": "Sales Pipeline",
            "leads": "Leads",
            "contacts_organizations": "Contacts & Organizations",
            "activities": "Activities",
            "products": "Products",
        }
        base = labels.get(report_type, report_type.replace("_", " ").title())
        filters = []
        if pipeline_id and pipeline_id != "all":
            filters.append(f"Pipeline {pipeline_id}")
        if owner_id and owner_id != "all":
            filters.append(f"Owner {owner_id}")
        return f"{base} ({', '.join(filters)})" if filters else base

    def _pipedrive_report_spec(self, report_type: str) -> Dict[str, Any]:
        specs = {
            "sales_pipeline": {
                "endpoint": "deals/collection",
                "field_object": "deal",
                "date_field": "update_time",
                "owner_fields": ["user_id", "user_id.id"],
                "pipeline_field": "pipeline_id",
                "cursor": True,
                "fields": [
                    "id",
                    "title",
                    "value",
                    "currency",
                    "status",
                    "probability",
                    "weighted_value",
                    "pipeline_id",
                    "stage_id",
                    "user_id",
                    "person_id",
                    "org_id",
                    "add_time",
                    "update_time",
                    "close_time",
                    "won_time",
                    "lost_time",
                    "expected_close_date",
                    "next_activity_date",
                    "next_activity_subject",
                    "last_activity_date",
                    "last_activity_subject",
                    "source_name",
                    "channel",
                    "channel_id",
                ],
            },
            "leads": {
                "endpoint": "leads",
                "field_object": "lead",
                "date_field": "update_time",
                "owner_fields": ["owner_id", "owner_id.id"],
                "cursor": False,
                "fields": [
                    "id",
                    "title",
                    "value",
                    "currency",
                    "owner_id",
                    "creator_id",
                    "person_id",
                    "organization_id",
                    "source_name",
                    "is_archived",
                    "add_time",
                    "update_time",
                    "expected_close_date",
                ],
            },
            "contacts_organizations": {
                "endpoint": "persons/collection",
                "field_object": "person",
                "date_field": "update_time",
                "owner_fields": ["owner_id", "owner_id.id"],
                "cursor": True,
                "fields": [
                    "id",
                    "name",
                    "email",
                    "phone",
                    "owner_id",
                    "org_id",
                    "add_time",
                    "update_time",
                ],
            },
            "activities": {
                "endpoint": "activities/collection",
                "field_object": "activity",
                "date_field": "update_time",
                "owner_fields": ["user_id", "user_id.id"],
                "cursor": True,
                "fields": [
                    "id",
                    "subject",
                    "type",
                    "done",
                    "user_id",
                    "person_id",
                    "org_id",
                    "deal_id",
                    "due_date",
                    "due_time",
                    "duration",
                    "add_time",
                    "update_time",
                ],
            },
            "products": {
                "endpoint": "products",
                "field_object": "product",
                "date_field": "update_time",
                "owner_fields": ["owner_id", "owner_id.id"],
                "cursor": False,
                "fields": [
                    "id",
                    "name",
                    "code",
                    "unit",
                    "tax",
                    "active_flag",
                    "visible_to",
                    "owner_id",
                    "add_time",
                    "update_time",
                    "prices",
                ],
            },
        }
        if report_type not in specs:
            raise HTTPException(
                status_code=400,
                detail="Invalid report_type. Must be sales_pipeline, leads, contacts_organizations, activities, or products.",
            )
        return specs[report_type]

    def _flatten_pipedrive_record(
        self, record: Dict[str, Any], prefix: str = ""
    ) -> Dict[str, Any]:
        flat: Dict[str, Any] = {}
        for key, value in (record or {}).items():
            out_key = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(value, dict):
                flat.update(self._flatten_pipedrive_record(value, out_key))
            elif isinstance(value, list):
                flat[out_key] = json.dumps(value, ensure_ascii=False)
            else:
                flat[out_key] = value if value is not None else ""
        return flat

    def _pipedrive_first(self, record: Dict[str, Any], *keys: str) -> Any:
        for key in keys:
            value = record.get(key)
            if value not in (None, ""):
                return value
        return ""

    def _pipedrive_parse_datetime(self, value: Any) -> Optional[datetime]:
        raw = str(value or "").strip()
        if not raw:
            return None
        normalized = raw.replace("Z", "+00:00").replace(" ", "T")
        if len(normalized) == 10:
            normalized = f"{normalized}T00:00:00"
        try:
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            return None

    def _pipedrive_record_matches_filters(
        self,
        record: Dict[str, Any],
        spec: Dict[str, Any],
        date_window: Dict[str, str],
        pipeline_id: str,
        owner_id: str,
    ) -> bool:
        parsed = self._pipedrive_parse_datetime(record.get(spec["date_field"]))
        if parsed:
            start = self._pipedrive_parse_datetime(date_window["from_iso"])
            end = self._pipedrive_parse_datetime(date_window["to_iso"])
            if start and parsed < start:
                return False
            if end and parsed > end:
                return False
        if pipeline_id != "all":
            value = str(
                self._pipedrive_first(
                    record,
                    spec.get("pipeline_field", "pipeline_id"),
                    f"{spec.get('pipeline_field', 'pipeline_id')}.id",
                )
            )
            if value != str(pipeline_id):
                return False
        if owner_id != "all":
            owner_values = {
                str(record.get(field) or "")
                for field in spec.get("owner_fields", [])
                if record.get(field) not in (None, "")
            }
            if str(owner_id) not in owner_values:
                return False
        return True

    def _pipedrive_safe_float(self, value: Any) -> Optional[float]:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _pipedrive_weighted_value(self, value: Any, probability: Any) -> str:
        value_f = self._pipedrive_safe_float(value)
        probability_f = self._pipedrive_safe_float(probability)
        if value_f is None or probability_f is None:
            return ""
        if probability_f > 1:
            probability_f = probability_f / 100
        return f"{value_f * probability_f:.2f}"

    def _enrich_pipedrive_row(
        self,
        row: Dict[str, Any],
        report_type: str,
        pipeline_labels: Dict[str, str],
        stage_labels: Dict[str, str],
        stage_probabilities: Dict[str, Any],
        owner_labels: Dict[str, str],
    ) -> Dict[str, Any]:
        owner_value = str(
            self._pipedrive_first(
                row, "user_id", "user_id.id", "owner_id", "owner_id.id"
            )
        )
        row["owner_name"] = owner_labels.get(owner_value, owner_value)
        if report_type == "sales_pipeline":
            pipeline_value = str(
                self._pipedrive_first(row, "pipeline_id", "pipeline_id.id")
            )
            stage_value = str(self._pipedrive_first(row, "stage_id", "stage_id.id"))
            probability = row.get("probability") or stage_probabilities.get(stage_value)
            row["pipeline_label"] = pipeline_labels.get(pipeline_value, pipeline_value)
            row["stage_label"] = stage_labels.get(stage_value, stage_value)
            row["stage_probability"] = probability or ""
            row["weighted_value"] = row.get(
                "weighted_value"
            ) or self._pipedrive_weighted_value(row.get("value"), probability)
            row["organization_name"] = self._pipedrive_first(
                row, "org_id.name", "organization_id.name"
            )
            row["person_name"] = self._pipedrive_first(row, "person_id.name")
        return row

    async def _pipedrive_get_paginated(
        self,
        ctx: Dict[str, Any],
        spec: Dict[str, Any],
        base_params: Dict[str, Any],
        row_limit: int,
        date_window: Dict[str, str],
        pipeline_id: str,
        owner_id: str,
        report_type: str,
        labels: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        cursor: Optional[str] = None
        start = 0
        has_more = False
        endpoint = str(spec["endpoint"])
        for _ in range(100):
            params = dict(base_params)
            params["limit"] = min(500, max(1, row_limit + 1 - len(rows)))
            if spec.get("cursor"):
                if cursor:
                    params["cursor"] = cursor
            else:
                params["start"] = start
            page = await self._pipedrive_request(ctx, endpoint, params=params)
            records = page.get("data") or []
            if isinstance(records, dict) and isinstance(records.get("items"), list):
                records = records.get("items") or []
            for record in records:
                row = self._flatten_pipedrive_record(record)
                if not self._pipedrive_record_matches_filters(
                    row, spec, date_window, pipeline_id, owner_id
                ):
                    continue
                rows.append(
                    self._enrich_pipedrive_row(
                        row,
                        report_type,
                        labels["pipelines"],
                        labels["stages"],
                        labels["stage_probabilities"],
                        labels["owners"],
                    )
                )
                if len(rows) > row_limit:
                    return {"rows": rows[:row_limit], "truncated": True}
            additional = page.get("additional_data") or {}
            pagination = additional.get("pagination") or {}
            cursor = additional.get("next_cursor") or pagination.get("next_cursor")
            if spec.get("cursor"):
                has_more = bool(cursor)
            else:
                has_more = bool(pagination.get("more_items_in_collection"))
                start = int(pagination.get("next_start") or start + len(records))
            if not has_more or not records:
                break
        return {
            "rows": rows[:row_limit],
            "truncated": has_more or len(rows) > row_limit,
        }

    async def fetch_pipedrive_data(
        self,
        user_id: str,
        report_type: str,
        project_id: str,
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        pipeline_id: str = "all",
        owner_id: str = "all",
        row_limit: int = 5000,
    ) -> Dict[str, Any]:
        """Fetch Pipedrive CRM data and save a flattened CSV asset."""
        spec = self._pipedrive_report_spec(report_type)
        try:
            row_limit = int(row_limit or 5000)
        except (TypeError, ValueError):
            row_limit = 5000
        row_limit = max(1, min(row_limit, 10000))
        date_window = self._resolve_hubspot_dates(date_preset, start_date, end_date)
        pipeline_filter = str(pipeline_id or "all").strip() or "all"
        owner_filter = str(owner_id or "all").strip() or "all"
        ctx = await self._pipedrive_context(user_id)

        pipelines = await self.fetch_pipedrive_pipelines(user_id)
        users = await self.fetch_pipedrive_users(user_id)
        pipeline_labels = {"all": "All pipelines"}
        stage_labels: Dict[str, str] = {}
        stage_probabilities: Dict[str, Any] = {}
        for pipeline in pipelines:
            pipeline_labels[str(pipeline.get("id"))] = str(pipeline.get("label") or "")
            for stage in pipeline.get("stages", []):
                stage_id = str(stage.get("id") or "")
                stage_labels[stage_id] = str(stage.get("label") or stage_id)
                stage_probabilities[stage_id] = stage.get("probability")
        owner_labels = {"all": "All owners"}
        for user in users:
            owner_labels[str(user.get("id"))] = str(
                user.get("name") or user.get("email") or user.get("id")
            )

        base_params: Dict[str, Any] = {}
        if report_type == "sales_pipeline" and pipeline_filter != "all":
            base_params["pipeline_id"] = pipeline_filter
        if owner_filter != "all":
            owner_param = (
                "user_id"
                if report_type in {"sales_pipeline", "activities"}
                else "owner_id"
            )
            base_params[owner_param] = owner_filter

        query_result = await self._pipedrive_get_paginated(
            ctx=ctx,
            spec=spec,
            base_params=base_params,
            row_limit=row_limit,
            date_window=date_window,
            pipeline_id=pipeline_filter,
            owner_id=owner_filter,
            report_type=report_type,
            labels={
                "pipelines": pipeline_labels,
                "stages": stage_labels,
                "stage_probabilities": stage_probabilities,
                "owners": owner_labels,
            },
        )
        rows: List[Dict[str, Any]] = query_result["rows"]
        headers = list(rows[0].keys()) if rows else list(spec["fields"])
        for header in [
            "owner_name",
            "pipeline_label",
            "stage_label",
            "stage_probability",
        ]:
            if report_type == "sales_pipeline" and header not in headers:
                headers.append(header)

        custom_field_labels: Dict[str, str] = {}
        try:
            for field in await self.fetch_pipedrive_fields(
                user_id, spec["field_object"]
            ):
                custom_field_labels[str(field.get("key") or "")] = str(
                    field.get("name") or field.get("key") or ""
                )
        except Exception:
            custom_field_labels = {}

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        csv_bytes = output.getvalue().encode("utf-8")

        entity_id = f"pipedrive:{report_type}:{pipeline_filter}:{owner_filter}"
        entity_name = self._pipedrive_report_label(
            report_type, pipeline_filter, owner_filter
        )
        filename = (
            f"pipedrive_{report_type}_{date_window['from']}_{date_window['to']}.csv"
        )
        asset = self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_bytes,
            filename=filename,
            asset_type="integration_pipedrive",
            extension="csv",
            row_count=len(rows),
            column_count=len(headers),
        )

        connection = connected_accounts_repo.get_connection(user_id, "pipedrive") or {}
        manifest = {
            "source_type": "pipedrive",
            "company_id": connection.get("company_id"),
            "company_domain": connection.get("company_domain"),
            "company_name": connection.get("company_name"),
            "report_type": report_type,
            "entity_id": entity_id,
            "pipeline_id": pipeline_filter,
            "owner_id": owner_filter,
            "date_preset": date_preset or "last_30d",
            "start_date": date_window["from"],
            "end_date": date_window["to"],
            "selected_fields": spec["fields"],
            "row_limit": row_limit,
            "row_count": len(rows),
            "column_schema": headers,
            "truncated": bool(query_result.get("truncated")),
            "api_endpoints_used": [spec["endpoint"]],
            "query_summary": {
                "endpoint": spec["endpoint"],
                "api_params": base_params,
                "date_field": spec["date_field"],
            },
            "checksum": compute_sha256_checksum(csv_bytes),
            "schema_fingerprint": hashlib.sha256(
                json.dumps(headers, sort_keys=True).encode("utf-8")
            ).hexdigest(),
            "custom_field_label_mapping": custom_field_labels,
        }
        connected_accounts_repo.append_selected_entity(
            user_id=user_id,
            provider="pipedrive",
            entity={
                "id": entity_id,
                "name": entity_name,
                "type": "report",
                "account_name": connection.get("account_name") or "Pipedrive",
                "report_type": report_type,
                "pipeline_id": pipeline_filter,
                "owner_id": owner_filter,
            },
        )
        assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset.get("asset_id"),
            metadata={
                "connector_key": "pipedrive",
                "connector_entity_id": entity_id,
                "connector_entity_name": entity_name,
                "pipedrive_report_type": report_type,
                "pipedrive_manifest": manifest,
            },
        )
        asset.update(
            {
                "connector_key": "pipedrive",
                "connector_entity_id": entity_id,
                "connector_entity_name": entity_name,
                "pipedrive_report_type": report_type,
                "pipedrive_manifest": manifest,
            }
        )
        return {
            "success": True,
            "asset": asset,
            "row_count": len(rows),
            "column_count": len(headers),
            "message": f"Successfully synced {len(rows)} rows from Pipedrive ({entity_name}).",
            "entity_id": entity_id,
            "truncated": bool(query_result.get("truncated")),
        }

    # ── Scheduled sync token guards ───────────────────────────────────────────

    def assert_meta_token_valid(self, user_id: str) -> None:
        """Raise TokenExpiredError if the Meta token is missing or expired."""
        status = self.get_meta_connection_status(user_id)
        if not status.get("connected"):
            raise TokenExpiredError(
                "meta_ads", status.get("reason", "token missing or expired")
            )

    def assert_tiktok_token_valid(self, user_id: str) -> None:
        """Raise TokenExpiredError if the TikTok token is missing or expired."""
        status = self.get_tiktok_connection_status(user_id)
        if not status.get("connected"):
            raise TokenExpiredError(
                "tiktok", status.get("reason", "token missing or expired")
            )

    def assert_stripe_token_valid(self, user_id: str) -> None:
        """Raise TokenExpiredError if no Stripe connection record exists."""
        record = connected_accounts_repo.get_connection(user_id, "stripe")
        if not record:
            raise TokenExpiredError(
                "stripe", "Stripe connection not found — please reconnect"
            )

    def assert_appsflyer_token_valid(self, user_id: str) -> None:
        """Raise TokenExpiredError if no AppsFlyer token exists."""
        record = connected_accounts_repo.get_connection(user_id, "appsflyer")
        if not record:
            raise TokenExpiredError(
                "appsflyer", "AppsFlyer token missing — please reconnect"
            )

    def assert_hubspot_token_valid(self, user_id: str) -> None:
        """Raise TokenExpiredError if no HubSpot token exists."""
        record = connected_accounts_repo.get_connection(user_id, "hubspot")
        if not record or not (
            record.get("encrypted_access_token")
            or record.get("encrypted_refresh_token")
            or record.get("access_token")
            or record.get("refresh_token")
        ):
            raise TokenExpiredError(
                "hubspot", "HubSpot connection missing — please reconnect"
            )

    def assert_salesforce_token_valid(self, user_id: str) -> None:
        """Raise TokenExpiredError if no Salesforce token exists."""
        record = connected_accounts_repo.get_connection(user_id, "salesforce")
        if not record or not (
            record.get("encrypted_access_token")
            or record.get("encrypted_refresh_token")
            or record.get("access_token")
            or record.get("refresh_token")
        ):
            raise TokenExpiredError(
                "salesforce", "Salesforce connection missing — please reconnect"
            )

    def assert_pipedrive_token_valid(self, user_id: str) -> None:
        """Raise TokenExpiredError if no Pipedrive token exists."""
        record = connected_accounts_repo.get_connection(user_id, "pipedrive")
        if not record or not (
            record.get("encrypted_access_token")
            or record.get("encrypted_refresh_token")
            or record.get("access_token")
            or record.get("refresh_token")
        ):
            raise TokenExpiredError(
                "pipedrive", "Pipedrive connection missing — please reconnect"
            )

    def _resolve_stripe_dates(
        self,
        date_preset: Optional[str],
        start_date: Optional[str],
        end_date: Optional[str],
    ):
        """Convert a date preset or explicit dates to (from_d, to_d, gte_unix, lte_unix)."""
        from datetime import date as date_type

        today = datetime.now(timezone.utc).date()

        if date_preset and date_preset != "custom":
            if date_preset == "last_7d":
                from_d, to_d = today - timedelta(days=7), today - timedelta(days=1)
            elif date_preset == "last_30d":
                from_d, to_d = today - timedelta(days=30), today - timedelta(days=1)
            elif date_preset == "last_90d":
                from_d, to_d = today - timedelta(days=90), today - timedelta(days=1)
            elif date_preset == "this_month":
                from_d, to_d = today.replace(day=1), today
            elif date_preset == "last_month":
                first_this = today.replace(day=1)
                last_prev = first_this - timedelta(days=1)
                from_d, to_d = last_prev.replace(day=1), last_prev
            else:
                from_d, to_d = today - timedelta(days=30), today - timedelta(days=1)
        else:
            try:
                from_d = (
                    datetime.strptime(start_date, "%Y-%m-%d").date()
                    if start_date
                    else today - timedelta(days=30)
                )
                to_d = (
                    datetime.strptime(end_date, "%Y-%m-%d").date()
                    if end_date
                    else today - timedelta(days=1)
                )
            except (ValueError, TypeError):
                from_d, to_d = today - timedelta(days=30), today - timedelta(days=1)

        gte = int(
            datetime(
                from_d.year, from_d.month, from_d.day, tzinfo=timezone.utc
            ).timestamp()
        )
        lte = int(
            datetime(
                to_d.year, to_d.month, to_d.day, 23, 59, 59, tzinfo=timezone.utc
            ).timestamp()
        )
        return from_d, to_d, gte, lte

    def _ts_to_str(self, ts) -> str:
        """Convert a Unix timestamp to a UTC datetime string."""
        if ts is None:
            return ""
        return (
            datetime.fromtimestamp(ts, tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )

    def _fetch_stripe_charges(
        self, platform_key: str, stripe_account: str, created_filter: dict
    ):
        """Fetch charges for a connected account and return (rows, headers)."""
        import stripe as stripe_sdk

        headers = [
            "id",
            "amount",
            "currency",
            "status",
            "created",
            "customer",
            "description",
            "failure_code",
            "refunded",
            "card_brand",
        ]
        rows = []
        try:
            for ch in stripe_sdk.Charge.list(
                created=created_filter,
                limit=100,
                api_key=platform_key,
                stripe_account=stripe_account,
            ).auto_paging_iter():
                card_brand = ""
                pmd = getattr(ch, "payment_method_details", None)
                if pmd:
                    card = getattr(pmd, "card", None)
                    if card:
                        card_brand = getattr(card, "brand", "") or ""
                rows.append(
                    [
                        ch.id,
                        round(ch.amount / 100, 2),
                        (ch.currency or "").upper(),
                        ch.status or "",
                        self._ts_to_str(ch.created),
                        ch.customer or "",
                        ch.description or "",
                        ch.failure_code or "",
                        ch.refunded,
                        card_brand,
                    ]
                )
        except stripe_sdk.error.StripeError as e:
            raise HTTPException(status_code=500, detail=f"Stripe API error: {str(e)}")
        return rows, headers

    def _fetch_stripe_subscriptions(
        self, platform_key: str, stripe_account: str, created_filter: dict
    ):
        """Fetch subscriptions for a connected account and return (rows, headers)."""
        import stripe as stripe_sdk

        headers = [
            "id",
            "customer",
            "status",
            "plan_amount",
            "plan_interval",
            "current_period_start",
            "current_period_end",
            "created",
            "canceled_at",
        ]
        rows = []
        try:
            for sub in stripe_sdk.Subscription.list(
                created=created_filter,
                status="all",
                limit=100,
                api_key=platform_key,
                stripe_account=stripe_account,
            ).auto_paging_iter():
                plan = getattr(sub, "plan", None)
                plan_amount = (
                    round(plan.amount / 100, 2)
                    if plan and plan.amount is not None
                    else ""
                )
                plan_interval = plan.interval if plan else ""
                rows.append(
                    [
                        sub.id,
                        sub.customer or "",
                        sub.status or "",
                        plan_amount,
                        plan_interval,
                        self._ts_to_str(sub.current_period_start),
                        self._ts_to_str(sub.current_period_end),
                        self._ts_to_str(sub.created),
                        self._ts_to_str(getattr(sub, "canceled_at", None)),
                    ]
                )
        except stripe_sdk.error.StripeError as e:
            raise HTTPException(status_code=500, detail=f"Stripe API error: {str(e)}")
        return rows, headers

    def _fetch_stripe_customers(
        self, platform_key: str, stripe_account: str, created_filter: dict
    ):
        """Fetch customers for a connected account and return (rows, headers)."""
        import stripe as stripe_sdk

        headers = [
            "id",
            "email",
            "name",
            "created",
            "currency",
            "balance",
            "description",
        ]
        rows = []
        try:
            for c in stripe_sdk.Customer.list(
                created=created_filter,
                limit=100,
                api_key=platform_key,
                stripe_account=stripe_account,
            ).auto_paging_iter():
                balance = c.balance if c.balance is not None else 0
                rows.append(
                    [
                        c.id,
                        c.email or "",
                        c.name or "",
                        self._ts_to_str(c.created),
                        c.currency or "",
                        round(balance / 100, 2),
                        c.description or "",
                    ]
                )
        except stripe_sdk.error.StripeError as e:
            raise HTTPException(status_code=500, detail=f"Stripe API error: {str(e)}")
        return rows, headers

    async def fetch_stripe_data(
        self,
        user_id: str,
        report_type: str,
        project_id: str,
        date_preset: Optional[str],
        start_date: Optional[str],
        end_date: Optional[str],
    ) -> Dict[str, Any]:
        """Fetch Stripe data for a connected account and save as a CSV asset."""
        import stripe as stripe_sdk

        record = connected_accounts_repo.get_connection(user_id, "stripe")
        if not record:
            raise HTTPException(status_code=401, detail="Stripe not connected.")

        stripe_account = record["access_token"]
        platform_key = config.stripe.secret_key

        from_d, to_d, gte, lte = self._resolve_stripe_dates(
            date_preset, start_date, end_date
        )
        created_filter = {"gte": gte, "lte": lte}

        try:
            if report_type == "charges":
                rows, headers = self._fetch_stripe_charges(
                    platform_key, stripe_account, created_filter
                )
            elif report_type == "subscriptions":
                rows, headers = self._fetch_stripe_subscriptions(
                    platform_key, stripe_account, created_filter
                )
            elif report_type == "customers":
                rows, headers = self._fetch_stripe_customers(
                    platform_key, stripe_account, created_filter
                )
            else:
                raise HTTPException(
                    status_code=400, detail=f"Unknown report_type: {report_type}"
                )
        except stripe_sdk.error.PermissionError:
            connected_accounts_repo.delete_connection(user_id, "stripe")
            raise HTTPException(
                status_code=401,
                detail="Stripe account access revoked. Please reconnect.",
            )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerows(rows)
        csv_bytes = output.getvalue().encode("utf-8")

        row_count = len(rows)
        column_count = len(headers)
        filename = f"stripe_{report_type}_{from_d}_{to_d}.csv"

        asset = self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_bytes,
            filename=filename,
            asset_type="integration_stripe",
            extension="csv",
            row_count=row_count,
            column_count=column_count,
        )
        return {
            "asset": asset,
            "row_count": row_count,
            "column_count": column_count,
            "message": f"Successfully synced {row_count} rows from Stripe ({report_type}).",
            "success": True,
        }

    async def disconnect_stripe(self, user_id: str) -> None:
        """Remove stored Stripe connection."""
        connected_accounts_repo.delete_connection(user_id, "stripe")

    # ── Google Ads ────────────────────────────────────────────────────────────

    async def fetch_google_ads_accounts(self, user_id: str) -> Dict[str, Any]:
        """Fetch Google Ads accounts using Clerk Token and return them with sourceType."""
        access_token = await self._get_google_access_token(user_id)
        if not access_token:
            return {
                "success": False,
                "error": "Google account not connected or token expired.",
                "ad_accounts": [],
            }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                headers = {"Authorization": f"Bearer {access_token}"}
                # Check if we have developer token configured in yaml config
                if config.google_ads and config.google_ads.developer_token:
                    headers["developer-token"] = config.google_ads.developer_token

                resp = await client.get(
                    "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
                    headers=headers,
                )

                if resp.status_code == 200:
                    data = resp.json()
                    resource_names = data.get("resourceNames", [])
                    accounts = []
                    for c_name in resource_names:
                        customer_id = c_name.split("/")[-1]
                        accounts.append(
                            {
                                "id": customer_id,
                                "name": f"Ad Account {customer_id}",
                                "account_status": "UNKNOWN",
                                "currency": "USD",
                                "timezone_name": "UTC",
                                "source_type": "standard",
                            }
                        )
                    return {"success": True, "ad_accounts": accounts}
                else:
                    # Any non-200 from Google Ads (401 insufficient scope, 403 permission denied,
                    # etc.) means the user has no Google Ads account or the adwords scope wasn't
                    # granted. True token expiry/revocation is already caught above by
                    # _get_google_access_token returning None. Treat all API errors as
                    # "no accounts found" so the modal shows the graceful empty state.
                    return {"success": True, "ad_accounts": []}

        except Exception as e:
            logger.error(f"Failed to fetch Google Ads accounts: {e}")
            return {"success": False, "ad_accounts": [], "error": str(e)}

    async def fetch_google_ads_data(
        self,
        user_id: str,
        ad_account_id: str,
        project_id: str,
        start_date: str,
        end_date: str,
        account_name: str,
    ) -> Dict[str, Any]:
        """Fetch Google Ads Campaign data and save it as an asset."""
        # Mocking data generation
        headers = [
            "Campaign ID",
            "Campaign Name",
            "Impressions",
            "Clicks",
            "Cost",
            "Conversions",
        ]
        rows = [
            ["1001", "Q3 Promo Campaign", "15000", "450", "300.50", "12"],
            ["1002", "Always On Search", "32000", "1200", "850.00", "45"],
        ]

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerows(rows)
        csv_content = output.getvalue().encode("utf-8")

        asset_info = self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_content,
            filename=f"google_ads_{ad_account_id}.csv",
            asset_type="integration_google_ads",
            extension="csv",
            row_count=len(rows),
            column_count=len(headers),
        )
        connected_accounts_repo.append_selected_entity(
            user_id=user_id,
            provider="google_ads",
            entity={
                "id": str(ad_account_id),
                "name": account_name or f"Account {ad_account_id}",
                "type": "account",
            },
        )
        assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_info.get("asset_id"),
            metadata={
                "connector_key": "google_ads",
                "connector_entity_id": str(ad_account_id),
                "connector_entity_name": account_name or f"Account {ad_account_id}",
            },
        )

        return {
            "success": True,
            "message": "Google Ads data synced successfully",
            "asset": asset_info,
            "row_count": len(rows),
            "column_count": len(headers),
        }

    # ── Firebase ─────────────────────────────────────────────────────────────

    async def fetch_firebase_projects(self, user_id: str) -> Dict[str, Any]:
        """Fetch Firebase Projects using Clerk Token."""
        access_token = await self._get_google_access_token(user_id)
        if not access_token:
            return {
                "success": False,
                "error": "Google account not connected or token expired.",
                "projects": [],
            }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://firebase.googleapis.com/v1beta1/projects",
                    headers={"Authorization": f"Bearer {access_token}"},
                )

                projects = []
                if resp.status_code == 200:
                    data = resp.json()
                    projects = data.get("results", [])
                else:
                    return {
                        "success": False,
                        "error": f"Firebase API Error: {resp.text}",
                        "projects": [],
                    }

                transformed = [
                    {
                        "id": p.get("projectId"),
                        "name": p.get("displayName", p.get("projectId")),
                        "source_type": "project",
                    }
                    for p in projects
                ]
                return {"success": True, "projects": transformed}

        except Exception as e:
            logger.error(f"Failed to fetch Firebase projects: {e}")
            return {"success": False, "projects": [], "error": str(e)}

    async def fetch_firebase_data(
        self,
        user_id: str,
        firebase_project_id: str,
        project_id: str,
        start_date: str,
        end_date: str,
        expected_app_name: str,
    ) -> Dict[str, Any]:
        """Fetch Firebase Analytics data via GA4 representation and save as asset."""
        # Mocking Firebase Analytics data
        headers = ["Date", "Event Name", "Event Count", "Active Users"]
        rows = [
            ["2023-10-01", "app_open", "1500", "800"],
            ["2023-10-01", "in_app_purchase", "45", "40"],
        ]

        import io
        import csv

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerows(rows)
        csv_content = output.getvalue().encode("utf-8")

        asset_info = self._save_integration_asset(
            user_id=user_id,
            project_id=project_id,
            file_content=csv_content,
            filename=f"firebase_{firebase_project_id}.csv",
            asset_type="integration_firebase",
            extension="csv",
            row_count=len(rows),
            column_count=len(headers),
        )
        connected_accounts_repo.append_selected_entity(
            user_id=user_id,
            provider="firebase",
            entity={
                "id": str(firebase_project_id),
                "name": expected_app_name or str(firebase_project_id),
                "type": "project",
            },
        )
        assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=asset_info.get("asset_id"),
            metadata={
                "connector_key": "firebase",
                "connector_entity_id": str(firebase_project_id),
                "connector_entity_name": expected_app_name or str(firebase_project_id),
            },
        )

        return {
            "success": True,
            "message": "Firebase Analytics data synced successfully",
            "asset": asset_info,
            "row_count": len(rows),
            "column_count": len(headers),
        }


integration_service = IntegrationService()
