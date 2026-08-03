import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from app.main import create_app
from app.platform.errors import ApiError
from app.platform.models import Asset, StoredObject, UploadReservation, utc_now
from app.platform.settings import Settings
from app.platform.storage import (
    ObjectStorage,
    SignedDownload,
    StorageMetadata,
    UploadTarget,
    VercelBlobStorage,
)


async def create_project(client, headers):
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": "Uploads"}
    )
    assert response.status_code == 201
    return response.json()["id"]


def intent_payload(project_id, content, key="request-key-0001"):
    return {
        "project_id": project_id,
        "filename": "dataset.csv",
        "content_type": "text/csv",
        "size_bytes": len(content),
        "checksum_sha256": hashlib.sha256(content).hexdigest(),
        "idempotency_key": key,
    }


@pytest.mark.anyio
async def test_upload_intent_and_finalize_are_idempotent(client, auth_headers):
    headers = auth_headers("tenant-a")
    content = b"a,b\n1,2\n"
    project_id = await create_project(client, headers)
    payload = intent_payload(project_id, content)

    first = await client.post("/api/v1/uploads/intents", headers=headers, json=payload)
    repeated = await client.post(
        "/api/v1/uploads/intents", headers=headers, json=payload
    )
    assert first.status_code == repeated.status_code == 201
    assert first.json()["id"] == repeated.json()["id"]
    assert first.json()["upload"]["kind"] == "local_proxy"

    reservation_id = first.json()["id"]
    uploaded = await client.put(
        f"/api/v1/uploads/{reservation_id}/content",
        headers={**headers, "Content-Type": "text/csv"},
        content=content,
    )
    assert uploaded.status_code == 202, uploaded.text
    asset = await client.post(
        f"/api/v1/uploads/{reservation_id}/finalize", headers=headers
    )
    repeated_asset = await client.post(
        f"/api/v1/uploads/{reservation_id}/finalize", headers=headers
    )
    web_alias = await client.post(
        f"/api/v1/uploads/intents/{reservation_id}/finalize", headers=headers
    )
    assert asset.status_code == repeated_asset.status_code == 200
    assert web_alias.status_code == 200
    assert asset.json()["id"] == repeated_asset.json()["id"]
    assert web_alias.json()["id"] == asset.json()["id"]
    assert asset.json()["size_bytes"] == len(content)


@pytest.mark.anyio
async def test_upload_boundaries_and_tenant_isolation(client, auth_headers):
    owner = auth_headers("tenant-a")
    outsider = auth_headers("tenant-b")
    project_id = await create_project(client, owner)
    content = b"abc"
    response = await client.post(
        "/api/v1/uploads/intents",
        headers=owner,
        json=intent_payload(project_id, content, "request-key-0002"),
    )
    reservation_id = response.json()["id"]

    hidden = await client.put(
        f"/api/v1/uploads/{reservation_id}/content",
        headers={**outsider, "Content-Type": "text/csv"},
        content=content,
    )
    assert hidden.status_code == 404
    oversized = await client.put(
        f"/api/v1/uploads/{reservation_id}/content",
        headers={**owner, "Content-Type": "text/csv"},
        content=content + b"x",
    )
    assert oversized.status_code == 413

    invalid_name = await client.post(
        "/api/v1/uploads/intents",
        headers=owner,
        json={
            **intent_payload(project_id, content, "request-key-0003"),
            "filename": "../x.csv",
        },
    )
    assert invalid_name.status_code == 400
    unsupported = await client.post(
        "/api/v1/uploads/intents",
        headers=owner,
        json={
            **intent_payload(project_id, content, "request-key-format"),
            "filename": "notes.txt",
            "content_type": "text/plain",
        },
    )
    assert unsupported.status_code == 415
    assert unsupported.json()["error"]["code"] == "UNSUPPORTED_FILE_FORMAT"
    too_large = await client.post(
        "/api/v1/uploads/intents",
        headers=owner,
        json={
            **intent_payload(project_id, b"x" * 1025, "request-key-0004"),
            "checksum_sha256": None,
        },
    )
    assert too_large.status_code == 413

    mismatched_type = await client.post(
        "/api/v1/uploads/intents",
        headers=owner,
        json={
            **intent_payload(project_id, b"[]", "request-key-mime"),
            "filename": "dataset.json",
            "content_type": "text/csv",
        },
    )
    assert mismatched_type.status_code == 415
    assert mismatched_type.json()["error"]["code"] == "FILE_TYPE_MISMATCH"


