from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
from utils.logger import logger
from utils.health import check_health
from utils.s3_client import download_bytes, get_s3_client
from utils.config import config
import os
import json
import tempfile
from pathlib import Path
import requests

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for request/response
class RunRequest(BaseModel):
    fileID: str
    s3_bucket: Optional[str] = None
    s3_key: Optional[str] = None
    extension: Optional[str] = None

class StatusRequest(BaseModel):
    fileID: str

# Backend API URL for updating file records
BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://localhost:8001")

logger.info(
    "Config AWS credentials present: %s", "yes" if getattr(config, "aws", None) else "no"
)

def _parse_s3_key(s3_key: str) -> dict:
    """Parse S3 key to extract version, user_id, project_id, asset_id, file_id, extension."""
    # Format: {version}/users/{user_id}/projects/{project_id}/assets/{asset_id}/{file_id}.{extension}
    parts = s3_key.split('/')
    if len(parts) < 7:
        raise ValueError(f"Invalid S3 key format: {s3_key}")
    
    version = parts[0]
    user_id = parts[2]
    project_id = parts[4]
    asset_id = parts[6]
    filename = parts[7] if len(parts) > 7 else ""
    
    if '.' in filename:
        file_id, extension = filename.rsplit('.', 1)
    else:
        file_id = filename
        extension = ""
    
    return {
        'version': version,
        'user_id': user_id,
        'project_id': project_id,
        'asset_id': asset_id,
        'file_id': file_id,
        'extension': extension
    }

def _build_processed_json_key(version: str, user_id: str, project_id: str, asset_id: str, file_id: str) -> str:
    """Build S3 key for processed JSON file."""
    return f"{version}/users/{user_id}/projects/{project_id}/assets/{asset_id}/processed/{file_id}.json"

def _upload_bytes_to_s3(bucket: str, key: str, data: bytes, content_type: str = 'application/json'):
    """Upload bytes to S3."""
    s3_client = get_s3_client()
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type
    )

