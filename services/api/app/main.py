"""
Main FastAPI application entry point for Dreamify Backend.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from utils.config import get_settings
import logging

settings = get_settings()

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
        allow_origins=settings.CORS_ORIGINS,
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
        from app.api.route_modules.auth import router as auth_router
        app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
        logger.info("Auth router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import auth router: {e}")

    try:
        from app.api.route_modules.waitlist import router as waitlist_router
        app.include_router(waitlist_router, prefix="/api/v1/waitlist", tags=["waitlist"])
        logger.info("Waitlist router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import waitlist router: {e}")

    try:
        from app.api.route_modules.user import router as user_router
        app.include_router(user_router, prefix="/api/v1")
        logger.info("User router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import user router: {e}")

    try:
        from app.api.route_modules.morpheus import router as morpheus_router
        app.include_router(morpheus_router, prefix="/api/v1")
        logger.info("Morpheus router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Morpheus router: {e}")
 
    try:
        from app.api.route_modules.conversation import router as conversation_router
        app.include_router(conversation_router, prefix="/api/v1", tags=["conversation"])
        # Verify route registration
        conversation_routes = [r for r in app.routes if hasattr(r, "path") and "conversation" in r.path]
        if conversation_routes:
            logger.info(
                "Conversation router registered with %d route(s): %s",
                len(conversation_routes),
                [f"{','.join(sorted(getattr(r, 'methods', []) or []))} {r.path}" for r in conversation_routes],
            )
        else:
            logger.warning("Conversation router registered but no routes found")
    except ImportError as e:
        logger.error(f"Failed to import Conversation router: {e}")
    except Exception as e:
        logger.error(f"Failed to register Conversation router: {e}", exc_info=True)
    
    try:
        from app.api.route_modules.admin import router as admin_router
        app.include_router(admin_router, prefix="/api/v1", tags=["admin"])
        logger.info("Admin router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Admin router: {e}")
    
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
    port = settings.PORT
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True
    )
