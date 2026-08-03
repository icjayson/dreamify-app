"""Notifications, feedback, blog, and owner-admin HTTP routes."""

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.platform.auth import (
    get_current_user,
    get_optional_current_user,
    require_owner_admin,
)
from app.platform.database import (
    ensure_database_write_capacity,
    get_runtime_settings,
    get_session,
)
from app.platform.errors import ApiError, feature_disabled
from app.platform.models import AppUser
from app.platform.routes import get_storage
from app.platform.schemas import FilePreviewRead
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage
from app.platform.support_schemas import (
    AdminConversationDetailRead,
    AdminConversationListRead,
    AdminDashboardRead,
    AdminMetricsRead,
    AdminNodeListRead,
    AdminTimeSeriesPoint,
    AdminUserDetailRead,
    AdminUserListRead,
    BlogPostRead,
    BlogPostSummaryRead,
    BlogPostUpsert,
    FeedbackCreate,
    FeedbackResult,
    NotificationListRead,
    NotificationMarkRead,
    NotificationMarkReadResult,
    OverallFeedbackCreate,
)
from app.platform.support_services import (
    AdminConversationService,
    AdminMetricsService,
    AdminUserService,
    BlogService,
    FeedbackService,
    NotificationService,
)

router = APIRouter(prefix="/api/v1")
admin_router = APIRouter(
    prefix="/api/v1/admin",
    dependencies=[Depends(require_owner_admin)],
)


@router.get(
    "/notifications", response_model=NotificationListRead, tags=["notifications"]
)
def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    unread_only: bool = False,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return NotificationService(session, user.id).list(limit, unread_only)


