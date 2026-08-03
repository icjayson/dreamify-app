"""Database-backed workflow dispatch leases and compare-and-set receipts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta, timezone
from typing import Literal, Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.errors import not_found
from app.platform.models import WorkflowRun, utc_now
from app.platform.services import TERMINAL_RUN_STATUSES
from app.platform.settings import Settings

DispatchOutcome = Literal[
    "authorized", "in_progress", "recorded", "conflict", "invalid"
]


@dataclass(frozen=True)
class DispatchLease:
    outcome: DispatchOutcome
    lease_id: Optional[str]
    workflow_execution_id: Optional[str]

    @property
    def should_dispatch(self) -> bool:
        return self.outcome == "authorized" and self.lease_id is not None


class DispatchCoordinator:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings

    def acquire(self, run_id: str) -> DispatchLease:
        run = self._run(run_id)
        if run.workflow_execution_id or run.status in TERMINAL_RUN_STATUSES:
            return self._result("recorded", run)
        if run.status != "queued":
            return self._result("in_progress", run)
        if self._lease_active(run):
            return self._result("in_progress", run)
        run.dispatch_lease_id = str(uuid4())
        run.dispatch_lease_expires_at = utc_now() + timedelta(
            seconds=self.settings.workflow_dispatch_lease_seconds
        )
        run.dispatch_started_at = None
        run.dispatch_attempts += 1
        self.session.flush()
        return self._result("authorized", run)

    def authorize(self, run_id: str, lease_id: str) -> DispatchLease:
        run = self._run(run_id)
        if run.workflow_execution_id:
            return self._result("recorded", run)
        if run.status != "queued" or not self._lease_matches(run, lease_id):
            return self._result("invalid", run)
        if not self._lease_active(run):
            return self._result("invalid", run)
        if run.dispatch_started_at is not None:
            return self._result("in_progress", run)
        run.dispatch_started_at = utc_now()
        self.session.flush()
        return self._result("authorized", run)

    def record(
        self, run_id: str, lease_id: str, workflow_execution_id: str
    ) -> DispatchLease:
        run = self._run(run_id)
        if run.workflow_execution_id:
            outcome = (
                "recorded"
                if run.workflow_execution_id == workflow_execution_id
                else "conflict"
            )
            return self._result(outcome, run)
        if run.status != "queued" or not self._lease_matches(run, lease_id):
            return self._result("invalid", run)
        run.workflow_execution_id = workflow_execution_id
        run.dispatched_at = run.dispatched_at or utc_now()
        run.dispatch_lease_expires_at = None
        self.session.flush()
        return self._result("recorded", run)

    def release(self, run_id: str, lease_id: str) -> None:
        run = self._run(run_id)
        if (
            run.status == "queued"
            and run.workflow_execution_id is None
            and self._lease_matches(run, lease_id)
        ):
            run.dispatch_lease_id = None
            run.dispatch_lease_expires_at = None
            run.dispatch_started_at = None
            self.session.flush()

    def _run(self, run_id: str) -> WorkflowRun:
        run = self.session.scalar(
            select(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if run is None:
            raise not_found("Workflow run")
        return run

    @staticmethod
    def _lease_matches(run: WorkflowRun, lease_id: str) -> bool:
        return bool(run.dispatch_lease_id and run.dispatch_lease_id == lease_id)

    @staticmethod
    def _lease_active(run: WorkflowRun) -> bool:
        expiration = run.dispatch_lease_expires_at
        if expiration is None:
            return False
        if expiration.tzinfo is None:
            expiration = expiration.replace(tzinfo=timezone.utc)
        return expiration > utc_now()

    @staticmethod
    def _result(outcome: DispatchOutcome, run: WorkflowRun) -> DispatchLease:
        return DispatchLease(outcome, run.dispatch_lease_id, run.workflow_execution_id)
