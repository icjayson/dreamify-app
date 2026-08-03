"""Provider-neutral object storage boundary."""

import hashlib
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import AsyncIterator, Dict, Optional

import httpx

from app.platform.errors import ApiError, feature_disabled
from app.platform.settings import Settings


@dataclass(frozen=True)
class StorageMetadata:
    pathname: str
    content_type: str
    size_bytes: int
    checksum_sha256: Optional[str]
    etag: Optional[str]
    url: Optional[str]


@dataclass(frozen=True)
class UploadTarget:
    kind: str
    method: str
    url: str
    pathname: str
    headers: Dict[str, str]


@dataclass(frozen=True)
class SignedDownload:
    url: str
    expires_at: datetime


class ObjectStorage:
    backend = "unknown"
    supports_checksum_verification = False
    supports_local_proxy = False

    def upload_target(
        self, reservation_id: str, pathname: str, content_type: str
    ) -> UploadTarget:
        raise NotImplementedError

    async def put_stream(
        self,
        pathname: str,
        chunks: AsyncIterator[bytes],
        content_type: str,
        max_bytes: int,
    ) -> StorageMetadata:
        raise feature_disabled("server-side object upload")

    def head(self, pathname: str, verify_checksum: bool = False) -> StorageMetadata:
        raise NotImplementedError

    def delete(self, pathname: str) -> None:
        raise NotImplementedError

    def put_bytes(
        self,
        pathname: str,
        content: bytes,
        content_type: str,
        overwrite: bool = True,
    ) -> StorageMetadata:
        raise feature_disabled("server-side object persistence")

    def get_bytes(self, pathname: str) -> bytes:
        raise feature_disabled("server-side object reads")

    def signed_get_url(self, pathname: str, ttl_seconds: int) -> SignedDownload:
        raise feature_disabled("signed object download")


