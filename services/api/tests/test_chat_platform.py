"""
Tests for chat platform integration.

Covers:
- chat_platform_repo: workspace and session CRUD
- slack_service: Block Kit formatters, token encryption
- chat_platform_service: narrative extraction, dashboard URL builder
- chat_platform routes: Slack URL verification, unknown workspace handling
"""

import json
import os
import importlib
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── chat_platform_repo ────────────────────────────────────────────────────────


class TestChatPlatformRepo:
    """Unit tests for DynamoDB repo functions using mocked tables."""

    def _make_table_mock(self, item: Dict = None) -> MagicMock:
        mock = MagicMock()
        mock.get_item.return_value = {"Item": item} if item else {}
        mock.put_item.return_value = {}
        mock.update_item.return_value = {}
        mock.delete_item.return_value = {}
        return mock

    def test_get_workspace_found(self):
        workspace = {
            "platform_workspace_id": "slack:T123",
            "user_id": "user_abc",
            "project_id": "proj_xyz",
            "platform": "slack",
            "bot_token_encrypted": "enc_token",
            "workspace_name": "Acme",
            "language": "en",
        }
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table"
        ) as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(workspace)
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.get_workspace("slack:T123")
        assert result["user_id"] == "user_abc"
        assert result["project_id"] == "proj_xyz"

    def test_get_workspace_not_found(self):
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table"
        ) as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(None)
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.get_workspace("slack:UNKNOWN")
        assert result is None

    def test_save_workspace(self):
        mock_table = self._make_table_mock()
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table
        ):
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.save_workspace(
                platform_workspace_id="slack:T999",
                user_id="user_1",
                project_id="proj_1",
                platform="slack",
                bot_token_encrypted="enc",
                workspace_name="TestCo",
            )
        mock_table.put_item.assert_called_once()
        assert result["platform_workspace_id"] == "slack:T999"
        assert result["language"] == "en"

    def test_get_session_found(self):
        session = {
            "platform_workspace_id": "slack:T123",
            "thread_key": "C001#1700000000.000001",
            "conversation_id": "conv-uuid",
            "project_id": "proj-uuid",
            "user_id": "user-uuid",
        }
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table"
        ) as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(session)
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.get_session(
                "slack:T123", "C001#1700000000.000001"
            )
        assert result["conversation_id"] == "conv-uuid"

    def test_get_session_not_found(self):
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table"
        ) as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(None)
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.get_session("slack:T123", "C999#ts")
        assert result is None

    def test_create_session(self):
        mock_table = self._make_table_mock()
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table
        ):
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.create_session(
                platform_workspace_id="slack:T123",
                thread_key="C001#ts",
                conversation_id="conv-1",
                project_id="proj-1",
                user_id="user-1",
            )
        mock_table.put_item.assert_called_once()
        assert result["conversation_id"] == "conv-1"
        assert "last_active_at" in result

    def test_update_session_conversation(self):
        mock_table = self._make_table_mock()
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table
        ):
            from utils.dynamodb.repos import chat_platform_repo

            chat_platform_repo.update_session_conversation(
                "slack:T123", "C001#ts", "conv-new"
            )
        mock_table.update_item.assert_called_once()


# ── slack_service formatters ──────────────────────────────────────────────────


class TestSlackServiceFormatters:
    def test_build_analyzing_blocks_contains_query(self):
        from app.services.slack_service import build_analyzing_blocks

        blocks = build_analyzing_blocks("why did signups drop?")
        text = blocks[0]["text"]["text"]
        assert "why did signups drop?" in text

    def test_build_response_blocks_with_dashboard(self):
        from app.services.slack_service import build_response_blocks

        blocks = build_response_blocks(
            "Signups dropped 23%.", "https://app.dreamify.dev/projects/p?dashboard=d", 5
        )
        # section with narrative
        assert any("Signups dropped 23%" in str(b) for b in blocks)
        # actions block with dashboard button
        action_blocks = [b for b in blocks if b.get("type") == "actions"]
        assert len(action_blocks) == 1
        # context block with credits
        context_blocks = [b for b in blocks if b.get("type") == "context"]
        assert len(context_blocks) == 1
        assert "5 credits" in str(context_blocks[0])

    def test_build_response_blocks_without_dashboard(self):
        from app.services.slack_service import build_response_blocks

        blocks = build_response_blocks("No data found.", None, 5)
        action_blocks = [b for b in blocks if b.get("type") == "actions"]
        assert len(action_blocks) == 0

    def test_build_response_blocks_with_metrics(self):
        from app.services.slack_service import build_response_blocks

        metrics = [
            {"title": "Revenue", "value": "$142k", "change": "+12%", "trend": "up"},
            {"title": "Users", "value": "8,420", "change": "+3%", "trend": "up"},
        ]
        blocks = build_response_blocks(
            "Dashboard complete.", "https://preview.dreamify.dev/p", 5, metrics=metrics
        )
        # Should have: narrative section, metrics section, actions, context
        section_blocks = [b for b in blocks if b.get("type") == "section"]
        assert len(section_blocks) == 2
        metrics_text = section_blocks[1]["text"]["text"]
        assert "Revenue" in metrics_text
        assert "Users" in metrics_text
        assert "📈" in metrics_text
        assert "|" in metrics_text

    def test_build_response_blocks_metrics_capped_at_four(self):
        from app.services.slack_service import build_response_blocks

        metrics = [{"title": f"M{i}", "value": i} for i in range(6)]
        blocks = build_response_blocks(
            "Narrative.", "https://example.com", 5, metrics=metrics
        )
        section_blocks = [b for b in blocks if b.get("type") == "section"]
        metrics_text = section_blocks[1]["text"]["text"]
        # M0–M3 should appear; M4/M5 should not
        assert "M3" in metrics_text
        assert "M4" not in metrics_text

    def test_build_response_blocks_no_metrics_section_when_empty(self):
        from app.services.slack_service import build_response_blocks

        blocks = build_response_blocks("Narrative.", None, 5, metrics=[])
        section_blocks = [b for b in blocks if b.get("type") == "section"]
        # Only narrative section — no metrics section
        assert len(section_blocks) == 1

    def test_build_error_blocks(self):
        from app.services.slack_service import build_error_blocks

        blocks = build_error_blocks("Something went wrong.")
        assert "Something went wrong." in blocks[0]["text"]["text"]

    def test_step_label_known(self):
        from app.services.slack_service import step_label

        assert "Reasoning" in step_label("reasoning")

    def test_step_label_unknown(self):
        from app.services.slack_service import step_label

        label = step_label("some_custom_step")
        assert "Some Custom Step" in label


# ── chat_platform_service helpers ────────────────────────────────────────────


