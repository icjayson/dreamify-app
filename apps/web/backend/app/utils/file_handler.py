"""
File handling utilities for Vibe Analytics Studio.
"""

import pandas as pd
import os
from typing import Dict, Any, Optional
from werkzeug.utils import secure_filename

class FileHandler:
    """Utility class for handling file uploads and processing."""
    
    ALLOWED_EXTENSIONS = {'csv', 'xlsx', 'xls', 'json'}
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
    
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
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)  # Reset file pointer
        
        if file_size > FileHandler.MAX_FILE_SIZE:
            raise ValueError(f"File too large. Maximum size: {FileHandler.MAX_FILE_SIZE // (1024*1024)}MB")
        
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
