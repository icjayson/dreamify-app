"""
Health check utilities
"""

from datetime import datetime
from utils.logger import logger

async def check_health():
    """
    Run all health checks and return status dictionary.
    
    Returns:
        Dict with health status for each component:
        {
            "qr_scanner": {"status": "healthy|unhealthy", "error": None|str},
            "orientation_detection_model": {"status": "healthy|unhealthy", "error": None|str},
            "database_connection": {"status": "healthy|unhealthy", "error": None|str},
            "llm_service": {"status": "healthy|unhealthy", "error": None|str}
        }
    """
    """
Health check utilities
"""

from datetime import datetime
from utils.logger import logger

async def check_health():
    """Perform a health check of the system"""
    try:
        logger.info("Health check requested")
        return {
            "status": "ok", 
            "timestamp": datetime.now().isoformat(),
            "service": "morpheus-csv-analyzer"
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "error", 
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }
