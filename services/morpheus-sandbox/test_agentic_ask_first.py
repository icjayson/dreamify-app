from morpheus.workflows.analyze_csv.ask_first import (
    MAX_BATCHED_CLARIFICATIONS,
    build_analysis_context_clarification,
    build_workflow_clarification,
    build_workflow_clarifications,
    choose_data_context_reason_code,
    is_data_context_needed,
    latest_data_selection,
    latest_effective_user_prompt,
)
from morpheus.workflows.analyze_csv.edges import decide_next_node
from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    UserState,
    WorkingMemory,
    WorkflowHistory,
)


def test_effective_prompt_preserves_original_request_after_clarification():
    conversation = {
        "nodes": [
            {
                "role": "user",
                "contents": [
                    {"type": "text", "data": {"text": "Show weekly revenue trend"}}
                ],
            },
            {
                "role": "assistant",
                "contents": [
                    {
                        "type": "clarification_request",
                        "data": {
                            "clarification_id": "clarify_1",
                            "reason_code": "time_or_metric_definition",
                            "question": "Which date column?",
                            "options": [],
                        },
                    }
                ],
            },
            {
                "role": "user",
                "contents": [
                    {"type": "text", "data": {"text": "Use created_at"}},
                    {
                        "type": "clarification_response",
                        "data": {
                            "clarification_id": "clarify_1",
                            "selected_option_label": "Use created_at",
                            "metadata": {
                                "date_column": "created_at",
                                "time_grain": "weekly",
                            },
                        },
                    },
                ],
            },
        ]
    }

    prompt = latest_effective_user_prompt(conversation)

    assert "Show weekly revenue trend" in prompt
    assert "Use created_at" in prompt
    assert "date_column" in prompt


