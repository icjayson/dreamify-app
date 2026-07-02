"""
User-scoped project and asset APIs.
"""

import asyncio
import logging
import os
import uuid
import io
import csv
import re
import unicodedata
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Any
from urllib.parse import quote

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    Query,
    Request,
    status,
)
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.dependencies.auth import optional_user, require_user
from app.core.analytics import CSVProcessor
from app.utils.file_handler import FileHandler
from utils.config import config
from utils.logger import logger
from utils.dynamodb.repos import assets as assets_repo
from utils.dynamodb.repos import projects as projects_repo
from utils.s3.client import (
    compute_sha256_checksum,
    upload_bytes,
    delete_object,
    download_bytes,
    generate_presigned_url,
    get_s3_client,
)
from utils.s3.paths import build_asset_key
from utils.email_service import send_dashboard_share_email, send_feedback_email, send_feedback_thank_you_email
from utils.resend_automation import emit as _emit_automation
from utils.clerk_auth import get_user_email_name
from clerk_backend_api import Clerk

router = APIRouter(tags=["user"])

# Initialize Clerk client for user lookups
_clerk_client = Clerk(bearer_auth=config.clerk.CLERK_SECRET_KEY)


class UserLookupResponse(BaseModel):
    """Response model for user lookup by email."""

    success: bool
    user_id: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None


@router.get("/user/lookup", response_model=UserLookupResponse)
async def lookup_user_by_email(
    email: str = Query(..., description="Email address to look up"),
    _: str = Depends(require_user),
):
    """
    Look up a user's profile information by email address via Clerk.

    Returns the user's ID, name, email, and profile image URL.
    """
    try:
        users = await asyncio.to_thread(
            _clerk_client.users.list,
            request={"email_address": [email], "limit": 1},
        )
        user_list = list(users)

        if not user_list:
            # Not a Clerk user yet — return email-only so they can still be invited
            return UserLookupResponse(success=True, user_id=None, email=email)

        user = user_list[0]
        name_parts = filter(None, [user.first_name, user.last_name])
        full_name = " ".join(name_parts) or user.username or None

        # Get primary email
        primary_email = None
        if user.email_addresses:
            primary_email = user.email_addresses[0].email_address

        return UserLookupResponse(
            success=True,
            user_id=user.id,
            email=primary_email,
            name=full_name,
            image_url=user.image_url,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error looking up user by email: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to look up user: {str(e)}")


class AllowedUser(BaseModel):
    """A user granted access to a private project."""

    user_id: Optional[str] = None  # None for email-only (pending) invites
    email: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None


class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None
    dashboard_preview_key: Optional[str] = None
    is_preview_public: Optional[bool] = None
    allowed: Optional[List[AllowedUser]] = None
    source_type: Optional[str] = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    name_source: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None
    dashboard_preview_key: Optional[str] = None
    is_preview_public: Optional[bool] = None
    allowed: Optional[List[AllowedUser]] = None
    source_type: Optional[str] = None


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
    checksum_sha256: Optional[str] = None


class AssetListResponse(BaseModel):
    assets: List[AssetResponse]


class AssetAddToNewProjectRequest(BaseModel):
    asset_ids: List[str]
    project_name: Optional[str] = None


class AssetAddToNewProjectResponse(BaseModel):
    success: bool
    project: ProjectResponse
    assets: List[AssetResponse]


class AssetAddToProjectRequest(BaseModel):
    asset_ids: List[str]
    project_id: str


class AssetAddToProjectResponse(BaseModel):
    success: bool
    project: ProjectResponse
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
        name_source=item.get("name_source"),
        description=item.get("description"),
        created_at=item.get("created_at"),
        updated_at=item.get("updated_at"),
        latest_conversation_id=item.get("latest_conversation_id"),
        latest_dashboard_id=item.get("latest_dashboard_id"),
        dashboard_title=item.get("dashboard_title"),
        dashboard_preview_key=item.get("dashboard_preview_key"),
        is_preview_public=item.get("is_preview_public", False),
        allowed=item.get("allowed", []),
        source_type=item.get("source_type"),
    )


