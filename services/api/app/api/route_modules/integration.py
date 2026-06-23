import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

from app.dependencies.auth import require_user
from app.services.amazon_seller_service import amazon_seller_service
from app.services.integration_service import integration_service
from app.services.klaviyo_service import klaviyo_service
from app.services.lazada_seller_service import lazada_seller_service
from app.services.mixpanel_service import mixpanel_service
from app.services.posthog_service import posthog_service
from app.services.quickbooks_service import quickbooks_service
from app.services.shopify_service import shopify_service
from app.services.shopee_seller_service import shopee_seller_service
from app.services.supabase_service import supabase_service
from app.services.tiktok_shop_seller_service import tiktok_shop_seller_service
from app.services.zendesk_service import zendesk_service
from app.api.route_modules.user import AssetResponse, _map_asset, _ensure_project

router = APIRouter(
    tags=["integration", "google", "meta", "tiktok", "appsflyer", "stripe"]
)


class GoogleAnalyticsSyncRequest(BaseModel):
    property_id: str
    project_id: Optional[str] = None
    start_date: str = "30daysAgo"
    end_date: str = "today"
    account_name: str = ""
    property_name: str = ""


class GoogleAnalyticsSyncResponse(BaseModel):
    success: bool
    message: str
    asset: AssetResponse
    row_count: int
    column_count: int


class GoogleAnalyticsProperty(BaseModel):
    property_id: str
    display_name: str
    industry_category: str
    time_zone: str


class GoogleAnalyticsAccount(BaseModel):
    account_id: str
    account_name: str
    properties: list[GoogleAnalyticsProperty]


class GoogleAnalyticsPropertiesResponse(BaseModel):
    success: bool
    accounts: list[GoogleAnalyticsAccount]
    error: Optional[str] = None


class GoogleSheetSyncRequest(BaseModel):
    file_id: str
    project_id: Optional[str] = None
    access_token: Optional[str] = None


class GoogleSheetSyncResponse(BaseModel):
    success: bool
    message: str
    asset: AssetResponse
    row_count: int
    column_count: int


class GoogleTokenResponse(BaseModel):
    success: bool
    token: Optional[str]


class ConnectorSelectedEntity(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    account_name: Optional[str] = None
    connection_id: Optional[str] = None
    connector_key: Optional[str] = None
    database_type: Optional[str] = None
    schema_name: Optional[str] = None
    table_name: Optional[str] = None
    report_type: Optional[str] = None
    pipeline_id: Optional[str] = None
    object_name: Optional[str] = None
    owner_id: Optional[str] = None
    sync_mode: Optional[str] = None
    project_ref: Optional[str] = None
    shop_domain: Optional[str] = None
    resource: Optional[str] = None
    account_id: Optional[str] = None
    resource_id: Optional[str] = None
    metric_id: Optional[str] = None
    channel: Optional[str] = None
    project_id: Optional[str] = None
    seller_id: Optional[str] = None
    marketplace_id: Optional[str] = None
    shop_id: Optional[str] = None
    region: Optional[str] = None
    subdomain: Optional[str] = None


class ConnectorOverviewItem(BaseModel):
    connector_key: str
    display_name: str
    connected: bool
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)


class ConnectorsOverviewResponse(BaseModel):
    success: bool
    connectors: List[ConnectorOverviewItem]


class ConnectorEntityDetailResponse(BaseModel):
    success: bool
    connector_key: str
    display_name: str
    connected: bool
    entity: ConnectorSelectedEntity
    latest_asset: Optional[AssetResponse] = None
    latest_schedule: Optional[Dict[str, Any]] = None
    related_projects: List[Dict[str, Any]] = Field(default_factory=list)
    last_synced_at: Optional[str] = None
    account_name: Optional[str] = None


class ConnectorEntityRunItem(BaseModel):
    run_id: str
    schedule_id: Optional[str] = None
    status: Optional[str] = None
    triggered_at: Optional[str] = None
    completed_at: Optional[str] = None
    rows_fetched: Optional[int] = None
    columns_fetched: Optional[int] = None
    asset_id: Optional[str] = None
    asset_filename: Optional[str] = None
    date_range_start: Optional[str] = None
    date_range_end: Optional[str] = None
    config_snapshot: Optional[Dict[str, Any]] = None
    sync_version_name: Optional[str] = None


class ConnectorEntityHistoryResponse(BaseModel):
    success: bool
    runs: List[ConnectorEntityRunItem]


class ConnectorSyncVersionNameUpdateRequest(BaseModel):
    sync_version_name: str = ""


class ConnectorSyncVersionNameUpdateResponse(BaseModel):
    success: bool
    run_id: str
    sync_version_name: Optional[str] = None


class ConnectorEntityRefreshResponse(BaseModel):
    success: bool
    message: str
    asset: AssetResponse
    row_count: int
    column_count: int


class ConnectorEntityRefreshRequest(BaseModel):
    date_preset: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    campaign_ids: Optional[List[str]] = None
    adset_ids: Optional[List[str]] = None


class AddToNewProjectRequest(BaseModel):
    project_name: Optional[str] = "Untitled Project"
    prompt: Optional[str] = "Analyze this data and build a dashboard."
    asset_id: Optional[str] = None


class AddToNewProjectResponse(BaseModel):
    success: bool
    project: Dict[str, Any]
    asset: AssetResponse
    prompt: str


class ConnectorEntityDeleteResponse(BaseModel):
    success: bool
    message: str


