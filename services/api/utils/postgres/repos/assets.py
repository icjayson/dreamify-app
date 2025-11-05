"""
Asset repository functions.
"""
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
from utils.postgres.models import Asset


def create_asset(
    db: Session,
    project_id: uuid.UUID,
    user_id: str,
    s3_bucket: str,
    s3_key: str,
    version: str,
    content_type: Optional[str] = None,
    size_bytes: int = 0,
    checksum_sha256: Optional[str] = None,
    status: str = "uploaded"
) -> Asset:
    """Create a new asset."""
    asset = Asset(
        id=uuid.uuid4(),
        project_id=project_id,
        user_id=user_id,
        s3_bucket=s3_bucket,
        s3_key=s3_key,
        version=version,
        content_type=content_type,
        size_bytes=size_bytes,
        checksum_sha256=checksum_sha256,
        status=status
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


def get_asset(db: Session, asset_id: uuid.UUID) -> Optional[Asset]:
    """Get asset by ID."""
    return db.query(Asset).filter(Asset.id == asset_id).first()


def list_assets_for_project(db: Session, project_id: uuid.UUID) -> List[Asset]:
    """List all assets for a project."""
    return db.query(Asset).filter(Asset.project_id == project_id).all()


def update_asset_status(
    db: Session,
    asset_id: uuid.UUID,
    status: str
) -> Optional[Asset]:
    """Update asset status."""
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        return None
    
    asset.status = status
    db.commit()
    db.refresh(asset)
    return asset


def delete_asset(db: Session, asset_id: uuid.UUID) -> bool:
    """Delete an asset."""
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        return False
    
    db.delete(asset)
    db.commit()
    return True

