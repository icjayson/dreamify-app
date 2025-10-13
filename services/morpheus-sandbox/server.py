from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
from utils.config import config
from utils.logger import logger
from utils.health import check_health
import os
import json
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

class StatusRequest(BaseModel):
    fileID: str

# Configure paths - pointing to dreamify-backend file-storage
BACKEND_STORAGE_BASE = config.storage.local.path
METADATA_DIR = os.path.join(BACKEND_STORAGE_BASE, "metadata", "uploads")
UPLOADS_DIR = os.path.join(BACKEND_STORAGE_BASE, "uploads")
PROCESSED_DIR = os.path.join(BACKEND_STORAGE_BASE, "processed")

def _process_file_background(fileID: str):
    """Background processing function for workflow execution."""
    processed_path = os.path.join(PROCESSED_DIR, f"{fileID}.json")
    
    try:
        logger.info(f"Starting background processing for fileID: {fileID}")
        
        # Load file metadata
        metadata_path = os.path.join(METADATA_DIR, f"{fileID}.json")
        if not os.path.exists(metadata_path):
            raise FileNotFoundError(f"Metadata {metadata_path} not found for fileID: {fileID}")
        
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        # Get actual file path
        file_ext = metadata.get('ext', 'csv')
        file_path = os.path.join(UPLOADS_DIR, f"{fileID}.{file_ext}")
        
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Upload file not found: {file_path}")
        
        logger.info(f"Processing file: {file_path}")
        
        # Initialize and execute workflow
        workflow = AnalyzeCSVWorkflow()
        result = workflow.execute(file_path, "Analyze this data file")
        
        # Prepare processed data
        processed_data = {
            "fileID": fileID,
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "file_size": metadata.get('size', 0),
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


@app.post("/run")
async def run_workflow(request: RunRequest, background_tasks: BackgroundTasks):
    """
    Start workflow processing for a file.
    Creates initial status file and triggers background processing.
    """
    try:
        fileID = request.fileID
        logger.info(f"Received run request for fileID: {fileID}")
        
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
        
        # Verify file exists
        metadata_path = os.path.join(METADATA_DIR, f"{fileID}.json")
        if not os.path.exists(metadata_path):
            logger.error(f"Metadata not found for fileID: {fileID}")
            raise HTTPException(status_code=404, detail="File metadata not found")
        
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        # Create initial status file
        initial_status = {
            "fileID": fileID,
            "status": "accepted",
            "processed_at": datetime.now().isoformat(),
            "file_size": metadata.get('size', 0),
            "file_type": metadata.get('ext', 'csv')
        }
        
        os.makedirs(PROCESSED_DIR, exist_ok=True)
        with open(processed_path, 'w', encoding='utf-8') as f:
            json.dump(initial_status, f, ensure_ascii=False, indent=2)
        
        # Add background task
        background_tasks.add_task(_process_file_background, fileID)
        
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
