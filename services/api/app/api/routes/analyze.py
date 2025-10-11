"""
Analyze API routes for file processing (Phase 2).
"""

from flask import Blueprint, request, jsonify
from app.utils.file_handler import FileHandler
from config.settings import settings
import os
import json
import requests


analyze_bp = Blueprint('analyze', __name__)

# Morpheus LLM service URL
MORPHEUS_SERVICE_URL = "http://localhost:8000"


@analyze_bp.route('/run', methods=['POST', 'OPTIONS'])
def run_analysis():
    """Start file processing analysis by calling morpheus service."""
    if request.method == 'OPTIONS':
        return jsonify({'success': True}), 200
    
    try:
        data = request.get_json()
        if not data or 'fileID' not in data:
            return jsonify({'success': False, 'error': 'fileID is required'}), 400
        
        fileID = data['fileID']
        
        # Verify file exists
        try:
            file_metadata = FileHandler.get_upload_metadata(fileID)
        except FileNotFoundError:
            return jsonify({'success': False, 'error': 'File not found'}), 404
        
        upload_path = FileHandler.get_upload_path(fileID, file_metadata['ext'])
        if not os.path.exists(upload_path):
            return jsonify({'success': False, 'error': 'Upload file not found'}), 404
        
        # Call morpheus service
        try:
            response = requests.post(
                f"{MORPHEUS_SERVICE_URL}/run",
                json={"fileID": fileID},
                timeout=30
            )
            response.raise_for_status()
            morpheus_result = response.json()
            
            return jsonify(morpheus_result), response.status_code
            
        except requests.exceptions.ConnectionError:
            return jsonify({
                'success': False,
                'error': 'Morpheus LLM service is not available. Please ensure it is running on port 8000.'
            }), 503
        except requests.exceptions.Timeout:
            return jsonify({
                'success': False,
                'error': 'Morpheus service request timed out'
            }), 504
        except requests.exceptions.RequestException as e:
            return jsonify({
                'success': False,
                'error': f'Failed to communicate with Morpheus service: {str(e)}'
            }), 502
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@analyze_bp.route('/status', methods=['POST'])
def get_analysis_status():
    """Get processing status and results from morpheus service."""
    try:
        data = request.get_json()
        if not data or 'fileID' not in data:
            return jsonify({'success': False, 'error': 'fileID is required'}), 400
        
        fileID = data['fileID']
        
        # Call morpheus service
        try:
            response = requests.post(
                f"{MORPHEUS_SERVICE_URL}/status",
                json={"fileID": fileID},
                timeout=30
            )
            response.raise_for_status()
            morpheus_result = response.json()
            
            return jsonify(morpheus_result), response.status_code
            
        except requests.exceptions.ConnectionError:
            return jsonify({
                'success': False,
                'error': 'Morpheus LLM service is not available'
            }), 503
        except requests.exceptions.Timeout:
            return jsonify({
                'success': False,
                'error': 'Morpheus service request timed out'
            }), 504
        except requests.exceptions.RequestException as e:
            return jsonify({
                'success': False,
                'error': f'Failed to communicate with Morpheus service: {str(e)}'
            }), 502
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
        # Check if processed file exists
        processed_path = os.path.join(settings.FILE_PROCESSED_DIR, f"{fileID}.json")
        if not os.path.exists(processed_path):
            return jsonify({
                'success': True,
                'data': {
                    'success': True,
                    'fileID': fileID,
                    'status': 'processing',
                    'message': 'File is being processed'
                }
            }), 200
        
        # Load processed data
        with open(processed_path, 'r', encoding='utf-8') as f:
            processed_data = json.load(f)
        
        return jsonify({
            'success': True,
            'data': processed_data,
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
