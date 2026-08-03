"""Transactional persistence adapters for the durable workflow runtime."""

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.platform.database import ensure_database_write_capacity
from app.platform.edit_targets import require_target_components
from app.platform.errors import ApiError, not_found
from app.platform.models import (
    Asset,
    Conversation,
    Dashboard,
    StoredObject,
    WorkflowArtifact,
    WorkflowEvent,
    WorkflowProviderCall,
    WorkflowRun,
    WorkflowRunAsset,
    WorkflowSlot,
    WorkflowStepJournal,
    new_id,
    utc_now,
)
from app.platform.repositories import (
    WRITE_PROJECT_ROLES,
    AssetRepository,
    DashboardRepository,
    UploadRepository,
)
from app.platform.schemas import (
    ConversationEditTarget,
    InternalWorkflowCancelRequest,
    NewThinkingEvent,
    WorkflowArtifactCreate,
    WorkflowCapacityAcquireRequest,
    WorkflowCapacityReleaseRequest,
    WorkflowClaimRequest,
    WorkflowProviderCallReserveRequest,
    WorkflowResponseCommitRequest,
    WorkflowStepBeginRequest,
    WorkflowStepCompleteRequest,
    WorkflowTransitionRequest,
)
from app.platform.services import TERMINAL_RUN_STATUSES, validate_dashboard_content
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage

RUN_TRANSITIONS = {
    "queued": {"running", "cancelling", "cancelled", "failed"},
    "running": {
        "running",
        "awaiting_user_input",
        "completed",
        "failed",
        "cancelling",
        "cancelled",
    },
    "awaiting_user_input": set(),
    "completed": set(),
    "failed": set(),
    "cancelling": {"cancelling", "cancelled", "failed"},
    "cancelled": set(),
}


