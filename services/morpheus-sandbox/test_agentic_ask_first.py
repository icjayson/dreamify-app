from morpheus.workflows.analyze_csv.ask_first import (
    build_analysis_context_clarification,
    build_workflow_clarification,
    choose_data_context_reason_code,
    is_data_context_needed,
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
