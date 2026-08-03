"""Authenticated encryption for tenant-scoped BYOK credentials."""

import base64
import json
import os
from dataclasses import dataclass
from typing import Dict, Tuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.platform.errors import ApiError
from app.platform.settings import Settings


@dataclass(frozen=True)
class ProviderSecretContext:
    connection_id: str
    owner_id: str
    provider: str

    def associated_data(self, key_version: str) -> bytes:
        value = {
            "connection_id": self.connection_id,
            "key_version": key_version,
            "owner_id": self.owner_id,
            "provider": self.provider,
        }
        return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


class ProviderSecretCipher:
    """AES-256-GCM keyring with explicit versions and bound row identity."""

    def __init__(self, keys: Dict[str, str], current_version: str):
        self._keys = {
            version: self._decode_key(value) for version, value in keys.items()
        }
        self.current_version = current_version
        if not self._keys or current_version not in self._keys:
            raise self._unavailable()

    @classmethod
    def from_settings(cls, settings: Settings) -> "ProviderSecretCipher":
        return cls(
            settings.provider_encryption_keys,
            settings.provider_current_key_version,
        )

    @staticmethod
    def _decode_key(value: str) -> bytes:
        try:
            decoded = base64.b64decode(value, altchars=b"-_", validate=True)
        except (ValueError, TypeError) as exc:
            raise ProviderSecretCipher._unavailable() from exc
        if len(decoded) != 32:
            raise ProviderSecretCipher._unavailable()
        return decoded

    @staticmethod
    def _unavailable() -> ApiError:
        return ApiError(
            503,
            "BYOK_NOT_CONFIGURED",
            "Encrypted model credentials are not configured for this deployment",
        )

    @staticmethod
    def _decode_token(token: str) -> Tuple[str, bytes, bytes]:
        try:
            scheme, version, nonce_value, ciphertext_value = token.split(":", 3)
            if scheme != "aesgcm" or not version:
                raise ValueError
            nonce = base64.urlsafe_b64decode(nonce_value.encode())
            ciphertext = base64.urlsafe_b64decode(ciphertext_value.encode())
        except (ValueError, TypeError) as exc:
            raise ProviderSecretCipher._decrypt_failed() from exc
        if len(nonce) != 12 or len(ciphertext) < 17:
            raise ProviderSecretCipher._decrypt_failed()
        return version, nonce, ciphertext

    @staticmethod
    def _decrypt_failed() -> ApiError:
        return ApiError(
            503,
            "PROVIDER_SECRET_UNAVAILABLE",
            "The configured model credential could not be decrypted",
        )

    def encrypt(self, secret: str, context: ProviderSecretContext) -> str:
        nonce = os.urandom(12)
        version = self.current_version
        ciphertext = AESGCM(self._keys[version]).encrypt(
            nonce,
            secret.encode(),
            context.associated_data(version),
        )
        nonce_value = base64.urlsafe_b64encode(nonce).decode()
        ciphertext_value = base64.urlsafe_b64encode(ciphertext).decode()
        return f"aesgcm:{version}:{nonce_value}:{ciphertext_value}"

    def decrypt(self, token: str, context: ProviderSecretContext) -> Tuple[str, bool]:
        version, nonce, ciphertext = self._decode_token(token)
        key = self._keys.get(version)
        if key is None:
            raise self._decrypt_failed()
        try:
            plaintext = AESGCM(key).decrypt(
                nonce,
                ciphertext,
                context.associated_data(version),
            )
            secret = plaintext.decode()
        except (InvalidTag, UnicodeDecodeError) as exc:
            raise self._decrypt_failed() from exc
        return secret, version != self.current_version
