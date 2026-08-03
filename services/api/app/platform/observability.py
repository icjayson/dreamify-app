"""Minimal structured request telemetry without request bodies or credentials."""

from __future__ import annotations

import json
import re
import sys
from contextvars import ContextVar
from time import monotonic
from typing import Optional
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = b"x-request-id"
TRACE_ID_HEADER = b"x-trace-id"
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_request_id: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
_trace_id: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)


def _safe_header(scope: Scope, name: bytes) -> Optional[str]:
    for key, value in scope.get("headers", []):
        if key.lower() != name:
            continue
        candidate = value.decode("ascii", errors="ignore")
        if _SAFE_IDENTIFIER.fullmatch(candidate):
            return candidate
    return None


def current_request_id() -> Optional[str]:
    return _request_id.get()


def current_trace_id() -> Optional[str]:
    return _trace_id.get()


def correlation_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if request_id := current_request_id():
        headers["X-Request-ID"] = request_id
    if trace_id := current_trace_id():
        headers["X-Trace-ID"] = trace_id
    return headers


class RequestTelemetryMiddleware:
    """Attach correlation IDs and emit one bounded JSON event per HTTP request."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = _safe_header(scope, REQUEST_ID_HEADER) or uuid4().hex
        trace_id = _safe_header(scope, TRACE_ID_HEADER) or request_id
        request_token = _request_id.set(request_id)
        trace_token = _trace_id.set(trace_id)
        status_code = 500
        started = monotonic()

        async def send_with_context(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (REQUEST_ID_HEADER, request_id.encode("ascii")),
                        (TRACE_ID_HEADER, trace_id.encode("ascii")),
                    ]
                )
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_context)
        finally:
            event = {
                "duration_ms": round((monotonic() - started) * 1000, 2),
                "event": "http_request",
                "method": scope.get("method"),
                "path": scope.get("path"),
                "request_id": request_id,
                "status_code": status_code,
                "trace_id": trace_id,
            }
            sys.stdout.write(
                json.dumps(event, separators=(",", ":"), sort_keys=True) + "\n"
            )
            sys.stdout.flush()
            _request_id.reset(request_token)
            _trace_id.reset(trace_token)
