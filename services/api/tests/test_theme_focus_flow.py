import asyncio
import json
import pytest
from unittest.mock import MagicMock, patch


class _MorpheusResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"status": "accepted", "metadata": {"step": "starting"}}


async def _no_sleep(_seconds):
    return None


def test_chat_request_forwards_theme_and_analysis_focus_to_morpheus():
    from app.api.route_modules import conversation

    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Untitled Project",
        "name_source": "generated",
    }
    request = conversation.ConversationChatRequest(
        project_id="project_1",
        user_node_contents=[{"type": "text", "data": {"text": "Build an HR dashboard"}}],
        model="fast",
        theme_id="aurora",
        analysis_focus_id="hr_workforce",
    )

    post = MagicMock(return_value=_MorpheusResponse())
    with patch.object(conversation.projects_repo, "get_project", return_value=project), patch.object(
        conversation.projects_repo, "update_project", return_value={**project, "latest_conversation_id": "conversation_1"}
    ), patch.object(conversation, "save_conversation"), patch.object(
        conversation.conversations_repo, "create_conversation"
    ), patch.object(conversation.requests, "post", post), patch.object(
        conversation.credit_service_instance, "get_model_cost", return_value=1
    ), patch.object(conversation.credit_service_instance, "consume_credits"), patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ):
        asyncio.run(conversation.conversation_chat(request, user_id="user_1"))

    payload = post.call_args.kwargs["json"]
    assert payload["theme_id"] == "aurora"
    assert payload["analysis_focus_id"] == "hr_workforce"
    assert payload["template_id"] is None


def test_chat_request_without_theme_does_not_forward_theme_to_morpheus():
    from app.api.route_modules import conversation

    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Untitled Project",
        "name_source": "generated",
    }
    request = conversation.ConversationChatRequest(
        project_id="project_1",
        user_node_contents=[{"type": "text", "data": {"text": "Show last week web visitors"}}],
        model="fast",
    )

    post = MagicMock(return_value=_MorpheusResponse())
    with patch.object(conversation.projects_repo, "get_project", return_value=project), patch.object(
        conversation.projects_repo, "update_project", return_value={**project, "latest_conversation_id": "conversation_1"}
    ), patch.object(conversation, "save_conversation"), patch.object(
        conversation.conversations_repo, "create_conversation"
    ), patch.object(conversation.requests, "post", post), patch.object(
        conversation.credit_service_instance, "get_model_cost", return_value=1
    ), patch.object(conversation.credit_service_instance, "consume_credits"), patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ):
        asyncio.run(conversation.conversation_chat(request, user_id="user_1"))

    payload = post.call_args.kwargs["json"]
    assert payload["theme_id"] is None
    assert payload["analysis_focus_id"] is None
    assert payload["template_id"] is None


def test_chat_request_maps_legacy_template_to_theme_and_focus():
    from app.api.route_modules import conversation

    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Untitled Project",
        "name_source": "generated",
    }
    request = conversation.ConversationChatRequest(
        project_id="project_1",
        user_node_contents=[{"type": "text", "data": {"text": "Build an HR dashboard"}}],
        model="fast",
        template_id="hr_workforce",
    )

    post = MagicMock(return_value=_MorpheusResponse())
    with patch.object(conversation.projects_repo, "get_project", return_value=project), patch.object(
        conversation.projects_repo, "update_project", return_value={**project, "latest_conversation_id": "conversation_1"}
    ), patch.object(conversation, "save_conversation"), patch.object(
        conversation.conversations_repo, "create_conversation"
    ), patch.object(conversation.requests, "post", post), patch.object(
        conversation.credit_service_instance, "get_model_cost", return_value=1
    ), patch.object(conversation.credit_service_instance, "consume_credits"), patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ):
        asyncio.run(conversation.conversation_chat(request, user_id="user_1"))

    payload = post.call_args.kwargs["json"]
    assert payload["theme_id"] == "warm"
    assert payload["analysis_focus_id"] == "hr_workforce"
    assert payload["template_id"] == "hr_workforce"


