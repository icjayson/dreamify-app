"""Tests for the SSE workflow streaming endpoint and EventBus service."""

import asyncio

import pytest
from unittest.mock import patch

from fastapi import HTTPException


# ---------------------------------------------------------------------------
# EventBus
# ---------------------------------------------------------------------------


def test_event_bus_constructs_without_running_loop():
    """Constructing EventBus at import time (no loop) must not raise."""
    from app.services.event_bus import EventBus

    bus = EventBus()
    assert bus is not None


def test_publish_delivers_to_subscriber_only():
    from app.services.event_bus import EventBus

    async def _run():
        bus = EventBus()
        subscribed = await bus.subscribe("conv_1")
        unsubscribed = await bus.subscribe("conv_2")

        await bus.publish("conv_1", {"type": "status", "status": "running"})

        delivered = subscribed.get_nowait()
        assert delivered["status"] == "running"
        # A queue for a different conversation receives nothing.
        assert unsubscribed.empty()

    asyncio.run(_run())


def test_unsubscribed_queue_receives_nothing():
    from app.services.event_bus import EventBus

    async def _run():
        bus = EventBus()
        queue = await bus.subscribe("conv_1")
        await bus.unsubscribe("conv_1", queue)

        await bus.publish("conv_1", {"type": "event"})

        assert queue.empty()

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# SSE endpoint
# ---------------------------------------------------------------------------

_CONVERSATION = {"conversation_id": "conv_1", "user_id": "user_1"}

_STATUS_NODE = {
    "conversation_id": "conv_1",
    "node_id": "workflow",
    "status": "running",
    "metadata": {"step": "execution"},
    "updated_at": "2026-05-31T00:00:00+00:00",
}

_TERMINAL_STATUS_NODE = {
    "conversation_id": "conv_1",
    "node_id": "workflow",
    "status": "completed",
    "metadata": {"step": "finish"},
    "updated_at": "2026-05-31T00:00:05+00:00",
}

_AWAITING_INPUT_STATUS_NODE = {
    "conversation_id": "conv_1",
    "node_id": "workflow",
    "status": "awaiting_user_input",
    "metadata": {
        "step": "clarification",
        "response_type": "clarification_request",
        "clarification_ids": ["clarify_join"],
    },
    "updated_at": "2026-05-31T00:00:03+00:00",
}

_EVENT_ROW = {
    "conversation_id": "conv_1",
    "node_id": "event#run_abc#000001",
    "status": "completed",
    "metadata": {
        "id": "run_abc:1",
        "run_id": "run_abc",
        "sequence": 1,
        "phase": "analysis",
        "status": "completed",
        "title": "Crunching the numbers",
    },
    "updated_at": "2026-05-31T00:00:01+00:00",
}


async def _collect_frames(response, max_frames):
    frames = []
    async for chunk in response.body_iterator:
        frames.append(chunk)
        if len(frames) >= max_frames:
            break
    return frames


def test_stream_replays_existing_node_and_events():
    from app.api.route_modules import conversation

    async def _run():
        with patch.object(
            conversation.conversations_repo,
            "get_conversation",
            return_value=_CONVERSATION,
        ), patch.object(
            conversation.workflow_nodes_repo, "get_node", return_value=_STATUS_NODE
        ), patch.object(
            conversation.workflow_nodes_repo,
            "list_workflow_events",
            return_value=[_EVENT_ROW],
        ):
            response = await conversation.stream_conversation_workflow(
                conversation_id="conv_1", project_id="project_1", user_id="user_1"
            )
            frames = await _collect_frames(response, max_frames=2)

        joined = "".join(frames)
        assert "event: status" in joined
        assert "running" in joined
        assert "event: event" in joined
        assert "Crunching the numbers" in joined

    asyncio.run(_run())


def test_stream_emits_live_event_bus_updates():
    from app.api.route_modules import conversation
    from app.services.event_bus import EventBus

    live_bus = EventBus()
    live_event = {
        "type": "event",
        "conversation_id": "conv_1",
        "node_id": "event#run_abc#000002",
        "status": "completed",
        "metadata": {
            "id": "run_abc:2",
            "run_id": "run_abc",
            "sequence": 2,
            "phase": "recomputing",
            "status": "completed",
            "title": "Recomputing values",
        },
    }
    terminal_status = {
        "type": "status",
        **_TERMINAL_STATUS_NODE,
    }

    async def _run():
        with patch.object(
            conversation.conversations_repo,
            "get_conversation",
            return_value=_CONVERSATION,
        ), patch.object(
            conversation.workflow_nodes_repo, "get_node", return_value=_STATUS_NODE
        ), patch.object(
            conversation.workflow_nodes_repo, "list_workflow_events", return_value=[]
        ), patch.object(
            conversation, "event_bus", live_bus
        ):
            response = await conversation.stream_conversation_workflow(
                conversation_id="conv_1", project_id="project_1", user_id="user_1"
            )
            iterator = response.body_iterator.__aiter__()
            try:
                first = await iterator.__anext__()
                await live_bus.publish("conv_1", live_event)
                second = await asyncio.wait_for(iterator.__anext__(), timeout=0.2)
                await live_bus.publish("conv_1", terminal_status)
                third = await asyncio.wait_for(iterator.__anext__(), timeout=0.2)
            finally:
                await iterator.aclose()

        joined = first + second + third
        assert "event: status" in joined
        assert "event: event" in joined
        assert "Recomputing values" in joined
        assert "completed" in joined

    asyncio.run(_run())