class TestChatPlatformServiceHelpers:
    def _make_conversation(self, nodes: list) -> Dict[str, Any]:
        return {
            "conversation_id": "conv-1",
            "project_id": "proj-1",
            "nodes": nodes,
            "dashboards": [],
        }

    def test_normalize_frontend_app_url_maps_api_host(self):
        from utils.config import normalize_frontend_app_url

        assert (
            normalize_frontend_app_url("https://api.dreamify.dev/")
            == "https://app.dreamify.dev"
        )
        assert (
            normalize_frontend_app_url("app.dreamify.dev/")
            == "https://app.dreamify.dev"
        )

    def test_workspace_agent_default_model_is_pro(self, monkeypatch):
        from app.services import chat_platform_service as svc

        original_model = os.environ.get("DREAMIFY_PRO_MODEL")
        try:
            monkeypatch.setenv("DREAMIFY_PRO_MODEL", "pro-env-model")
            svc = importlib.reload(svc)
            assert svc.CHAT_MODEL_ID == "pro-env-model"

            monkeypatch.delenv("DREAMIFY_PRO_MODEL", raising=False)
            svc = importlib.reload(svc)
            assert svc.CHAT_MODEL_ALIAS == "pro"
            assert svc.CHAT_MODEL_ID == "gpt-5.4-mini"
            assert svc.CHAT_CREDIT_COST == 10
        finally:
            if original_model is None:
                os.environ.pop("DREAMIFY_PRO_MODEL", None)
            else:
                os.environ["DREAMIFY_PRO_MODEL"] = original_model
            importlib.reload(svc)

    def test_extract_narrative_returns_last_assistant_text(self):
        from app.services.chat_platform_service import _extract_narrative

        conversation = self._make_conversation(
            [
                {
                    "role": "user",
                    "status": "completed",
                    "contents": [
                        {"type": "text", "data": {"text": "Why did signups drop?"}}
                    ],
                },
                {
                    "role": "assistant",
                    "status": "completed",
                    "contents": [
                        {"type": "text", "data": {"text": "Signups dropped 23%."}}
                    ],
                },
            ]
        )
        assert _extract_narrative(conversation) == "Signups dropped 23%."

    def test_extract_narrative_skips_incomplete(self):
        from app.services.chat_platform_service import _extract_narrative

        conversation = self._make_conversation(
            [
                {
                    "role": "assistant",
                    "status": "processing",
                    "contents": [{"type": "text", "data": {"text": "In progress..."}}],
                },
                {
                    "role": "assistant",
                    "status": "completed",
                    "contents": [{"type": "text", "data": {"text": "Done."}}],
                },
            ]
        )
        assert _extract_narrative(conversation) == "Done."

    def test_extract_narrative_none_when_no_assistant(self):
        from app.services.chat_platform_service import _extract_narrative

        conversation = self._make_conversation(
            [
                {
                    "role": "user",
                    "status": "completed",
                    "contents": [{"type": "text", "data": {"text": "Hello"}}],
                },
            ]
        )
        assert _extract_narrative(conversation) is None

    def test_build_dashboard_url_with_dashboard(self):
        from app.services.chat_platform_service import _build_dashboard_url

        conversation = {"dashboards": [{"dashboard_id": "dash-1"}]}
        url = _build_dashboard_url("proj-1", conversation)
        assert url is not None
        assert "proj-1" in url
        assert "preview" in url

    def test_workspace_links_use_frontend_host_without_double_slash(self, monkeypatch):
        from app.services import chat_platform_service as svc

        monkeypatch.setattr(svc, "FRONTEND_APP_URL", "https://api.dreamify.dev/")
        project_url = svc._build_workspace_project_url("proj-1")
        dashboard_url = svc._build_dashboard_url(
            "proj-1", {"dashboards": [{"dashboard_id": "dash-1"}]}
        )

        assert (
            project_url == "https://app.dreamify.dev/workspace/project?projectId=proj-1"
        )
        assert dashboard_url == (
            "https://app.dreamify.dev/workspace/project/preview?projectId=proj-1"
        )
        assert "//workspace" not in project_url
        assert "//workspace" not in dashboard_url

    def test_build_dashboard_url_no_dashboard(self):
        from app.services.chat_platform_service import _build_dashboard_url

        conversation = {"dashboards": []}
        assert _build_dashboard_url("proj-1", conversation) is None

    def test_extract_top_metrics_returns_up_to_max(self):
        from app.services.chat_platform_service import _extract_top_metrics

        dashboard = {
            "metrics": [
                {"title": "Revenue", "value": 142000, "change": "+12%", "trend": "up"},
                {"title": "Users", "value": 8420, "change": "+3%", "trend": "up"},
                {"title": "Churn", "value": "5%", "change": "-1%", "trend": "down"},
                {"title": "MRR", "value": 50000, "change": "+8%", "trend": "up"},
                {"title": "Extra", "value": 99},
            ]
        }
        result = _extract_top_metrics(dashboard, max_n=4)
        assert len(result) == 4
        assert result[0]["title"] == "Revenue"
        assert result[3]["title"] == "MRR"

    def test_extract_top_metrics_empty_dashboard(self):
        from app.services.chat_platform_service import _extract_top_metrics

        assert _extract_top_metrics({}) == []
        assert _extract_top_metrics({"metrics": []}) == []

    def test_extract_top_metrics_fewer_than_max(self):
        from app.services.chat_platform_service import _extract_top_metrics

        dashboard = {"metrics": [{"title": "Revenue", "value": 100}]}
        result = _extract_top_metrics(dashboard, max_n=4)
        assert len(result) == 1

    def test_make_user_node_structure(self):
        from app.services import chat_platform_service as svc

        node = svc._make_user_node("show me revenue trends")
        assert node["role"] == "user"
        assert node["status"] == "completed"
        assert node["contents"][0]["type"] == "text"
        assert node["contents"][0]["data"]["text"] == "show me revenue trends"
        assert node["node_id"].startswith("node_")
        assert node["metadata"]["chat_mode"] == "pro"
        assert node["metadata"]["resolved_model"] == svc.CHAT_MODEL_ID

    def test_mark_user_node_assets_selected(self):
        from app.services import chat_platform_service as svc

        node = {"metadata": {"selected_asset_ids": ["asset_existing"]}}
        svc._mark_user_node_assets_selected(
            node, ["asset_existing", "asset_uploaded", None, ""]
        )

        assert node["metadata"]["asset_selection"] == "explicit"
        assert node["metadata"]["selected_asset_ids"] == [
            "asset_existing",
            "asset_uploaded",
        ]

    def test_download_and_attach_slack_files_marks_assets_selected(self):
        from app.services import chat_platform_service as svc

        class FakeResponse:
            status = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def read(self):
                return b"day,installs\n2026-06-01,10\n"

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            def get(self, *args, **kwargs):
                return FakeResponse()

        conversation = self._make_conversation(
            [
                {
                    "role": "user",
                    "status": "completed",
                    "contents": [{"type": "text", "data": {"text": "analyze this"}}],
                    "metadata": {"chat_mode": "pro"},
                }
            ]
        )
        slack_files = [
            {
                "name": "growth.csv",
                "size": 128,
                "url_private_download": "https://slack.example/files/growth.csv",
                "mimetype": "text/csv",
            }
        ]

        with patch("aiohttp.ClientSession", return_value=FakeSession()), patch.object(
            svc.boto3, "client", return_value=MagicMock()
        ), patch.object(svc.assets_repo, "create_asset"), patch.object(
            svc, "save_conversation"
        ):
            asyncio.run(
                svc._download_and_attach_slack_files(
                    slack_files,
                    "xoxb-token",
                    "user-1",
                    "proj-1",
                    conversation,
                    "bucket",
                    {"primary": "primary.json", "backup": "backup.json"},
                )
            )

        user_node = conversation["nodes"][-1]
        asset_contents = [
            content for content in user_node["contents"] if content["type"] == "asset"
        ]
        assert len(asset_contents) == 1
        assert user_node["metadata"]["asset_selection"] == "explicit"
        assert user_node["metadata"]["selected_asset_ids"] == [
            asset_contents[0]["data"]["asset_id"]
        ]

    def test_call_morpheus_sends_pro_model_project_assets_and_ask_first_payload(self):
        from app.services import chat_platform_service as svc

        response = MagicMock()
        response.raise_for_status.return_value = None
        keys = {"primary": "conversations/conv-1.json", "backup": "backups/conv-1.json"}

        with patch.object(
            svc.requests, "post", return_value=response
        ) as mock_post, patch.object(
            svc.assets_repo,
            "list_assets",
            return_value=[
                {
                    "asset_id": "asset-1",
                    "file_id": "file-1",
                    "filename": "growth.csv",
                    "extension": "csv",
                    "asset_type": "raw",
                    "row_count": 10,
                    "column_count": 3,
                    "status": "ready",
                }
            ],
        ):
            svc._call_morpheus("conv-1", "proj-1", "user-1", "bucket", keys)

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["json"]["model"] == svc.CHAT_MODEL_ID
        assert kwargs["json"]["model"] == os.environ.get(
            "DREAMIFY_PRO_MODEL", "gpt-5.4-mini"
        )
        assert kwargs["json"]["skip_ask_first"] is False
        assert kwargs["json"]["project_assets"][0]["asset_id"] == "asset-1"

    def test_call_morpheus_can_skip_ask_first_for_auto_refresh(self):
        from app.services import chat_platform_service as svc

        response = MagicMock()
        response.raise_for_status.return_value = None
        keys = {"primary": "conversations/conv-1.json", "backup": "backups/conv-1.json"}

        with patch.object(
            svc.requests, "post", return_value=response
        ) as mock_post, patch.object(svc.assets_repo, "list_assets", return_value=[]):
            svc._call_morpheus(
                "conv-1", "proj-1", "user-1", "bucket", keys, skip_ask_first=True
            )

        assert mock_post.call_args.kwargs["json"]["skip_ask_first"] is True

    def test_poll_workflow_returns_awaiting_user_input(self):
        from app.services import chat_platform_service as svc

        awaiting_node = {
            "status": "awaiting_user_input",
            "metadata": {"step": "clarification"},
        }
        with patch.object(svc.asyncio, "sleep", new=AsyncMock()), patch.object(
            svc.workflow_nodes_repo,
            "get_node",
            return_value=awaiting_node,
        ):
            status, step, metadata = asyncio.run(svc._poll_workflow("conv-1"))

        assert status == "awaiting_user_input"
        assert step == "clarification"
        assert metadata["step"] == "clarification"

    def test_parse_text_clarification_reply_accepts_numbers_labels_and_cancel(self):
        from app.services import chat_platform_service as svc

        pending = {
            "clarifications": [
                {
                    "clarification_id": "clarify_data",
                    "reason_code": "missing_data_context",
                    "question": "Choose data",
                    "options": [
                        {"id": "asset:asset-1", "label": "Growth CSV"},
                        {"id": "answer_without_data", "label": "Answer without data"},
                    ],
                },
                {
                    "clarification_id": "clarify_output",
                    "reason_code": "output_mode",
                    "question": "What should I produce?",
                    "options": [
                        {"id": "saved_dashboard", "label": "Saved dashboard"},
                        {"id": "text_answer", "label": "Text answer"},
                    ],
                },
            ],
            "selected_option_ids": {},
        }

        status, updated, _ = svc.parse_text_clarification_reply(
            pending, "2\nText answer"
        )
        assert status == "valid"
        assert updated["selected_option_ids"] == {
            "clarify_data": "answer_without_data",
            "clarify_output": "text_answer",
        }
        status, _, _ = svc.parse_text_clarification_reply(pending, "cancel")
        assert status == "cancel"

    def test_append_clarification_response_node_hydrates_selected_assets(self):
        from app.services import chat_platform_service as svc

        pending = {
            "conversation_id": "conv-1",
            "project_id": "proj-1",
            "user_id": "user-1",
            "clarifications": [
                {
                    "clarification_id": "clarify_data",
                    "question": "Choose data",
                    "options": [
                        {
                            "id": "asset:asset-1",
                            "label": "Growth CSV",
                            "metadata": {
                                "asset_ids": ["asset-1"],
                                "asset_selection": "explicit",
                            },
                        }
                    ],
                }
            ],
            "selected_option_ids": {"clarify_data": "asset:asset-1"},
        }
        conversation = self._make_conversation([])
        saved = []

        with patch.object(
            svc.conversations_repo,
            "get_conversation",
            return_value={"s3_bucket": "bucket", "s3_key": "primary.json"},
        ), patch.object(
            svc, "load_conversation", return_value=conversation
        ), patch.object(
            svc.assets_repo,
            "get_asset",
            return_value={
                "asset_id": "asset-1",
                "file_id": "file-1",
                "s3_bucket": "bucket",
                "s3_key": "assets/growth.csv",
                "extension": "csv",
                "filename": "growth.csv",
                "asset_type": "raw",
            },
        ), patch.object(
            svc, "save_conversation", side_effect=lambda b, k, c: saved.append(c)
        ):
            bucket, keys = svc._append_clarification_response_node(pending)

        assert bucket == "bucket"
        assert keys["primary"].endswith("conversation.json")
        user_node = saved[-1]["nodes"][-1]
        assert user_node["contents"][1]["type"] == "clarification_response"
        assert user_node["contents"][2]["type"] == "asset"
        assert user_node["metadata"]["asset_selection"] == "explicit"
        assert user_node["metadata"]["selected_asset_ids"] == ["asset-1"]


