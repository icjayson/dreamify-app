#!/usr/bin/env python3
"""
Startup script for FastAPI application.
"""

import uvicorn
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

if __name__ == "__main__":
    # Get configuration from environment variables
    host = os.getenv("FASTAPI_HOST", "0.0.0.0")
    port = int(os.getenv("FASTAPI_PORT", "5000"))
    debug = os.getenv("FASTAPI_DEBUG", "true").lower() == "true"
    
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
