"""Hermetic tests for Phase 4 structured chart-modification output + repair.

No live LLM is used: models are MagicMocks whose ``with_structured_output``
returns a fake structured runnable. Covers schema validation, provider routing,
the structured-emission fallback, missing-key detection, and single-shot repair.
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from morpheus.workflows.analyze_csv import nodes
from morpheus.workflows.analyze_csv.schemas.chart_spec import (
    ChartModificationResult,
    ChartSpec,
    TableModificationResult,
)
from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    UserState,
    WorkflowHistory,
    WorkingMemory,
)


# --------------------------------------------------------------------------- #
# Fixtures / builders
# --------------------------------------------------------------------------- #


def _good_chart_dict():
    return {
        "id": "chart_1",
        "chart_type": "bar",
        "title": "Sales by Region",
        "description": "Total sales per region",
        "layout": {"x": 0, "y": 0, "w": 12, "h": 12, "minW": 4, "minH": 10},
        "datasets": [
            {
                "label": "Sales",
                "data": [
                    {"label": "North", "value": 100.0},
                    {"label": "South", "value": 80.0},
                ],
            }
        ],
        "config": {"animation": True, "showGrid": True, "showLegend": True},
    }


def _good_result():
    return ChartModificationResult.model_validate(
        {
            "chart": _good_chart_dict(),
            "change_summary": {
                "change_type": ["chart_type"],
                "chart_type_from": "line",
                "chart_type_to": "bar",
                "human_summary": "Switched the chart from a line to a bar chart.",
            },
            "data_provenance": {
                "python_code": ["df.groupby('region')['sales'].sum()"],
                "computed_values": {"North": 100.0, "South": 80.0},
            },
        }
    )


def _make_state():
    return AgentState(
        user_state=UserState(
            user_id="u1",
            project_id="p1",
            conversation_id="c1",
        ),
        working_memory=WorkingMemory(),
        workflow_history=WorkflowHistory(),
        input_prompt="make it a bar chart",
        conversation_id="c1",
        project_id="p1",
    )


class _FakeStructured:
    """Stands in for model.with_structured_output(...) result."""

    def __init__(self, return_value=None, raises=None):
        self._return_value = return_value
        self._raises = raises

    def invoke(self, _messages):
        if self._raises is not None:
            raise self._raises
        return self._return_value


def _model(model_name, struct_by_method=None, default_struct=None):
    """Build a fake model.

    struct_by_method: dict keyed by the ``method`` kwarg -> _FakeStructured.
    default_struct: used when with_structured_output is called without method.
    """
    model = MagicMock()
    model.model_name = model_name

    def _with_structured_output(_schema, method=None):
        if method is None:
            return default_struct
        if struct_by_method is None or method not in struct_by_method:
            raise RuntimeError(f"unexpected method {method}")
        return struct_by_method[method]

    model.with_structured_output.side_effect = _with_structured_output
    return model


# --------------------------------------------------------------------------- #
# 1. Schema validation
# --------------------------------------------------------------------------- #


def test_result_accepts_good_chart():
    result = _good_result()
    assert result.chart.chart_type == "bar"
    assert result.chart.datasets[0].data[0].value == 100.0


def test_result_rejects_missing_datasets():
    bad = _good_chart_dict()
    bad.pop("datasets")
    with pytest.raises(Exception):
        ChartSpec.model_validate(bad)


def test_result_rejects_missing_chart_type():
    bad = _good_chart_dict()
    bad.pop("chart_type")
    with pytest.raises(Exception):
        ChartSpec.model_validate(bad)


def test_chart_type_enum_rejects_invalid_value():
    bad = _good_chart_dict()
    bad["chart_type"] = "definitely_not_a_chart"
    with pytest.raises(Exception):
        ChartSpec.model_validate(bad)


# --------------------------------------------------------------------------- #
# 2. _emit_chart_spec_structured
# --------------------------------------------------------------------------- #


def test_emit_structured_openai_json_schema_success():
    state = _make_state()
    struct = _FakeStructured(return_value=_good_result())
    model = _model("gpt-5.4-mini", struct_by_method={"json_schema": struct})

    result = nodes._emit_chart_spec_structured(model, [], state)

    assert isinstance(result, ChartModificationResult)
    assert (
        state.working_memory.tool_outputs["structured_output_method"] == "json_schema"
    )


def test_emit_structured_openai_falls_back_to_function_calling():
    state = _make_state()
    struct_by_method = {
        "json_schema": _FakeStructured(raises=RuntimeError("strict schema rejected")),
        "function_calling": _FakeStructured(return_value=_good_result()),
    }
    model = _model("gpt-5.4-mini", struct_by_method=struct_by_method)

    result = nodes._emit_chart_spec_structured(model, [], state)

    assert isinstance(result, ChartModificationResult)
    assert (
        state.working_memory.tool_outputs["structured_output_method"]
        == "function_calling"
    )


def test_emit_structured_gemini_routing():
    state = _make_state()
    default_struct = _FakeStructured(return_value=_good_result())
    model = _model("gemini-3-pro", default_struct=default_struct)

    result = nodes._emit_chart_spec_structured(model, [], state)

    assert isinstance(result, ChartModificationResult)
    assert (
        state.working_memory.tool_outputs["structured_output_method"]
        == "gemini_response_schema"
    )
    # Gemini path must NOT pass a method kwarg.
    model.with_structured_output.assert_called_once()
    _, kwargs = model.with_structured_output.call_args
    assert "method" not in kwargs


def test_emit_structured_raises_known_error_on_total_failure():
    state = _make_state()
    struct_by_method = {
        "json_schema": _FakeStructured(raises=RuntimeError("boom")),
        "function_calling": _FakeStructured(raises=RuntimeError("boom2")),
    }
    model = _model("gpt-5.4-mini", struct_by_method=struct_by_method)

    with pytest.raises(nodes.StructuredEmissionError):
        nodes._emit_chart_spec_structured(model, [], state)


# --------------------------------------------------------------------------- #
# 3. _chart_spec_missing_keys
# --------------------------------------------------------------------------- #


def test_missing_keys_detects_missing_chart_type():
    bad = _good_chart_dict()
    bad.pop("chart_type")
    assert "chart_type" in nodes._chart_spec_missing_keys(bad)


def test_missing_keys_empty_for_valid_chart():
    assert nodes._chart_spec_missing_keys(_good_chart_dict()) == []


def test_chart_has_no_datapoints_detects_empty_shapes():
    no_datasets = _good_chart_dict()
    no_datasets["datasets"] = []
    empty_dataset = _good_chart_dict()
    empty_dataset["datasets"] = [{"label": "Daily", "data": []}]
    all_empty_datasets = _good_chart_dict()
    all_empty_datasets["datasets"] = [
        {"label": "Daily", "data": []},
        {"label": "Weekly", "data": []},
    ]

    assert nodes._chart_has_no_datapoints(no_datasets) is True
    assert nodes._chart_has_no_datapoints(empty_dataset) is True
    assert nodes._chart_has_no_datapoints(all_empty_datasets) is True


def test_chart_has_no_datapoints_allows_any_real_datapoint():
    mixed = _good_chart_dict()
    mixed["datasets"] = [
        {"label": "Daily", "data": []},
        {"label": "Monthly", "data": [{"label": "Jan", "value": 100.0}]},
    ]

    assert nodes._chart_has_no_datapoints(mixed) is False


# --------------------------------------------------------------------------- #
# 4. _repair_chart_json
# --------------------------------------------------------------------------- #


def test_repair_fills_missing_chart_type():
    state = _make_state()
    broken = _good_chart_dict()
    broken.pop("chart_type")

    fixed_spec = ChartSpec.model_validate(_good_chart_dict())
    quick_model = MagicMock()
    quick_model.model_name = "gpt-5.4-mini"
    quick_model.with_structured_output.return_value = _FakeStructured(
        return_value=fixed_spec
    )

    repaired = nodes._repair_chart_json(quick_model, broken, ["chart_type"], state)

    assert repaired is not None
    assert repaired["chart_type"] == "bar"
    assert state.working_memory.tool_outputs["repair_attempted"] is True


def test_repair_runs_only_once():
    state = _make_state()
    state.working_memory.tool_outputs["repair_attempted"] = True
    quick_model = MagicMock()

    repaired = nodes._repair_chart_json(quick_model, {}, ["chart_type"], state)

    assert repaired is None
    quick_model.with_structured_output.assert_not_called()


# --------------------------------------------------------------------------- #
# 4b. _finalize_chart_mod_emission integration
# --------------------------------------------------------------------------- #


def test_finalize_chart_mod_emission_wraps_structured_chart_and_stashes_context():
    state = _make_state()
    struct = _FakeStructured(return_value=_good_result())
    model = _model("gpt-5.4-mini", struct_by_method={"json_schema": struct})

    dashboard = nodes._finalize_chart_mod_emission(
        state, model, None, [], "ignored free-form content"
    )

    assert dashboard["charts"][0]["id"] == "chart_1"
    assert dashboard["metrics"] == []
    assert (
        state.working_memory.chart_change_summary["human_summary"]
        == "Switched the chart from a line to a bar chart."
    )
    assert state.working_memory.edit_provenance["computed_values"] == {
        "North": 100.0,
        "South": 80.0,
    }


def test_finalize_chart_mod_emission_preserves_regex_fallback_for_valid_chart_json():
    state = _make_state()
    struct_by_method = {
        "json_schema": _FakeStructured(raises=RuntimeError("strict failed")),
        "function_calling": _FakeStructured(raises=RuntimeError("fallback failed")),
    }
    model = _model("gpt-5.4-mini", struct_by_method=struct_by_method)
    content = f"```json\n{json.dumps(_good_chart_dict())}\n```"

    dashboard = nodes._finalize_chart_mod_emission(state, model, None, [], content)

    assert dashboard["dashboard"]["title"] == "Chart Modification"
    assert dashboard["charts"][0]["chart_type"] == "bar"
    assert state.working_memory.chart_change_summary is None
    assert state.working_memory.edit_provenance is None


def test_finalize_chart_mod_emission_regex_fast_path_skips_structured_call():
    # When the reasoning output already contains a valid chart, the structured
    # emitter must NOT be invoked (the latency win — no extra LLM call).
    state = _make_state()
    model = _model("gpt-5.4-mini")  # with_structured_output is a MagicMock spy
    content = f"```json\n{json.dumps(_good_chart_dict())}\n```"

    dashboard = nodes._finalize_chart_mod_emission(state, model, None, [], content)

    assert dashboard["charts"][0]["chart_type"] == "bar"
    model.with_structured_output.assert_not_called()


def test_finalize_chart_mod_emission_empty_regex_chart_uses_structured_fallback():
    state = _make_state()
    empty_chart = _good_chart_dict()
    empty_chart["datasets"] = [{"label": "Daily", "data": []}]
    struct = _FakeStructured(return_value=_good_result())
    model = _model("gpt-5.4-mini", struct_by_method={"json_schema": struct})
    content = f"```json\n{json.dumps(empty_chart)}\n```"

    dashboard = nodes._finalize_chart_mod_emission(state, model, None, [], content)

    assert dashboard["charts"][0]["chart_type"] == "bar"
    assert dashboard["charts"][0]["datasets"][0]["data"]
    model.with_structured_output.assert_called_once()
    assert (
        state.working_memory.tool_outputs["structured_output_method"] == "json_schema"
    )


# --------------------------------------------------------------------------- #
# 5. Phase 5 — chart-modification data-authenticity validation
# --------------------------------------------------------------------------- #


def _add_repl_result(state, output, success=True):
    """Append a fake Python REPL execution result to the state."""
    state.working_memory.python_execution_results.append(
        {
            "tool_name": "Python_REPL",
            "tool_call_id": "call_1",
            "tool_args": {"query": "print(...)"},
            "success": success,
            "output": output,
            "error": None,
        }
    )


def _chart_with_values(values, labels=None):
    """Build a single-chart dict with the given numeric datapoints."""
    labels = labels or [f"L{i}" for i in range(len(values))]
    return {
        "id": "chart_1",
        "chart_type": "bar",
        "title": "Quarterly",
        "layout": {"x": 0, "y": 0, "w": 12, "h": 12, "minW": 4, "minH": 10},
        "datasets": [
            {
                "label": "Series",
                "data": [
                    {"label": label, "value": value}
                    for label, value in zip(labels, values)
                ],
            }
        ],
    }


def _chart_mod_state_with_output(chart):
    """State whose output is a chart-modification dashboard wrapper.

    The wrapper mirrors a real chart-modification output: a structurally valid
    dashboard config whose ``charts`` array holds the single modified chart.
    """
    state = _make_state()
    state.working_memory.tool_outputs["route_decision"] = {
        "is_chart_modification": True
    }
    state.output = {
        "type": "chart_modification",
        "data": {
            "dashboard": {"title": "Edited Dashboard"},
            "charts": [chart],
        },
    }
    return state


def test_chart_mod_data_all_values_match():
    state = _make_state()
    _add_repl_result(state, "Q1 120\nQ2 95")
    chart = _chart_with_values([120, 95], labels=["Q1", "Q2"])

    result = nodes._validate_chart_modification_data(chart, state)

    assert result["valid"] is True
    assert result["unmatched_ratio"] == 0.0
    assert not result["errors"]


def test_chart_mod_data_majority_unmatched_fails():
    state = _make_state()
    _add_repl_result(state, "Q1 120\nQ2 95")
    chart = _chart_with_values([999, 888])

    result = nodes._validate_chart_modification_data(chart, state)

    assert result["valid"] is False
    assert result["unmatched_ratio"] > nodes.CHART_MOD_AUTHENTICITY_FAIL_RATIO
    assert result["errors"]


def test_chart_mod_restyle_no_repl_runs_passes():
    state = _make_state()  # no REPL executions at all
    chart = _chart_with_values([12345, 67890])

    result = nodes._validate_chart_modification_data(chart, state)

    assert result["valid"] is True
    assert result["unmatched_ratio"] == 0.0
    # A failed run does not count as successful either.
    _add_repl_result(state, "irrelevant", success=False)
    result_failed = nodes._validate_chart_modification_data(chart, state)
    assert result_failed["valid"] is True


def test_chart_mod_empty_data_hard_fails_before_restyle_short_circuit():
    state = _make_state()  # no REPL executions at all
    chart = _chart_with_values([])

    result = nodes._validate_chart_modification_data(chart, state)

    assert result["valid"] is False
    assert result["empty_chart"] is True
    assert result["unmatched_ratio"] == 1.0
    assert result["errors"]


def test_chart_mod_exactly_half_unmatched_is_not_a_failure():
    state = _make_state()
    _add_repl_result(state, "value 120")
    # One matched (120), one unmatched (999) -> exactly 50%.
    chart = _chart_with_values([120, 999])

    result = nodes._validate_chart_modification_data(chart, state)

    assert result["unmatched_ratio"] == 0.5
    # Must be strictly greater than the boundary to fail.
    assert nodes.CHART_MOD_AUTHENTICITY_FAIL_RATIO == 0.5
    assert result["valid"] is True
    assert result["warnings"]  # accepted but logged


def test_node_validation_chart_mod_accepts_with_warning_no_reasoning_loop():
    # A chart edit with unmatched datapoints is ACCEPTED with a warning rather
    # than forcing an extra reasoning loop — keeps single-chart edits fast.
    chart = _chart_with_values([999, 888])
    state = _chart_mod_state_with_output(chart)
    _add_repl_result(state, "Q1 120\nQ2 95")

    nodes.node_validation(state)

    validation = state.working_memory.tool_outputs["validation"]
    assert validation["valid"] is True
    assert validation.get("data_warnings")
    # No re-reasoning: force_more_tools is NOT set and the retry counter is untouched.
    assert "force_more_tools" not in state.working_memory.tool_outputs
    assert "chart_mod_validation_retries" not in state.working_memory.tool_outputs


def test_node_validation_chart_mod_retry_cap_accepts_with_warning():
    chart = _chart_with_values([999, 888])
    state = _chart_mod_state_with_output(chart)
    _add_repl_result(state, "Q1 120\nQ2 95")
    # Counter already at the cap -> next failure must accept with warnings.
    state.working_memory.tool_outputs["chart_mod_validation_retries"] = (
        nodes.CHART_MOD_AUTHENTICITY_MAX_RETRIES
    )

    nodes.node_validation(state)

    validation = state.working_memory.tool_outputs["validation"]
    assert validation["valid"] is True
    assert validation.get("data_warnings")
    # Counter is not incremented past the cap on accept.
    assert (
        state.working_memory.tool_outputs["chart_mod_validation_retries"]
        == nodes.CHART_MOD_AUTHENTICITY_MAX_RETRIES
    )


def test_node_validation_chart_mod_clean_data_passes():
    chart = _chart_with_values([120, 95], labels=["Q1", "Q2"])
    state = _chart_mod_state_with_output(chart)
    _add_repl_result(state, "Q1 120\nQ2 95")

    nodes.node_validation(state)

    validation = state.working_memory.tool_outputs["validation"]
    assert validation["valid"] is True
    assert "force_more_tools" not in state.working_memory.tool_outputs


def test_node_validation_chart_mod_empty_chart_forces_one_recompute():
    chart = _chart_with_values([])
    state = _chart_mod_state_with_output(chart)

    nodes.node_validation(state)

    validation = state.working_memory.tool_outputs["validation"]
    assert validation["valid"] is False
    assert validation["empty_chart"] is True
    assert state.working_memory.tool_outputs["chart_mod_empty_retries"] == 1
    assert "NO DATAPOINTS" in state.working_memory.tool_outputs["force_more_tools"]
    assert state.working_memory.retry_count == 1


def test_node_validation_chart_mod_empty_chart_after_cap_flags_keep_original():
    chart = _chart_with_values([])
    state = _chart_mod_state_with_output(chart)
    state.working_memory.tool_outputs["chart_mod_empty_retries"] = 1

    nodes.node_validation(state)

    validation = state.working_memory.tool_outputs["validation"]
    assert validation["valid"] is True
    assert validation["empty_chart"] is True
    assert validation["data_warnings"]
    assert "force_more_tools" not in state.working_memory.tool_outputs
    assert state.working_memory.tool_outputs["chart_mod_empty_retries"] == 1


# ---------------------------------------------------------------------------
# Section 6: "what changed" summary + "data behind this edit" provenance
# ---------------------------------------------------------------------------


def test_build_edit_provenance_collects_successful_repl_code():
    state = _make_state()
    state.working_memory.python_execution_results.append(
        {
            "tool_name": "Python_REPL",
            "tool_args": {"query": "print(df['rev'].sum())"},
            "success": True,
            "output": "12345",
            "error": None,
        }
    )
    # failed REPL run — must be ignored
    state.working_memory.python_execution_results.append(
        {
            "tool_name": "Python_REPL",
            "tool_args": {"query": "print(broken)"},
            "success": False,
            "output": "NameError",
            "error": "NameError",
        }
    )
    # non-REPL tool — must be ignored
    state.working_memory.python_execution_results.append(
        {
            "tool_name": "get_available_chart_types",
            "tool_args": {},
            "success": True,
            "output": "[...]",
            "error": None,
        }
    )

    prov = nodes._build_edit_provenance(state)
    assert prov["python_code"] == ["print(df['rev'].sum())"]
    assert "12345" in "".join(prov["computed_values"].values())


def test_derive_change_summary_detects_chart_type_change():
    summary = nodes._derive_change_summary(
        {"chart_type": "bar", "datasets": [{"label": "Revenue"}]},
        {"chart_type": "line", "datasets": [{"label": "Revenue"}]},
    )
    assert summary["chart_type_from"] == "bar"
    assert summary["chart_type_to"] == "line"
    assert "chart_type" in summary["change_type"]
    assert isinstance(summary["human_summary"], str) and summary["human_summary"]


def test_derive_change_summary_detects_series_add_remove():
    summary = nodes._derive_change_summary(
        {"chart_type": "bar", "datasets": [{"label": "A"}]},
        {"chart_type": "bar", "datasets": [{"label": "B"}]},
    )
    assert summary["series_added"] == ["B"]
    assert summary["series_removed"] == ["A"]


def test_node_synthesis_attaches_summary_and_provenance():
    chart = _chart_with_values([120, 95], labels=["Q1", "Q2"])
    chart["chart_type"] = "line"
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
    _add_repl_result(state, "Q1 120\nQ2 95")

    nodes.node_synthesis(state)

    ctx = state.output["chart_modification_context"]
    assert ctx["change_summary"] is not None
    assert ctx["data_provenance"]["python_code"]  # authoritative, from REPL


# ---------------------------------------------------------------------------
# Section 7: edit-targeting fixes — id preservation, table edits, dashboard_id
# ---------------------------------------------------------------------------


def _good_table_dict(table_id="table_001"):
    return {
        "id": table_id,
        "title": "Top Products",
        "description": "Best selling items",
        "layout": {"x": 0, "y": 20, "w": 24, "h": 10, "minW": 12, "minH": 10},
        "columns": [
            {"id": "col1", "label": "Product Name", "type": "text"},
            {"id": "col2", "label": "Revenue", "type": "currency"},
        ],
        "data": [
            {"col1": "Product A", "col2": 125000.50},
            {"col1": "Product B", "col2": 98500.25},
        ],
    }


def _good_table_result(table_id="table_001"):
    return TableModificationResult.model_validate(
        {
            "table": _good_table_dict(table_id),
            "change_summary": {
                "change_type": ["other"],
                "human_summary": "Expanded the table from top 5 to top 10.",
            },
            "data_provenance": {
                "python_code": ["df.nlargest(10, 'revenue')"],
                "computed_values": {"rows": "10"},
            },
        }
    )


def test_finalize_chart_mod_emission_preserves_original_chart_id():
    """Structured output uses a different id, but the mention's id must win."""
    state = _make_state()
    # Structured result returns id "chart_1"; the mention targets "chart_ORIG".
    struct = _FakeStructured(return_value=_good_result())
    model = _model("gpt-5.4-mini", struct_by_method={"json_schema": struct})
    state.chart_mentions = [
        {"component_id": "cmp_x", "chart_id": "chart_ORIG", "chart_type": "bar"}
    ]

    dashboard = nodes._finalize_chart_mod_emission(state, model, None, [], "")

    assert dashboard["charts"][0]["id"] == "chart_ORIG"


