"""
FastAPI Files routes for upload, listing, deletion, and preview (Phase 1).
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Path
from fastapi.responses import HTMLResponse
from app.utils.file_handler import FileHandler
from config.settings import settings
import os
import json
import pandas as pd
import logging

# Create router
router = APIRouter()

logger = logging.getLogger(__name__)

@router.post("/upload", tags=["files"])
async def upload_file(file: UploadFile = File(...)):
    """Upload a file for processing."""
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file selected")

        # Validate type and size using existing utility
        info = FileHandler.validate_file(file)

        fileID = FileHandler.generate_file_id()
        logger.info(f"File ID: {fileID}")
        ext = info['extension']
        upload_path = FileHandler.get_upload_path(fileID, ext)

        # Persist file to storage
        file_content = await file.read()
        with open(upload_path, 'wb') as f:
            f.write(file_content)

        metadata = {
            'fileID': fileID,
            'filename': info['filename'],
            'ext': ext,
            'size': info['size'],
            'created_at': pd.Timestamp.utcnow().isoformat(),
        }
        FileHandler.save_upload_metadata(fileID, metadata)

        return {
            'success': True,
            'fileID': fileID,
            'filename': info['filename'],
            'size': info['size'],
            'ext': ext,
        }

    except ValueError as e:
        logger.error(f"Validation error in upload_file: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in upload_file: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("", tags=["files"])
async def list_files():
    """List all uploaded files."""
    try:
        files = FileHandler.list_uploads()
        return {'success': True, 'files': files}
    except Exception as e:
        logger.error(f"Error in list_files: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{fileID}", tags=["files"])
async def delete_file(fileID: str = Path(..., description="File ID")):
    """Delete an uploaded file."""
    try:
        deleted = FileHandler.delete_upload_set(fileID)
        if not deleted:
            raise HTTPException(status_code=404, detail="File not found")
        return {'success': True}
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
async def preview_file(fileID: str = Path(..., description="File ID")):
    """Preview an uploaded file as HTML."""
    try:
        try:
            meta = FileHandler.get_upload_metadata(fileID)
        except FileNotFoundError:
            return HTMLResponse("<h3>File not found</h3>", status_code=404)

        ext = meta.get('ext')
        filename = meta.get('filename', fileID)
        path = FileHandler.get_upload_path(fileID, ext)
        if not os.path.exists(path):
            return HTMLResponse("<h3>File not found</h3>", status_code=404)

        # Render HTML preview
        if ext == 'csv':
            df = pd.read_csv(path)
            html = _render_html_table_from_dataframe(df, filename)
        elif ext in ['xlsx', 'xls']:
            df = pd.read_excel(path)
            html = _render_html_table_from_dataframe(df, filename)
        elif ext == 'json':
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
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
    except Exception as e:
        logger.error(f"Error in preview_file: {str(e)}")
        return HTMLResponse(f"<h3>Error generating preview: {str(e)}</h3>", status_code=500)
