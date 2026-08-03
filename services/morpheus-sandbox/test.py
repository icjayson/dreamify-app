#!/usr/bin/env python3
"""Morpheus validation entry point.

By default this runs deterministic pytest coverage. Use --live only when local
sample data and model credentials are intentionally available.
"""

import argparse
import subprocess
import sys
import warnings
from pathlib import Path

warnings.filterwarnings(
    "ignore",
    message="Core Pydantic V1 functionality isn't compatible with Python 3.14",
    category=UserWarning,
)

ROOT = Path(__file__).resolve().parent
PYTEST_TARGETS = [
    "test_agentic_ask_first.py",
    "test_workflow_routing_order.py",
    "test_theme_focus.py",
    "test_premium_thinking.py",
    "test_server_agentic_workflow_contract.py",
    "test_chart_modification_fixes.py",
    "test_rate_limit_state.py",
    "test_analysis_steps.py",
]
LIVE_SAMPLE = ROOT / "storage" / "in" / "sales_amazon.csv"


def run_pytest() -> int:
    """Run the deterministic Morpheus contract suite."""
    command = [sys.executable, "-m", "pytest", *PYTEST_TARGETS]
    print("Running deterministic Morpheus tests:", flush=True)
    print(" ".join(command), flush=True)
    return subprocess.call(command, cwd=ROOT)


def run_live_workflow() -> int:
    """Run the live workflow smoke test when explicitly requested."""
    if not LIVE_SAMPLE.exists():
        print(f"Missing live sample data: {LIVE_SAMPLE}", file=sys.stderr)
        print(
            "Provide the sample file or run without --live for deterministic tests.",
            file=sys.stderr,
        )
        return 1

    sys.path.insert(0, str(ROOT))

    from morpheus.workflows.analyze_csv.state_graph import StatefulAnalyzeCSVWorkflow
    from utils.logger import logger

    prompt = "Analyze this sales data"
    conversation = {
        "conversation_id": "manual-live-test",
        "user_id": "manual-user",
        "project_id": "manual-project",
        "nodes": [
            {
                "role": "user",
                "contents": [{"type": "text", "data": {"text": prompt}}],
            }
        ],
        "metadata": {"prompt": prompt},
    }

    logger.info("Starting live Morpheus workflow smoke test")
    workflow = StatefulAnalyzeCSVWorkflow()
    result = workflow.execute(
        file_paths=[str(LIVE_SAMPLE)],
        conversation=conversation,
        dashboards={},
        user_prompt=prompt,
    )

    data = result.get("data") or result
    if not isinstance(data, dict):
        print("Live workflow returned an unexpected result shape.", file=sys.stderr)
        return 1

    print("Live workflow completed.")
    print(f"Status: {result.get('status', 'unknown')}")
    print(f"Charts: {len(data.get('charts', []))}")
    print(f"Metrics: {len(data.get('metrics', []))}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Morpheus validation.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Run the live workflow smoke test instead of deterministic pytest.",
    )
    args = parser.parse_args()
    return run_live_workflow() if args.live else run_pytest()


if __name__ == "__main__":
    raise SystemExit(main())
