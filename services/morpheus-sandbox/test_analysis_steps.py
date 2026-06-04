"""Hermetic tests for Activity transparency analysis_steps (Morpheus side).

No live LLM is used: the quick model is a MagicMock whose ``invoke`` returns a
fake explanation payload (or raises). Covers step collection + sanitization,
trivial-step dropping, truncation/capping, batched explanation mapping +
failure tolerance, and node_synthesis surfacing for generation + edit states.
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from morpheus.workflows.analyze_csv import nodes
from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    UserState,
    WorkflowHistory,
    WorkingMemory,
)


# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #


def _make_state():
    return AgentState(
        user_state=UserState(user_id="u1", project_id="p1", conversation_id="c1"),
        working_memory=WorkingMemory(),
        workflow_history=WorkflowHistory(),
        input_prompt="analyze this",
        conversation_id="c1",
        project_id="p1",
    )


def _add_repl(state, query, output, success=True, tool_name="Python_REPL"):
    state.working_memory.python_execution_results.append(
        {
            "tool_name": tool_name,
            "tool_call_id": "call_1",
            "tool_args": {"query": query},
            "success": success,
            "output": output,
            "error": None,
        }
    )


class _FakeMessage:
    """Stands in for an LLM response with a ``.content`` attribute."""

    def __init__(self, content):
        self.content = content


def _explainer_model(explanations_by_index=None, raises=None):
    """Build a fake quick model whose .invoke returns a JSON explanation array."""
    model = MagicMock()
    if raises is not None:
        model.invoke.side_effect = raises
        return model
    payload = [
        {"index": idx, "explanation": text}
        for idx, text in (explanations_by_index or {}).items()
    ]
    model.invoke.return_value = _FakeMessage(json.dumps(payload))
    return model


# --------------------------------------------------------------------------- #
# 1. _collect_analysis_steps
# --------------------------------------------------------------------------- #


def test_collect_builds_steps_from_generation_runs():
    state = _make_state()
    _add_repl(state, "# Weekly totals\ndf.resample('W').sum()", "week1 100\nweek2 200")
    _add_repl(state, "df['rev'].sum()", "300")
    # failed run — ignored
    _add_repl(state, "broken", "NameError", success=False)
    # non-python tool — ignored
    _add_repl(state, "x", "[...]", tool_name="get_available_chart_types")

    steps = nodes._collect_analysis_steps(state)

    assert len(steps) == 2
    assert steps[0]["index"] == 0 and steps[1]["index"] == 1
    assert steps[0]["title"] == "Weekly totals"  # from first comment line
    assert "resample" in steps[0]["python"]
    assert "week1 100" in steps[0]["output"]
    # Generic title fallback when there is no comment.
    assert steps[1]["title"] == "Step 2: analysis"


def test_collect_strips_temp_paths():
    state = _make_state()
    _add_repl(
        state,
        "pd.read_csv('/var/folders/ab/cd/T/sales.csv')",
        "loaded /tmp/sales.csv ok",
    )

    steps = nodes._collect_analysis_steps(state)

    assert "/var/folders/" not in steps[0]["python"]
    assert "<path>" in steps[0]["python"]
    assert "/tmp/" not in steps[0]["output"]


def test_collect_collapses_file_paths_subscript():
    state = _make_state()
    _add_repl(state, "df = pd.read_csv(file_paths['sales.csv'])", "ok")

    steps = nodes._collect_analysis_steps(state)

    assert "file_paths[...]" in steps[0]["python"]
    assert "sales.csv" not in steps[0]["python"]


def test_collect_drops_trivial_file_listing_step():
    state = _make_state()
    _add_repl(state, "print(file_paths)", "{'sales.csv': '/tmp/x'}")
    _add_repl(state, "df['rev'].sum()", "300")

    steps = nodes._collect_analysis_steps(state)

    assert len(steps) == 1
    assert "rev" in steps[0]["python"]


def test_collect_truncates_long_code_and_output():
    state = _make_state()
    _add_repl(state, "x = 1  # " + ("a" * 5000), "z" * 5000)

    steps = nodes._collect_analysis_steps(state)

    assert len(steps[0]["python"]) <= nodes.ANALYSIS_STEP_MAX_CHARS
    assert len(steps[0]["output"]) <= nodes.ANALYSIS_STEP_MAX_CHARS


def test_collect_caps_step_count_to_last_n():
    state = _make_state()
    for i in range(nodes.ANALYSIS_STEPS_MAX + 5):
        _add_repl(state, f"compute_{i}()", str(i))

    steps = nodes._collect_analysis_steps(state)

    total = nodes.ANALYSIS_STEPS_MAX + 5
    assert len(steps) == nodes.ANALYSIS_STEPS_MAX
    # Kept the LAST N and renumbered contiguously from 0.
    assert [s["index"] for s in steps] == list(range(nodes.ANALYSIS_STEPS_MAX))
    first_kept = total - nodes.ANALYSIS_STEPS_MAX
    assert f"compute_{first_kept}()" in steps[0]["python"]
    assert f"compute_{total - 1}()" in steps[-1]["python"]


# --------------------------------------------------------------------------- #
# 2. _explain_analysis_steps
# --------------------------------------------------------------------------- #


def test_explain_attaches_explanation_by_index():
    steps = [
        {"index": 0, "title": "t0", "python": "a", "output": "1"},
        {"index": 1, "title": "t1", "python": "b", "output": "2"},
    ]
    model = _explainer_model({0: "Summed revenue.", 1: "Counted rows."})

    result = nodes._explain_analysis_steps(model, steps)

    assert result[0]["explanation"] == "Summed revenue."
    assert result[1]["explanation"] == "Counted rows."


def test_explain_uses_fallback_explanation_on_model_exception():
    steps = [
        {"index": 0, "title": "robust read attempts", "python": "a", "output": "1"}
    ]
    model = _explainer_model(raises=RuntimeError("boom"))

    result = nodes._explain_analysis_steps(model, steps)

    assert result[0]["explanation"] == (
        "Loaded the data carefully and retried with safer read settings."
    )


def test_explain_no_model_yields_fallback_explanations():
    steps = [{"index": 0, "title": "Step 1: analysis", "python": "a", "output": "1"}]

    result = nodes._explain_analysis_steps(None, steps)

    assert result[0]["explanation"] == (
        "Ran a calculation and saved the result used in the dashboard."
    )


def test_explain_blank_model_response_yields_fallback_explanation():
    steps = [
        {"index": 0, "title": "explicit computed values", "python": "a", "output": "1"}
    ]
    model = _explainer_model({0: ""})

    result = nodes._explain_analysis_steps(model, steps)

    assert result[0]["explanation"] == (
        "Pulled the exact computed values into the dashboard."
    )


def test_explain_empty_steps_is_noop():
    assert nodes._explain_analysis_steps(_explainer_model({}), []) == []


# --------------------------------------------------------------------------- #
# 3. node_synthesis surfacing (generation + edit)
# --------------------------------------------------------------------------- #


def _patch_quick_model(monkeypatch, model):
    monkeypatch.setattr(nodes, "get_model_for_quick_agent", lambda: model)


def test_node_synthesis_surfaces_steps_for_generation(monkeypatch):
    _patch_quick_model(monkeypatch, _explainer_model({0: "Summed revenue."}))
    state = _make_state()
    state.working_memory.tool_outputs["route_decision"] = {"next_step": "dashboard"}
    state.working_memory.dashboard_json = {"dashboard": {"title": "X"}, "charts": []}
    _add_repl(state, "# Total revenue\ndf['rev'].sum()", "300")

    nodes.node_synthesis(state)

    assert state.output["type"] == "dashboard_config"
    assert state.working_memory.analysis_steps[0]["explanation"] == "Summed revenue."
    assert state.output["analysis_steps"][0]["title"] == "Total revenue"


def test_node_synthesis_surfaces_steps_for_edit(monkeypatch):
    _patch_quick_model(
        monkeypatch, _explainer_model({0: "Recomputed quarterly totals."})
    )
    chart = {
        "id": "chart_1",
        "chart_type": "bar",
        "title": "Quarterly",
        "datasets": [
            {"label": "Series", "data": [{"label": "Q1", "value": 120}]},
        ],
    }
    state = _make_state()
    state.working_memory.tool_outputs["route_decision"] = {
        "next_step": "dashboard",
        "is_chart_modification": True,
    }
    state.working_memory.dashboard_json = {
        "dashboard": {"title": "Edited"},
        "charts": [chart],
    }
    state.chart_mentions = [
        {
            "component_id": "cmp_1",
            "chart_id": "chart_1",
            "title": "Quarterly",
            "chart_type": "bar",
            "config": {"chart_type": "bar", "datasets": [{"label": "Series"}]},
        }
    ]
    _add_repl(state, "# Quarterly totals\ndf.groupby('q').sum()", "Q1 120")

    nodes.node_synthesis(state)

    assert state.output["type"] == "chart_modification"
    assert state.output["analysis_steps"][0]["explanation"] == (
        "Recomputed quarterly totals."
    )
    assert state.working_memory.analysis_steps[0]["title"] == "Quarterly totals"


def test_node_synthesis_surfaces_steps_for_text_qa(monkeypatch):
    _patch_quick_model(monkeypatch, _explainer_model({0: "Checked session growth."}))
    state = _make_state()
    state.working_memory.tool_outputs["route_decision"] = {"next_step": "qa"}
    state.working_memory.qa_response = "Sessions increased by 12%."
    _add_repl(state, "# Session growth\ndf['sessions'].pct_change().iloc[-1]", "0.12")

    nodes.node_synthesis(state)

    assert state.output["type"] == "message"
    assert state.output["content"] == "Sessions increased by 12%."
    assert state.output["analysis_steps"][0]["title"] == "Session growth"
    assert state.output["analysis_steps"][0]["explanation"] == "Checked session growth."


def test_node_synthesis_surfaces_steps_for_qa_visual(monkeypatch):
    _patch_quick_model(monkeypatch, _explainer_model({0: "Built the visual trend."}))
    state = _make_state()
    state.working_memory.tool_outputs["route_decision"] = {"next_step": "qa_visual"}
    state.working_memory.qa_response = "Here is the weekly revenue trend."
    state.working_memory.visual_artifacts = [
        {
            "id": "artifact_1",
            "kind": "chart",
            "title": "Weekly revenue",
            "datasets": [
                {
                    "label": "Revenue",
                    "data": [{"label": "W1", "value": 100}],
                }
            ],
        }
    ]
    _add_repl(state, "# Weekly revenue\ndf.groupby('week')['revenue'].sum()", "W1 100")

    nodes.node_synthesis(state)

    assert state.output["type"] == "answer_with_visual"
    assert state.output["artifacts"][0]["id"] == "artifact_1"
    assert state.output["analysis_steps"][0]["title"] == "Weekly revenue"
    assert state.output["analysis_steps"][0]["explanation"] == "Built the visual trend."


# --------------------------------------------------------------------------- #
# emit_execution_step — live per-step code streaming (shared by both loops)
# --------------------------------------------------------------------------- #


def test_emit_execution_step_streams_code_and_increments_index():
    state = _make_state()
    events = []
    fn = lambda **kw: events.append(kw)  # noqa: E731

    nodes.emit_execution_step(
        state, fn, "# Load data\ndf = pd.read_csv(p)", "shape=(10, 3)"
    )
    nodes.emit_execution_step(state, fn, "df['rev'].sum()", "12345")

    assert len(events) == 2
    assert events[0]["phase"] == "execution"
    assert events[0]["metadata"]["python"].startswith("# Load data")
    assert events[0]["metadata"]["output"] == "shape=(10, 3)"
    assert events[0]["metadata"]["step_index"] == 0
    assert events[1]["metadata"]["step_index"] == 1  # monotonic, no collision


def test_emit_execution_step_sanitizes_temp_paths():
    state = _make_state()
    events = []
    fn = lambda **kw: events.append(kw)  # noqa: E731

    nodes.emit_execution_step(
        state, fn, "pd.read_csv('/var/folders/zj/abc/T/data.csv')", "ok"
    )
    assert "/var/folders/" not in events[0]["metadata"]["python"]


def test_emit_execution_step_no_thinking_fn_is_noop():
    state = _make_state()
    # Must not raise and must not bump the counter when there is no sink.
    nodes.emit_execution_step(state, None, "x = 1", "1")
    assert state.working_memory.tool_outputs.get("_analysis_step_emitted", 0) == 0
