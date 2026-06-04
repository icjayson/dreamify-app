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


def test_background_merges_chart_edit_and_posts_explainer_metadata():
    import json
    import server

    existing_dashboard = {
        "dashboard": {"title": "Sales Dashboard", "description": "Revenue overview"},
        "charts": [
            {
                "id": "chart_1",
                "chart_type": "bar",
                "title": "Revenue Trend",
                "datasets": [
                    {
                        "label": "Revenue",
                        "data": [{"label": "W1", "value": 90}],
                    }
                ],
            }
        ],
        "metrics": [],
        "tables": [],
    }
    modified_chart = {
        "id": "chart_1",
        "chart_type": "line",
        "title": "Revenue Trend",
        "datasets": [
            {
                "label": "Revenue",
                "data": [{"label": "W1", "value": 120}],
            }
        ],
    }
    change_summary = {
        "human_summary": "Changed Revenue Trend from bar to line.",
        "chart_type_from": "bar",
        "chart_type_to": "line",
    }
    data_provenance = {
        "python_code": ["print(df['revenue'].sum())"],
        "computed_values": {"W1": 120},
    }

    _persisted, statuses, uploaded = _run_background(
        server,
        _conversation(
            "Make it a line",
            [
                {
                    "type": "chart_mention",
                    "data": {
                        "chart_id": "chart_1",
                        "component_id": "component_1",
                        "title": "Revenue Trend",
                        "chart_type": "bar",
                    },
                }
            ],
        ),
        {
            "type": "chart_modification",
            "data": {
                "dashboard": {"title": "Chart Modification"},
                "charts": [modified_chart],
            },
            "chart_modification_context": {
                "chart_id": "chart_1",
                "change_summary": change_summary,
                "data_provenance": data_provenance,
            },
        },
        dashboards={"dash_1": existing_dashboard},
    )

    saved_dashboard = json.loads(uploaded[0]["data"].decode("utf-8"))
    assert saved_dashboard["charts"][0]["chart_type"] == "line"
    assert saved_dashboard["charts"][0]["datasets"][0]["data"][0]["value"] == 120
    assert statuses[-1]["status"] == "completed"
    assert statuses[-1]["metadata"]["response_type"] == "dashboard_config"
    assert statuses[-1]["metadata"]["change_summary"] == change_summary
    assert statuses[-1]["metadata"]["data_provenance"] == data_provenance


def _chart(chart_id, value):
    return {
        "id": chart_id,
        "chart_type": "bar",
        "title": chart_id,
        "datasets": [{"label": "Revenue", "data": [{"label": "W1", "value": value}]}],
    }


def _empty_chart(chart_id):
    return {
        "id": chart_id,
        "chart_type": "area",
        "title": chart_id,
        "datasets": [
            {"label": "Daily", "data": []},
            {"label": "Weekly", "data": []},
            {"label": "Monthly", "data": []},
        ],
    }


def _edit_chart_mention(chart_id, dashboard_id=None, chart_type="bar"):
    data = {
        "chart_id": chart_id,
        "component_id": chart_id,
        "title": chart_id,
        "chart_type": chart_type,
    }
    if dashboard_id is not None:
        data["dashboard_id"] = dashboard_id
    return {"type": "chart_mention", "data": data}


def _conversation_with_dashboards(prompt, mention, dashboard_ids):
    """Conversation seeded with existing dashboard references (in-place test)."""
    conversation = _conversation(prompt, [mention])
    conversation["dashboards"] = [
        {
            "dashboard_id": dash_id,
            "s3_uri": f"s3://bucket/{dash_id}.json",
            "created_at": "2026-05-30T00:00:00",
            "title": dash_id,
        }
        for dash_id in dashboard_ids
    ]
    return conversation