def test_finalize_chart_mod_emission_preserves_id_in_regex_fallback():
    """When structured output fails, the regex fallback still forces the id."""
    state = _make_state()
    struct_by_method = {
        "json_schema": _FakeStructured(raises=RuntimeError("strict failed")),
        "function_calling": _FakeStructured(raises=RuntimeError("fallback failed")),
    }
    model = _model("gpt-5.4-mini", struct_by_method=struct_by_method)
    state.chart_mentions = [
        {"component_id": "cmp_x", "chart_id": "chart_ORIG", "chart_type": "bar"}
    ]
    content = f"```json\n{json.dumps(_good_chart_dict())}\n```"

    dashboard = nodes._finalize_chart_mod_emission(state, model, None, [], content)

    assert dashboard["charts"][0]["id"] == "chart_ORIG"


def test_finalize_table_edit_emits_table_not_chart_with_preserved_id():
    """A table mention produces tables:[{id,...}] (not a chart), id preserved."""
    state = _make_state()
    struct = _FakeStructured(return_value=_good_table_result())
    model = _model("gpt-5.4-mini", struct_by_method={"json_schema": struct})
    state.chart_mentions = [
        {"component_id": "cmp_t", "chart_id": "table_ORIG", "chart_type": "table"}
    ]

    dashboard = nodes._finalize_chart_mod_emission(state, model, None, [], "")

    assert dashboard["charts"] == []
    assert len(dashboard["tables"]) == 1
    assert dashboard["tables"][0]["id"] == "table_ORIG"
    assert dashboard["tables"][0]["columns"][0]["id"] == "col1"


