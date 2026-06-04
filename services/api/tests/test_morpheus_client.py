"""Tests for the resilient async Morpheus client."""

import asyncio

import httpx
import pytest

from app.services import morpheus_client
from app.services.morpheus_client import (
    CircuitBreaker,
    MorpheusError,
    MorpheusTimeoutError,
    MorpheusUnavailableError,
)


def _install_transport(monkeypatch, handler):
    """Point the shared client at a MockTransport and reset the breaker."""
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, timeout=5.0)
    monkeypatch.setattr(morpheus_client, "_client", client)
    monkeypatch.setattr(
        morpheus_client,
        "_breaker",
        CircuitBreaker(fail_threshold=5, reset_s=30.0),
    )
    return client


def test_run_workflow_success(monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"status": "started", "step": "analyzing"})

    _install_transport(monkeypatch, handler)
    result = asyncio.run(morpheus_client.run_workflow({"x": 1}))
    assert result["status"] == "started"


def test_run_workflow_retries_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 2:
            return httpx.Response(503, json={"detail": "starting up"})
        return httpx.Response(200, json={"status": "started"})

    _install_transport(monkeypatch, handler)
    # Make backoff instant.
    monkeypatch.setattr(morpheus_client, "_cfg_float", lambda name, default: 0.0)
    monkeypatch.setattr(
        morpheus_client,
        "_cfg_int",
        lambda name, default: 2 if "retries" in name else default,
    )
    result = asyncio.run(morpheus_client.run_workflow({"x": 1}))
    assert result["status"] == "started"
    assert calls["n"] == 2


def test_run_workflow_exhausts_retries_raises(monkeypatch):
    def handler(request):
        return httpx.Response(500, json={"detail": "boom"})

    _install_transport(monkeypatch, handler)
    monkeypatch.setattr(morpheus_client, "_cfg_float", lambda name, default: 0.0)
    monkeypatch.setattr(
        morpheus_client,
        "_cfg_int",
        lambda name, default: 1 if "retries" in name else default,
    )
    with pytest.raises(MorpheusError):
        asyncio.run(morpheus_client.run_workflow({"x": 1}))


def test_run_workflow_client_error_not_retried(monkeypatch):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(400, json={"detail": "bad request"})

    _install_transport(monkeypatch, handler)
    with pytest.raises(MorpheusError) as exc_info:
        asyncio.run(morpheus_client.run_workflow({"x": 1}))
    assert exc_info.value.status_code == 400
    assert calls["n"] == 1  # not retried


def test_circuit_opens_then_fast_fails():
    breaker = CircuitBreaker(fail_threshold=2, reset_s=1000.0)

    async def scenario():
        assert await breaker.allow() is True
        await breaker.record_failure()
        await breaker.record_failure()  # threshold reached -> open
        return await breaker.allow()

    assert asyncio.run(scenario()) is False


def test_circuit_half_opens_after_reset():
    breaker = CircuitBreaker(fail_threshold=1, reset_s=0.01)

    async def scenario():
        await breaker.record_failure()  # opens immediately
        assert await breaker.allow() is False
        await asyncio.sleep(0.02)
        return await breaker.allow()  # half-open probe allowed

    assert asyncio.run(scenario()) is True


def test_unavailable_when_circuit_open(monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"status": "started"})

    _install_transport(monkeypatch, handler)
    open_breaker = CircuitBreaker(fail_threshold=1, reset_s=1000.0)
    monkeypatch.setattr(morpheus_client, "_breaker", open_breaker)

    async def scenario():
        # Open the breaker and then attempt a run within the same loop.
        await open_breaker.record_failure()
        await morpheus_client.run_workflow({"x": 1})

    with pytest.raises(MorpheusUnavailableError):
        asyncio.run(scenario())
