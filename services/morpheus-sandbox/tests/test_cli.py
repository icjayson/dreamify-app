from __future__ import annotations

import json
from pathlib import Path

from runner.main import main


def test_profile_cli_writes_atomic_bounded_output(
    csv_workspace: tuple[Path, dict],
) -> None:
    root, asset = csv_workspace
    request_directory = root / "requests"
    request_directory.mkdir()
    request_path = request_directory / "profile.json"
    request_path.write_text(
        json.dumps(
            {
                "schema_version": "1",
                "run_id": "run-cli",
                "assets": [asset],
            }
        ),
        encoding="utf-8",
    )

    exit_code = main(
        [
            "profile",
            "--workspace",
            str(root),
            "--request",
            "requests/profile.json",
            "--output",
            "results/profile.json",
        ]
    )

    assert exit_code == 0
    output = json.loads((root / "results" / "profile.json").read_text(encoding="utf-8"))
    assert output["run_id"] == "run-cli"
    assert output["datasets"][0]["row_count"] == 3
