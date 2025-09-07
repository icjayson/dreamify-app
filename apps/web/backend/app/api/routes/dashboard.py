"""
Dashboard API routes for dynamic dashboard generation.
"""

from flask import Blueprint, request, jsonify
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

# Create blueprint
dashboard_bp = Blueprint('dashboard', __name__)

# Initialize dashboard service
dashboard_service = DashboardService()

logger = logging.getLogger(__name__)


@dashboard_bp.route('/generate', methods=['POST'])
def generate_dashboard():
    """Generate a new dashboard configuration based on data source."""
    try:
        start_time = time.time()
        
        # Validate request data
        request_data = request.get_json()
        if not request_data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        # Create request model
        dashboard_request = DashboardGenerationRequest(**request_data)
        
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
        
        return jsonify(response.dict()), 200
        
    except ValueError as e:
        logger.error(f"Validation error in generate_dashboard: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Invalid request data: {str(e)}'
        }), 400
    except Exception as e:
        logger.error(f"Error in generate_dashboard: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@dashboard_bp.route('/config/<dashboard_id>', methods=['GET'])
def get_dashboard_config(dashboard_id: str):
    """Retrieve dashboard configuration by ID."""
    try:
        dashboard_config = dashboard_service.get_dashboard_config(dashboard_id)
        
        if not dashboard_config:
            return jsonify({
                'success': False,
                'error': 'Dashboard configuration not found'
            }), 404
        
        return jsonify({
            'success': True,
            'dashboard_config': dashboard_config.dict()
        }), 200
        
    except Exception as e:
        logger.error(f"Error in get_dashboard_config: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@dashboard_bp.route('/refresh', methods=['POST'])
def refresh_dashboard():
    """Refresh dashboard data and configuration."""
    try:
        start_time = time.time()
        
        # Validate request data
        request_data = request.get_json()
        if not request_data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        # Create request model
        refresh_request = DashboardRefreshRequest(**request_data)
        
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
        
        return jsonify(response.dict()), 200
        
    except ValueError as e:
        logger.error(f"Validation error in refresh_dashboard: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Invalid request data: {str(e)}'
        }), 400
    except Exception as e:
        logger.error(f"Error in refresh_dashboard: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@dashboard_bp.route('/chart-data', methods=['POST'])
def get_chart_data():
    """Get specific chart data with optional filtering."""
    try:
        # Validate request data
        request_data = request.get_json()
        if not request_data:
            return jsonify({
                'success': False,
                'error': 'No request data provided'
            }), 400
        
        # Create request model
        chart_request = ChartDataRequest(**request_data)
        
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
        
        return jsonify(response.dict()), 200
        
    except ValueError as e:
        logger.error(f"Validation error in get_chart_data: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Invalid request data: {str(e)}'
        }), 400
    except Exception as e:
        logger.error(f"Error in get_chart_data: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@dashboard_bp.route('/list', methods=['GET'])
def list_dashboards():
    """List all available dashboard configurations."""
    try:
        dashboards = dashboard_service.list_dashboards()
        
        return jsonify({
            'success': True,
            'dashboards': dashboards,
            'count': len(dashboards)
        }), 200
        
    except Exception as e:
        logger.error(f"Error in list_dashboards: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500


@dashboard_bp.route('/delete/<dashboard_id>', methods=['DELETE'])
def delete_dashboard(dashboard_id: str):
    """Delete a dashboard configuration."""
    try:
        success = dashboard_service.delete_dashboard(dashboard_id)
        
        if not success:
            return jsonify({
                'success': False,
                'error': 'Dashboard configuration not found'
            }), 404
        
        return jsonify({
            'success': True,
            'message': 'Dashboard configuration deleted successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error in delete_dashboard: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500
