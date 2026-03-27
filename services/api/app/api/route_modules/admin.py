"""
Admin monitoring endpoints for tracking and debugging AnalyzeCSVWorkflow LLM execution.
"""
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

from boto3.dynamodb.conditions import Attr
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from clerk_backend_api import Clerk
from utils.config import config
from app.dependencies.auth import require_admin
from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables
from utils.dynamodb.repos import conversations as conversations_repo
from utils.s3.conversations import load_conversation
from utils.s3.client import download_bytes
from app.api.route_modules.conversation import DashboardDataResponse
from app.api.route_modules.user import FilePreviewResponse
from utils.dynamodb.repos import assets as assets_repo
import json
import logging
import csv
import io

logger = logging.getLogger(__name__)

# Initialize Clerk client independently
clerk_client = Clerk(bearer_auth=config.clerk.CLERK_SECRET_KEY)

router = APIRouter(prefix="/admin", tags=["admin"])


class MetricsCache:
    def __init__(self, ttl_seconds=300):
        self.ttl = ttl_seconds
        self.data = None
        self.timestamp = 0

    def get(self):
        if self.data and (time.time() - self.timestamp) < self.ttl:
            return self.data
        return None

    def set(self, data):
        self.data = data
        self.timestamp = time.time()


metrics_cache = MetricsCache(ttl_seconds=300)

@router.get("/metrics")
async def get_admin_metrics(
    _: dict = Depends(require_admin),
):
    """
    Get high-level dashboard metrics directly from DynamoDB.
    Results are cached in memory for 5 minutes.
    """
    cached = metrics_cache.get()
    if cached:
        return cached

    try:
        total_unique_users = set()
        total_conversations = 0
        total_messages = 0
        
        last_key = None
        while True:
            result = conversations_repo.scan_all_conversations(limit=1000, last_evaluated_key=last_key)
            items = result.get("Items", [])
            for item in items:
                total_conversations += 1
                if "user_id" in item:
                    total_unique_users.add(item["user_id"])
                
                node_count = item.get("node_count")
                if node_count is not None:
                    total_messages += int(node_count)
                else:
                    total_messages += 2
            
            last_key = result.get("LastEvaluatedKey")
            if not last_key:
                break
                
        table = get_table(tables.workflow_status)
        completed = 0
        errors = 0
        
        last_status_key = None
        while True:
            status_kwargs = {
                "Limit": 1000,
                "FilterExpression": Attr("node_id").eq("workflow"),
                "ProjectionExpression": "#st",
                "ExpressionAttributeNames": {"#st": "status"}
            }
            if last_status_key:
                status_kwargs["ExclusiveStartKey"] = last_status_key
                
            resp = table.scan(**status_kwargs)
            for item in resp.get("Items", []):
                s = item.get("status")
                if s == "completed":
                    completed += 1
                elif s == "error":
                    errors += 1
            
            last_status_key = resp.get("LastEvaluatedKey")
            if not last_status_key:
                break
                
        total_runs = completed + errors
        success_rate = (completed / total_runs * 100) if total_runs > 0 else 100.0
        
        total_users_count = len(total_unique_users)
        avg_msgs = (total_messages / total_users_count) if total_users_count > 0 else 0.0
        
        metrics = {
            "total_users": total_users_count,
            "total_conversations": total_conversations,
            "total_messages": total_messages,
            "avg_msgs_per_user": round(avg_msgs, 1),
            "success_rate": round(success_rate, 1)
        }
        metrics_cache.set(metrics)
        return metrics
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate metrics: {str(e)}")


timeseries_cache = MetricsCache(ttl_seconds=300)