def _utc_datetime(value: Optional[datetime]) -> Optional[datetime]:
    """Restore UTC lost by SQLite while keeping the wire contract timezone-aware."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def serialize_run(run: WorkflowRun) -> Dict[str, Any]:
    if not run.conversation_id:
        raise ApiError(409, "RUN_CONTEXT_MISSING", "Run conversation is missing")
    return {
        "run_id": run.id,
        "conversation_id": run.conversation_id,
        "project_id": run.project_id,
        "owner_id": run.owner_id,
        "parent_run_id": run.parent_run_id,
        "workflow_run_id": run.workflow_execution_id,
        "status": run.status,
        "current_step": run.current_step,
        "response_type": run.response_type,
        "cancel_requested": run.cancel_requested,
        "cancel_reason": run.cancel_reason,
        "version": run.version,
        "result": run.result,
        "error": run.error,
        "created_at": _utc_datetime(run.created_at),
        "updated_at": _utc_datetime(run.updated_at),
        "started_at": _utc_datetime(run.started_at),
        "completed_at": _utc_datetime(run.completed_at),
    }


def _json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ApiError(422, "INVALID_JSON", "Value must be finite JSON") from exc


class InternalWorkflowService:
    def __init__(
        self,
        session: Session,
        settings: Settings,
        storage: ObjectStorage,
    ) -> None:
        self.session = session
        self.settings = settings
        self.storage = storage

    def get_run(self, run_id: str, for_update: bool = False) -> WorkflowRun:
        query = select(WorkflowRun).where(WorkflowRun.id == run_id)
        if for_update:
            query = query.with_for_update()
        run = self.session.scalar(query)
        if run is None:
            raise not_found("Workflow run")
        return run

    def claim(
        self, run_id: str, request: WorkflowClaimRequest
    ) -> Tuple[str, WorkflowRun]:
        run = self.get_run(run_id, for_update=True)
        if run.status in TERMINAL_RUN_STATUSES:
            return "terminal", run
        if run.status in {"running", "cancelling"}:
            if run.status == "cancelling" and run.workflow_execution_id is None:
                run.workflow_execution_id = request.workflow_execution_id
                self.session.flush()
            outcome = (
                "resume"
                if run.workflow_execution_id == request.workflow_execution_id
                else "busy"
            )
            return outcome, run
        if run.status != "queued":
            return "busy", run
        if (
            run.workflow_execution_id is not None
            and run.workflow_execution_id != request.workflow_execution_id
        ):
            return "busy", run
        if not self._is_active_run(run):
            self._mark_superseded(run)
            return "terminal", run
        run.workflow_execution_id = (
            run.workflow_execution_id or request.workflow_execution_id
        )
        run.dispatched_at = run.dispatched_at or utc_now()
        run.status = "running"
        run.started_at = run.started_at or utc_now()
        run.version += 1
        self._append_event(run, request.event)
        self.session.flush()
        return "claimed", run

    def reserve_provider_call(
        self, run_id: str, request: WorkflowProviderCallReserveRequest
    ) -> Dict[str, Any]:
        run = self.get_run(run_id, for_update=True)
        self._require_running(run)
        existing = self.session.scalar(
            select(WorkflowProviderCall).where(
                WorkflowProviderCall.run_id == run.id,
                WorkflowProviderCall.call_key == request.call_key,
            )
        )
        if existing is not None:
            return self._provider_call_result(run, existing, created=False)
        if run.provider_call_count >= self.settings.workflow_max_provider_calls:
            raise ApiError(
                429,
                "PROVIDER_CALL_BUDGET_EXCEEDED",
                "Workflow provider call budget is exhausted",
            )
        run.provider_call_count += 1
        call = WorkflowProviderCall(
            run_id=run.id,
            call_key=request.call_key,
            ordinal=run.provider_call_count,
        )
        self.session.add(call)
        self.session.flush()
        return self._provider_call_result(run, call, created=True)

    def _provider_call_result(
        self, run: WorkflowRun, call: WorkflowProviderCall, *, created: bool
    ) -> Dict[str, Any]:
        return {
            "call_key": call.call_key,
            "ordinal": call.ordinal,
            "remaining": self.settings.workflow_max_provider_calls
            - run.provider_call_count,
            "created": created,
        }

    def context(self, run_id: str) -> Dict[str, Any]:
        run = self.get_run(run_id)
        if not run.conversation_id:
            raise ApiError(409, "RUN_CONTEXT_MISSING", "Run conversation is missing")
        assets = self._context_assets(run)
        total_bytes = sum(asset["size_bytes"] for asset in assets)
        if total_bytes > self.settings.workflow_max_aggregate_asset_bytes:
            raise ApiError(413, "ASSET_SET_TOO_LARGE", "Workflow assets exceed 25 MiB")
        chat = run.input.get("chat_request") or {}
        dashboard = self._existing_dashboard(run)
        edit_target = self._edit_target(run)
        return {
            "run_id": run.id,
            "conversation_id": run.conversation_id,
            "project_id": run.project_id,
            "owner_id": run.owner_id,
            "prompt": run.input.get("prompt") or "Analyze the selected data",
            "assets": assets,
            "theme_id": chat.get("theme_id") or "default",
            "focus_id": chat.get("analysis_focus_id"),
            "existing_dashboard": dashboard.content if dashboard else None,
            "edit_target": edit_target.model_dump(mode="json") if edit_target else None,
            "conversation_revision_object_id": run.request_fingerprint or run.id,
        }

    def begin_step(
        self, run_id: str, step_key: str, request: WorkflowStepBeginRequest
    ) -> None:
        run = self.get_run(run_id, for_update=True)
        self._require_running(run)
        journal = self._step(run.id, step_key, for_update=True)
        if journal and journal.step != request.step:
            raise ApiError(409, "IDEMPOTENCY_CONFLICT", "Step key has a different step")
        if journal is not None:
            self._append_event(run, request.event)
            return
        if journal is None:
            journal = WorkflowStepJournal(
                run_id=run.id, step_key=step_key, step=request.step, status="running"
            )
            self.session.add(journal)
        run.current_step = request.step
        run.version += 1
        self._append_event(run, request.event)
        self.session.flush()

    def step_result(self, run_id: str, step_key: str) -> Dict[str, Any]:
        self.get_run(run_id)
        journal = self._step(run_id, step_key)
        if journal is None or journal.status != "completed":
            return {"found": False, "value": None}
        return {"found": True, "value": journal.result}

    def complete_step(
        self, run_id: str, step_key: str, request: WorkflowStepCompleteRequest
    ) -> None:
        run = self.get_run(run_id, for_update=True)
        self._require_running(run)
        journal = self._step(run.id, step_key, for_update=True)
        if journal is None:
            raise ApiError(409, "STEP_NOT_STARTED", "Workflow step was not started")
        serialized = _json_bytes(request.result)
        if len(serialized) > self.settings.workflow_artifact_max_bytes:
            raise ApiError(413, "STEP_RESULT_TOO_LARGE", "Step result exceeds 1 MiB")
        digest = hashlib.sha256(serialized).hexdigest()
        if journal.status == "completed":
            if journal.result_sha256 != digest:
                raise ApiError(
                    409, "IDEMPOTENCY_CONFLICT", "Step key has a different result"
                )
            return
        journal.result = request.result
        journal.result_sha256 = digest
        journal.status = "completed"
        run.version += 1
        self._append_event(run, request.event)
        self.session.flush()

    def transition(
        self, run_id: str, request: WorkflowTransitionRequest
    ) -> WorkflowRun:
        run = self.get_run(run_id, for_update=True)
        if run.status not in request.allowed_from:
            if (
                run.status == request.status
                and run.current_step == request.current_step
            ):
                self._append_event(run, request.event)
                return run
            raise ApiError(409, "RUN_STATE_CONFLICT", "Run state changed")
        if request.status not in RUN_TRANSITIONS.get(run.status, set()):
            raise ApiError(409, "RUN_TRANSITION_INVALID", "Run transition is invalid")
        run.status = request.status
        run.current_step = request.current_step
        if request.response_type is not None:
            run.response_type = request.response_type
        if request.error is not None:
            run.error = request.error
        if request.status in TERMINAL_RUN_STATUSES:
            run.completed_at = utc_now()
            self._clear_active_run(run)
        run.version += 1
        self._append_event(run, request.event)
        self.session.flush()
        return run

    def commit_response(
        self, run_id: str, request: WorkflowResponseCommitRequest
    ) -> WorkflowRun:
        run = self.get_run(run_id, for_update=True)
        if run.status in TERMINAL_RUN_STATUSES:
            return self._existing_response(run, request)
        self._require_running(run)
        if run.cancel_requested or not self._is_active_run(run):
            raise ApiError(409, "RUN_SUPERSEDED", "Run cannot persist a response")
        self._validate_response_artifact(run.id, request.response_artifact)
        self._validate_response_payload(request)
        dashboard_id = self._materialize_dashboard(run, request)
        result_reference = dict(request.result_reference)
        if dashboard_id is not None:
            result_reference["dashboard_id"] = dashboard_id
        run.status = request.terminal_status
        run.current_step = (
            "done" if request.terminal_status == "completed" else "clarification"
        )
        run.response_type = request.response.get("type")
        run.output = request.response
        run.response_artifact = request.response_artifact
        run.result = result_reference
        run.error = None
        run.completed_at = utc_now()
        run.version += 1
        self._clear_active_run(run)
        self._append_event(run, request.event)
        self.session.flush()
        return run

    def response(self, run_id: str) -> Optional[Dict[str, Any]]:
        return self.get_run(run_id).output

    def request_cancellation(
        self, run_id: str, request: InternalWorkflowCancelRequest
    ) -> WorkflowRun:
        run = self.get_run(run_id, for_update=True)
        if run.status in TERMINAL_RUN_STATUSES:
            return run
        if run.status not in {"queued", "running", "cancelling"}:
            raise ApiError(409, "RUN_STATE_CONFLICT", "Run cannot be cancelled")
        if (
            run.status == "cancelling"
            and run.cancel_requested
            and run.cancel_reason == request.reason
        ):
            return run
        run.status = "cancelling"
        run.cancel_requested = True
        run.cancel_reason = request.reason
        run.version += 1
        self._clear_active_run(run)
        self.session.flush()
        return run

    def put_artifact(
        self, run_id: str, request: WorkflowArtifactCreate
    ) -> WorkflowArtifact:
        run = self.get_run(run_id, for_update=True)
        content = _json_bytes(request.value)
        self._validate_artifact_size(content, request.max_bytes)
        digest = hashlib.sha256(content).hexdigest()
        current = self._artifact_by_key(run.id, request.idempotency_key)
        if current:
            self._validate_existing_artifact(current, request.kind, digest)
            return current
        ensure_database_write_capacity(self.session, self.settings)
        self._check_artifact_quota(run.owner_id, len(content))
        pathname = self._artifact_path(run, request.kind, digest)
        metadata = self.storage.put_bytes(pathname, content, "application/json")
        stored = StoredObject(
            owner_id=run.owner_id,
            backend=self.storage.backend,
            pathname=metadata.pathname,
            url=metadata.url,
            content_type="application/json",
            size_bytes=len(content),
            checksum_sha256=digest,
            etag=metadata.etag,
        )
        self.session.add(stored)
        self.session.flush()
        artifact = WorkflowArtifact(
            owner_id=run.owner_id,
            run_id=run.id,
            stored_object_id=stored.id,
            idempotency_key=request.idempotency_key,
            kind=request.kind,
            size_bytes=len(content),
            checksum_sha256=digest,
        )
        self.session.add(artifact)
        self.session.flush()
        return artifact

    def get_artifact(self, run_id: str, object_id: str) -> Any:
        self.get_run(run_id)
        query = (
            select(WorkflowArtifact, StoredObject)
            .join(StoredObject, StoredObject.id == WorkflowArtifact.stored_object_id)
            .where(
                WorkflowArtifact.run_id == run_id,
                WorkflowArtifact.stored_object_id == object_id,
            )
        )
        record = self.session.execute(query).one_or_none()
        if record is None:
            raise not_found("Workflow artifact")
        artifact, stored = record
        content = self.storage.get_bytes(stored.pathname)
        if len(content) != artifact.size_bytes:
            raise ApiError(409, "ARTIFACT_SIZE_MISMATCH", "Artifact size changed")
        if hashlib.sha256(content).hexdigest() != artifact.checksum_sha256:
            raise ApiError(
                409, "ARTIFACT_CHECKSUM_MISMATCH", "Artifact checksum changed"
            )
        return json.loads(content)

    def acquire_capacity(
        self, request: WorkflowCapacityAcquireRequest
    ) -> Dict[str, Any]:
        run = self.get_run(request.run_id, for_update=True)
        self._require_running(run)
        now = utc_now()
        self._expire_slots(now)
        existing = self.session.scalar(
            select(WorkflowSlot).where(WorkflowSlot.run_id == run.id).with_for_update()
        )
        if existing:
            if existing.idempotency_key != request.idempotency_key:
                raise ApiError(
                    409, "IDEMPOTENCY_CONFLICT", "Run already owns a capacity lease"
                )
            return self._lease(existing)
        slot = self.session.scalar(
            select(WorkflowSlot)
            .where(WorkflowSlot.run_id.is_(None))
            .order_by(WorkflowSlot.slot_number)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if slot is None:
            raise ApiError(409, "CAPACITY_UNAVAILABLE", "No workflow slot is available")
        slot.run_id = run.id
        slot.lease_id = new_id()
        slot.idempotency_key = request.idempotency_key
        slot.acquired_at = now
        slot.lease_expires_at = now + timedelta(
            seconds=self.settings.workflow_slot_lease_seconds
        )
        self.session.flush()
        return self._lease(slot)

    def release_capacity(self, request: WorkflowCapacityReleaseRequest) -> None:
        slot = self.session.scalar(
            select(WorkflowSlot)
            .where(WorkflowSlot.lease_id == request.lease.lease_id)
            .with_for_update()
        )
        if slot is None:
            return
        if (
            slot.run_id != request.lease.run_id
            or slot.idempotency_key != request.idempotency_key
        ):
            raise ApiError(409, "LEASE_CONFLICT", "Capacity lease does not match")
        self._clear_slot(slot)
        self.session.flush()

    def _append_event(self, run: WorkflowRun, event: NewThinkingEvent) -> WorkflowEvent:
        if event.run_id != run.id:
            raise ApiError(409, "EVENT_RUN_MISMATCH", "Event run does not match path")
        payload = event.model_dump(mode="json")
        payload.pop("run_id", None)
        payload.pop("event_key", None)
        if len(_json_bytes(payload)) > self.settings.workflow_event_max_bytes:
            raise ApiError(413, "EVENT_TOO_LARGE", "Workflow event exceeds 32 KiB")
        current = self.session.scalar(
            select(WorkflowEvent).where(
                WorkflowEvent.run_id == run.id,
                WorkflowEvent.event_key == event.event_key,
            )
        )
        if current:
            if current.event_type != event.phase or self._semantic_event_payload(
                current.payload
            ) != self._semantic_event_payload(payload):
                raise ApiError(
                    409, "IDEMPOTENCY_CONFLICT", "Event key has different input"
                )
            return current
        count = self.session.scalar(
            select(func.count())
            .select_from(WorkflowEvent)
            .where(WorkflowEvent.run_id == run.id)
        )
        if int(count or 0) >= self.settings.workflow_max_events_per_run:
            raise ApiError(413, "EVENT_LIMIT_EXCEEDED", "Workflow event limit reached")
        sequence = (
            int(
                self.session.scalar(
                    select(func.coalesce(func.max(WorkflowEvent.sequence), 0)).where(
                        WorkflowEvent.run_id == run.id
                    )
                )
                or 0
            )
            + 1
        )
        stored = WorkflowEvent(
            owner_id=run.owner_id,
            run_id=run.id,
            sequence=sequence,
            event_key=event.event_key,
            event_type=event.phase,
            payload=payload,
        )
        self.session.add(stored)
        self.session.flush()
        return stored

    @staticmethod
    def _semantic_event_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        comparable = dict(payload)
        for transient_field in ("started_at", "completed_at", "duration_ms"):
            comparable.pop(transient_field, None)
        return comparable

    def _context_assets(self, run: WorkflowRun) -> list[Dict[str, Any]]:
        query = (
            select(Asset, StoredObject)
            .join(WorkflowRunAsset, WorkflowRunAsset.asset_id == Asset.id)
            .join(StoredObject, StoredObject.id == Asset.stored_object_id)
            .where(
                WorkflowRunAsset.run_id == run.id,
                Asset.project_id == run.project_id,
                Asset.status == "ready",
            )
            .order_by(WorkflowRunAsset.created_at)
        )
        return [
            self._context_asset(asset, stored)
            for asset, stored in self.session.execute(query)
        ]

    @staticmethod
    def _context_asset(asset: Asset, stored: StoredObject) -> Dict[str, Any]:
        extension = Path(asset.filename).suffix.lower().lstrip(".")
        if extension not in {"csv", "xlsx", "xls", "json"}:
            raise ApiError(
                409, "ASSET_FORMAT_UNSUPPORTED", "Asset format is unsupported"
            )
        if not stored.checksum_sha256:
            raise ApiError(409, "ASSET_INTEGRITY_MISSING", "Asset checksum is missing")
        return {
            "asset_id": asset.id,
            "object_id": stored.id,
            "file_name": asset.filename,
            "format": extension,
            "media_type": stored.content_type,
            "size_bytes": stored.size_bytes,
            "sha256": stored.checksum_sha256,
            "relative_path": f"input/{asset.id}.{extension}",
        }

    def _existing_dashboard(
        self, run: WorkflowRun, for_update: bool = False
    ) -> Optional[Dashboard]:
        edit_target = self._edit_target(run)
        if edit_target:
            dashboard = DashboardRepository(self.session).get_owned(
                run.owner_id,
                edit_target.dashboard_id,
                for_update=for_update,
                roles=WRITE_PROJECT_ROLES,
            )
            if (
                dashboard is None
                or dashboard.project_id != run.project_id
                or dashboard.conversation_id != run.conversation_id
            ):
                raise not_found("Dashboard")
            require_target_components(dashboard.content, edit_target.component_ids)
            return dashboard
        query = select(Dashboard).where(
            Dashboard.project_id == run.project_id,
            Dashboard.conversation_id == run.conversation_id,
        )
        query = query.order_by(Dashboard.updated_at.desc()).limit(1)
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    @staticmethod
    def _edit_target(run: WorkflowRun) -> Optional[ConversationEditTarget]:
        value = run.input.get("edit_target")
        return ConversationEditTarget.model_validate(value) if value else None

    def _materialize_dashboard(
        self, run: WorkflowRun, request: WorkflowResponseCommitRequest
    ) -> Optional[str]:
        response_type = request.response.get("type")
        if response_type not in {"dashboard_config", "chart_modification"}:
            return None
        payload = request.response.get("dashboard")
        if not isinstance(payload, dict):
            raise ApiError(422, "DASHBOARD_MISSING", "Dashboard response is missing")
        validate_dashboard_content(payload, self.settings.max_dashboard_bytes)
        ensure_database_write_capacity(self.session, self.settings)
        if response_type == "chart_modification":
            return self._update_dashboard(run, payload).id
        return self._create_dashboard(run, payload).id

    def _create_dashboard(self, run: WorkflowRun, payload: Dict[str, Any]) -> Dashboard:
        dashboard_id = str(uuid5(NAMESPACE_URL, f"dreamify-dashboard:{run.id}"))
        if self.session.get(Dashboard, dashboard_id) is not None:
            raise ApiError(409, "DASHBOARD_ID_CONFLICT", "Dashboard already exists")
        dashboard = Dashboard(
            id=dashboard_id,
            owner_id=run.owner_id,
            project_id=run.project_id,
            conversation_id=run.conversation_id,
            title=self._dashboard_title(payload),
            status="ready",
            content=payload,
        )
        return DashboardRepository(self.session).create(dashboard)

    def _update_dashboard(self, run: WorkflowRun, payload: Dict[str, Any]) -> Dashboard:
        edit_target = self._edit_target(run)
        if edit_target is None:
            raise ApiError(
                409,
                "EDIT_TARGET_REQUIRED",
                "Dashboard modifications require an explicit edit target",
            )
        dashboard = self._existing_dashboard(run, for_update=True)
        if dashboard is None:
            raise ApiError(
                409, "EDIT_TARGET_MISSING", "Dashboard edit target is missing"
            )
        if payload.get("id") != dashboard.content.get("id"):
            raise ApiError(
                409,
                "EDIT_TARGET_DASHBOARD_MISMATCH",
                "The response dashboard does not match the requested edit target",
            )
        require_target_components(payload, edit_target.component_ids)
        dashboard.title = self._dashboard_title(payload)
        dashboard.content = payload
        dashboard.current_version += 1
        repository = DashboardRepository(self.session)
        repository.add_version(dashboard, source="workflow-edit")
        repository.prune_versions(
            dashboard.id, self.settings.dashboard_version_retention
        )
        self.session.flush()
        return dashboard

    @staticmethod
    def _dashboard_title(payload: Dict[str, Any]) -> str:
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 200:
            raise ApiError(
                422,
                "INVALID_DASHBOARD_TITLE",
                "Dashboard title must contain 1 to 200 characters",
            )
        return title.strip()

    def _step(
        self, run_id: str, step_key: str, for_update: bool = False
    ) -> Optional[WorkflowStepJournal]:
        query = select(WorkflowStepJournal).where(
            WorkflowStepJournal.run_id == run_id,
            WorkflowStepJournal.step_key == step_key,
        )
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    @staticmethod
    def _require_running(run: WorkflowRun) -> None:
        if run.status != "running":
            raise ApiError(409, "RUN_STATE_CONFLICT", "Workflow run is not running")

    def _is_active_run(self, run: WorkflowRun) -> bool:
        if not run.conversation_id:
            return False
        conversation = self.session.scalar(
            select(Conversation)
            .where(Conversation.id == run.conversation_id)
            .with_for_update()
        )
        return bool(conversation and conversation.active_run_id == run.id)

    def _mark_superseded(self, run: WorkflowRun) -> None:
        run.status = "cancelled"
        run.cancel_requested = True
        run.cancel_reason = "superseded"
        run.completed_at = utc_now()
        run.version += 1
        self.session.flush()

    def _clear_active_run(self, run: WorkflowRun) -> None:
        if not run.conversation_id:
            return
        conversation = self.session.scalar(
            select(Conversation)
            .where(Conversation.id == run.conversation_id)
            .with_for_update()
        )
        if conversation and conversation.active_run_id == run.id:
            conversation.active_run_id = None

    def _existing_response(
        self, run: WorkflowRun, request: WorkflowResponseCommitRequest
    ) -> WorkflowRun:
        expected_result = dict(request.result_reference)
        if run.response_type in {"dashboard_config", "chart_modification"}:
            dashboard_id = (run.result or {}).get("dashboard_id")
            dashboard = (
                self.session.get(Dashboard, dashboard_id) if dashboard_id else None
            )
            if (
                dashboard is None
                or dashboard.owner_id != run.owner_id
                or dashboard.project_id != run.project_id
                or dashboard.conversation_id != run.conversation_id
            ):
                raise ApiError(
                    409, "DASHBOARD_PERSISTENCE_MISSING", "Run dashboard is missing"
                )
            expected_result["dashboard_id"] = dashboard.id
        expected = (
            run.status == request.terminal_status
            and run.output == request.response
            and run.result == expected_result
            and run.response_artifact == request.response_artifact
        )
        if not expected:
            raise ApiError(
                409, "IDEMPOTENCY_CONFLICT", "Terminal response is immutable"
            )
        self._append_event(run, request.event)
        return run

    def _validate_response_artifact(
        self, run_id: str, reference: Dict[str, Any]
    ) -> None:
        object_id = reference.get("object_id")
        query = select(WorkflowArtifact.id).where(
            WorkflowArtifact.run_id == run_id,
            WorkflowArtifact.stored_object_id == object_id,
            WorkflowArtifact.kind == "response",
        )
        if not object_id or self.session.scalar(query) is None:
            raise not_found("Response artifact")

    def _validate_response_payload(
        self, request: WorkflowResponseCommitRequest
    ) -> None:
        response_type = request.response.get("type")
        if response_type not in {
            "message",
            "answer_with_visual",
            "dashboard_config",
            "chart_modification",
            "clarification_request",
        }:
            raise ApiError(422, "INVALID_RESPONSE_TYPE", "Response type is invalid")
        if request.result_reference.get("response_type") != response_type:
            raise ApiError(409, "RESPONSE_TYPE_MISMATCH", "Result type does not match")
        dashboard = request.response.get("dashboard")
        if response_type in {"dashboard_config", "chart_modification"}:
            if not isinstance(dashboard, dict) or not dashboard.get("id"):
                raise ApiError(
                    422, "DASHBOARD_MISSING", "Dashboard response is missing"
                )
            if request.result_reference.get("dashboard_id") != dashboard.get("id"):
                raise ApiError(
                    409,
                    "DASHBOARD_REFERENCE_MISMATCH",
                    "Result dashboard does not match the response",
                )
            if request.terminal_status != "completed":
                raise ApiError(
                    409,
                    "RESPONSE_STATUS_MISMATCH",
                    "Dashboard responses must complete the run",
                )
        elif request.result_reference.get("dashboard_id") is not None:
            raise ApiError(
                409,
                "DASHBOARD_REFERENCE_MISMATCH",
                "Non-dashboard response cannot reference a dashboard",
            )
        if (request.terminal_status == "awaiting_user_input") != (
            response_type == "clarification_request"
        ):
            raise ApiError(
                409,
                "RESPONSE_STATUS_MISMATCH",
                "Clarification status does not match the response",
            )
        if (
            len(_json_bytes(request.response))
            > self.settings.workflow_artifact_max_bytes
        ):
            raise ApiError(413, "RESPONSE_TOO_LARGE", "Workflow response exceeds 1 MiB")

    def _artifact_by_key(
        self, run_id: str, idempotency_key: str
    ) -> Optional[WorkflowArtifact]:
        query = select(WorkflowArtifact).where(
            WorkflowArtifact.run_id == run_id,
            WorkflowArtifact.idempotency_key == idempotency_key,
        )
        return self.session.scalar(query)

    def _validate_artifact_size(self, content: bytes, requested_max: int) -> None:
        if requested_max > self.settings.workflow_artifact_max_bytes:
            raise ApiError(
                413, "ARTIFACT_LIMIT_INVALID", "Artifact limit exceeds 1 MiB"
            )
        if len(content) > requested_max:
            raise ApiError(413, "ARTIFACT_TOO_LARGE", "Workflow artifact is too large")

    @staticmethod
    def _validate_existing_artifact(
        artifact: WorkflowArtifact, kind: str, digest: str
    ) -> None:
        if artifact.kind != kind or artifact.checksum_sha256 != digest:
            raise ApiError(
                409, "IDEMPOTENCY_CONFLICT", "Artifact key has different input"
            )

    def _check_artifact_quota(self, owner_id: str, size_bytes: int) -> None:
        artifact_user = self.session.scalar(
            select(func.coalesce(func.sum(WorkflowArtifact.size_bytes), 0)).where(
                WorkflowArtifact.owner_id == owner_id
            )
        )
        artifact_global = self.session.scalar(
            select(func.coalesce(func.sum(WorkflowArtifact.size_bytes), 0))
        )
        assets = AssetRepository(self.session)
        uploads = UploadRepository(self.session)
        user_total = int(artifact_user or 0) + assets.total_size(owner_id)
        user_total += uploads.reserved_size(owner_id)
        global_total = int(artifact_global or 0) + assets.total_size()
        global_total += uploads.reserved_size()
        if user_total + size_bytes > self.settings.max_user_storage_bytes:
            raise ApiError(409, "USER_STORAGE_QUOTA", "User storage quota exceeded")
        if global_total + size_bytes > self.settings.max_global_storage_bytes:
            raise ApiError(409, "GLOBAL_STORAGE_QUOTA", "Global storage quota exceeded")

    @staticmethod
    def _artifact_path(run: WorkflowRun, kind: str, digest: str) -> str:
        owner_hash = hashlib.sha256(run.owner_id.encode("utf-8")).hexdigest()[:16]
        return f"workflow/{owner_hash}/{run.id}/{kind}/{digest}.json"

    def _expire_slots(self, now) -> None:
        query = select(WorkflowSlot).where(
            WorkflowSlot.run_id.is_not(None),
            or_(
                WorkflowSlot.lease_expires_at.is_(None),
                WorkflowSlot.lease_expires_at <= now,
            ),
        )
        for slot in self.session.scalars(query.with_for_update()).all():
            self._clear_slot(slot)
        self.session.flush()

    @staticmethod
    def _lease(slot: WorkflowSlot) -> Dict[str, Any]:
        if not slot.lease_id or not slot.run_id or not slot.lease_expires_at:
            raise ApiError(409, "LEASE_INVALID", "Capacity lease is incomplete")
        expires_at = slot.lease_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return {
            "lease_id": slot.lease_id,
            "run_id": slot.run_id,
            "expires_at": expires_at,
        }

    @staticmethod
    def _clear_slot(slot: WorkflowSlot) -> None:
        slot.run_id = None
        slot.lease_id = None
        slot.idempotency_key = None
        slot.acquired_at = None
        slot.lease_expires_at = None
