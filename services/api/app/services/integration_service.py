import io
import csv
import uuid
import json
import logging
import time
import asyncio
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List

import httpx

from clerk_backend_api import Clerk
from google.analytics.data_v1beta import BetaAnalyticsDataClient, BetaAnalyticsDataAsyncClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    RunReportRequest,
)
from google.analytics.admin import AnalyticsAdminServiceAsyncClient
from google.oauth2.credentials import Credentials

from utils.config import config
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import connected_accounts as connected_accounts_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes
from utils.s3.paths import build_asset_key

logger = logging.getLogger(__name__)

class IntegrationService:
    def __init__(self):
        self.clerk = Clerk(bearer_auth=config.clerk.CLERK_SECRET_KEY)

    async def _get_google_access_token(self, user_id: str) -> Optional[str]:
        """Fetch the Google OAuth access token from Clerk for a given user."""
        try:
            # Clerk's API endpoint to get oauth access tokens
            # https://api.clerk.com/v1/users/{user_id}/oauth_access_tokens/{provider}
            response = await self.clerk.users.get_o_auth_access_token_async(
                user_id=user_id,
                provider="oauth_google"
            )
            # The response might be a paginated list or directly a list of tokens depending on version
            tokens = getattr(response, "data", response) if hasattr(response, "data") else response
            
            if tokens and len(tokens) > 0:
                # Return the top token
                return getattr(tokens[0], "token", tokens[0].get("token") if isinstance(tokens[0], dict) else None)
            return None
        except Exception as e:
            logger.error(f"Failed to fetch Google OAuth token from Clerk for user {user_id}: {e}")
            return None

    async def fetch_google_analytics_data(self, user_id: str, property_id: str, project_id: str, start_date: str = "30daysAgo", end_date: str = "today", account_name: str = "", property_name: str = "") -> Dict[str, Any]:
        """Fetch Google Analytics data and save it as an asset."""
        access_token = await self._get_google_access_token(user_id)
        if not access_token:
            raise ValueError("Google OAuth token not found for user. Please connect your Google account.")

        try:
            from google.oauth2.credentials import Credentials
            
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
                    Dimension(name="deviceCategory")
                ],
                metrics=[
                    Metric(name="sessions"),
                    Metric(name="activeUsers"), 
                    Metric(name="newUsers"),
                    Metric(name="screenPageViews"),
                    Metric(name="bounceRate"),
                    Metric(name="averageSessionDuration")
                ],
                date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
            )
            
            response = await client.run_report(request)
            
            # Structure the raw data into CSV format
            headers = [
                "Date", "Region", "Session Source", "Device Category", 
                "Sessions", "Active Users", "New Users", "Page Views", 
                "Bounce Rate", "Avg Session Duration"
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
                
                rows.append([
                    date_val, region, source, device,
                    sessions, active_users, new_users, page_views, 
                    bounce_rate, avg_session_duration
                ])
                
            # Create a CSV in memory
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(headers)
            writer.writerows(rows)
            
            csv_content = output.getvalue().encode('utf-8')
            
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
            
            return {
                "success": True,
                "message": "Google Analytics data synced successfully",
                "asset": asset_info,
                "row_count": len(rows),
                "column_count": len(headers)
            }
            
        except Exception as e:
            logger.error(f"Failed to fetch Google Analytics data: {e}")
            raise Exception(f"Failed to fetch Google Analytics data: {str(e)}")

    async def fetch_google_analytics_properties(self, user_id: str) -> Dict[str, Any]:
        """Fetch all Google Analytics accounts and their properties for the user."""
        t0 = time.time()
        access_token = await self._get_google_access_token(user_id)
        logger.info(f"[Perf] _get_google_access_token (Clerk) took {time.time() - t0:.2f}s")

        if not access_token:
            logger.warning(f"No Google OAuth token available for user {user_id} - user needs to reconnect Google account")
            return {
                "success": False,
                "accounts": [],
                "error": "Your Google account connection has expired or was not found. Please reconnect your Google account in your profile settings and ensure you grant Google Analytics access."
            }

        try:
            from google.oauth2.credentials import Credentials
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
            logger.info(f"[Perf] list_accounts (GA) took {time.time() - t1:.2f}s, found {len(accounts)} accounts")
            
            t2 = time.time()
            
            # Helper async function to fetch properties for a single account
            async def fetch_properties_for_account(account_name, account_display_name):
                properties_request = await admin_client.list_properties(request={"filter": f"parent:{account_name}"})
                prop_list = []
                async for prop in properties_request:
                    prop_name_full = prop.name
                    prop_id = prop_name_full.split('/')[-1] if prop_name_full else ""
                    
                    prop_list.append({
                        "property_id": prop_id,
                        "display_name": prop.display_name,
                        "industry_category": str(prop.industry_category),
                        "time_zone": prop.time_zone
                    })
                return {
                    "account_id": account_name.split('/')[-1] if account_name else "",
                    "account_name": account_display_name,
                    "properties": prop_list
                }
            
            # 2. For each account, list its properties concurrently
            tasks = [fetch_properties_for_account(name, display) for name, display in accounts]
            result_accounts = await asyncio.gather(*tasks)
            
            logger.info(f"[Perf] list_properties parallel (GA) took {time.time() - t2:.2f}s for {len(accounts)} accounts")
                
            return {
                "success": True,
                "accounts": result_accounts
            }
            
        except Exception as e:
            error_str = str(e)
            logger.error(f"Failed to fetch Google Analytics properties: {error_str}")
            
            # Detect insufficient scope errors from Google
            if "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in error_str or "insufficient authentication scopes" in error_str.lower():
                return {
                    "success": False,
                    "accounts": [],
                    "error": "Your Google account does not have Google Analytics access. Please reconnect your Google account and grant Analytics permissions when prompted."
                }
            
            return {
                "success": False,
                "accounts": [],
                "error": f"Failed to load Google Analytics properties. Please try again later."
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

    async def fetch_google_sheet_data(self, user_id: str, file_id: str, project_id: str) -> Dict[str, Any]:
        """Fetch Google Sheet data via the Sheets API and save it as a CSV asset."""
        access_token = await self._get_google_access_token(user_id)
        if not access_token:
            raise ValueError("Google OAuth token not found for user. Please connect your Google account.")

        try:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build
            import io
            import csv
            
            credentials = Credentials(token=access_token)
            
            # Use Sheets API (works with spreadsheets.readonly scope)
            # instead of Drive API (which requires drive or drive.file scope)
            sheets_service = build('sheets', 'v4', credentials=credentials)
            
            # Get spreadsheet metadata (title) and all values from the first sheet
            spreadsheet = sheets_service.spreadsheets().get(
                spreadsheetId=file_id,
                fields='properties.title,sheets.properties.title'
            ).execute()
            
            filename = spreadsheet.get('properties', {}).get('title', 'google_sheet')
            if not filename.endswith('.csv'):
                filename += '.csv'
            
            # Read data from all sheets
            sheets = spreadsheet.get('sheets', [])
            sheet_titles = [s['properties']['title'] for s in sheets] if sheets else ['Sheet1']
            
            all_rows = []
            headers = []
            
            for sheet_title in sheet_titles:
                result = sheets_service.spreadsheets().values().get(
                    spreadsheetId=file_id,
                    range=sheet_title
                ).execute()
                
                values = result.get('values', [])
                if not values:
                    continue
                
                if not headers:
                    # Use the first sheet's header row as the CSV header
                    headers = values[0]
                    all_rows.append(values[0])
                
                # Add data rows (skip header row of each sheet)
                all_rows.extend(values[1:])
            
            if not all_rows:
                raise Exception("The Google Sheet is empty")
            
            # Convert to CSV bytes
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerows(all_rows)
            csv_content = output.getvalue().encode('utf-8')
            
            row_count = len(all_rows) - 1  # exclude header row
                
            asset_info = self._save_integration_asset(
                user_id=user_id,
                project_id=project_id,
                file_content=csv_content,
                filename=filename,
                asset_type="integration_gsheets",
                extension="csv",
                row_count=row_count,
                column_count=len(headers),
            )
            
            return {
                "success": True,
                "message": "Google Sheet data synced successfully",
                "asset": asset_info,
                "row_count": row_count,
                "column_count": len(headers)
            }
        except Exception as e:
            logger.error(f"Failed to fetch Google Sheet data: {e}")
            raise Exception(f"Failed to fetch Google Sheet data: {str(e)}")

    # ── Meta OAuth helpers ────────────────────────────────────────────────────

    def _meta_config(self):
        if not config.meta:
            raise ValueError("Meta configuration is missing from config.yaml. Add app_id, app_secret, and redirect_uri under the 'meta:' key.")
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

    def _verify_meta_state(self, state: str, max_age_seconds: int = 600) -> Optional[str]:
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
            "scope": "ads_read",
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
            expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

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
            expires_at = datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
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
            expires_at = datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) >= expires_at:
                return {"connected": False, "reason": "expired"}
        except Exception:
            pass
        return {"connected": True, "expires_at": record.get("expires_at")}

    def disconnect_meta(self, user_id: str) -> None:
        """Remove the stored Facebook token."""
        connected_accounts_repo.delete_connection(user_id, "facebook")

    # ── Meta Ads data ─────────────────────────────────────────────────────────

    async def fetch_meta_ad_accounts(self, user_id: str) -> Dict[str, Any]:
        """Fetch all Meta ad accounts the user has access to."""
        access_token = self._get_facebook_access_token(user_id)
        if not access_token:
            return {
                "success": False,
                "ad_accounts": [],
                "error": "Facebook account not connected or token expired. Please connect via the Meta Ads modal."
            }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    "https://graph.facebook.com/v21.0/me/adaccounts",
                    params={
                        "fields": "id,name,account_status,currency,timezone_name",
                        "access_token": access_token,
                    }
                )
                response.raise_for_status()
                data = response.json()

            ad_accounts = []
            for account in data.get("data", []):
                ad_accounts.append({
                    "id": account.get("id", ""),
                    "name": account.get("name", ""),
                    "account_status": account.get("account_status", 0),
                    "currency": account.get("currency", ""),
                    "timezone_name": account.get("timezone_name", ""),
                })

            return {"success": True, "ad_accounts": ad_accounts}

        except httpx.HTTPStatusError as e:
            error_body = e.response.text
            logger.error(f"Meta API error fetching ad accounts: {e.response.status_code} {error_body}")
            if e.response.status_code in (401, 403):
                return {
                    "success": False,
                    "ad_accounts": [],
                    "error": "Facebook access denied. Please reconnect your Facebook account and grant Ads permissions."
                }
            return {
                "success": False,
                "ad_accounts": [],
                "error": f"Meta API error ({e.response.status_code}). Please try again later."
            }
        except Exception as e:
            logger.error(f"Failed to fetch Meta ad accounts: {e}")
            return {
                "success": False,
                "ad_accounts": [],
                "error": "Failed to load Meta ad accounts. Please try again later."
            }

    def _extract_action(self, actions: List[Dict], action_type: str) -> str:
        """Extract the value of a specific action type from Meta's actions array."""
        for action in (actions or []):
            if action.get("action_type") == action_type:
                return action.get("value", "0")
        return "0"

    async def fetch_meta_ads_data(
        self,
        user_id: str,
        ad_account_id: str,
        project_id: str,
        date_preset: Optional[str] = "last_30d",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        account_name: str = "",
    ) -> Dict[str, Any]:
        """Fetch Meta Ads insights data and save it as a CSV asset."""
        access_token = self._get_facebook_access_token(user_id)
        if not access_token:
            raise ValueError("Facebook account not connected or token expired. Please reconnect via the Meta Ads modal.")

        try:
            fields = (
                "campaign_id,campaign_name,date_start,date_stop,"
                "impressions,clicks,reach,spend,ctr,cpc,cpm,frequency,actions"
            )
            params: Dict[str, Any] = {
                "fields": fields,
                "level": "campaign",
                "limit": 500,
                "access_token": access_token,
            }

            if start_date and end_date:
                params["time_range"] = json.dumps({"since": start_date, "until": end_date})
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
                "campaign_id", "campaign_name", "date_start", "date_stop",
                "impressions", "clicks", "reach", "spend",
                "ctr", "cpc", "cpm", "frequency",
                "link_clicks", "post_engagements", "purchases", "leads",
            ]

            csv_rows = []
            for row in all_rows:
                actions = row.get("actions", [])
                csv_rows.append([
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
                ])

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

            return {
                "success": True,
                "message": "Meta Ads data synced successfully",
                "asset": asset_info,
                "row_count": len(csv_rows),
                "column_count": len(headers),
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"Meta API error fetching ads data: {e.response.status_code} {e.response.text}")
            raise Exception(f"Meta API error ({e.response.status_code}): {e.response.text}")
        except Exception as e:
            logger.error(f"Failed to fetch Meta Ads data: {e}")
            raise Exception(f"Failed to fetch Meta Ads data: {str(e)}")


integration_service = IntegrationService()