def test_finalize_table_edit_regex_fallback_preserves_id():
    """Table structured failure falls back to regex and keeps a table shape."""
    state = _make_state()
    struct_by_method = {
        "json_schema": _FakeStructured(raises=RuntimeError("strict failed")),
        "function_calling": _FakeStructured(raises=RuntimeError("fallback failed")),
    }
    model = _model("gpt-5.4-mini", struct_by_method=struct_by_method)
    state.chart_mentions = [
        {"component_id": "cmp_t", "chart_id": "table_ORIG", "chart_type": "table"}
    ]
    content = f"```json\n{json.dumps(_good_table_dict())}\n```"

    dashboard = nodes._finalize_chart_mod_emission(state, model, None, [], content)

    assert dashboard["charts"] == []
    assert dashboard["tables"][0]["id"] == "table_ORIG"


def test_node_synthesis_threads_dashboard_id_into_context():
    """The chart-mod branch must surface the mention's dashboard_id."""
    chart = _chart_with_values([120, 95], labels=["Q1", "Q2"])
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
            "dashboard_id": "dash_TARGET",
            "title": "Quarterly",
            "chart_type": "bar",
            "config": {"chart_type": "bar", "datasets": [{"label": "Series"}]},
        }
    ]
    _add_repl_result(state, "Q1 120\nQ2 95")

    nodes.node_synthesis(state)

    ctx = state.output["chart_modification_context"]
    assert ctx["dashboard_id"] == "dash_TARGET"