@router.get("/metrics/timeseries")
async def get_admin_metrics_timeseries(
    days: int = Query(30, ge=1, le=90),
    _: dict = Depends(require_admin),
):
    """
    Get time-series metrics for the last N days.
    """
    cache_key = f"timeseries_{days}"
    
    # We cheat the MetricsCache by storing a dict of cache keys inside
    cached_data = timeseries_cache.get()
    if cached_data and cache_key in cached_data:
        return cached_data[cache_key]

    try:
        start_date = datetime.now() - timedelta(days=days)
        start_date_iso = start_date.isoformat()
        
        # Initialize buckets
        buckets = {}
        for i in range(days):
            d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            buckets[d] = {
                "date": d,
                "messages": 0,
                "conversations": 0,
                "users_set": set(),
                "active_users": 0
            }
            
        last_key = None
        while True:
            result = conversations_repo.scan_recent_conversations(
                start_date_iso=start_date_iso, 
                limit=1000, 
                last_evaluated_key=last_key
            )
            for item in result.get("Items", []):
                created_at = item.get("created_at", "")
                if len(created_at) >= 10:
                    date_prefix = created_at[:10]
                    if date_prefix in buckets:
                        buckets[date_prefix]["conversations"] += 1
                        
                        node_count = item.get("node_count")
                        if node_count is not None:
                            buckets[date_prefix]["messages"] += int(node_count)
                        else:
                            buckets[date_prefix]["messages"] += 2
                            
                        if "user_id" in item:
                            buckets[date_prefix]["users_set"].add(item["user_id"])
            
            last_key = result.get("LastEvaluatedKey")
            if not last_key:
                break
                
        # Format output
        output = []
        # Sort keys chronologically (oldest to newest)
        for d in sorted(buckets.keys()):
            bucket = buckets[d]
            bucket["active_users"] = len(bucket["users_set"])
            del bucket["users_set"]
            output.append(bucket)
            
        # Save to cache
        current_cache = timeseries_cache.get() or {}
        current_cache[cache_key] = output
        timeseries_cache.set(current_cache)
        
        return output
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate time-series: {str(e)}")


class ConversationListItem(BaseModel):
    """Conversation metadata for list view."""
    conversation_id: str
    project_id: str
    user_id: str
    user_name: Optional[str] = None
    user_avatar: Optional[str] = None
    title: str
    created_at: str
    updated_at: str
    s3_bucket: Optional[str] = None
    s3_key: Optional[str] = None


class ConversationDetailResponse(BaseModel):
    """Full conversation JSON response."""
    conversation: Dict[str, Any]


class NodeListResponse(BaseModel):
    """Nodes array response."""
    nodes: List[Dict[str, Any]]


class ConversationListResponse(BaseModel):
    """List of conversations with pagination."""
    conversations: List[ConversationListItem]
    total: int
    last_key: Optional[str] = None