def _get_file_metadata(data: bytes, extension: str) -> Dict[str, Optional[int]]:
    """Parse file and extract row and column counts."""
    try:
        file_info = {"extension": extension}
        file_like = io.BytesIO(data)
        df = FileHandler.read_file(file_like, file_info)
        return {"row_count": len(df), "column_count": len(df.columns)}
    except Exception:
        return {"row_count": None, "column_count": None}


def _map_asset(
    item: dict, row_count: Optional[int] = None, column_count: Optional[int] = None
) -> AssetResponse:
    rc = row_count if row_count is not None else item.get("row_count")
    cc = column_count if column_count is not None else item.get("column_count")
    if isinstance(rc, str):
        try:
            rc = int(rc)
        except ValueError:
            rc = None
    if isinstance(cc, str):
        try:
            cc = int(cc)
        except ValueError:
            cc = None
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
        row_count=rc,
        column_count=cc,
        checksum_sha256=item.get("checksum_sha256"),
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
        name_source="generated",
    )


def _emit_dashboard_created(user_id: str, project_id: str, name: Optional[str]) -> None:
    """
    Fire the `dashboard.created` automation event (Flow 2). Runs in a background
    task so it never delays the create response; fully non-fatal.
    """
    try:
        is_first = len(projects_repo.list_projects(user_id)) == 1
        email, first_name = get_user_email_name(user_id)
        if not email:
            return
        app_url = (
            config.chat_platform.dreamify_app_url
            if config.chat_platform
            else "https://app.dreamify.dev"
        )
        _emit_automation(
            event="dashboard.created",
            email=email,
            first_name=first_name,
            payload={
                "first_name": first_name,
                "is_first": is_first,
                "project_id": project_id,
                "name": name or "",
                "app_url": app_url,
            },
        )
    except Exception as e:  # pragma: no cover - best effort
        logger.warning("[automation] dashboard.created emit failed: %s: %s", type(e).__name__, e)


@router.post("/user/project/create", response_model=ProjectResponse)
async def create_project_endpoint(
    request: ProjectCreateRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(require_user),
):
    name_source = (
        "generated" if request.name.strip().lower() == "untitled project" else "user"
    )
    project = projects_repo.create_project(
        user_id=user_id,
        name=request.name,
        description=request.description,
        name_source=name_source,
    )
    # Flow 2: enroll + fire dashboard.created (off the response path).
    background_tasks.add_task(
        _emit_dashboard_created, user_id, project["project_id"], project.get("name")
    )
    return _map_project(project)


@router.get("/user/project/list", response_model=ProjectListResponse)
async def list_projects_endpoint(
    user_id: str = Depends(require_user),
):
    projects = projects_repo.list_projects(user_id)
    return ProjectListResponse(projects=[_map_project(item) for item in projects])