@pytest.mark.anyio
async def test_finalize_rejects_short_or_tampered_upload(client, auth_headers):
    headers = auth_headers()
    project_id = await create_project(client, headers)
    expected = b"abcdef"
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=headers,
        json=intent_payload(project_id, expected, "request-key-0005"),
    )
    reservation_id = intent.json()["id"]
    assert (
        await client.put(
            f"/api/v1/uploads/{reservation_id}/content",
            headers={**headers, "Content-Type": "text/csv"},
            content=b"abc",
        )
    ).status_code == 202
    finalized = await client.post(
        f"/api/v1/uploads/{reservation_id}/finalize", headers=headers
    )
    assert finalized.status_code == 409
    assert finalized.json()["error"]["code"] == "UPLOAD_SIZE_MISMATCH"

    same_size_intent = await client.post(
        "/api/v1/uploads/intents",
        headers=headers,
        json=intent_payload(project_id, expected, "request-key-tampered-checksum"),
    )
    same_size_id = same_size_intent.json()["id"]
    assert (
        await client.put(
            f"/api/v1/uploads/{same_size_id}/content",
            headers={**headers, "Content-Type": "text/csv"},
            content=b"abcdeg",
        )
    ).status_code == 202
    checksum_rejected = await client.post(
        f"/api/v1/uploads/{same_size_id}/finalize", headers=headers
    )
    assert checksum_rejected.status_code == 409
    assert checksum_rejected.json()["error"]["code"] == "UPLOAD_CHECKSUM_MISMATCH"


