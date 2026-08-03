"""Dreamify FastAPI entry point for Vercel and local development."""

from collections.abc import Iterable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.platform.access_policy import annotate_and_validate_access_policy
from app.platform.compat_routes import router as compatibility_router
from app.platform.database import Database
from app.platform.errors import ApiError
from app.platform.internal_routes import router as internal_workflow_router
from app.platform.observability import RequestTelemetryMiddleware
from app.platform.operator_brief_routes import router as operator_brief_router
from app.platform.routes import router
from app.platform.seed import seed_database
from app.platform.settings import Settings, get_settings
from app.platform.storage import create_storage
from app.platform.storage_routes import router as storage_router
from app.platform.support_routes import admin_router
from app.platform.support_routes import router as support_router


def route_methods(routes: Iterable[object]) -> Iterable[tuple[str, str]]:
    for route in routes:
        included_router = getattr(route, "original_router", None)
        if included_router is not None:
            yield from route_methods(included_router.routes)
            continue
        path = getattr(route, "path", None)
        for method in getattr(route, "methods", set()) or set():
            if path and method not in {"HEAD", "OPTIONS"}:
                yield method, path


def duplicate_routes(app: FastAPI) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    duplicates: set[tuple[str, str]] = set()
    for key in route_methods(app.routes):
        if key in seen:
            duplicates.add(key)
        seen.add(key)
    return sorted(duplicates)


def create_app(runtime_settings: Settings | None = None) -> FastAPI:
    settings = runtime_settings or get_settings()
    database = Database(settings)
    storage = create_storage(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.auto_create_schema:
            database.create_schema()
        if settings.seed_on_start:
            with database.session() as session:
                seed_database(session, app.state.storage, settings.workflow_slot_count)
        yield
        database.dispose()

    app = FastAPI(
        title="Dreamify Platform API",
        version="2.0.0",
        docs_url="/api/v1/docs",
        redoc_url="/api/v1/redoc",
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.database = database
    app.state.storage = storage
    app.add_middleware(RequestTelemetryMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Demo-User",
            "X-Dreamify-Upload-Reservation",
            "X-Blob-Gateway-Secret",
            "X-Internal-Service-Secret",
            "Last-Event-ID",
            "Idempotency-Key",
            "X-Request-ID",
            "X-Trace-ID",
        ],
        expose_headers=["X-Request-ID", "X-Trace-ID"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_request, error: ApiError):
        body: dict[str, object] = {
            "error": {
                "code": error.code,
                "message": error.message,
                "details": error.details,
            }
        }
        return JSONResponse(status_code=error.status_code, content=body)

    @app.get("/health", tags=["platform"])
    def health():
        return {"status": "ok", "service": "dreamify-api"}

    @app.get("/health/ready", tags=["platform"])
    def readiness():
        with database.session() as session:
            session.execute(text("SELECT 1"))
        return {"status": "ready"}

    app.include_router(router)
    app.include_router(compatibility_router)
    app.include_router(internal_workflow_router)
    app.include_router(storage_router)
    app.include_router(support_router)
    app.include_router(admin_router)
    app.include_router(operator_brief_router)
    duplicates = duplicate_routes(app)
    if duplicates:
        raise RuntimeError(f"Duplicate API routes: {duplicates}")
    annotate_and_validate_access_policy(app.routes)
    return app


app = create_app()
