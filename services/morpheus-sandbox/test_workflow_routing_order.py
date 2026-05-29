"""
Deterministic tests for the route-before-profile ordering and the
single-worker async persistence introduced in the analyze_csv workflow.

No live LLM is used: edge logic is pure, the EXPLORE_FILES route gate is driven
with a MagicMock model + real temp CSVs, and persistence is exercised with
in-memory fakes for load_fn/persist_fn.
"""

import os
import tempfile
import threading
import time
from unittest.mock import MagicMock

from morpheus.workflows.analyze_csv.edges import decide_next_node
from morpheus.workflows.analyze_csv import nodes
from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    UserState,
    WorkingMemory,
    WorkflowHistory,
)


def _make_state(current_node, **overrides):
    kwargs = dict(
        user_state=UserState(
            user_id="user_1",
            project_id="project_1",
            conversation_id="conversation_1",
            conversation_history=[],
            user_assets=[],
            dashboards={},
        ),
        working_memory=WorkingMemory(),
        workflow_history=WorkflowHistory(),
        current_node=current_node,
        input_prompt="analyze performance",
        conversation_id="conversation_1",
        project_id="project_1",
    )
    kwargs.update(overrides)
    return AgentState(**kwargs)


# --------------------------------------------------------------------------- #
# 1. Edge transitions for the new route-before-profile order
# --------------------------------------------------------------------------- #


def test_start_transitions_to_ask_first():
    state = _make_state("START")
    assert decide_next_node(state) == "ASK_FIRST"


def test_start_early_exit_still_finishes():
    state = _make_state("START")
    state.working_memory.tool_outputs["early_exit_empty_data"] = True
    assert decide_next_node(state) == "FINISH"


def test_ask_first_clarification_finishes():
    state = _make_state("ASK_FIRST")
    state.output = {"type": "clarification_request", "clarification": {}}
    assert decide_next_node(state) == "FINISH"


def test_ask_first_without_clarification_routes():
    state = _make_state("ASK_FIRST")
    state.output = None
    assert decide_next_node(state) == "ROUTING"


def test_routing_transitions_to_explore_files():
    state = _make_state("ROUTING")
    assert decide_next_node(state) == "EXPLORE_FILES"


def test_explore_files_chooses_internal_reasoning():
    state = _make_state("EXPLORE_FILES", use_internal_reasoning=True)
    assert decide_next_node(state) == "REASONING_INTERNAL"


def test_explore_files_chooses_split_reasoning():
    state = _make_state("EXPLORE_FILES", use_internal_reasoning=False)
    assert decide_next_node(state) == "REASONING"


# --------------------------------------------------------------------------- #
# 2. EXPLORE_FILES route gate (deterministic vs LLM merge loop)
# --------------------------------------------------------------------------- #


def _write_csv(directory, name, header, rows):
    path = os.path.join(directory, name)
    with open(path, "w") as fh:
        fh.write(header + "\n")
        for row in rows:
            fh.write(row + "\n")
    return path


def _two_file_state(tmpdir, route):
    a = _write_csv(
        tmpdir,
        "visits.csv",
        "date,visits",
        ["2026-01-01,10", "2026-01-02,20", "2026-01-03,30"],
    )
    b = _write_csv(
        tmpdir,
        "revenue.csv",
        "date,revenue",
        ["2026-01-01,100", "2026-01-02,200", "2026-01-03,300"],
    )
    assets = {"visits.csv": a, "revenue.csv": b}
    state = _make_state(
        "EXPLORE_FILES",
        file_paths=[a, b],
        assets_dict=assets,
    )
    if route is not None:
        state.working_memory.tool_outputs["route_decision"] = {"next_step": route}
    return state


def test_qa_route_uses_deterministic_profile_no_llm():
    with tempfile.TemporaryDirectory() as tmpdir:
        state = _two_file_state(tmpdir, route="qa")
        model = MagicMock()

        result = nodes.node_explore_files(state, model=model)

        assert result.data_profile
        assert "visits.csv" in result.data_profile
        assert "revenue.csv" in result.data_profile
        # No LLM merge loop for the pure-text route.
        model.bind_tools.assert_not_called()
        model.invoke.assert_not_called()


def test_dashboard_route_runs_llm_merge_loop():
    with tempfile.TemporaryDirectory() as tmpdir:
        state = _two_file_state(tmpdir, route="dashboard")

        # Turn 1: model runs one Python_REPL tool call. Turn 2: it returns a
        # final summary with no tool calls, which ends the merge loop.
        tool_response = MagicMock()
        tool_response.tool_calls = [
            {"name": "Python_REPL", "args": {"query": "print('ok')"}, "id": "call_1"}
        ]
        tool_response.content = ""
        final_response = MagicMock()
        final_response.tool_calls = []
        final_response.content = (
            "Profiled both files.\n=== MERGE STRATEGY ===\njoin on date"
        )
        bound = MagicMock()
        bound.invoke.side_effect = [tool_response, final_response]
        model = MagicMock()
        model.bind_tools.return_value = bound

        result = nodes.node_explore_files(state, model=model)

        # The multi-file LLM branch must have been taken (not the deterministic path).
        model.bind_tools.assert_called_once()
        assert bound.invoke.call_count == 2
        assert "MERGE STRATEGY" in (result.data_profile or "")


