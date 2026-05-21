import sys
import types

google_genai_stub = types.ModuleType("langchain_google_genai")
google_genai_stub.ChatGoogleGenerativeAI = object
sys.modules.setdefault("langchain_google_genai", google_genai_stub)

from morpheus.workflows.analyze_csv import nodes
from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    UserState,
    WorkingMemory,
    WorkflowHistory,
)


def _state(**kwargs):
    return AgentState(
        user_state=UserState(
            user_id="user_1",
            project_id="project_1",
            conversation_id="conversation_1",
        ),
        working_memory=WorkingMemory(),
        workflow_history=WorkflowHistory(),
        input_prompt="Build a dashboard",
        **kwargs,
    )


def test_state_prompt_context_includes_selected_theme():
    state = _state(theme_id="cobalt")

    context = nodes._format_state_for_prompt_basic(state)

    assert 'Use theme "cobalt"' in context
    assert "styling_recommendations.theme" in context


def test_effective_theme_defaults_silently_when_no_theme_selected():
    from server import _effective_theme_id

    assert _effective_theme_id(None, None) == "default"
    assert _effective_theme_id("aurora", None) == "aurora"
    assert _effective_theme_id(None, "hr_workforce") == "warm"


def test_state_prompt_context_includes_analysis_focus_contract():
    state = _state(
        template_spec={
            "name": "HR & Workforce",
            "prompt_prefix": "[FOCUS: HR & Workforce] Focus on headcount and attrition.",
        }
    )

    context = nodes._format_state_for_prompt_basic(state)

    assert "SELECTED ANALYSIS FOCUS" in context
    assert "Focus on headcount and attrition" in context


def test_vietnamese_metric_card_fix_routes_to_dashboard_repair():
    state = AgentState(
        user_state=UserState(
            user_id="user_1",
            project_id="project_1",
            conversation_id="conversation_1",
            dashboards={"dash_1": {"metrics": [{"title": "A1", "value": "1227"}]}},
        ),
        working_memory=WorkingMemory(),
        workflow_history=WorkflowHistory(),
        input_prompt="sai rồi sao số A1 A3 A7 trên metrics card lại giống nhau",
    )

    routed = nodes.node_routing(state)
    decision = routed.working_memory.tool_outputs["route_decision"]

    assert decision["next_step"] == "dashboard"
    assert decision["is_dashboard_repair"] is True


def test_apply_theme_to_dashboard_data_forces_all_component_styles():
    from server import _apply_theme_to_dashboard_data

    dashboard = {
        "metrics": [{"styling": {"theme": "default"}}],
        "charts": [{"styling": {"theme": "default"}}],
        "tables": [{}],
        "styling_recommendations": {"theme": "default"},
    }

    _apply_theme_to_dashboard_data(dashboard, "cobalt")

    assert dashboard["theme_id"] == "cobalt"
    assert dashboard["styling_recommendations"]["theme"] == "cobalt"
    assert dashboard["metrics"][0]["styling"]["theme"] == "cobalt"
    assert dashboard["charts"][0]["styling"]["theme"] == "cobalt"
    assert dashboard["tables"][0]["styling"]["theme"] == "cobalt"


def test_apply_default_theme_to_dashboard_data_when_theme_is_silent():
    from server import _apply_theme_to_dashboard_data

    dashboard = {
        "metrics": [{"styling": {"theme": "slate"}}],
        "charts": [{"styling": {}}],
        "tables": [{}],
        "styling_recommendations": {"theme": "carbon"},
    }

    _apply_theme_to_dashboard_data(dashboard, "default")

    assert dashboard["theme_id"] == "default"
    assert dashboard["styling_recommendations"]["theme"] == "default"
    assert dashboard["metrics"][0]["styling"]["theme"] == "default"
    assert dashboard["charts"][0]["styling"]["theme"] == "default"
    assert dashboard["tables"][0]["styling"]["theme"] == "default"


def test_extract_assets_respects_none_selection():
    from server import _extract_assets_from_nodes

    conversation = {
        "nodes": [
            {
                "role": "user",
                "metadata": {"asset_selection": "none"},
                "contents": [
                    {
                        "type": "asset",
                        "data": {
                            "asset_id": "asset_1",
                            "s3_bucket": "bucket",
                            "s3_key": "key.csv",
                        },
                    }
                ],
            }
        ]
    }

    assert _extract_assets_from_nodes(conversation) == []


def test_extract_assets_respects_explicit_selection():
    from server import _extract_assets_from_nodes

    conversation = {
        "nodes": [
            {
                "role": "user",
                "contents": [
                    {
                        "type": "asset",
                        "data": {
                            "asset_id": "asset_1",
                            "s3_bucket": "bucket",
                            "s3_key": "one.csv",
                        },
                    },
                    {
                        "type": "asset",
                        "data": {
                            "asset_id": "asset_2",
                            "s3_bucket": "bucket",
                            "s3_key": "two.csv",
                        },
                    },
                ],
            },
            {
                "role": "user",
                "metadata": {"asset_selection": "explicit", "selected_asset_ids": ["asset_2"]},
                "contents": [{"type": "text", "data": {"text": "Use asset 2"}}],
            },
        ]
    }

    assets = _extract_assets_from_nodes(conversation)
    assert [asset["asset_id"] for asset in assets] == ["asset_2"]


def test_build_data_context_clarification_recommends_matching_asset():
    from server import _build_data_context_clarification

    clarification = _build_data_context_clarification(
        "what is last week trend in web visitor, show it in a chart",
        [
            {
                "asset_id": "ads_1",
                "filename": "Google Ads.csv",
                "asset_type": "integration_google_ads",
            },
            {
                "asset_id": "ga4_1",
                "filename": "GA4 visitors.csv",
                "asset_type": "integration_ga4",
            },
        ],
    )

    assert clarification["reason_code"] == "missing_data_context"
    assert clarification["options"][0]["metadata"]["asset_ids"] == ["ga4_1"]
    assert any(option["id"] == "all_project_data" for option in clarification["options"])