def test_background_chart_edit_targets_dashboard_by_id_not_last_cached():
    import json
    import server

    dash_a = {
        "dashboard": {"title": "A"},
        "charts": [_chart("chart_a", 10)],
        "metrics": [],
        "tables": [],
    }
    dash_b = {
        "dashboard": {"title": "B"},
        "charts": [_chart("chart_b", 20)],
        "metrics": [],
        "tables": [],
    }

    _persisted, _statuses, uploaded = _run_background(
        server,
        _conversation_with_dashboards(
            "Make it a line",
            _edit_chart_mention("chart_a", dashboard_id="dash_a"),
            ["dash_a", "dash_b"],
        ),
        {
            "type": "chart_modification",
            "data": {
                "dashboard": {"title": "Chart Modification"},
                "charts": [_chart("chart_a", 999)],
            },
            "chart_modification_context": {
                "chart_id": "chart_a",
                "dashboard_id": "dash_a",
            },
        },
        # Note: dash_b is the LAST cached entry; legacy behavior would pick it.
        dashboards={"dash_b": dash_b, "dash_a": dash_a},
    )

    saved = json.loads(uploaded[0]["data"].decode("utf-8"))
    # The merge must target dash_a (the chart's dashboard), not the last cached.
    assert saved["dashboard"]["title"] == "A"
    assert saved["charts"][0]["id"] == "chart_a"
    assert saved["charts"][0]["datasets"][0]["data"][0]["value"] == 999


def test_background_empty_chart_edit_keeps_original_and_posts_edit_note():
    import json
    import server

    existing = {
        "dashboard": {"title": "A"},
        "charts": [_chart("chart_a", 10)],
        "metrics": [],
        "tables": [],
    }

    persisted, statuses, uploaded = _run_background(
        server,
        _conversation_with_dashboards(
            "Make daily, weekly, and monthly area variants",
            _edit_chart_mention("chart_a", dashboard_id="dash_a"),
            ["dash_a"],
        ),
        {
            "type": "chart_modification",
            "data": {
                "dashboard": {"title": "Chart Modification"},
                "charts": [_empty_chart("chart_a")],
            },
            "chart_modification_context": {
                "chart_id": "chart_a",
                "dashboard_id": "dash_a",
            },
        },
        dashboards={"dash_a": existing},
    )

    saved = json.loads(uploaded[0]["data"].decode("utf-8"))
    assert saved["dashboard"]["title"] == "A"
    assert saved["charts"][0]["id"] == "chart_a"
    assert saved["charts"][0]["chart_type"] == "bar"
    assert saved["charts"][0]["datasets"][0]["data"][0]["value"] == 10

    conversation = persisted[-1]
    assert len(conversation["dashboards"]) == 1
    assert conversation["dashboards"][0]["dashboard_id"] == "dash_a"
    assert statuses[-1]["metadata"]["dashboard_id"] == "dash_a"
    assert "kept the original chart unchanged" in statuses[-1]["metadata"]["edit_note"]


def test_background_table_edit_replaces_table_by_id_in_target_dashboard():
    import json
    import server

    existing = {
        "dashboard": {"title": "Dash"},
        "charts": [],
        "metrics": [],
        "tables": [
            {
                "id": "table_1",
                "title": "Top 5",
                "columns": [{"id": "c1", "label": "Name", "type": "text"}],
                "data": [{"c1": "A"}],
            }
        ],
    }
    modified_table = {
        "id": "table_1",
        "title": "Top 10",
        "columns": [{"id": "c1", "label": "Name", "type": "text"}],
        "data": [{"c1": "A"}, {"c1": "B"}],
    }

    _persisted, _statuses, uploaded = _run_background(
        server,
        _conversation_with_dashboards(
            "Make it bigger",
            _edit_chart_mention("table_1", dashboard_id="dash_1", chart_type="table"),
            ["dash_1"],
        ),
        {
            "type": "chart_modification",
            "data": {
                "dashboard": {"title": "Table Modification"},
                "charts": [],
                "tables": [modified_table],
            },
            "chart_modification_context": {
                "chart_id": "table_1",
                "dashboard_id": "dash_1",
                "chart_type": "table",
            },
        },
        dashboards={"dash_1": existing},
    )

    saved = json.loads(uploaded[0]["data"].decode("utf-8"))
    assert len(saved["tables"]) == 1  # replaced, not appended
    assert saved["tables"][0]["id"] == "table_1"
    assert saved["tables"][0]["title"] == "Top 10"
    assert len(saved["tables"][0]["data"]) == 2