# ── Route handlers — called directly (no TestClient needed) ───────────────────
# FastAPI Depends() defaults are skipped when calling async handlers directly;
# pass the resolved dependency values as keyword arguments.


class TestChatPlatformServiceHandlers:
    def _workspace(self, platform: str = "slack") -> Dict[str, Any]:
        return {
            "platform_workspace_id": f"{platform}:T123",
            "project_id": "proj-1",
            "user_id": "user-1",
            "platform": platform,
            "bot_token_encrypted": "enc",
        }

    def _pending(self, platform: str = "slack") -> Dict[str, Any]:
        return {
            "status": "awaiting_user_input",
            "platform": platform,
            "nonce": "nonce123",
            "conversation_id": "conv-1",
            "project_id": "proj-1",
            "user_id": "user-1",
            "thread_key": "C123#1700.1" if platform == "slack" else "123#0",
            "selected_option_ids": {"clarify_data": "asset:asset-1"},
            "message": {
                "channel_id": "C123",
                "message_ts": "placeholder-ts",
                "thread_ts": "1700.1",
                "chat_id": 123,
                "message_id": 99,
            },
            "clarifications": [
                {
                    "clarification_id": "clarify_data",
                    "reason_code": "missing_data_context",
                    "question": "Choose the data context",
                    "options": [
                        {
                            "id": "asset:asset-1",
                            "label": "Growth CSV",
                            "description": "growth.csv",
                            "recommended": True,
                            "metadata": {
                                "asset_ids": ["asset-1"],
                                "asset_selection": "explicit",
                            },
                        },
                        {
                            "id": "answer_without_data",
                            "label": "Answer without data",
                            "metadata": {"asset_selection": "none"},
                        },
                    ],
                }
            ],
        }

    def test_slack_awaiting_state_uses_generic_fallback(self):
        from app.services import chat_platform_service as svc

        client = MagicMock()
        client.chat_postMessage = AsyncMock(return_value={"ts": "placeholder-ts"})
        client.chat_update = AsyncMock()
        keys = {"primary": "conversation.json", "backup": "backup.json"}

        with patch(
            "slack_sdk.web.async_client.AsyncWebClient", return_value=client
        ), patch.object(svc, "decrypt_token", return_value="token"), patch.object(
            svc.chat_platform_repo, "get_workspace", return_value=self._workspace()
        ), patch.object(
            svc, "_get_or_create_session", return_value=("conv-1", "proj-1", True)
        ), patch.object(
            svc, "_save_new_conversation", return_value=("bucket", keys)
        ), patch.object(
            svc, "_call_morpheus"
        ) as mock_call, patch.object(
            svc.credit_service, "consume_credits"
        ) as mock_credit, patch.object(
            svc,
            "_poll_workflow",
            new=AsyncMock(return_value=("awaiting_user_input", "clarification", {})),
        ), patch.object(
            svc, "_prepare_pending_from_conversation", return_value=None
        ):
            asyncio.run(
                svc.handle_slack_query(
                    "analyze installs",
                    "slack:T123",
                    "C123",
                    "1700.1",
                    "enc",
                )
            )

        mock_call.assert_called_once()
        mock_credit.assert_called_once_with("user-1", svc.CHAT_CREDIT_COST)
        update_kwargs = client.chat_update.call_args.kwargs
        blocks = str(update_kwargs["blocks"])
        assert "Analysis did not complete" in blocks
        assert "/workspace/project?projectId=proj-1" in blocks
        assert "quick choice" not in blocks
        assert "Define metric and period" not in blocks

    def test_slack_awaiting_state_renders_clarification_card(self):
        from app.services import chat_platform_service as svc

        client = MagicMock()
        client.chat_postMessage = AsyncMock(return_value={"ts": "placeholder-ts"})
        client.chat_update = AsyncMock()
        pending = self._pending("slack")

        with patch(
            "slack_sdk.web.async_client.AsyncWebClient", return_value=client
        ), patch.object(svc, "decrypt_token", return_value="token"), patch.object(
            svc.chat_platform_repo, "get_workspace", return_value=self._workspace()
        ), patch.object(
            svc, "_get_or_create_session", return_value=("conv-1", "proj-1", True)
        ), patch.object(
            svc,
            "_save_new_conversation",
            return_value=("bucket", {"primary": "p", "backup": "b"}),
        ), patch.object(
            svc, "_call_morpheus"
        ), patch.object(
            svc.credit_service, "consume_credits"
        ), patch.object(
            svc,
            "_poll_workflow",
            new=AsyncMock(return_value=("awaiting_user_input", "clarification", {})),
        ), patch.object(
            svc, "_prepare_pending_from_conversation", return_value=pending
        ):
            asyncio.run(
                svc.handle_slack_query(
                    "analyze installs", "slack:T123", "C123", "1700.1", "enc"
                )
            )

        blocks = client.chat_update.call_args.kwargs["blocks"]
        serialized = str(blocks)
        assert "Choose the data context" in serialized
        assert "static_select" in serialized
        assert "Open in Dreamify" in serialized
        assert "0 quick choices" not in serialized

    def test_telegram_awaiting_state_uses_generic_fallback(self):
        from app.services import chat_platform_service as svc

        bot = MagicMock()
        bot.send_message = AsyncMock(return_value=MagicMock(message_id=99))
        bot.edit_message_text = AsyncMock()

        with patch(
            "app.services.telegram_service.get_telegram_bot",
            new=AsyncMock(return_value=bot),
        ), patch.object(
            svc.chat_platform_repo,
            "get_workspace",
            return_value=self._workspace("telegram"),
        ), patch.object(
            svc, "_get_or_create_session", return_value=("conv-1", "proj-1", True)
        ), patch.object(
            svc,
            "_save_new_conversation",
            return_value=("bucket", {"primary": "p", "backup": "b"}),
        ), patch.object(
            svc, "_call_morpheus"
        ) as mock_call, patch.object(
            svc.credit_service, "consume_credits"
        ) as mock_credit, patch.object(
            svc,
            "_poll_workflow",
            new=AsyncMock(return_value=("awaiting_user_input", "clarification", {})),
        ), patch.object(
            svc, "_prepare_pending_from_conversation", return_value=None
        ):
            asyncio.run(
                svc.handle_telegram_query(
                    "analyze installs", "telegram:T123", 123, None
                )
            )

        mock_call.assert_called_once()
        mock_credit.assert_called_once_with("user-1", svc.CHAT_CREDIT_COST)
        text = bot.edit_message_text.call_args.kwargs["text"]
        assert "Analysis did not complete" in text
        assert "workspace/project?projectId\\=proj\\-1" in text
        assert "quick choice" not in text
        assert "Define metric and period" not in text

    def test_telegram_and_zalo_clarification_formatters(self):
        from app.services import chat_platform_service as svc

        pending = self._pending("telegram")
        text, markup = svc.build_telegram_clarification_message(pending, "proj-1")
        assert "Choose the data context" in text
        assert markup.inline_keyboard

        zalo_text = svc.build_zalo_clarification_message(
            self._pending("zalo"), "proj-1"
        )
        assert "Choose the data context" in zalo_text
        assert "1. Growth CSV" in zalo_text
        assert "Open in Dreamify" not in zalo_text
        assert "1. Choose the data context" not in zalo_text
        assert "Reply with 1 or 2." in zalo_text

    def test_zalo_awaiting_state_uses_generic_fallback(self):
        from app.services import chat_platform_service as svc
        from app.services import zalo_service

        with patch.object(
            zalo_service, "_bot_token", return_value="token"
        ), patch.object(
            zalo_service, "send_message", return_value={"ok": True}
        ) as mock_send, patch.object(
            svc.chat_platform_repo,
            "get_workspace",
            return_value=self._workspace("zalo"),
        ), patch.object(
            svc, "_get_or_create_session", return_value=("conv-1", "proj-1", True)
        ), patch.object(
            svc,
            "_save_new_conversation",
            return_value=("bucket", {"primary": "p", "backup": "b"}),
        ), patch.object(
            svc, "_call_morpheus"
        ) as mock_call, patch.object(
            svc.credit_service, "consume_credits"
        ) as mock_credit, patch.object(
            svc,
            "_poll_workflow",
            new=AsyncMock(return_value=("awaiting_user_input", "clarification", {})),
        ), patch.object(
            svc, "_prepare_pending_from_conversation", return_value=None
        ):
            asyncio.run(
                svc.handle_zalo_query("analyze installs", "zalo:T123", "chat-1")
            )

        mock_call.assert_called_once()
        mock_credit.assert_called_once_with("user-1", svc.CHAT_CREDIT_COST)
        sent_text = "\n".join(str(call.args) for call in mock_send.call_args_list)
        assert "Analysis did not complete" in sent_text
        assert "/workspace/project?projectId=proj-1" in sent_text
        assert "quick choice" not in sent_text
        assert "Define metric and period" not in sent_text

    def test_invalid_zalo_clarification_reply_reprompts_without_billing(self):
        from app.services import chat_platform_service as svc
        from app.services import zalo_service

        pending = self._pending("zalo")
        with patch.object(
            svc.chat_platform_repo,
            "get_session",
            return_value={"pending_clarification": pending},
        ), patch.object(
            svc.chat_platform_repo, "set_session_pending_clarification"
        ) as mock_store, patch.object(
            zalo_service, "send_message", return_value={"ok": True}
        ) as mock_send, patch.object(
            svc, "_call_morpheus"
        ) as mock_call, patch.object(
            svc.credit_service, "consume_credits"
        ) as mock_credit:
            asyncio.run(
                svc.handle_zalo_clarification_reply("not a choice", "zalo:T123", "123")
            )

        mock_store.assert_called_once()
        mock_send.assert_called_once()
        mock_call.assert_not_called()
        mock_credit.assert_not_called()
        assert "could not match" in mock_store.call_args.args[2]["last_error"].lower()

    def test_slack_continue_interaction_resumes_and_bills_once(self):
        from app.services import chat_platform_service as svc

        pending = self._pending("slack")
        value = svc._encode_callback_value(
            {"action": "continue", "thread_key": "C123#1700.1", "nonce": "nonce123"}
        )
        payload = {
            "type": "block_actions",
            "team": {"id": "T123"},
            "actions": [{"value": value}],
        }
        client = MagicMock()
        client.chat_update = AsyncMock()
        client.files_upload_v2 = AsyncMock()

        with patch(
            "slack_sdk.web.async_client.AsyncWebClient", return_value=client
        ), patch.object(
            svc.chat_platform_repo,
            "get_session",
            return_value={"pending_clarification": pending},
        ), patch.object(
            svc.chat_platform_repo,
            "get_workspace",
            return_value=self._workspace(),
        ), patch.object(
            svc, "decrypt_token", return_value="token"
        ), patch.object(
            svc.chat_platform_repo, "set_session_pending_clarification"
        ), patch.object(
            svc,
            "_append_clarification_response_node",
            return_value=("bucket", {"primary": "p", "backup": "b"}),
        ), patch.object(
            svc, "_call_morpheus"
        ) as mock_call, patch.object(
            svc.credit_service, "consume_credits"
        ) as mock_credit, patch.object(
            svc,
            "_poll_workflow",
            new=AsyncMock(return_value=("completed", "finish", {})),
        ), patch.object(
            svc,
            "_workspace_result",
            return_value=("Done", "https://example.com/dashboard", [], None),
        ), patch.object(
            svc.chat_platform_repo, "clear_session_pending_clarification"
        ):
            asyncio.run(svc.handle_slack_clarification_interaction(payload))

        mock_call.assert_called_once()
        mock_credit.assert_called_once_with("user-1", svc.CHAT_CREDIT_COST)
        assert "Done" in client.chat_update.call_args.kwargs["text"]

    def test_scheduled_slack_awaiting_state_uses_generic_fallback(self):
        from app.services import chat_platform_service as svc

        client = MagicMock()
        client.chat_postMessage = AsyncMock(return_value={"ts": "sync-ts"})
        client.chat_update = AsyncMock()
        asset = {
            "asset_id": "asset-1",
            "file_id": "file-1",
            "s3_bucket": "bucket",
            "s3_key": "assets/a.csv",
            "extension": "csv",
            "filename": "a.csv",
            "asset_type": "raw",
        }

        with patch(
            "slack_sdk.web.async_client.AsyncWebClient", return_value=client
        ), patch.object(svc, "decrypt_token", return_value="token"), patch.object(
            svc.chat_platform_repo,
            "get_workspace_by_user",
            return_value=self._workspace(),
        ), patch.object(
            svc, "save_conversation"
        ), patch.object(
            svc.conversations_repo, "create_conversation"
        ), patch.object(
            svc.projects_repo, "update_project"
        ), patch.object(
            svc, "_call_morpheus"
        ), patch.object(
            svc.credit_service, "consume_credits"
        ), patch.object(
            svc,
            "_poll_workflow",
            new=AsyncMock(return_value=("awaiting_user_input", "clarification", {})),
        ), patch.object(
            svc.chat_platform_repo, "get_session", return_value=None
        ), patch.object(
            svc.chat_platform_repo, "create_session"
        ), patch.object(
            svc, "_prepare_pending_from_conversation", return_value=None
        ):
            asyncio.run(
                svc.post_sync_to_slack(
                    "user-1", "proj-1", "C123", "ga4", "GA4 property", 7, asset
                )
            )

        blocks = str(client.chat_update.call_args.kwargs["blocks"])
        assert "Analysis did not complete" in blocks
        assert "/workspace/project?projectId=proj-1" in blocks
        assert "quick choice" not in blocks
        assert "Define metric and period" not in blocks

    def test_scheduled_slack_awaiting_state_creates_session_and_renders_card(self):
        from app.services import chat_platform_service as svc

        client = MagicMock()
        client.chat_postMessage = AsyncMock(return_value={"ts": "sync-ts"})
        client.chat_update = AsyncMock()
        asset = {
            "asset_id": "asset-1",
            "file_id": "file-1",
            "s3_bucket": "bucket",
            "s3_key": "assets/a.csv",
            "extension": "csv",
            "filename": "a.csv",
            "asset_type": "raw",
        }
        pending = self._pending("slack")
        pending["thread_key"] = "C123#sync-ts"
        pending["message"]["message_ts"] = "sync-ts"
        pending["message"]["thread_ts"] = "sync-ts"

        with patch(
            "slack_sdk.web.async_client.AsyncWebClient", return_value=client
        ), patch.object(svc, "decrypt_token", return_value="token"), patch.object(
            svc.chat_platform_repo,
            "get_workspace_by_user",
            return_value=self._workspace(),
        ), patch.object(
            svc, "save_conversation"
        ), patch.object(
            svc.conversations_repo, "create_conversation"
        ), patch.object(
            svc.projects_repo, "update_project"
        ), patch.object(
            svc, "_call_morpheus"
        ), patch.object(
            svc.credit_service, "consume_credits"
        ), patch.object(
            svc,
            "_poll_workflow",
            new=AsyncMock(return_value=("awaiting_user_input", "clarification", {})),
        ), patch.object(
            svc.chat_platform_repo, "get_session", return_value=None
        ), patch.object(
            svc.chat_platform_repo, "create_session"
        ) as mock_create_session, patch.object(
            svc, "_prepare_pending_from_conversation", return_value=pending
        ):
            asyncio.run(
                svc.post_sync_to_slack(
                    "user-1", "proj-1", "C123", "ga4", "GA4 property", 7, asset
                )
            )

        mock_create_session.assert_called_once()
        assert mock_create_session.call_args.kwargs["thread_key"] == "C123#sync-ts"
        blocks = str(client.chat_update.call_args.kwargs["blocks"])
        assert "Choose the data context" in blocks
        assert "static_select" in blocks