class LocalObjectStorage(ObjectStorage):
    backend = "local"
    supports_checksum_verification = True
    supports_local_proxy = True

    def __init__(self, root: Path):
        self.root = root.resolve()

    def _path(self, pathname: str) -> Path:
        candidate = (self.root / pathname).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise ApiError(
                400, "INVALID_STORAGE_PATH", "Storage path is outside its root"
            )
        return candidate

    def _content_type_path(self, pathname: str) -> Path:
        return self._path(pathname + ".content-type")

    def upload_target(
        self, reservation_id: str, pathname: str, content_type: str
    ) -> UploadTarget:
        return UploadTarget(
            kind="local_proxy",
            method="PUT",
            url=f"/api/v1/uploads/{reservation_id}/content",
            pathname=pathname,
            headers={"Content-Type": content_type},
        )

    async def put_stream(
        self,
        pathname: str,
        chunks: AsyncIterator[bytes],
        content_type: str,
        max_bytes: int,
    ) -> StorageMetadata:
        target = self._path(pathname)
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size_bytes = 0
        temporary_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=target.parent, delete=False
            ) as temporary:
                temporary_path = Path(temporary.name)
                async for chunk in chunks:
                    size_bytes += len(chunk)
                    if size_bytes > max_bytes:
                        raise ApiError(
                            413,
                            "UPLOAD_TOO_LARGE",
                            "Uploaded object exceeds its reservation",
                        )
                    digest.update(chunk)
                    temporary.write(chunk)
            os.replace(str(temporary_path), str(target))
            self._content_type_path(pathname).write_text(content_type, encoding="utf-8")
        except Exception:
            if temporary_path and temporary_path.exists():
                temporary_path.unlink()
            raise
        checksum = digest.hexdigest()
        return StorageMetadata(
            pathname, content_type, size_bytes, checksum, checksum, None
        )

    def head(self, pathname: str, verify_checksum: bool = False) -> StorageMetadata:
        target = self._path(pathname)
        if not target.is_file():
            raise ApiError(
                409, "UPLOAD_INCOMPLETE", "Reserved object has not been uploaded"
            )
        digest = hashlib.sha256()
        with target.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        checksum = digest.hexdigest()
        type_path = self._content_type_path(pathname)
        content_type = (
            type_path.read_text(encoding="utf-8")
            if type_path.exists()
            else "application/octet-stream"
        )
        return StorageMetadata(
            pathname, content_type, target.stat().st_size, checksum, checksum, None
        )

    def delete(self, pathname: str) -> None:
        target = self._path(pathname)
        if target.exists():
            target.unlink()
        type_path = self._content_type_path(pathname)
        if type_path.exists():
            type_path.unlink()

    def put_bytes(
        self,
        pathname: str,
        content: bytes,
        content_type: str,
        overwrite: bool = True,
    ) -> StorageMetadata:
        target = self._path(pathname)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Optional[Path] = None
        created_target = False
        try:
            with tempfile.NamedTemporaryFile(
                dir=target.parent, delete=False
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(content)
            if overwrite:
                os.replace(str(temporary_path), str(target))
            else:
                try:
                    os.link(str(temporary_path), str(target))
                except FileExistsError as error:
                    raise ApiError(
                        409,
                        "OBJECT_EXISTS",
                        "Immutable object already exists",
                    ) from error
                created_target = True
                temporary_path.unlink()
            self._content_type_path(pathname).write_text(content_type, encoding="utf-8")
        except Exception:
            if temporary_path and temporary_path.exists():
                temporary_path.unlink()
            if created_target and target.exists():
                target.unlink()
            raise
        checksum = hashlib.sha256(content).hexdigest()
        return StorageMetadata(
            pathname, content_type, len(content), checksum, checksum, None
        )

    def get_bytes(self, pathname: str) -> bytes:
        target = self._path(pathname)
        if not target.is_file():
            raise ApiError(404, "OBJECT_NOT_FOUND", "Stored object is unavailable")
        return target.read_bytes()


class VercelBlobStorage(ObjectStorage):
    """Metadata adapter; browser uploads are brokered by the Next.js gateway."""

    backend = "vercel_blob"
    supports_checksum_verification = True

    def __init__(
        self,
        token: str,
        access: str,
        gateway_url: str,
        signing_gateway_url: str,
        gateway_secret: str,
    ):
        self.token = token
        self.access = access
        self.gateway_url = gateway_url.rstrip("/")
        self.signing_gateway_url = signing_gateway_url
        self.gateway_secret = gateway_secret

    def _client(self):
        try:
            from vercel.blob import BlobClient
        except ImportError as exc:
            raise ApiError(
                503, "STORAGE_UNAVAILABLE", "Vercel Blob SDK is unavailable"
            ) from exc
        return BlobClient(token=self.token)

    def upload_target(
        self, reservation_id: str, pathname: str, content_type: str
    ) -> UploadTarget:
        return UploadTarget(
            kind="vercel_client_upload",
            method="POST",
            url=self.gateway_url,
            pathname=pathname,
            headers={
                "Content-Type": "application/json",
                "X-Dreamify-Upload-Reservation": reservation_id,
            },
        )

    def head(self, pathname: str, verify_checksum: bool = False) -> StorageMetadata:
        try:
            client = self._client()
            result = client.head(pathname)
            checksum = None
            if verify_checksum:
                content = client.get(pathname, access=self.access)
                if not isinstance(content, bytes):
                    content = bytes(content)
                checksum = hashlib.sha256(content).hexdigest()
        except Exception as exc:
            raise ApiError(
                409, "UPLOAD_INCOMPLETE", "Blob object is not available"
            ) from exc
        return StorageMetadata(
            pathname=result.pathname,
            content_type=result.content_type,
            size_bytes=result.size,
            checksum_sha256=checksum,
            etag=result.etag,
            url=result.url,
        )

    def delete(self, pathname: str) -> None:
        self._client().delete(pathname)

    def put_bytes(
        self,
        pathname: str,
        content: bytes,
        content_type: str,
        overwrite: bool = True,
    ) -> StorageMetadata:
        try:
            client = self._client()
            client.put(
                pathname,
                content,
                access=self.access,
                content_type=content_type,
                add_random_suffix=False,
                overwrite=overwrite,
            )
            result = client.head(pathname)
        except Exception as exc:
            raise ApiError(
                503, "STORAGE_WRITE_UNAVAILABLE", "Object persistence is unavailable"
            ) from exc
        checksum = hashlib.sha256(content).hexdigest()
        return StorageMetadata(
            pathname=result.pathname,
            content_type=result.content_type,
            size_bytes=result.size,
            checksum_sha256=checksum,
            etag=result.etag,
            url=result.url,
        )

    def get_bytes(self, pathname: str) -> bytes:
        try:
            content = self._client().get(pathname, access=self.access)
            return content if isinstance(content, bytes) else bytes(content)
        except Exception as exc:
            raise ApiError(
                404, "OBJECT_NOT_FOUND", "Stored object is unavailable"
            ) from exc

    def signed_get_url(self, pathname: str, ttl_seconds: int) -> SignedDownload:
        try:
            response = httpx.post(
                self.signing_gateway_url,
                headers={"X-Blob-Gateway-Secret": self.gateway_secret},
                json={
                    "pathname": pathname,
                    "operation": "get",
                    "valid_for_seconds": ttl_seconds,
                },
                timeout=10,
            )
            response.raise_for_status()
            payload = response.json()
            url = payload.get("url") or payload.get("presignedUrl")
            if not isinstance(url, str) or not url.startswith("https://"):
                raise ValueError("Signing gateway returned an invalid URL")
            expires_raw = payload.get("expires_at")
            if not isinstance(expires_raw, str):
                raise ValueError("Signing gateway omitted expiration")
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
            if expires_at.tzinfo is None:
                raise ValueError("Signing gateway expiration must include a timezone")
            now = datetime.now(timezone.utc)
            if not now < expires_at <= now + timedelta(seconds=ttl_seconds + 30):
                raise ValueError(
                    "Signing gateway expiration is outside the requested TTL"
                )
        except Exception as exc:
            raise ApiError(
                503, "STORAGE_SIGNING_UNAVAILABLE", "Signed download is unavailable"
            ) from exc
        return SignedDownload(url=url, expires_at=expires_at)


def create_storage(settings: Settings) -> ObjectStorage:
    if settings.storage_backend == "local":
        return LocalObjectStorage(settings.local_storage_path)
    if not (
        settings.vercel_blob_token
        and settings.blob_upload_gateway_url
        and settings.blob_signing_gateway_url
        and settings.blob_gateway_shared_secret
    ):
        raise ValueError("Vercel Blob storage requires token and gateway configuration")
    return VercelBlobStorage(
        settings.vercel_blob_token,
        settings.vercel_blob_access,
        settings.blob_upload_gateway_url,
        settings.blob_signing_gateway_url,
        settings.blob_gateway_shared_secret,
    )