def test_dashboard_theme_update_syncs_styling_recommendations():
    from app.api.route_modules import conversation

    uploaded = {}
    dashboard = {"dashboard": {"title": "Current"}, "styling_recommendations": {"theme": "default"}}
    meta = {"user_id": "user_1", "s3_bucket": "bucket", "s3_key": "conversation.json"}
    convo = {"dashboards": [{"dashboard_id": "dash_1", "s3_uri": "s3://bucket/dashboards/dash_1.json"}]}

    with patch.object(conversation.conversations_repo, "get_conversation", return_value=meta), patch.object(
        conversation, "load_conversation", return_value=convo
    ), patch.object(
        conversation, "download_bytes", return_value=json.dumps(dashboard).encode("utf-8")
    ), patch.object(
        conversation,
        "upload_bytes",
        side_effect=lambda bucket, key, body, content_type: uploaded.update(
            {"bucket": bucket, "key": key, "body": json.loads(body.decode("utf-8"))}
        ),
    ):
        response = asyncio.run(
            conversation.update_dashboard_theme(
                "conversation_1",
                "dash_1",
                conversation.UpdateDashboardThemeRequest(project_id="project_1", theme_id="glacier"),
                user_id="user_1",
            )
        )

    assert response == {"success": True}
    assert uploaded["body"]["theme_id"] == "glacier"
    assert uploaded["body"]["styling_recommendations"]["theme"] == "glacier"


def test_legacy_template_update_maps_theme_and_focus_fields():
    from app.api.route_modules import conversation

    uploaded = {}
    dashboard = {"dashboard": {"title": "Current"}}
    meta = {"user_id": "user_1", "s3_bucket": "bucket", "s3_key": "conversation.json"}
    convo = {"dashboards": [{"dashboard_id": "dash_1", "s3_uri": "s3://bucket/dashboards/dash_1.json"}]}

    with patch.object(conversation.conversations_repo, "get_conversation", return_value=meta), patch.object(
        conversation, "load_conversation", return_value=convo
    ), patch.object(
        conversation, "download_bytes", return_value=json.dumps(dashboard).encode("utf-8")
    ), patch.object(
        conversation,
        "upload_bytes",
        side_effect=lambda bucket, key, body, content_type: uploaded.update(
            {"bucket": bucket, "key": key, "body": json.loads(body.decode("utf-8"))}
        ),
    ):
        response = asyncio.run(
            conversation.update_dashboard_template(
                "conversation_1",
                "dash_1",
                conversation.UpdateDashboardTemplateRequest(
                    project_id="project_1", template_id="finance_overview"
                ),
                user_id="user_1",
            )
        )

    assert response == {"success": True}
    assert uploaded["body"]["template_id"] == "finance_overview"
    assert uploaded["body"]["theme_id"] == "chalk"
    assert uploaded["body"]["analysis_focus_id"] == "finance_overview"
    assert uploaded["body"]["styling_recommendations"]["theme"] == "chalk"


def test_text_only_chat_defaults_to_no_asset_selection_and_forwards_project_assets():
    from app.api.route_modules import conversation

    project = {
        "project_id": "project_1",
        "user_id": "user_1",
        "name": "Untitled Project",
        "name_source": "generated",
    }
    request = conversation.ConversationChatRequest(
        project_id="project_1",
        user_node_contents=[{"type": "text", "data": {"text": "What is visitor trend last week?"}}],
        model="fast",
    )
    saved = {}
    project_asset = {
        "asset_id": "asset_1",
        "file_id": "file_1",
        "project_id": "project_1",
        "filename": "GA4 visitors.csv",
        "extension": "csv",
        "asset_type": "integration_ga4",
        "row_count": 10,
        "column_count": 4,
        "status": "processed",
    }

    post = MagicMock(return_value=_MorpheusResponse())
    with patch.object(conversation.projects_repo, "get_project", return_value=project), patch.object(
        conversation.projects_repo, "update_project", return_value={**project, "latest_conversation_id": "conversation_1"}
    ), patch.object(
        conversation,
        "save_conversation",
        side_effect=lambda bucket, key, body: saved.setdefault("conversation", body),
    ), patch.object(conversation.conversations_repo, "create_conversation"), patch.object(
        conversation.requests, "post", post
    ), patch.object(
        conversation.credit_service_instance, "get_model_cost", return_value=1
    ), patch.object(conversation.credit_service_instance, "consume_credits"), patch.object(
        conversation.asyncio, "sleep", new=_no_sleep
    ), patch.object(
        conversation.assets_repo, "list_assets", return_value=[project_asset]
    ):
        asyncio.run(conversation.conversation_chat(request, user_id="user_1"))

    user_node = saved["conversation"]["nodes"][-1]
    assert user_node["metadata"]["asset_selection"] == "none"
    payload = post.call_args.kwargs["json"]
    assert payload["project_assets"][0]["asset_id"] == "asset_1"


