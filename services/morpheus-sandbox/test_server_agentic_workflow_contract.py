from unittest.mock import MagicMock, patch


def _conversation(prompt="Hello", extra_contents=None):
    return {
        "user_id": "user_1",
        "project_id": "project_1",
        "conversation_id": "conversation_1",
        "nodes": [
            {
                "node_id": "user_1",
                "role": "user",
                "status": "completed",
                "created_at": "2026-05-30T00:00:00",
                "contents": [
                    {"type": "text", "data": {"text": prompt}},
                    *(extra_contents or []),
                ],
            }
        ],
        "dashboards": [],
    }


class _WorkflowOutput:
    def __init__(self, messages):
        self.messages = messages


class _FakeWorkflow:
    result = {}
    calls = []
    init_kwargs = []

    def __init__(self, **kwargs):
        self.__class__.init_kwargs.append(kwargs)

    def execute(self, **kwargs):
        self.__class__.calls.append(kwargs)
        return self.__class__.result


def _run_background(server, conversation, result, **kwargs):
    _FakeWorkflow.result = result
    _FakeWorkflow.calls = []
    _FakeWorkflow.init_kwargs = []
    persisted = []
    statuses = []
    uploaded = []

    def persist(primary_uri, backup_uri, payload):
        persisted.append(payload)

    def post_status(conversation_id, status, metadata=None):
        statuses.append(
            {
                "conversation_id": conversation_id,
                "status": status,
                "metadata": metadata or {},
            }
        )

    def upload(bucket, key, data, content_type="application/json"):
        uploaded.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )

    put_response = MagicMock()
    put_response.status_code = 200
    put_response.text = "ok"

    with patch.object(
        server, "_load_json_from_s3_uri", return_value=conversation
    ), patch.object(
        server, "_load_existing_dashboards", return_value=kwargs.get("dashboards", {})
    ), patch.object(
        server, "_persist_conversation", side_effect=persist
    ), patch.object(
        server, "_post_node_status_sync", side_effect=post_status
    ), patch.object(
        server, "_post_workflow_event_sync", return_value=None
    ), patch.object(
        server, "_upload_bytes_to_s3", side_effect=upload
    ), patch.object(
        server, "save_dashboard_metadata"
    ), patch.object(
        server.requests, "put", return_value=put_response
    ), patch.object(
        server, "StatefulAnalyzeCSVWorkflow", _FakeWorkflow
    ):
        server._process_conversation_background(
            conversation_id="conversation_1",
            conversation_uri="s3://bucket/conversation.json",
            conversation_backup_uri="s3://bucket/conversation.backup.json",
            project_id="project_1",
            user_id="user_1",
            theme_id=kwargs.get("theme_id"),
            analysis_focus_id=kwargs.get("analysis_focus_id"),
            template_id=kwargs.get("template_id"),
            project_assets=kwargs.get("project_assets"),
        )

    return persisted, statuses, uploaded


def test_background_persists_batched_clarification_request_from_workflow():
    import server

    clarifications = [
        {
            "clarification_id": "clarify_join",
            "reason_code": "join_strategy",
            "question": "How should I combine these files?",
            "options": [{"id": "auto_join", "label": "Infer best join"}],
        },
        {
            "clarification_id": "clarify_output",
            "reason_code": "output_mode",
            "question": "What should I produce?",
            "options": [{"id": "inline_visual", "label": "Inline visual answer"}],
        },
    ]

    persisted, statuses, _uploaded = _run_background(
        server,
        _conversation("Hello there"),
        {"type": "clarification_request", "clarifications": clarifications},
    )

    assert _FakeWorkflow.calls[0]["file_paths"] == []
    assistant_node = persisted[-1]["nodes"][-1]
    assert assistant_node["role"] == "assistant"
    assert assistant_node["status"] == "awaiting_user_input"
    assert [content["type"] for content in assistant_node["contents"]] == [
        "text",
        "clarification_request",
        "clarification_request",
        "thinking_trace",
    ]
    final_status = statuses[-1]
    assert final_status["status"] == "awaiting_user_input"
    assert final_status["metadata"]["response_type"] == "clarification_request"
    assert final_status["metadata"]["clarification_ids"] == [
        "clarify_join",
        "clarify_output",
    ]
    assert final_status["metadata"]["reason_codes"] == [
        "join_strategy",
        "output_mode",
    ]


