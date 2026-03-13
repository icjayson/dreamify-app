import io
import csv
import uuid
import json
import logging
import time
import asyncio
from typing import Dict, Any, Optional

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

    async def fetch_google_analytics_data(self, user_id: str, property_id: str, project_id: str, start_date: str = "30daysAgo", end_date: str = "today") -> Dict[str, Any]:
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
            asset_info = self._save_analytics_asset(user_id, project_id, csv_content)
            
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
            raise ValueError("Google OAuth token not found for user. Please connect your Google account.")

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
            logger.error(f"Failed to fetch Google Analytics properties: {e}")
            raise Exception(f"Failed to fetch Google Analytics properties: {str(e)}")

    def _save_analytics_asset(self, user_id: str, project_id: str, csv_content: bytes) -> Dict[str, Any]:
        """Save the generated CSV content as a user asset in S3 and DynamoDB."""
        asset_id = str(uuid.uuid4())
        file_id = str(uuid.uuid4())
        extension = "csv"
        filename = f"google_analytics_30d_{asset_id[:8]}.csv"
        
        file_size = len(csv_content)
        checksum = compute_sha256_checksum(csv_content)
        content_type = "text/csv"
        
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
            data=csv_content,
            content_type=content_type,
        )
        
        # Save to DynamoDB
        asset = assets_repo.create_asset(
            user_id=user_id,
            project_id=project_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            asset_type="integration_ga",
            size_bytes=file_size,
            checksum_sha256=checksum,
            version=config.aws.s3.USER_ASSETS_BUCKET_VERSION,
            content_type=content_type,
            asset_id=asset_id,
            file_id=file_id,
            original_filename=filename,
            extension=extension,
        )
        
        return asset

integration_service = IntegrationService()
