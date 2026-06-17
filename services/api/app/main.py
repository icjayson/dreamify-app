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
