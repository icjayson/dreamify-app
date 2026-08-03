import base64
from pathlib import Path
from typing import AsyncIterator, Callable, Dict

import httpx
import pytest

from app.main import create_app
from app.platform.settings import Settings


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def runtime_settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'platform.sqlite'}",
        cors_origins=["https://app.example.test"],
        auto_create_schema=True,
        seed_on_start=True,
        demo_auth_mode=True,
        owner_admin_allowlist=["owner-id", "owner@example.test"],
        storage_backend="local",
        local_storage_path=tmp_path / "objects",
        workflow_dispatch_url="https://web.example.test/api/workflow/dispatch",
        internal_service_shared_secret="internal-secret",
        provider_encryption_keys={"test-v1": base64.b64encode(b"k" * 32).decode()},
        provider_current_key_version="test-v1",
        workflow_sse_max_seconds=0.05,
        workflow_sse_poll_seconds=0.05,
        max_upload_bytes=1024,
        max_user_storage_bytes=4096,
        max_global_storage_bytes=8192,
    )


@pytest.fixture
def auth_headers() -> Callable[[str], Dict[str, str]]:
    def build(user_id: str = "tenant-a") -> Dict[str, str]:
        return {"X-Demo-User": user_id}

    return build


@pytest.fixture
def app(runtime_settings: Settings):
    return create_app(runtime_settings)


@pytest.fixture
async def client(app) -> AsyncIterator[httpx.AsyncClient]:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://api.example.test"
        ) as api:
            yield api