class TestChatPlatformRoutes:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def _mock_request(self, body_json: dict) -> MagicMock:
        from unittest.mock import AsyncMock

        req = MagicMock()
        req.body = AsyncMock(return_value=json.dumps(body_json).encode())
        return req

    def _mock_json_request(self, body_json: dict) -> MagicMock:
        from unittest.mock import AsyncMock

        req = MagicMock()
        req.json = AsyncMock(return_value=body_json)
        req.headers = {}
        return req

    def test_slack_url_verification(self):
        from app.api.route_modules.chat_platform import slack_events

        challenge = "3eZbrw1aBm2rZgRNFdxV2595E9CY3QKc4ZhdAgX"
        payload = {"type": "url_verification", "challenge": challenge}
        result = self._run(slack_events(self._mock_request(payload), MagicMock()))
        assert result["challenge"] == challenge

    def test_slack_interactions_verifies_signature_and_dispatches(self):
        import hashlib
        import hmac
        import time
        from urllib.parse import quote
        from fastapi import BackgroundTasks
        from app.api.route_modules import chat_platform

        payload = {
            "type": "block_actions",
            "team": {"id": "T123"},
            "actions": [{"value": "value"}],
        }
        body = f"payload={quote(json.dumps(payload))}".encode()
        timestamp = str(int(time.time()))
        signature = (
            "v0="
            + hmac.new(
                b"secret",
                f"v0:{timestamp}:{body.decode()}".encode(),
                hashlib.sha256,
            ).hexdigest()
        )
        req = MagicMock()
        req.body = AsyncMock(return_value=body)
        req.headers = {
            "X-Slack-Request-Timestamp": timestamp,
            "X-Slack-Signature": signature,
        }
        bg = MagicMock(spec=BackgroundTasks)

        with patch.object(
            chat_platform.config, "slack", MagicMock(signing_secret="secret")
        ):
            result = self._run(chat_platform.slack_interactions(req, bg))

        assert result["ok"] is True
        bg.add_task.assert_called_once()
        assert (
            bg.add_task.call_args.args[0].__name__
            == "handle_slack_clarification_interaction"
        )

    def test_slack_interactions_rejects_invalid_signature(self):
        import time
        from fastapi import HTTPException
        from app.api.route_modules import chat_platform

        req = MagicMock()
        req.body = AsyncMock(return_value=b"payload=%7B%7D")
        req.headers = {
            "X-Slack-Request-Timestamp": str(int(time.time())),
            "X-Slack-Signature": "v0=bad",
        }
        with patch.object(
            chat_platform.config, "slack", MagicMock(signing_secret="secret")
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(chat_platform.slack_interactions(req, MagicMock()))
        assert exc.value.status_code == 403

    def test_slack_mention_unknown_workspace_returns_ok(self):
        from app.api.route_modules.chat_platform import slack_events

        payload = {
            "team_id": "T_UNKNOWN",
            "type": "event_callback",
            "event": {
                "type": "app_mention",
                "text": "<@U123> why did signups drop?",
                "channel": "C001",
                "ts": "1700000000.000001",
            },
        }
        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=None,
        ):
            result = self._run(slack_events(self._mock_request(payload), MagicMock()))
        assert result["ok"] is True

    def test_fetch_slack_files_uses_thread_parent_and_exact_message_ts(self):
        from app.api.route_modules.chat_platform import _fetch_slack_files
        from app.api.route_modules import chat_platform

        captured: Dict[str, Any] = {}
        slack_file = {"id": "F123", "name": "growth.csv"}

        def _fake_get(url, headers=None, params=None, timeout=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["params"] = params
            captured["timeout"] = timeout
            response = MagicMock()
            response.json.return_value = {
                "ok": True,
                "messages": [{"ts": "1700.2", "files": [slack_file]}],
            }
            return response

        with patch.object(chat_platform.http_requests, "get", side_effect=_fake_get):
            files = _fetch_slack_files(
                "xoxb-token", "C123", "1700.2", thread_ts="1700.1"
            )

        assert files == [slack_file]
        assert captured["params"]["ts"] == "1700.1"
        assert captured["params"]["oldest"] == "1700.2"
        assert captured["params"]["latest"] == "1700.2"
        assert captured["params"]["inclusive"] == "true"

    def test_slack_mention_dispatches_fetched_files(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import slack_events

        bg = MagicMock(spec=BackgroundTasks)
        slack_file = {"id": "F123", "name": "growth.csv"}
        workspace = {
            "platform_workspace_id": "slack:T123",
            "platform": "slack",
            "workspace_name": "Acme",
            "project_id": "proj-1",
            "language": "en",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "bot_token_encrypted": "enc",
            "user_id": "user-1",
        }
        payload = {
            "team_id": "T123",
            "type": "event_callback",
            "event": {
                "type": "app_mention",
                "text": "<@U123> analyze this csv",
                "channel": "C123",
                "thread_ts": "1700.1",
                "ts": "1700.2",
            },
        }

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=workspace,
        ), patch(
            "app.api.route_modules.chat_platform.decrypt_token",
            return_value="xoxb-token",
        ), patch(
            "app.api.route_modules.chat_platform._fetch_slack_files",
            return_value=[slack_file],
        ) as mock_fetch:
            result = self._run(slack_events(self._mock_request(payload), bg))

        assert result["ok"] is True
        mock_fetch.assert_called_once_with(
            "xoxb-token", "C123", "1700.2", thread_ts="1700.1"
        )
        bg.add_task.assert_called_once()
        kwargs = bg.add_task.call_args.kwargs
        assert kwargs["thread_ts"] == "1700.1"
        assert kwargs["slack_files"] == [slack_file]

    def test_get_workspace_not_found(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import get_workspace

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=None,
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(get_workspace("slack:NOTEXIST"))
        assert exc.value.status_code == 404

    def test_get_workspace_found(self):
        from app.api.route_modules.chat_platform import get_workspace

        workspace = {
            "platform_workspace_id": "slack:T123",
            "platform": "slack",
            "workspace_name": "Acme",
            "project_id": "proj-1",
            "language": "en",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "bot_token_encrypted": "enc",
            "user_id": "user-1",
        }
        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=workspace,
        ):
            result = self._run(get_workspace("slack:T123"))
        assert result.platform == "slack"
        assert result.workspace_name == "Acme"
        assert not hasattr(result, "bot_token_encrypted")


# ── State token helpers ───────────────────────────────────────────────────────


class TestStateToken:
    def test_round_trip(self):
        from app.api.route_modules.chat_platform import (
            _create_state_token,
            _verify_state_token,
        )

        token = _create_state_token("user_abc")
        assert _verify_state_token(token) == "user_abc"

    def test_tampered_token_raises(self):
        import base64
        from app.api.route_modules.chat_platform import (
            _create_state_token,
            _verify_state_token,
        )

        token = _create_state_token("user_abc")
        # Flip a character in the signature portion
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        payload_str, sig = raw.rsplit("||", 1)
        bad_sig = sig[:-4] + "XXXX"
        bad_raw = f"{payload_str}||{bad_sig}"
        bad_token = base64.urlsafe_b64encode(bad_raw.encode()).decode()
        with pytest.raises(ValueError, match="Invalid signature"):
            _verify_state_token(bad_token)

    def test_expired_token_raises(self):
        import json, time, hmac, hashlib, base64
        from utils.config import config

        payload = json.dumps({"user_id": "user_abc", "exp": int(time.time()) - 1})
        sig = hmac.new(
            config.app.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        raw = f"{payload}||{sig}"
        token = base64.urlsafe_b64encode(raw.encode()).decode()
        from app.api.route_modules.chat_platform import _verify_state_token

        with pytest.raises(ValueError, match="expired"):
            _verify_state_token(token)


# ── get_workspace_by_user ─────────────────────────────────────────────────────


class TestGetWorkspaceByUser:
    def test_returns_matching_workspace(self):
        workspace = {
            "platform_workspace_id": "slack:T123",
            "user_id": "user-1",
            "platform": "slack",
        }
        mock_table = MagicMock()
        mock_table.scan.return_value = {"Items": [workspace]}
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table
        ):
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.get_workspace_by_user("user-1", "slack")
        assert result["platform_workspace_id"] == "slack:T123"

    def test_returns_none_when_no_match(self):
        mock_table = MagicMock()
        mock_table.scan.return_value = {"Items": []}
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table
        ):
            from utils.dynamodb.repos import chat_platform_repo

            result = chat_platform_repo.get_workspace_by_user("user-999", "slack")
        assert result is None


