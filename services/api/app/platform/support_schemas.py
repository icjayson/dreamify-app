"""Public contracts for notifications, feedback, blog, and owner administration."""

import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrmSupportSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class NotificationRead(OrmSupportSchema):
    notification_id: str = Field(validation_alias="id")
    type: Literal["sync_success", "sync_failed", "token_expired"]
    title: str
    body: str
    read: bool
    created_at: datetime
    schedule_id: Optional[str] = None
    run_id: Optional[str] = None
    provider: Optional[str] = None
    asset_id: Optional[str] = None
    project_id: Optional[str] = None


class NotificationListRead(BaseModel):
    notifications: List[NotificationRead]
    unread_count: int = Field(ge=0)


class NotificationMarkRead(BaseModel):
    notification_ids: Optional[List[str]] = Field(default=None, max_length=100)

    @field_validator("notification_ids")
    @classmethod
    def validate_ids(cls, values: Optional[List[str]]) -> Optional[List[str]]:
        if values is None:
            return None
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 36 for value in cleaned):
            raise ValueError("notification_ids contain an invalid identifier")
        return list(dict.fromkeys(cleaned))


class NotificationMarkReadResult(BaseModel):
    marked_read: int = Field(ge=0)


def _strip_required(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("value must not be blank")
    return normalized


class FeedbackCreate(BaseModel):
    category: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=5000)

    @field_validator("category", "message")
    @classmethod
    def strip_required(cls, value: str) -> str:
        return _strip_required(value)


class OverallFeedbackCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    overall_rating: int = Field(ge=1, le=5)
    visual_appeal_rating: int = Field(ge=1, le=5)
    metrics_insights_rating: int = Field(ge=1, le=5)
    layout_editing_rating: int = Field(ge=1, le=5)
    share_link_rating: int = Field(ge=1, le=5)
    requested_connectors: str = Field(min_length=1, max_length=5000)
    dashboard_improvements: str = Field(min_length=1, max_length=5000)
    export_improvements: str = Field(min_length=1, max_length=5000)
    website: Optional[str] = Field(default=None, max_length=200)

    @field_validator(
        "full_name",
        "requested_connectors",
        "dashboard_improvements",
        "export_improvements",
    )
    @classmethod
    def strip_required(cls, value: str) -> str:
        return _strip_required(value)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}", normalized):
            raise ValueError("email must be a valid address")
        return normalized


class FeedbackResult(BaseModel):
    success: Literal[True] = True


class BlogPostSummaryRead(OrmSupportSchema):
    post_id: str = Field(validation_alias="id")
    slug: str
    title: str
    description: str
    cover_image_url: Optional[str]
    cover_image_alt: Optional[str]
    author: str
    persona: Optional[str]
    tags: List[str]
    status: Literal["draft", "published"]
    reading_minutes: int = Field(ge=1)
    published_at: Optional[datetime]
    featured: bool
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class BlogPostRead(BlogPostSummaryRead):
    content_html: str
    content_json: Optional[Dict[str, Any]]
    target_keyword: Optional[str]


class BlogPostUpsert(BaseModel):
    slug: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=180,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    )
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(min_length=1, max_length=1000)
    content_html: str = Field(min_length=1)
    content_json: Optional[Dict[str, Any]] = None
    cover_image_url: Optional[str] = Field(default=None, max_length=2048)
    cover_image_alt: Optional[str] = Field(default=None, max_length=500)
    author: str = Field(min_length=1, max_length=160)
    persona: Optional[str] = Field(default=None, max_length=160)
    tags: List[str] = Field(default_factory=list, max_length=20)
    target_keyword: Optional[str] = Field(default=None, max_length=255)
    status: Literal["draft", "published"]

    @field_validator("title", "description", "author")
    @classmethod
    def strip_required(cls, value: str) -> str:
        return _strip_required(value)

    @field_validator("content_html")
    @classmethod
    def reject_blank_html(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content_html must not be blank")
        return value

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: List[str]) -> List[str]:
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 80 for value in cleaned):
            raise ValueError("tags must contain 1-80 character values")
        return list(dict.fromkeys(cleaned))


class AdminMetricsRead(BaseModel):
    total_users: int
    total_conversations: int
    total_messages: int
    avg_msgs_per_user: float
    success_rate: float
    total_tokens: int
    mode_distribution: Dict[str, int]
    model_distribution: Dict[str, int]


class AdminTimeSeriesPoint(BaseModel):
    date: str
    messages: int
    conversations: int
    active_users: int
    tokens: int
    modes: Dict[str, int]
    models: Dict[str, int]
    tokens_by_model: Dict[str, int]


class AdminUserListRead(BaseModel):
    users: List[Dict[str, Any]]
    total: int
    page: int
    page_size: int


class AdminUserDetailRead(BaseModel):
    user: Dict[str, Any]
    projects: List[Dict[str, Any]]
    dashboards: List[Dict[str, Any]]
    files: List[Dict[str, Any]]
    connectors: List[Dict[str, Any]]
    entities: List[Dict[str, Any]]
    workspaces: List[Dict[str, Any]]
    conversations: List[Dict[str, Any]]


class AdminConversationListRead(BaseModel):
    conversations: List[Dict[str, Any]]
    total: int
    last_key: Optional[str] = None


class AdminConversationDetailRead(BaseModel):
    conversation: Dict[str, Any]


class AdminNodeListRead(BaseModel):
    nodes: List[Dict[str, Any]]


class AdminDashboardRead(BaseModel):
    dashboard_id: str
    dashboard_data: Dict[str, Any]