def test_single_file_uses_deterministic_profile_regardless_of_route():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = _write_csv(
            tmpdir,
            "solo.csv",
            "date,value",
            ["2026-01-01,1", "2026-01-02,2", "2026-01-03,3"],
        )
        state = _make_state(
            "EXPLORE_FILES",
            file_paths=[path],
            assets_dict={"solo.csv": path},
        )
        # Even a dashboard route stays deterministic for a single file.
        state.working_memory.tool_outputs["route_decision"] = {"next_step": "dashboard"}
        model = MagicMock()

        result = nodes.node_explore_files(state, model=model)

        assert "solo.csv" in result.data_profile
        model.bind_tools.assert_not_called()
        model.invoke.assert_not_called()


# --------------------------------------------------------------------------- #
# 3. Async persistence ordering (single-worker executor)
# --------------------------------------------------------------------------- #


def _make_workflow():
    """Build a workflow instance without running its heavy __init__."""
    from morpheus.workflows.analyze_csv.state_graph import StatefulAnalyzeCSVWorkflow

    wf = StatefulAnalyzeCSVWorkflow.__new__(StatefulAnalyzeCSVWorkflow)
    wf._last_synced_index = 0
    wf._sync_executor = None
    return wf


def test_async_persistence_preserves_order_and_flushes():
    from concurrent.futures import ThreadPoolExecutor

    wf = _make_workflow()

    persisted = {"conversation": {"nodes": []}}
    call_order = []
    lock = threading.Lock()

    def load_fn(uri):
        with lock:
            call_order.append(("load", uri))
        # Simulate network latency so out-of-order writes would be observable.
        time.sleep(0.01)
        # Return a deep-ish copy so the worker mutates its own snapshot.
        return {"nodes": list(persisted["conversation"]["nodes"])}

    def persist_fn(uri, backup_uri, conversation):
        with lock:
            call_order.append(("persist", len(conversation["nodes"])))
        persisted["conversation"] = conversation

    wf._sync_executor = ThreadPoolExecutor(max_workers=1)

    # Submit three persistence rounds, one node each, back to back.
    for i in range(3):
        node = {"node_id": f"node_{i}", "role": "system"}
        wf._submit_sync(
            lambda u="s3://conv", b=None, n=[node]: wf._persist_nodes(
                u, b, n, persist_fn, load_fn, i
            )
        )

    wf._sync_executor.shutdown(wait=True)

    # All three nodes landed, in submission order, with no clobbering.
    assert [n["node_id"] for n in persisted["conversation"]["nodes"]] == [
        "node_0",
        "node_1",
        "node_2",
    ]
    # Writes were serialized: each persist saw one more node than the last.
    persist_counts = [c for kind, c in call_order if kind == "persist"]
    assert persist_counts == [1, 2, 3]


def test_async_persistence_exception_does_not_propagate():
    from concurrent.futures import ThreadPoolExecutor

    wf = _make_workflow()
    wf._sync_executor = ThreadPoolExecutor(max_workers=1)

    def load_fn(uri):
        return {"nodes": []}

    def persist_fn(uri, backup_uri, conversation):
        raise RuntimeError("S3 down")

    # Should not raise — _persist_nodes swallows persistence errors.
    wf._submit_sync(
        lambda: wf._persist_nodes(
            "s3://conv", None, [{"node_id": "n"}], persist_fn, load_fn, 0
        )
    )
    wf._sync_executor.shutdown(wait=True)


def test_sync_intermediate_state_enqueues_and_advances_tracker():
    from concurrent.futures import ThreadPoolExecutor
    from morpheus.workflows.analyze_csv.state_models import WorkflowHistoryEntry

    wf = _make_workflow()
    wf._sync_executor = ThreadPoolExecutor(max_workers=1)

    persisted = {"nodes": []}

    def load_fn(uri):
        return {"nodes": list(persisted["nodes"])}

    def persist_fn(uri, backup_uri, conversation):
        persisted["nodes"] = conversation["nodes"]

    state = _make_state("ROUTING")
    state.conversation_uri = "s3://conv"
    state.conversation_backup_uri = None
    state.working_memory.tool_outputs["route_decision"] = {"next_step": "qa"}
    from datetime import datetime

    state.workflow_history.entries.append(
        WorkflowHistoryEntry(
            timestamp=datetime.now(),
            from_state="ROUTING",
            to_state="EXPLORE_FILES",
            action="transition",
            action_input={},
            duration_ms=1.0,
            success=True,
        )
    )

    wf._sync_intermediate_state(state, persist_fn, load_fn, post_status_fn=None)

    # Tracker advanced synchronously (main thread) regardless of worker timing.
    assert wf._last_synced_index == 1

    wf._sync_executor.shutdown(wait=True)
    # The ROUTING entry produced one routing-decision node.
    assert len(persisted["nodes"]) == 1
    assert persisted["nodes"][0]["metadata"]["type"] == "routing_decision"