@router.get(
    "/integration/google/properties", response_model=GoogleAnalyticsPropertiesResponse
)
async def get_google_analytics_properties(
    user_id: str = Depends(require_user),
):
    """
    Get a list of all Google Analytics accounts and properties the user has access to.
    """
    try:
        result = await integration_service.fetch_google_analytics_properties(
            user_id=user_id
        )
        return GoogleAnalyticsPropertiesResponse(
            success=result["success"],
            accounts=result.get("accounts", []),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch GA properties: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/integration/google/sync", response_model=GoogleAnalyticsSyncResponse)
async def sync_google_analytics_data(
    request: GoogleAnalyticsSyncRequest,
    user_id: str = Depends(require_user),
):
    """
    Sync Google Analytics data for the authenticated user and save it as an asset.
    The user must have already connected their Google account via Clerk with the Analytics scopes.
    """
    try:
        if not request.property_id:
            raise HTTPException(status_code=400, detail="property_id is required")

        project = _ensure_project(user_id, request.project_id)

        result = await integration_service.fetch_google_analytics_data(
            user_id=user_id,
            property_id=request.property_id,
            project_id=project["project_id"],
            start_date=request.start_date,
            end_date=request.end_date,
            account_name=request.account_name,
            property_name=request.property_name,
        )

        # Map the created asset to the standard AssetResponse
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )

        return GoogleAnalyticsSyncResponse(
            success=result["success"],
            message=result["message"],
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
    except Exception as e:
        # Wrap the error details
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/google/token", response_model=GoogleTokenResponse)
async def get_google_token(user_id: str = Depends(require_user)):
    """Get the Google OAuth token for the frontend Picker API."""
    try:
        # We need to access the token for the frontend Picker API to display the user's files
        token = await integration_service._get_google_access_token(user_id)
        return GoogleTokenResponse(success=True, token=token)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/connectors/overview", response_model=ConnectorsOverviewResponse
)
async def get_connectors_overview(user_id: str = Depends(require_user)):
    """Get unified connector statuses with selected entities."""
    try:
        result = await integration_service.fetch_connectors_overview(user_id=user_id)
        return ConnectorsOverviewResponse(
            success=result.get("success", True),
            connectors=result.get("connectors", []),
        )
    except Exception as e:
        logger.error(f"Failed to fetch connectors overview: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/connectors/{connector_key}/entities/{entity_id}/detail",
    response_model=ConnectorEntityDetailResponse,
)
async def get_connector_entity_detail(
    connector_key: str,
    entity_id: str,
    user_id: str = Depends(require_user),
):
    try:
        result = await integration_service.get_connector_entity_detail(
            user_id=user_id,
            connector_key=connector_key,
            entity_id=entity_id,
        )
        latest_asset = result.get("latest_asset")
        return ConnectorEntityDetailResponse(
            success=result.get("success", True),
            connector_key=result.get("connector_key", connector_key),
            display_name=result.get("display_name", connector_key),
            connected=bool(result.get("connected", False)),
            entity=result.get("entity", {"id": entity_id, "name": entity_id}),
            latest_asset=_map_asset(latest_asset) if latest_asset else None,
            latest_schedule=result.get("latest_schedule"),
            related_projects=result.get("related_projects", []),
            last_synced_at=result.get("last_synced_at"),
            account_name=result.get("account_name"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch connector entity detail: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/connectors/{connector_key}/entities/{entity_id}/history",
    response_model=ConnectorEntityHistoryResponse,
)
async def get_connector_entity_history(
    connector_key: str,
    entity_id: str,
    limit: int = Query(20, ge=1, le=100),
    user_id: str = Depends(require_user),
):
    try:
        result = await integration_service.get_connector_entity_history(
            user_id=user_id,
            connector_key=connector_key,
            entity_id=entity_id,
            limit=limit,
        )
        return ConnectorEntityHistoryResponse(
            success=result.get("success", True),
            runs=result.get("runs", []),
        )
    except Exception as e:
        logger.error(f"Failed to fetch connector entity history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch(
    "/integration/connectors/{connector_key}/entities/{entity_id}/history/{run_id}/version-name",
    response_model=ConnectorSyncVersionNameUpdateResponse,
)
async def update_connector_sync_version_name(
    connector_key: str,
    entity_id: str,
    run_id: str,
    request: ConnectorSyncVersionNameUpdateRequest,
    user_id: str = Depends(require_user),
):
    try:
        result = await integration_service.update_connector_sync_version_name(
            user_id=user_id,
            connector_key=connector_key,
            entity_id=entity_id,
            run_id=run_id,
            sync_version_name=request.sync_version_name,
        )
        return ConnectorSyncVersionNameUpdateResponse(
            success=result.get("success", True),
            run_id=result.get("run_id", run_id),
            sync_version_name=result.get("sync_version_name"),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update sync version name: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/integration/connectors/{connector_key}/entities/{entity_id}/refresh",
    response_model=ConnectorEntityRefreshResponse,
)
async def refresh_connector_entity(
    connector_key: str,
    entity_id: str,
    request: ConnectorEntityRefreshRequest,
    user_id: str = Depends(require_user),
):
    try:
        result = await integration_service.refresh_connector_entity(
            user_id=user_id,
            connector_key=connector_key,
            entity_id=entity_id,
            overrides=request.model_dump(exclude_none=True),
        )
        return ConnectorEntityRefreshResponse(
            success=result.get("success", True),
            message=result.get("message", "Refresh completed"),
            asset=_map_asset(
                result.get("asset"),
                row_count=result.get("row_count"),
                column_count=result.get("column_count"),
            ),
            row_count=result.get("row_count", 0),
            column_count=result.get("column_count", 0),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to refresh connector entity: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/integration/connectors/{connector_key}/entities/{entity_id}/add-to-new-project",
    response_model=AddToNewProjectResponse,
)
async def add_connector_entity_to_new_project(
    connector_key: str,
    entity_id: str,
    request: AddToNewProjectRequest,
    user_id: str = Depends(require_user),
):
    try:
        result = await integration_service.add_connector_entity_to_new_project(
            user_id=user_id,
            connector_key=connector_key,
            entity_id=entity_id,
            project_name=request.project_name or "Untitled Project",
            prompt=request.prompt or "Analyze this data and build a dashboard.",
            asset_id=request.asset_id,
        )
        return AddToNewProjectResponse(
            success=result.get("success", True),
            project=result.get("project", {}),
            asset=_map_asset(result.get("asset")),
            prompt=result.get("prompt", ""),
        )
    except Exception as e:
        logger.error(f"Failed to add connector entity to new project: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete(
    "/integration/connectors/{connector_key}/entities/{entity_id}",
    response_model=ConnectorEntityDeleteResponse,
)
async def delete_connector_entity(
    connector_key: str,
    entity_id: str,
    user_id: str = Depends(require_user),
):
    try:
        await integration_service.remove_connector_entity(
            user_id=user_id,
            connector_key=connector_key,
            entity_id=entity_id,
        )
        return ConnectorEntityDeleteResponse(
            success=True, message="Connector entity deleted."
        )
    except Exception as e:
        logger.error(f"Failed to delete connector entity: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/integration/google-sheets/sync", response_model=GoogleSheetSyncResponse)
async def sync_google_sheet_data(
    request: GoogleSheetSyncRequest,
    user_id: str = Depends(require_user),
):
    """
    Sync Google Sheet data for the authenticated user and save it as an asset.
    """
    try:
        if not request.file_id:
            raise HTTPException(status_code=400, detail="file_id is required")

        project = _ensure_project(user_id, request.project_id)

        result = await integration_service.fetch_google_sheet_data(
            user_id=user_id,
            file_id=request.file_id,
            project_id=project["project_id"],
            access_token=request.access_token,
        )

        # Map the created asset to the standard AssetResponse
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )

        return GoogleSheetSyncResponse(
            success=result["success"],
            message=result["message"],
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
    except Exception as e:
        print(f"Error syncing google sheet: {e}")
        # Wrap the error details
        raise HTTPException(status_code=500, detail=str(e))


# ── Meta Ads ──────────────────────────────────────────────────────────────────

# OAuth popup close page — sent back to the browser popup window after a
# successful or failed OAuth handshake.
_OAUTH_SUCCESS_HTML = """<!DOCTYPE html>
<html>
<head><title>Connected</title></head>
<body>
<script>
  (function() {
    // Primary: BroadcastChannel works even when window.opener is cleared by COOP headers
    try {
      var bc = new BroadcastChannel('meta_oauth');
      bc.postMessage({ type: 'META_OAUTH_SUCCESS' });
      bc.close();
    } catch(e) { console.warn('BroadcastChannel failed', e); }
    // Fallback: postMessage for browsers without BroadcastChannel
    try { window.opener.postMessage({ type: 'META_OAUTH_SUCCESS' }, '*'); }
    catch(e) {}
    window.close();
  })();
</script>
<p>Connected! You can close this window.</p>
</body>
</html>"""

_OAUTH_ERROR_HTML = """<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body>
<script>
  (function() {
    var err = '{error}';
    try {{
      var bc = new BroadcastChannel('meta_oauth');
      bc.postMessage({{ type: 'META_OAUTH_ERROR', error: err }});
      bc.close();
    }} catch(e) {{}}
    try {{ window.opener.postMessage({{ type: 'META_OAUTH_ERROR', error: err }}, '*'); }}
    catch(e) {{}}
    window.close();
  }})();
</script>
<p>Error: {error}</p>
</body>
</html>"""


def _verify_bearer(authorization: str) -> Optional[str]:
    """Validate a 'Bearer <token>' string and return the user_id, or None on failure."""
    from utils.clerk_auth import clerk_auth_jwt

    class _FakeRequest:
        """Minimal request-like object that clerk_auth_jwt can read headers from."""

        def __init__(self, auth_header: str):
            self.headers = {"Authorization": auth_header}
            self.scope = {
                "type": "http",
                "headers": [(b"authorization", auth_header.encode())],
            }

        def header(self, name: str) -> Optional[str]:
            return self.headers.get(name)

    try:
        payload = clerk_auth_jwt(_FakeRequest(authorization))
        return payload.get("sub")
    except Exception:
        return None


class MetaConnectionStatusResponse(BaseModel):
    connected: bool
    expires_at: Optional[str] = None
    reason: Optional[str] = None


@router.get("/integration/meta/oauth/start")
async def meta_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the Facebook OAuth consent screen.

    Accepts the Clerk JWT via the Authorization header *or* as a ``token``
    query-parameter (needed when opened via window.open() which cannot set
    request headers).
    """
    # Resolve bearer token: header takes priority, query param is the popup fallback
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"

    if not bearer:
        return HTMLResponse(
            _OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )

    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )

    try:
        url = integration_service.get_meta_oauth_url(user_id)
        return RedirectResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/meta/oauth/callback", response_class=HTMLResponse)
async def meta_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Facebook redirects here after the user grants/denies access."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_OAUTH_ERROR_HTML.format(error=msg))

    try:
        await integration_service.handle_meta_oauth_callback(code=code, state=state)
        return HTMLResponse(_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Meta OAuth callback error: {e}")
        return HTMLResponse(_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/meta/status", response_model=MetaConnectionStatusResponse)
async def meta_connection_status(user_id: str = Depends(require_user)):
    """Return whether the authenticated user has a valid stored Facebook token."""
    result = integration_service.get_meta_connection_status(user_id)
    return MetaConnectionStatusResponse(**result)


@router.delete("/integration/meta/disconnect")
async def meta_disconnect(user_id: str = Depends(require_user)):
    """Remove the stored Facebook token for the authenticated user."""
    integration_service.disconnect_meta(user_id)
    return {"success": True}


class MetaAdAccount(BaseModel):
    id: str
    name: str
    account_status: int
    currency: str
    timezone_name: str
    source_type: str = "personal"  # "personal" | "business"
    business_id: Optional[str] = None
    business_name: Optional[str] = None


class MetaAdAccountsResponse(BaseModel):
    success: bool
    ad_accounts: list[MetaAdAccount]
    has_business_management: bool = False
    error: Optional[str] = None


class MetaAdsSyncRequest(BaseModel):
    ad_account_id: str
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    account_name: str = ""
    adset_ids: Optional[list[str]] = None
    campaign_ids: Optional[list[str]] = None


class MetaAdsSyncResponse(BaseModel):
    success: bool
    message: str
    asset: AssetResponse
    row_count: int
    column_count: int


class MetaCampaign(BaseModel):
    id: str
    name: str
    status: Optional[str] = None
    objective: Optional[str] = None


class MetaCampaignsResponse(BaseModel):
    success: bool
    campaigns: list[MetaCampaign]
    error: Optional[str] = None


class MetaAdSet(BaseModel):
    id: str
    name: str
    status: Optional[str] = None
    campaign_id: Optional[str] = None


class MetaAdSetsResponse(BaseModel):
    success: bool
    adsets: list[MetaAdSet]
    error: Optional[str] = None


@router.get("/integration/meta/accounts", response_model=MetaAdAccountsResponse)
async def get_meta_ad_accounts(
    user_id: str = Depends(require_user),
):
    """Get all Meta ad accounts the user has access to."""
    try:
        result = await integration_service.fetch_meta_ad_accounts(user_id=user_id)
        return MetaAdAccountsResponse(
            success=result["success"],
            ad_accounts=result.get("ad_accounts", []),
            has_business_management=result.get("has_business_management", False),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch Meta ad accounts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/integration/meta/sync", response_model=MetaAdsSyncResponse)
async def sync_meta_ads_data(
    request: MetaAdsSyncRequest,
    user_id: str = Depends(require_user),
):
    """Sync Meta Ads insights data and save it as a CSV asset."""
    try:
        if not request.ad_account_id:
            raise HTTPException(status_code=400, detail="ad_account_id is required")

        project = _ensure_project(user_id, request.project_id)

        result = await integration_service.fetch_meta_ads_data(
            user_id=user_id,
            ad_account_id=request.ad_account_id,
            project_id=project["project_id"],
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            account_name=request.account_name,
            adset_ids=request.adset_ids,
            campaign_ids=request.campaign_ids,
        )

        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )

        return MetaAdsSyncResponse(
            success=result["success"],
            message=result["message"],
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
    except Exception as e:
        logger.error(f"Failed to sync Meta Ads data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── TikTok Ads ──────────────────────────────────────────────────────────────────


class TikTokConnectionStatusResponse(BaseModel):
    connected: bool
    expires_at: Optional[str] = None
    reason: Optional[str] = None


@router.get("/integration/tiktok/oauth/start")
async def tiktok_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the TikTok OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"

    if not bearer:
        return HTMLResponse(
            _OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )

    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )

    try:
        url = integration_service.get_tiktok_oauth_url(user_id)
        return RedirectResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/tiktok/oauth/callback", response_class=HTMLResponse)
async def tiktok_oauth_callback(
    auth_code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. TikTok redirects here after the user grants/denies access."""
    if error or not auth_code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_OAUTH_ERROR_HTML.format(error=msg))

    try:
        await integration_service.handle_tiktok_oauth_callback(
            auth_code=auth_code, state=state
        )
        # We can reuse the Meta broadcast JS logic by letting the frontend know it's a success
        # Wait, the broadcast channel in _OAUTH_SUCCESS_HTML is 'meta_oauth'. We can either duplicate it or reuse it.
        # It's better to create a TikTok specific one or just use the same template but replace 'meta_oauth' with 'tiktok_oauth'
        success_html = _OAUTH_SUCCESS_HTML.replace(
            "meta_oauth", "tiktok_oauth"
        ).replace("META_OAUTH_SUCCESS", "TIKTOK_OAUTH_SUCCESS")
        return HTMLResponse(success_html)
    except Exception as e:
        logger.error(f"TikTok OAuth callback error: {e}")
        error_html = _OAUTH_ERROR_HTML.replace("meta_oauth", "tiktok_oauth").replace(
            "META_OAUTH_ERROR", "TIKTOK_OAUTH_ERROR"
        )
        return HTMLResponse(error_html.format(error=str(e)))


@router.get("/integration/tiktok/status", response_model=TikTokConnectionStatusResponse)
async def tiktok_connection_status(user_id: str = Depends(require_user)):
    """Return whether the authenticated user has a valid stored TikTok token."""
    result = integration_service.get_tiktok_connection_status(user_id)
    return TikTokConnectionStatusResponse(**result)


@router.delete("/integration/tiktok/disconnect")
async def tiktok_disconnect(user_id: str = Depends(require_user)):
    """Remove the stored TikTok token for the authenticated user."""
    integration_service.disconnect_tiktok(user_id)
    return {"success": True}


class TikTokAdAccount(BaseModel):
    id: str
    name: str
    account_status: int
    currency: str
    timezone_name: str
    source_type: str = "business"


class TikTokAdAccountsResponse(BaseModel):
    success: bool
    ad_accounts: list[TikTokAdAccount]
    error: Optional[str] = None


class TikTokAdsSyncRequest(BaseModel):
    ad_account_id: str
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    account_name: str = ""


class TikTokAdsSyncResponse(BaseModel):
    success: bool
    message: str
    asset: AssetResponse
    row_count: int
    column_count: int