@pytest.mark.anyio
async def test_deleted_and_expired_upload_objects_are_cleaned_and_release_quota(
    client, app, auth_headers, runtime_settings
):
    headers = auth_headers("cleanup-owner")
    content = b"a,b\n1,2\n"
    project_id = await create_project(client, headers)
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=headers,
        json=intent_payload(project_id, content, "cleanup-finalized"),
    )
    intent_body = intent.json()
    await client.put(
        f"/api/v1/uploads/{intent_body['id']}/content",
        headers={**headers, "Content-Type": "text/csv"},
        content=content,
    )
    finalized = await client.post(
        f"/api/v1/uploads/{intent_body['id']}/finalize", headers=headers
    )
    asset_id = finalized.json()["id"]
    with app.state.database.session() as session:
        stored_object_id = session.get(Asset, asset_id).stored_object_id
    assert (
        await client.delete(f"/api/v1/assets/{asset_id}", headers=headers)
    ).status_code == 204

    runtime_settings.max_user_storage_bytes = len(content) * 2 - 1
    blocked = await client.post(
        "/api/v1/uploads/intents",
        headers=headers,
        json=intent_payload(project_id, content, "cleanup-blocked"),
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "USER_STORAGE_QUOTA"

    expired = await client.post(
        "/api/v1/uploads/intents",
        headers=headers,
        json=intent_payload(project_id, b"x\n", "cleanup-expired"),
    )
    expired_body = expired.json()
    await client.put(
        f"/api/v1/uploads/{expired_body['id']}/content",
        headers={**headers, "Content-Type": "text/csv"},
        content=b"x\n",
    )
    with app.state.database.session() as session:
        reservation = session.get(UploadReservation, expired_body["id"])
        reservation.expires_at = utc_now() - timedelta(seconds=1)

    cleaned = await client.post(
        "/api/v1/internal/storage/cleanup",
        headers={"X-Internal-Service-Secret": "internal-secret"},
    )
    assert cleaned.status_code == 200, cleaned.text
    assert cleaned.json() == {
        "expired_reservations": 1,
        "deleted_assets": 1,
        "deleted_objects": 1,
        "storage_failures": 0,
    }
    with app.state.database.session() as session:
        assert session.get(Asset, asset_id) is None
        assert session.get(StoredObject, stored_object_id) is None
        assert session.get(UploadReservation, expired_body["id"]).status == "expired"

    released = await client.post(
        "/api/v1/uploads/intents",
        headers=headers,
        json=intent_payload(project_id, content, "cleanup-released"),
    )
    assert released.status_code == 201, released.text


class FakeVercelStorage(ObjectStorage):
    backend = "vercel_blob"
    supports_checksum_verification = True

    def __init__(self):
        self.objects = {}
        self.contents = {}

    def upload_target(self, reservation_id, pathname, content_type):
        return UploadTarget(
            "vercel_client_upload",
            "POST",
            "/api/blob/upload",
            pathname,
            {"Content-Type": "application/json"},
        )

    def head(self, pathname, verify_checksum=False):
        if pathname not in self.objects:
            raise ApiError(409, "UPLOAD_INCOMPLETE", "Blob object is not available")
        return self.objects[pathname]

    def delete(self, pathname):
        self.objects.pop(pathname, None)
        self.contents.pop(pathname, None)

    def get_bytes(self, pathname):
        return self.contents[pathname]

    def put_bytes(self, pathname, content, content_type, overwrite=True):
        if not overwrite and pathname in self.objects:
            raise ApiError(409, "OBJECT_EXISTS", "Immutable object already exists")
        checksum = hashlib.sha256(content).hexdigest()
        metadata = StorageMetadata(
            pathname=pathname,
            content_type=content_type,
            size_bytes=len(content),
            checksum_sha256=checksum,
            etag=checksum,
            url=f"https://private.blob.example/{pathname}",
        )
        self.objects[pathname] = metadata
        self.contents[pathname] = content
        return metadata

    def signed_get_url(self, pathname, ttl_seconds):
        assert pathname in self.objects
        return SignedDownload(
            url="https://signed.blob.example/download",
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds),
        )


@pytest.mark.anyio
async def test_hobby_ten_mib_boundary_uses_direct_blob_upload(tmp_path: Path):
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'boundary.sqlite'}",
        cors_origins=["https://app.example.test"],
        auto_create_schema=True,
        seed_on_start=True,
        demo_auth_mode=True,
        storage_backend="vercel_blob",
        vercel_blob_token="test-token",
        blob_upload_gateway_url="/api/blob/upload",
        blob_signing_gateway_url="/api/blob/sign",
        blob_gateway_shared_secret="gateway-secret",
        internal_service_shared_secret="internal-secret",
    )
    app = create_app(settings)
    app.state.storage = FakeVercelStorage()
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://api.test"
        ) as api:
            headers = {"X-Demo-User": "boundary-owner"}
            project_id = await create_project(api, headers)
            exact = await api.post(
                "/api/v1/uploads/intents",
                headers=headers,
                json={
                    "project_id": project_id,
                    "filename": "boundary.csv",
                    "content_type": "text/csv",
                    "size_bytes": 10 * 1024 * 1024,
                    "client_request_id": "boundary-exact",
                },
            )
            assert exact.status_code == 201, exact.text
            assert exact.json()["upload"]["kind"] == "vercel_client_upload"
            assert exact.json()["upload"]["url"] == "/api/blob/upload"

            oversized = await api.post(
                "/api/v1/uploads/intents",
                headers=headers,
                json={
                    "project_id": project_id,
                    "filename": "oversized.csv",
                    "content_type": "text/csv",
                    "size_bytes": 10 * 1024 * 1024 + 1,
                    "client_request_id": "boundary-over",
                },
            )
            assert oversized.status_code == 413
            assert oversized.json()["error"]["code"] == "UPLOAD_TOO_LARGE"


