"""
Blog CMS endpoints.

Public reads (no auth) power the marketing /blog pages.
Admin writes (require_admin) power the /admin/cms authoring UI.
Images are stored in S3 and served via a stable redirect endpoint so the
stored post content never embeds an expiring presigned URL.
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.dependencies.auth import require_admin
from utils.config import config
from utils.dynamodb.repos import blog_posts as blog_repo
from utils.s3.client import generate_presigned_url, upload_bytes

logger = logging.getLogger(__name__)
router = APIRouter(tags=["cms"])

_ASSET_PREFIX = "blog/assets"
_ALLOWED_IMAGE_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
}
_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _reading_minutes(content_html: str) -> int:
    text = re.sub(r"<[^>]+>", " ", content_html or "")
    words = len(text.split())
    return max(1, round(words / 200))


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class BlogPostResponse(BaseModel):
    post_id: str
    slug: str
    title: str
    description: str = ""
    content_html: str = ""
    content_json: Optional[Dict[str, Any]] = None
    cover_image_url: Optional[str] = None
    author: str = "Dreamify Team"
    persona: Optional[str] = None
    tags: List[str] = []
    target_keyword: Optional[str] = None
    status: str = "draft"
    reading_minutes: int = 1
    published_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BlogPostListItem(BaseModel):
    post_id: str
    slug: str
    title: str
    description: str = ""
    cover_image_url: Optional[str] = None
    author: str = "Dreamify Team"
    persona: Optional[str] = None
    tags: List[str] = []
    status: str = "draft"
    reading_minutes: int = 1
    published_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BlogPostUpsert(BaseModel):
    slug: Optional[str] = None
    title: str
    description: str = ""
    content_html: str = ""
    content_json: Optional[Dict[str, Any]] = None
    cover_image_url: Optional[str] = None
    author: str = "Dreamify Team"
    persona: Optional[str] = None
    tags: List[str] = []
    target_keyword: Optional[str] = None
    status: str = "draft"


class AssetUploadResponse(BaseModel):
    asset_id: str
    url: str


def _to_response(item: Dict) -> BlogPostResponse:
    return BlogPostResponse(
        post_id=item["post_id"],
        slug=item.get("slug", ""),
        title=item.get("title", ""),
        description=item.get("description", "") or "",
        content_html=item.get("content_html", "") or "",
        content_json=item.get("content_json") or None,
        cover_image_url=item.get("cover_image_url"),
        author=item.get("author") or "Dreamify Team",
        persona=item.get("persona"),
        tags=item.get("tags") or [],
        target_keyword=item.get("target_keyword"),
        status=item.get("status", "draft"),
        reading_minutes=int(item.get("reading_minutes") or 1),
        published_at=item.get("published_at"),
        created_at=item.get("created_at"),
        updated_at=item.get("updated_at"),
    )


def _slugify(value: str) -> str:
    value = (value or "").lower().strip()
    value = re.sub(r"[^a-z0-9\s-]", "", value)
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"-+", "-", value)
    return value.strip("-")


# --------------------------------------------------------------------------- #
# Public reads
# --------------------------------------------------------------------------- #
@router.get("/blog/posts", response_model=List[BlogPostListItem])
async def list_public_posts() -> List[BlogPostListItem]:
    """Published posts, newest-first."""
    items = blog_repo.list_published()
    return [BlogPostListItem(**_to_response(i).model_dump()) for i in items]


@router.get("/blog/posts/{slug}", response_model=BlogPostResponse)
async def get_public_post(slug: str) -> BlogPostResponse:
    item = blog_repo.get_post_by_slug(slug)
    if not item or item.get("status") != "published":
        raise HTTPException(status_code=404, detail="Post not found")
    return _to_response(item)


@router.get("/blog/assets/{asset_id}")
async def serve_asset(asset_id: str):
    """Redirect to a freshly-signed S3 URL for a blog image."""
    # Guard against path traversal / unexpected ids.
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", asset_id):
        raise HTTPException(status_code=400, detail="Invalid asset id")
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    key = f"{_ASSET_PREFIX}/{asset_id}"
    try:
        url = generate_presigned_url(bucket=bucket, key=key, expires_in=86400)
    except Exception as e:
        logger.error("Failed to sign blog asset %s: %s", asset_id, e)
        raise HTTPException(status_code=404, detail="Asset not found")
    return RedirectResponse(url=url, status_code=302)


# --------------------------------------------------------------------------- #
# Admin writes
# --------------------------------------------------------------------------- #
@router.get("/admin/blog/posts", response_model=List[BlogPostListItem])
async def admin_list_posts(_: dict = Depends(require_admin)) -> List[BlogPostListItem]:
    items = blog_repo.list_all()
    return [BlogPostListItem(**_to_response(i).model_dump()) for i in items]


@router.get("/admin/blog/posts/{post_id}", response_model=BlogPostResponse)
async def admin_get_post(post_id: str, _: dict = Depends(require_admin)) -> BlogPostResponse:
    item = blog_repo.get_post(post_id)
    if not item:
        raise HTTPException(status_code=404, detail="Post not found")
    return _to_response(item)


def _resolve_slug(body: BlogPostUpsert, exclude_post_id: Optional[str] = None) -> str:
    slug = _slugify(body.slug or body.title)
    if not slug:
        raise HTTPException(status_code=400, detail="A title or slug is required")
    existing = blog_repo.get_post_by_slug(slug)
    if existing and existing.get("post_id") != exclude_post_id:
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' is already in use")
    return slug


@router.post("/admin/blog/posts", response_model=BlogPostResponse, status_code=201)
async def admin_create_post(
    body: BlogPostUpsert,
    _: dict = Depends(require_admin),
) -> BlogPostResponse:
    slug = _resolve_slug(body)
    published_at = _now_iso() if body.status == "published" else None
    item = blog_repo.create_post(
        slug=slug,
        title=body.title,
        description=body.description,
        content_html=body.content_html,
        content_json=body.content_json,
        cover_image_url=body.cover_image_url,
        author=body.author,
        persona=body.persona,
        tags=body.tags,
        target_keyword=body.target_keyword,
        status=body.status,
        reading_minutes=_reading_minutes(body.content_html),
        published_at=published_at,
    )
    return _to_response(item)


@router.patch("/admin/blog/posts/{post_id}", response_model=BlogPostResponse)
async def admin_update_post(
    post_id: str,
    body: BlogPostUpsert,
    _: dict = Depends(require_admin),
) -> BlogPostResponse:
    current = blog_repo.get_post(post_id)
    if not current:
        raise HTTPException(status_code=404, detail="Post not found")

    slug = _resolve_slug(body, exclude_post_id=post_id)

    # Stamp published_at the first time a post transitions to published.
    published_at = current.get("published_at")
    if body.status == "published" and not published_at:
        published_at = _now_iso()

    updated = blog_repo.update_post(
        post_id,
        slug=slug,
        title=body.title,
        description=body.description,
        content_html=body.content_html,
        content_json=body.content_json,
        cover_image_url=body.cover_image_url,
        author=body.author,
        persona=body.persona,
        tags=body.tags,
        target_keyword=body.target_keyword,
        status=body.status,
        reading_minutes=_reading_minutes(body.content_html),
        published_at=published_at,
    )
    return _to_response(updated)


@router.delete("/admin/blog/posts/{post_id}")
async def admin_delete_post(post_id: str, _: dict = Depends(require_admin)) -> dict:
    if not blog_repo.get_post(post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    blog_repo.delete_post(post_id)
    return {"success": True}


@router.post("/admin/blog/assets", response_model=AssetUploadResponse)
async def admin_upload_asset(
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
) -> AssetUploadResponse:
    content_type = (file.content_type or "").lower()
    if content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{content_type}'. Allowed: PNG, JPG, WebP, GIF, SVG.",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 10 MB limit")

    asset_id = uuid.uuid4().hex
    bucket = config.aws.s3.USER_ASSETS_BUCKET
    key = f"{_ASSET_PREFIX}/{asset_id}"
    try:
        upload_bytes(bucket=bucket, key=key, data=data, content_type=content_type)
    except Exception as e:
        logger.error("Failed to upload blog asset: %s", e)
        raise HTTPException(status_code=500, detail="Failed to upload image")

    return AssetUploadResponse(asset_id=asset_id, url=f"/api/v1/blog/assets/{asset_id}")
