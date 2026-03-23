"""
User-scoped project and asset APIs.
"""
import logging
import os
import uuid
import io
import csv
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.dependencies.auth import require_user
from app.core.analytics import CSVProcessor
from app.utils.file_handler import FileHandler
from utils.config import config
from utils.logger import logger
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import projects as projects_repo
from utils.s3.client import compute_sha256_checksum, upload_bytes, delete_object, download_bytes
from utils.s3.paths import build_asset_key

router = APIRouter(tags=["user"])


class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None
    is_preview_public: Optional[bool] = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None
    is_preview_public: Optional[bool] = None


class ProjectListResponse(BaseModel):
    projects: List[ProjectResponse]


class AssetResponse(BaseModel):
    asset_id: str
    file_id: str
    project_id: str
    filename: str
    extension: str
    asset_type: str
    status: str
    s3_bucket: str
    s3_key: str
    size_bytes: int
    processed_json_s3_key: Optional[str] = None
    created_at: Optional[str] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None


class AssetListResponse(BaseModel):
    assets: List[AssetResponse]


class AssetDeleteResponse(BaseModel):
    success: bool


class ProjectDeleteResponse(BaseModel):
    success: bool


class ProcessedDataResponse(BaseModel):
    success: bool
    data: dict


class FilePreviewResponse(BaseModel):
    success: bool
    filename: str
    columns: List[str]
    rows: List[List[Any]]
    total_rows: int
    displayed_rows: int
    source_type: Optional[str] = None


def _map_project(item: dict) -> ProjectResponse:
    return ProjectResponse(
        id=item["project_id"],
        name=item.get("name", ""),
        description=item.get("description"),
        created_at=item.get("created_at"),
        updated_at=item.get("updated_at"),
        latest_conversation_id=item.get("latest_conversation_id"),
        latest_dashboard_id=item.get("latest_dashboard_id"),
        dashboard_title=item.get("dashboard_title"),
        is_preview_public=item.get("is_preview_public", False),
    )


def _get_file_metadata(data: bytes, extension: str) -> Dict[str, Optional[int]]:
    """Parse file and extract row and column counts."""
    try:
        file_info = {"extension": extension}
        file_like = io.BytesIO(data)
        df = FileHandler.read_file(file_like, file_info)
        return {
            "row_count": len(df),
            "column_count": len(df.columns)
        }
    except Exception:
        return {
            "row_count": None,
            "column_count": None
        }


def _map_asset(item: dict, row_count: Optional[int] = None, column_count: Optional[int] = None) -> AssetResponse:
    return AssetResponse(
        asset_id=item["asset_id"],
        file_id=item.get("file_id", item["asset_id"]),
        project_id=item["project_id"],
        filename=item.get("filename", ""),
        extension=item.get("extension", ""),
        asset_type=item.get("asset_type", ""),
        status=item.get("status", ""),
        s3_bucket=item.get("s3_bucket", ""),
        s3_key=item.get("s3_key", ""),
        size_bytes=int(item.get("size_bytes", 0)),
        processed_json_s3_key=item.get("processed_json_s3_key"),
        created_at=item.get("created_at"),
        row_count=row_count,
        column_count=column_count,
    )


