"""
Analyze API routes for file processing (Phase 2).
"""

from flask import Blueprint, request, jsonify
from app.services.llm_service import LLMService
from app.utils.file_handler import FileHandler
from config.settings import settings
import os
import json
import threading
import time


analyze_bp = Blueprint('analyze', __name__)
llm_service = LLMService()


def _process_file_background(fileID: str, file_metadata: dict):
    """Background processing function."""
    try:
        # Process file with LLM service
        processed_data = llm_service.process_file(fileID, file_metadata)
        
        # Save processed data to file-storage/processed/<fileID>.json
        processed_path = os.path.join(settings.FILE_PROCESSED_DIR, f"{fileID}.json")
        with open(processed_path, 'w', encoding='utf-8') as f:
            json.dump(processed_data, f, ensure_ascii=False, indent=2)
            
        print(f"Background processing completed for fileID: {fileID}")
    except Exception as e:
        print(f"Background processing failed for fileID {fileID}: {str(e)}")
        # Save error status
        error_data = {
            "fileID": fileID,
            "status": "error",
            "error": str(e),
            "processed_at": time.time()
        }
        processed_path = os.path.join(settings.FILE_PROCESSED_DIR, f"{fileID}.json")
        with open(processed_path, 'w', encoding='utf-8') as f:
            json.dump(error_data, f, ensure_ascii=False, indent=2)


@analyze_bp.route('/run', methods=['POST'])
def run_analysis():
    """Start file processing analysis."""
    try:
        data = request.get_json()
        if not data or 'fileID' not in data:
            return jsonify({'success': False, 'error': 'fileID is required'}), 400
        
        fileID = data['fileID']
        
        # Check if already processed
        processed_path = os.path.join(settings.FILE_PROCESSED_DIR, f"{fileID}.json")
        if os.path.exists(processed_path):
            return jsonify({
                'success': True,
                'fileID': fileID,
                'status': 'completed',
                'message': 'File already processed'
            }), 200
        
        # Load file metadata
        try:
            file_metadata = FileHandler.get_upload_metadata(fileID)
        except FileNotFoundError:
            return jsonify({'success': False, 'error': 'File not found'}), 404
        
        # Check if file exists in uploads
        upload_path = FileHandler.get_upload_path(fileID, file_metadata['ext'])
        if not os.path.exists(upload_path):
            return jsonify({'success': False, 'error': 'Upload file not found'}), 404
        
        # Start background processing
        thread = threading.Thread(
            target=_process_file_background,
            args=(fileID, file_metadata),
            daemon=True
        )
        thread.start()
        
        return jsonify({
            'success': True,
            'fileID': fileID,
            'status': 'processing',
            'message': 'File processing started in background'
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@analyze_bp.route('/status', methods=['POST'])
def get_analysis_status():
    """Get processing status and results."""
    try:
        data = request.get_json()
        if not data or 'fileID' not in data:
            return jsonify({'success': False, 'error': 'fileID is required'}), 400
        
        fileID = data['fileID']
        
        # Check if processed file exists
        processed_path = os.path.join(settings.FILE_PROCESSED_DIR, f"{fileID}.json")
        if not os.path.exists(processed_path):
            return jsonify({
                'success': True,
                'fileID': fileID,
                'status': 'processing',
                'message': 'File is being processed'
            }), 200
        
        # Load processed data
        with open(processed_path, 'r', encoding='utf-8') as f:
            processed_data = json.load(f)
        
        return jsonify({
            'success': True,
            'fileID': fileID,
            'status': processed_data.get('status', 'completed'),
            'data': processed_data,
            'message': 'Processing completed' if processed_data.get('status') == 'completed' else 'Processing in progress'
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
