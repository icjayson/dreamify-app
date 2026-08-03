"""Bounded public contracts for the Operator Brief domain."""

import json
from datetime import datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.platform.operator_brief_domain import MAX_CHANGES, MAX_SNAPSHOT_METRICS

MAX_JSON_PAYLOAD_BYTES = 32 * 1024


def _required_text(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("value must not be blank")
    return normalized


def _bounded_json(value: dict[str, Any], field: str) -> dict[str, Any]:
    try:
        encoded = json.dumps(
            value, allow_nan=False, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be JSON serializable") from exc
    if len(encoded) > MAX_JSON_PAYLOAD_BYTES:
        raise ValueError(f"{field} must not exceed {MAX_JSON_PAYLOAD_BYTES} bytes")
    return value


class OperatorBriefCreate(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    provider: str = Field(min_length=1, max_length=80)
    account_name: str = Field(min_length=1, max_length=160)
    metric_snapshot: dict[str, float] = Field(
        default_factory=dict, max_length=MAX_SNAPSHOT_METRICS
    )
    row_count: int | None = Field(default=None, ge=0, le=100_000)
    column_count: int | None = Field(default=None, ge=0, le=200)
    run_id: str | None = Field(default=None, min_length=1, max_length=36)
    source_asset_id: str | None = Field(default=None, min_length=1, max_length=36)
    schedule_id: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("provider", "account_name")
    @classmethod
    def strip_required(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("metric_snapshot")
    @classmethod
    def validate_snapshot(cls, value: dict[str, float]) -> dict[str, float]:
        normalized: dict[str, float] = {}
        for raw_name, number in value.items():
            name = raw_name.strip()
            if not name or len(name) > 120 or name.startswith("__"):
                raise ValueError(
                    "metric names must be 1-120 characters and not start with '__'"
                )
            if name in normalized:
                raise ValueError("metric names must be unique after trimming")
            normalized[name] = number
        return _bounded_json(normalized, "metric_snapshot")

    @model_validator(mode="after")
    def require_snapshot_input(self) -> Self:
        if (
            not self.metric_snapshot
            and self.row_count is None
            and self.column_count is None
        ):
            raise ValueError(
                "metric_snapshot, row_count, or column_count must be provided"
            )
        return self


class OperatorBriefOutcomeUpdate(BaseModel):
    outcome: dict[str, Any]

    @field_validator("outcome")
    @classmethod
    def validate_outcome(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value:
            raise ValueError("outcome must not be empty")
        return _bounded_json(value, "outcome")


class MetricChangeRead(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    metric: str
    previous: float
    current: float
    pct_change: float
    severity: Literal["alert", "warn", "info"]


class OperatorBriefRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, allow_inf_nan=False)

    brief_id: str = Field(validation_alias="id")
    project_id: str
    created_by_id: str | None
    run_id: str | None
    source_asset_id: str | None
    schedule_id: str | None
    provider: str
    account_name: str
    headline: str
    body: str
    severity: Literal["alert", "warn", "info"]
    recommendation: str
    changes: list[MetricChangeRead] = Field(max_length=MAX_CHANGES)
    metric_snapshot: dict[str, float]
    outcome: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
