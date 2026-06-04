import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch


class _MorpheusResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"status": "accepted", "metadata": {"step": "starting"}}


async def _no_sleep(_seconds):
    return None


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def test_chat_request_persists_chart_mention_metadata_for_morpheus():
    from app.api.route_modules import conversation

    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Untitled Project",
        "name_source": "generated",
    }
    request = conversation.ConversationChatRequest(
        project_id="project_1",
        model="fast",
        user_node_contents=[
            {"type": "text", "data": {"text": "Explain this chart"}},
            {
                "type": "chart_mention",
                "data": {
                    "component_id": "component_1",
                    "chart_id": "chart_1",
                    "title": "Revenue Trend",
                    "chart_type": "line",
                    "dashboard_id": "dash_1",
                    "config": {"title": "Revenue Trend", "datasets": []},
                },
            },
        ],
        user_node_metadata={
            "asset_selection": "none",
            "selected_chart_ids": ["component_1"],
        },
    )
    saved = {}
    run_workflow = AsyncMock(return_value=_MorpheusResponse().json())

    with patch.object(
        conversation.projects_repo, "get_project", return_value=project
    ), patch.object(
        conversation.projects_repo,
        "update_project",
        return_value={**project, "latest_conversation_id": "conversation_1"},
    ), patch.object(
        conversation,
        "save_conversation",
        side_effect=lambda bucket, key, body: saved.setdefault("conversation", body),
    ), patch.object(
        conversation.conversations_repo, "create_conversation"
    ), patch.object(
        conversation.morpheus_client, "run_workflow", run_workflow
    ), patch.object(
        conversation.credit_service_instance, "get_model_cost", return_value=1
    ), patch.object(
        conversation.credit_service_instance, "consume_credits"
    ), patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ), patch.object(
        conversation.assets_repo, "list_assets", return_value=[]
    ):
        _run(conversation.conversation_chat(request, user_id="user_1"))

    user_node = saved["conversation"]["nodes"][-1]
    assert user_node["metadata"]["asset_selection"] == "none"
    assert user_node["metadata"]["selected_chart_ids"] == ["component_1"]
    assert user_node["contents"][1] == {
        "type": "chart_mention",
        "data": {
            "component_id": "component_1",
            "chart_id": "chart_1",
            "title": "Revenue Trend",
            "chart_type": "line",
            "dashboard_id": "dash_1",
            "config": {"title": "Revenue Trend", "datasets": []},
        },
    }
    payload = run_workflow.call_args.args[0]
    assert payload["project_assets"] == []
    assert payload["conversation_id"] == saved["conversation"]["conversation_id"]


def test_workflow_status_returns_starting_before_morpheus_posts_node():
    from app.api.route_modules import conversation

    with patch.object(
        conversation.conversations_repo,
        "get_conversation",
        return_value={"user_id": "user_1"},
    ), patch.object(conversation.workflow_nodes_repo, "get_node", return_value=None):
        response = _run(
            conversation.get_conversation_workflow_status(
                conversation_id="conversation_1",
                project_id="project_1",
                user_id="user_1",
            )
        )

    assert response.status == "starting"
    assert response.node_id == "workflow"
    assert response.metadata == {"step": "initializing"}


def test_workflow_events_maps_ordered_thinking_events_for_frontend_polling():
    from app.api.route_modules import conversation

    status_item = {
        "conversation_id": "conversation_1",
        "node_id": "workflow",
        "status": "processing",
        "metadata": {"step": "routing"},
    }
    event_items = [
        {
            "conversation_id": "conversation_1",
            "node_id": "event_1",
            "status": "completed",
            "metadata": {
                "id": "run_1:1",
                "run_id": "run_1",
                "sequence": 1,
                "phase": "routing",
                "status": "completed",
                "title": "Choosing analysis path",
                "summary": "Route selected",
                "metadata": {"step": "routing"},
            },
        },
        {
            "conversation_id": "conversation_1",
            "node_id": "event_2",
            "status": "completed",
            "metadata": {
                "id": "run_1:2",
                "run_id": "run_1",
                "sequence": 2,
                "phase": "analysis",
                "status": "completed",
                "title": "Profiling data structure",
                "metadata": {"step": "explore_files"},
            },
        },
    ]

    with patch.object(
        conversation.conversations_repo,
        "get_conversation",
        return_value={"user_id": "user_1"},
    ), patch.object(
        conversation.workflow_nodes_repo, "get_node", return_value=status_item
    ), patch.object(
        conversation.workflow_nodes_repo,
        "list_workflow_events",
        return_value=event_items,
    ):
        response = _run(
            conversation.get_conversation_workflow_events(
                conversation_id="conversation_1",
                project_id="project_1",
                user_id="user_1",
            )
        )

    assert response.status.status == "processing"
    assert [event.sequence for event in response.events] == [1, 2]
    assert [event.phase for event in response.events] == ["routing", "analysis"]
    assert response.events[0].metadata == {"step": "routing"}
    assert response.events[1].title == "Profiling data structure"


def test_conversation_dashboard_returns_latest_dashboard_data_for_completed_generation():
    from app.api.route_modules import conversation

    dashboard_data = {
        "dashboard": {"title": "Latest"},
        "charts": [{"id": "chart_1"}],
        "metrics": [],
    }
    conversation_data = {
        "dashboards": [
            {"dashboard_id": "dash_old", "s3_uri": "s3://bucket/dash_old.json"},
            {"dashboard_id": "dash_latest", "s3_uri": "s3://bucket/dash_latest.json"},
        ]
    }

    with patch.object(
        conversation.conversations_repo,
        "get_conversation",
        return_value={
            "user_id": "user_1",
            "s3_bucket": "bucket",
            "s3_key": "conversation.json",
        },
    ), patch.object(
        conversation, "load_conversation", return_value=conversation_data
    ), patch.object(
        conversation,
        "download_bytes",
        return_value=json.dumps(dashboard_data).encode("utf-8"),
    ):
        response = _run(
            conversation.get_conversation_dashboard(
                conversation_id="conversation_1",
                project_id="project_1",
                dashboard_id=None,
                user_id="user_1",
            )
        )

    assert response.dashboard_id == "dash_latest"
    assert response.dashboard_data == dashboard_data