def test_background_chart_edit_persists_in_place_reusing_dashboard_id():
    import server

    existing = {
        "dashboard": {"title": "Dash"},
        "charts": [_chart("chart_a", 10)],
        "metrics": [],
        "tables": [],
    }

    persisted, statuses, _uploaded = _run_background(
        server,
        _conversation_with_dashboards(
            "Make it a line",
            _edit_chart_mention("chart_a", dashboard_id="dash_a"),
            ["dash_a"],
        ),
        {
            "type": "chart_modification",
            "data": {
                "dashboard": {"title": "Chart Modification"},
                "charts": [_chart("chart_a", 999)],
            },
            "chart_modification_context": {
                "chart_id": "chart_a",
                "dashboard_id": "dash_a",
            },
        },
        dashboards={"dash_a": existing},
    )

    conversation = persisted[-1]
    # No new dashboard minted: still a single entry, same id.
    assert len(conversation["dashboards"]) == 1
    assert conversation["dashboards"][0]["dashboard_id"] == "dash_a"
    # Completion status reports the same (reused) dashboard_id.
    assert statuses[-1]["metadata"]["dashboard_id"] == "dash_a"


def _downloadable_project_asset(asset_id, filename="data.csv"):
    return {
        "asset_id": asset_id,
        "s3_bucket": "bucket",
        "s3_key": f"in/{filename}",
        "extension": "csv",
        "filename": filename,
    }


def test_background_single_source_edit_auto_selects_without_clarification():
    import server

    conversation = _conversation(
        "make it a top 10 table",
        [_edit_chart_mention("table_1", dashboard_id="dash_1", chart_type="table")],
    )

    with patch.object(server, "download_bytes", return_value=b"day,sessions\n"):
        persisted, statuses, _uploaded = _run_background(
            server,
            conversation,
            {"type": "message", "content": "done"},
            project_assets=[_downloadable_project_asset("asset_a")],
        )

    # The single source was auto-resolved: the workflow ran with the file and the
    # edit's chart_mention, and NO clarification was posted.
    assert _FakeWorkflow.calls, "workflow should have executed"
    assert _FakeWorkflow.calls[0]["file_paths"], "the auto-resolved source downloaded"
    assert _FakeWorkflow.calls[0]["chart_mentions"][0]["chart_id"] == "table_1"
    reason_codes = [s["metadata"].get("reason_code") for s in statuses]
    assert "missing_data_context" not in reason_codes
    assert "multiple_matching_assets" not in reason_codes
    # The latest user node carries the synthesized explicit selection.
    user_node = next(
        node for node in reversed(persisted[-1]["nodes"]) if node["role"] == "user"
    )
    assert user_node["metadata"]["asset_selection"] == "explicit"
    assert user_node["metadata"]["selected_asset_ids"] == ["asset_a"]


def test_background_multi_source_edit_clarifies_carrying_edit_target():
    import server

    conversation = _conversation(
        "make it a top 10 table",
        [_edit_chart_mention("table_1", dashboard_id="dash_1", chart_type="table")],
    )

    persisted, statuses, _uploaded = _run_background(
        server,
        conversation,
        {"type": "message", "content": "should not run"},
        project_assets=[
            _downloadable_project_asset("asset_a", "sales.csv"),
            _downloadable_project_asset("asset_b", "ads.csv"),
        ],
    )

    # Two distinct sources → ask the user, do NOT run the workflow.
    assert not _FakeWorkflow.calls, "ambiguous source must not run the workflow"
    final_status = statuses[-1]
    assert final_status["status"] == "awaiting_user_input"
    assert final_status["metadata"]["response_type"] == "clarification_request"

    assistant_node = persisted[-1]["nodes"][-1]
    clarification = next(
        content["data"]
        for content in assistant_node["contents"]
        if content["type"] == "clarification_request"
    )
    # Every data-bearing option carries the edit target so the answer reroutes
    # straight into chart-modification mode against the right dashboard.
    data_options = [
        option
        for option in clarification["options"]
        if option["metadata"].get("asset_selection") != "none"
    ]
    assert data_options, "expected at least one data source option"
    for option in data_options:
        assert option["metadata"]["target_chart_id"] == "table_1"
        assert option["metadata"]["target_dashboard_id"] == "dash_1"
        assert option["metadata"]["is_chart_modification"] is True