@router.get("/user/project/recent", response_model=ProjectListResponse)
async def list_recent_projects_endpoint(
    limit: int = Query(10, description="Maximum number of recent projects to return"),
    user_id: str = Depends(require_user),
):
    safe_limit = max(1, min(limit, 50))
    projects = projects_repo.list_recent_projects(user_id, limit=safe_limit)
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
    existing = _get_project_or_404(user_id, project_id)
    updated_project = projects_repo.update_project(
        user_id=user_id,
        project_id=project_id,
        name=request.name,
        description=request.description,
        latest_conversation_id=request.latest_conversation_id,
        latest_dashboard_id=request.latest_dashboard_id,
        dashboard_title=request.dashboard_title,
        dashboard_preview_key=request.dashboard_preview_key,
        is_preview_public=request.is_preview_public,
        allowed=(
            [u.model_dump() for u in request.allowed]
            if request.allowed is not None
            else None
        ),
        source_type=request.source_type,
        name_source="user" if request.name is not None else None,
    )
    if not updated_project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Send invite emails to newly added allowed users
    logger.info("[share] update_project allowed=%s resend_configured=%s", request.allowed is not None, bool(config.resend))
    if request.allowed is not None and config.resend:
        old_entries = existing.get("allowed") or []
        old_keys = {
            u.get("user_id") or u.get("email")
            for u in old_entries
            if isinstance(u, dict)
        }
        logger.info("[share] old_keys=%s incoming_count=%d", old_keys, len(request.allowed))

        def _is_new(u: AllowedUser) -> bool:
            key = u.user_id or u.email
            return key is not None and key not in old_keys

        newly_added = [u for u in request.allowed if _is_new(u)]
        logger.info("[share] newly_added=%s", [(u.user_id, u.email) for u in newly_added])

        if newly_added:
            try:
                clerk_user = await asyncio.to_thread(
                    _clerk_client.users.get, user_id=user_id
                )
                name_parts = filter(None, [clerk_user.first_name, clerk_user.last_name])
                sharer_name = " ".join(name_parts) or clerk_user.username or "Someone"
            except Exception:
                sharer_name = "Someone"

            app_url = (
                config.chat_platform.dreamify_app_url
                if config.chat_platform
                else "https://app.dreamify.dev"
            )
            for invited in newly_added:
                if invited.email:
                    logger.info("[share] Sending invite email to %s", invited.email)
                    await asyncio.to_thread(
                        send_dashboard_share_email,
                        to_email=invited.email,
                        to_name=invited.name,
                        sharer_name=sharer_name,
                        project_id=project_id,
                        app_url=app_url,
                        from_email=config.resend.from_email,
                        api_key=config.resend.dashboard_share_api_key,
                    )
                else:
                    logger.warning("[share] Skipped invite — no email for user_id=%s", invited.user_id)

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


class DashboardPreviewUploadResponse(BaseModel):
    success: bool
    s3_key: Optional[str] = None
    error: Optional[str] = None


class DashboardPreviewUrlResponse(BaseModel):
    url: str
    expires_in: int = 3600


@router.post(
    "/user/project/{project_id}/dashboard-preview",
    response_model=DashboardPreviewUploadResponse,
)
async def upload_dashboard_preview(
    project_id: str,
    dashboard_id: str = Form(..., description="Dashboard ID this preview belongs to"),
    file: UploadFile = File(..., description="PNG image file"),
    user_id: str = Depends(require_user),
):
    """
    Upload a PNG preview image for a dashboard.
    Saves to S3 at: users/{user_id}/projects/{project_id}/dashboards/preview/{dashboard_id}.png
    Updates project's dashboard_preview_key in DynamoDB.
    """
    _get_project_or_404(user_id, project_id)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    ext = "png"
    content_type = "image/png"
    if file.filename and file.filename.lower().endswith(".webp"):
        ext = "webp"
        content_type = "image/webp"

    bucket = config.aws.s3.USER_ASSETS_BUCKET
    s3_key = (
        f"users/{user_id}/projects/{project_id}/dashboards/preview/{dashboard_id}.{ext}"
    )

    try:
        upload_bytes(
            bucket=bucket,
            key=s3_key,
            data=data,
            content_type=content_type,
        )
    except Exception as e:
        logger.error(
            f"Failed to upload dashboard preview for project {project_id}: {e}"
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to upload preview: {str(e)}"
        )

    try:
        projects_repo.update_project(
            user_id=user_id,
            project_id=project_id,
            dashboard_preview_key=s3_key,
        )
    except Exception as e:
        logger.error(
            f"Failed to update project dashboard_preview_key for {project_id}: {e}"
        )
        # Not fatal — image is uploaded, just metadata save failed
        return DashboardPreviewUploadResponse(success=True, s3_key=s3_key)

    logger.info(
        f"Dashboard preview uploaded for project {project_id}, dashboard {dashboard_id}: {s3_key}"
    )
    return DashboardPreviewUploadResponse(success=True, s3_key=s3_key)


