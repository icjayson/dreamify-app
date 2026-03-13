from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.dependencies.auth import require_user
from app.services.integration_service import integration_service
from app.api.route_modules.user import AssetResponse, _map_asset

router = APIRouter(tags=["integration", "google"])


class GoogleAnalyticsSyncRequest(BaseModel):
    property_id: str
    project_id: str
    start_date: str = "30daysAgo"
    end_date: str = "today"


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


@router.get("/integration/google/properties", response_model=GoogleAnalyticsPropertiesResponse)
async def get_google_analytics_properties(
    user_id: str = Depends(require_user),
):
    """
    Get a list of all Google Analytics accounts and properties the user has access to.
    """
    try:
        result = await integration_service.fetch_google_analytics_properties(user_id=user_id)
        return GoogleAnalyticsPropertiesResponse(
            success=result["success"],
            accounts=result["accounts"]
        )
    except Exception as e:
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
        if not request.project_id:
            raise HTTPException(status_code=400, detail="project_id is required")
            
        result = await integration_service.fetch_google_analytics_data(
            user_id=user_id,
            property_id=request.property_id,
            project_id=request.project_id,
            start_date=request.start_date,
            end_date=request.end_date
        )
        
        # Map the created asset to the standard AssetResponse
        mapped_asset = _map_asset(
            result["asset"], 
            row_count=result["row_count"], 
            column_count=result["column_count"]
        )
        
        return GoogleAnalyticsSyncResponse(
            success=result["success"],
            message=result["message"],
            asset=mapped_asset,
            row_count=result["row_count"],
            column_count=result["column_count"]
        )
    except Exception as e:
        # Wrap the error details
        raise HTTPException(status_code=500, detail=str(e))
