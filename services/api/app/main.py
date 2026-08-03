"""
Main FastAPI application entry point for Dreamify Backend.
"""

from dotenv import load_dotenv
load_dotenv()  # load .env before any module reads os.environ

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from utils.config import get_settings
import importlib
import logging
import json
from email.utils import formatdate
from app.utils.timestamp_utils import validate_timestamp_fields

settings = get_settings()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Routers whose absence is a production outage: if any of these fail to register,
# the worker must refuse to boot rather than silently serving 404s.
CRITICAL_ROUTERS = {"user", "conversation", "dashboard", "auth", "morpheus"}

# Populated by _register() during create_app(); surfaced via /health.
_router_status = {"registered": [], "failed": {}}


def _register(app, name, import_path, attr, *, critical, **include_kwargs):
    """Import a router module and mount it, centralizing failure policy.

    Critical routers re-raise on failure so create_app() (and thus the worker)
    fails loudly at boot. Non-critical routers are logged and skipped.
    """
    try:
        module = importlib.import_module(import_path)
        app.include_router(getattr(module, attr), **include_kwargs)
        _router_status["registered"].append(name)
        logger.info("%s router registered successfully", name)
    except Exception as e:  # broadened from ImportError: module-level init can raise anything
        _router_status["failed"][name] = repr(e)
        logger.error("Failed to register %s router: %s", name, e, exc_info=True)
        if critical:
            raise


