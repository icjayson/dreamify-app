"""
File repository functions.
"""
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
import uuid
from utils.postgres.models import File


def create_file(
    db: Session,
    asset_id: uuid.UUID,
    original_filename: str,
    extension: str,
    file_metadata: Optional[Dict[str, Any]] = None,
    rows: Optional[int] = None,
    columns: Optional[int] = None,
    processed_json_s3_key: Optional[str] = None,
    file_id: Optional[uuid.UUID] = None,
) -> File:
    """Create a new file. If file_id is provided, use it as the primary key."""
    file = File(
        id=file_id or uuid.uuid4(),
        asset_id=asset_id,
        original_filename=original_filename,
        extension=extension,
        file_metadata=file_metadata,
        rows=rows,
        columns=columns,
        processed_json_s3_key=processed_json_s3_key
    )
    db.add(file)
    db.commit()
    db.refresh(file)
    return file


def get_file(db: Session, file_id: uuid.UUID) -> Optional[File]:
    """Get file by ID."""
    return db.query(File).filter(File.id == file_id).first()


def list_files_for_asset(db: Session, asset_id: uuid.UUID) -> List[File]:
    """List all files for an asset."""
    return db.query(File).filter(File.asset_id == asset_id).all()


def update_file(
    db: Session,
    file_id: uuid.UUID,
    file_metadata: Optional[Dict[str, Any]] = None,
    rows: Optional[int] = None,
    columns: Optional[int] = None,
    processed_json_s3_key: Optional[str] = None
) -> Optional[File]:
    """Update a file."""
    file = db.query(File).filter(File.id == file_id).first()
    if not file:
        return None
    
    if file_metadata:
        file.file_metadata = file_metadata
    if rows is not None:
        file.rows = rows
    if columns is not None:
        file.columns = columns
    if processed_json_s3_key:
        file.processed_json_s3_key = processed_json_s3_key
    
    db.commit()
    db.refresh(file)
    return file


def delete_file(db: Session, file_id: uuid.UUID) -> bool:
    """Delete a file."""
    file = db.query(File).filter(File.id == file_id).first()
    if not file:
        return False
    
    db.delete(file)
    db.commit()
    return True

