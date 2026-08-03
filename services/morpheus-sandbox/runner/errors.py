"""Sanitized errors returned across the Sandbox boundary."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RunnerError(Exception):
    code: str
    message: str
    retryable: bool = False

    def __post_init__(self) -> None:
        self.message = str(self.message).replace("\x00", "")[:1000]
        Exception.__init__(self, self.message)

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
