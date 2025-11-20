"""
FastAPI Files routes for upload, listing, deletion, and preview with S3 and database.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Path, Depends, Form, Body
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from app.utils.file_handler import FileHandler
from app.dependencies.auth import require_user
from utils.postgres.db import get_db
from utils.postgres.repos import users, projects, assets, files as files_repo
from utils.postgres.models import User
from utils.s3.client import upload_bytes, download_bytes, delete_object, compute_sha256_checksum
from utils.s3.paths import build_asset_key, build_metadata_key
from utils.config import config
import uuid
import json
import pandas as pd
import logging
from typing import Dict, Any, Optional
from pydantic import BaseModel

# Create router
router = APIRouter()

logger = logging.getLogger(__name__)


def get_or_create_default_project(db: Session, user_id: str):
    """Get or create a default project for the user."""
    user_projects = projects.get_projects_for_user(db, user_id)
    
    # If user has projects, return the first one
    if user_projects:
        return user_projects[0]
    
    # Create a default project
    default_project = projects.create_project(
        db=db,
        user_id=user_id,
        name="Default Project",
        description="Default project for file uploads"
    )
    return default_project


@router.post("/upload", tags=["files"])
async def upload_file(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    clerk_user_id: str = Depends(require_user)
):
    """Upload a file for processing. Saves to S3 and stores metadata in database."""
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file selected")

        # Validate type and size using existing utility
        info = FileHandler.validate_file(file)

        # Read file content
        file_content = await file.read()
        file_size = len(file_content)
        
        # Generate IDs
        file_id = str(uuid.uuid4())
        asset_id = str(uuid.uuid4())
        ext = info['extension']
        
        # Ensure user exists in database before creating project
        # This prevents foreign key constraint violations
        # Create user if not exists, ensuring it's committed before project creation
        try:
            # Check if user exists first
            existing_user = users.get_user(db, clerk_user_id)
            if not existing_user:
                # User doesn't exist, create it
                new_user = User(
                    id=clerk_user_id,
                    email="",  # Can be updated later from Clerk
                    name=None,
                    image_url=None
                )
                db.add(new_user)
                db.commit()  # Commit user creation before creating project
                db.refresh(new_user)
                logger.info(f"Created new user: {clerk_user_id}")
            else:
                logger.info(f"User already exists: {clerk_user_id}")
        except Exception as e:
            db.rollback()  # Rollback on error
            logger.error(f"Failed to get or create user: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to create user: {str(e)}")
        
        # Get or create project
        if project_id:
            try:
                project = projects.get_project_by_id(db, uuid.UUID(project_id))
                if not project or project.user_id != clerk_user_id:
                    raise HTTPException(status_code=403, detail="Project not found or access denied")
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid project ID")
        else:
            project = get_or_create_default_project(db, clerk_user_id)
        
        # Build S3 keys
        s3_bucket = config.aws.s3.USER_ASSETS_BUCKET
        version = config.aws.s3.USER_ASSETS_BUCKET_VERSION
        
        asset_key = build_asset_key(
            version=version,
            user_id=clerk_user_id,
            project_id=str(project.id),
            asset_id=asset_id,
            file_id=file_id,
            extension=ext
        )
        
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
        upload_bytes(
            bucket=s3_bucket,
            key=asset_key,
            data=file_content,
            content_type=content_type
        )
        
        # Create asset record
        asset = assets.create_asset(
            db=db,
            project_id=project.id,
            user_id=clerk_user_id,
            s3_bucket=s3_bucket,
            s3_key=asset_key,
            version=version,
            content_type=content_type,
            size_bytes=file_size,
            checksum_sha256=checksum,
            status="uploaded"
        )
        
        # Prepare metadata
        metadata = {
            'fileID': file_id,
            'filename': info['filename'],
            'ext': ext,
            'size': file_size,
            'created_at': pd.Timestamp.utcnow().isoformat(),
        }
        
        # Create file record
        file_uuid = uuid.UUID(file_id)
        logger.info(f"Creating file record with file_id: {file_id} (UUID: {file_uuid})")
        file_record = files_repo.create_file(
            db=db,
            asset_id=asset.id,
            original_filename=info['filename'],
            extension=ext,
            file_metadata=metadata,
            rows=None,  # Will be populated after processing
            columns=None,
            processed_json_s3_key=None,
            file_id=file_uuid
        )
        logger.info(f"File record created successfully with id: {file_record.id}")
        
        # Verify file can be retrieved immediately
        verify_file = files_repo.get_file(db, file_uuid)
        if not verify_file:
            logger.error(f"File record not found immediately after creation! file_id: {file_id}")
            raise HTTPException(status_code=500, detail="File record creation failed")
        logger.info(f"File record verified: {verify_file.id}")
        
        # Return response in legacy format for backward compatibility
        return {
            'success': True,
            'fileID': file_id,
            'filename': info['filename'],
            'size': file_size,
            'ext': ext,
        }

    except ValueError as e:
        logger.error(f"Validation error in upload_file: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in upload_file: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("", tags=["files"])
async def list_files(
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    clerk_user_id: str = Depends(require_user)
):
    """List all uploaded files for the current user."""
    try:
        # Ensure user exists in database
        users.get_or_create_user_by_clerk_id(db, clerk_user_id)
        
        # If project_id provided, filter by project
        if project_id:
            try:
                project = projects.get_project_by_id(db, uuid.UUID(project_id))
                if not project or project.user_id != clerk_user_id:
                    raise HTTPException(status_code=403, detail="Project not found or access denied")
                project_assets = assets.list_assets_for_project(db, project.id)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid project ID")
        else:
            # Get all projects for user and collect assets
            user_projects = projects.get_projects_for_user(db, clerk_user_id)
            project_assets = []
            for project in user_projects:
                project_assets.extend(assets.list_assets_for_project(db, project.id))
        
        # Convert to response format
        files_list = []
        for asset in project_assets:
            asset_files = files_repo.list_files_for_asset(db, asset.id)
            for file_record in asset_files:
                files_list.append({
                    'fileID': str(file_record.id),
                    'filename': file_record.original_filename,
                    'ext': file_record.extension,
                    'size': asset.size_bytes,
                    'created_at': asset.created_at.isoformat() if asset.created_at else None,
                })
        
        return {'success': True, 'files': files_list}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in list_files: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class ProcessedKeyUpdate(BaseModel):
    processed_json_s3_key: str

@router.put("/{fileID}/processed-key", tags=["files"])
async def update_processed_key(
    fileID: str = Path(..., description="File ID"),
    update_data: ProcessedKeyUpdate = Body(...),
    db: Session = Depends(get_db)
):
    """Update the processed_json_s3_key for a file record. Internal service endpoint."""
    try:
        # Get file record
        try:
            file_uuid = uuid.UUID(fileID)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid file ID")
        
        file_record = files_repo.get_file(db, file_uuid)
        if not file_record:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Update file record
        files_repo.update_file(
            db=db,
            file_id=file_uuid,
            processed_json_s3_key=update_data.processed_json_s3_key
        )
        
        return {'success': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in update_processed_key: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{fileID}", tags=["files"])
async def delete_file(
    fileID: str = Path(..., description="File ID"),
    db: Session = Depends(get_db),
    clerk_user_id: str = Depends(require_user)
):
    """Delete an uploaded file from S3 and database."""
    try:
        # Get file record
        try:
            file_uuid = uuid.UUID(fileID)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid file ID")
        
        file_record = files_repo.get_file(db, file_uuid)
        if not file_record:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Get asset
        asset = assets.get_asset(db, file_record.asset_id)
        if not asset or asset.user_id != clerk_user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Delete from S3
        try:
            delete_object(asset.s3_bucket, asset.s3_key)
        except Exception as e:
            logger.warning(f"Failed to delete S3 object: {str(e)}")
        
        # Delete file record (cascade will handle asset if needed)
        files_repo.delete_file(db, file_uuid)
        
        return {'success': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in delete_file: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

def _render_html_table_from_dataframe(df: pd.DataFrame, title: str) -> str:
    """Render HTML table from DataFrame."""
    # Limit to first 20 rows
    df = df.head(20)
    table_html = df.to_html(classes='table table-sm', index=False, border=0)
    html = f"""
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Preview - {title}</title>
    <style>
      body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, sans-serif; padding: 16px; }}
      .table {{ border-collapse: collapse; width: 100%; }}
      .table th, .table td {{ border: 1px solid #e5e7eb; padding: 8px; text-align: left; }}
      .table th {{ background: #f9fafb; }}
      caption {{ text-align: left; margin-bottom: 8px; font-weight: 600; }}
    </style>
  </head>
  <body>
    <h3>Preview: {title}</h3>
    {table_html}
  </body>
</html>
"""
    return html

@router.get("/preview/{fileID}", response_class=HTMLResponse, tags=["files"])
async def preview_file(
    fileID: str = Path(..., description="File ID"),
    db: Session = Depends(get_db),
    clerk_user_id: str = Depends(require_user)
):
    """Preview an uploaded file as HTML. Fetches from S3."""
    try:
        # Get file record
        try:
            file_uuid = uuid.UUID(fileID)
        except ValueError:
            return HTMLResponse("<h3>Invalid file ID</h3>", status_code=400)
        
        file_record = files_repo.get_file(db, file_uuid)
        if not file_record:
            return HTMLResponse("<h3>File not found</h3>", status_code=404)
        
        # Get asset
        asset = assets.get_asset(db, file_record.asset_id)
        if not asset or asset.user_id != clerk_user_id:
            return HTMLResponse("<h3>Access denied</h3>", status_code=403)
        
        filename = file_record.original_filename
        ext = file_record.extension
        
        # Download from S3
        try:
            file_content = download_bytes(asset.s3_bucket, asset.s3_key)
        except FileNotFoundError:
            return HTMLResponse("<h3>File not found in storage</h3>", status_code=404)
        
        # Render HTML preview
        if ext == 'csv':
            import io
            df = pd.read_csv(io.BytesIO(file_content))
            html = _render_html_table_from_dataframe(df, filename)
        elif ext in ['xlsx', 'xls']:
            import io
            df = pd.read_excel(io.BytesIO(file_content))
            html = _render_html_table_from_dataframe(df, filename)
        elif ext == 'json':
            try:
                import io
                data = json.loads(file_content.decode('utf-8'))
                # Convert to DataFrame sensibly
                if isinstance(data, list):
                    df = pd.DataFrame(data)
                elif isinstance(data, dict):
                    # If dict of lists, DataFrame will expand; else show key/value pairs
                    try:
                        df = pd.DataFrame(data)
                        if df.empty:
                            df = pd.DataFrame(list(data.items()), columns=['key', 'value'])
                    except Exception:
                        df = pd.DataFrame(list(data.items()), columns=['key', 'value'])
                else:
                    df = pd.DataFrame({'value': [str(data)]})
                html = _render_html_table_from_dataframe(df, filename)
            except Exception as e:
                return HTMLResponse(f"<h3>Error reading JSON: {str(e)}</h3>", status_code=400)
        else:
            return HTMLResponse("<h3>Invalid file type. Supported: CSV, XLSX, XLS, JSON</h3>", status_code=400)

        return HTMLResponse(html, status_code=200)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in preview_file: {str(e)}")
        return HTMLResponse(f"<h3>Error generating preview: {str(e)}</h3>", status_code=500)
