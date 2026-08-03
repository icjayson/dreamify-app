from datetime import datetime, timezone
import re
from typing import Any


_OFFSET_RE = re.compile(r"[+-]\d{2}:\d{2}$")
_DATETIME_LIKE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}")
_TIMESTAMP_KEY_RE = re.compile(r"(timestamp|_at$|At$)", re.IGNORECASE)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_valid_timestamp(value: str) -> bool:
    if not isinstance(value, str) or not value:
        return False
    if not (value.endswith("Z") or _OFFSET_RE.search(value)):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def parse_timestamp_to_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include timezone offset or Z suffix")
    return parsed.astimezone(timezone.utc)


def validate_timestamp_fields(payload: Any, path: str = "body") -> None:
    """
    Recursively validate timestamp-like fields in request payloads.
    Only checks keys that look timestamp-related to avoid false positives.
    """
    if isinstance(payload, dict):
        for key, value in payload.items():
            current_path = f"{path}.{key}"
            if isinstance(value, str) and _TIMESTAMP_KEY_RE.search(key) and _DATETIME_LIKE_RE.match(value):
                if not is_valid_timestamp(value):
                    raise ValueError(
                        f"Invalid timestamp at '{current_path}'. "
                        "Timestamp must include timezone info (Z or +HH:MM)."
                    )
            validate_timestamp_fields(value, current_path)
    elif isinstance(payload, list):
        for idx, item in enumerate(payload):
            validate_timestamp_fields(item, f"{path}[{idx}]")

