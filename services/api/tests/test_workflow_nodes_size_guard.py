"""Activity transparency: the workflow-status size guard keeps oversized
analysis_steps from making DynamoDB reject the whole status/event write."""

import json
from unittest.mock import patch

from utils.dynamodb.repos import workflow_nodes


class _FakeTable:
    def __init__(self):
        self.put_items = []

    def put_item(self, Item):
        self.put_items.append(Item)
        return {}


def _big_analysis_steps(num_steps: int, chars: int):
    blob = "x" * chars
    return [
        {
            "index": i,
            "title": f"Step {i}",
            "python": blob,
            "output": blob,
            "explanation": "explained",
        }
        for i in range(num_steps)
    ]


def test_upsert_node_status_truncates_oversized_metadata():
    table = _FakeTable()
    metadata = {
        "change_summary": {"human_summary": "kept"},
        "analysis_steps": _big_analysis_steps(num_steps=20, chars=50_000),
    }
    assert (
        len(json.dumps(metadata).encode("utf-8"))
        > workflow_nodes._METADATA_SIZE_LIMIT_BYTES
    )

    with patch.object(workflow_nodes, "get_table", return_value=table):
        item = workflow_nodes.upsert_node_status(
            "c1", "workflow", "completed", metadata
        )

    assert len(table.put_items) == 1
    written = table.put_items[0]["metadata"]
    serialized = len(json.dumps(written).encode("utf-8"))
    assert serialized <= workflow_nodes._METADATA_SIZE_LIMIT_BYTES
    # Unrelated metadata is preserved; the trail is trimmed/dropped, not nuked.
    assert written["change_summary"]["human_summary"] == "kept"
    assert item is table.put_items[0]


def test_guard_drops_analysis_steps_as_last_resort():
    # Many small steps whose count alone blows the budget after field trimming.
    metadata = {"analysis_steps": _big_analysis_steps(num_steps=400, chars=1_900)}
    guarded = workflow_nodes._guard_metadata_size(metadata)
    serialized = len(json.dumps(guarded).encode("utf-8"))
    assert serialized <= workflow_nodes._METADATA_SIZE_LIMIT_BYTES


def test_guard_leaves_small_metadata_untouched():
    metadata = {"analysis_steps": _big_analysis_steps(num_steps=2, chars=100)}
    before = json.dumps(metadata)
    guarded = workflow_nodes._guard_metadata_size(metadata)
    assert json.dumps(guarded) == before


def test_append_workflow_event_applies_guard():
    table = _FakeTable()
    event = {
        "title": "Sum revenue",
        "metadata": {
            "python": "y" * 60_000,
            "output": "z" * 60_000,
            "step_index": 1,
        },
        "analysis_steps": _big_analysis_steps(num_steps=20, chars=50_000),
    }
    with patch.object(workflow_nodes, "get_table", return_value=table):
        workflow_nodes.append_workflow_event("c1", "run1", 3, event)

    assert len(table.put_items) == 1
    written = table.put_items[0]["metadata"]
    serialized = len(json.dumps(written).encode("utf-8"))
    assert serialized <= workflow_nodes._METADATA_SIZE_LIMIT_BYTES