@router.get("/integration/tiktok/accounts", response_model=TikTokAdAccountsResponse)
async def get_tiktok_ad_accounts(
    user_id: str = Depends(require_user),
):
    """Get all TikTok ad accounts the user has access to."""
    try:
        result = await integration_service.fetch_tiktok_ad_accounts(user_id=user_id)
        return TikTokAdAccountsResponse(
            success=result["success"],
            ad_accounts=result.get("ad_accounts", []),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch TikTok ad accounts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/integration/tiktok/sync", response_model=TikTokAdsSyncResponse)
async def sync_tiktok_ads_data(
    request: TikTokAdsSyncRequest,
    user_id: str = Depends(require_user),
):
    """Sync TikTok Ads insights data and save it as a CSV asset."""
    try:
        if not request.ad_account_id:
            raise HTTPException(status_code=400, detail="ad_account_id is required")

        project = _ensure_project(user_id, request.project_id)

        result = await integration_service.fetch_tiktok_ads_data(
            user_id=user_id,
            ad_account_id=request.ad_account_id,
            project_id=project["project_id"],
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            account_name=request.account_name,
        )

        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )

        return TikTokAdsSyncResponse(
            success=result["success"],
            message=result["message"],
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
    except Exception as e:
        logger.error(f"Failed to sync TikTok Ads data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/meta/accounts/{ad_account_id}/campaigns",
    response_model=MetaCampaignsResponse,
)
async def get_meta_campaigns(
    ad_account_id: str,
    date_preset: Optional[str] = "last_30d",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user_id: str = Depends(require_user),
):
    """Fetch campaigns for a given account within a time range."""
    try:
        result = await integration_service.fetch_meta_campaigns(
            user_id=user_id,
            ad_account_id=ad_account_id,
            date_preset=date_preset,
            start_date=start_date,
            end_date=end_date,
        )
        return MetaCampaignsResponse(
            success=result["success"],
            campaigns=result.get("campaigns", []),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch Meta campaigns: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class AppsFlyerConnectRequest(BaseModel):
    api_token: str


class AppsFlyerConnectResponse(BaseModel):
    success: bool
    error: Optional[str] = None


class AppsFlyerApp(BaseModel):
    app_id: str
    app_name: str
    platform: str


class AppsFlyerAppsResponse(BaseModel):
    success: bool
    apps: List[AppsFlyerApp] = []
    error: Optional[str] = None


class AppsFlyerSyncRequest(BaseModel):
    app_id: str
    app_name: str
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class AppsFlyerSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    error: Optional[str] = None


class MetaAdSetsRequest(BaseModel):
    campaign_ids: list[str]


@router.post(
    "/integration/meta/accounts/{ad_account_id}/adsets",
    response_model=MetaAdSetsResponse,
)
async def get_meta_adsets(
    ad_account_id: str,
    request: MetaAdSetsRequest,
    user_id: str = Depends(require_user),
):
    """Fetch adsets belonging to specific campaigns."""
    try:
        result = await integration_service.fetch_meta_adsets(
            user_id=user_id,
            ad_account_id=ad_account_id,
            campaign_ids=request.campaign_ids,
        )
        return MetaAdSetsResponse(
            success=result["success"],
            adsets=result.get("adsets", []),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch Meta adsets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── AppsFlyer ─────────────────────────────────────────────────────────────────


@router.post("/integration/appsflyer/connect", response_model=AppsFlyerConnectResponse)
async def appsflyer_connect(
    request: AppsFlyerConnectRequest,
    user_id: str = Depends(require_user),
):
    """Validate AppsFlyer API token and store it."""
    try:
        await integration_service.validate_and_save_appsflyer_token(
            user_id, request.api_token
        )
        return AppsFlyerConnectResponse(success=True)
    except HTTPException as e:
        return AppsFlyerConnectResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"AppsFlyer connect error: {e}")
        return AppsFlyerConnectResponse(success=False, error=str(e))


@router.get("/integration/appsflyer/status")
async def appsflyer_status(user_id: str = Depends(require_user)):
    """Return whether the user has a stored AppsFlyer token."""
    try:
        status = await integration_service.get_appsflyer_connection_status(user_id)
        return status
    except Exception as e:
        logger.error(f"AppsFlyer status error: {e}")
        return {"connected": False}


@router.get("/integration/appsflyer/apps", response_model=AppsFlyerAppsResponse)
async def appsflyer_apps(user_id: str = Depends(require_user)):
    """Fetch the list of apps registered under the user's AppsFlyer account."""
    try:
        apps = await integration_service.fetch_appsflyer_apps(user_id)
        return AppsFlyerAppsResponse(success=True, apps=apps)
    except HTTPException as e:
        return AppsFlyerAppsResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"AppsFlyer apps error: {e}")
        return AppsFlyerAppsResponse(success=False, error=str(e))


@router.post("/integration/appsflyer/sync", response_model=AppsFlyerSyncResponse)
async def appsflyer_sync(
    request: AppsFlyerSyncRequest,
    user_id: str = Depends(require_user),
):
    """Fetch AppsFlyer partners aggregate report and save as a CSV asset."""
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await integration_service.fetch_appsflyer_data(
            user_id=user_id,
            app_id=request.app_id,
            app_name=request.app_name,
            project_id=project["project_id"],
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return AppsFlyerSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result.get("row_count"),
            column_count=result.get("column_count"),
        )
    except HTTPException as e:
        return AppsFlyerSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"AppsFlyer sync error: {e}")
        return AppsFlyerSyncResponse(success=False, error=str(e))


@router.delete("/integration/appsflyer/disconnect")
async def appsflyer_disconnect(user_id: str = Depends(require_user)):
    """Remove the stored AppsFlyer token."""
    try:
        await integration_service.disconnect_appsflyer(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"AppsFlyer disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Stripe Connect ─────────────────────────────────────────────────────────────

_STRIPE_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "stripe_oauth"
).replace("META_OAUTH_SUCCESS", "STRIPE_OAUTH_SUCCESS")

_STRIPE_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "stripe_oauth"
).replace("META_OAUTH_ERROR", "STRIPE_OAUTH_ERROR")


class StripeSyncRequest(BaseModel):
    report_type: str  # "charges" | "subscriptions" | "customers"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class StripeSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    error: Optional[str] = None


@router.get("/integration/stripe/oauth/start")
async def stripe_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the Stripe Connect OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"

    if not bearer:
        return HTMLResponse(
            _STRIPE_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )

    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _STRIPE_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )

    try:
        url = integration_service.get_stripe_oauth_url(user_id)
        return RedirectResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/stripe/oauth/callback", response_class=HTMLResponse)
async def stripe_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Stripe redirects here after the user grants/denies access."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_STRIPE_OAUTH_ERROR_HTML.format(error=msg))

    try:
        await integration_service.handle_stripe_oauth_callback(code=code, state=state)
        return HTMLResponse(_STRIPE_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Stripe OAuth callback error: {e}")
        return HTMLResponse(_STRIPE_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/stripe/status")
async def stripe_status(user_id: str = Depends(require_user)):
    """Return whether the authenticated user has a connected Stripe account."""
    try:
        status = await integration_service.get_stripe_connection_status(user_id)
        return status
    except Exception as e:
        logger.error(f"Stripe status error: {e}")
        return {"connected": False}


@router.post("/integration/stripe/sync", response_model=StripeSyncResponse)
async def stripe_sync(
    request: StripeSyncRequest,
    user_id: str = Depends(require_user),
):
    """Fetch Stripe data for the connected account and save as a CSV asset."""
    try:
        if request.report_type not in ("charges", "subscriptions", "customers"):
            return StripeSyncResponse(
                success=False,
                error="Invalid report_type. Must be charges, subscriptions, or customers.",
            )
        project = _ensure_project(user_id, request.project_id)
        result = await integration_service.fetch_stripe_data(
            user_id=user_id,
            report_type=request.report_type,
            project_id=project["project_id"],
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return StripeSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
    except HTTPException as e:
        return StripeSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Stripe sync error: {e}")
        return StripeSyncResponse(success=False, error=str(e))


@router.delete("/integration/stripe/disconnect")
async def stripe_disconnect(user_id: str = Depends(require_user)):
    """Remove the stored Stripe connection for the authenticated user."""
    try:
        await integration_service.disconnect_stripe(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Stripe disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── HubSpot CRM & Sales ───────────────────────────────────────────────────────

_HUBSPOT_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "hubspot_oauth"
).replace("META_OAUTH_SUCCESS", "HUBSPOT_OAUTH_SUCCESS")

_HUBSPOT_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "hubspot_oauth"
).replace("META_OAUTH_ERROR", "HUBSPOT_OAUTH_ERROR")


class HubSpotPipelineStage(BaseModel):
    id: str
    label: str
    probability: Optional[Any] = None


class HubSpotPipeline(BaseModel):
    id: str
    label: str
    stages: List[HubSpotPipelineStage] = Field(default_factory=list)


class HubSpotOwner(BaseModel):
    id: str
    name: str
    email: Optional[str] = None


class HubSpotPipelinesResponse(BaseModel):
    success: bool
    pipelines: List[HubSpotPipeline] = Field(default_factory=list)
    error: Optional[str] = None


class HubSpotOwnersResponse(BaseModel):
    success: bool
    owners: List[HubSpotOwner] = Field(default_factory=list)
    error: Optional[str] = None


class HubSpotSyncRequest(BaseModel):
    report_type: str = "sales_pipeline"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    pipeline_id: str = "all"
    owner_id: str = "all"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_associations: bool = True


class HubSpotSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    error: Optional[str] = None


@router.get("/integration/hubspot/oauth/start")
async def hubspot_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the HubSpot OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _HUBSPOT_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _HUBSPOT_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        url = integration_service.get_hubspot_oauth_url(user_id)
        return RedirectResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/hubspot/oauth/callback", response_class=HTMLResponse)
async def hubspot_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. HubSpot redirects here after authorization."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_HUBSPOT_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await integration_service.handle_hubspot_oauth_callback(code=code, state=state)
        return HTMLResponse(_HUBSPOT_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"HubSpot OAuth callback error: {e}")
        return HTMLResponse(_HUBSPOT_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/hubspot/status")
async def hubspot_status(user_id: str = Depends(require_user)):
    """Return whether the authenticated user has a connected HubSpot portal."""
    try:
        return await integration_service.get_hubspot_connection_status(user_id)
    except Exception as e:
        logger.error(f"HubSpot status error: {e}")
        return {"connected": False}


@router.delete("/integration/hubspot/disconnect")
async def hubspot_disconnect(user_id: str = Depends(require_user)):
    """Remove the stored HubSpot connection for the authenticated user."""
    try:
        await integration_service.disconnect_hubspot(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"HubSpot disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/hubspot/pipelines", response_model=HubSpotPipelinesResponse)
async def hubspot_pipelines(user_id: str = Depends(require_user)):
    try:
        pipelines = await integration_service.fetch_hubspot_pipelines(user_id)
        return HubSpotPipelinesResponse(success=True, pipelines=pipelines)
    except HTTPException as e:
        return HubSpotPipelinesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"HubSpot pipelines error: {e}")
        return HubSpotPipelinesResponse(success=False, error=str(e))


@router.get("/integration/hubspot/owners", response_model=HubSpotOwnersResponse)
async def hubspot_owners(user_id: str = Depends(require_user)):
    try:
        owners = await integration_service.fetch_hubspot_owners(user_id)
        return HubSpotOwnersResponse(success=True, owners=owners)
    except HTTPException as e:
        return HubSpotOwnersResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"HubSpot owners error: {e}")
        return HubSpotOwnersResponse(success=False, error=str(e))


@router.post("/integration/hubspot/sync", response_model=HubSpotSyncResponse)
async def hubspot_sync(
    request: HubSpotSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        if request.report_type not in (
            "sales_pipeline",
            "contacts",
            "companies",
            "activities",
        ):
            return HubSpotSyncResponse(
                success=False,
                error="Invalid report_type. Must be sales_pipeline, contacts, companies, or activities.",
            )
        project = _ensure_project(user_id, request.project_id)
        result = await integration_service.fetch_hubspot_data(
            user_id=user_id,
            report_type=request.report_type,
            project_id=project["project_id"],
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            pipeline_id=request.pipeline_id or "all",
            owner_id=request.owner_id or "all",
            row_limit=request.row_limit,
            include_associations=request.include_associations,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return HubSpotSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
        )
    except HTTPException as e:
        return HubSpotSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"HubSpot sync error: {e}")
        return HubSpotSyncResponse(success=False, error=str(e))


# ── Salesforce CRM & Sales Cloud ──────────────────────────────────────────────

_SALESFORCE_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "salesforce_oauth"
).replace("META_OAUTH_SUCCESS", "SALESFORCE_OAUTH_SUCCESS")

