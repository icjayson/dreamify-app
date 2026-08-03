"""Synchronous boundary for starting the durable Next.js workflow."""

from dataclasses import dataclass
from typing import Optional

import httpx

from app.platform.errors import ApiError, feature_disabled
from app.platform.models import WorkflowRun
from app.platform.observability import correlation_headers
from app.platform.settings import Settings


@dataclass(frozen=True)
class DispatchReceipt:
    workflow_execution_id: Optional[str]


class WorkflowDispatcher:
    def __init__(self, settings: Settings):
        self.settings = settings

    def dispatch(self, run: WorkflowRun, dispatch_lease_id: str) -> DispatchReceipt:
        url = self.settings.workflow_dispatch_url
        secret = self.settings.internal_service_shared_secret
        if not url or not secret:
            raise feature_disabled("workflow dispatch")
        payload = {
            "run_id": run.id,
            "conversation_id": run.conversation_id,
            "project_id": run.project_id,
            "client_request_id": run.client_request_id,
            "dispatch_lease_id": dispatch_lease_id,
        }
        try:
            response = httpx.post(
                url,
                headers={
                    "X-Internal-Service-Secret": secret,
                    "Idempotency-Key": run.id,
                    **correlation_headers(),
                },
                json=payload,
                timeout=self.settings.workflow_dispatch_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise ApiError(
                503,
                "WORKFLOW_DISPATCH_UNAVAILABLE",
                "Workflow dispatch is temporarily unavailable",
            ) from exc
        if not 200 <= response.status_code < 300:
            raise ApiError(
                502,
                "WORKFLOW_DISPATCH_REJECTED",
                "Workflow dispatch rejected the run",
            )
        try:
            response_payload = response.json()
        except ValueError:
            response_payload = {}
        execution_id = response_payload.get("workflow_run_id")
        if execution_id is not None and (
            not isinstance(execution_id, str) or not 0 < len(execution_id) <= 128
        ):
            raise ApiError(
                502,
                "WORKFLOW_DISPATCH_INVALID",
                "Workflow dispatch returned an invalid receipt",
            )
        return DispatchReceipt(workflow_execution_id=execution_id)
