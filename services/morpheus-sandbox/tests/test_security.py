from __future__ import annotations

import pytest

from runner.errors import RunnerError
from runner.security import validate_analysis_code


@pytest.mark.parametrize(
    "source",
    [
        "import os\nresult = {}",
        "from pathlib import Path\nresult = {}",
        "result = open('/etc/passwd').read()",
        "result = eval('1 + 1')",
        "result = datasets.__class__.__mro__",
        "result = pd.read_csv('https://example.com/data.csv')",
        "result = {'environment': pd.io.common.os.environ}",
        "datasets['sales.csv'].to_pickle('/tmp/stolen.pkl')\nresult = {}",
        "datasets['sales.csv'].to_clipboard()\nresult = {}",
        "while True:\n    pass\nresult = {}",
        "def escape():\n    return 1\nresult = {}",
    ],
)
def test_rejects_escape_and_io_primitives(source: str) -> None:
    with pytest.raises(RunnerError) as captured:
        validate_analysis_code(source)
    assert captured.value.code == "SECURITY_VIOLATION"


def test_requires_explicit_result_assignment() -> None:
    with pytest.raises(RunnerError) as captured:
        validate_analysis_code("value = 1 + 1")
    assert captured.value.code == "RESULT_MISSING"


def test_accepts_bounded_dataframe_analysis() -> None:
    validated = validate_analysis_code(
        "frame = next(iter(datasets.values()))\n"
        "totals = frame.groupby('region')['revenue'].sum()\n"
        "result = {'totals': totals.to_dict()}"
    )
    assert validated.tree is not None