@router.get(
    "/user/project/{project_id}/dashboard-preview-url",
    response_model=DashboardPreviewUrlResponse,
)
async def get_dashboard_preview_url(
    project_id: str,
    user_id: str = Depends(require_user),
    expires_in: int = Query(
        3600, ge=60, le=86400, description="URL expiration in seconds"
    ),
):
    """
    Generate a presigned URL for the project's dashboard preview image.
    """
    project = _get_project_or_404(user_id, project_id)
    s3_key = project.get("dashboard_preview_key")

    if not s3_key:
        raise HTTPException(
            status_code=404, detail="No dashboard preview found for this project"
        )

    bucket = config.aws.s3.USER_ASSETS_BUCKET

    try:
        url = generate_presigned_url(bucket=bucket, key=s3_key, expires_in=expires_in)
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate preview URL")

    return DashboardPreviewUrlResponse(url=url, expires_in=expires_in)


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
    content_type = content_type_map.get(
        file_info["extension"], "application/octet-stream"
    )

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


@router.post(
    "/user/asset/add-to-new-project", response_model=AssetAddToNewProjectResponse
)
async def add_assets_to_new_project_endpoint(
    request: AssetAddToNewProjectRequest,
    user_id: str = Depends(require_user),
):
    source_assets = []
    seen_asset_ids = set()
    for asset_id in request.asset_ids:
        trimmed_asset_id = str(asset_id or "").strip()
        if not trimmed_asset_id or trimmed_asset_id in seen_asset_ids:
            continue
        seen_asset_ids.add(trimmed_asset_id)
        source_assets.append(_get_asset_or_404(user_id, trimmed_asset_id))

    if not source_assets:
        raise HTTPException(status_code=400, detail="At least one asset is required")

    default_name = source_assets[0].get("filename") or "Data"
    project = projects_repo.create_project(
        user_id=user_id,
        name=request.project_name or f"{default_name} Project",
        description="Created from an existing file",
    )
    cloned_assets = []
    for source_asset in source_assets:
        cloned = assets_repo.clone_asset_to_project(
            user_id=user_id,
            source_asset=source_asset,
            project_id=project["project_id"],
        )
        patched = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=cloned["asset_id"],
            metadata={
                "cloned_from_asset_id": str(source_asset.get("asset_id", "")),
            },
        )
        cloned_assets.append(patched or cloned)

    return AssetAddToNewProjectResponse(
        success=True,
        project=_map_project(project),
        assets=[_map_asset(item) for item in cloned_assets],
    )


@router.post("/user/asset/add-to-project", response_model=AssetAddToProjectResponse)
async def add_assets_to_project_endpoint(
    request: AssetAddToProjectRequest,
    user_id: str = Depends(require_user),
):
    project = _get_project_or_404(user_id, request.project_id)
    source_assets = []
    seen_asset_ids = set()
    for asset_id in request.asset_ids:
        trimmed_asset_id = str(asset_id or "").strip()
        if not trimmed_asset_id or trimmed_asset_id in seen_asset_ids:
            continue
        seen_asset_ids.add(trimmed_asset_id)
        source_assets.append(_get_asset_or_404(user_id, trimmed_asset_id))

    if not source_assets:
        raise HTTPException(status_code=400, detail="At least one asset is required")

    cloned_assets = []
    for source_asset in source_assets:
        if str(
            source_asset.get("project_id", "")
        ) == request.project_id and source_asset.get("cloned_from_asset_id"):
            cloned_assets.append(source_asset)
            continue
        cloned = assets_repo.clone_asset_to_project(
            user_id=user_id,
            source_asset=source_asset,
            project_id=request.project_id,
        )
        patched = assets_repo.update_asset_metadata(
            user_id=user_id,
            asset_id=cloned["asset_id"],
            metadata={
                "cloned_from_asset_id": str(source_asset.get("asset_id", "")),
            },
        )
        cloned_assets.append(patched or cloned)

    return AssetAddToProjectResponse(
        success=True,
        project=_map_project(project),
        assets=[_map_asset(item) for item in cloned_assets],
    )