_SALESFORCE_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "salesforce_oauth"
).replace("META_OAUTH_ERROR", "SALESFORCE_OAUTH_ERROR")


class SalesforceObject(BaseModel):
    name: str
    label: str
    label_plural: Optional[str] = None
    queryable: bool = True
    custom: bool = False


class SalesforceField(BaseModel):
    name: str
    label: str
    type: str
    filterable: bool = False
    sortable: bool = False
    nillable: bool = False
    custom: bool = False


class SalesforceOwner(BaseModel):
    id: str
    name: str
    email: Optional[str] = None


class SalesforceObjectsResponse(BaseModel):
    success: bool
    objects: List[SalesforceObject] = Field(default_factory=list)
    error: Optional[str] = None


class SalesforceFieldsResponse(BaseModel):
    success: bool
    fields: List[SalesforceField] = Field(default_factory=list)
    error: Optional[str] = None


class SalesforceOwnersResponse(BaseModel):
    success: bool
    owners: List[SalesforceOwner] = Field(default_factory=list)
    error: Optional[str] = None


class SalesforceSyncRequest(BaseModel):
    report_type: str = "sales_pipeline"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    object_name: str = "all"
    owner_id: str = "all"
    row_limit: int = Field(default=5000, ge=1, le=10000)


class SalesforceSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    error: Optional[str] = None


@router.get("/integration/salesforce/oauth/start")
async def salesforce_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the Salesforce OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _SALESFORCE_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _SALESFORCE_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        url = integration_service.get_salesforce_oauth_url(user_id)
        return RedirectResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/salesforce/oauth/callback", response_class=HTMLResponse)