def test_chat_request_rejects_asset_from_another_project():
    from fastapi import HTTPException
    from app.api.route_modules import conversation

    project = {"project_id": "project_1", "user_id": "user_1"}
    request = conversation.ConversationChatRequest(
        project_id="project_1",
        user_node_contents=[{"type": "asset", "data": {"asset_id": "asset_1"}}],
        user_node_metadata={"asset_selection": "explicit", "selected_asset_ids": ["asset_1"]},
    )

    with patch.object(conversation.projects_repo, "get_project", return_value=project), patch.object(
        conversation.assets_repo,
        "get_asset",
        return_value={"asset_id": "asset_1", "project_id": "other_project"},
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(conversation.conversation_chat(request, user_id="user_1"))

    assert exc.value.status_code == 403


def test_chat_request_rejects_invalid_clarification_option():
    from fastapi import HTTPException
    from app.api.route_modules import conversation

    project = {"project_id": "project_1", "user_id": "user_1"}
    existing = {
        "nodes": [
            {
                "role": "assistant",
                "contents": [
                    {
                        "type": "clarification_request",
                        "data": {
                            "clarification_id": "clarify_1",
                            "options": [{"id": "asset:asset_1", "label": "GA4"}],
                        },
                    }
                ],
            }
        ]
    }
    request = conversation.ConversationChatRequest(
        conversation_id="conversation_1",
        project_id="project_1",
        user_node_contents=[
            {"type": "text", "data": {"text": "Use the wrong one"}},
            {
                "type": "clarification_response",
                "data": {
                    "clarification_id": "clarify_1",
                    "selected_option_id": "missing",
                },
            },
        ],
    )

    with patch.object(conversation.projects_repo, "get_project", return_value=project), patch.object(
        conversation, "_load_existing_conversation", return_value=existing
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(conversation.conversation_chat(request, user_id="user_1"))

    assert exc.value.status_code == 400


def test_dismiss_clarification_rejects_unauthorized_conversation():
    from fastapi import HTTPException
    from app.api.route_modules import conversation

    with patch.object(
        conversation.conversations_repo,
        "get_conversation",
        return_value={"user_id": "other_user", "s3_bucket": "bucket", "s3_key": "key"},
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                conversation.dismiss_clarification(
                    conversation_id="conversation_1",
                    clarification_id="clarify_1",
                    project_id="project_1",
                    user_id="user_1",
                )
            )

    assert exc.value.status_code == 403


def test_dismiss_clarification_rejects_unknown_clarification_id():
    from fastapi import HTTPException
    from app.api.route_modules import conversation

    with patch.object(
        conversation.conversations_repo,
        "get_conversation",
        return_value={"user_id": "user_1", "s3_bucket": "bucket", "s3_key": "key"},
    ), patch.object(conversation, "load_conversation", return_value={"nodes": []}):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                conversation.dismiss_clarification(
                    conversation_id="conversation_1",
                    clarification_id="missing",
                    project_id="project_1",
                    user_id="user_1",
                )
            )

    assert exc.value.status_code == 404


def test_dismiss_clarification_persists_no_answer_and_stops_workflow():
    from app.api.route_modules import conversation

    existing = {
        "nodes": [
            {
                "node_id": "assistant_1",
                "role": "assistant",
                "contents": [
                    {
                        "type": "clarification_request",
                        "data": {
                            "clarification_id": "clarify_1",
                            "reason_code": "missing_data_context",
                            "question": "Choose the data context",
                            "options": [{"id": "asset:asset_1", "label": "GA4"}],
                        },
                    }
                ],
            }
        ]
    }
    saved = []
    upsert = MagicMock()
    post = MagicMock()

    with patch.object(
        conversation.conversations_repo,
        "get_conversation",
        return_value={"user_id": "user_1", "s3_bucket": "bucket", "s3_key": "primary.json"},
    ), patch.object(conversation, "load_conversation", return_value=existing), patch.object(
        conversation,
        "save_conversation",
        side_effect=lambda bucket, key, body: saved.append((bucket, key, body)),
    ), patch.object(
        conversation.workflow_nodes_repo, "upsert_node_status", upsert
    ), patch.object(conversation.requests, "post", post):
        response = asyncio.run(
            conversation.dismiss_clarification(
                conversation_id="conversation_1",
                clarification_id="clarify_1",
                project_id="project_1",
                user_id="user_1",
            )
        )

    assert response.success is True
    assert response.clarification_id == "clarify_1"
    assert post.call_count == 0
    assert saved
    saved_conversation = saved[0][2]
    hidden_node = saved_conversation["nodes"][-1]
    assert hidden_node["role"] == "user"
    assert hidden_node["metadata"]["hidden"] is True
    response_content = hidden_node["contents"][0]
    assert response_content["type"] == "clarification_response"
    assert response_content["data"]["clarification_id"] == "clarify_1"
    assert response_content["data"]["selected_option_id"] is None
    assert response_content["data"]["answer_status"] == "no_answer"
    assert any(
        call.kwargs["node_id"] == "workflow"
        and call.kwargs["status"] == "stopped"
        and call.kwargs["metadata"]["answer_status"] == "no_answer"
        for call in upsert.call_args_list
    )
