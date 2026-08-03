"""Application services for support APIs and owner-only operational views."""

import json
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.platform.compatibility import ConversationReadService
from app.platform.errors import ApiError, not_found
from app.platform.models import (
    AppUser,
    Asset,
    BlogPost,
    Conversation,
    Dashboard,
    FeedbackSubmission,
    OverallFeedbackSubmission,
    Project,
    ProviderConnection,
    WorkflowRun,
    utc_now,
)
from app.platform.services import FilePreviewService, validate_dashboard_content
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage
from app.platform.support_repositories import (
    BlogRepository,
    FeedbackRepository,
    NotificationRepository,
)
from app.platform.support_schemas import (
    BlogPostUpsert,
    FeedbackCreate,
    OverallFeedbackCreate,
)


class NotificationService:
    def __init__(self, session: Session, owner_id: str):
        self.repository = NotificationRepository(session)
        self.owner_id = owner_id

    def list(self, limit: int, unread_only: bool) -> Dict[str, Any]:
        return {
            "notifications": self.repository.list_owned(
                self.owner_id, limit, unread_only
            ),
            "unread_count": self.repository.unread_count(self.owner_id),
        }

    def mark_read(self, notification_ids: Optional[List[str]]) -> Dict[str, int]:
        return {
            "marked_read": self.repository.mark_read(self.owner_id, notification_ids)
        }


class FeedbackService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.repository = FeedbackRepository(session)

    def enforce_daily_quota(self) -> None:
        since = datetime.now(timezone.utc) - timedelta(days=1)
        generic_count = self.session.scalar(
            select(func.count())
            .select_from(FeedbackSubmission)
            .where(FeedbackSubmission.created_at >= since)
        )
        overall_count = self.session.scalar(
            select(func.count())
            .select_from(OverallFeedbackSubmission)
            .where(OverallFeedbackSubmission.created_at >= since)
        )
        if (
            int(generic_count or 0) + int(overall_count or 0)
            >= self.settings.feedback_submissions_per_day
        ):
            raise ApiError(
                429,
                "FEEDBACK_RATE_LIMITED",
                "The demo feedback limit has been reached; try again later",
            )

    def submit(self, owner_id: Optional[str], payload: FeedbackCreate) -> None:
        self.repository.add(
            FeedbackSubmission(
                owner_id=owner_id,
                category=payload.category,
                message=payload.message,
            )
        )

    def submit_overall(
        self, owner_id: Optional[str], payload: OverallFeedbackCreate
    ) -> None:
        values = payload.model_dump(exclude={"website"})
        self.repository.add_overall(
            OverallFeedbackSubmission(owner_id=owner_id, **values)
        )


