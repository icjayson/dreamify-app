"""
FastAPI Dashboard routes for dynamic dashboard generation.
"""

from fastapi import APIRouter, HTTPException, Path
from app.services.dashboard_service import DashboardService
from app.models.dashboard_models import (
    DashboardGenerationRequest,
    DashboardGenerationResponse,
    DashboardRefreshRequest,
    DashboardRefreshResponse,
    ChartDataRequest,
    ChartDataResponse
)
import time
import logging

# Create router
router = APIRouter()

# Initialize dashboard service
dashboard_service = DashboardService()

logger = logging.getLogger(__name__)

@router.post("/generate", response_model=DashboardGenerationResponse, tags=["dashboard"])
async def generate_dashboard(dashboard_request: DashboardGenerationRequest):
    """Generate a new dashboard configuration based on data source."""
    try:
        start_time = time.time()
        
        # Generate dashboard configuration
        dashboard_config = dashboard_service.generate_dashboard_config(
            data_source=dashboard_request.data_source,
            requirements=dashboard_request.requirements,
            layout_preference=dashboard_request.layout_preference,
            chart_types=dashboard_request.chart_types,
            metadata=dashboard_request.metadata
        )
        
        processing_time = time.time() - start_time
        
        response = DashboardGenerationResponse(
            success=True,
            dashboard_config=dashboard_config,
            processing_time=processing_time,
            metadata={'generated_at': time.time()}
        )
        
        return response
        
    except ValueError as e:
        logger.error(f"Validation error in generate_dashboard: {str(e)}")
        raise HTTPException(status_code=400, detail=f'Invalid request data: {str(e)}')
    except Exception as e:
        logger.error(f"Error in generate_dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/config/{dashboard_id}", tags=["dashboard"])
async def get_dashboard_config(dashboard_id: str = Path(..., description="Dashboard ID")):
    """Retrieve dashboard configuration by ID."""
    try:
        dashboard_config = dashboard_service.get_dashboard_config(dashboard_id)
        
        if not dashboard_config:
            raise HTTPException(status_code=404, detail="Dashboard configuration not found")
        
        return {
            'success': True,
            'dashboard_config': dashboard_config.dict()
        }
        
    except Exception as e:
        logger.error(f"Error in get_dashboard_config: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/refresh", response_model=DashboardRefreshResponse, tags=["dashboard"])
async def refresh_dashboard(refresh_request: DashboardRefreshRequest):
    """Refresh dashboard data and configuration."""
    try:
        start_time = time.time()
        
        # Refresh dashboard
        dashboard_config = dashboard_service.refresh_dashboard(
            dashboard_id=refresh_request.dashboard_id,
            data_source=refresh_request.data_source,
            force_refresh=refresh_request.force_refresh
        )
        
        refresh_time = time.time()
        
        response = DashboardRefreshResponse(
            success=True,
            dashboard_config=dashboard_config,
            refresh_time=refresh_time,
            metadata={'refreshed_at': refresh_time}
        )
        
        return response
        
    except ValueError as e:
        logger.error(f"Validation error in refresh_dashboard: {str(e)}")
        raise HTTPException(status_code=400, detail=f'Invalid request data: {str(e)}')
    except Exception as e:
        logger.error(f"Error in refresh_dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/chart-data", response_model=ChartDataResponse, tags=["dashboard"])
async def get_chart_data(chart_request: ChartDataRequest):
    """Get specific chart data with optional filtering."""
    try:
        # Get chart data
        chart_data = dashboard_service.get_chart_data(
            chart_id=chart_request.chart_id,
            filters=chart_request.filters,
            aggregation=chart_request.aggregation,
            time_range=chart_request.time_range
        )
        
        response = ChartDataResponse(
            success=True,
            data=chart_data,
            metadata={'requested_at': time.time()}
        )
        
        return response
        
    except ValueError as e:
        logger.error(f"Validation error in get_chart_data: {str(e)}")
        raise HTTPException(status_code=400, detail=f'Invalid request data: {str(e)}')
    except Exception as e:
        logger.error(f"Error in get_chart_data: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/list", tags=["dashboard"])
async def list_dashboards():
    """List all available dashboard configurations."""
    try:
        dashboards = dashboard_service.list_dashboards()
        
        return {
            'success': True,
            'dashboards': dashboards,
            'count': len(dashboards)
        }
        
    except Exception as e:
        logger.error(f"Error in list_dashboards: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.delete("/delete/{dashboard_id}", tags=["dashboard"])
async def delete_dashboard(dashboard_id: str = Path(..., description="Dashboard ID")):
    """Delete a dashboard configuration."""
    try:
        success = dashboard_service.delete_dashboard(dashboard_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Dashboard configuration not found")
        
        return {
            'success': True,
            'message': 'Dashboard configuration deleted successfully'
        }
        
    except Exception as e:
        logger.error(f"Error in delete_dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")