@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations(
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Number of results per page"),
    _: dict = Depends(require_admin),
):
    """
    List all conversations or filter by project_id with pagination.
    
    Returns conversation metadata for tracking and debugging.
    """
    try:
        # Get all conversations (we'll paginate in memory for simplicity)
        all_items = []
        
        if project_id:
            # Filter by project_id - get all matching items
            all_items = conversations_repo.scan_conversations_by_project(project_id, limit=None)
        else:
            # Get all conversations using paginated scan
            all_items = []
            last_key = None
            while True:
                result = conversations_repo.scan_all_conversations(limit=1000, last_evaluated_key=last_key)
                items = result.get("Items", [])
                all_items.extend(items)
                last_key = result.get("LastEvaluatedKey")
                if not last_key:
                    break
        
        # Sort by created_at descending
        all_items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        # Calculate pagination
        total = len(all_items)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = all_items[start_idx:end_idx]
        # Collect unique user IDs from current page
        unique_user_ids = list(set(item.get("user_id") for item in paginated_items if item.get("user_id")))
        user_metadata_map = {}
        
        # Fetch user profiles from Clerk if there are any users
        if unique_user_ids:
            try:
                clerk_users = clerk_client.users.list(request={"user_id": unique_user_ids})
                found_ids = []
                for u in clerk_users:
                    found_ids.append(u.id)
                    name_parts = filter(None, [u.first_name, u.last_name])
                    full_name = " ".join(name_parts)
                    user_metadata_map[u.id] = {
                        "name": full_name if full_name else (u.username if u.username else u.id),
                        "avatar": u.image_url
                    }
                
                # Check for missing users and try fallback instance if available
                missing_ids = list(set(unique_user_ids) - set(found_ids))
                if missing_ids and config.clerk.CLERK_LIVE_SECRET_KEY:
                    logger.info(f"Attempting fallback fetch for {len(missing_ids)} missing users from Live instance")
                    try:
                        clerk_live = Clerk(bearer_auth=config.clerk.CLERK_LIVE_SECRET_KEY)
                        live_users = clerk_live.users.list(request={"user_id": missing_ids})
                        for u in live_users:
                            found_ids.append(u.id)
                            name_parts = filter(None, [u.first_name, u.last_name])
                            full_name = " ".join(name_parts)
                            user_metadata_map[u.id] = {
                                "name": full_name if full_name else (u.username if u.username else u.id),
                                "avatar": u.image_url
                            }
                    except Exception as live_e:
                        logger.warning(f"Fallback Clerk fetch failed: {live_e}")

                # Final diagnostic log
                final_missing = set(unique_user_ids) - set(found_ids)
                if final_missing:
                    logger.warning(f"Clerk metadata still missing for {len(final_missing)} users after fallback attempt: {list(final_missing)}")
                else:
                    logger.info(f"Successfully resolved all {len(unique_user_ids)} user IDs")
                    
            except Exception as e:
                # Log error but don't fail the request (metadata will just be empty)
                logger.error(f"Failed to fetch Clerk user metadata: {str(e)}", exc_info=True)
        
        conversations = [
            ConversationListItem(
                conversation_id=item.get("conversation_id", ""),
                project_id=item.get("project_id", ""),
                user_id=item.get("user_id", ""),
                user_name=user_metadata_map.get(item.get("user_id"), {}).get("name"),
                user_avatar=user_metadata_map.get(item.get("user_id"), {}).get("avatar"),
                title=item.get("title", "Conversation"),
                created_at=item.get("created_at", ""),
                updated_at=item.get("updated_at", ""),
                s3_bucket=item.get("s3_bucket"),
                s3_key=item.get("s3_key"),
            )
            for item in paginated_items
        ]
        
        return ConversationListResponse(
            conversations=conversations,
            total=total,
            last_key=None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list conversations: {str(e)}")


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation_by_id(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID (required to get conversation from DynamoDB)"),
    _: dict = Depends(require_admin),
):
    """
    Get full conversation JSON by conversation_id.
    
    Loads the complete conversation data from S3 for tracking and debugging.
    """
    try:
        # Get conversation metadata from DynamoDB
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Load full conversation JSON from S3
        s3_bucket = conversation_meta.get("s3_bucket")
        s3_key = conversation_meta.get("s3_key")
        
        if not s3_bucket or not s3_key:
            raise HTTPException(status_code=404, detail="Conversation S3 location not found")
        
        conversation = load_conversation(s3_bucket, s3_key)
        
        return ConversationDetailResponse(conversation=conversation)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load conversation: {str(e)}")


@router.get("/conversations/{conversation_id}/nodes", response_model=NodeListResponse)
async def get_conversation_nodes(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID (required to get conversation from DynamoDB)"),
    _: dict = Depends(require_admin),
):
    """
    Get conversation nodes array.
    
    Returns the nodes array from the conversation JSON showing the full conversation flow.
    """
    try:
        # Get conversation metadata from DynamoDB
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Load full conversation JSON from S3
        s3_bucket = conversation_meta.get("s3_bucket")
        s3_key = conversation_meta.get("s3_key")
        
        if not s3_bucket or not s3_key:
            raise HTTPException(status_code=404, detail="Conversation S3 location not found")
        
        conversation = load_conversation(s3_bucket, s3_key)
        
        # Extract nodes array
        nodes = conversation.get("nodes", [])
        
        return NodeListResponse(nodes=nodes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load conversation nodes: {str(e)}")


@router.get("/conversations/{conversation_id}/dashboard", response_model=DashboardDataResponse)
async def get_conversation_dashboard(
    conversation_id: str,
    project_id: str = Query(..., description="Project ID"),
    dashboard_id: Optional[str] = Query(None, description="Specific dashboard ID to fetch"),
    _: dict = Depends(require_admin),
):
    """Get dashboard data from a specific dashboard or the latest dashboard in conversation for Admin."""
    logger.info(
        "Admin fetching dashboard for conversation: project_id=%s, conversation_id=%s, dashboard_id=%s",
        project_id,
        conversation_id,
        dashboard_id,
    )

    conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
    if not conversation_meta:
        logger.warning(
            "Conversation not found for dashboard request: project_id=%s, conversation_id=%s",
            project_id,
            conversation_id,
        )
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    s3_bucket = conversation_meta["s3_bucket"]
    s3_key = conversation_meta["s3_key"]
    conversation = load_conversation(s3_bucket, s3_key)
    
    # Get dashboards list
    dashboards = conversation.get("dashboards", [])
    if not dashboards:
        logger.info(
            "No dashboards present in conversation: project_id=%s, conversation_id=%s",
            project_id,
            conversation_id,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    
    # Select specific dashboard if ID provided, otherwise get latest
    if dashboard_id:
        target_dashboard = next((d for d in dashboards if d.get("dashboard_id") == dashboard_id), None)
        if not target_dashboard:
            logger.warning(
                "Dashboard not found: project_id=%s, conversation_id=%s, dashboard_id=%s",
                project_id,
                conversation_id,
                dashboard_id,
            )
            raise HTTPException(status_code=404, detail=f"Dashboard {dashboard_id} not found")
    else:
        target_dashboard = dashboards[-1]
    
    dash_id = target_dashboard.get("dashboard_id")
    s3_uri = target_dashboard.get("s3_uri")
    
    if not dash_id or not s3_uri:
        logger.warning(
            "Dashboard metadata incomplete for conversation: project_id=%s, conversation_id=%s, dashboard=%s",
            project_id,
            conversation_id,
            target_dashboard,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)
    
    # Parse s3://bucket/key format
    if not s3_uri.startswith("s3://"):
        logger.error(
            "Invalid S3 URI format for dashboard: project_id=%s, conversation_id=%s, dashboard_id=%s, s3_uri=%s",
            project_id,
            conversation_id,
            dash_id,
            s3_uri,
        )
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        logger.error(
            "Invalid S3 URI format (missing key) for dashboard: project_id=%s, conversation_id=%s, dashboard_id=%s, s3_uri=%s",
            project_id,
            conversation_id,
            dash_id,
            s3_uri,
        )
        raise HTTPException(status_code=500, detail="Invalid S3 URI format for dashboard")
    
    bucket = uri_parts[0]
    key = uri_parts[1].lstrip("/")
    
    try:
        dashboard_bytes = download_bytes(bucket, key)
        dashboard_data = json.loads(dashboard_bytes.decode("utf-8"))
        
        logger.info(
            "Successfully loaded dashboard from S3: bucket=%s, key=%s, dashboard_id=%s",
            bucket,
            key,
            dash_id,
        )

        return DashboardDataResponse(
            dashboard_id=dash_id,
            dashboard_data=dashboard_data,
        )
    except FileNotFoundError:
        logger.warning(
            "Dashboard data not found in S3, treating as no dashboard yet: bucket=%s, key=%s, dashboard_id=%s",
            bucket,
            key,
            dash_id,
        )
        return DashboardDataResponse(dashboard_id=None, dashboard_data=None)

@router.get("/conversations/{conversation_id}/assets/{asset_id}/preview", response_model=FilePreviewResponse)
async def get_conversation_asset_preview(
    conversation_id: str,
    asset_id: str,
    project_id: str = Query(..., description="Project ID"),
    _: dict = Depends(require_admin),
):
    """Preview CSV file data as JSON for Admin."""
    try:
        conversation_meta = conversations_repo.get_conversation(project_id, conversation_id)
        if not conversation_meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        user_id = conversation_meta.get("user_id")
        if not user_id:
            raise HTTPException(status_code=404, detail="User ID not found in conversation")

        # Get asset
        asset = assets_repo.get_asset(user_id, asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")
        
        # Check if file is CSV
        extension = asset.get("extension", "").lower()
        if extension != "csv":
            raise HTTPException(status_code=400, detail="Preview only supported for CSV files")
        
        # Download file from S3
        try:
            file_data = download_bytes(asset["s3_bucket"], asset["s3_key"])
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found in storage")
        
        # Parse CSV
        try:
            # Try different encodings
            encodings = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']
            content_str = None
            for encoding in encodings:
                try:
                    content_str = file_data.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            
            if content_str is None:
                raise HTTPException(status_code=500, detail="Could not decode file with any encoding")
            
            # Parse CSV with proper handling of quoted fields
            csv_reader = csv.reader(io.StringIO(content_str))
            rows = []
            total_rows = 0
            max_display_rows = 1000
            
            for row in csv_reader:
                total_rows += 1
                if total_rows <= max_display_rows:
                    rows.append(row)
            
            if len(rows) == 0:
                raise HTTPException(status_code=400, detail="CSV file is empty")
            
            # First row is headers
            columns = rows[0] if rows else []
            data_rows = rows[1:] if len(rows) > 1 else []
            
            filename = asset.get("filename", "file.csv")
            
            return FilePreviewResponse(
                success=True,
                filename=filename,
                columns=columns,
                rows=data_rows,
                total_rows=max(0, total_rows - 1),  # Exclude header
                displayed_rows=len(data_rows)
            )
            
        except csv.Error as e:
            raise HTTPException(status_code=500, detail=f"CSV parsing error: {str(e)}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

