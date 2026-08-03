import asyncio
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
import pytest


class TestWorkflowThinkingEventsRepo:
    def test_append_workflow_event_uses_append_only_event_node(self):
        mock_table = MagicMock()
        with patch(
            "utils.dynamodb.repos.workflow_nodes.get_table",
            return_value=mock_table,
        ):
            from utils.dynamodb.repos import workflow_nodes

            item = workflow_nodes.append_workflow_event(
                conversation_id="conv_1",
                run_id="run_1",
                sequence=7,
                event={
                    "phase": "tool",
                    "status": "completed",
                    "title": "Tool result received",
                    "metadata": {"tool": "python_repl"},
                },
            )

        assert item["conversation_id"] == "conv_1"
        assert item["node_id"] == "event#run_1#000007"
        assert item["status"] == "completed"
        assert item["metadata"]["run_id"] == "run_1"
        assert item["metadata"]["sequence"] == 7
        mock_table.put_item.assert_called_once_with(Item=item)

    def test_list_workflow_events_queries_event_partition_in_order(self):
        rows = [
            {
                "node_id": "event#run_2#000001",
                "metadata": {"started_at": "2026-01-01T00:00:02", "sequence": 1},
            },
            {
                "node_id": "event#run_1#000001",
                "metadata": {"started_at": "2026-01-01T00:00:01", "sequence": 1},
            },
        ]
        mock_table = MagicMock()
        mock_table.query.return_value = {"Items": rows}

        with patch(
            "utils.dynamodb.repos.workflow_nodes.get_table",
            return_value=mock_table,
        ):
            from utils.dynamodb.repos import workflow_nodes

            result = workflow_nodes.list_workflow_events("conv_1")

        assert [item["node_id"] for item in result] == [
            "event#run_1#000001",
            "event#run_2#000001",
        ]
        _, kwargs = mock_table.query.call_args
        assert kwargs["ScanIndexForward"] is True


class TestWorkflowThinkingEventsRoute:
    def test_conversation_events_preserve_workflow_status(self):
        from app.api.route_modules import conversation

        with patch.object(conversation.conversations_repo, "get_conversation") as get_conv, \
             patch.object(conversation.workflow_nodes_repo, "get_node") as get_node, \
             patch.object(conversation.workflow_nodes_repo, "list_workflow_events") as list_events:
            get_conv.return_value = {"conversation_id": "conv_1", "user_id": "user_1"}
            get_node.return_value = {
                "conversation_id": "conv_1",
                "node_id": "workflow",
                "status": "processing",
                "metadata": {"step": "run_workflow"},
                "updated_at": "2026-01-01T00:00:00",
            }
            list_events.return_value = [
                {
                    "conversation_id": "conv_1",
                    "node_id": "event#run_1#000001",
                    "status": "completed",
                    "metadata": {
                        "id": "run_1:1",
                        "run_id": "run_1",
                        "sequence": 1,
                        "phase": "context",
                        "status": "completed",
                        "title": "Reading project context",
                    },
                }
            ]

            response = asyncio.run(
                conversation.get_conversation_workflow_events(
                    conversation_id="conv_1",
                    project_id="project_1",
                    user_id="user_1",
                )
            )

        assert response.status.status == "processing"
        assert response.status.metadata["step"] == "run_workflow"
        assert [event.sequence for event in response.events] == [1]
        assert response.events[0].title == "Reading project context"

    def test_conversation_events_reject_other_user(self):
        from app.api.route_modules import conversation

        with patch.object(conversation.conversations_repo, "get_conversation") as get_conv:
            get_conv.return_value = {"conversation_id": "conv_1", "user_id": "other_user"}

            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(
                    conversation.get_conversation_workflow_events(
                        conversation_id="conv_1",
                        project_id="project_1",
                        user_id="user_1",
                    )
                )

        assert exc_info.value.status_code == 404