async def salesforce_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Salesforce redirects here after authorization."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_SALESFORCE_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await integration_service.handle_salesforce_oauth_callback(
            code=code, state=state
        )
        return HTMLResponse(_SALESFORCE_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Salesforce OAuth callback error: {e}")
        return HTMLResponse(_SALESFORCE_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/salesforce/status")
async def salesforce_status(user_id: str = Depends(require_user)):
    """Return whether the authenticated user has a connected Salesforce org."""
    try:
        return await integration_service.get_salesforce_connection_status(user_id)
    except Exception as e:
        logger.error(f"Salesforce status error: {e}")
        return {"connected": False}


@router.delete("/integration/salesforce/disconnect")
async def salesforce_disconnect(user_id: str = Depends(require_user)):
    """Remove the stored Salesforce connection for the authenticated user."""
    try:
        await integration_service.disconnect_salesforce(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Salesforce disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/salesforce/objects", response_model=SalesforceObjectsResponse)
async def salesforce_objects(user_id: str = Depends(require_user)):
    try:
        objects = await integration_service.fetch_salesforce_objects(user_id)
        return SalesforceObjectsResponse(success=True, objects=objects)
    except HTTPException as e:
        return SalesforceObjectsResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Salesforce objects error: {e}")
        return SalesforceObjectsResponse(success=False, error=str(e))


@router.get("/integration/salesforce/fields", response_model=SalesforceFieldsResponse)
async def salesforce_fields(
    object_name: str = Query(...),
    user_id: str = Depends(require_user),
):
    try:
        fields = await integration_service.fetch_salesforce_fields(user_id, object_name)
        return SalesforceFieldsResponse(success=True, fields=fields)
    except HTTPException as e:
        return SalesforceFieldsResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Salesforce fields error: {e}")
        return SalesforceFieldsResponse(success=False, error=str(e))


@router.get("/integration/salesforce/owners", response_model=SalesforceOwnersResponse)
async def salesforce_owners(user_id: str = Depends(require_user)):
    try:
        owners = await integration_service.fetch_salesforce_owners(user_id)
        return SalesforceOwnersResponse(success=True, owners=owners)
    except HTTPException as e:
        return SalesforceOwnersResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Salesforce owners error: {e}")
        return SalesforceOwnersResponse(success=False, error=str(e))


@router.post("/integration/salesforce/sync", response_model=SalesforceSyncResponse)
async def salesforce_sync(
    request: SalesforceSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        if request.report_type not in (
            "sales_pipeline",
            "leads",
            "accounts_contacts",
            "activities",
            "campaigns",
        ):
            return SalesforceSyncResponse(
                success=False,
                error="Invalid report_type. Must be sales_pipeline, leads, accounts_contacts, activities, or campaigns.",
            )
        project = _ensure_project(user_id, request.project_id)
        result = await integration_service.fetch_salesforce_data(
            user_id=user_id,
            report_type=request.report_type,
            project_id=project["project_id"],
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            object_name=request.object_name or "all",
            owner_id=request.owner_id or "all",
            row_limit=request.row_limit,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return SalesforceSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
        )
    except HTTPException as e:
        return SalesforceSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Salesforce sync error: {e}")
        return SalesforceSyncResponse(success=False, error=str(e))


# ── Pipedrive CRM & Sales Pipeline ────────────────────────────────────────────

_PIPEDRIVE_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "pipedrive_oauth"
).replace("META_OAUTH_SUCCESS", "PIPEDRIVE_OAUTH_SUCCESS")

_PIPEDRIVE_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "pipedrive_oauth"
).replace("META_OAUTH_ERROR", "PIPEDRIVE_OAUTH_ERROR")


class PipedrivePipelineStage(BaseModel):
    id: str
    label: str
    probability: Optional[Any] = None


class PipedrivePipeline(BaseModel):
    id: str
    label: str
    stages: List[PipedrivePipelineStage] = Field(default_factory=list)


class PipedriveUser(BaseModel):
    id: str
    name: str
    email: Optional[str] = None
    active: bool = True


class PipedriveField(BaseModel):
    key: str
    name: str
    field_type: str
    custom: bool = False
    options: List[Any] = Field(default_factory=list)


class PipedrivePipelinesResponse(BaseModel):
    success: bool
    pipelines: List[PipedrivePipeline] = Field(default_factory=list)
    error: Optional[str] = None


class PipedriveUsersResponse(BaseModel):
    success: bool
    users: List[PipedriveUser] = Field(default_factory=list)
    error: Optional[str] = None


class PipedriveFieldsResponse(BaseModel):
    success: bool
    fields: List[PipedriveField] = Field(default_factory=list)
    error: Optional[str] = None


class PipedriveSyncRequest(BaseModel):
    report_type: str = "sales_pipeline"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    pipeline_id: str = "all"
    owner_id: str = "all"
    row_limit: int = Field(default=5000, ge=1, le=10000)


class PipedriveSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    error: Optional[str] = None


@router.get("/integration/pipedrive/oauth/start")
async def pipedrive_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the Pipedrive OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _PIPEDRIVE_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _PIPEDRIVE_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        url = integration_service.get_pipedrive_oauth_url(user_id)
        return RedirectResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/pipedrive/oauth/callback", response_class=HTMLResponse)
async def pipedrive_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Pipedrive redirects here after authorization."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_PIPEDRIVE_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await integration_service.handle_pipedrive_oauth_callback(
            code=code, state=state
        )
        return HTMLResponse(_PIPEDRIVE_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Pipedrive OAuth callback error: {e}")
        return HTMLResponse(_PIPEDRIVE_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/pipedrive/status")
async def pipedrive_status(user_id: str = Depends(require_user)):
    """Return whether the authenticated user has a connected Pipedrive company."""
    try:
        return await integration_service.get_pipedrive_connection_status(user_id)
    except Exception as e:
        logger.error(f"Pipedrive status error: {e}")
        return {"connected": False}


@router.delete("/integration/pipedrive/disconnect")
async def pipedrive_disconnect(user_id: str = Depends(require_user)):
    """Remove the stored Pipedrive connection for the authenticated user."""
    try:
        await integration_service.disconnect_pipedrive(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Pipedrive disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/pipedrive/pipelines", response_model=PipedrivePipelinesResponse
)
async def pipedrive_pipelines(user_id: str = Depends(require_user)):
    try:
        pipelines = await integration_service.fetch_pipedrive_pipelines(user_id)
        return PipedrivePipelinesResponse(success=True, pipelines=pipelines)
    except HTTPException as e:
        return PipedrivePipelinesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Pipedrive pipelines error: {e}")
        return PipedrivePipelinesResponse(success=False, error=str(e))


@router.get("/integration/pipedrive/users", response_model=PipedriveUsersResponse)
async def pipedrive_users(user_id: str = Depends(require_user)):
    try:
        users = await integration_service.fetch_pipedrive_users(user_id)
        return PipedriveUsersResponse(success=True, users=users)
    except HTTPException as e:
        return PipedriveUsersResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Pipedrive users error: {e}")
        return PipedriveUsersResponse(success=False, error=str(e))


@router.get("/integration/pipedrive/fields", response_model=PipedriveFieldsResponse)
async def pipedrive_fields(
    object_name: str = Query(...),
    user_id: str = Depends(require_user),
):
    try:
        fields = await integration_service.fetch_pipedrive_fields(user_id, object_name)
        return PipedriveFieldsResponse(success=True, fields=fields)
    except HTTPException as e:
        return PipedriveFieldsResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Pipedrive fields error: {e}")
        return PipedriveFieldsResponse(success=False, error=str(e))


@router.post("/integration/pipedrive/sync", response_model=PipedriveSyncResponse)
async def pipedrive_sync(
    request: PipedriveSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        if request.report_type not in (
            "sales_pipeline",
            "leads",
            "contacts_organizations",
            "activities",
            "products",
        ):
            return PipedriveSyncResponse(
                success=False,
                error="Invalid report_type. Must be sales_pipeline, leads, contacts_organizations, activities, or products.",
            )
        project = _ensure_project(user_id, request.project_id)
        result = await integration_service.fetch_pipedrive_data(
            user_id=user_id,
            report_type=request.report_type,
            project_id=project["project_id"],
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            pipeline_id=request.pipeline_id or "all",
            owner_id=request.owner_id or "all",
            row_limit=request.row_limit,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return PipedriveSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
        )
    except HTTPException as e:
        return PipedriveSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Pipedrive sync error: {e}")
        return PipedriveSyncResponse(success=False, error=str(e))


# ── Shopify Commerce & Revenue ───────────────────────────────────────────────

_SHOPIFY_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "shopify_oauth"
).replace("META_OAUTH_SUCCESS", "SHOPIFY_OAUTH_SUCCESS")

_SHOPIFY_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "shopify_oauth"
).replace("META_OAUTH_ERROR", "SHOPIFY_OAUTH_ERROR")


class ShopifyShopResponse(BaseModel):
    connected: bool = False
    shop_id: Optional[str] = None
    shop_domain: Optional[str] = None
    shop_name: Optional[str] = None
    shop_url: Optional[str] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    account_name: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    read_all_orders_enabled: bool = False
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class ShopifyResource(BaseModel):
    report_type: str
    label: str
    resource: str
    default: bool = False


class ShopifyResourcesResponse(BaseModel):
    success: bool
    resources: List[ShopifyResource] = Field(default_factory=list)
    error: Optional[str] = None


class ShopifySyncRequest(BaseModel):
    report_type: str = "sales_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None
    resource: str = ""


class ShopifySyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/shopify/oauth/start")
async def shopify_oauth_start(
    request: Request,
    shop: str = Query(...),
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the Shopify OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _SHOPIFY_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _SHOPIFY_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        return RedirectResponse(url=shopify_service.get_oauth_url(user_id, shop))
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/shopify/oauth/callback", response_class=HTMLResponse)
async def shopify_oauth_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    shop: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Shopify redirects here after authorization."""
    if error or not code or not state or not shop:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_SHOPIFY_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await shopify_service.handle_oauth_callback(
            code=code,
            state=state,
            shop=shop,
            query_params=dict(request.query_params),
        )
        return HTMLResponse(_SHOPIFY_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Shopify OAuth callback error: {e}")
        return HTMLResponse(_SHOPIFY_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/shopify/status", response_model=ShopifyShopResponse)
async def shopify_status(user_id: str = Depends(require_user)):
    try:
        return await shopify_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Shopify status error: {e}")
        return ShopifyShopResponse(connected=False)


@router.delete("/integration/shopify/disconnect")
async def shopify_disconnect(user_id: str = Depends(require_user)):
    try:
        await shopify_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Shopify disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/shopify/shop", response_model=ShopifyShopResponse)
async def shopify_shop(user_id: str = Depends(require_user)):
    try:
        shop = await shopify_service.get_shop(user_id)
        return ShopifyShopResponse(connected=True, **shop)
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Shopify shop error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/shopify/resources", response_model=ShopifyResourcesResponse)
async def shopify_resources(user_id: str = Depends(require_user)):
    try:
        resources = await shopify_service.list_resources(user_id)
        return ShopifyResourcesResponse(success=True, resources=resources)
    except HTTPException as e:
        return ShopifyResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Shopify resources error: {e}")
        return ShopifyResourcesResponse(success=False, error=str(e))


@router.post("/integration/shopify/sync", response_model=ShopifySyncResponse)
async def shopify_sync(
    request: ShopifySyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await shopify_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
            resource=request.resource,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return ShopifySyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return ShopifySyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Shopify sync error: {e}")
        return ShopifySyncResponse(success=False, error=str(e))


# ── Klaviyo Lifecycle Marketing ─────────────────────────────────────────────

_KLAVIYO_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "klaviyo_oauth"
).replace("META_OAUTH_SUCCESS", "KLAVIYO_OAUTH_SUCCESS")

_KLAVIYO_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "klaviyo_oauth"
).replace("META_OAUTH_ERROR", "KLAVIYO_OAUTH_ERROR")


class KlaviyoStatusResponse(BaseModel):
    connected: bool = False
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    api_revision: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    default_metric_id: Optional[str] = None
    default_metric_name: Optional[str] = None
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class KlaviyoReportResource(BaseModel):
    report_type: str
    label: str
    resource: str
    default: bool = False


class KlaviyoNamedResource(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    status: Optional[str] = None
    channel: Optional[str] = None
    updated_at: Optional[str] = None


class KlaviyoResourcesResponse(BaseModel):
    success: bool
    reports: List[KlaviyoReportResource] = Field(default_factory=list)
    metrics: List[KlaviyoNamedResource] = Field(default_factory=list)
    campaigns: List[KlaviyoNamedResource] = Field(default_factory=list)
    flows: List[KlaviyoNamedResource] = Field(default_factory=list)
    lists: List[KlaviyoNamedResource] = Field(default_factory=list)
    default_metric_id: Optional[str] = None
    default_metric_name: Optional[str] = None
    error: Optional[str] = None


class KlaviyoSyncRequest(BaseModel):
    report_type: str = "lifecycle_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None
    metric_id: str = ""
    resource_id: str = "all"
    channel: str = "all"


class KlaviyoSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/klaviyo/oauth/start")
async def klaviyo_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the Klaviyo OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _KLAVIYO_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _KLAVIYO_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        return RedirectResponse(url=klaviyo_service.get_oauth_url(user_id))
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/klaviyo/oauth/callback", response_class=HTMLResponse)
async def klaviyo_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Klaviyo redirects here after authorization."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_KLAVIYO_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await klaviyo_service.handle_oauth_callback(code=code, state=state)
        return HTMLResponse(_KLAVIYO_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Klaviyo OAuth callback error: {e}")
        return HTMLResponse(_KLAVIYO_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/klaviyo/status", response_model=KlaviyoStatusResponse)
async def klaviyo_status(user_id: str = Depends(require_user)):
    try:
        return await klaviyo_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Klaviyo status error: {e}")
        return KlaviyoStatusResponse(connected=False)


@router.delete("/integration/klaviyo/disconnect")
async def klaviyo_disconnect(user_id: str = Depends(require_user)):
    try:
        await klaviyo_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Klaviyo disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/klaviyo/resources", response_model=KlaviyoResourcesResponse)
async def klaviyo_resources(user_id: str = Depends(require_user)):
    try:
        resources = await klaviyo_service.list_resources(user_id)
        return KlaviyoResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return KlaviyoResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Klaviyo resources error: {e}")
        return KlaviyoResourcesResponse(success=False, error=str(e))


@router.post("/integration/klaviyo/sync", response_model=KlaviyoSyncResponse)
async def klaviyo_sync(
    request: KlaviyoSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await klaviyo_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
            metric_id=request.metric_id,
            resource_id=request.resource_id,
            channel=request.channel,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return KlaviyoSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return KlaviyoSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Klaviyo sync error: {e}")
        return KlaviyoSyncResponse(success=False, error=str(e))


# ── QuickBooks Online Finance & Accounting ──────────────────────────────────

_QUICKBOOKS_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "quickbooks_oauth"
).replace("META_OAUTH_SUCCESS", "QUICKBOOKS_OAUTH_SUCCESS")

_QUICKBOOKS_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "quickbooks_oauth"
).replace("META_OAUTH_ERROR", "QUICKBOOKS_OAUTH_ERROR")


class QuickBooksRealm(BaseModel):
    id: str
    name: str
    environment: Optional[str] = None


class QuickBooksStatusResponse(BaseModel):
    connected: bool = False
    realm_id: Optional[str] = None
    company_name: Optional[str] = None
    environment: Optional[str] = None
    minor_version: Optional[str] = None
    country: Optional[str] = None
    currency: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class QuickBooksReportResource(BaseModel):
    report_type: str
    label: str
    resource: str
    default: bool = False


class QuickBooksResourcesResponse(BaseModel):
    success: bool
    reports: List[QuickBooksReportResource] = Field(default_factory=list)
    realms: List[QuickBooksRealm] = Field(default_factory=list)
    error: Optional[str] = None


class QuickBooksSyncRequest(BaseModel):
    report_type: str = "finance_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None
    accounting_basis: str = "Accrual"
    resource_id: str = "all"


class QuickBooksSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/quickbooks/oauth/start")
async def quickbooks_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    """Redirect the popup to the QuickBooks Online OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _QUICKBOOKS_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _QUICKBOOKS_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        return RedirectResponse(url=quickbooks_service.get_oauth_url(user_id))
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/quickbooks/oauth/callback", response_class=HTMLResponse)
async def quickbooks_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    realmId: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Intuit redirects here after QuickBooks authorization."""
    if error or not code or not state or not realmId:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_QUICKBOOKS_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await quickbooks_service.handle_oauth_callback(
            code=code, state=state, realm_id=realmId
        )
        return HTMLResponse(_QUICKBOOKS_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"QuickBooks OAuth callback error: {e}")
        return HTMLResponse(_QUICKBOOKS_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/quickbooks/status", response_model=QuickBooksStatusResponse)
async def quickbooks_status(user_id: str = Depends(require_user)):
    try:
        return await quickbooks_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"QuickBooks status error: {e}")
        return QuickBooksStatusResponse(connected=False)


@router.delete("/integration/quickbooks/disconnect")
async def quickbooks_disconnect(user_id: str = Depends(require_user)):
    try:
        await quickbooks_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"QuickBooks disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/quickbooks/resources", response_model=QuickBooksResourcesResponse
)
async def quickbooks_resources(user_id: str = Depends(require_user)):
    try:
        resources = await quickbooks_service.list_resources(user_id)
        return QuickBooksResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return QuickBooksResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"QuickBooks resources error: {e}")
        return QuickBooksResourcesResponse(success=False, error=str(e))


@router.post("/integration/quickbooks/sync", response_model=QuickBooksSyncResponse)
async def quickbooks_sync(
    request: QuickBooksSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await quickbooks_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
            accounting_basis=request.accounting_basis,
            resource_id=request.resource_id,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return QuickBooksSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return QuickBooksSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"QuickBooks sync error: {e}")
        return QuickBooksSyncResponse(success=False, error=str(e))


# ── Zendesk Support & Customer Success ──────────────────────────────────────

_ZENDESK_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "zendesk_oauth"
).replace("META_OAUTH_SUCCESS", "ZENDESK_OAUTH_SUCCESS")

_ZENDESK_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "zendesk_oauth"
).replace("META_OAUTH_ERROR", "ZENDESK_OAUTH_ERROR")


class ZendeskAccount(BaseModel):
    id: str
    name: str
    subdomain: str


class ZendeskStatusResponse(BaseModel):
    connected: bool = False
    subdomain: Optional[str] = None
    account_name: Optional[str] = None
    timezone: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class ZendeskReportResource(BaseModel):
    report_type: str
    label: str
    resource: str
    default: bool = False


class ZendeskResourcesResponse(BaseModel):
    success: bool
    reports: List[ZendeskReportResource] = Field(default_factory=list)
    accounts: List[ZendeskAccount] = Field(default_factory=list)
    error: Optional[str] = None


class ZendeskSyncRequest(BaseModel):
    report_type: str = "support_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    resource_id: str = "all"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None


class ZendeskSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/zendesk/oauth/start")
async def zendesk_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
    subdomain: str = Query(...),
):
    """Redirect the popup to the Zendesk OAuth consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _ZENDESK_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _ZENDESK_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        return RedirectResponse(
            url=zendesk_service.get_oauth_url(user_id, subdomain=subdomain)
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/zendesk/oauth/callback", response_class=HTMLResponse)
async def zendesk_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Zendesk redirects here after support authorization."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_ZENDESK_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await zendesk_service.handle_oauth_callback(code=code, state=state)
        return HTMLResponse(_ZENDESK_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Zendesk OAuth callback error: {e}")
        return HTMLResponse(_ZENDESK_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/zendesk/status", response_model=ZendeskStatusResponse)
async def zendesk_status(user_id: str = Depends(require_user)):
    try:
        return await zendesk_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Zendesk status error: {e}")
        return ZendeskStatusResponse(connected=False)


@router.delete("/integration/zendesk/disconnect")
async def zendesk_disconnect(user_id: str = Depends(require_user)):
    try:
        await zendesk_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Zendesk disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/zendesk/resources", response_model=ZendeskResourcesResponse)
async def zendesk_resources(user_id: str = Depends(require_user)):
    try:
        resources = await zendesk_service.list_resources(user_id)
        return ZendeskResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return ZendeskResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Zendesk resources error: {e}")
        return ZendeskResourcesResponse(success=False, error=str(e))


@router.post("/integration/zendesk/sync", response_model=ZendeskSyncResponse)
async def zendesk_sync(
    request: ZendeskSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await zendesk_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
            resource_id=request.resource_id,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return ZendeskSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return ZendeskSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Zendesk sync error: {e}")
        return ZendeskSyncResponse(success=False, error=str(e))


# ── Mixpanel Product Analytics ──────────────────────────────────────────────


class MixpanelProject(BaseModel):
    id: str
    name: str
    region: str = "US"


class MixpanelStatusResponse(BaseModel):
    connected: bool = False
    project_id: Optional[str] = None
    region: Optional[str] = "US"
    account_name: Optional[str] = None
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class MixpanelReportResource(BaseModel):
    report_type: str
    label: str
    resource: str
    default: bool = False


class MixpanelNamedResource(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    status: Optional[str] = None
    updated_at: Optional[str] = None


class MixpanelConnectRequest(BaseModel):
    project_id: str = ""
    service_account_username: str = ""
    service_account_secret: str = ""
    region: str = "US"
    account_name: Optional[str] = None


class MixpanelResourcesResponse(BaseModel):
    success: bool
    reports: List[MixpanelReportResource] = Field(default_factory=list)
    projects: List[MixpanelProject] = Field(default_factory=list)
    events: List[MixpanelNamedResource] = Field(default_factory=list)
    funnels: List[MixpanelNamedResource] = Field(default_factory=list)
    cohorts: List[MixpanelNamedResource] = Field(default_factory=list)
    error: Optional[str] = None


class MixpanelSyncRequest(BaseModel):
    report_type: str = "product_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    resource_id: str = "all"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None


class MixpanelSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.post("/integration/mixpanel/connect", response_model=MixpanelStatusResponse)
async def mixpanel_connect(
    request: MixpanelConnectRequest,
    user_id: str = Depends(require_user),
):
    try:
        return await mixpanel_service.connect(
            user_id=user_id,
            project_id=request.project_id,
            service_account_username=request.service_account_username,
            service_account_secret=request.service_account_secret,
            region=request.region,
            account_name=request.account_name,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Mixpanel connect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/mixpanel/status", response_model=MixpanelStatusResponse)
async def mixpanel_status(user_id: str = Depends(require_user)):
    try:
        return await mixpanel_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Mixpanel status error: {e}")
        return MixpanelStatusResponse(connected=False)


@router.delete("/integration/mixpanel/disconnect")
async def mixpanel_disconnect(user_id: str = Depends(require_user)):
    try:
        await mixpanel_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Mixpanel disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/mixpanel/resources", response_model=MixpanelResourcesResponse)
async def mixpanel_resources(user_id: str = Depends(require_user)):
    try:
        resources = await mixpanel_service.list_resources(user_id)
        return MixpanelResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return MixpanelResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Mixpanel resources error: {e}")
        return MixpanelResourcesResponse(success=False, error=str(e))


@router.post("/integration/mixpanel/sync", response_model=MixpanelSyncResponse)
async def mixpanel_sync(
    request: MixpanelSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await mixpanel_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
            resource_id=request.resource_id,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return MixpanelSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return MixpanelSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Mixpanel sync error: {e}")
        return MixpanelSyncResponse(success=False, error=str(e))


# ── PostHog Product Analytics ───────────────────────────────────────────────


class PostHogProject(BaseModel):
    id: str
    name: str
    region: str = "US"
    base_url: Optional[str] = None


class PostHogStatusResponse(BaseModel):
    connected: bool = False
    project_id: Optional[str] = None
    region: Optional[str] = "US"
    base_url: Optional[str] = None
    account_name: Optional[str] = None
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class PostHogReportResource(BaseModel):
    report_type: str
    label: str
    resource: str
    default: bool = False


class PostHogNamedResource(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    status: Optional[str] = None
    updated_at: Optional[str] = None


class PostHogConnectRequest(BaseModel):
    project_id: str = ""
    personal_api_key: str = ""
    region: str = "US"
    base_url: Optional[str] = None
    account_name: Optional[str] = None


class PostHogResourcesResponse(BaseModel):
    success: bool
    reports: List[PostHogReportResource] = Field(default_factory=list)
    projects: List[PostHogProject] = Field(default_factory=list)
    events: List[PostHogNamedResource] = Field(default_factory=list)
    properties: List[PostHogNamedResource] = Field(default_factory=list)
    insights: List[PostHogNamedResource] = Field(default_factory=list)
    cohorts: List[PostHogNamedResource] = Field(default_factory=list)
    feature_flags: List[PostHogNamedResource] = Field(default_factory=list)
    error: Optional[str] = None


class PostHogSyncRequest(BaseModel):
    report_type: str = "product_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    resource_id: str = "all"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None


class PostHogSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.post("/integration/posthog/connect", response_model=PostHogStatusResponse)
async def posthog_connect(
    request: PostHogConnectRequest,
    user_id: str = Depends(require_user),
):
    try:
        return await posthog_service.connect(
            user_id=user_id,
            project_id=request.project_id,
            personal_api_key=request.personal_api_key,
            region=request.region,
            base_url=request.base_url,
            account_name=request.account_name,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PostHog connect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/posthog/status", response_model=PostHogStatusResponse)
async def posthog_status(user_id: str = Depends(require_user)):
    try:
        return await posthog_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"PostHog status error: {e}")
        return PostHogStatusResponse(connected=False)


@router.delete("/integration/posthog/disconnect")
async def posthog_disconnect(user_id: str = Depends(require_user)):
    try:
        await posthog_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"PostHog disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/posthog/resources", response_model=PostHogResourcesResponse)
async def posthog_resources(user_id: str = Depends(require_user)):
    try:
        resources = await posthog_service.list_resources(user_id)
        return PostHogResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return PostHogResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"PostHog resources error: {e}")
        return PostHogResourcesResponse(success=False, error=str(e))


@router.post("/integration/posthog/sync", response_model=PostHogSyncResponse)
async def posthog_sync(
    request: PostHogSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await posthog_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
            resource_id=request.resource_id,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return PostHogSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return PostHogSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"PostHog sync error: {e}")
        return PostHogSyncResponse(success=False, error=str(e))


# ── Amazon Seller Central ───────────────────────────────────────────────────

_AMAZON_SELLER_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "amazon_seller_oauth"
).replace("META_OAUTH_SUCCESS", "AMAZON_SELLER_OAUTH_SUCCESS")

_AMAZON_SELLER_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "amazon_seller_oauth"
).replace("META_OAUTH_ERROR", "AMAZON_SELLER_OAUTH_ERROR")


class AmazonSellerMarketplace(BaseModel):
    id: str
    name: str
    country_code: Optional[str] = None


class AmazonSellerStatusResponse(BaseModel):
    connected: bool = False
    seller_id: Optional[str] = None
    seller_name: Optional[str] = None
    selling_region: Optional[str] = None
    marketplaces: List[AmazonSellerMarketplace] = Field(default_factory=list)
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class AmazonSellerReportResource(BaseModel):
    report_type: str
    label: str
    default: bool = False


class AmazonSellerResourcesResponse(BaseModel):
    success: bool
    reports: List[AmazonSellerReportResource] = Field(default_factory=list)
    marketplaces: List[AmazonSellerMarketplace] = Field(default_factory=list)
    error: Optional[str] = None


class AmazonSellerSyncRequest(BaseModel):
    report_type: str = "sales_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    marketplace_id: str = "all"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None


class AmazonSellerSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/amazon-seller/oauth/start")
async def amazon_seller_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
    region: str = Query(default="NA"),
):
    """Redirect the popup to the Amazon Seller Central consent screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _AMAZON_SELLER_OAUTH_ERROR_HTML.format(
                error="Unauthorized — please sign in."
            )
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _AMAZON_SELLER_OAUTH_ERROR_HTML.format(
                error="Unauthorized — invalid token."
            )
        )
    try:
        return RedirectResponse(
            url=amazon_seller_service.get_oauth_url(user_id, region=region)
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/amazon-seller/oauth/callback", response_class=HTMLResponse)
async def amazon_seller_oauth_callback(
    code: Optional[str] = Query(default=None),
    spapi_oauth_code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    selling_partner_id: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Amazon redirects here after seller authorization."""
    oauth_code = spapi_oauth_code or code
    if error or not oauth_code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_AMAZON_SELLER_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await amazon_seller_service.handle_oauth_callback(
            code=oauth_code,
            state=state,
            selling_partner_id=selling_partner_id,
        )
        return HTMLResponse(_AMAZON_SELLER_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Amazon Seller OAuth callback error: {e}")
        return HTMLResponse(_AMAZON_SELLER_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get(
    "/integration/amazon-seller/status", response_model=AmazonSellerStatusResponse
)
async def amazon_seller_status(user_id: str = Depends(require_user)):
    try:
        return await amazon_seller_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Amazon Seller status error: {e}")
        return AmazonSellerStatusResponse(connected=False)


@router.delete("/integration/amazon-seller/disconnect")
async def amazon_seller_disconnect(user_id: str = Depends(require_user)):
    try:
        await amazon_seller_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Amazon Seller disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/amazon-seller/resources",
    response_model=AmazonSellerResourcesResponse,
)
async def amazon_seller_resources(user_id: str = Depends(require_user)):
    try:
        resources = await amazon_seller_service.list_resources(user_id)
        return AmazonSellerResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return AmazonSellerResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Amazon Seller resources error: {e}")
        return AmazonSellerResourcesResponse(success=False, error=str(e))


@router.post("/integration/amazon-seller/sync", response_model=AmazonSellerSyncResponse)
async def amazon_seller_sync(
    request: AmazonSellerSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await amazon_seller_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            marketplace_id=request.marketplace_id,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return AmazonSellerSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return AmazonSellerSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Amazon Seller sync error: {e}")
        return AmazonSellerSyncResponse(success=False, error=str(e))


# ── TikTok Shop Seller ──────────────────────────────────────────────────────

_TIKTOK_SHOP_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "tiktok_shop_seller_oauth"
).replace("META_OAUTH_SUCCESS", "TIKTOK_SHOP_SELLER_OAUTH_SUCCESS")

_TIKTOK_SHOP_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "tiktok_shop_seller_oauth"
).replace("META_OAUTH_ERROR", "TIKTOK_SHOP_SELLER_OAUTH_ERROR")


class TikTokShopSellerShop(BaseModel):
    id: str
    name: str
    region: Optional[str] = None
    shop_cipher: Optional[str] = None


class TikTokShopSellerStatusResponse(BaseModel):
    connected: bool = False
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    region: Optional[str] = None
    shops: List[TikTokShopSellerShop] = Field(default_factory=list)
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class TikTokShopSellerReportResource(BaseModel):
    report_type: str
    label: str
    default: bool = False


class TikTokShopSellerResourcesResponse(BaseModel):
    success: bool
    reports: List[TikTokShopSellerReportResource] = Field(default_factory=list)
    shops: List[TikTokShopSellerShop] = Field(default_factory=list)
    regions: Dict[str, str] = Field(default_factory=dict)
    error: Optional[str] = None


class TikTokShopSellerSyncRequest(BaseModel):
    report_type: str = "sales_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    shop_id: str = "all"
    region: str = "US"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None


class TikTokShopSellerSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/tiktok-shop-seller/oauth/start")
async def tiktok_shop_seller_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
    region: str = Query(default="US"),
):
    """Redirect the popup to the TikTok Shop authorization screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _TIKTOK_SHOP_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _TIKTOK_SHOP_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        return RedirectResponse(
            url=tiktok_shop_seller_service.get_oauth_url(user_id, region=region)
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get(
    "/integration/tiktok-shop-seller/oauth/callback", response_class=HTMLResponse
)
async def tiktok_shop_seller_oauth_callback(
    code: Optional[str] = Query(default=None),
    auth_code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. TikTok Shop redirects here after seller authorization."""
    oauth_code = auth_code or code
    if error or not oauth_code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_TIKTOK_SHOP_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await tiktok_shop_seller_service.handle_oauth_callback(
            code=oauth_code,
            state=state,
        )
        return HTMLResponse(_TIKTOK_SHOP_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"TikTok Shop Seller OAuth callback error: {e}")
        return HTMLResponse(_TIKTOK_SHOP_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get(
    "/integration/tiktok-shop-seller/status",
    response_model=TikTokShopSellerStatusResponse,
)
async def tiktok_shop_seller_status(user_id: str = Depends(require_user)):
    try:
        return await tiktok_shop_seller_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"TikTok Shop Seller status error: {e}")
        return TikTokShopSellerStatusResponse(connected=False)


@router.delete("/integration/tiktok-shop-seller/disconnect")
async def tiktok_shop_seller_disconnect(user_id: str = Depends(require_user)):
    try:
        await tiktok_shop_seller_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"TikTok Shop Seller disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/tiktok-shop-seller/resources",
    response_model=TikTokShopSellerResourcesResponse,
)
async def tiktok_shop_seller_resources(user_id: str = Depends(require_user)):
    try:
        resources = await tiktok_shop_seller_service.list_resources(user_id)
        return TikTokShopSellerResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return TikTokShopSellerResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"TikTok Shop Seller resources error: {e}")
        return TikTokShopSellerResourcesResponse(success=False, error=str(e))


@router.post(
    "/integration/tiktok-shop-seller/sync",
    response_model=TikTokShopSellerSyncResponse,
)
async def tiktok_shop_seller_sync(
    request: TikTokShopSellerSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await tiktok_shop_seller_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            shop_id=request.shop_id,
            region=request.region,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return TikTokShopSellerSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return TikTokShopSellerSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"TikTok Shop Seller sync error: {e}")
        return TikTokShopSellerSyncResponse(success=False, error=str(e))


# ── Shopee Seller ───────────────────────────────────────────────────────────

_SHOPEE_SELLER_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "shopee_seller_oauth"
).replace("META_OAUTH_SUCCESS", "SHOPEE_SELLER_OAUTH_SUCCESS")

_SHOPEE_SELLER_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "shopee_seller_oauth"
).replace("META_OAUTH_ERROR", "SHOPEE_SELLER_OAUTH_ERROR")


class ShopeeSellerShop(BaseModel):
    id: str
    name: str
    region: Optional[str] = None


class ShopeeSellerStatusResponse(BaseModel):
    connected: bool = False
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    region: Optional[str] = None
    shops: List[ShopeeSellerShop] = Field(default_factory=list)
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class ShopeeSellerReportResource(BaseModel):
    report_type: str
    label: str
    default: bool = False


class ShopeeSellerResourcesResponse(BaseModel):
    success: bool
    reports: List[ShopeeSellerReportResource] = Field(default_factory=list)
    shops: List[ShopeeSellerShop] = Field(default_factory=list)
    regions: Dict[str, str] = Field(default_factory=dict)
    error: Optional[str] = None


class ShopeeSellerSyncRequest(BaseModel):
    report_type: str = "sales_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    shop_id: str = "all"
    region: str = "VN"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None


class ShopeeSellerSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/shopee-seller/oauth/start")
async def shopee_seller_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
    region: str = Query(default="VN"),
):
    """Redirect the popup to the Shopee seller authorization screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _SHOPEE_SELLER_OAUTH_ERROR_HTML.format(
                error="Unauthorized — please sign in."
            )
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _SHOPEE_SELLER_OAUTH_ERROR_HTML.format(
                error="Unauthorized — invalid token."
            )
        )
    try:
        return RedirectResponse(
            url=shopee_seller_service.get_oauth_url(user_id, region=region)
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/shopee-seller/oauth/callback", response_class=HTMLResponse)
async def shopee_seller_oauth_callback(
    code: Optional[str] = Query(default=None),
    shop_id: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Shopee redirects here after seller authorization."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_SHOPEE_SELLER_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await shopee_seller_service.handle_oauth_callback(
            code=code,
            state=state,
            shop_id=shop_id,
        )
        return HTMLResponse(_SHOPEE_SELLER_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Shopee Seller OAuth callback error: {e}")
        return HTMLResponse(_SHOPEE_SELLER_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get(
    "/integration/shopee-seller/status",
    response_model=ShopeeSellerStatusResponse,
)
async def shopee_seller_status(user_id: str = Depends(require_user)):
    try:
        return await shopee_seller_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Shopee Seller status error: {e}")
        return ShopeeSellerStatusResponse(connected=False)


@router.delete("/integration/shopee-seller/disconnect")
async def shopee_seller_disconnect(user_id: str = Depends(require_user)):
    try:
        await shopee_seller_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Shopee Seller disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/shopee-seller/resources",
    response_model=ShopeeSellerResourcesResponse,
)
async def shopee_seller_resources(user_id: str = Depends(require_user)):
    try:
        resources = await shopee_seller_service.list_resources(user_id)
        return ShopeeSellerResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return ShopeeSellerResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Shopee Seller resources error: {e}")
        return ShopeeSellerResourcesResponse(success=False, error=str(e))


@router.post(
    "/integration/shopee-seller/sync",
    response_model=ShopeeSellerSyncResponse,
)
async def shopee_seller_sync(
    request: ShopeeSellerSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await shopee_seller_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            shop_id=request.shop_id,
            region=request.region,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return ShopeeSellerSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return ShopeeSellerSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Shopee Seller sync error: {e}")
        return ShopeeSellerSyncResponse(success=False, error=str(e))


# ── Lazada Seller ───────────────────────────────────────────────────────────

_LAZADA_SELLER_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "lazada_seller_oauth"
).replace("META_OAUTH_SUCCESS", "LAZADA_SELLER_OAUTH_SUCCESS")

_LAZADA_SELLER_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "lazada_seller_oauth"
).replace("META_OAUTH_ERROR", "LAZADA_SELLER_OAUTH_ERROR")


class LazadaSellerAccount(BaseModel):
    id: str
    name: str
    region: Optional[str] = None


class LazadaSellerStatusResponse(BaseModel):
    connected: bool = False
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    region: Optional[str] = None
    sellers: List[LazadaSellerAccount] = Field(default_factory=list)
    selected_entities: List[ConnectorSelectedEntity] = Field(default_factory=list)
    connected_at: Optional[str] = None


class LazadaSellerReportResource(BaseModel):
    report_type: str
    label: str
    default: bool = False


class LazadaSellerResourcesResponse(BaseModel):
    success: bool
    reports: List[LazadaSellerReportResource] = Field(default_factory=list)
    sellers: List[LazadaSellerAccount] = Field(default_factory=list)
    regions: Dict[str, str] = Field(default_factory=dict)
    error: Optional[str] = None


class LazadaSellerSyncRequest(BaseModel):
    report_type: str = "sales_overview"
    project_id: Optional[str] = None
    date_preset: Optional[str] = "last_30d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    seller_id: str = "all"
    region: str = "VN"
    row_limit: int = Field(default=5000, ge=1, le=10000)
    include_pii: bool = False
    max_bytes: Optional[int] = None


class LazadaSellerSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    api_mode: Optional[str] = None
    error: Optional[str] = None


@router.get("/integration/lazada-seller/oauth/start")
async def lazada_seller_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
    region: str = Query(default="VN"),
):
    """Redirect the popup to the Lazada seller authorization screen."""
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _LAZADA_SELLER_OAUTH_ERROR_HTML.format(
                error="Unauthorized — please sign in."
            )
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _LAZADA_SELLER_OAUTH_ERROR_HTML.format(
                error="Unauthorized — invalid token."
            )
        )
    try:
        return RedirectResponse(
            url=lazada_seller_service.get_oauth_url(user_id, region=region)
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/lazada-seller/oauth/callback", response_class=HTMLResponse)
async def lazada_seller_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Public endpoint. Lazada redirects here after seller authorization."""
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_LAZADA_SELLER_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await lazada_seller_service.handle_oauth_callback(code=code, state=state)
        return HTMLResponse(_LAZADA_SELLER_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Lazada Seller OAuth callback error: {e}")
        return HTMLResponse(_LAZADA_SELLER_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get(
    "/integration/lazada-seller/status",
    response_model=LazadaSellerStatusResponse,
)
async def lazada_seller_status(user_id: str = Depends(require_user)):
    try:
        return await lazada_seller_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Lazada Seller status error: {e}")
        return LazadaSellerStatusResponse(connected=False)


@router.delete("/integration/lazada-seller/disconnect")
async def lazada_seller_disconnect(user_id: str = Depends(require_user)):
    try:
        await lazada_seller_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Lazada Seller disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/integration/lazada-seller/resources",
    response_model=LazadaSellerResourcesResponse,
)
async def lazada_seller_resources(user_id: str = Depends(require_user)):
    try:
        resources = await lazada_seller_service.list_resources(user_id)
        return LazadaSellerResourcesResponse(success=True, **resources)
    except HTTPException as e:
        return LazadaSellerResourcesResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Lazada Seller resources error: {e}")
        return LazadaSellerResourcesResponse(success=False, error=str(e))


@router.post(
    "/integration/lazada-seller/sync",
    response_model=LazadaSellerSyncResponse,
)
async def lazada_seller_sync(
    request: LazadaSellerSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        project = _ensure_project(user_id, request.project_id)
        result = await lazada_seller_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            report_type=request.report_type,
            date_preset=request.date_preset,
            start_date=request.start_date,
            end_date=request.end_date,
            row_limit=request.row_limit,
            seller_id=request.seller_id,
            region=request.region,
            include_pii=request.include_pii,
            max_bytes=request.max_bytes,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return LazadaSellerSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
            api_mode=result.get("api_mode"),
        )
    except HTTPException as e:
        return LazadaSellerSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Lazada Seller sync error: {e}")
        return LazadaSellerSyncResponse(success=False, error=str(e))


# ── Supabase Application Database ────────────────────────────────────────────

_SUPABASE_OAUTH_SUCCESS_HTML = _OAUTH_SUCCESS_HTML.replace(
    "meta_oauth", "supabase_oauth"
).replace("META_OAUTH_SUCCESS", "SUPABASE_OAUTH_SUCCESS")

_SUPABASE_OAUTH_ERROR_HTML = _OAUTH_ERROR_HTML.replace(
    "meta_oauth", "supabase_oauth"
).replace("META_OAUTH_ERROR", "SUPABASE_OAUTH_ERROR")


class SupabaseProject(BaseModel):
    ref: str
    name: str
    region: Optional[str] = None
    status: Optional[str] = None
    organization_id: Optional[str] = None


class SupabaseProjectsResponse(BaseModel):
    success: bool
    projects: List[SupabaseProject] = Field(default_factory=list)
    error: Optional[str] = None


class SupabaseConnectionResponse(BaseModel):
    connection_id: str
    connector_key: str = "supabase"
    database_type: str = "supabase"
    display_name: Optional[str] = None
    project_ref: str
    project_name: Optional[str] = None
    organization_id: Optional[str] = None
    connection_mode: Optional[str] = None
    host: Optional[str] = None
    port: Optional[str] = None
    database: Optional[str] = None
    username: Optional[str] = None
    include_schemas: List[str] = Field(default_factory=list)
    source_timezone: str = "UTC"
    max_export_bytes: Optional[int] = None
    credential_risk: Optional[str] = None
    schema_snapshot: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SupabaseConnectionsResponse(BaseModel):
    success: bool
    connections: List[SupabaseConnectionResponse] = Field(default_factory=list)
    error: Optional[str] = None


class SupabaseConnectionCreateRequest(BaseModel):
    project_ref: str
    project_name: str = ""
    organization_id: str = ""
    connection_uri: str = ""
    db_password: str = ""
    display_name: str = ""
    include_schemas: List[str] = Field(default_factory=lambda: ["public"])
    include_system_schemas: bool = False
    source_timezone: str = "UTC"
    service_role_key: str = ""
    max_export_bytes: Optional[int] = None


class SupabaseSampleRequest(BaseModel):
    schema_name: str
    table_name: str
    columns: List[str] = Field(default_factory=list)
    limit: int = Field(default=25, ge=1, le=100)


class SupabaseSampleResponse(BaseModel):
    success: bool
    columns: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)
    generated_sql: str = ""
    error: Optional[str] = None