# ── GET /chat/slack/me ────────────────────────────────────────────────────────


class TestGetSlackMe:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def test_not_connected(self):
        from app.api.route_modules.chat_platform import get_slack_status

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user",
            return_value=None,
        ):
            result = self._run(get_slack_status(user_id="user-1"))
        assert result.connected is False

    def test_connected(self):
        from app.api.route_modules.chat_platform import get_slack_status

        workspace = {
            "platform_workspace_id": "slack:T123",
            "workspace_name": "Acme",
            "project_id": "proj-1",
            "user_id": "user-1",
            "platform": "slack",
        }
        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user",
            return_value=workspace,
        ):
            result = self._run(get_slack_status(user_id="user-1"))
        assert result.connected is True
        assert result.workspace_name == "Acme"


# ── DELETE /chat/workspaces/{id} ──────────────────────────────────────────────


class TestDisconnectWorkspace:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def _workspace(self, user_id: str) -> dict:
        return {
            "platform_workspace_id": "slack:T123",
            "user_id": user_id,
            "platform": "slack",
            "workspace_name": "Acme",
            "project_id": "proj-1",
            "language": "en",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    def test_owner_can_disconnect(self):
        from app.api.route_modules.chat_platform import disconnect_workspace

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=self._workspace("user-1"),
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.delete_workspace"
        ) as mock_delete:
            result = self._run(disconnect_workspace("slack:T123", user_id="user-1"))
        assert result["ok"] is True
        mock_delete.assert_called_once_with("slack:T123")

    def test_other_user_gets_403(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import disconnect_workspace

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=self._workspace("user-owner"),
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(disconnect_workspace("slack:T123", user_id="user-other"))
        assert exc.value.status_code == 403

    def test_nonexistent_workspace_gets_404(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import disconnect_workspace

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=None,
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(disconnect_workspace("slack:GONE", user_id="user-1"))
        assert exc.value.status_code == 404


# ── Telegram service — formatters ─────────────────────────────────────────────


class TestTelegramFormatters:
    def test_escape_markdown_special_chars(self):
        from app.services.telegram_service import escape_markdown

        assert escape_markdown("1+1=2 (ok)") == r"1\+1\=2 \(ok\)"

    def test_escape_markdown_plain_text_unchanged(self):
        from app.services.telegram_service import escape_markdown

        assert escape_markdown("hello world") == "hello world"

    def test_format_analyzing_message(self):
        from app.services.telegram_service import format_analyzing_message

        msg = format_analyzing_message("why did revenue drop?")
        assert "Analyzing" in msg
        assert "revenue drop" in msg

    def test_format_analyzing_message_truncates_long_query(self):
        from app.services.telegram_service import format_analyzing_message

        long_query = "x" * 100
        msg = format_analyzing_message(long_query)
        assert "…" in msg

    def test_format_status_message(self):
        from app.services.telegram_service import format_status_message

        msg = format_status_message("Loading data...")
        assert "Loading data" in msg
        assert "⏳" in msg

    def test_format_error_message(self):
        from app.services.telegram_service import format_error_message

        msg = format_error_message("Something went wrong.")
        assert "⚠️" in msg
        assert "Something went wrong" in msg

    def test_format_response_message_no_dashboard(self):
        from app.services.telegram_service import format_response_message

        msg = format_response_message("Revenue grew 12%.", None, 5)
        assert "Dreamify" in msg
        assert "Revenue grew" in msg
        assert "5 credits" in msg
        assert "View Dashboard" not in msg

    def test_format_response_message_with_metrics(self):
        from app.services.telegram_service import format_response_message

        metrics = [
            {"title": "Revenue", "value": "$142k", "change": "+12%", "trend": "up"},
            {"title": "Users", "value": "8420", "change": "-3%", "trend": "down"},
        ]
        msg = format_response_message(
            "Analysis done.", "https://app.dreamify.dev/x", 5, metrics
        )
        assert "Revenue" in msg
        assert "📈" in msg
        assert "Users" in msg
        assert "📉" in msg

    def test_format_response_message_metrics_capped_at_four(self):
        from app.services.telegram_service import format_response_message

        metrics = [{"title": f"M{i}", "value": i} for i in range(6)]
        msg = format_response_message("ok", None, 5, metrics)
        # Only first 4 metric titles should appear
        assert "M0" in msg and "M3" in msg
        assert "M4" not in msg


# ── Telegram repo — get_workspace_by_telegram_user_id ─────────────────────────


class TestGetWorkspaceByTelegramUserId:
    def _make_scan_mock(self, items: list) -> MagicMock:
        mock = MagicMock()
        mock.scan.return_value = {"Items": items}
        return mock

    def test_found(self):
        from utils.dynamodb.repos.chat_platform_repo import (
            get_workspace_by_telegram_user_id,
        )

        workspace = {
            "platform_workspace_id": "telegram:123",
            "platform": "telegram",
            "telegram_user_id": "123",
            "user_id": "u1",
        }
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table",
            return_value=self._make_scan_mock([workspace]),
        ):
            result = get_workspace_by_telegram_user_id("123")
        assert result is not None
        assert result["telegram_user_id"] == "123"

    def test_not_found(self):
        from utils.dynamodb.repos.chat_platform_repo import (
            get_workspace_by_telegram_user_id,
        )

        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table",
            return_value=self._make_scan_mock([]),
        ):
            result = get_workspace_by_telegram_user_id("999")
        assert result is None


# ── Telegram repo — save_workspace with telegram_user_id ─────────────────────


