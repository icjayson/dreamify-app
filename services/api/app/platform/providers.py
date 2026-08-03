"""Tenant-scoped BYOK connections and server-only credential resolution."""

from typing import Dict, List, Optional
from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.errors import ApiError, not_found
from app.platform.models import ProviderConnection, WorkflowRun, new_id, utc_now
from app.platform.provider_crypto import ProviderSecretCipher, ProviderSecretContext
from app.platform.schemas import ProviderConnectionWrite, ProviderName
from app.platform.settings import Settings

DEFAULT_PROVIDER_MODELS: Dict[str, str] = {
    "openai": "gpt-5.6",
    "gemini": "gemini-3.6-flash",
}
AVAILABLE_PROVIDERS = ("openai", "gemini")


def _secret_context(connection: ProviderConnection) -> ProviderSecretContext:
    return ProviderSecretContext(
        connection_id=connection.id,
        owner_id=connection.owner_id,
        provider=connection.provider,
    )


class ProviderCredentialVerifier:
    """Minimal credential/model smoke tests against fixed provider origins."""

    def __init__(self, settings: Settings):
        self.timeout = settings.provider_validation_timeout_seconds

    def verify(self, provider: ProviderName, api_key: str, model: str) -> None:
        url, headers = self._request(provider, api_key, model)
        try:
            with httpx.Client(
                timeout=self.timeout,
                follow_redirects=False,
            ) as client:
                response = client.get(url, headers=headers)
        except httpx.TransportError as exc:
            raise ApiError(
                503,
                "PROVIDER_UNAVAILABLE",
                "The model provider could not be reached",
            ) from exc
        self._validate_response(response)

    @staticmethod
    def _request(
        provider: ProviderName, api_key: str, model: str
    ) -> tuple[str, Dict[str, str]]:
        escaped_model = quote(model, safe="")
        if provider == "openai":
            return (
                f"https://api.openai.com/v1/models/{escaped_model}",
                {"Authorization": f"Bearer {api_key}"},
            )
        return (
            f"https://generativelanguage.googleapis.com/v1beta/models/{escaped_model}",
            {"x-goog-api-key": api_key},
        )

    @staticmethod
    def _validate_response(response: httpx.Response) -> None:
        if response.is_success:
            return
        if response.status_code in (401, 403):
            raise ApiError(
                422,
                "PROVIDER_CREDENTIAL_INVALID",
                "The model provider rejected this credential",
            )
        if response.status_code == 404:
            raise ApiError(
                422,
                "PROVIDER_MODEL_UNAVAILABLE",
                "The selected model is unavailable for this credential",
            )
        if response.status_code == 429:
            raise ApiError(
                503,
                "PROVIDER_RATE_LIMITED",
                "The model provider rate limit prevented verification",
            )
        if response.status_code >= 500:
            raise ApiError(
                503,
                "PROVIDER_UNAVAILABLE",
                "The model provider is temporarily unavailable",
            )
        raise ApiError(
            422,
            "PROVIDER_VERIFICATION_FAILED",
            "The model provider could not verify this configuration",
        )


