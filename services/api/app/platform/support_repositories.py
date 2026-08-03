"""Persistence boundaries for small support domains."""

from typing import List, Optional

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.platform.models import (
    BlogPost,
    FeedbackSubmission,
    Notification,
    OverallFeedbackSubmission,
)


class NotificationRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_owned(
        self, owner_id: str, limit: int, unread_only: bool
    ) -> List[Notification]:
        query = select(Notification).where(Notification.owner_id == owner_id)
        if unread_only:
            query = query.where(Notification.read.is_(False))
        query = query.order_by(Notification.created_at.desc()).limit(limit)
        return list(self.session.scalars(query).all())

    def unread_count(self, owner_id: str) -> int:
        query = (
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.owner_id == owner_id,
                Notification.read.is_(False),
            )
        )
        return int(self.session.scalar(query) or 0)

    def mark_read(self, owner_id: str, notification_ids: Optional[List[str]]) -> int:
        criteria = [Notification.owner_id == owner_id, Notification.read.is_(False)]
        if notification_ids is not None:
            if not notification_ids:
                return 0
            criteria.append(Notification.id.in_(notification_ids))
        statement = update(Notification).where(*criteria).values(read=True)
        result = self.session.execute(statement)
        self.session.flush()
        return int(result.rowcount or 0)


class FeedbackRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, submission: FeedbackSubmission) -> None:
        self.session.add(submission)
        self.session.flush()

    def add_overall(self, submission: OverallFeedbackSubmission) -> None:
        self.session.add(submission)
        self.session.flush()


class BlogRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_published(self) -> List[BlogPost]:
        query = (
            select(BlogPost)
            .where(BlogPost.status == "published")
            .order_by(
                BlogPost.featured.desc(),
                BlogPost.published_at.desc(),
                BlogPost.created_at.desc(),
                BlogPost.slug,
            )
        )
        return list(self.session.scalars(query).all())

    def list_all(self) -> List[BlogPost]:
        query = select(BlogPost).order_by(
            BlogPost.featured.desc(),
            BlogPost.updated_at.desc(),
            BlogPost.slug,
        )
        return list(self.session.scalars(query).all())

    def get(self, post_id: str) -> Optional[BlogPost]:
        return self.session.get(BlogPost, post_id)

    def by_slug(self, slug: str) -> Optional[BlogPost]:
        return self.session.scalar(select(BlogPost).where(BlogPost.slug == slug))

    def published_by_slug(self, slug: str) -> Optional[BlogPost]:
        return self.session.scalar(
            select(BlogPost).where(
                BlogPost.slug == slug,
                BlogPost.status == "published",
            )
        )

    def add(self, post: BlogPost) -> BlogPost:
        self.session.add(post)
        self.session.flush()
        return post

    def clear_featured(self, except_post_id: Optional[str] = None) -> None:
        query = update(BlogPost).where(BlogPost.featured.is_(True))
        if except_post_id:
            query = query.where(BlogPost.id != except_post_id)
        self.session.execute(query.values(featured=False))
        self.session.flush()
