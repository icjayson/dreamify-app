import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parent))


def _import_server():
    try:
        import langchain_google_genai  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"Morpheus workflow dependency missing: {exc}")

    import server

    return server


def test_thinking_tracer_emits_monotonic_sanitized_events(monkeypatch):
    server = _import_server()

    posted = []
    monkeypatch.setattr(
        server,
        "_post_workflow_event_sync",
        lambda conversation_id, run_id, sequence, event: posted.append(
            (conversation_id, run_id, sequence, event)
        ),
    )

    tracer = server.ThinkingTracer("conv_1")
    tracer.emit("context", "Reading\ncontext", "Loaded   project\nfiles")
    tracer.emit("tool", "Running Python analysis", detail="x" * 1200, status="active")

    assert [event["sequence"] for event in tracer.events] == [1, 2]
    assert len(posted) == 2
    assert posted[0][0] == "conv_1"
    assert tracer.events[0]["title"] == "Reading context"
    assert tracer.events[0]["summary"] == "Loaded project files"
    assert len(tracer.events[1]["detail"]) <= 900

    finalized = tracer.snapshot(finalize=True)
    assert finalized[1]["status"] == "completed"
    assert finalized[1]["completed_at"]


def test_thinking_trace_persists_on_final_assistant_node():
    server = _import_server()

    conversation = {
        "nodes": [
            {
                "node_id": "user_1",
                "role": "user",
                "contents": [{"type": "text", "data": {"text": "hi"}}],
            },
            {
                "node_id": "assistant_1",
                "role": "assistant",
                "contents": [{"type": "text", "data": {"text": "answer"}}],
            },
        ]
    }
    events = [{"id": "run_1:1", "sequence": 1, "title": "Reading context"}]

    server._attach_thinking_trace(conversation, events)
    server._attach_thinking_trace(conversation, events)

    assistant_contents = conversation["nodes"][-1]["contents"]
    traces = [content for content in assistant_contents if content["type"] == "thinking_trace"]
    assert len(traces) == 1
    assert traces[0]["data"]["events"] == events
