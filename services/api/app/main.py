"""
Main FastAPI application entry point for Dreamify Backend.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os
import logging

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_app():
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Dreamify Analytics API",
        description="API for Dreamify Analytics Platform with Stripe integration",
        version="1.0.0",
        docs_url="/api/v1/docs",
        redoc_url="/api/v1/redoc",
        openapi_url="/api/v1/openapi.json"
    )
    
    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:8080", 
            "http://localhost:8000",
            "http://localhost:5000",
            "http://localhost:3000",
            "http://localhost:5173",
            "https://app.dreamify.dev",
            "*"  # Allow all origins for development; restrict in production
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Import and register routers
    try:
        from app.api.routes import router as main_router
        app.include_router(main_router, prefix="/api/v1")
        logger.info("Main API router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import main router: {e}")
    
    try:
        from app.api.route_modules.stripe import router as stripe_router
        app.include_router(stripe_router, prefix="/api/v1/stripe", tags=["stripe"])
        logger.info("Stripe router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import stripe router: {e}")
    
    try:
        from app.api.route_modules.dashboard import router as dashboard_router
        app.include_router(dashboard_router, prefix="/api/v1/dashboard", tags=["dashboard"])
        logger.info("Dashboard router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import dashboard router: {e}")
    
    try:
        from app.api.route_modules.files import router as files_router
        app.include_router(files_router, prefix="/api/v1/files", tags=["files"])
        logger.info("Files router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import files router: {e}")
    
    try:
        from app.api.route_modules.analyze import router as analyze_router
        app.include_router(analyze_router, prefix="/api/v1/analyze", tags=["analyze"])
        logger.info("Analyze router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import analyze router: {e}")
    
    # Root endpoint
    @app.get("/", tags=["root"])
    async def root():
        """Root endpoint."""
        return {
            "message": "Welcome to Dreamify Backend",
            "version": "1.0.0",
            "docs": "/api/v1/docs"
        }
    
    # Health check endpoint
    @app.get("/health", tags=["health"])
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "service": "dreamify-backend"}
    
    return app

# Create the FastAPI app instance
app = create_app()

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 5000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True
    )
