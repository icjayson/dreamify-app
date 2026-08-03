"""Stable API error contract."""

from typing import Any, Dict, Optional


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def not_found(resource: str) -> ApiError:
    return ApiError(404, "NOT_FOUND", f"{resource} was not found")


def feature_disabled(feature: str) -> ApiError:
    return ApiError(
        503,
        "FEATURE_DISABLED",
        f"{feature} is disabled in this deployment",
        {"feature": feature},
    )