class TestSaveWorkspaceWithTelegramUserId:
    def test_telegram_user_id_stored(self):
        from utils.dynamodb.repos.chat_platform_repo import save_workspace

        mock_table = MagicMock()
        mock_table.put_item.return_value = {}
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table
        ):
            result = save_workspace(
                platform_workspace_id="telegram:123",
                user_id="u1",
                project_id="p1",
                platform="telegram",
                bot_token_encrypted="",
                telegram_user_id="123",
            )
        assert result["telegram_user_id"] == "123"
        stored = mock_table.put_item.call_args[1]["Item"]
        assert stored["telegram_user_id"] == "123"

    def test_telegram_user_id_omitted_when_none(self):
        from utils.dynamodb.repos.chat_platform_repo import save_workspace

        mock_table = MagicMock()
        mock_table.put_item.return_value = {}
        with patch(
            "utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table
        ):
            result = save_workspace(
                platform_workspace_id="slack:T123",
                user_id="u1",
                project_id="p1",
                platform="slack",
                bot_token_encrypted="enc",
            )
        assert "telegram_user_id" not in result
        stored = mock_table.put_item.call_args[1]["Item"]
        assert "telegram_user_id" not in stored


# ── POST /chat/telegram/generate-code ────────────────────────────────────────


class TestTelegramGenerateCode:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def test_returns_deeplink_and_stores_pending(self):
        from app.api.route_modules.chat_platform import telegram_generate_code

        with patch(
            "app.api.route_modules.chat_platform._telegram_bot_token",
            return_value="tok",
        ), patch(
            "app.api.route_modules.chat_platform._telegram_bot_username",
            return_value="TestBot",
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.save_workspace"
        ) as mock_save:
            result = self._run(telegram_generate_code(user_id="u1"))
        assert result.bot_username == "TestBot"
        assert result.deeplink.startswith("https://t.me/TestBot?start=")
        assert len(result.code) == 8
        assert result.expires_in == 900
        # Pending entry created
        mock_save.assert_called_once()
        call_kwargs = mock_save.call_args[1]
        assert call_kwargs["platform"] == "telegram_pending"
        assert call_kwargs["user_id"] == "u1"
        assert call_kwargs["platform_workspace_id"].startswith("pending:")

    def test_503_when_not_configured(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import telegram_generate_code

        with patch(
            "app.api.route_modules.chat_platform._telegram_bot_token", return_value=""
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(telegram_generate_code(user_id="u1"))
        assert exc.value.status_code == 503


# ── GET /chat/telegram/me ────────────────────────────────────────────────────


class TestGetTelegramStatus:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def test_not_connected(self):
        from app.api.route_modules.chat_platform import get_telegram_status

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user",
            return_value=None,
        ):
            result = self._run(get_telegram_status(user_id="u1"))
        assert result.connected is False

    def test_connected(self):
        from app.api.route_modules.chat_platform import get_telegram_status

        workspace = {
            "platform_workspace_id": "telegram:999",
            "workspace_name": "MyDM",
            "project_id": "proj-tg",
        }
        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user",
            return_value=workspace,
        ):
            result = self._run(get_telegram_status(user_id="u1"))
        assert result.connected is True
        assert result.workspace_name == "MyDM"
        assert result.platform_workspace_id == "telegram:999"


# ── POST /chat/telegram/webhook — /start code handling ───────────────────────


class TestTelegramWebhookStart:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def _make_request(
        self, text: str, chat_type: str = "private", from_id: int = 42
    ) -> MagicMock:
        payload = {
            "message": {
                "text": text,
                "chat": {"id": 100, "type": chat_type},
                "from": {"id": from_id, "first_name": "Alice"},
            }
        }
        req = MagicMock()
        req.headers = {}
        req.json = MagicMock(return_value=payload)

        async def _json():
            return payload

        req.json = _json
        return req

    def test_valid_code_dispatches_start_task(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import telegram_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request("/start ABCD1234")
        with patch(
            "app.api.route_modules.chat_platform._telegram_webhook_secret",
            return_value="",
        ):
            result = self._run(telegram_webhook(req, bg))
        assert result == {"ok": True}
        bg.add_task.assert_called_once()
        # first arg is the handler function
        task_fn = bg.add_task.call_args[0][0]
        assert task_fn.__name__ == "_handle_telegram_start"

    def test_no_code_dispatches_hint_task(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import telegram_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request("/start")
        with patch(
            "app.api.route_modules.chat_platform._telegram_webhook_secret",
            return_value="",
        ):
            result = self._run(telegram_webhook(req, bg))
        assert result == {"ok": True}
        task_fn = bg.add_task.call_args[0][0]
        assert task_fn.__name__ == "_send_telegram_start_hint"

    def test_invalid_secret_returns_403(self):
        from fastapi import BackgroundTasks, HTTPException
        from app.api.route_modules.chat_platform import telegram_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request("hello")
        req.headers = {"X-Telegram-Bot-Api-Secret-Token": "wrong"}
        with patch(
            "app.api.route_modules.chat_platform._telegram_webhook_secret",
            return_value="correctsecret",
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(telegram_webhook(req, bg))
        assert exc.value.status_code == 403

    def test_valid_secret_passes(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import telegram_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request("hello")
        req.headers = {"X-Telegram-Bot-Api-Secret-Token": "mysecret"}
        # No workspace registered → silently returns ok (not a start command, not a known workspace)
        with patch(
            "app.api.route_modules.chat_platform._telegram_webhook_secret",
            return_value="mysecret",
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=None,
        ):
            result = self._run(telegram_webhook(req, bg))
        assert result == {"ok": True}

    def test_document_with_caption_dispatches_query(self):
        """Telegram puts caption text on document messages in `caption`, not
        `text`. Make sure file uploads with prompts aren't silently dropped."""
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import telegram_webhook

        bg = MagicMock(spec=BackgroundTasks)

        payload = {
            "message": {
                "message_id": 99,
                "caption": "đây là data NRU tháng đầu",
                "document": {
                    "file_id": "BQACAgUAAxkBAAMe",
                    "file_name": "DATA.csv",
                },
                "chat": {"id": 100, "type": "private"},
                "from": {"id": 42, "first_name": "Alice"},
            }
        }
        req = MagicMock()
        req.headers = {}

        async def _json():
            return payload

        req.json = _json

        ws = {
            "platform_workspace_id": "telegram:100",
            "user_id": "u1",
            "project_id": "p1",
            "platform": "telegram",
        }
        telegram_files = [
            {
                "filename": "DATA.csv",
                "size": 0,
                "ext": "csv",
                "download_url": "https://telegram.example/file/DATA.csv",
            }
        ]
        with patch(
            "app.api.route_modules.chat_platform._telegram_webhook_secret",
            return_value="",
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=ws,
        ), patch(
            "app.api.route_modules.chat_platform._fetch_telegram_document_metadata",
            new_callable=AsyncMock,
        ) as mock_fetch:
            mock_fetch.return_value = telegram_files
            result = self._run(telegram_webhook(req, bg))
        assert result == {"ok": True}
        mock_fetch.assert_awaited_once()
        bg.add_task.assert_called_once()
        task_fn = bg.add_task.call_args[0][0]
        assert task_fn.__name__ == "handle_telegram_query"
        kwargs = bg.add_task.call_args[1]
        assert kwargs["query"] == "đây là data NRU tháng đầu"
        assert kwargs["telegram_files"] == telegram_files

    def test_document_with_no_caption_dispatches_query(self):
        """A bare file (no caption) is still actionable — DM handler should
        run a query with placeholder text."""
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import telegram_webhook

        bg = MagicMock(spec=BackgroundTasks)

        payload = {
            "message": {
                "message_id": 99,
                "document": {"file_id": "FILE123", "file_name": "x.csv"},
                "chat": {"id": 100, "type": "private"},
                "from": {"id": 42},
            }
        }
        req = MagicMock()
        req.headers = {}

        async def _json():
            return payload

        req.json = _json

        ws = {
            "platform_workspace_id": "telegram:100",
            "user_id": "u1",
            "project_id": "p1",
            "platform": "telegram",
        }
        telegram_files = [
            {
                "filename": "x.csv",
                "size": 0,
                "ext": "csv",
                "download_url": "https://telegram.example/file/x.csv",
            }
        ]
        with patch(
            "app.api.route_modules.chat_platform._telegram_webhook_secret",
            return_value="",
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=ws,
        ), patch(
            "app.api.route_modules.chat_platform._fetch_telegram_document_metadata",
            new_callable=AsyncMock,
        ) as mock_fetch:
            mock_fetch.return_value = telegram_files
            result = self._run(telegram_webhook(req, bg))
        assert result == {"ok": True}
        mock_fetch.assert_awaited_once()
        bg.add_task.assert_called_once()
        kwargs = bg.add_task.call_args[1]
        assert "(file attached)" in kwargs["query"]
        assert kwargs["telegram_files"] == telegram_files


# ── _handle_telegram_start integration ───────────────────────────────────────


class TestHandleTelegramStart:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def _pending(self, code: str, user_id: str, age_seconds: int = 0) -> dict:
        from datetime import timedelta

        created = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        return {
            "platform_workspace_id": f"pending:{code}",
            "platform": "telegram_pending",
            "user_id": user_id,
            "project_id": "",
            "created_at": created.isoformat(),
        }

    def test_valid_code_creates_workspace(self):
        from app.api.route_modules.chat_platform import _handle_telegram_start

        mock_bot = MagicMock()
        mock_bot.send_message = MagicMock(return_value=MagicMock())

        async def _send(**kwargs):
            return MagicMock()

        mock_bot.send_message = _send

        pending = self._pending("VALID123", "dreamify-user-1")
        new_project = {"project_id": "proj-new"}

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            side_effect=[pending, None],
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.save_workspace"
        ) as mock_save, patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.delete_workspace"
        ) as mock_del, patch(
            "app.api.route_modules.chat_platform.projects_repo.create_project",
            return_value=new_project,
        ), patch(
            "app.services.telegram_service.get_telegram_bot", return_value=mock_bot
        ):
            self._run(
                _handle_telegram_start(
                    "VALID123", 100, "42", {"id": 42, "first_name": "Alice"}
                )
            )

        mock_save.assert_called_once()
        saved = mock_save.call_args[1]
        assert saved["platform_workspace_id"] == "telegram:100"
        assert saved["platform"] == "telegram"
        assert saved["telegram_user_id"] == "42"
        mock_del.assert_called_once_with("pending:VALID123")

    def test_expired_code_sends_error(self):
        from app.api.route_modules.chat_platform import _handle_telegram_start

        sent_texts = []

        async def _send(**kwargs):
            sent_texts.append(kwargs.get("text", ""))
            return MagicMock()

        mock_bot = MagicMock()
        mock_bot.send_message = _send

        expired = self._pending("EXP123", "u1", age_seconds=1000)

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=expired,
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.delete_workspace"
        ), patch(
            "app.services.telegram_service.get_telegram_bot", return_value=mock_bot
        ):
            self._run(_handle_telegram_start("EXP123", 100, "42", {}))

        assert any("expired" in t.lower() for t in sent_texts)

    def test_unknown_code_sends_error(self):
        from app.api.route_modules.chat_platform import _handle_telegram_start

        sent_texts = []

        async def _send(**kwargs):
            sent_texts.append(kwargs.get("text", ""))
            return MagicMock()

        mock_bot = MagicMock()
        mock_bot.send_message = _send

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=None,
        ), patch(
            "app.services.telegram_service.get_telegram_bot", return_value=mock_bot
        ):
            self._run(_handle_telegram_start("UNKNOWN", 100, "42", {}))

        assert any("not found" in t.lower() for t in sent_texts)