class SupabaseSyncRequest(BaseModel):
    connection_id: str
    sync_mode: str = "bounded_table_snapshot"
    project_id: Optional[str] = None
    schema_name: str = ""
    table_name: str = ""
    columns: List[str] = Field(default_factory=list)
    row_limit: int = Field(default=5000, ge=1, le=50000)
    max_bytes: Optional[int] = None
    date_filter_column: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    group_by_columns: List[str] = Field(default_factory=list)
    metric_columns: List[str] = Field(default_factory=list)
    bucket: str = "all"


class SupabaseSyncResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    asset: Optional[AssetResponse] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    entity_id: Optional[str] = None
    truncated: Optional[bool] = None
    error: Optional[str] = None


@router.get("/integration/supabase/oauth/start")
async def supabase_oauth_start(
    request: Request,
    token: Optional[str] = Query(default=None),
):
    bearer = request.headers.get("Authorization")
    if not bearer and token:
        bearer = f"Bearer {token}"
    if not bearer:
        return HTMLResponse(
            _SUPABASE_OAUTH_ERROR_HTML.format(error="Unauthorized — please sign in.")
        )
    user_id = _verify_bearer(bearer)
    if not user_id:
        return HTMLResponse(
            _SUPABASE_OAUTH_ERROR_HTML.format(error="Unauthorized — invalid token.")
        )
    try:
        return RedirectResponse(url=supabase_service.get_oauth_url(user_id))
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/integration/supabase/oauth/callback", response_class=HTMLResponse)
async def supabase_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    if error or not code or not state:
        msg = error_description or error or "Access denied"
        return HTMLResponse(_SUPABASE_OAUTH_ERROR_HTML.format(error=msg))
    try:
        await supabase_service.handle_oauth_callback(code=code, state=state)
        return HTMLResponse(_SUPABASE_OAUTH_SUCCESS_HTML)
    except Exception as e:
        logger.error(f"Supabase OAuth callback error: {e}")
        return HTMLResponse(_SUPABASE_OAUTH_ERROR_HTML.format(error=str(e)))