def test_terminal_status_closes_stream():
    from app.api.route_modules import conversation

    async def _run():
        with patch.object(
            conversation.conversations_repo,
            "get_conversation",
            return_value=_CONVERSATION,
        ), patch.object(
            conversation.workflow_nodes_repo,
            "get_node",
            return_value=_TERMINAL_STATUS_NODE,
        ), patch.object(
            conversation.workflow_nodes_repo, "list_workflow_events", return_value=[]
        ):
            response = await conversation.stream_conversation_workflow(
                conversation_id="conv_1", project_id="project_1", user_id="user_1"
            )
            # Generator must terminate on its own once terminal is observed.
            frames = [chunk async for chunk in response.body_iterator]

        joined = "".join(frames)
        assert "event: status" in joined
        assert "completed" in joined

    asyncio.run(_run())


def test_stream_replays_terminal_status_with_analysis_steps():
    """Completed Q&A/dashboard statuses must carry Activity steps over SSE."""
    from app.api.route_modules import conversation

    terminal_with_steps = {
        **_TERMINAL_STATUS_NODE,
        "metadata": {
            "step": "finish",
            "response_type": "message",
            "analysis_steps": [
                {
                    "index": 0,
                    "title": "Check trend",
                    "explanation": "Checked the trend before answering.",
                }
            ],
        },
    }

    async def _run():
        with patch.object(
            conversation.conversations_repo,
            "get_conversation",
            return_value=_CONVERSATION,
        ), patch.object(
            conversation.workflow_nodes_repo,
            "get_node",
            return_value=terminal_with_steps,
        ), patch.object(
            conversation.workflow_nodes_repo, "list_workflow_events", return_value=[]
        ):
            response = await conversation.stream_conversation_workflow(
                conversation_id="conv_1", project_id="project_1", user_id="user_1"
            )
            frames = [chunk async for chunk in response.body_iterator]

        joined = "".join(frames)
        assert "event: status" in joined
        assert "analysis_steps" in joined
        assert "Checked the trend before answering." in joined

    asyncio.run(_run())


def test_awaiting_user_input_closes_stream():
    """Clarification requests are terminal for the current stream turn."""
    from app.api.route_modules import conversation

    async def _run():
        with patch.object(
            conversation.conversations_repo,
            "get_conversation",
            return_value=_CONVERSATION,
        ), patch.object(
            conversation.workflow_nodes_repo,
            "get_node",
            return_value=_AWAITING_INPUT_STATUS_NODE,
        ), patch.object(
            conversation.workflow_nodes_repo, "list_workflow_events", return_value=[]
        ):
            response = await conversation.stream_conversation_workflow(
                conversation_id="conv_1", project_id="project_1", user_id="user_1"
            )
            frames = [chunk async for chunk in response.body_iterator]

        joined = "".join(frames)
        assert "event: status" in joined
        assert "awaiting_user_input" in joined
        assert "clarification_request" in joined

    asyncio.run(_run())


def test_stream_403_for_wrong_owner():
    from app.api.route_modules import conversation

    async def _run():
        with patch.object(
            conversation.conversations_repo,
            "get_conversation",
            return_value={"conversation_id": "conv_1", "user_id": "other_user"},
        ):
            with pytest.raises(HTTPException) as exc_info:
                await conversation.stream_conversation_workflow(
                    conversation_id="conv_1", project_id="project_1", user_id="user_1"
                )
        assert exc_info.value.status_code == 403

    asyncio.run(_run())


def test_stream_404_for_missing_conversation():
    from app.api.route_modules import conversation

    async def _run():
        with patch.object(
            conversation.conversations_repo, "get_conversation", return_value=None
        ):
            with pytest.raises(HTTPException) as exc_info:
                await conversation.stream_conversation_workflow(
                    conversation_id="conv_1", project_id="project_1", user_id="user_1"
                )
        assert exc_info.value.status_code == 404

    asyncio.run(_run())
