import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from app.dependencies.auth import require_user
from app.services.integration_service import integration_service
from app.api.route_modules.user import AssetResponse, _map_asset, _ensure_project

router = APIRouter(tags=["integration", "google", "meta", "tiktok", "appsflyer", "stripe"])


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
                success=False, error="Invalid report_type. Must be charges, subscriptions, or customers."
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

@router.get("/integration/google-ads/accounts", response_model=GoogleAdsAccountsResponse)
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
            raise HTTPException(status_code=400, detail="firebase_project_id is required")

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