def create_app():
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Dreamify Analytics API",
        description="API for Dreamify Analytics Platform with Polar.sh integration",
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

    @app.middleware("http")
    async def timestamp_validation_and_headers(request, call_next):
        content_type = request.headers.get("content-type", "")
        if request.method in {"POST", "PUT", "PATCH"} and "application/json" in content_type:
            body_bytes = await request.body()
            if body_bytes:
                try:
                    payload = json.loads(body_bytes)
                    validate_timestamp_fields(payload)
                except ValueError as exc:
                    return JSONResponse(status_code=400, content={"detail": str(exc)})
                except json.JSONDecodeError:
                    pass

                async def receive_body():
                    return {
                        "type": "http.request",
                        "body": body_bytes,
                        "more_body": False,
                    }

                request._receive = receive_body

        response = await call_next(request)
        response.headers["X-Server-Timezone"] = "UTC"
        response.headers["Date"] = formatdate(usegmt=True)
        return response
    
    # Import and register routers
    try:
        from app.api.route_modules.polar import router as polar_router
        app.include_router(polar_router, prefix="/api/v1/polar", tags=["polar"])
        logger.info("Polar router registered successfully")
    except Exception as e:
        logger.error(f"Failed to import polar router: {e}")

    try:
        from app.api.routes import router as main_router
        app.include_router(main_router, prefix="/api/v1")
        logger.info("Main API router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import main router: {e}")
    
    try:
        from app.api.route_modules.stripe import router as stripe_router
        app.include_router(stripe_router, prefix="/api/v1/stripe", tags=["stripe"])
        logger.info("Stripe router registered successfully (DEPRECATED)")
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
        from app.api.route_modules.webhooks import router as webhooks_router
        app.include_router(webhooks_router, prefix="/api/v1")
        logger.info("Webhooks router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import webhooks router: {e}")

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
    
    try:
        from app.api.route_modules.public import router as public_router
        app.include_router(public_router, prefix="/api/v1", tags=["public"])
        logger.info("Public router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Public router: {e}")
        
    try:
        from app.api.route_modules.integration import router as integration_router
        app.include_router(integration_router, prefix="/api/v1")
        logger.info("Integration router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Integration router: {e}")

    try:
        from app.api.route_modules.warehouse import router as warehouse_router
        app.include_router(warehouse_router, prefix="/api/v1")
        logger.info("Warehouse router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Warehouse router: {e}")

    try:
        from app.api.route_modules.chat_platform import router as chat_router
        app.include_router(chat_router, prefix="/api/v1", tags=["chat"])
        logger.info("Chat platform router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Chat platform router: {e}")

    try:
        from app.api.route_modules.schedules import router as schedules_router
        app.include_router(schedules_router, prefix="/api/v1", tags=["schedules"])
        logger.info("Schedules router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Schedules router: {e}")

    try:
        from app.api.route_modules.internal import router as internal_router
        app.include_router(internal_router, prefix="/api/v1", tags=["internal"])
        logger.info("Internal router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Internal router: {e}")

    try:
        from app.api.route_modules.notifications import router as notifications_router
        app.include_router(notifications_router, prefix="/api/v1", tags=["notifications"])
        logger.info("Notifications router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import Notifications router: {e}")

    try:
        from app.api.route_modules.cms import router as cms_router
        app.include_router(cms_router, prefix="/api/v1", tags=["cms"])
        logger.info("CMS router registered successfully")
    except ImportError as e:
        logger.error(f"Failed to import CMS router: {e}")
    # Import and register routers.
    # (name, import_path, attr, include_kwargs); criticality is decided by CRITICAL_ROUTERS.
    _router_status["registered"].clear()
    _router_status["failed"].clear()

    _ROUTERS = [
        ("polar", "app.api.route_modules.polar", "router", {"prefix": "/api/v1/polar", "tags": ["polar"]}),
        ("main", "app.api.routes", "router", {"prefix": "/api/v1"}),
        ("stripe", "app.api.route_modules.stripe", "router", {"prefix": "/api/v1/stripe", "tags": ["stripe"]}),
        ("dashboard", "app.api.route_modules.dashboard", "router", {"prefix": "/api/v1/dashboard", "tags": ["dashboard"]}),
        ("auth", "app.api.route_modules.auth", "router", {"prefix": "/api/v1/auth", "tags": ["auth"]}),
        ("waitlist", "app.api.route_modules.waitlist", "router", {"prefix": "/api/v1/waitlist", "tags": ["waitlist"]}),
        ("user", "app.api.route_modules.user", "router", {"prefix": "/api/v1"}),
        ("morpheus", "app.api.route_modules.morpheus", "router", {"prefix": "/api/v1"}),
        ("conversation", "app.api.route_modules.conversation", "router", {"prefix": "/api/v1", "tags": ["conversation"]}),
        ("admin", "app.api.route_modules.admin", "router", {"prefix": "/api/v1", "tags": ["admin"]}),
        ("public", "app.api.route_modules.public", "router", {"prefix": "/api/v1", "tags": ["public"]}),
        ("integration", "app.api.route_modules.integration", "router", {"prefix": "/api/v1"}),
        ("warehouse", "app.api.route_modules.warehouse", "router", {"prefix": "/api/v1"}),
        ("chat_platform", "app.api.route_modules.chat_platform", "router", {"prefix": "/api/v1", "tags": ["chat"]}),
        ("schedules", "app.api.route_modules.schedules", "router", {"prefix": "/api/v1", "tags": ["schedules"]}),
        ("internal", "app.api.route_modules.internal", "router", {"prefix": "/api/v1", "tags": ["internal"]}),
        ("notifications", "app.api.route_modules.notifications", "router", {"prefix": "/api/v1", "tags": ["notifications"]}),
        ("cms", "app.api.route_modules.cms", "router", {"prefix": "/api/v1", "tags": ["cms"]}),
    ]
    for name, import_path, attr, include_kwargs in _ROUTERS:
        _register(app, name, import_path, attr, critical=name in CRITICAL_ROUTERS, **include_kwargs)

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
        """Health check endpoint.

        Reports router registration so monitoring catches a missing (non-critical)
        router. Critical routers fail the worker boot, so they never appear here.
        """
        failed = _router_status["failed"]
        return JSONResponse(
            status_code=503 if failed else 200,
            content={
                "status": "degraded" if failed else "healthy",
                "service": "dreamify-backend",
                "routers": {
                    "registered": _router_status["registered"],
                    "failed": failed,
                },
            },
        )
    
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