def test_vercel_blob_signing_gateway_contract(monkeypatch):
    captured = {}
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=300)

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "url": "https://signed.blob.example/download",
                "expires_at": expires_at.isoformat(),
            }

    def fake_post(url, *, headers, json, timeout):
        captured.update(
            {"url": url, "headers": headers, "json": json, "timeout": timeout}
        )
        return Response()

    monkeypatch.setattr("app.platform.storage.httpx.post", fake_post)
    storage = VercelBlobStorage(
        token="test-token",
        access="private",
        gateway_url="https://app.example.test/api/blob/upload",
        signing_gateway_url="https://app.example.test/api/blob/sign",
        gateway_secret="gateway-secret",
    )

    signed = storage.signed_get_url("uploads/tenant/asset.csv", 300)

    assert signed.url == "https://signed.blob.example/download"
    assert signed.expires_at == expires_at
    assert captured == {
        "url": "https://app.example.test/api/blob/sign",
        "headers": {"X-Blob-Gateway-Secret": "gateway-secret"},
        "json": {
            "pathname": "uploads/tenant/asset.csv",
            "operation": "get",
            "valid_for_seconds": 300,
        },
        "timeout": 10,
    }


def test_vercel_blob_server_side_artifact_round_trip(monkeypatch):
    content = b'{"rows":10}'
    calls = []

    class BlobResult:
        pathname = "workflow/run/profile.json"
        content_type = "application/json"
        size = len(content)
        etag = "blob-etag"
        url = "https://blob.example/profile.json"

    class Download:
        def __bytes__(self):
            return content

    class Client:
        def put(self, pathname, body, **kwargs):
            calls.append(("put", pathname, body, kwargs))

        def head(self, pathname):
            calls.append(("head", pathname))
            return BlobResult()

        def get(self, pathname, **kwargs):
            calls.append(("get", pathname, kwargs))
            return Download()

    storage = VercelBlobStorage(
        token="test-token",
        access="private",
        gateway_url="https://app.example.test/api/blob/upload",
        signing_gateway_url="https://app.example.test/api/blob/sign",
        gateway_secret="gateway-secret",
    )
    monkeypatch.setattr(storage, "_client", lambda: Client())

    metadata = storage.put_bytes(
        "workflow/run/profile.json", content, "application/json"
    )

    assert metadata.size_bytes == len(content)
    assert metadata.checksum_sha256 == hashlib.sha256(content).hexdigest()
    assert storage.get_bytes("workflow/run/profile.json") == content
    assert calls == [
        (
            "put",
            "workflow/run/profile.json",
            content,
            {
                "access": "private",
                "content_type": "application/json",
                "add_random_suffix": False,
                "overwrite": True,
            },
        ),
        ("head", "workflow/run/profile.json"),
        ("get", "workflow/run/profile.json", {"access": "private"}),
    ]