def _process_file_background(fileID: str, s3_bucket: Optional[str] = None, s3_key: Optional[str] = None, extension: Optional[str] = None):
    """Background processing function for workflow execution."""
    temp_file_path = None
    processed_json_s3_key = None
    
    try:
        logger.info(f"Starting background processing for fileID: {fileID}")
        
        # Require S3 information
        if not s3_bucket or not s3_key:
            raise ValueError("S3 bucket and key are required. Local file system fallback is no longer supported.")
        
        # Determine file extension
        file_ext = extension or 'csv'
        
        # Download from S3
        logger.info(f"Downloading file from S3: s3://{s3_bucket}/{s3_key}")
        try:
            file_content = download_bytes(s3_bucket, s3_key)
        except Exception as e:
            error_msg = f"Failed to download file from S3: {str(e)}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
        
        # Save to temporary file for processing
        temp_dir = tempfile.gettempdir()
        logger.info(f"Using temporary directory: {temp_dir}")
        temp_file_path = os.path.join(temp_dir, f"{fileID}.{file_ext}")
        logger.info(f"Writing temporary file: {temp_file_path}")
        try:
            with open(temp_file_path, 'wb') as f:
                f.write(file_content)
        except PermissionError as e:
            error_msg = f"Permission denied writing temporary file {temp_file_path}: {str(e)}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
        except OSError as e:
            error_msg = f"OS error writing temporary file {temp_file_path}: {str(e)}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
        
        logger.info(f"File downloaded from S3 and saved to temporary file: {temp_file_path}")
        file_path = temp_file_path
        
        logger.info(f"Processing file: {file_path}")
        
        # Initialize and execute workflow
        workflow = AnalyzeCSVWorkflow()
        result = workflow.execute(file_path, "Analyze this data file")
        
        # Get file size
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
        
        # Parse S3 key to extract components for building processed JSON key
        try:
            key_parts = _parse_s3_key(s3_key)
            processed_json_s3_key = _build_processed_json_key(
                version=key_parts['version'],
                user_id=key_parts['user_id'],
                project_id=key_parts['project_id'],
                asset_id=key_parts['asset_id'],
                file_id=key_parts['file_id']
            )
        except Exception as e:
            logger.error(f"Failed to parse S3 key or build processed JSON key: {str(e)}")
            raise
        
        # Prepare processed data
        processed_data = {
            "fileID": fileID,
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "file_size": file_size,
            "file_type": file_ext,
            "data": result.get("data", {}),
            "charts": result.get("data", {}).get("charts", []),
            "metrics": result.get("data", {}).get("metrics", []),
            "insights": result.get("data", {}).get("insights", [])
        }
        
        # Save workflow output if available
        if "workflow_output" in result and result["workflow_output"]:
            output_dir = Path("storage/out")
            output_dir.mkdir(exist_ok=True, parents=True)
            workflow_output_file = output_dir / f"workflow_{fileID}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            result["workflow_output"].save_to_file(str(workflow_output_file))
            processed_data["workflow_output_path"] = str(workflow_output_file)
            logger.info(f"Workflow output saved to: {workflow_output_file}")
        
        # Save processed data to S3
        processed_json_bytes = json.dumps(processed_data, ensure_ascii=False, indent=2).encode('utf-8')
        logger.info(f"Uploading processed JSON to S3: s3://{s3_bucket}/{processed_json_s3_key}")
        _upload_bytes_to_s3(s3_bucket, processed_json_s3_key, processed_json_bytes, 'application/json')
        logger.info(f"Processed JSON uploaded successfully to S3")
        
        # Update File record with processed_json_s3_key via backend API
        try:
            update_url = f"{BACKEND_API_URL}/api/v1/files/{fileID}/processed-key"
            response = requests.put(
                update_url,
                json={"processed_json_s3_key": processed_json_s3_key},
                timeout=10
            )
            if response.status_code == 200:
                logger.info(f"Updated File record with processed_json_s3_key: {processed_json_s3_key}")
            else:
                logger.warning(f"Failed to update File record: {response.status_code} - {response.text}")
        except Exception as e:
            logger.warning(f"Failed to update File record via API: {str(e)}")
        
        logger.info(f"Background processing completed successfully for fileID: {fileID}")
        
    except Exception as e:
        logger.error(f"Background processing failed for fileID {fileID}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        
        # Save error status to S3 if we have the key
        if processed_json_s3_key and s3_bucket:
            try:
                error_data = {
                    "fileID": fileID,
                    "status": "error",
                    "error": str(e),
                    "processed_at": datetime.now().isoformat()
                }
                error_json_bytes = json.dumps(error_data, ensure_ascii=False, indent=2).encode('utf-8')
                _upload_bytes_to_s3(s3_bucket, processed_json_s3_key, error_json_bytes, 'application/json')
                logger.info(f"Error status saved to S3: s3://{s3_bucket}/{processed_json_s3_key}")
            except Exception as upload_error:
                logger.error(f"Failed to save error status to S3: {str(upload_error)}")
    finally:
        # Clean up temporary file if it was created
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Cleaned up temporary file: {temp_file_path}")
            except Exception as e:
                logger.warning(f"Failed to clean up temporary file {temp_file_path}: {str(e)}")


@app.post("/run")
async def run_workflow(request: RunRequest, background_tasks: BackgroundTasks):
    """
    Start workflow processing for a file.
    Creates initial status file and triggers background processing.
    """
    try:
        fileID = request.fileID
        s3_bucket = request.s3_bucket
        s3_key = request.s3_key
        extension = request.extension
        
        logger.info(f"Received run request for fileID: {fileID}, s3_bucket: {s3_bucket}, s3_key: {s3_key}, extension: {extension}")
        
        # Require S3 information
        if not s3_bucket or not s3_key:
            raise HTTPException(status_code=400, detail="S3 bucket and key are required. Local file system fallback is no longer supported.")
        
        # Determine file extension
        file_ext = extension or 'csv'
        
        # Check if already processed by querying S3
        try:
            key_parts = _parse_s3_key(s3_key)
            processed_json_s3_key = _build_processed_json_key(
                version=key_parts['version'],
                user_id=key_parts['user_id'],
                project_id=key_parts['project_id'],
                asset_id=key_parts['asset_id'],
                file_id=key_parts['file_id']
            )
            # Try to download processed JSON from S3
            try:
                processed_data_bytes = download_bytes(s3_bucket, processed_json_s3_key)
                existing_data = json.loads(processed_data_bytes.decode('utf-8'))
                if existing_data.get('status') == 'completed':
                    return {
                        'success': True,
                        'data': {
                            'success': True,
                            'fileID': fileID,
                            'status': 'completed',
                            'message': 'File already processed'
                        }
                    }
            except FileNotFoundError:
                # Not processed yet, continue
                pass
        except Exception as e:
            logger.warning(f"Could not check for existing processed file: {str(e)}")
        
        # Add background task with S3 information
        background_tasks.add_task(_process_file_background, fileID, s3_bucket, s3_key, extension)
        
        logger.info(f"Background processing started for fileID: {fileID}")
        
        return {
            'success': True,
            'data': {
                'success': True,
                'fileID': fileID,
                'status': 'accepted',
                'message': 'File processing started in background'
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Run endpoint failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/status")
async def get_workflow_status(request: StatusRequest):
    """
    Get processing status and results for a file.
    Note: This endpoint now requires the file to be queried from backend database
    to get S3 information. For now, returns processing status.
    """
    try:
        fileID = request.fileID
        logger.info(f"Received status request for fileID: {fileID}")
        
        # Try to get file info from backend API to retrieve processed JSON from S3
        try:
            backend_url = f"{BACKEND_API_URL}/api/v1/files/{fileID}"
            response = requests.get(backend_url, timeout=10)
            if response.status_code == 200:
                file_info = response.json()
                # If file has processed_json_s3_key, try to download from S3
                if file_info.get('processed_json_s3_key'):
                    try:
                        # Get asset info to find bucket
                        asset_response = requests.get(
                            f"{BACKEND_API_URL}/api/v1/assets/{file_info.get('asset_id')}",
                            timeout=10
                        )
                        if asset_response.status_code == 200:
                            asset_info = asset_response.json()
                            s3_bucket = asset_info.get('s3_bucket')
                            if s3_bucket:
                                processed_data_bytes = download_bytes(s3_bucket, file_info['processed_json_s3_key'])
                                processed_data = json.loads(processed_data_bytes.decode('utf-8'))
                                logger.info(f"Status retrieved for fileID: {fileID}, status: {processed_data.get('status')}")
                                return {
                                    'success': True,
                                    'data': processed_data
                                }
                    except Exception as e:
                        logger.warning(f"Failed to retrieve processed data from S3: {str(e)}")
        except Exception as e:
            logger.warning(f"Failed to query backend API: {str(e)}")
        
        # Return processing status if we can't find processed data
        return {
            'success': True,
            'data': {
                'success': True,
                'fileID': fileID,
                'status': 'processing',
                'message': 'File is being processed'
            }
        }
        
    except Exception as e:
        logger.error(f"Status endpoint failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return await check_health()
