"""
File handling utilities for Dreamify.
"""

import pandas as pd
import os
import json
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List
from werkzeug.utils import secure_filename
from utils.config import get_settings

settings = get_settings()

class FileHandler:
    """Utility class for handling file uploads and processing."""
    
    ALLOWED_EXTENSIONS = {'csv', 'xlsx', 'xls', 'json'}
    
    @staticmethod
    def allowed_file(filename: str) -> bool:
        """Check if the file extension is allowed."""
        return '.' in filename and \
               filename.rsplit('.', 1)[1].lower() in FileHandler.ALLOWED_EXTENSIONS
    
    @staticmethod
    def validate_file(file) -> Dict[str, Any]:
        """Validate uploaded file."""
        if not file:
            raise ValueError("No file provided")
        
        if file.filename == '':
            raise ValueError("No file selected")
        
        if not FileHandler.allowed_file(file.filename):
            raise ValueError(f"File type not allowed. Allowed types: {', '.join(FileHandler.ALLOWED_EXTENSIONS)}")
        
        # Get file size for metadata (supports FastAPI UploadFile)
        try:
            # Prefer underlying file-like object if present (FastAPI UploadFile)
            raw_file = getattr(file, 'file', None) or file
            # Move to end, read position, then reset
            raw_file.seek(0, os.SEEK_END)
            file_size = raw_file.tell()
            raw_file.seek(0)
        except Exception:
            # Fallback: unknown size
            file_size = 0
        
        return {
            'filename': secure_filename(file.filename),
            'size': file_size,
            'extension': file.filename.rsplit('.', 1)[1].lower()
        }
    
    @staticmethod
    def read_file(file, file_info: Dict[str, Any]) -> pd.DataFrame:
        """Read file and return pandas DataFrame."""
        try:
            extension = file_info['extension']
            
            if extension == 'csv':
                return pd.read_csv(file)
            elif extension in ['xlsx', 'xls']:
                return pd.read_excel(file)
            elif extension == 'json':
                return pd.read_json(file)
            else:
                raise ValueError(f"Unsupported file type: {extension}")
                
        except Exception as e:
            raise Exception(f"Error reading file: {str(e)}")
    
    @staticmethod
    def get_file_summary(data: pd.DataFrame, filename: str) -> Dict[str, Any]:
        """Generate a summary of the uploaded file."""
        try:
            summary = {
                'filename': filename,
                'rows': len(data),
                'columns': len(data.columns),
                'column_names': data.columns.tolist(),
                'data_types': data.dtypes.to_dict(),
                'missing_values': data.isnull().sum().to_dict(),
                'memory_usage': data.memory_usage(deep=True).sum(),
                'file_size_mb': data.memory_usage(deep=True).sum() / (1024 * 1024)
            }
            
            # Add sample data (first 5 rows)
            summary['sample_data'] = data.head().to_dict('records')
            
            return summary
        except Exception as e:
            raise Exception(f"Error generating file summary: {str(e)}")

    # -------- Storage Manager Utilities (Phase 1) --------
    @staticmethod
    def generate_file_id() -> str:
        """Generate a UUID v4 string for file identification."""
        return str(uuid.uuid4())

    @staticmethod
    def get_upload_path(fileID: str, ext: str) -> str:
        """
        DEPRECATED: Get absolute path for the uploaded file based on configured storage dir.
        Local file storage is no longer used. Files are stored in S3.
        """
        import warnings
        warnings.warn(
            "get_upload_path is deprecated. Local file storage is no longer used. Files are stored in S3.",
            DeprecationWarning,
            stacklevel=2
        )
        filename = f"{fileID}.{ext}"
        return os.path.join(settings.FILE_UPLOADS_DIR, filename)

    @staticmethod
    def _get_upload_metadata_path(fileID: str) -> str:
        """
        DEPRECATED: Local metadata storage is no longer used. Metadata is stored in database.
        """
        import warnings
        warnings.warn(
            "_get_upload_metadata_path is deprecated. Local metadata storage is no longer used.",
            DeprecationWarning,
            stacklevel=2
        )
        return os.path.join(settings.FILE_METADATA_UPLOADS_DIR, f"{fileID}.json")

    @staticmethod
    def save_upload_metadata(fileID: str, metadata: Dict[str, Any]) -> None:
        """
        DEPRECATED: Persist upload metadata as JSON under metadata/uploads/<fileID>.json.
        Local metadata storage is no longer used. Metadata is stored in database.
        """
        import warnings
        warnings.warn(
            "save_upload_metadata is deprecated. Local metadata storage is no longer used. Metadata is stored in database.",
            DeprecationWarning,
            stacklevel=2
        )
        path = FileHandler._get_upload_metadata_path(fileID)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    @staticmethod
    def get_upload_metadata(fileID: str) -> Dict[str, Any]:
        """
        DEPRECATED: Load metadata for a given fileID.
        Local metadata storage is no longer used. Metadata is stored in database.
        """
        import warnings
        warnings.warn(
            "get_upload_metadata is deprecated. Local metadata storage is no longer used. Metadata is stored in database.",
            DeprecationWarning,
            stacklevel=2
        )
        path = FileHandler._get_upload_metadata_path(fileID)
        if not os.path.exists(path):
            raise FileNotFoundError("File not found")
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)

    @staticmethod
    def list_uploads() -> List[Dict[str, Any]]:
        """
        DEPRECATED: List all uploads based on metadata files.
        Local metadata storage is no longer used. Use database queries instead.
        """
        import warnings
        warnings.warn(
            "list_uploads is deprecated. Local metadata storage is no longer used. Use database queries instead.",
            DeprecationWarning,
            stacklevel=2
        )
        uploads: List[Dict[str, Any]] = []
        directory = settings.FILE_METADATA_UPLOADS_DIR
        if not os.path.isdir(directory):
            return uploads
        for name in os.listdir(directory):
            if not name.endswith('.json'):
                continue
            path = os.path.join(directory, name)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    uploads.append({
                        'fileID': data.get('fileID'),
                        'filename': data.get('filename'),
                        'ext': data.get('ext'),
                        'size': data.get('size'),
                        'created_at': data.get('created_at'),
                    })
            except Exception:
                # Skip corrupt metadata files
                continue
        return uploads

    @staticmethod
    def delete_upload_set(fileID: str) -> bool:
        """
        DEPRECATED: Delete the uploaded file and its metadata. Return True if any file was removed.
        Local file storage is no longer used. Files are stored in S3.
        """
        import warnings
        warnings.warn(
            "delete_upload_set is deprecated. Local file storage is no longer used. Files are stored in S3.",
            DeprecationWarning,
            stacklevel=2
        )
        removed_any = False
        # Remove file
        try:
            meta = FileHandler.get_upload_metadata(fileID)
            ext = meta.get('ext')
            upload_path = FileHandler.get_upload_path(fileID, ext)
            if os.path.exists(upload_path):
                os.remove(upload_path)
                removed_any = True
        except FileNotFoundError:
            pass

        # Remove metadata
        meta_path = FileHandler._get_upload_metadata_path(fileID)
        if os.path.exists(meta_path):
            os.remove(meta_path)
            removed_any = True

        return removed_any