@router.get("/integration/supabase/status")
async def supabase_status(user_id: str = Depends(require_user)):
    try:
        return await supabase_service.get_connection_status(user_id)
    except Exception as e:
        logger.error(f"Supabase status error: {e}")
        return {"connected": False, "oauth_connected": False, "connection_count": 0}


@router.delete("/integration/supabase/disconnect")
async def supabase_disconnect(user_id: str = Depends(require_user)):
    try:
        await supabase_service.disconnect(user_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Supabase disconnect error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/integration/supabase/projects", response_model=SupabaseProjectsResponse)
async def supabase_projects(user_id: str = Depends(require_user)):
    try:
        projects = await supabase_service.list_projects(user_id)
        return SupabaseProjectsResponse(success=True, projects=projects)
    except HTTPException as e:
        return SupabaseProjectsResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Supabase projects error: {e}")
        return SupabaseProjectsResponse(success=False, error=str(e))


@router.get(
    "/integration/supabase/connections", response_model=SupabaseConnectionsResponse
)
async def supabase_connections(user_id: str = Depends(require_user)):
    try:
        return SupabaseConnectionsResponse(
            success=True,
            connections=supabase_service.list_connections(user_id),
        )
    except Exception as e:
        logger.error(f"Supabase connections error: {e}")
        return SupabaseConnectionsResponse(success=False, error=str(e))


@router.post(
    "/integration/supabase/connections", response_model=SupabaseConnectionResponse
)
async def supabase_create_connection(
    request: SupabaseConnectionCreateRequest,
    user_id: str = Depends(require_user),
):
    return supabase_service.create_connection(
        user_id=user_id,
        project_ref=request.project_ref,
        project_name=request.project_name,
        organization_id=request.organization_id,
        connection_uri=request.connection_uri,
        db_password=request.db_password,
        display_name=request.display_name,
        include_schemas=request.include_schemas,
        include_system_schemas=request.include_system_schemas,
        source_timezone=request.source_timezone,
        service_role_key=request.service_role_key,
        max_export_bytes=request.max_export_bytes,
    )


@router.post(
    "/integration/supabase/connections/{connection_id}/schema/refresh",
    response_model=SupabaseConnectionResponse,
)
async def supabase_refresh_schema(
    connection_id: str,
    user_id: str = Depends(require_user),
):
    return supabase_service.refresh_schema(user_id=user_id, connection_id=connection_id)


@router.post(
    "/integration/supabase/connections/{connection_id}/tables/sample",
    response_model=SupabaseSampleResponse,
)
async def supabase_sample_table(
    connection_id: str,
    request: SupabaseSampleRequest,
    user_id: str = Depends(require_user),
):
    try:
        sample = supabase_service.sample_table(
            user_id=user_id,
            connection_id=connection_id,
            schema_name=request.schema_name,
            table_name=request.table_name,
            columns=request.columns,
            limit=request.limit,
        )
        return SupabaseSampleResponse(success=True, **sample)
    except HTTPException as e:
        return SupabaseSampleResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Supabase sample error: {e}")
        return SupabaseSampleResponse(success=False, error=str(e))


@router.post("/integration/supabase/sync", response_model=SupabaseSyncResponse)
async def supabase_sync(
    request: SupabaseSyncRequest,
    user_id: str = Depends(require_user),
):
    try:
        if request.sync_mode not in (
            "profile_only",
            "bounded_table_snapshot",
            "aggregated_result",
            "app_profile",
        ):
            return SupabaseSyncResponse(success=False, error="Invalid sync_mode.")
        project = _ensure_project(user_id, request.project_id)
        result = supabase_service.sync(
            user_id=user_id,
            project_id=project["project_id"],
            connection_id=request.connection_id,
            sync_mode=request.sync_mode,
            schema_name=request.schema_name,
            table_name=request.table_name,
            columns=request.columns,
            row_limit=request.row_limit,
            max_bytes=request.max_bytes,
            date_filter_column=request.date_filter_column,
            start_date=request.start_date,
            end_date=request.end_date,
            group_by_columns=request.group_by_columns,
            metric_columns=request.metric_columns,
            bucket=request.bucket,
        )
        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
        return SupabaseSyncResponse(
            success=True,
            message=result.get("message"),
            asset=mapped_asset,
            row_count=result.get("row_count"),
            column_count=result.get("column_count"),
            entity_id=result.get("entity_id"),
            truncated=result.get("truncated"),
        )
    except HTTPException as e:
        return SupabaseSyncResponse(success=False, error=e.detail)
    except Exception as e:
        logger.error(f"Supabase sync error: {e}")
        return SupabaseSyncResponse(success=False, error=str(e))


# ── Google Ads ───────────────────────────────────────────────────────────────


class GoogleAdsAccount(BaseModel):
    id: str
    name: str
    account_status: str
    currency: str
    timezone_name: str
    source_type: str = "standard"


class GoogleAdsAccountsResponse(BaseModel):
    success: bool
    ad_accounts: list[GoogleAdsAccount] = []
    error: Optional[str] = None


class GoogleAdsSyncRequest(BaseModel):
    ad_account_id: str
    project_id: Optional[str] = None
    start_date: str = "30daysAgo"
    end_date: str = "today"
    account_name: str = ""


class GoogleAdsSyncResponse(BaseModel):
    success: bool
    message: str
    asset: Optional[AssetResponse] = None
    row_count: int = 0
    column_count: int = 0


@router.get(
    "/integration/google-ads/accounts", response_model=GoogleAdsAccountsResponse
)
async def get_google_ads_accounts(
    user_id: str = Depends(require_user),
):
    """Get all Google Ads accounts the user has access to."""
    try:
        result = await integration_service.fetch_google_ads_accounts(user_id=user_id)
        return GoogleAdsAccountsResponse(
            success=result.get("success", False),
            ad_accounts=result.get("ad_accounts", []),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch Google Ads accounts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/integration/google-ads/sync", response_model=GoogleAdsSyncResponse)
async def sync_google_ads_data(
    request: GoogleAdsSyncRequest,
    user_id: str = Depends(require_user),
):
    """Sync Google Ads insights data and save it as a CSV asset."""
    try:
        if not request.ad_account_id:
            raise HTTPException(status_code=400, detail="ad_account_id is required")

        project = _ensure_project(user_id, request.project_id)

        result = await integration_service.fetch_google_ads_data(
            user_id=user_id,
            ad_account_id=request.ad_account_id,
            project_id=project["project_id"],
            start_date=request.start_date,
            end_date=request.end_date,
            account_name=request.account_name,
        )

        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )

        return GoogleAdsSyncResponse(
            success=result["success"],
            message=result["message"],
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
    except Exception as e:
        logger.error(f"Failed to sync Google Ads data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Firebase ─────────────────────────────────────────────────────────────────


class FirebaseProject(BaseModel):
    id: str
    name: str
    source_type: str = "project"


class FirebaseProjectsResponse(BaseModel):
    success: bool
    projects: list[FirebaseProject] = []
    error: Optional[str] = None


class FirebaseSyncRequest(BaseModel):
    firebase_project_id: str
    app_name: str
    project_id: Optional[str] = None
    start_date: str = "30daysAgo"
    end_date: str = "today"


class FirebaseSyncResponse(BaseModel):
    success: bool
    message: str
    asset: Optional[AssetResponse] = None
    row_count: int = 0
    column_count: int = 0


@router.get("/integration/firebase/projects", response_model=FirebaseProjectsResponse)
async def get_firebase_projects(
    user_id: str = Depends(require_user),
):
    """Get all Firebase projects the user has access to."""
    try:
        result = await integration_service.fetch_firebase_projects(user_id=user_id)
        return FirebaseProjectsResponse(
            success=result.get("success", False),
            projects=result.get("projects", []),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error(f"Failed to fetch Firebase projects: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/integration/firebase/sync", response_model=FirebaseSyncResponse)
async def sync_firebase_data(
    request: FirebaseSyncRequest,
    user_id: str = Depends(require_user),
):
    """Sync Firebase Analytics data and save it as a CSV asset."""
    try:
        if not request.firebase_project_id:
            raise HTTPException(
                status_code=400, detail="firebase_project_id is required"
            )

        project = _ensure_project(user_id, request.project_id)

        result = await integration_service.fetch_firebase_data(
            user_id=user_id,
            firebase_project_id=request.firebase_project_id,
            project_id=project["project_id"],
            start_date=request.start_date,
            end_date=request.end_date,
            expected_app_name=request.app_name,
        )

        mapped_asset = _map_asset(
            result["asset"],
            row_count=result["row_count"],
            column_count=result["column_count"],
        )

        return FirebaseSyncResponse(
            success=result["success"],
            message=result["message"],
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"],
        )
    except Exception as e:
        logger.error(f"Failed to sync Firebase data: {e}")
        raise HTTPException(status_code=500, detail=str(e))