def _get_asset_or_404(user_id: str, asset_id: str) -> dict:
    asset = assets_repo.get_asset(user_id, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _resolve_accessible_asset_blob(user_id: str, asset: dict) -> tuple[dict, bytes]:
    """
    Return an asset record + bytes that can actually be downloaded from S3.

    Some historical cloned assets point at a missing S3 key. In that case, fall back
    to another user-owned asset with the same underlying file and repair the current
    asset metadata in place.
    """
    try:
        return asset, download_bytes(asset["s3_bucket"], asset["s3_key"])
    except Exception:
        pass

    all_assets = assets_repo.list_assets(user_id=user_id)
    current_asset_id = str(asset.get("asset_id", ""))
    current_file_id = str(asset.get("file_id", ""))
    current_checksum = str(asset.get("checksum_sha256", ""))
    current_filename = str(asset.get("filename", ""))
    current_size = asset.get("size_bytes")

    def _candidate_score(candidate: dict) -> int:
        score = 0
        if (
            str(candidate.get("file_id", ""))
            and str(candidate.get("file_id", "")) == current_file_id
        ):
            score += 100
        if (
            str(candidate.get("checksum_sha256", ""))
            and str(candidate.get("checksum_sha256", "")) == current_checksum
        ):
            score += 80
        if str(candidate.get("filename", "")) == current_filename:
            score += 20
        if candidate.get("size_bytes") == current_size:
            score += 10
        if str(candidate.get("asset_type", "")) == str(asset.get("asset_type", "")):
            score += 5
        return score

    candidates = [
        candidate
        for candidate in all_assets
        if str(candidate.get("asset_id", "")) != current_asset_id
        and (
            (current_file_id and str(candidate.get("file_id", "")) == current_file_id)
            or (
                current_checksum
                and str(candidate.get("checksum_sha256", "")) == current_checksum
            )
            or (
                current_filename
                and current_size is not None
                and str(candidate.get("filename", "")) == current_filename
                and candidate.get("size_bytes") == current_size
            )
        )
    ]
    candidates.sort(key=_candidate_score, reverse=True)

    for candidate in candidates:
        try:
            blob = download_bytes(candidate["s3_bucket"], candidate["s3_key"])
            assets_repo.update_asset_metadata(
                user_id=user_id,
                asset_id=current_asset_id,
                metadata={
                    "s3_bucket": candidate.get("s3_bucket"),
                    "s3_key": candidate.get("s3_key"),
                    "file_id": candidate.get("file_id") or candidate.get("asset_id"),
                },
            )
            repaired = dict(asset)
            repaired["s3_bucket"] = candidate.get("s3_bucket")
            repaired["s3_key"] = candidate.get("s3_key")
            repaired["file_id"] = candidate.get("file_id") or candidate.get("asset_id")
            logger.info(
                "Recovered missing asset blob for %s using candidate %s",
                current_asset_id,
                candidate.get("asset_id"),
            )
            return repaired, blob
        except Exception:
            continue

    raise FileNotFoundError(
        f"Object not found: s3://{asset.get('s3_bucket')}/{asset.get('s3_key')}"
    )


@router.get("/user/asset/{asset_id}/download-url")
async def get_asset_download_url(
    asset_id: str,
    user_id: str = Depends(require_user),
):
    """Generate a short-lived presigned S3 URL that forces a file download."""

    def _build_content_disposition(filename: str) -> str:
        # S3 response headers are ISO-8859-1 only. Keep ASCII fallback + RFC5987 UTF-8.
        normalized = (
            unicodedata.normalize("NFKD", filename or "")
            .encode("ascii", "ignore")
            .decode("ascii")
        )
        sanitized = re.sub(r'[\\/\r\n"]+', "_", normalized).strip(" .")
        fallback = sanitized or "download"
        utf8_name = quote(
            (filename or fallback).replace("\r", "").replace("\n", ""), safe=""
        )
        return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{utf8_name}"

    asset = _get_asset_or_404(user_id, asset_id)
    try:
        resolved_asset, _ = _resolve_accessible_asset_blob(user_id, asset)
        s3 = get_s3_client()
        filename = resolved_asset.get("filename", asset_id)
        url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": resolved_asset["s3_bucket"],
                "Key": resolved_asset["s3_key"],
                "ResponseContentDisposition": _build_content_disposition(filename),
            },
            ExpiresIn=300,  # 5 minutes
        )
        return {"success": True, "url": url, "filename": filename}
    except Exception as e:
        logger.error(f"Failed to generate download URL for asset {asset_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate download URL")


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
                AuthenticateRequestOptions(jwt_key=jwt_key, authorized_parties=None),
            )

            if not state.is_signed_in:
                raise HTTPException(status_code=401, detail="Invalid or expired token")

            user_id = state.payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Token missing user ID")

            return user_id
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=401, detail=f"Token verification failed: {str(e)}"
            )
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
    limit: int = Query(
        100,
        ge=1,
        le=5000,
        description="Maximum number of rows to return in the preview payload",
    ),
    offset: int = Query(0, ge=0, description="Row offset for paginated fetching"),
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
            logger.warning(
                f"Preview requested for non-existent asset: {asset_id} for user {user_id}"
            )
            raise HTTPException(status_code=404, detail="Asset not found")

        # Download file data (with self-healing for missing S3 keys)
        try:
            asset, file_data = _resolve_accessible_asset_blob(user_id, asset)
        except FileNotFoundError as e:
            logger.warning(
                f"Preview requested for asset with missing blob {asset_id}: {e}"
            )
            raise HTTPException(
                status_code=404,
                detail="The underlying file for this asset is no longer available in storage.",
            )
        except Exception as e:
            logger.error(
                f"Failed to download asset {asset_id} from S3: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to retrieve file from storage: {str(e)}",
            )

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
                    displayed_rows=0,
                )

            # Prepare preview slice using offset + limit
            total_rows = len(df)
            df_preview = df.iloc[offset : offset + limit]

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
                source_type=source_type,
            )

        except Exception as e:
            logger.error(
                f"Failed to process file preview for {asset_id}: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500, detail=f"Failed to parse file: {str(e)}"
            )

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


