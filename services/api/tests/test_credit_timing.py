"""Tests for the billable-workflow-result gate on credit deduction."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.route_modules.conversation import _is_billable_workflow_result


async def _no_sleep(_seconds):
    return None


def _chat_request():
    from app.api.route_modules.conversation import ConversationChatRequest

    return ConversationChatRequest(
        project_id="project_1",
        user_node_contents=[
            {"type": "text", "data": {"text": "Build a revenue dashboard"}}
        ],
        model="fast",
    )


def _project():
    return {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Untitled Project",
        "name_source": "generated",
    }


def test_started_status_is_billable():
    assert _is_billable_workflow_result({"status": "started"}) is True


def test_running_status_is_billable():
    assert _is_billable_workflow_result({"status": "running"}) is True


def test_failed_status_not_billable():
    assert _is_billable_workflow_result({"status": "failed"}) is False


def test_error_status_not_billable():
    assert _is_billable_workflow_result({"status": "error"}) is False


def test_rejected_status_not_billable():
    assert _is_billable_workflow_result({"status": "rejected"}) is False


def test_status_case_insensitive():
    assert _is_billable_workflow_result({"status": "FAILED"}) is False


def test_missing_status_defaults_billable():
    # Generous default: a 200 with an unexpected shape still bills (matches prior behavior).
    assert _is_billable_workflow_result({"step": "analyzing"}) is True


def test_non_dict_defaults_billable():
    assert _is_billable_workflow_result(None) is True
    assert _is_billable_workflow_result("oops") is True


def test_conversation_chat_skips_credit_consumption_for_failed_workflow_result():
    from app.api.route_modules import conversation

    project = _project()

    with patch.object(
        conversation.projects_repo, "get_project", return_value=project
    ), patch.object(
        conversation.projects_repo,
        "update_project",
        return_value={**project, "latest_conversation_id": "conversation_1"},
    ), patch.object(
        conversation, "save_conversation"
    ), patch.object(
        conversation.conversations_repo, "create_conversation"
    ), patch.object(
        conversation.morpheus_client,
        "run_workflow",
        AsyncMock(return_value={"status": "failed", "metadata": {"step": "routing"}}),
    ), patch.object(
        conversation.credit_service_instance, "get_model_cost", return_value=1
    ), patch.object(
        conversation.credit_service_instance, "consume_credits"
    ) as consume_mock, patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ), patch.object(
        conversation.assets_repo, "list_assets", return_value=[]
    ):
        response = asyncio.run(
            conversation.conversation_chat(_chat_request(), user_id="user_1")
        )

    assert response.workflow_status["status"] == "failed"
    consume_mock.assert_not_called()


def test_conversation_chat_maps_morpheus_timeout_without_consuming_credits():
    from app.api.route_modules import conversation

    project = _project()

    with patch.object(
        conversation.projects_repo, "get_project", return_value=project
    ), patch.object(
        conversation.projects_repo,
        "update_project",
        return_value={**project, "latest_conversation_id": "conversation_1"},
    ), patch.object(
        conversation, "save_conversation"
    ), patch.object(
        conversation.conversations_repo, "create_conversation"
    ), patch.object(
        conversation.morpheus_client,
        "run_workflow",
        AsyncMock(
            side_effect=conversation.morpheus_client.MorpheusTimeoutError(
                "Morpheus service timeout"
            )
        ),
    ), patch.object(
        conversation.credit_service_instance, "consume_credits"
    ) as consume_mock, patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ), patch.object(
        conversation.assets_repo, "list_assets", return_value=[]
    ):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(
                conversation.conversation_chat(_chat_request(), user_id="user_1")
            )

    assert exc_info.value.status_code == 504
    consume_mock.assert_not_called()
