"""
Files API routes for upload, listing, deletion, and preview (Phase 1).
"""

from flask import Blueprint, request, jsonify, Response
from werkzeug.utils import secure_filename
from app.utils.file_handler import FileHandler
from config.settings import settings
import os
import json
import pandas as pd


files_bp = Blueprint('files', __name__)


@files_bp.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        # Validate type and size using existing utility
        info = FileHandler.validate_file(file)

        fileID = FileHandler.generate_file_id()
        print(f"File ID: {fileID}")
        ext = info['extension']
        upload_path = FileHandler.get_upload_path(fileID, ext)

        # Persist file to storage
        file.seek(0)
        file.save(upload_path)

        metadata = {
            'fileID': fileID,
            'filename': info['filename'],
            'ext': ext,
            'size': info['size'],
            'created_at': pd.Timestamp.utcnow().isoformat(),
        }
        FileHandler.save_upload_metadata(fileID, metadata)

        return jsonify({
            'success': True,
            'fileID': fileID,
            'filename': info['filename'],
            'size': info['size'],
            'ext': ext,
        }), 200

    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@files_bp.route('', methods=['GET'])
def list_files():
    try:
        files = FileHandler.list_uploads()
        return jsonify({'success': True, 'files': files}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@files_bp.route('/<fileID>', methods=['DELETE'])
def delete_file(fileID: str):
    try:
        deleted = FileHandler.delete_upload_set(fileID)
        if not deleted:
            return jsonify({'success': False, 'error': 'File not found'}), 404
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _render_html_table_from_dataframe(df: pd.DataFrame, title: str) -> str:
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


@files_bp.route('/preview/<fileID>', methods=['GET'])
def preview_file(fileID: str):
    try:
        try:
            meta = FileHandler.get_upload_metadata(fileID)
        except FileNotFoundError:
            return Response("<h3>File not found</h3>", status=404, mimetype='text/html')

        ext = meta.get('ext')
        filename = meta.get('filename', fileID)
        path = FileHandler.get_upload_path(fileID, ext)
        if not os.path.exists(path):
            return Response("<h3>File not found</h3>", status=404, mimetype='text/html')

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
                return Response(f"<h3>Error reading JSON: {str(e)}</h3>", status=400, mimetype='text/html')
        else:
            return Response("<h3>Invalid file type. Supported: CSV, XLSX, XLS, JSON</h3>", status=400, mimetype='text/html')

        return Response(html, status=200, mimetype='text/html')
    except Exception as e:
        return Response(f"<h3>Error generating preview: {str(e)}</h3>", status=500, mimetype='text/html')