# ── Feedback ───────────────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    category: str = Field(..., max_length=100)
    message: str = Field(..., min_length=1, max_length=5000)


class OverallFeedbackRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., min_length=1, max_length=320)
    overall_rating: int = Field(..., ge=1, le=5)
    visual_appeal_rating: int = Field(..., ge=1, le=5)
    metrics_insights_rating: int = Field(..., ge=1, le=5)
    layout_editing_rating: int = Field(..., ge=1, le=5)
    share_link_rating: int = Field(..., ge=1, le=5)
    requested_connectors: str = Field(..., min_length=1, max_length=5000)
    dashboard_improvements: str = Field(..., min_length=1, max_length=5000)
    export_improvements: str = Field(..., min_length=1, max_length=5000)
    website: str = Field(default="", max_length=200)


def _format_overall_feedback_message(body: OverallFeedbackRequest, user_id: Optional[str]) -> str:
    def answer(value: str) -> str:
        return value.strip() or "No answer"

    return "\n".join([
        "SUBMITTED CONTACT",
        f"- Full name: {body.full_name.strip()}",
        f"- Email: {body.email.strip()}",
        "",
        "OVERALL RATINGS (1-5)",
        f"- Overall Dreamify dashboard: {body.overall_rating}/5",
        f"- Visual appeal: {body.visual_appeal_rating}/5",
        f"- Metrics and insights coverage: {body.metrics_insights_rating}/5",
        "",
        "FEATURE RATINGS (1-5)",
        f"- Layout editing: {body.layout_editing_rating}/5",
        f"- Dashboard share link: {body.share_link_rating}/5",
        "",
        "OPEN FEEDBACK",
        f"- Requested data connectors:\n{answer(body.requested_connectors)}",
        f"- Dashboard features or improvements:\n{answer(body.dashboard_improvements)}",
        f"- Share link or export improvements:\n{answer(body.export_improvements)}",
        "",
        f"Authenticated user ID: {user_id or 'Guest'}",
    ])