class ProviderConnectionService:
    def __init__(
        self,
        session: Session,
        owner_id: str,
        settings: Settings,
        verifier: ProviderCredentialVerifier,
    ) -> None:
        self.session = session
        self.owner_id = owner_id
        self.settings = settings
        self.verifier = verifier

    def list(self) -> List[ProviderConnection]:
        query = (
            select(ProviderConnection)
            .where(ProviderConnection.owner_id == self.owner_id)
            .order_by(ProviderConnection.provider)
        )
        return list(self.session.scalars(query))

    def status(self) -> Dict[str, object]:
        connections = self.list()
        active = next((item for item in connections if item.is_active), None)
        return {
            "model_mode": "byok" if active else "demo",
            "active_provider": active.provider if active else None,
            "byok_configurable": self._encryption_is_configured(),
            "available_providers": list(AVAILABLE_PROVIDERS),
            "connections": connections,
        }

    def upsert(
        self, provider: ProviderName, request: ProviderConnectionWrite
    ) -> ProviderConnection:
        model = request.model or DEFAULT_PROVIDER_MODELS[provider]
        api_key = request.api_key.get_secret_value()
        cipher = ProviderSecretCipher.from_settings(self.settings)
        self.verifier.verify(provider, api_key, model)
        connection = self._get(provider, for_update=True)
        if connection is None:
            connection = ProviderConnection(
                id=new_id(),
                owner_id=self.owner_id,
                provider=provider,
                model=model,
                encrypted_api_key="pending",
                key_version=cipher.current_version,
            )
            self.session.add(connection)
        connection.model = model
        connection.encrypted_api_key = cipher.encrypt(
            api_key, _secret_context(connection)
        )
        connection.key_version = cipher.current_version
        connection.status = "verified"
        connection.verified_at = utc_now()
        if request.activate:
            self._activate(connection)
        self.session.flush()
        return connection

    def activate(self, provider: ProviderName) -> ProviderConnection:
        connection = self._require(provider, for_update=True)
        self._verify_connection(connection)
        self._activate(connection)
        self.session.flush()
        return connection

    def verify(self, provider: ProviderName) -> ProviderConnection:
        connection = self._require(provider, for_update=True)
        self._verify_connection(connection)
        self.session.flush()
        return connection

    def _verify_connection(self, connection: ProviderConnection) -> None:
        cipher = ProviderSecretCipher.from_settings(self.settings)
        api_key, needs_rotation = cipher.decrypt(
            connection.encrypted_api_key, _secret_context(connection)
        )
        self.verifier.verify(connection.provider, api_key, connection.model)
        if needs_rotation:
            connection.encrypted_api_key = cipher.encrypt(
                api_key, _secret_context(connection)
            )
            connection.key_version = cipher.current_version
        connection.status = "verified"
        connection.verified_at = utc_now()

    def delete(self, provider: ProviderName) -> None:
        connection = self._require(provider, for_update=True)
        active_run = self.session.scalar(
            select(WorkflowRun.id).where(
                WorkflowRun.provider_connection_id == connection.id,
                WorkflowRun.status.in_(("queued", "running", "cancelling")),
            )
        )
        if active_run:
            raise ApiError(
                409,
                "PROVIDER_CONNECTION_IN_USE",
                "The provider credential is in use by an active workflow run",
            )
        self.session.delete(connection)
        self.session.flush()

    def active(self) -> Optional[ProviderConnection]:
        query = select(ProviderConnection).where(
            ProviderConnection.owner_id == self.owner_id,
            ProviderConnection.is_active.is_(True),
        )
        return self.session.scalar(query)

    def _activate(self, selected: ProviderConnection) -> None:
        query = select(ProviderConnection).where(
            ProviderConnection.owner_id == self.owner_id
        )
        for connection in self.session.scalars(query.with_for_update()):
            if connection.id != selected.id:
                connection.is_active = False
        self.session.flush()
        selected.is_active = True

    def _get(
        self, provider: ProviderName, for_update: bool = False
    ) -> Optional[ProviderConnection]:
        query = select(ProviderConnection).where(
            ProviderConnection.owner_id == self.owner_id,
            ProviderConnection.provider == provider,
        )
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    def _require(
        self, provider: ProviderName, for_update: bool = False
    ) -> ProviderConnection:
        connection = self._get(provider, for_update)
        if connection is None:
            raise not_found("Provider connection")
        return connection

    def _encryption_is_configured(self) -> bool:
        try:
            ProviderSecretCipher.from_settings(self.settings)
        except ApiError:
            return False
        return True


class InternalProviderService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings

    def resolve(self, run_id: str) -> Dict[str, object]:
        run = self.session.get(WorkflowRun, run_id)
        if run is None:
            raise not_found("Workflow run")
        if run.status not in {"queued", "running", "cancelling"}:
            raise ApiError(
                409,
                "RUN_NOT_ACTIVE",
                "Workflow run cannot resolve a model credential",
            )
        if run.provider_mode != "byok":
            return self._demo()
        if not (
            run.provider_connection_id
            and run.provider_name in AVAILABLE_PROVIDERS
            and run.provider_model
            and run.provider_encrypted_api_key
            and run.provider_key_version
        ):
            raise ApiError(
                503,
                "PROVIDER_SNAPSHOT_INVALID",
                "Workflow provider snapshot is incomplete",
            )
        context = ProviderSecretContext(
            connection_id=run.provider_connection_id,
            owner_id=run.owner_id,
            provider=run.provider_name,
        )
        cipher = ProviderSecretCipher.from_settings(self.settings)
        api_key, needs_rotation = cipher.decrypt(
            run.provider_encrypted_api_key, context
        )
        if needs_rotation:
            run.provider_encrypted_api_key = cipher.encrypt(api_key, context)
            run.provider_key_version = cipher.current_version
            self.session.flush()
        return {
            "mode": "byok",
            "provider": run.provider_name,
            "model": run.provider_model,
            "api_key": api_key,
        }

    @staticmethod
    def _demo() -> Dict[str, object]:
        return {
            "mode": "demo",
            "provider": "demo",
            "model": "deterministic-v1",
            "api_key": None,
        }