def blog_content_size(content_html: str, content_json: Optional[Dict]) -> int:
    serialized_json = json.dumps(
        content_json,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return len(content_html.encode("utf-8")) + len(serialized_json.encode("utf-8"))


def validate_blog_content(payload: BlogPostUpsert, max_bytes: int) -> None:
    size_bytes = blog_content_size(payload.content_html, payload.content_json)
    if size_bytes > max_bytes:
        raise ApiError(
            413,
            "BLOG_CONTENT_TOO_LARGE",
            "Blog content exceeds the deployment limit",
            {"max_bytes": max_bytes, "size_bytes": size_bytes},
        )


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug:
        raise ApiError(422, "BLOG_SLUG_INVALID", "Title cannot produce a blog slug")
    return slug[:180].rstrip("-")


def reading_minutes(content_html: str) -> int:
    text_content = re.sub(r"<[^>]+>", " ", content_html)
    words = len(re.findall(r"\b\w+\b", text_content))
    return max(1, (words + 199) // 200)


class BlogService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.repository = BlogRepository(session)

    def list_published(self) -> List[BlogPost]:
        return self.repository.list_published()

    def get_published(self, slug: str) -> BlogPost:
        post = self.repository.published_by_slug(slug)
        if post is None:
            raise not_found("Blog post")
        return post

    def list_all(self) -> List[BlogPost]:
        return self.repository.list_all()

    def get(self, post_id: str) -> BlogPost:
        post = self.repository.get(post_id)
        if post is None:
            raise not_found("Blog post")
        return post

    def create(self, payload: BlogPostUpsert) -> BlogPost:
        validate_blog_content(payload, self.settings.max_blog_content_bytes)
        slug = payload.slug or slugify(payload.title)
        self._require_available_slug(slug)
        values = payload.model_dump(exclude={"slug"})
        post = BlogPost(
            slug=slug,
            reading_minutes=reading_minutes(payload.content_html),
            published_at=utc_now() if payload.status == "published" else None,
            **values,
        )
        return self.repository.add(post)

    def update(self, post_id: str, payload: BlogPostUpsert) -> BlogPost:
        validate_blog_content(payload, self.settings.max_blog_content_bytes)
        post = self.get(post_id)
        slug = payload.slug or post.slug
        self._require_available_slug(slug, post.id)
        was_published = post.status == "published"
        for field, value in payload.model_dump(exclude={"slug"}).items():
            setattr(post, field, value)
        post.slug = slug
        post.reading_minutes = reading_minutes(payload.content_html)
        post.published_at = self._published_at(post, was_published)
        if post.status == "draft":
            post.featured = False
        self.session.flush()
        return post

    def delete(self, post_id: str) -> None:
        self.session.delete(self.get(post_id))
        self.session.flush()

    def feature(self, post_id: str) -> BlogPost:
        post = self.get(post_id)
        if post.status != "published":
            raise ApiError(
                409,
                "BLOG_POST_NOT_PUBLISHED",
                "Only a published blog post can be featured",
            )
        self.repository.clear_featured(except_post_id=post.id)
        post.featured = True
        self.session.flush()
        return post

    def _require_available_slug(
        self, slug: str, current_post_id: Optional[str] = None
    ) -> None:
        existing = self.repository.by_slug(slug)
        if existing and existing.id != current_post_id:
            raise ApiError(409, "BLOG_SLUG_CONFLICT", "Blog slug already exists")

    @staticmethod
    def _published_at(post: BlogPost, was_published: bool) -> Optional[datetime]:
        if post.status != "published":
            return None
        return post.published_at if was_published and post.published_at else utc_now()


def _assistant_message_exists(run: WorkflowRun) -> bool:
    return bool(run.output or run.result or run.response_artifact)


def _run_model(run: WorkflowRun, providers: Dict[str, str]) -> str:
    if not run.provider_connection_id:
        return "demo"
    return providers.get(run.provider_connection_id, "byok")


class AdminMetricsService:
    def __init__(self, session: Session):
        self.session = session

    def read(self) -> Dict[str, Any]:
        runs = list(self.session.scalars(select(WorkflowRun)).all())
        providers = self._providers()
        total_users = self._count(AppUser)
        total_conversations = self._count(Conversation)
        total_messages = sum(1 + int(_assistant_message_exists(run)) for run in runs)
        terminal = [
            run for run in runs if run.status in {"completed", "failed", "cancelled"}
        ]
        successful = sum(run.status == "completed" for run in terminal)
        return {
            "total_users": total_users,
            "total_conversations": total_conversations,
            "total_messages": total_messages,
            "avg_msgs_per_user": (
                round(total_messages / total_users, 1) if total_users else 0
            ),
            "success_rate": (
                round(100 * successful / len(terminal), 1) if terminal else 0
            ),
            "total_tokens": 0,
            "mode_distribution": dict(Counter(run.run_kind for run in runs)),
            "model_distribution": dict(
                Counter(_run_model(run, providers) for run in runs)
            ),
        }

    def time_series(self, days: int) -> List[Dict[str, Any]]:
        today = datetime.now(timezone.utc).date()
        first_day = today - timedelta(days=days - 1)
        conversations = list(self.session.scalars(select(Conversation)).all())
        runs = list(self.session.scalars(select(WorkflowRun)).all())
        providers = self._providers()
        return [
            self._day_point(day, conversations, runs, providers)
            for day in (first_day + timedelta(days=offset) for offset in range(days))
        ]

    def _day_point(
        self,
        day: date,
        conversations: List[Conversation],
        runs: List[WorkflowRun],
        providers: Dict[str, str],
    ) -> Dict[str, Any]:
        day_conversations = [
            item for item in conversations if item.created_at.date() == day
        ]
        day_runs = [item for item in runs if item.created_at.date() == day]
        users = {item.owner_id for item in day_conversations + day_runs}
        models = Counter(_run_model(run, providers) for run in day_runs)
        return {
            "date": day.isoformat(),
            "messages": sum(
                1 + int(_assistant_message_exists(run)) for run in day_runs
            ),
            "conversations": len(day_conversations),
            "active_users": len(users),
            "tokens": 0,
            "modes": dict(Counter(run.run_kind for run in day_runs)),
            "models": dict(models),
            "tokens_by_model": {model: 0 for model in models},
        }

    def _count(self, model: Any) -> int:
        return int(self.session.scalar(select(func.count()).select_from(model)) or 0)

    def _providers(self) -> Dict[str, str]:
        rows = self.session.execute(
            select(ProviderConnection.id, ProviderConnection.provider)
        ).all()
        return dict(rows)


class AdminUserService:
    def __init__(self, session: Session):
        self.session = session

    def list(
        self,
        page: int,
        page_size: int,
        query: Optional[str],
        has_dashboard: Optional[bool],
        has_workspace: Optional[bool],
        has_connector: Optional[bool],
        sort_by: str,
        sort_dir: str,
    ) -> Dict[str, Any]:
        records = [self._summary(user) for user in self._users()]
        records = self._filter(
            records, query, has_dashboard, has_workspace, has_connector
        )
        records.sort(
            key=lambda item: self._sort_value(item, sort_by),
            reverse=sort_dir == "desc",
        )
        start = (page - 1) * page_size
        return {
            "users": records[start : start + page_size],
            "total": len(records),
            "page": page,
            "page_size": page_size,
        }

    def detail(self, user_id: str) -> Dict[str, Any]:
        user = self.session.get(AppUser, user_id)
        if user is None:
            raise not_found("User")
        projects = self._owned(Project, user.id)
        dashboards = self._owned(Dashboard, user.id)
        assets = self._owned(Asset, user.id)
        conversations = self._owned(Conversation, user.id)
        return {
            "user": self._summary(user),
            "projects": self._projects(projects, dashboards, conversations),
            "dashboards": [self._dashboard(item) for item in dashboards],
            "files": [self._file(item) for item in assets],
            "connectors": [],
            "entities": [],
            "workspaces": [],
            "conversations": [self._conversation(item) for item in conversations],
        }

    def _summary(self, user: AppUser) -> Dict[str, Any]:
        projects = self._owned(Project, user.id)
        dashboards = self._owned(Dashboard, user.id)
        assets = self._owned(Asset, user.id)
        return {
            "uid": user.id,
            "mail": user.email,
            "name": user.display_name or user.email or user.id,
            "has_dashboard": bool(dashboards),
            "workspace_platform": "",
            "workspace_platforms": [],
            "has_workspace": False,
            "has_connector": False,
            "dashboard_count": len(dashboards),
            "project_count": len(projects),
            "file_upload_count": len(assets),
            "connector_count": 0,
            "connected_connectors": [],
            "connector_entity_count": 0,
            "workspace_count": 0,
            "connected_workspaces": [],
            "token_burned": 0,
            "signup_date": user.created_at,
            "latest_signin_date": None,
        }

    @staticmethod
    def _filter(
        records: List[Dict[str, Any]],
        query: Optional[str],
        has_dashboard: Optional[bool],
        has_workspace: Optional[bool],
        has_connector: Optional[bool],
    ) -> List[Dict[str, Any]]:
        if query:
            needle = query.strip().lower()
            records = [
                item
                for item in records
                if needle
                in " ".join(
                    str(item[key] or "") for key in ("uid", "mail", "name")
                ).lower()
            ]
        for key, value in (
            ("has_dashboard", has_dashboard),
            ("has_workspace", has_workspace),
            ("has_connector", has_connector),
        ):
            if value is not None:
                records = [item for item in records if item[key] is value]
        return records

    @staticmethod
    def _sort_value(item: Dict[str, Any], field: str) -> Tuple[bool, Any]:
        value = item.get(field)
        if isinstance(value, list):
            value = ",".join(str(entry) for entry in value)
        if isinstance(value, str):
            value = value.lower()
        return value is None, value

    def _users(self) -> List[AppUser]:
        return list(self.session.scalars(select(AppUser)).all())

    def _owned(self, model: Any, owner_id: str) -> List[Any]:
        query = select(model).where(model.owner_id == owner_id)
        return list(self.session.scalars(query).all())

    @staticmethod
    def _projects(
        projects: List[Project],
        dashboards: List[Dashboard],
        conversations: List[Conversation],
    ) -> List[Dict[str, Any]]:
        records = []
        for project in projects:
            project_dashboards = [
                item for item in dashboards if item.project_id == project.id
            ]
            project_conversations = [
                item for item in conversations if item.project_id == project.id
            ]
            latest_dashboard = max(
                project_dashboards, key=lambda item: item.updated_at, default=None
            )
            latest_conversation = max(
                project_conversations, key=lambda item: item.updated_at, default=None
            )
            records.append(
                {
                    "project_id": project.id,
                    "name": project.name,
                    "description": project.description,
                    "created_at": project.created_at,
                    "updated_at": project.updated_at,
                    "latest_conversation_id": (
                        latest_conversation.id if latest_conversation else None
                    ),
                    "latest_dashboard_id": (
                        latest_dashboard.id if latest_dashboard else None
                    ),
                    "dashboard_title": (
                        latest_dashboard.title if latest_dashboard else None
                    ),
                    "dashboard_preview_key": None,
                    "source_type": None,
                }
            )
        return records

    @staticmethod
    def _dashboard(item: Dashboard) -> Dict[str, Any]:
        return {
            "dashboard_id": item.id,
            "project_id": item.project_id,
            "conversation_id": item.conversation_id,
            "title": item.title,
            "status": item.status,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }

    @staticmethod
    def _file(item: Asset) -> Dict[str, Any]:
        return {
            "asset_id": item.id,
            "file_id": item.id,
            "project_id": item.project_id,
            "filename": item.filename,
            "extension": Path(item.filename).suffix.lower().lstrip("."),
            "asset_type": item.asset_type,
            "status": item.status,
            "size_bytes": item.size_bytes,
            "created_at": item.created_at,
            "row_count": None,
            "column_count": None,
        }

    @staticmethod
    def _conversation(item: Conversation) -> Dict[str, Any]:
        return {
            "conversation_id": item.id,
            "project_id": item.project_id or "",
            "title": item.title,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
            "total_tokens": 0,
            "chat_mode": None,
            "model": None,
        }


class AdminConversationService:
    def __init__(
        self,
        session: Session,
        settings: Settings,
        storage: ObjectStorage,
    ):
        self.session = session
        self.settings = settings
        self.storage = storage

    def list(
        self, project_id: Optional[str], page: int, page_size: int
    ) -> Dict[str, Any]:
        query = select(Conversation)
        if project_id:
            query = query.where(Conversation.project_id == project_id)
        total = int(
            self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        )
        conversations = list(
            self.session.scalars(
                query.order_by(Conversation.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
        )
        users = {user.id: user for user in self.session.scalars(select(AppUser)).all()}
        return {
            "conversations": [
                self._list_item(item, users.get(item.owner_id))
                for item in conversations
            ],
            "total": total,
        }

    def detail(self, conversation_id: str, project_id: str) -> Dict[str, Any]:
        conversation = self._conversation(conversation_id, project_id)
        project = self._project(project_id)
        payload = ConversationReadService(self.session, project.owner_id).read(
            conversation.id, project_id
        )
        payload["conversation"]["user_id"] = conversation.owner_id
        payload["conversation"]["metadata"] = {}
        return payload

    def nodes(self, conversation_id: str, project_id: str) -> Dict[str, Any]:
        return {
            "nodes": self.detail(conversation_id, project_id)["conversation"]["nodes"]
        }

    def dashboard(
        self, conversation_id: str, project_id: str, dashboard_id: str
    ) -> Dict[str, Any]:
        conversation = self._conversation(conversation_id, project_id)
        dashboard = self.session.get(Dashboard, dashboard_id)
        if (
            dashboard is None
            or dashboard.project_id != project_id
            or dashboard.conversation_id not in (None, conversation.id)
        ):
            raise not_found("Dashboard")
        validate_dashboard_content(dashboard.content, self.settings.max_dashboard_bytes)
        return {"dashboard_id": dashboard.id, "dashboard_data": dashboard.content}

    def preview(
        self,
        conversation_id: str,
        project_id: str,
        asset_id: str,
        limit: int,
        offset: int,
    ) -> Dict[str, Any]:
        self._conversation(conversation_id, project_id)
        asset = self.session.get(Asset, asset_id)
        if asset is None or asset.project_id != project_id:
            raise not_found("Asset")
        project = self._project(project_id)
        return FilePreviewService(
            self.session, project.owner_id, self.settings, self.storage
        ).bounded_read(asset.id, limit, offset)

    def _conversation(self, conversation_id: str, project_id: str) -> Conversation:
        conversation = self.session.get(Conversation, conversation_id)
        if conversation is None or conversation.project_id != project_id:
            raise not_found("Conversation")
        return conversation

    def _project(self, project_id: str) -> Project:
        project = self.session.get(Project, project_id)
        if project is None:
            raise not_found("Project")
        return project

    def _list_item(
        self, conversation: Conversation, user: Optional[AppUser]
    ) -> Dict[str, Any]:
        run = self.session.scalar(
            select(WorkflowRun)
            .where(WorkflowRun.conversation_id == conversation.id)
            .order_by(WorkflowRun.created_at.desc())
            .limit(1)
        )
        provider = None
        if run and run.provider_connection_id:
            connection = self.session.get(
                ProviderConnection, run.provider_connection_id
            )
            provider = connection.provider if connection else "byok"
        return {
            "conversation_id": conversation.id,
            "project_id": conversation.project_id or "",
            "user_id": conversation.owner_id,
            "user_name": user.display_name if user else None,
            "title": conversation.title,
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "chat_mode": run.run_kind if run else None,
            "model": provider or ("demo" if run else None),
            "total_tokens": 0,
        }