# ── Zalo Bot Platform tests ──────────────────────────────────────────────────


class TestZaloService:
    def test_chunk_short_text_returns_single_chunk(self):
        from app.services.zalo_service import _chunk_text

        out = _chunk_text("hello world")
        assert out == ["hello world"]

    def test_chunk_long_text_splits_on_paragraph(self):
        from app.services.zalo_service import _chunk_text

        text = "para1\n\n" + "x" * 1500 + "\n\n" + "y" * 1500
        chunks = _chunk_text(text, limit=1800)
        assert len(chunks) >= 2
        assert all(len(c) <= 1800 for c in chunks)

    def test_format_response_appends_dashboard_url_as_text(self):
        from app.services.zalo_service import format_response_message

        out = format_response_message(
            "Sales are up.", "https://example.com/dash/123", credits_used=5, metrics=[]
        )
        assert "https://example.com/dash/123" in out
        assert "5 credits used" in out

    def test_format_response_no_dashboard(self):
        from app.services.zalo_service import format_response_message

        out = format_response_message("ok", None, credits_used=5)
        assert "View dashboard" not in out

    def test_format_error_message(self):
        from app.services.zalo_service import format_error_message

        assert format_error_message("nope").startswith("⚠️")


class TestZaloGenerateCode:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def test_zalo_upload_app_url_uses_frontend_base(self, monkeypatch):
        from app.api.route_modules import chat_platform

        monkeypatch.setattr(
            chat_platform.config.chat_platform,
            "frontend_app_url",
            "https://api.dreamify.dev/",
        )

        assert chat_platform._zalo_upload_app_url() == "https://app.dreamify.dev"

    def test_returns_bot_url_and_stores_pending(self):
        from app.api.route_modules.chat_platform import zalo_generate_code

        with patch(
            "app.api.route_modules.chat_platform._zalo_bot_token",
            return_value="123:abc",
        ), patch(
            "app.api.route_modules.chat_platform._zalo_bot_username",
            return_value="DreamifyBot",
        ), patch(
            "app.api.route_modules.chat_platform._zalo_bot_id", return_value="123"
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.save_workspace"
        ) as mock_save:
            result = self._run(zalo_generate_code(user_id="u1"))
        assert result.bot_username == "DreamifyBot"
        assert result.bot_id == "123"
        assert result.bot_url == "https://zalo.me/123"
        assert len(result.code) == 8
        assert result.expires_in == 900
        mock_save.assert_called_once()
        call_kwargs = mock_save.call_args[1]
        assert call_kwargs["platform"] == "zalo_pending"
        assert call_kwargs["user_id"] == "u1"
        assert call_kwargs["platform_workspace_id"].startswith("pending:")

    def test_503_when_not_configured(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import zalo_generate_code

        with patch(
            "app.api.route_modules.chat_platform._zalo_bot_token", return_value=""
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(zalo_generate_code(user_id="u1"))
        assert exc.value.status_code == 503


class TestGetZaloStatus:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def test_not_connected(self):
        from app.api.route_modules.chat_platform import get_zalo_status

        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user",
            return_value=None,
        ):
            result = self._run(get_zalo_status(user_id="u1"))
        assert result.connected is False

    def test_connected(self):
        from app.api.route_modules.chat_platform import get_zalo_status

        workspace = {
            "platform_workspace_id": "zalo:777",
            "workspace_name": "Hung",
            "project_id": "proj-zalo",
        }
        with patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user",
            return_value=workspace,
        ):
            result = self._run(get_zalo_status(user_id="u1"))
        assert result.connected is True
        assert result.workspace_name == "Hung"
        assert result.platform_workspace_id == "zalo:777"


class TestZaloWebhook:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def _make_request(self, message: dict, headers: dict = None) -> MagicMock:
        payload = {"ok": True, "result": {"update_id": 1, "message": message}}
        req = MagicMock()
        req.headers = headers or {}

        async def _json():
            return payload

        req.json = _json
        return req

    def _msg(self, text: str, chat_type: str = "PRIVATE", from_id: str = "42"):
        return {
            "message_id": "m1",
            "text": text,
            "event_name": "text_message",
            "chat": {"id": "100", "chat_type": chat_type},
            "from": {"id": from_id, "display_name": "Alice"},
        }

    def test_invalid_secret_returns_403(self):
        from fastapi import BackgroundTasks, HTTPException
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request(
            self._msg("hi"), headers={"X-Bot-Api-Secret-Token": "wrong"}
        )
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret",
            return_value="correct",
        ):
            with pytest.raises(HTTPException) as exc:
                self._run(zalo_webhook(req, bg))
        assert exc.value.status_code == 403

    def test_valid_secret_passes(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request(
            self._msg("hi"), headers={"X-Bot-Api-Secret-Token": "mysecret"}
        )
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret",
            return_value="mysecret",
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=None,
        ):
            result = self._run(zalo_webhook(req, bg))
        assert result == {"ok": True}

    def test_start_with_code_dispatches_handler(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request(self._msg("start ABCD1234"))
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret", return_value=""
        ):
            result = self._run(zalo_webhook(req, bg))
        assert result == {"ok": True}
        bg.add_task.assert_called_once()
        task_fn = bg.add_task.call_args[0][0]
        assert task_fn.__name__ == "_handle_zalo_start"

    def test_start_no_code_dispatches_hint(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request(self._msg("start"))
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret", return_value=""
        ):
            result = self._run(zalo_webhook(req, bg))
        assert result == {"ok": True}
        task_fn = bg.add_task.call_args[0][0]
        assert task_fn.__name__ == "_send_zalo_start_hint"

    def test_group_chat_ignored_phase1(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request(self._msg("hello", chat_type="GROUP"))
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret", return_value=""
        ):
            result = self._run(zalo_webhook(req, bg))
        assert result == {"ok": True}
        bg.add_task.assert_not_called()

    def test_known_workspace_dispatches_query(self):
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        req = self._make_request(self._msg("show campaigns"))
        ws = {
            "platform_workspace_id": "zalo:100",
            "user_id": "u1",
            "project_id": "p1",
            "platform": "zalo",
        }
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret", return_value=""
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=ws,
        ):
            result = self._run(zalo_webhook(req, bg))
        assert result == {"ok": True}
        bg.add_task.assert_called_once()
        task_fn = bg.add_task.call_args[0][0]
        assert task_fn.__name__ == "handle_zalo_query"

    def test_dispatches_query_for_message_text_received_event(self):
        """Zalo's actual event_name is `message.text.received` (not the
        `text_message` we initially coded against). Make sure we don't
        gatekeep on the string and silently drop real user messages."""
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        # Top-level event_name (where Zalo actually puts it) using the
        # production naming.
        payload = {
            "event_name": "message.text.received",
            "message": {
                "message_id": "m1",
                "text": "hello who are you",
                "chat": {"id": "100", "chat_type": "PRIVATE"},
                "from": {"id": "42", "display_name": "Alice"},
            },
        }
        req = MagicMock()
        req.headers = {}

        async def _json():
            return payload

        req.json = _json

        ws = {
            "platform_workspace_id": "zalo:100",
            "user_id": "u1",
            "project_id": "p1",
            "platform": "zalo",
        }
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret", return_value=""
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=ws,
        ):
            result = self._run(zalo_webhook(req, bg))
        assert result == {"ok": True}
        bg.add_task.assert_called_once()
        task_fn = bg.add_task.call_args[0][0]
        assert task_fn.__name__ == "handle_zalo_query"

    def test_unknown_event_name_with_text_still_dispatches(self):
        """Future-proofing: Zalo may shift event names again. As long as
        text is present, we still process the message."""
        from fastapi import BackgroundTasks
        from app.api.route_modules.chat_platform import zalo_webhook

        bg = MagicMock(spec=BackgroundTasks)
        payload = {
            "event_name": "some.future.naming",
            "message": {
                "message_id": "m1",
                "text": "still works",
                "chat": {"id": "100", "chat_type": "PRIVATE"},
                "from": {"id": "42"},
            },
        }
        req = MagicMock()
        req.headers = {}

        async def _json():
            return payload

        req.json = _json

        ws = {
            "platform_workspace_id": "zalo:100",
            "user_id": "u1",
            "project_id": "p1",
            "platform": "zalo",
        }
        with patch(
            "app.api.route_modules.chat_platform._zalo_webhook_secret", return_value=""
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=ws,
        ):
            result = self._run(zalo_webhook(req, bg))
        assert result == {"ok": True}
        bg.add_task.assert_called_once()
        assert bg.add_task.call_args[0][0].__name__ == "handle_zalo_query"


