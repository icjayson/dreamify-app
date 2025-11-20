#!/usr/bin/env python3
"""
Startup script for FastAPI application.
"""

import uvicorn
from utils.config import get_settings

settings = get_settings()

if __name__ == "__main__":
    # Get configuration from config.yaml
    host = settings.HOST
    port = settings.PORT
    debug = settings.DEBUG
    
    print(f"Starting FastAPI server on {host}:{port}")
    print(f"Debug mode: {debug}")
    print(f"API Documentation: http://{host}:{port}/api/v1/docs")
    print(f"ReDoc Documentation: http://{host}:{port}/api/v1/redoc")
    
    # Start the server
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=debug,
        log_level="info" if not debug else "debug"
    )
