"""
Resilient async HTTP client for the Morpheus LLM service.

Replaces the previous blocking ``requests.post`` call with:
  - a shared ``httpx.AsyncClient`` (no per-request connection setup),
  - exponential backoff retries on transient failures,
  - an in-process circuit breaker that fast-fails while Morpheus is down.

The service URL and all resilience knobs come from
``config.chat_platform`` (env-overridable via ``${VAR}`` substitution in
config.yaml) — nothing here is hardcoded.

NOTE: the circuit breaker state is per-process. Under Gunicorn with multiple
workers each worker self-protects independently; a cross-worker breaker would
require a shared store (Redis) and is intentionally out of scope.
"""

import asyncio
import logging
import random
from typing import Any, Dict, Optional

import httpx

from utils.config import config

logger = logging.getLogger(__name__)


def _chat_platform_cfg():
    return getattr(config, "chat_platform", None)


def _morpheus_base_url() -> str:
    cfg = _chat_platform_cfg()
    if cfg and getattr(cfg, "morpheus_service_url", None):
        return cfg.morpheus_service_url.rstrip("/")
    return "http://localhost:8000"


def _cfg_float(name: str, default: float) -> float:
    cfg = _chat_platform_cfg()
    return float(getattr(cfg, name, default)) if cfg else default


def _cfg_int(name: str, default: int) -> int:
    cfg = _chat_platform_cfg()
    return int(getattr(cfg, name, default)) if cfg else default


class MorpheusError(Exception):
    """Morpheus returned a non-retryable error response (maps to 502)."""

    def __init__(self, detail: str, status_code: Optional[int] = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class MorpheusTimeoutError(MorpheusError):
    """Morpheus did not respond within the timeout (maps to 504)."""


class MorpheusUnavailableError(MorpheusError):
    """Morpheus is unreachable or the circuit is open (maps to 503)."""


class CircuitBreaker:
    """Minimal async circuit breaker: closed -> open -> half-open."""

    def __init__(self, fail_threshold: int, reset_s: float) -> None:
        self._fail_threshold = fail_threshold
        self._reset_s = reset_s
        self._failures = 0
        self._opened_at: Optional[float] = None
        # Created lazily inside a running loop (Python 3.9 binds the loop at
        # Lock construction time, so building it in __init__ would fail).
        self._lock: Optional[asyncio.Lock] = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def allow(self) -> bool:
        async with self._get_lock():
            if self._opened_at is None:
                return True
            elapsed = asyncio.get_event_loop().time() - self._opened_at
            if elapsed >= self._reset_s:
                # Half-open: allow a single probe.
                self._opened_at = None
                self._failures = self._fail_threshold - 1
                return True
            return False

    async def record_success(self) -> None:
        async with self._get_lock():
            self._failures = 0
            self._opened_at = None

    async def record_failure(self) -> None:
        async with self._get_lock():
            self._failures += 1
            if self._failures >= self._fail_threshold and self._opened_at is None:
                self._opened_at = asyncio.get_event_loop().time()
                logger.warning(
                    "Morpheus circuit breaker OPEN after %d consecutive failures",
                    self._failures,
                )


_client: Optional[httpx.AsyncClient] = None
_breaker: Optional[CircuitBreaker] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        timeout = _cfg_float("morpheus_timeout_s", 30.0)
        _client = httpx.AsyncClient(timeout=timeout)
    return _client


def _get_breaker() -> CircuitBreaker:
    global _breaker
    if _breaker is None:
        _breaker = CircuitBreaker(
            fail_threshold=_cfg_int("morpheus_circuit_fail_threshold", 5),
            reset_s=_cfg_float("morpheus_circuit_reset_s", 30.0),
        )
    return _breaker


async def aclose() -> None:
    """Close the shared client (call on app shutdown)."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def run_workflow(payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST to Morpheus ``/run`` with retries + circuit breaking.

    Raises ``MorpheusUnavailableError`` (503), ``MorpheusTimeoutError`` (504),
    or ``MorpheusError`` (502) on failure. Returns the parsed JSON body.
    """
    breaker = _get_breaker()
    if not await breaker.allow():
        raise MorpheusUnavailableError("Morpheus circuit breaker is open")

    url = f"{_morpheus_base_url()}/run"
    max_retries = _cfg_int("morpheus_max_retries", 2)
    backoff_base = _cfg_float("morpheus_backoff_base_s", 0.5)
    client = _get_client()

    last_exc: Optional[Exception] = None
    for attempt in range(max_retries + 1):
        try:
            response = await client.post(url, json=payload)
            if response.status_code >= 500:
                # Server-side failure is retryable.
                raise httpx.HTTPStatusError(
                    f"Morpheus returned {response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            await breaker.record_success()
            return response.json()
        except httpx.TimeoutException as exc:
            last_exc = exc
            logger.warning("Morpheus timeout (attempt %d): %s", attempt + 1, exc)
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status is not None and status < 500:
                # Non-retryable client error.
                await breaker.record_failure()
                raise MorpheusError(
                    f"Morpheus rejected request: {status}", status_code=status
                ) from exc
            last_exc = exc
            logger.warning("Morpheus 5xx (attempt %d): %s", attempt + 1, exc)
        except httpx.HTTPError as exc:
            # ConnectError, ReadError, etc. — retryable transport failures.
            last_exc = exc
            logger.warning(
                "Morpheus transport error (attempt %d): %s", attempt + 1, exc
            )

        if attempt < max_retries:
            delay = backoff_base * (2**attempt) + random.uniform(0, backoff_base)
            await asyncio.sleep(delay)

    # All attempts exhausted.
    await breaker.record_failure()
    if isinstance(last_exc, httpx.TimeoutException):
        raise MorpheusTimeoutError("Morpheus service timeout") from last_exc
    if isinstance(last_exc, httpx.ConnectError):
        raise MorpheusUnavailableError("Morpheus service unavailable") from last_exc
    raise MorpheusError(str(last_exc) if last_exc else "Morpheus request failed")
