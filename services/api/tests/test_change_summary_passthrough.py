"""Phase 6: the chart-edit explainer (change_summary / data_provenance) flows
through workflow-status metadata to the dashboard read and SSE relay."""

import asyncio
from unittest.mock import patch

from app.api.route_modules import conversation


def test_latest_edit_explainer_extracts_metadata():
    node = {
        "conversation_id": "c1",
        "node_id": "workflow",
        "status": "completed",
        "metadata": {
            "change_summary": {"human_summary": "Switched Revenue from bar to line."},
            "data_provenance": {"python_code": ["print(df['rev'].sum())"]},
        },
    }
    with patch.object(conversation.workflow_nodes_repo, "get_node", return_value=node):
        explainer = conversation._latest_edit_explainer("c1")
    assert explainer["change_summary"]["human_summary"].startswith("Switched Revenue")
    assert explainer["computed_values"]["python_code"] == ["print(df['rev'].sum())"]


def test_latest_edit_explainer_absent_returns_none():
    node = {"conversation_id": "c1", "node_id": "workflow", "status": "completed"}
    with patch.object(conversation.workflow_nodes_repo, "get_node", return_value=node):
        explainer = conversation._latest_edit_explainer("c1")
    assert explainer["change_summary"] is None
    assert explainer["computed_values"] is None


def test_latest_edit_explainer_handles_missing_node():
    with patch.object(conversation.workflow_nodes_repo, "get_node", return_value=None):
        explainer = conversation._latest_edit_explainer("c1")
    assert explainer["change_summary"] is None
    assert explainer["computed_values"] is None


def _conversation_meta():
    return {
        "user_id": "user_1",
        "s3_bucket": "bucket",
        "s3_key": "conversation.json",
    }


def _run_get_dashboard():
    return asyncio.run(
        conversation.get_conversation_dashboard(
            conversation_id="c1",
            project_id="project_1",
            dashboard_id="dash_1",
            user_id="user_1",
        )
    )


def test_get_dashboard_includes_explainer_when_present():
    meta = _conversation_meta()
    convo = {
        "dashboards": [
            {"dashboard_id": "dash_1", "s3_uri": "s3://bucket/dashboards/dash_1.json"}
        ]
    }
    workflow_node = {
        "conversation_id": "c1",
        "node_id": "workflow",
        "status": "completed",
        "metadata": {
            "change_summary": {"human_summary": "Recolored the chart."},
            "data_provenance": {"python_code": ["print(1)"]},
        },
    }
    with patch.object(
        conversation.conversations_repo, "get_conversation", return_value=meta
    ), patch.object(
        conversation, "load_conversation", return_value=convo
    ), patch.object(
        conversation, "download_bytes", return_value=b'{"dashboard": {"title": "X"}}'
    ), patch.object(
        conversation.workflow_nodes_repo, "get_node", return_value=workflow_node
    ):
        resp = _run_get_dashboard()

    assert resp.dashboard_id == "dash_1"
    assert resp.change_summary["human_summary"] == "Recolored the chart."
    assert resp.computed_values["python_code"] == ["print(1)"]


def test_get_dashboard_omits_explainer_when_absent():
    meta = _conversation_meta()
    convo = {
        "dashboards": [
            {"dashboard_id": "dash_1", "s3_uri": "s3://bucket/dashboards/dash_1.json"}
        ]
    }
    with patch.object(
        conversation.conversations_repo, "get_conversation", return_value=meta
    ), patch.object(
        conversation, "load_conversation", return_value=convo
    ), patch.object(
        conversation, "download_bytes", return_value=b'{"dashboard": {"title": "X"}}'
    ), patch.object(
        conversation.workflow_nodes_repo, "get_node", return_value=None
    ):
        resp = _run_get_dashboard()

    assert resp.dashboard_id == "dash_1"
    assert resp.change_summary is None
    assert resp.computed_values is None