@pytest.mark.anyio
async def test_blob_gateway_contract_and_server_authenticated_completion(
    tmp_path: Path,
):
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'blob.sqlite'}",
        cors_origins=["https://app.example.test"],
        auto_create_schema=True,
        seed_on_start=True,
        demo_auth_mode=True,
        storage_backend="vercel_blob",
        vercel_blob_token="test-token",
        blob_upload_gateway_url="/api/blob/upload",
        blob_signing_gateway_url="/api/blob/sign",
        blob_gateway_shared_secret="gateway-secret",
        internal_service_shared_secret="internal-secret",
    )
    app = create_app(settings)
    fake_storage = FakeVercelStorage()
    app.state.storage = fake_storage
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://api.test"
        ) as api:
            user_headers = {"X-Demo-User": "tenant-a"}
            project_id = await create_project(api, user_headers)
            content = b"one,two\n1,2\n"
            checksum = hashlib.sha256(content).hexdigest()
            client_request_id = "client-request-0001"
            intent = await api.post(
                "/api/v1/uploads/intents",
                headers=user_headers,
                json={
                    "project_id": project_id,
                    "filename": "dataset.csv",
                    "content_type": "text/csv",
                    "size_bytes": len(content),
                    "checksum_sha256": checksum,
                    "client_request_id": client_request_id,
                },
            )
            assert intent.status_code == 201, intent.text
            intent_body = intent.json()
            assert intent_body["intent_id"] == intent_body["id"]
            assert intent_body["client_request_id"] == client_request_id
            callback = {
                "intent_id": intent_body["intent_id"],
                "client_request_id": client_request_id,
                "pathname": intent_body["pathname"],
                "content_type": "text/csv",
                "size_bytes": len(content),
                "checksum_sha256": checksum,
            }
            validation = await api.post(
                "/api/v1/uploads/blob-token/validate",
                headers=user_headers,
                json=callback,
            )
            assert validation.status_code == 200, validation.text
            assert validation.json()["size_bytes"] == len(content)
            assert validation.json()["checksum_sha256"] == checksum
            fake_storage.objects[intent_body["pathname"]] = StorageMetadata(
                pathname=intent_body["pathname"],
                content_type="text/csv",
                size_bytes=len(content),
                checksum_sha256=checksum,
                etag="etag-1",
                url="https://private.blob.example/dataset.csv",
            )
            fake_storage.contents[intent_body["pathname"]] = content
            unauthorized = await api.post(
                "/api/v1/uploads/blob-completed", json=callback
            )
            assert unauthorized.status_code == 401
            completed = await api.post(
                "/api/v1/uploads/blob-completed",
                headers={"X-Blob-Gateway-Secret": "gateway-secret"},
                json=callback,
            )
            repeated = await api.post(
                "/api/v1/uploads/blob-completed",
                headers={"X-Blob-Gateway-Secret": "gateway-secret"},
                json=callback,
            )
            assert completed.status_code == repeated.status_code == 200
            assert completed.json()["id"] == repeated.json()["id"]
            polled = await api.get(
                f"/api/v1/uploads/intents/{intent_body['intent_id']}",
                headers=user_headers,
            )
            assert polled.json()["status"] == "finalized"
            assert polled.json()["asset_id"] == completed.json()["id"]

            run = await api.post(
                "/api/v1/workflow-runs",
                headers=user_headers,
                json={
                    "project_id": project_id,
                    "asset_ids": [completed.json()["id"]],
                    "input": {"question": "Summarize"},
                },
            )
            assert run.status_code == 201, run.text
            with app.state.database.session() as session:
                object_id = session.scalar(
                    select(StoredObject.id).where(StoredObject.owner_id == "tenant-a")
                )
            resolver_payload = {"run_id": run.json()["id"], "object_id": object_id}
            unauthorized_resolve = await api.post(
                "/api/v1/internal/assets/resolve", json=resolver_payload
            )
            assert unauthorized_resolve.status_code == 401
            resolved = await api.post(
                "/api/v1/internal/assets/resolve",
                headers={"X-Internal-Service-Secret": "internal-secret"},
                json=resolver_payload,
            )
            assert resolved.status_code == 200, resolved.text
            assert resolved.json()["sha256"] == checksum
            assert resolved.json()["relative_path"].startswith("input/")
            assert resolved.json()["download_url"].startswith("https://signed.")
            missing_membership = await api.post(
                "/api/v1/internal/assets/resolve",
                headers={"X-Internal-Service-Secret": "internal-secret"},
                json={"run_id": run.json()["id"], "object_id": "not-linked"},
            )
            assert missing_membership.status_code == 404
