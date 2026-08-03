import json

import pytest


@pytest.mark.anyio
async def test_request_ids_are_validated_echoed_and_logged(client, capfd):
    response = await client.get(
        "/health",
        headers={
            "X-Request-ID": "request.safe-123",
            "X-Trace-ID": "trace.safe-456",
            "Authorization": "Bearer must-not-appear",
        },
    )

    assert response.headers["x-request-id"] == "request.safe-123"
    assert response.headers["x-trace-id"] == "trace.safe-456"
    output = capfd.readouterr().out
    events = [
        json.loads(line)
        for line in output.splitlines()
        if '"event":"http_request"' in line
    ]
    assert events[-1] == {
        "duration_ms": events[-1]["duration_ms"],
        "event": "http_request",
        "method": "GET",
        "path": "/health",
        "request_id": "request.safe-123",
        "status_code": 200,
        "trace_id": "trace.safe-456",
    }
    assert "must-not-appear" not in output


@pytest.mark.anyio
async def test_unsafe_request_id_is_replaced_and_query_is_not_logged(client, capfd):
    response = await client.get(
        "/health?token=query-secret",
        headers={"X-Request-ID": "bad request id"},
    )

    generated = response.headers["x-request-id"]
    assert generated != "bad request id"
    assert len(generated) == 32
    output = capfd.readouterr().out
    assert "query-secret" not in output
    assert '"path":"/health"' in output
