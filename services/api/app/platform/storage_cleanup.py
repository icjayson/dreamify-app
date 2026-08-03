"""Bounded, idempotent cleanup for expired uploads and unreferenced objects."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.platform.models import (
    Asset,
    StoredObject,
    UploadReservation,
    WorkflowArtifact,
    WorkflowEvent,
    WorkflowRunAsset,
    utc_now,
)
from app.platform.storage import ObjectStorage


@dataclass
class CleanupResult:
    expired_reservations: int = 0
    deleted_assets: int = 0
    deleted_objects: int = 0
    storage_failures: int = 0


class StorageCleanupService:
    def __init__(self, session: Session, storage: ObjectStorage):
        self.session = session
        self.storage = storage

    def run(self, limit: int) -> dict[str, int]:
        result = CleanupResult()
        self._expire_reservations(limit, result)
        self._delete_soft_deleted_assets(limit, result)
        self.session.flush()
        self._delete_orphaned_objects(limit, result)
        self.session.flush()
        return asdict(result)

    def _expire_reservations(self, limit: int, result: CleanupResult) -> None:
        query = (
            select(UploadReservation)
            .where(
                UploadReservation.status.in_(("pending", "uploaded")),
                UploadReservation.expires_at <= utc_now(),
            )
            .order_by(UploadReservation.expires_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        for reservation in self.session.scalars(query):
            reservation.status = "expired"
            result.expired_reservations += 1
            if not self._delete_storage(reservation.pathname):
                result.storage_failures += 1

    def _delete_soft_deleted_assets(self, limit: int, result: CleanupResult) -> None:
        linked = exists().where(WorkflowRunAsset.asset_id == Asset.id)
        query = (
            select(Asset)
            .where(Asset.status == "deleted", ~linked)
            .order_by(Asset.updated_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        for asset in self.session.scalars(query):
            self.session.delete(asset)
            result.deleted_assets += 1

    def _delete_orphaned_objects(self, limit: int, result: CleanupResult) -> None:
        asset_ref = exists().where(Asset.stored_object_id == StoredObject.id)
        artifact_ref = exists().where(
            WorkflowArtifact.stored_object_id == StoredObject.id
        )
        event_ref = exists().where(WorkflowEvent.payload_object_id == StoredObject.id)
        query = (
            select(StoredObject)
            .where(~asset_ref, ~artifact_ref, ~event_ref)
            .order_by(StoredObject.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        for stored in self.session.scalars(query):
            if self._delete_storage(stored.pathname):
                self.session.delete(stored)
                result.deleted_objects += 1
            else:
                result.storage_failures += 1

    def _delete_storage(self, pathname: str) -> bool:
        try:
            self.storage.delete(pathname)
        except Exception:
            return False
        return True