# --- Activity transparency: analysis_steps carry-through --------------------


def _analysis_steps():
    return [
        {
            "index": 0,
            "title": "Load data",
            "python": "df = pd.read_csv('x.csv')",
            "output": "shape=(10, 3)",
            "explanation": "Read the source file.",
        },
        {
            "index": 1,
            "title": "Sum revenue",
            "python": "df['rev'].sum()",
            "output": "12345",
            "explanation": "Computed total revenue.",
        },
    ]


def test_latest_edit_explainer_extracts_analysis_steps():
    node = {
        "conversation_id": "c1",
        "node_id": "workflow",
        "status": "completed",
        "metadata": {"analysis_steps": _analysis_steps()},
    }
    with patch.object(conversation.workflow_nodes_repo, "get_node", return_value=node):
        explainer = conversation._latest_edit_explainer("c1")
    assert explainer["analysis_steps"][1]["title"] == "Sum revenue"
    assert explainer["change_summary"] is None


def test_get_dashboard_includes_analysis_steps_when_present():
    meta = _conversation_meta()
    convo = {
        "dashboards": [
            {"dashboard_id": "dash_1", "s3_uri": "s3://bucket/dashboards/dash_1.json"}
        ]
    }
    workflow_node = {
        "conversation_id": "c1",
        "node_id": "workflow",
        "status": "completed",
        "metadata": {"analysis_steps": _analysis_steps()},
    }
    with patch.object(
        conversation.conversations_repo, "get_conversation", return_value=meta
    ), patch.object(
        conversation, "load_conversation", return_value=convo
    ), patch.object(
        conversation, "download_bytes", return_value=b'{"dashboard": {"title": "X"}}'
    ), patch.object(
        conversation.workflow_nodes_repo, "get_node", return_value=workflow_node
    ):
        resp = _run_get_dashboard()

    assert resp.dashboard_id == "dash_1"
    assert resp.analysis_steps is not None
    assert len(resp.analysis_steps) == 2
    assert resp.analysis_steps[0]["python"] == "df = pd.read_csv('x.csv')"


def test_get_dashboard_omits_analysis_steps_when_absent():
    meta = _conversation_meta()
    convo = {
        "dashboards": [
            {"dashboard_id": "dash_1", "s3_uri": "s3://bucket/dashboards/dash_1.json"}
        ]
    }
    with patch.object(
        conversation.conversations_repo, "get_conversation", return_value=meta
    ), patch.object(
        conversation, "load_conversation", return_value=convo
    ), patch.object(
        conversation, "download_bytes", return_value=b'{"dashboard": {"title": "X"}}'
    ), patch.object(
        conversation.workflow_nodes_repo, "get_node", return_value=None
    ):
        resp = _run_get_dashboard()

    assert resp.dashboard_id == "dash_1"
    assert resp.analysis_steps is None


def test_status_payload_exposes_analysis_steps():
    node = {
        "conversation_id": "c1",
        "node_id": "workflow",
        "status": "completed",
        "metadata": {"analysis_steps": _analysis_steps(), "change_summary": {"x": 1}},
    }
    payload = conversation._status_payload(node)
    assert payload["metadata"]["analysis_steps"][0]["title"] == "Load data"


def test_event_payload_round_trips_nested_step_metadata():
    event = {
        "conversation_id": "c1",
        "node_id": "event#run1#000003",
        "status": "completed",
        "metadata": {
            "id": "step-3",
            "run_id": "run1",
            "sequence": 3,
            "phase": "analysis",
            "title": "Sum revenue",
            "metadata": {
                "python": "df['rev'].sum()",
                "output": "12345",
                "step_index": 1,
            },
        },
    }
    payload = conversation._event_payload(event)
    assert payload["title"] == "Sum revenue"
    assert payload["metadata"]["python"] == "df['rev'].sum()"
    assert payload["metadata"]["output"] == "12345"
    assert payload["metadata"]["step_index"] == 1