def test_node_synthesis_tolerates_missing_dashboard_id():
    """Old payloads without dashboard_id yield None (back-compat)."""
    chart = _chart_with_values([120, 95], labels=["Q1", "Q2"])
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
        {"component_id": "cmp_1", "chart_id": "chart_1", "chart_type": "bar"}
    ]
    _add_repl_result(state, "Q1 120\nQ2 95")

    nodes.node_synthesis(state)

    assert state.output["chart_modification_context"]["dashboard_id"] is None


def test_build_table_mod_instruction_emits_tables_with_columns_and_preserved_id():
    """A table edit instruction names the table columns and asks for a tables[]
    output (not a chart datasets output), preserving the table id."""
    mention = {
        "component_id": "cmp_top_days",
        "chart_id": "table_top_days",
        "chart_type": "table",
        "title": "Top 5 Peak Days",
        "config": {
            "id": "table_top_days",
            "title": "Top 5 Peak Days",
            "description": "Days ranked by sessions",
            "columns": [
                {"id": "day", "label": "Day", "type": "text"},
                {"id": "sessions", "label": "Sessions", "type": "number"},
            ],
            "data": [{"day": "2026-01-01", "sessions": 900}],
        },
    }

    instruction = nodes._build_table_mod_instruction(
        mention, "make it top 10", "CSV file available at: /tmp/ga4.csv"
    )

    assert "MODIFY an existing TABLE" in instruction
    assert '"tables"' in instruction
    assert '"charts": []' in instruction
    # Column labels from the definition are injected.
    assert "Day" in instruction and "Sessions" in instruction
    # The original table id is preserved in the required output.
    assert "Table ID: table_top_days" in instruction
    assert '"id": "table_top_days"' in instruction
    # It must not instruct a chart datasets emission.
    assert '"datasets"' not in instruction