class TestHandleZaloStart:
    def _pending(self, code: str, user_id: str, age_seconds: int = 0) -> dict:
        from datetime import timedelta

        created = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        return {
            "platform_workspace_id": f"pending:{code}",
            "platform": "zalo_pending",
            "user_id": user_id,
            "project_id": "",
            "created_at": created.isoformat(),
        }

    def test_valid_code_creates_workspace(self):
        from app.api.route_modules.chat_platform import _handle_zalo_start

        pending = self._pending("ZAL12345", "user-1")
        new_project = {"project_id": "proj-new"}

        with patch(
            "app.services.zalo_service._bot_token", return_value="123:abc"
        ), patch(
            "app.services.zalo_service.send_message", return_value={"ok": True}
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            side_effect=[pending, None],
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.save_workspace"
        ) as mock_save, patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.delete_workspace"
        ) as mock_del, patch(
            "app.api.route_modules.chat_platform.projects_repo.create_project",
            return_value=new_project,
        ):
            _handle_zalo_start(
                "ZAL12345", "100", "42", {"id": "42", "display_name": "Alice"}
            )

        mock_save.assert_called_once()
        saved = mock_save.call_args[1]
        assert saved["platform_workspace_id"] == "zalo:100"
        assert saved["platform"] == "zalo"
        assert saved["zalo_user_id"] == "42"
        mock_del.assert_called_once_with("pending:ZAL12345")

    def test_expired_code_deletes_pending(self):
        from app.api.route_modules.chat_platform import _handle_zalo_start

        sent = []

        def _send(chat_id, text):
            sent.append(text)
            return {"ok": True}

        expired = self._pending("EXP123", "u1", age_seconds=2000)

        with patch(
            "app.services.zalo_service._bot_token", return_value="123:abc"
        ), patch("app.services.zalo_service.send_message", side_effect=_send), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=expired,
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.delete_workspace"
        ) as mock_del:
            _handle_zalo_start("EXP123", "100", "42", {})

        assert any("expired" in t.lower() for t in sent)
        mock_del.assert_called_once()

    def test_unknown_code_sends_error(self):
        from app.api.route_modules.chat_platform import _handle_zalo_start

        sent = []

        def _send(chat_id, text):
            sent.append(text)
            return {"ok": True}

        with patch(
            "app.services.zalo_service._bot_token", return_value="123:abc"
        ), patch("app.services.zalo_service.send_message", side_effect=_send), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value=None,
        ):
            _handle_zalo_start("MISSING", "100", "42", {})

        assert any("not found" in t.lower() for t in sent)

    def test_bot_not_configured_returns_silently(self):
        from app.api.route_modules.chat_platform import _handle_zalo_start

        with patch("app.services.zalo_service._bot_token", return_value=""), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace"
        ) as mock_get:
            _handle_zalo_start("X", "100", "42", {})
        mock_get.assert_not_called()


# ── Chart-image delivery (Phase 2B) ──────────────────────────────────────────


class TestZaloSendPhoto:
    """Unit tests for the multipart sendPhoto helper."""

    def test_send_photo_posts_multipart_with_caption(self):
        from app.services import zalo_service

        captured = {}

        class _FakeResp:
            content = b'{"ok": true, "result": {"message_id": "m1"}}'

            def json(self):
                return {"ok": True, "result": {"message_id": "m1"}}

        def _fake_post(url, data=None, files=None, timeout=None):
            captured["url"] = url
            captured["data"] = data
            captured["files"] = files
            return _FakeResp()

        with patch(
            "app.services.zalo_service._bot_token", return_value="123:abc"
        ), patch("app.services.zalo_service.requests.post", side_effect=_fake_post):
            result = zalo_service.send_photo(
                chat_id=999,
                photo_bytes=b"\x89PNG\x00fake",
                caption="Revenue",
                filename="rev.png",
            )

        assert result == {"ok": True, "result": {"message_id": "m1"}}
        assert captured["url"].endswith("/bot123:abc/sendPhoto")
        assert captured["data"]["chat_id"] == "999"
        assert captured["data"]["caption"] == "Revenue"
        # files dict should hold the photo as a 3-tuple (filename, bytes, content-type)
        photo_filename, photo_bytes, photo_ctype = captured["files"]["photo"]
        assert photo_filename == "rev.png"
        assert photo_bytes == b"\x89PNG\x00fake"
        assert photo_ctype == "image/png"

    def test_send_photo_truncates_long_caption(self):
        from app.services import zalo_service

        captured = {}

        class _FakeResp:
            content = b'{"ok": true}'

            def json(self):
                return {"ok": True}

        def _fake_post(url, data=None, files=None, timeout=None):
            captured["data"] = data
            return _FakeResp()

        long_caption = "x" * 2000
        with patch(
            "app.services.zalo_service._bot_token", return_value="123:abc"
        ), patch("app.services.zalo_service.requests.post", side_effect=_fake_post):
            zalo_service.send_photo(chat_id=1, photo_bytes=b"png", caption=long_caption)

        assert len(captured["data"]["caption"]) == 1024

    def test_send_photo_swallows_request_errors(self):
        from app.services import zalo_service

        with patch(
            "app.services.zalo_service._bot_token", return_value="123:abc"
        ), patch(
            "app.services.zalo_service.requests.post", side_effect=RuntimeError("boom")
        ):
            result = zalo_service.send_photo(chat_id=1, photo_bytes=b"png")
        assert result is None


class TestChartRenderingBranches:
    """Verify the chart-rendering branch is gated on ENABLE_CHART_RENDERING and
    a populated dashboard_json. We don't need to spin up Morpheus — we exercise
    the gate logic via render_dashboard_previews directly."""

    def test_renderer_returns_empty_for_dashboard_with_no_charts(self):
        from app.services.chart_renderer import render_dashboard_previews

        out = render_dashboard_previews({"charts": []}, max_charts=4)
        assert out == []

    def test_renderer_skips_unsupported_chart_types(self):
        from app.services.chart_renderer import render_dashboard_previews

        out = render_dashboard_previews(
            {"charts": [{"chart_type": "fancy_3d_holograph", "title": "x"}]},
            max_charts=4,
        )
        assert out == []

    def test_chart_rendering_disabled_by_default(self):
        from app.services.chart_renderer import is_chart_rendering_enabled

        # Whatever the env says, the function should return a bool — and when
        # explicitly disabled it must be False.
        with patch.dict(os.environ, {"ENABLE_CHART_RENDERING": "false"}):
            assert is_chart_rendering_enabled() is False
        with patch.dict(os.environ, {"ENABLE_CHART_RENDERING": "true"}):
            assert is_chart_rendering_enabled() is True


class TestZaloCollectFlow:
    """Webhook dispatch for the Zalo 2-step collect flow (file → prompt)."""

    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def _req(self, message, event_name=None):
        from unittest.mock import AsyncMock

        body = {"message": message}
        if event_name:
            body["event_name"] = event_name
        req = MagicMock()
        req.json = AsyncMock(return_value=body)
        req.headers = {}
        return req

    def _msg(self, text="", file_id=None):
        m = {
            "message_id": "m",
            "chat": {"id": "100", "chat_type": "PRIVATE"},
            "from": {"id": "42", "display_name": "Alice"},
        }
        if text:
            m["text"] = text
        if file_id:
            m["file_id"] = file_id
        return m

    def _dispatch(self, req, active_collect=False):
        from fastapi import BackgroundTasks
        from app.api.route_modules import chat_platform

        bg = MagicMock(spec=BackgroundTasks)
        with patch.object(
            chat_platform, "_verify_zalo_webhook", return_value=True
        ), patch.object(
            chat_platform, "has_pending_clarification", return_value=False
        ), patch.object(
            chat_platform, "has_pending_collect", return_value=active_collect
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value={
                "platform_workspace_id": "zalo:100",
                "user_id": "u1",
                "project_id": "p1",
            },
        ):
            self._run(chat_platform.zalo_webhook(req, bg))
        return bg

    def test_image_first_enters_collect(self):
        bg = self._dispatch(self._req(self._msg(file_id="F1")))
        bg.add_task.assert_called_once()
        assert bg.add_task.call_args.args[0].__name__ == "handle_zalo_collect_step"
        assert bg.add_task.call_args.kwargs["start"] is True

    def test_keyword_enters_collect(self):
        bg = self._dispatch(self._req(self._msg(text="phân tích")))
        assert bg.add_task.call_args.args[0].__name__ == "handle_zalo_collect_step"
        assert bg.add_task.call_args.kwargs["start"] is True

    def test_active_collect_routes_to_step(self):
        bg = self._dispatch(
            self._req(self._msg(text="doanh thu?")), active_collect=True
        )
        assert bg.add_task.call_args.args[0].__name__ == "handle_zalo_collect_step"
        assert bg.add_task.call_args.kwargs["start"] is False

    def test_plain_text_query_bypasses_collect(self):
        bg = self._dispatch(self._req(self._msg(text="doanh thu hôm nay bao nhiêu?")))
        assert bg.add_task.call_args.args[0].__name__ == "handle_zalo_query"

    def test_image_with_caption_bypasses_collect(self):
        bg = self._dispatch(
            self._req(self._msg(text="phân tích ảnh này", file_id="F3"))
        )
        assert bg.add_task.call_args.args[0].__name__ == "handle_zalo_query"

    def test_unsupported_document_routes_to_upload(self):
        from app.api.route_modules import chat_platform

        req = self._req(self._msg(), event_name="message.unsupported.received")
        from fastapi import BackgroundTasks

        bg = MagicMock(spec=BackgroundTasks)
        with patch.object(
            chat_platform, "_verify_zalo_webhook", return_value=True
        ), patch(
            "app.api.route_modules.chat_platform.chat_platform_repo.get_workspace",
            return_value={
                "platform_workspace_id": "zalo:100",
                "user_id": "u1",
                "project_id": "p1",
            },
        ):
            self._run(chat_platform.zalo_webhook(req, bg))
        assert bg.add_task.call_args.args[0].__name__ == "_handle_zalo_unsupported_file"