def test_background_persists_text_qna_message_for_frontend_restore():
    import server

    persisted, statuses, _uploaded = _run_background(
        server,
        _conversation("Hello there"),
        {
            "type": "message",
            "content": "I can help with your analytics question.",
            "workflow_output": _WorkflowOutput(
                [
                    {
                        "type": "ai",
                        "content": "I can help with your analytics question.",
                        "timestamp": "2026-05-30T00:00:01",
                    }
                ]
            ),
        },
    )

    assistant_nodes = [
        node for node in persisted[-1]["nodes"] if node.get("role") == "assistant"
    ]
    assert assistant_nodes[-1]["contents"][0]["data"]["text"] == (
        "I can help with your analytics question."
    )
    assert statuses[-1]["status"] == "completed"
    assert statuses[-1]["metadata"]["response_type"] == "message"
    assert (
        statuses[-1]["metadata"]["content"]
        == "I can help with your analytics question."
    )


def test_background_persists_qna_visual_artifact_without_dashboard():
    import server

    chart_mention = {
        "type": "chart_mention",
        "data": {
            "component_id": "component_1",
            "chart_id": "chart_1",
            "title": "Revenue Trend",
            "chart_type": "line",
        },
    }
    artifact = {
        "id": "artifact_1",
        "kind": "chart",
        "title": "Weekly revenue",
        "chart_type": "line",
        "datasets": [{"label": "Revenue", "data": [{"label": "W1", "value": 100}]}],
    }

    persisted, statuses, _uploaded = _run_background(
        server,
        _conversation("Explain selected visual", [chart_mention]),
        {
            "type": "answer_with_visual",
            "content": "Revenue is accelerating week over week.",
            "artifacts": [artifact],
        },
    )

    assert _FakeWorkflow.calls[0]["chart_mentions"] == [chart_mention["data"]]
    assert persisted[-1]["dashboards"] == []
    assistant_node = persisted[-1]["nodes"][-1]
    assert assistant_node["contents"][0]["data"]["text"] == (
        "Revenue is accelerating week over week."
    )
    assert assistant_node["contents"][1] == {
        "type": "visual_artifacts",
        "data": {"artifacts": [artifact]},
    }
    assert statuses[-1]["status"] == "completed"
    assert statuses[-1]["metadata"]["response_type"] == "answer_with_visual"
    assert statuses[-1]["metadata"]["artifact_count"] == 1


def test_background_saves_dashboard_artifact_and_completion_status():
    import json
    import server

    dashboard_data = {
        "dashboard": {"title": "Sales Dashboard", "description": "Revenue overview"},
        "charts": [{"id": "chart_1", "styling": {}}],
        "metrics": [{"id": "metric_1", "styling": {}}],
        "tables": [],
    }

    persisted, statuses, uploaded = _run_background(
        server,
        _conversation("Hello there"),
        {"type": "dashboard_config", "data": dashboard_data},
        theme_id="cobalt",
        analysis_focus_id="finance_overview",
    )

    assert uploaded
    saved_dashboard = json.loads(uploaded[0]["data"].decode("utf-8"))
    assert saved_dashboard["theme_id"] == "cobalt"
    assert saved_dashboard["analysis_focus_id"] == "finance_overview"
    assert saved_dashboard["styling_recommendations"]["theme"] == "cobalt"
    assert saved_dashboard["charts"][0]["styling"]["theme"] == "cobalt"
    conversation = persisted[-1]
    assert len(conversation["dashboards"]) == 1
    dashboard_record = conversation["dashboards"][0]
    assert dashboard_record["dashboard_id"] == statuses[-1]["metadata"]["dashboard_id"]
    assert statuses[-1]["status"] == "completed"
    assert statuses[-1]["metadata"]["response_type"] == "dashboard_config"