async def _resolve_feedback_identity(
    user_id: Optional[str],
    fallback_name: str = "Unknown",
    fallback_email: str = "unknown",
) -> tuple[str, str]:
    if not user_id:
        return fallback_name, fallback_email

    try:
        clerk_user = await asyncio.to_thread(_clerk_client.users.get, user_id=user_id)
        name_parts = filter(None, [clerk_user.first_name, clerk_user.last_name])
        user_name = " ".join(name_parts) or clerk_user.username or fallback_name
        user_email = (
            clerk_user.email_addresses[0].email_address
            if clerk_user.email_addresses
            else fallback_email
        )
        return user_name, user_email
    except Exception as exc:
        logger.warning("Could not fetch Clerk user %s: %s", user_id, exc)
        return fallback_name if fallback_name != "Unknown" else user_id, fallback_email


@router.post("/feedback")
async def submit_feedback(
    body: FeedbackRequest,
    user_id: str = Depends(require_user),
):
    if not config.resend:
        raise HTTPException(status_code=503, detail="Email service not configured")

    user_name, user_email = await _resolve_feedback_identity(user_id)

    feedback_key = config.resend.feedback_api_key or config.resend.dashboard_share_api_key
    loop = asyncio.get_running_loop()
    sent = await loop.run_in_executor(
        None,
        lambda: send_feedback_email(
            category=body.category,
            message=body.message,
            user_email=user_email,
            user_name=user_name,
            team_email=config.resend.feedback_email,
            from_email=config.resend.from_email,
            api_key=feedback_key,
        ),
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Failed to send feedback email")

    # Best-effort thank-you email — don't fail the request if this doesn't send
    await loop.run_in_executor(
        None,
        lambda: send_feedback_thank_you_email(
            to_email=user_email,
            to_name=user_name,
            category=body.category,
            from_email=config.resend.from_email,
            api_key=feedback_key,
        ),
    )

    return {"success": True}


@router.post("/feedback/overall")
async def submit_overall_feedback(
    body: OverallFeedbackRequest,
    user_id: Optional[str] = Depends(optional_user),
):
    if not config.resend:
        raise HTTPException(status_code=503, detail="Email service not configured")

    # Honeypot for the public form. Return success so automated submissions do
    # not learn whether they were detected.
    if body.website:
        return {"success": True}

    if not body.full_name.strip():
        raise HTTPException(status_code=422, detail="Please enter your full name")

    submitted_email = body.email.strip()
    if not submitted_email or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", submitted_email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address")

    required_answers = [
        body.requested_connectors,
        body.dashboard_improvements,
        body.export_improvements,
    ]
    if any(not answer.strip() for answer in required_answers):
        raise HTTPException(status_code=422, detail="Please answer every feedback question")

    user_name, user_email = await _resolve_feedback_identity(
        user_id,
        fallback_name=body.full_name.strip(),
        fallback_email=submitted_email,
    )
    feedback_key = config.resend.feedback_api_key or config.resend.dashboard_share_api_key
    loop = asyncio.get_running_loop()
    sent = await loop.run_in_executor(
        None,
        lambda: send_feedback_email(
            category="Overall Product Feedback",
            message=_format_overall_feedback_message(body, user_id),
            user_email=user_email,
            user_name=user_name,
            team_email=config.resend.feedback_email,
            from_email=config.resend.from_email,
            api_key=feedback_key,
        ),
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Failed to send feedback email")

    if user_email != "unknown":
        await loop.run_in_executor(
            None,
            lambda: send_feedback_thank_you_email(
                to_email=user_email,
                to_name=user_name,
                category="Dreamify overall experience",
                from_email=config.resend.from_email,
                api_key=feedback_key,
            ),
        )

    return {"success": True}