@router.post(
    "/notifications/mark-read",
    response_model=NotificationMarkReadResult,
    tags=["notifications"],
)
def mark_notifications_read(
    payload: NotificationMarkRead,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    return NotificationService(session, user.id).mark_read(payload.notification_ids)


def _store_feedback(session: Session, settings: Settings, callback) -> FeedbackResult:
    service = FeedbackService(session, settings)
    service.enforce_daily_quota()
    ensure_database_write_capacity(session, settings)
    callback(service)
    return FeedbackResult()


@router.post("/feedback", response_model=FeedbackResult, tags=["feedback"])
def submit_feedback(
    payload: FeedbackCreate,
    session: Session = Depends(get_session),
    user: Optional[AppUser] = Depends(get_optional_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    return _store_feedback(
        session,
        settings,
        lambda service: service.submit(user.id if user else None, payload),
    )


@router.post("/feedback/overall", response_model=FeedbackResult, tags=["feedback"])
def submit_overall_feedback(
    payload: OverallFeedbackCreate,
    session: Session = Depends(get_session),
    user: Optional[AppUser] = Depends(get_optional_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    if payload.website and payload.website.strip():
        return FeedbackResult()
    return _store_feedback(
        session,
        settings,
        lambda service: service.submit_overall(user.id if user else None, payload),
    )


@router.get("/blog/posts", response_model=List[BlogPostSummaryRead], tags=["blog"])
def list_blog_posts(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return BlogService(session, settings).list_published()


@router.get("/blog/posts/{slug}", response_model=BlogPostRead, tags=["blog"])
def get_blog_post(
    slug: str = Path(min_length=1, max_length=180),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return BlogService(session, settings).get_published(slug)


@admin_router.get("/metrics", response_model=AdminMetricsRead, tags=["owner-admin"])
def admin_metrics(session: Session = Depends(get_session)):
    return AdminMetricsService(session).read()


@admin_router.get(
    "/metrics/timeseries",
    response_model=List[AdminTimeSeriesPoint],
    tags=["owner-admin"],
)
def admin_metrics_timeseries(
    days: int = Query(default=30, ge=1, le=90),
    session: Session = Depends(get_session),
):
    return AdminMetricsService(session).time_series(days)


@admin_router.get("/users", response_model=AdminUserListRead, tags=["owner-admin"])
def admin_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    query: Optional[str] = Query(default=None, max_length=320),
    has_dashboard: Optional[bool] = None,
    has_workspace: Optional[bool] = None,
    has_connector: Optional[bool] = None,
    sort_by: str = Query(
        default="signup_date",
        pattern="^(uid|mail|name|has_dashboard|workspace_platform|has_workspace|has_connector|dashboard_count|project_count|file_upload_count|connector_count|connected_connectors|connector_entity_count|workspace_count|connected_workspaces|token_burned|signup_date|latest_signin_date)$",
    ),
    sort_dir: Literal["asc", "desc"] = "desc",
    session: Session = Depends(get_session),
):
    return AdminUserService(session).list(
        page,
        page_size,
        query,
        has_dashboard,
        has_workspace,
        has_connector,
        sort_by,
        sort_dir,
    )


@admin_router.get(
    "/users/{user_id}", response_model=AdminUserDetailRead, tags=["owner-admin"]
)
def admin_user_detail(
    user_id: str = Path(min_length=1, max_length=255),
    session: Session = Depends(get_session),
):
    return AdminUserService(session).detail(user_id)


@admin_router.get(
    "/conversations",
    response_model=AdminConversationListRead,
    tags=["owner-admin"],
)
def admin_conversations(
    project_id: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return AdminConversationService(session, settings, storage).list(
        project_id, page, page_size
    )


def _admin_conversations(
    session: Session, settings: Settings, storage: ObjectStorage
) -> AdminConversationService:
    return AdminConversationService(session, settings, storage)


@admin_router.get(
    "/conversations/{conversation_id}",
    response_model=AdminConversationDetailRead,
    tags=["owner-admin"],
)
def admin_conversation(
    conversation_id: str,
    project_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return _admin_conversations(session, settings, storage).detail(
        conversation_id, project_id
    )


@admin_router.get(
    "/conversations/{conversation_id}/nodes",
    response_model=AdminNodeListRead,
    tags=["owner-admin"],
)
def admin_conversation_nodes(
    conversation_id: str,
    project_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return _admin_conversations(session, settings, storage).nodes(
        conversation_id, project_id
    )


@admin_router.get(
    "/conversations/{conversation_id}/dashboard",
    response_model=AdminDashboardRead,
    tags=["owner-admin"],
)
def admin_conversation_dashboard(
    conversation_id: str,
    project_id: str,
    dashboard_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return _admin_conversations(session, settings, storage).dashboard(
        conversation_id, project_id, dashboard_id
    )


@admin_router.get(
    "/conversations/{conversation_id}/assets/{asset_id}/preview",
    response_model=FilePreviewRead,
    tags=["owner-admin"],
)
def admin_asset_preview(
    conversation_id: str,
    asset_id: str,
    project_id: str,
    limit: int = Query(default=100, ge=1, le=5_000),
    offset: int = Query(default=0, ge=0, le=100_000),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return _admin_conversations(session, settings, storage).preview(
        conversation_id, project_id, asset_id, limit, offset
    )


@admin_router.get(
    "/blog/posts", response_model=List[BlogPostSummaryRead], tags=["owner-admin"]
)
def admin_blog_posts(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return BlogService(session, settings).list_all()


@admin_router.get(
    "/blog/posts/{post_id}", response_model=BlogPostRead, tags=["owner-admin"]
)
def admin_blog_post(
    post_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return BlogService(session, settings).get(post_id)


def _blog_write(session: Session, settings: Settings, operation):
    ensure_database_write_capacity(session, settings)
    try:
        return operation(BlogService(session, settings))
    except IntegrityError as exc:
        session.rollback()
        raise ApiError(409, "BLOG_WRITE_CONFLICT", "Blog update conflicted") from exc


@admin_router.post(
    "/blog/posts",
    response_model=BlogPostRead,
    status_code=status.HTTP_201_CREATED,
    tags=["owner-admin"],
)
def create_admin_blog_post(
    payload: BlogPostUpsert,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return _blog_write(session, settings, lambda service: service.create(payload))


@admin_router.patch(
    "/blog/posts/{post_id}", response_model=BlogPostRead, tags=["owner-admin"]
)
def update_admin_blog_post(
    post_id: str,
    payload: BlogPostUpsert,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return _blog_write(
        session, settings, lambda service: service.update(post_id, payload)
    )


@admin_router.delete(
    "/blog/posts/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["owner-admin"],
)
def delete_admin_blog_post(
    post_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    _blog_write(session, settings, lambda service: service.delete(post_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.patch(
    "/blog/posts/{post_id}/feature",
    response_model=BlogPostRead,
    tags=["owner-admin"],
)
def feature_admin_blog_post(
    post_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return _blog_write(session, settings, lambda service: service.feature(post_id))


@admin_router.post("/blog/assets", tags=["owner-admin"])
def upload_admin_blog_asset():
    raise feature_disabled("public blog media upload")
