"""
FastAPI Analyze routes for file processing (Phase 2).
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.dependencies.auth import require_user
from utils.postgres.db import get_db
from utils.postgres.repos import files as files_repo, assets
import uuid
import json
import requests
import logging

# Create router
router = APIRouter()

logger = logging.getLogger(__name__)

# Morpheus LLM service URL
MORPHEUS_SERVICE_URL = "http://localhost:8000"

class AnalysisRequest(BaseModel):
    """Request model for analysis operations."""
    fileID: str

@router.post("/run", tags=["analyze"])
async def run_analysis(
    request: AnalysisRequest,
    db: Session = Depends(get_db),
    clerk_user_id: str = Depends(require_user)
):
    """Start file processing analysis by calling morpheus service."""
    try:
        fileID = request.fileID
        logger.info(f"run_analysis called with fileID: {fileID}, user: {clerk_user_id}")
        
        # Verify file exists in database and user has access
        try:
            file_uuid = uuid.UUID(fileID)
            logger.info(f"Converted fileID to UUID: {file_uuid}")
        except ValueError as e:
            logger.error(f"Invalid file ID format: {fileID}, error: {str(e)}")
            raise HTTPException(status_code=400, detail="Invalid file ID")
        
        file_record = files_repo.get_file(db, file_uuid)
        logger.info(f"File record lookup result: {file_record is not None}")
        if not file_record:
            # Log all files for this user to help debug
            logger.warning(f"File not found for fileID: {fileID}, user: {clerk_user_id}")
            raise HTTPException(status_code=404, detail="File not found")
        
        # Verify user has access to this file (through asset ownership)
        asset = assets.get_asset(db, file_record.asset_id)
        if not asset or asset.user_id != clerk_user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Prepare request data with S3 information
        request_data = {
            "fileID": fileID,
            "s3_bucket": asset.s3_bucket,
            "s3_key": asset.s3_key,
            "extension": file_record.extension
        }
        
        # Call morpheus service
        try:
            logger.info(f"Calling morpheus service endpoint: {MORPHEUS_SERVICE_URL}/run")
            logger.info(f"JSON data: {json.dumps(request_data, indent=2)}")
            response = requests.post(
                f"{MORPHEUS_SERVICE_URL}/run",
                json=request_data,
                timeout=30
            )
            response.raise_for_status()
            morpheus_result = response.json()
            
            return morpheus_result
            
        except requests.exceptions.ConnectionError:
            raise HTTPException(
                status_code=503, 
                detail="Morpheus LLM service is not available. Please ensure it is running on port 8000."
            )
        except requests.exceptions.Timeout:
            raise HTTPException(
                status_code=504, 
                detail="Morpheus service request timed out"
            )
        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=502, 
                detail=f'Failed to communicate with Morpheus service: {str(e)}'
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in run_analysis: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/status", tags=["analyze"])
async def get_analysis_status(request: AnalysisRequest):
    """Get processing status and results from morpheus service."""
    try:
        fileID = request.fileID
        
        # Call morpheus service
        try:
            response = requests.post(
                f"{MORPHEUS_SERVICE_URL}/status",
                json={"fileID": fileID},
                timeout=30
            )
            response.raise_for_status()
            morpheus_result = response.json()
            
            return morpheus_result
            
        except requests.exceptions.ConnectionError:
            raise HTTPException(
                status_code=503, 
                detail="Morpheus LLM service is not available"
            )
        except requests.exceptions.Timeout:
            raise HTTPException(
                status_code=504, 
                detail="Morpheus service request timed out"
            )
        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=502, 
                detail=f'Failed to communicate with Morpheus service: {str(e)}'
            )
        
    except Exception as e:
        logger.error(f"Error in get_analysis_status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
