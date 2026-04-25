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
from datetime import datetime
from typing import Any, Dict
from unittest.mock import MagicMock, patch

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
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table") as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(workspace)
            from utils.dynamodb.repos import chat_platform_repo
            result = chat_platform_repo.get_workspace("slack:T123")
        assert result["user_id"] == "user_abc"
        assert result["project_id"] == "proj_xyz"

    def test_get_workspace_not_found(self):
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table") as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(None)
            from utils.dynamodb.repos import chat_platform_repo
            result = chat_platform_repo.get_workspace("slack:UNKNOWN")
        assert result is None

    def test_save_workspace(self):
        mock_table = self._make_table_mock()
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table):
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
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table") as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(session)
            from utils.dynamodb.repos import chat_platform_repo
            result = chat_platform_repo.get_session("slack:T123", "C001#1700000000.000001")
        assert result["conversation_id"] == "conv-uuid"

    def test_get_session_not_found(self):
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table") as mock_get_table:
            mock_get_table.return_value = self._make_table_mock(None)
            from utils.dynamodb.repos import chat_platform_repo
            result = chat_platform_repo.get_session("slack:T123", "C999#ts")
        assert result is None

    def test_create_session(self):
        mock_table = self._make_table_mock()
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table):
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
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table):
            from utils.dynamodb.repos import chat_platform_repo
            chat_platform_repo.update_session_conversation("slack:T123", "C001#ts", "conv-new")
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
        blocks = build_response_blocks("Signups dropped 23%.", "https://app.dreamify.dev/projects/p?dashboard=d", 5)
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
        blocks = build_response_blocks("Narrative.", "https://example.com", 5, metrics=metrics)
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
        conversation = self._make_conversation([
            {
                "role": "user",
                "status": "completed",
                "contents": [{"type": "text", "data": {"text": "Why did signups drop?"}}],
            },
            {
                "role": "assistant",
                "status": "completed",
                "contents": [{"type": "text", "data": {"text": "Signups dropped 23%."}}],
            },
        ])
        assert _extract_narrative(conversation) == "Signups dropped 23%."

    def test_extract_narrative_skips_incomplete(self):
        from app.services.chat_platform_service import _extract_narrative
        conversation = self._make_conversation([
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
        ])
        assert _extract_narrative(conversation) == "Done."

    def test_extract_narrative_none_when_no_assistant(self):
        from app.services.chat_platform_service import _extract_narrative
        conversation = self._make_conversation([
            {
                "role": "user",
                "status": "completed",
                "contents": [{"type": "text", "data": {"text": "Hello"}}],
            },
        ])
        assert _extract_narrative(conversation) is None

    def test_build_dashboard_url_with_dashboard(self):
        from app.services.chat_platform_service import _build_dashboard_url
        conversation = {
            "dashboards": [{"dashboard_id": "dash-1"}]
        }
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
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace", return_value=None):
            result = self._run(slack_events(self._mock_request(payload), MagicMock()))
        assert result["ok"] is True

    def test_get_workspace_not_found(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import get_workspace
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace", return_value=None):
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
            "created_at": datetime.now().isoformat(),
            "bot_token_encrypted": "enc",
            "user_id": "user-1",
        }
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace", return_value=workspace):
            result = self._run(get_workspace("slack:T123"))
        assert result.platform == "slack"
        assert result.workspace_name == "Acme"
        assert not hasattr(result, "bot_token_encrypted")


# ── State token helpers ───────────────────────────────────────────────────────

class TestStateToken:
    def test_round_trip(self):
        from app.api.route_modules.chat_platform import _create_state_token, _verify_state_token
        token = _create_state_token("user_abc")
        assert _verify_state_token(token) == "user_abc"

    def test_tampered_token_raises(self):
        import base64
        from app.api.route_modules.chat_platform import _create_state_token, _verify_state_token
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
        sig = hmac.new(config.app.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
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
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table):
            from utils.dynamodb.repos import chat_platform_repo
            result = chat_platform_repo.get_workspace_by_user("user-1", "slack")
        assert result["platform_workspace_id"] == "slack:T123"

    def test_returns_none_when_no_match(self):
        mock_table = MagicMock()
        mock_table.scan.return_value = {"Items": []}
        with patch("utils.dynamodb.repos.chat_platform_repo.get_table", return_value=mock_table):
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
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user", return_value=None):
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
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace_by_user", return_value=workspace):
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
            "created_at": datetime.now().isoformat(),
        }

    def test_owner_can_disconnect(self):
        from app.api.route_modules.chat_platform import disconnect_workspace
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace", return_value=self._workspace("user-1")), \
             patch("app.api.route_modules.chat_platform.chat_platform_repo.delete_workspace") as mock_delete:
            result = self._run(disconnect_workspace("slack:T123", user_id="user-1"))
        assert result["ok"] is True
        mock_delete.assert_called_once_with("slack:T123")

    def test_other_user_gets_403(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import disconnect_workspace
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace", return_value=self._workspace("user-owner")):
            with pytest.raises(HTTPException) as exc:
                self._run(disconnect_workspace("slack:T123", user_id="user-other"))
        assert exc.value.status_code == 403

    def test_nonexistent_workspace_gets_404(self):
        from fastapi import HTTPException
        from app.api.route_modules.chat_platform import disconnect_workspace
        with patch("app.api.route_modules.chat_platform.chat_platform_repo.get_workspace", return_value=None):
            with pytest.raises(HTTPException) as exc:
                self._run(disconnect_workspace("slack:GONE", user_id="user-1"))
        assert exc.value.status_code == 404