def _ensure_project(user_id: str, project_id: Optional[str]) -> dict:
    if project_id:
        project = projects_repo.get_project(user_id, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return project
    # Always create a new project when project_id is not provided
    return projects_repo.create_project(
        user_id=user_id,
        name="Untitled Project",
        description="Auto-created project",
    )


@router.post("/user/project/create", response_model=ProjectResponse)
async def create_project_endpoint(
    request: ProjectCreateRequest,
    user_id: str = Depends(require_user),
):
    project = projects_repo.create_project(
        user_id=user_id,
        name=request.name,
        description=request.description,
    )
    return _map_project(project)


@router.get("/user/project/list", response_model=ProjectListResponse)
async def list_projects_endpoint(
    user_id: str = Depends(require_user),
):
    projects = projects_repo.list_projects(user_id)
    return ProjectListResponse(projects=[_map_project(item) for item in projects])


def _get_project_or_404(user_id: str, project_id: str) -> dict:
    project = projects_repo.get_project(user_id, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.put("/user/project/{project_id}", response_model=ProjectResponse)
async def update_project_endpoint(
    project_id: str,
    request: ProjectUpdateRequest,
    user_id: str = Depends(require_user),
):
    _get_project_or_404(user_id, project_id)
    updated_project = projects_repo.update_project(
        user_id=user_id,
        project_id=project_id,
        name=request.name,
        description=request.description,
        latest_conversation_id=request.latest_conversation_id,
        latest_dashboard_id=request.latest_dashboard_id,
        dashboard_title=request.dashboard_title,
        is_preview_public=request.is_preview_public,
    )
    if not updated_project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _map_project(updated_project)


@router.get("/user/project/{project_id}", response_model=ProjectResponse)
async def get_project_endpoint(
    project_id: str,
    user_id: str = Depends(require_user),
):
    project = _get_project_or_404(user_id, project_id)
    return _map_project(project)


@router.get("/user/project/detail/{project_id}", response_model=ProjectResponse)
async def get_project_detail_endpoint(
    project_id: str,
    user_id: str = Depends(require_user),
):
    project = _get_project_or_404(user_id, project_id)
    return _map_project(project)


@router.delete("/user/project/{project_id}", response_model=ProjectDeleteResponse)
async def delete_project_endpoint(
    project_id: str,
    user_id: str = Depends(require_user),
):
    _get_project_or_404(user_id, project_id)
    projects_repo.delete_project(user_id, project_id)
    return ProjectDeleteResponse(success=True)


@router.post("/user/asset/upload", response_model=AssetResponse)
async def upload_asset_endpoint(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(None),
    asset_type: Optional[str] = Form("raw"),
    user_id: str = Depends(require_user),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    project = _ensure_project(user_id, project_id)
    file_info = FileHandler.validate_file(file)
    data = await file.read()
    file_size = len(data)
    checksum = compute_sha256_checksum(data)
    
    # Get file metadata (row and column counts)
    # Wrap in try/except to ensure upload continues even if parsing fails
    row_count = None
    column_count = None
    try:
        metadata = _get_file_metadata(data, file_info["extension"])
        row_count = metadata.get("row_count")
        column_count = metadata.get("column_count")
    except Exception as e:
        # Log error but don't fail the upload
        logger.warning(f"Failed to extract file metadata: {str(e)}")

    asset_id = str(uuid.uuid4())
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    file_id = str(uuid.uuid4())
    s3_key = build_asset_key(
        user_id=user_id,
        project_id=project["project_id"],
        asset_id=asset_id,
        file_id=file_id,
        extension=file_info["extension"],
    )

    content_type_map = {
        "csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "json": "application/json",
    }
    content_type = content_type_map.get(file_info["extension"], "application/octet-stream")

    upload_bytes(
        bucket=bucket,
        key=s3_key,
        data=data,
        content_type=content_type,
    )

    asset = assets_repo.create_asset(
        user_id=user_id,
        project_id=project["project_id"],
        s3_bucket=bucket,
        s3_key=s3_key,
        asset_type=asset_type or "raw",
        size_bytes=file_size,
        checksum_sha256=checksum,
        version=config.aws.s3.USER_ASSETS_BUCKET_VERSION,
        content_type=content_type,
        asset_id=asset_id,
        file_id=file_id,
        original_filename=file_info["filename"],
        extension=file_info["extension"],
    )
    return _map_asset(asset, row_count=row_count, column_count=column_count)


@router.get("/user/asset/list", response_model=AssetListResponse)
async def list_assets_endpoint(
    project_id: Optional[str] = None,
    asset_type: Optional[str] = None,
    user_id: str = Depends(require_user),
):
    assets = assets_repo.list_assets(
        user_id=user_id,
        project_id=project_id,
        asset_type=asset_type,
    )
    return AssetListResponse(assets=[_map_asset(item) for item in assets])


def _get_asset_or_404(user_id: str, asset_id: str) -> dict:
    asset = assets_repo.get_asset(user_id, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.get("/user/asset/{asset_id}", response_model=AssetResponse)
async def get_asset_endpoint(
    asset_id: str,
    user_id: str = Depends(require_user),
):
    asset = _get_asset_or_404(user_id, asset_id)
    return _map_asset(asset)


@router.delete("/user/asset/{asset_id}", response_model=AssetDeleteResponse)
async def delete_asset_endpoint(
    asset_id: str,
    user_id: str = Depends(require_user),
):
    asset = _get_asset_or_404(user_id, asset_id)
    try:
        delete_object(asset["s3_bucket"], asset["s3_key"])
    except Exception:
        # best-effort delete
        pass
    assets_repo.delete_asset(user_id, asset_id)
    return AssetDeleteResponse(success=True)


@router.get("/user/asset/{asset_id}/processed", response_model=ProcessedDataResponse)
async def get_processed_asset_data(
    asset_id: str,
    user_id: str = Depends(require_user),
):
    asset = _get_asset_or_404(user_id, asset_id)
    processed_key = asset.get("processed_json_s3_key")
    if not processed_key:
        raise HTTPException(status_code=404, detail="Asset not processed yet")
    try:
        data = download_bytes(asset["s3_bucket"], processed_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Processed data not found")
    import json

    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid processed data")
    return ProcessedDataResponse(success=True, data=parsed)


def _get_user_from_token(request: Request, token: Optional[str] = None) -> str:
    """Get user_id from Authorization header or token query parameter."""
    # First, try to get token from Authorization header
    authorization = request.headers.get("Authorization")
    auth_token = None
    
    if authorization:
        try:
            scheme, auth_token = authorization.split(" ", 1)
            if scheme.lower() != "bearer":
                auth_token = None
        except ValueError:
            auth_token = None
    
    # Use query parameter token if no Authorization header
    if not auth_token and token:
        auth_token = token
    
    # If we have a token, verify it
    if auth_token:
        # Create a mock request with Authorization header for Clerk auth
        class TokenRequest:
            def __init__(self, token: str):
                self.headers = {"Authorization": f"Bearer {token}"}
            
            def header(self, name: str):
                return self.headers.get(name)
        
        try:
            clerk_req = TokenRequest(auth_token)
            from clerk_backend_api import Clerk
            from clerk_backend_api.security import authenticate_request
            from clerk_backend_api.security.types import AuthenticateRequestOptions
            from utils.config import config
            
            clerk = Clerk()
            jwt_key = config.clerk.CLERK_JWT_KEY
            
            state = clerk.authenticate_request(
                clerk_req,
                AuthenticateRequestOptions(
                    jwt_key=jwt_key,
                    authorized_parties=None
                )
            )
            
            if not state.is_signed_in:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            
            user_id = state.payload.get('sub')
            if not user_id:
                raise HTTPException(status_code=401, detail="Token missing user ID")
            
            return user_id
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")
    else:
        # Fall back to standard authentication (requires Authorization header)
        try:
            return require_user(request)
        except HTTPException as e:
            # Re-raise with 401 for consistency
            if e.status_code == 401:
                raise
            raise HTTPException(status_code=401, detail="Authentication required")

# Initialize processors
csv_processor = CSVProcessor()

@router.get("/files/preview/{asset_id}", response_model=FilePreviewResponse)
async def preview_file_endpoint(
    asset_id: str,
    request: Request,
    token: Optional[str] = Query(None, description="Authentication token"),
):
    """
    Generate a data preview for a specific asset.
    Supports smart encoding detection and various file types (CSV, Excel, JSON).
    """
    try:
        # Get user from token or header
        user_id = _get_user_from_token(request, token)
        
        # Get asset metadata
        asset = assets_repo.get_asset(user_id, asset_id)
        if not asset:
            logger.warning(f"Preview requested for non-existent asset: {asset_id} for user {user_id}")
            raise HTTPException(status_code=404, detail="Asset not found")
            
        # Download file data
        try:
            file_data = download_bytes(asset["s3_bucket"], asset["s3_key"])
        except Exception as e:
            logger.error(f"Failed to download asset {asset_id} from S3: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to retrieve file from storage: {str(e)}")
            
        # Use CSVProcessor for robust reading
        try:
            filename = asset.get("filename", "unknown_file")
            # _smart_read_file handles encoding, separators, and multiple file types
            df = csv_processor._smart_read_file(file_data, filename)
            
            if df.empty:
                return FilePreviewResponse(
                    success=True,
                    filename=filename,
                    columns=[],
                    rows=[],
                    total_rows=0,
                    displayed_rows=0
                )
            
            # Prepare preview (limit to first 1000 rows for performance)
            total_rows = len(df)
            df_preview = df.head(1000)
            
            # Explicitly convert all values to basic types for JSON serialization
            from app.core.analytics import convert_numpy_types
            columns = [str(col) for col in df_preview.columns.tolist()]
            
            # Efficiently convert rows to list of lists
            rows = []
            for row in df_preview.values.tolist():
                rows.append([convert_numpy_types(val) for val in row])
                
            # Map asset type to display name
            asset_type = asset.get("asset_type", "")
            source_type = None
            if asset_type == "integration_ga4":
                source_type = "GA4"
            elif asset_type == "integration_gsheets":
                source_type = "Google Sheets"
            elif asset_type == "raw":
                source_type = "File Upload"

            return FilePreviewResponse(
                success=True,
                filename=filename,
                columns=columns,
                rows=rows,
                total_rows=total_rows,
                displayed_rows=len(rows),
                source_type=source_type
            )
            
        except Exception as e:
            logger.error(f"Failed to process file preview for {asset_id}: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in preview_file_endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/files/{asset_id}")
async def compatibility_preview_redirect(
    asset_id: str,
    request: Request,
    token: Optional[str] = Query(None),
):
    """
    Compatibility route for malformed preview requests (missing /preview/ segment).
    Redirects to the correct preview endpoint.
    """
    query_params = str(request.query_params)
    redirect_url = f"/api/v1/files/preview/{asset_id}"
    if query_params:
        redirect_url += f"?{query_params}"
    
    return RedirectResponse(url=redirect_url)


