"""Hermetic tests for the WorkingMemory.rate_limit_hits field.

Regression guard: the 429/rate-limit branches in ``node_reasoning`` and
``node_reasoning_internal`` assign ``state.working_memory.rate_limit_hits``.
Under Pydantic v2 assigning an undeclared field raises, which crashed the
rate-limit handling path. These tests pin the field's existence, default,
increment/reset semantics, and serialization round-trip — no live LLM used.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from morpheus.workflows.analyze_csv.state_models import WorkingMemory


def test_rate_limit_hits_defaults_to_zero():
    assert WorkingMemory().rate_limit_hits == 0


def test_rate_limit_hits_increment_and_reset():
    """Mirrors the assignment sites in the reasoning nodes."""
    wm = WorkingMemory()

    # 429 branch: increment on each hit.
    wm.rate_limit_hits += 1
    wm.rate_limit_hits += 1
    assert wm.rate_limit_hits == 2

    # Non-429 branch: reset to zero.
    wm.rate_limit_hits = 0
    assert wm.rate_limit_hits == 0


def test_rate_limit_hits_round_trips_through_serialization():
    wm = WorkingMemory(rate_limit_hits=3)
    assert WorkingMemory.model_validate(wm.model_dump()).rate_limit_hits == 3
