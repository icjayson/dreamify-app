"""
FastAPI Analyze routes for file processing (Phase 2).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.utils.file_handler import FileHandler
from config.settings import settings
import os
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
async def run_analysis(request: AnalysisRequest):
    """Start file processing analysis by calling morpheus service."""
    try:
        fileID = request.fileID
        
        # Verify file exists
        try:
            file_metadata = FileHandler.get_upload_metadata(fileID)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found")
        
        upload_path = FileHandler.get_upload_path(fileID, file_metadata['ext'])
        if not os.path.exists(upload_path):
            raise HTTPException(status_code=404, detail="Upload file not found")
        
        # Call morpheus service
        try:
            logger.info(f"Calling morpheus service endpoint: {MORPHEUS_SERVICE_URL}/run")
            logger.info(f"JSON data: {json.dumps({'fileID': fileID}, indent=2)}")
            response = requests.post(
                f"{MORPHEUS_SERVICE_URL}/run",
                json={"fileID": fileID},
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
