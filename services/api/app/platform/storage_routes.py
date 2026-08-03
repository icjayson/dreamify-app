"""Service-authenticated maintenance routes with bounded work per invocation."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.platform.auth import require_internal_service
from app.platform.database import get_session
from app.platform.routes import get_storage
from app.platform.storage import ObjectStorage
from app.platform.storage_cleanup import StorageCleanupService

router = APIRouter(
    prefix="/api/v1/internal/storage",
    tags=["internal-storage"],
    dependencies=[Depends(require_internal_service)],
)


@router.post("/cleanup")
def cleanup_storage(
    limit: int = Query(default=25, ge=1, le=100),
    session: Session = Depends(get_session),
    storage: ObjectStorage = Depends(get_storage),
):
    return StorageCleanupService(session, storage).run(limit)
