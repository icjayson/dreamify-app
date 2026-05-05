#!/usr/bin/env python3
"""
Lightweight timestamp policy checker.

Fails if backend code introduces naive datetime constructors.
"""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
CHECK_DIRS = [
    ROOT / "app",
    ROOT / "utils",
]

FORBIDDEN_PATTERNS = [
    re.compile(r"\bdatetime\.now\(\)"),
    re.compile(r"\bdatetime\.utcnow\(\)"),
]

EXCLUDED_FILES = {
    str((ROOT / "app" / "utils" / "timestamp_utils.py").resolve()),
}


def main() -> int:
    violations = []
    for check_dir in CHECK_DIRS:
        if not check_dir.exists():
            continue
        for file_path in check_dir.rglob("*.py"):
            if str(file_path.resolve()) in EXCLUDED_FILES:
                continue
            text = file_path.read_text(encoding="utf-8", errors="ignore")
            for pattern in FORBIDDEN_PATTERNS:
                for match in pattern.finditer(text):
                    line = text.count("\n", 0, match.start()) + 1
                    violations.append(f"{file_path}:{line}: {pattern.pattern}")

    if violations:
        print("Timestamp policy violations found:")
        for violation in violations:
            print(f"  - {violation}")
        return 1

    print("Timestamp policy check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

