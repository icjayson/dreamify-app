"""
Notification endpoints — in-app notification bell.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import require_user
from utils.dynamodb.repos import notifications as notifications_repo

logger = logging.getLogger(__name__)
router = APIRouter(tags=["notifications"])


class NotificationResponse(BaseModel):
    notification_id: str
    type: str
    title: str
    body: str
    read: bool
    created_at: str
    schedule_id: Optional[str] = None
    run_id: Optional[str] = None
    provider: Optional[str] = None
    asset_id: Optional[str] = None
    project_id: Optional[str] = None


class NotificationsListResponse(BaseModel):
    notifications: List[NotificationResponse]
    unread_count: int


class MarkReadRequest(BaseModel):
    notification_ids: Optional[List[str]] = None  # None = mark all


@router.get("/notifications", response_model=NotificationsListResponse)
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    unread_only: bool = Query(default=False),
    user_id: str = Depends(require_user),
) -> NotificationsListResponse:
    """Return recent notifications for the authenticated user."""
    items = notifications_repo.list_notifications(
        user_id=user_id,
        limit=limit,
        unread_only=unread_only,
    )
    unread_count = sum(1 for n in items if not n.get("read", False))
    return NotificationsListResponse(
        notifications=[NotificationResponse(**n) for n in items],
        unread_count=unread_count,
    )


@router.post("/notifications/mark-read")
async def mark_notifications_read(
    body: MarkReadRequest,
    user_id: str = Depends(require_user),
) -> dict:
    """Mark specific notifications (or all) as read."""
    if body.notification_ids:
        for nid in body.notification_ids:
            notifications_repo.mark_read(user_id, nid)
        count = len(body.notification_ids)
    else:
        count = notifications_repo.mark_all_read(user_id)
    return {"marked_read": count}
