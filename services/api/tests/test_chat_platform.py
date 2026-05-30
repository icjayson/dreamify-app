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
        from app.services.chat_platform_service import _make_user_node

        node = _make_user_node("show me revenue trends")
        assert node["role"] == "user"
        assert node["status"] == "completed"
        assert node["contents"][0]["type"] == "text"
        assert node["contents"][0]["data"]["text"] == "show me revenue trends"
        assert node["node_id"].startswith("node_")


# ── Route handlers — called directly (no TestClient needed) ───────────────────
# FastAPI Depends() defaults are skipped when calling async handlers directly;
# pass the resolved dependency values as keyword arguments.


class TestChatPlatformRoutes:
    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)

    def _mock_request(self, body_json: dict) -> MagicMock:
        from unittest.mock import AsyncMock

        req = MagicMock()
        req.body = AsyncMock(return_value=json.dumps(body_json).encode())
        return req

    def test_slack_url_verification(self):
        from app.api.route_modules.chat_platform import slack_events

        challenge = "3eZbrw1aBm2rZgRNFdxV2595E9CY3QKc4ZhdAgX"
        payload = {"type": "url_verification", "challenge": challenge}
        result = self._run(slack_events(self._mock_request(payload), MagicMock()))
        assert result["challenge"] == challenge

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

    def test_returns_qr_url_and_stores_pending(self):
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
        # qr_url is a relative path so the frontend hits it through the same origin
        assert result.qr_url == f"/api/v1/chat/zalo/qr/{result.code}"
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
