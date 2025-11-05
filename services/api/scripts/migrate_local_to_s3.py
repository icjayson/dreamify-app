"""
Migration script to move local file-storage files to S3.
"""
import os
import sys
import json
import uuid
import logging
from pathlib import Path

# Add parent directory to path
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
sys.path.insert(0, project_root)

from utils.config import config
from utils.s3.client import upload_bytes, object_exists, compute_sha256_checksum
from utils.s3.paths import build_asset_key, build_metadata_key
from utils.postgres.db import SessionLocal, engine
from utils.postgres.models import Base
from utils.postgres.repos import users, projects, assets, files as files_repo
import pandas as pd

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def migrate_local_to_s3():
    """Migrate all files from local file-storage to S3."""
    # Ensure database tables exist
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    try:
        # Paths
        metadata_dir = Path("file-storage/metadata/uploads")
        uploads_dir = Path("file-storage/uploads")
        
        if not metadata_dir.exists():
            logger.warning(f"Metadata directory not found: {metadata_dir}")
            return
        
        if not uploads_dir.exists():
            logger.warning(f"Uploads directory not found: {uploads_dir}")
            return
        
        # Get or create system user for unknown files
        system_user_id = "system_migration"
        system_user = users.get_or_create_user_by_clerk_id(
            db=db,
            clerk_user_id=system_user_id,
            email="migration@system.local",
            name="System Migration User"
        )
        
        # Get or create default project for migration
        migration_projects = projects.get_projects_for_user(db, system_user_id)
        if migration_projects:
            migration_project = migration_projects[0]
        else:
            migration_project = projects.create_project(
                db=db,
                user_id=system_user_id,
                name="Migrated Files",
                description="Files migrated from local storage"
            )
        
        # Process each metadata file
        metadata_files = list(metadata_dir.glob("*.json"))
        logger.info(f"Found {len(metadata_files)} metadata files to migrate")
        
        migrated_count = 0
        skipped_count = 0
        error_count = 0
        
        for metadata_file in metadata_files:
            try:
                # Read metadata
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                file_id = metadata.get('fileID')
                if not file_id:
                    logger.warning(f"Metadata file missing fileID: {metadata_file}")
                    skipped_count += 1
                    continue
                
                ext = metadata.get('ext', 'csv')
                filename = metadata.get('filename', file_id)
                
                # Check if already migrated (check database)
                try:
                    existing_file = files_repo.get_file(db, uuid.UUID(file_id))
                    if existing_file:
                        logger.info(f"File {file_id} already exists in database, skipping")
                        skipped_count += 1
                        continue
                except (ValueError, Exception):
                    pass  # File ID might not be UUID, continue with migration
                
                # Find local file
                local_file_path = uploads_dir / f"{file_id}.{ext}"
                if not local_file_path.exists():
                    logger.warning(f"Local file not found: {local_file_path}")
                    skipped_count += 1
                    continue
                
                # Read file content
                with open(local_file_path, 'rb') as f:
                    file_content = f.read()
                
                file_size = len(file_content)
                
                # Generate new IDs for asset and file
                asset_id = str(uuid.uuid4())
                new_file_id = str(uuid.uuid4())
                
                # Build S3 keys
                s3_bucket = config.aws.s3.USER_ASSETS_BUCKET
                version = config.aws.s3.USER_ASSETS_BUCKET_VERSION
                
                asset_key = build_asset_key(
                    version=version,
                    user_id=system_user_id,
                    project_id=str(migration_project.id),
                    asset_id=asset_id,
                    file_id=new_file_id,
                    extension=ext
                )
                
                # Check if already in S3
                if object_exists(s3_bucket, asset_key):
                    logger.info(f"File already in S3: {asset_key}")
                    skipped_count += 1
                    continue
                
                # Determine content type
                content_type_map = {
                    'csv': 'text/csv',
                    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'xls': 'application/vnd.ms-excel',
                    'json': 'application/json'
                }
                content_type = content_type_map.get(ext, 'application/octet-stream')
                
                # Compute checksum
                checksum = compute_sha256_checksum(file_content)
                
                # Upload to S3
                logger.info(f"Uploading {filename} to S3: {asset_key}")
                upload_bytes(
                    bucket=s3_bucket,
                    key=asset_key,
                    data=file_content,
                    content_type=content_type
                )
                
                # Create asset record
                asset = assets.create_asset(
                    db=db,
                    project_id=migration_project.id,
                    user_id=system_user_id,
                    s3_bucket=s3_bucket,
                    s3_key=asset_key,
                    version=version,
                    content_type=content_type,
                    size_bytes=file_size,
                    checksum_sha256=checksum,
                    status="uploaded"
                )
                
                # Create file record
                file_record = files_repo.create_file(
                    db=db,
                    asset_id=asset.id,
                    original_filename=filename,
                    extension=ext,
                    file_metadata=metadata,
                    rows=None,
                    columns=None
                )
                
                migrated_count += 1
                logger.info(f"Migrated file {file_id} -> {new_file_id}")
                
            except Exception as e:
                logger.error(f"Error migrating {metadata_file}: {str(e)}")
                error_count += 1
                continue
        
        logger.info(f"Migration complete:")
        logger.info(f"  Migrated: {migrated_count}")
        logger.info(f"  Skipped: {skipped_count}")
        logger.info(f"  Errors: {error_count}")
        
    finally:
        db.close()


if __name__ == "__main__":
    migrate_local_to_s3()

