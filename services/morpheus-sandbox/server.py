from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
from utils.logger import logger
from utils.health import check_health
from utils.s3_client import download_bytes
import os
import json
import tempfile
from pathlib import Path

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

# Configure paths - pointing to dreamify-backend file-storage
BACKEND_STORAGE_BASE = "/Users/quangnguyen/Documents/Dreamify/dreamify-backend/file-storage"
METADATA_DIR = os.path.join(BACKEND_STORAGE_BASE, "metadata", "uploads")
UPLOADS_DIR = os.path.join(BACKEND_STORAGE_BASE, "uploads")
PROCESSED_DIR = os.path.join(BACKEND_STORAGE_BASE, "processed")

def _process_file_background(fileID: str, s3_bucket: Optional[str] = None, s3_key: Optional[str] = None, extension: Optional[str] = None):
    """Background processing function for workflow execution."""
    processed_path = os.path.join(PROCESSED_DIR, f"{fileID}.json")
    temp_file_path = None
    
    try:
        logger.info(f"Starting background processing for fileID: {fileID}")
        
        # Determine file extension
        file_ext = extension or 'csv'
        
        # Get file content - either from S3 or local file system (for backward compatibility)
        if s3_bucket and s3_key:
            # Download from S3
            logger.info(f"Downloading file from S3: s3://{s3_bucket}/{s3_key}")
            file_content = download_bytes(s3_bucket, s3_key)
            
            # Save to temporary file for processing
            temp_dir = tempfile.gettempdir()
            temp_file_path = os.path.join(temp_dir, f"{fileID}.{file_ext}")
            with open(temp_file_path, 'wb') as f:
                f.write(file_content)
            
            logger.info(f"File downloaded from S3 and saved to temporary file: {temp_file_path}")
            file_path = temp_file_path
        else:
            # Fallback to local file system (for backward compatibility)
            logger.info(f"Using local file system for fileID: {fileID}")
            metadata_path = os.path.join(METADATA_DIR, f"{fileID}.json")
            if os.path.exists(metadata_path):
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
                file_ext = metadata.get('ext', 'csv')
            else:
                logger.warning(f"Metadata not found, using default extension: {file_ext}")
            
            file_path = os.path.join(UPLOADS_DIR, f"{fileID}.{file_ext}")
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"Upload file not found: {file_path}")
        
        logger.info(f"Processing file: {file_path}")
        
        # Initialize and execute workflow
        workflow = AnalyzeCSVWorkflow()
        result = workflow.execute(file_path, "Analyze this data file")
        
        # Get file size
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
        
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
        
        # Save processed data
        with open(processed_path, 'w', encoding='utf-8') as f:
            json.dump(processed_data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Background processing completed successfully for fileID: {fileID}")
        
    except Exception as e:
        logger.error(f"Background processing failed for fileID {fileID}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        
        # Save error status
        error_data = {
            "fileID": fileID,
            "status": "error",
            "error": str(e),
            "processed_at": datetime.now().isoformat()
        }
        with open(processed_path, 'w', encoding='utf-8') as f:
            json.dump(error_data, f, ensure_ascii=False, indent=2)
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
        
        # Check if already processed
        processed_path = os.path.join(PROCESSED_DIR, f"{fileID}.json")
        if os.path.exists(processed_path):
            with open(processed_path, 'r') as f:
                existing_data = json.load(f)
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
        
        # Determine file extension
        file_ext = extension or 'csv'
        
        # If using S3, verify we have the required information
        if s3_bucket and s3_key:
            logger.info(f"Using S3 for file retrieval: s3://{s3_bucket}/{s3_key}")
        else:
            # Fallback to local file system (for backward compatibility)
            logger.info(f"Using local file system for fileID: {fileID}")
            metadata_path = os.path.join(METADATA_DIR, f"{fileID}.json")
            if not os.path.exists(metadata_path):
                logger.error(f"Metadata not found for fileID: {fileID}")
                raise HTTPException(status_code=404, detail="File metadata not found. Please provide s3_bucket and s3_key.")
            
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
            file_ext = metadata.get('ext', 'csv')
        
        # Create initial status file
        initial_status = {
            "fileID": fileID,
            "status": "accepted",
            "processed_at": datetime.now().isoformat(),
            "file_size": 0,  # Will be updated after processing
            "file_type": file_ext
        }
        
        os.makedirs(PROCESSED_DIR, exist_ok=True)
        with open(processed_path, 'w', encoding='utf-8') as f:
            json.dump(initial_status, f, ensure_ascii=False, indent=2)
        
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
    """
    try:
        fileID = request.fileID
        logger.info(f"Received status request for fileID: {fileID}")
        
        # Check if processed file exists
        processed_path = os.path.join(PROCESSED_DIR, f"{fileID}.json")
        if not os.path.exists(processed_path):
            return {
                'success': True,
                'data': {
                    'success': True,
                    'fileID': fileID,
                    'status': 'processing',
                    'message': 'File is being processed'
                }
            }
        
        # Load processed data
        with open(processed_path, 'r', encoding='utf-8') as f:
            processed_data = json.load(f)
        
        logger.info(f"Status retrieved for fileID: {fileID}, status: {processed_data.get('status')}")
        
        return {
            'success': True,
            'data': processed_data
        }
        
    except Exception as e:
        logger.error(f"Status endpoint failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return await check_health()
