from __future__ import annotations

from pathlib import Path

from conftest import analysis_request

from runner.executor import execute_analysis


def test_executes_valid_analysis_in_child_process(
    csv_workspace: tuple[Path, dict],
) -> None:
    root, asset = csv_workspace
    request = analysis_request(
        asset,
        "frame = next(iter(datasets.values()))\n"
        "totals = frame.groupby('region')['revenue'].sum()\n"
        "result = {'totals': totals.to_dict(), 'rows': len(frame)}",
    )
    result = execute_analysis(request, root, timeout_seconds=5)
    assert result["ok"] is True
    assert result["result"] == {
        "totals": {"North": 1900, "South": 1200},
        "rows": 3,
    }


def test_terminates_cpu_bound_analysis(csv_workspace: tuple[Path, dict]) -> None:
    root, asset = csv_workspace
    request = analysis_request(
        asset,
        "total = 0\n"
        "for index in range(10 ** 12):\n"
        "    total += index\n"
        "result = {'total': total}",
    )
    result = execute_analysis(request, root, timeout_seconds=0.2)
    assert result["ok"] is False
    assert result["error"]["code"] == "ANALYSIS_TIMEOUT"


def test_caps_generated_stdout(csv_workspace: tuple[Path, dict]) -> None:
    root, asset = csv_workspace
    request = analysis_request(
        asset,
        "for index in range(100000):\n    print('x' * 100)\nresult = {'done': True}",
    )
    result = execute_analysis(request, root, timeout_seconds=5)
    assert result["ok"] is False
    assert result["error"]["code"] == "OUTPUT_LIMIT_EXCEEDED"


def test_caps_result_item_count(csv_workspace: tuple[Path, dict]) -> None:
    root, asset = csv_workspace
    request = analysis_request(asset, "result = {'values': [0] * 60000}")
    result = execute_analysis(request, root, timeout_seconds=5)
    assert result["ok"] is False
    assert result["error"]["code"] == "RESULT_TOO_LARGE"
