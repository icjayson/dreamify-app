import asyncio
from unittest.mock import MagicMock, patch


class _MorpheusResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"status": "accepted", "metadata": {"step": "starting"}}


async def _no_sleep(_seconds):
    return None


def _chat_request(prompt: str):
    from app.api.route_modules.conversation import ConversationChatRequest

    return ConversationChatRequest(
        project_id="project_1",
        user_node_contents=[
            {
                "type": "text",
                "data": {"text": prompt},
            }
        ],
        model="fast",
    )


def _run_chat_with_project(project):
    from app.api.route_modules import conversation

    update_project = MagicMock(
        side_effect=lambda **kwargs: {
            **project,
            "name": kwargs.get("name") or project["name"],
            "name_source": kwargs.get("name_source") or project.get("name_source"),
            "latest_conversation_id": kwargs.get("latest_conversation_id"),
        }
    )

    with patch.object(
        conversation.projects_repo, "get_project", return_value=project
    ), patch.object(
        conversation.projects_repo, "update_project", update_project
    ), patch.object(
        conversation, "save_conversation"
    ), patch.object(
        conversation.conversations_repo, "create_conversation"
    ), patch.object(
        conversation.requests, "post", return_value=_MorpheusResponse()
    ), patch.object(
        conversation.credit_service_instance, "get_model_cost", return_value=1
    ), patch.object(
        conversation.credit_service_instance, "consume_credits"
    ), patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ):
        response = asyncio.run(
            conversation.conversation_chat(
                _chat_request("Build a campaign performance dashboard"),
                user_id="user_1",
            )
        )

    return response, update_project


def test_conversation_chat_sets_generated_project_name_before_morpheus_call():
    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Untitled Project",
        "name_source": "generated",
    }

    response, update_project = _run_chat_with_project(project)

    update_project.assert_called_once()
    kwargs = update_project.call_args.kwargs
    assert kwargs["name"] == "Campaign Performance"
    assert kwargs["name_source"] == "generated"
    assert kwargs["latest_conversation_id"] == response.conversation_id
    assert response.project_name == "Campaign Performance"
    assert response.project_name_source == "generated"


def test_conversation_chat_does_not_overwrite_user_renamed_project():
    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Board Room Metrics",
        "name_source": "user",
    }

    response, update_project = _run_chat_with_project(project)

    update_project.assert_called_once()
    kwargs = update_project.call_args.kwargs
    assert kwargs["name"] is None
    assert kwargs["name_source"] is None
    assert kwargs["latest_conversation_id"] == response.conversation_id
    assert response.project_name == "Board Room Metrics"
    assert response.project_name_source == "user"


def test_morpheus_metadata_update_preserves_user_project_name():
    from app.api.route_modules import morpheus

    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Board Room Metrics",
        "name_source": "user",
    }
    update_project = MagicMock(
        return_value={
            **project,
            "latest_dashboard_id": "dashboard_1",
            "dashboard_title": "Campaign Performance",
        }
    )

    with patch.object(morpheus, "_ensure_morpheus_key"), patch.object(
        morpheus.projects_repo, "get_project", return_value=project
    ), patch.object(morpheus.projects_repo, "update_project", update_project):
        response = asyncio.run(
            morpheus.update_project_metadata(
                "project_1",
                morpheus.ProjectMetadataUpdateRequest(
                    user_id="user_1",
                    name="Campaign Performance",
                    latest_dashboard_id="dashboard_1",
                    dashboard_title="Campaign Performance",
                ),
            )
        )

    assert response == {"success": True}
    update_project.assert_called_once()
    kwargs = update_project.call_args.kwargs
    assert kwargs["name"] is None
    assert kwargs["dashboard_title"] == "Campaign Performance"
    assert kwargs["latest_dashboard_id"] == "dashboard_1"