def test_output_mode_clarification_for_short_ambiguous_analysis_prompt():
    clarification = build_workflow_clarification(
        conversation={"nodes": []},
        user_prompt="analyze performance",
        user_assets=[{"asset_id": "asset_1", "filename": "sales.csv"}],
        dashboards={},
        file_paths=["/tmp/sales.csv"],
        assets_dict={"sales.csv": "/tmp/sales.csv"},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification["reason_code"] == "output_mode"
    assert {
        option["metadata"]["route_mode"] for option in clarification["options"]
    } == {
        "dashboard",
        "qa_visual",
        "qa",
    }


def test_analyze_performance_is_data_like_and_can_ask_for_context_without_assets():
    clarification = build_analysis_context_clarification("analyze performance")

    assert is_data_context_needed("analyze performance")
    assert clarification["reason_code"] == "analysis_context"
    assert clarification["options"][0]["metadata"]["next_action"] == "provide_data"


def test_data_source_answer_can_be_followed_by_output_mode_ask():
    conversation = {
        "nodes": [
            {
                "role": "user",
                "contents": [{"type": "text", "data": {"text": "Analyze performance"}}],
            },
            {
                "role": "assistant",
                "contents": [
                    {
                        "type": "clarification_request",
                        "data": {
                            "clarification_id": "clarify_data",
                            "reason_code": "missing_data_context",
                            "options": [],
                        },
                    }
                ],
            },
            {
                "role": "user",
                "contents": [
                    {
                        "type": "clarification_response",
                        "data": {
                            "clarification_id": "clarify_data",
                            "selected_option_label": "Sales data",
                            "metadata": {
                                "asset_selection": "explicit",
                                "asset_ids": ["asset_1"],
                            },
                        },
                    }
                ],
            },
        ]
    }

    clarification = build_workflow_clarification(
        conversation=conversation,
        user_prompt="Analyze performance",
        user_assets=[{"asset_id": "asset_1", "filename": "sales.csv"}],
        dashboards={},
        file_paths=["/tmp/sales.csv"],
        assets_dict={"sales.csv": "/tmp/sales.csv"},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification["reason_code"] == "output_mode"


def test_latest_data_selection_reads_explicit_metadata_without_asset_contents():
    selection = latest_data_selection(
        {
            "nodes": [
                {
                    "role": "user",
                    "metadata": {
                        "asset_selection": "explicit",
                        "selected_asset_ids": ["asset_1", "asset_2"],
                    },
                    "contents": [
                        {
                            "type": "text",
                            "data": {
                                "text": "Visualize key trends over time in an interactive dashboard."
                            },
                        }
                    ],
                }
            ]
        }
    )

    assert selection == {
        "asset_selection": "explicit",
        "selected_asset_ids": ["asset_1", "asset_2"],
    }


def test_chart_target_clarification_when_edit_request_has_multiple_charts():
    clarification = build_workflow_clarification(
        conversation={"nodes": []},
        user_prompt="fix this chart so the values are correct",
        user_assets=[{"asset_id": "asset_1"}],
        dashboards={
            "dash_1": {
                "charts": [
                    {"id": "chart_1", "title": "Revenue", "chart_type": "line"},
                    {"id": "chart_2", "title": "Orders", "chart_type": "bar"},
                ]
            }
        },
        file_paths=["/tmp/sales.csv"],
        assets_dict={"sales.csv": "/tmp/sales.csv"},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification["reason_code"] == "chart_target"
    assert clarification["options"][0]["metadata"]["target_chart_id"] == "chart_1"


def test_join_strategy_clarification_for_multiple_files_without_join_instruction():
    clarification = build_workflow_clarification(
        conversation={"nodes": []},
        user_prompt="build a dashboard",
        user_assets=[{"asset_id": "asset_1"}, {"asset_id": "asset_2"}],
        dashboards={},
        file_paths=["/tmp/a.csv", "/tmp/b.csv"],
        assets_dict={"a.csv": "/tmp/a.csv", "b.csv": "/tmp/b.csv"},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification["reason_code"] == "join_strategy"
    assert clarification["options"][0]["metadata"]["join_strategy"] == "auto"


def test_duplicate_rementioned_asset_does_not_trigger_join_strategy():
    clarification = build_workflow_clarification(
        conversation={"nodes": []},
        user_prompt="làm chart show trend đi",
        user_assets=[
            {"asset_id": "asset_1", "filename": "source.csv"},
            {"asset_id": "asset_1", "filename": "source.csv"},
        ],
        dashboards={},
        file_paths=["/tmp/source.csv", "/tmp/source.csv"],
        assets_dict={"source.csv": "/tmp/source.csv"},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification is None or clarification["reason_code"] != "join_strategy"


def test_duplicate_file_path_without_asset_identity_does_not_trigger_join_strategy():
    clarification = build_workflow_clarification(
        conversation={"nodes": []},
        user_prompt="build a dashboard",
        user_assets=[],
        dashboards={},
        file_paths=["/tmp/source.csv", "/tmp/source.csv"],
        assets_dict={},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification is None


def test_multiple_matching_assets_reason_when_sources_tie():
    reason_code = choose_data_context_reason_code(
        "compare traffic and visitors",
        [
            {"asset_id": "ga4_1", "filename": "ga4_traffic.csv", "row_count": 10},
            {
                "asset_id": "ga4_2",
                "filename": "analytics_visitors.csv",
                "row_count": 10,
            },
        ],
    )

    assert reason_code == "multiple_matching_assets"


def test_dashboard_update_scope_clarification_for_existing_dashboard_edit():
    clarification = build_workflow_clarification(
        conversation={"nodes": []},
        user_prompt="update the dashboard with latest numbers",
        user_assets=[{"asset_id": "asset_1"}],
        dashboards={"dash_1": {"charts": [{"id": "chart_1", "title": "Revenue"}]}},
        file_paths=["/tmp/sales.csv"],
        assets_dict={"sales.csv": "/tmp/sales.csv"},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification["reason_code"] == "dashboard_update_scope"
    assert clarification["options"][0]["metadata"]["update_scope"] == "current"


def test_time_definition_clarification_for_multiple_date_columns(tmp_path):
    data = tmp_path / "events.csv"
    data.write_text("created_at,updated_at,revenue\n2026-01-01,2026-01-02,10\n")

    clarification = build_workflow_clarification(
        conversation={"nodes": []},
        user_prompt="show revenue trend",
        user_assets=[{"asset_id": "asset_1"}],
        dashboards={},
        file_paths=[str(data)],
        assets_dict={"events.csv": str(data)},
        data_profile=None,
        chart_mentions=[],
    )

    assert clarification["reason_code"] == "time_or_metric_definition"
    assert {
        option["metadata"].get("date_column") for option in clarification["options"]
    } >= {
        "created_at",
        "updated_at",
    }


def _two_dated_files(tmp_path):
    a = tmp_path / "events_a.csv"
    a.write_text("created_at,updated_at,revenue\n2026-01-01,2026-01-02,10\n")
    b = tmp_path / "events_b.csv"
    b.write_text("created_at,updated_at,signups\n2026-01-01,2026-01-02,3\n")
    return a, b


def test_batches_join_time_and_output_for_multi_file_trend_prompt(tmp_path):
    a, b = _two_dated_files(tmp_path)

    clarifications = build_workflow_clarifications(
        conversation={"nodes": []},
        user_prompt="show daily revenue trend",
        user_assets=[{"asset_id": "asset_a"}, {"asset_id": "asset_b"}],
        dashboards={},
        file_paths=[str(a), str(b)],
        assets_dict={"events_a.csv": str(a), "events_b.csv": str(b)},
        data_profile=None,
        chart_mentions=[],
    )

    reason_codes = [c["reason_code"] for c in clarifications]
    assert len(clarifications) >= 2
    assert "join_strategy" in reason_codes
    assert "time_or_metric_definition" in reason_codes


def test_batch_orders_cluster_and_respects_cap(tmp_path):
    a, b = _two_dated_files(tmp_path)

    clarifications = build_workflow_clarifications(
        conversation={"nodes": []},
        user_prompt="show daily revenue trend",
        user_assets=[{"asset_id": "asset_a"}, {"asset_id": "asset_b"}],
        dashboards={},
        file_paths=[str(a), str(b)],
        assets_dict={"events_a.csv": str(a), "events_b.csv": str(b)},
        data_profile=None,
        chart_mentions=[],
    )

    reason_codes = [c["reason_code"] for c in clarifications]
    assert len(clarifications) <= MAX_BATCHED_CLARIFICATIONS
    assert reason_codes == [
        "join_strategy",
        "time_or_metric_definition",
        "output_mode",
    ]


def test_edit_flow_prompt_returns_single_clarification():
    clarifications = build_workflow_clarifications(
        conversation={"nodes": []},
        user_prompt="fix this chart so the values are correct",
        user_assets=[{"asset_id": "asset_1"}],
        dashboards={
            "dash_1": {
                "charts": [
                    {"id": "chart_1", "title": "Revenue", "chart_type": "line"},
                    {"id": "chart_2", "title": "Orders", "chart_type": "bar"},
                ]
            }
        },
        file_paths=["/tmp/sales.csv"],
        assets_dict={"sales.csv": "/tmp/sales.csv"},
        data_profile=None,
        chart_mentions=[],
    )

    assert len(clarifications) == 1
    assert clarifications[0]["reason_code"] == "chart_target"


def test_already_answered_reason_is_excluded_from_batch(tmp_path):
    a, b = _two_dated_files(tmp_path)
    conversation = {
        "nodes": [
            {
                "role": "assistant",
                "contents": [
                    {
                        "type": "clarification_request",
                        "data": {
                            "clarification_id": "clarify_join",
                            "reason_code": "join_strategy",
                            "options": [],
                        },
                    }
                ],
            },
            {
                "role": "user",
                "contents": [
                    {
                        "type": "clarification_response",
                        "data": {
                            "clarification_id": "clarify_join",
                            "selected_option_label": "Infer best join",
                        },
                    }
                ],
            },
        ]
    }

    clarifications = build_workflow_clarifications(
        conversation=conversation,
        user_prompt="show daily revenue trend",
        user_assets=[{"asset_id": "asset_a"}, {"asset_id": "asset_b"}],
        dashboards={},
        file_paths=[str(a), str(b)],
        assets_dict={"events_a.csv": str(a), "events_b.csv": str(b)},
        data_profile=None,
        chart_mentions=[],
    )

    reason_codes = [c["reason_code"] for c in clarifications]
    assert "join_strategy" not in reason_codes
    assert "time_or_metric_definition" in reason_codes


def test_singular_wrapper_returns_first_of_batch(tmp_path):
    a, b = _two_dated_files(tmp_path)
    kwargs = dict(
        conversation={"nodes": []},
        user_prompt="show daily revenue trend",
        user_assets=[{"asset_id": "asset_a"}, {"asset_id": "asset_b"}],
        dashboards={},
        file_paths=[str(a), str(b)],
        assets_dict={"events_a.csv": str(a), "events_b.csv": str(b)},
        data_profile=None,
        chart_mentions=[],
    )

    batch = build_workflow_clarifications(**kwargs)
    single = build_workflow_clarification(**kwargs)

    assert single is not None
    assert single["reason_code"] == batch[0]["reason_code"]


def test_ask_first_output_transitions_to_finish():
    state = AgentState(
        user_state=UserState(
            user_id="user_1",
            project_id="project_1",
            conversation_id="conversation_1",
            conversation_history=[],
            user_assets=[{"asset_id": "asset_1", "filename": "sales.csv"}],
            dashboards={},
        ),
        working_memory=WorkingMemory(),
        workflow_history=WorkflowHistory(),
        current_node="ASK_FIRST",
        input_prompt="analyze performance",
        file_paths=["/tmp/sales.csv"],
        assets_dict={"sales.csv": "/tmp/sales.csv"},
        conversation_id="conversation_1",
        project_id="project_1",
    )
    state.output = {
        "type": "clarification_request",
        "clarification": {
            "clarification_id": "clarify_1",
            "reason_code": "output_mode",
        },
    }

    assert decide_next_node(state) == "FINISH"
