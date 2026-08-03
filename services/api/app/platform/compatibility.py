"""Compatibility services for the migrated web application."""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.platform.edit_targets import normalize_edit_target, require_target_components
from app.platform.errors import ApiError, not_found
from app.platform.legacy_behavior import (
    bounded_explainer,
    clarification_requests,
    normalize_chat_request,
    record_clarification_dismissal,
    update_dashboard_presentation,
    validate_clarification_responses,
)
from app.platform.models import (
    AppUser,
    Asset,
    Conversation,
    Dashboard,
    Project,
    StoredObject,
    WorkflowEvent,
    WorkflowRun,
)
from app.platform.repositories import (
    WRITE_PROJECT_ROLES,
    AssetRepository,
    ConversationRepository,
    DashboardRepository,
    ProjectRepository,
    WorkflowRepository,
)
from app.platform.schemas import (
    ConversationChatCreate,
    ConversationEditTarget,
    DashboardDataUpdate,
    DashboardRevertRequest,
    DashboardStyleUpdate,
    WorkflowRunCreate,
)
from app.platform.services import (
    TERMINAL_RUN_STATUSES,
    ConversationService,
    WorkflowService,
    _require_project,
    active_data_run_error,
    is_active_data_run_conflict,
    validate_dashboard_content,
)
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage

LEGACY_STATUS = {
    "queued": "starting",
    "running": "processing",
    "awaiting_user_input": "awaiting_user_input",
    "completed": "completed",
    "failed": "error",
    "cancelling": "stopped",
    "cancelled": "stopped",
}


def request_fingerprint(payload: ConversationChatCreate) -> str:
    serialized = json.dumps(
        payload.model_dump(mode="json", exclude_none=True),
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(serialized) > 64 * 1024:
        raise ApiError(413, "CHAT_REQUEST_TOO_LARGE", "Chat request exceeds 64 KiB")
    return hashlib.sha256(serialized).hexdigest()


def _preview_grants(session: Session, project: Project) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for grant in project.preview_grants:
        user = session.get(AppUser, grant.user_id) if grant.user_id else None
        records.append(
            {
                "user_id": grant.user_id,
                "email": grant.email or (user.email if user else None),
                "name": user.display_name if user else None,
                "image_url": None,
            }
        )
    return records


def _latest_preview_records(
    session: Session, project: Project
) -> Tuple[Optional[Conversation], Optional[Dashboard]]:
    dashboard = DashboardRepository(session).latest_for_project(
        project.owner_id, project.id
    )
    conversation = None
    if dashboard and dashboard.conversation_id:
        conversation = ConversationRepository(session).get_owned(
            project.owner_id, dashboard.conversation_id
        )
    if conversation is None:
        conversation = ConversationRepository(session).latest_for_project(
            project.owner_id, project.id
        )
    return conversation, dashboard


def _legacy_project(session: Session, project: Project) -> Dict[str, Any]:
    conversation, dashboard = _latest_preview_records(session, project)
    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "latest_conversation_id": conversation.id if conversation else None,
        "latest_dashboard_id": dashboard.id if dashboard else None,
        "dashboard_title": dashboard.title if dashboard else None,
        "name_source": "user",
        "dashboard_preview_key": None,
        "is_preview_public": project.is_preview_public,
        "allowed": _preview_grants(session, project),
        "source_type": None,
    }


class LegacyProjectService:
    def __init__(self, session: Session, owner_id: str):
        self.session = session
        self.owner_id = owner_id
        self.repository = ProjectRepository(session)

    def serialize(self, project: Project) -> Dict[str, Any]:
        return _legacy_project(self.session, project)

    def list(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        projects = sorted(
            self.repository.list_owned(self.owner_id),
            key=lambda item: item.updated_at,
            reverse=True,
        )
        if limit is not None:
            projects = projects[:limit]
        return [self.serialize(project) for project in projects]


class PublicPreviewService:
    def __init__(
        self,
        session: Session,
        user: Optional[AppUser],
        max_dashboard_bytes: int,
    ):
        self.session = session
        self.user = user
        self.max_dashboard_bytes = max_dashboard_bytes
        self.projects = ProjectRepository(session)

    def project(self, project_id: str) -> Dict[str, Any]:
        project = self._authorized_project(project_id)
        conversation, dashboard = _latest_preview_records(self.session, project)
        return {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
            "latest_conversation_id": conversation.id if conversation else None,
            "latest_dashboard_id": dashboard.id if dashboard else None,
            "dashboard_title": dashboard.title if dashboard else None,
            "is_preview_public": project.is_preview_public,
        }

    def dashboard(self, project_id: str, conversation_id: str) -> Dict[str, Any]:
        project = self._authorized_project(project_id)
        conversation = ConversationRepository(self.session).get_owned(
            project.owner_id, conversation_id
        )
        if conversation is None or conversation.project_id != project.id:
            raise not_found("Conversation")
        dashboard = DashboardRepository(self.session).latest_for_project(
            project.owner_id, project.id, conversation.id
        )
        return self._dashboard_payload(dashboard)

    def latest_dashboard(self, project_id: str) -> Dict[str, Any]:
        project = self._authorized_project(project_id)
        dashboard = DashboardRepository(self.session).latest_for_project(
            project.owner_id, project.id
        )
        return self._dashboard_payload(dashboard)

    def _dashboard_payload(self, dashboard: Optional[Dashboard]) -> Dict[str, Any]:
        if dashboard is None:
            return {
                "dashboard_id": None,
                "dashboard_data": None,
                "current_version": None,
                "dashboard_title": None,
                "updated_at": None,
            }
        validate_dashboard_content(dashboard.content, self.max_dashboard_bytes)
        return {
            "dashboard_id": dashboard.id,
            "dashboard_data": dashboard.content,
            "current_version": dashboard.current_version,
            "dashboard_title": dashboard.title,
            "updated_at": dashboard.updated_at,
        }

    def _authorized_project(self, project_id: str) -> Project:
        project = self.projects.get(project_id)
        if project is None:
            raise not_found("Project")
        if project.is_preview_public:
            return project
        if self.user is None:
            raise ApiError(
                403,
                "PREVIEW_PRIVATE",
                "Project preview is private; sign in to request access",
            )
        if self.projects.has_active_membership(
            project.id, self.user.id
        ) or self.projects.has_preview_grant(project.id, self.user):
            return project
        raise ApiError(
            403,
            "PREVIEW_ACCESS_DENIED",
            "This signed-in user is not allowed to view the project preview",
        )


def _asset_record(asset: Asset, stored: StoredObject) -> Dict[str, Any]:
    return {
        "asset_id": asset.id,
        "file_id": asset.id,
        "project_id": asset.project_id,
        "filename": asset.filename,
        "extension": Path(asset.filename).suffix.lower().lstrip("."),
        "status": asset.status,
        "storage_ref": {"provider": stored.backend, "pathname": stored.pathname},
        "size_bytes": asset.size_bytes,
        "created_at": asset.created_at,
        "asset_type": asset.asset_type,
        "checksum_sha256": stored.checksum_sha256,
    }


class LegacyAssetService:
    def __init__(self, session: Session, owner_id: str, storage: ObjectStorage) -> None:
        self.session = session
        self.owner_id = owner_id
        self.storage = storage
        self.repository = AssetRepository(session)

    def _record(self, asset: Asset) -> Tuple[Asset, StoredObject]:
        stored = self.repository.stored_object(self.owner_id, asset)
        if stored is None or not stored.checksum_sha256:
            raise not_found("Asset object")
        return asset, stored

    def list(self) -> List[Dict[str, Any]]:
        records = []
        for asset in self.repository.list_all_owned(self.owner_id):
            if asset.status == "deleted":
                continue
            current, stored = self._record(asset)
            records.append(_asset_record(current, stored))
        return records

    def get(self, asset_id: str) -> Dict[str, Any]:
        asset = self.repository.get_owned(self.owner_id, asset_id)
        if asset is None or asset.status == "deleted":
            raise not_found("Asset")
        current, stored = self._record(asset)
        return _asset_record(current, stored)

    def download(self, asset_id: str) -> Dict[str, Any]:
        asset = self.repository.get_owned(self.owner_id, asset_id)
        if asset is None or asset.status == "deleted":
            raise not_found("Asset")
        _, stored = self._record(asset)
        signed = self.storage.signed_get_url(stored.pathname, 15 * 60)
        return {
            "success": True,
            "url": signed.url,
            "filename": asset.filename,
            "expires_in": 15 * 60,
        }


@dataclass(frozen=True)
class PreparedChat:
    conversation: Conversation
    run: WorkflowRun


class ConversationWorkflowService:
    def __init__(self, session: Session, owner_id: str, settings: Settings):
        self.session = session
        self.owner_id = owner_id
        self.settings = settings
        self.runs = WorkflowRepository(session)

    def prepare(self, payload: ConversationChatCreate) -> PreparedChat:
        fingerprint = request_fingerprint(payload)
        current = self.runs.get_by_client_request(
            self.owner_id, payload.client_request_id, for_update=True
        )
        if current:
            return self._existing(current, fingerprint)
        try:
            return self._create(payload, fingerprint)
        except IntegrityError as error:
            self.session.rollback()
            current = self.runs.get_by_client_request(
                self.owner_id, payload.client_request_id, for_update=True
            )
            if current:
                return self._existing(current, fingerprint)
            if is_active_data_run_conflict(error):
                raise active_data_run_error() from error
            raise

    def _existing(self, run: WorkflowRun, fingerprint: str) -> PreparedChat:
        if run.request_fingerprint != fingerprint:
            raise ApiError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "client_request_id has different chat input",
            )
        conversation = ConversationRepository(self.session).get_owned(
            self.owner_id, run.conversation_id or ""
        )
        if conversation is None:
            raise ApiError(409, "RUN_CONTEXT_MISSING", "Run conversation is missing")
        return PreparedChat(conversation, run)

    def _create(
        self, payload: ConversationChatCreate, fingerprint: str
    ) -> PreparedChat:
        _require_project(self.session, self.owner_id, payload.project_id)
        conversation = self._conversation(payload)
        asset_ids = self._asset_ids(payload)
        parent_run_id = self._parent_run_id(conversation)
        parent = (
            self.runs.get_run(self.owner_id, parent_run_id) if parent_run_id else None
        )
        validate_clarification_responses(
            payload.user_node_contents,
            parent.output if parent else None,
        )
        edit_target = self._resolved_edit_target(payload, parent_run_id)
        self._validate_edit_target(conversation, edit_target)
        run = WorkflowService(self.session, self.owner_id, self.settings).create(
            WorkflowRunCreate(
                project_id=payload.project_id,
                conversation_id=conversation.id,
                parent_run_id=parent_run_id,
                workflow_name="analyze_data",
                asset_ids=asset_ids,
                input=self._run_input(payload, asset_ids, edit_target),
            )
        )
        run.client_request_id = payload.client_request_id
        run.request_fingerprint = fingerprint
        self.session.flush()
        return PreparedChat(conversation, run)

    def _conversation(self, payload: ConversationChatCreate) -> Conversation:
        if payload.conversation_id:
            conversation = ConversationService(self.session, self.owner_id).get(
                payload.conversation_id
            )
            if conversation.project_id != payload.project_id:
                raise not_found("Conversation")
            return conversation
        return ConversationService(self.session, self.owner_id).create(
            payload.project_id, self._title(payload)
        )

    def _parent_run_id(self, conversation: Conversation) -> Optional[str]:
        parent = None
        if conversation.active_run_id:
            parent = self.runs.get_run(self.owner_id, conversation.active_run_id)
        else:
            parent = self.runs.latest_for_conversation(self.owner_id, conversation.id)
        if parent and parent.status == "awaiting_user_input":
            return parent.id
        return None

    @staticmethod
    def _title(payload: ConversationChatCreate) -> str:
        return ConversationWorkflowService._prompt(payload)[:200]

    @staticmethod
    def _prompt(payload: ConversationChatCreate) -> str:
        for content in payload.user_node_contents:
            text = content.data.get("text") if content.type == "text" else None
            if isinstance(text, str) and text.strip():
                prompt = text.strip()
                if len(prompt) > 8000:
                    raise ApiError(
                        413, "PROMPT_TOO_LARGE", "Prompt exceeds 8,000 characters"
                    )
                return prompt
        return "New conversation"

    @staticmethod
    def _asset_ids(payload: ConversationChatCreate) -> List[str]:
        candidates: List[Any] = [payload.asset_id]
        metadata = payload.user_node_metadata or {}
        selected = metadata.get("selected_asset_ids")
        if isinstance(selected, list):
            candidates.extend(selected)
        for content in payload.user_node_contents:
            if content.type in {"asset", "attachment", "file", "mention"}:
                candidates.append(content.data.get("asset_id"))
        return list(dict.fromkeys(item for item in candidates if isinstance(item, str)))

    @staticmethod
    def _run_input(
        payload: ConversationChatCreate,
        asset_ids: List[str],
        edit_target: Optional[ConversationEditTarget],
    ) -> Dict[str, Any]:
        prompt = ConversationWorkflowService._prompt(payload)
        return {
            "prompt": prompt,
            "asset_ids": asset_ids,
            "chat_request": normalize_chat_request(
                payload.model_dump(mode="json", exclude_none=True)
            ),
            "edit_target": (
                edit_target.model_dump(mode="json") if edit_target else None
            ),
        }

    def _resolved_edit_target(
        self, payload: ConversationChatCreate, parent_run_id: Optional[str]
    ) -> Optional[ConversationEditTarget]:
        target = normalize_edit_target(payload)
        if target or not parent_run_id:
            return target
        parent = self.runs.get_run(self.owner_id, parent_run_id)
        stored = parent.input.get("edit_target") if parent else None
        return ConversationEditTarget.model_validate(stored) if stored else None

    def _validate_edit_target(
        self,
        conversation: Conversation,
        target: Optional[ConversationEditTarget],
    ) -> None:
        if target is None:
            return
        dashboard = DashboardRepository(self.session).get_owned(
            self.owner_id,
            target.dashboard_id,
            roles=WRITE_PROJECT_ROLES,
        )
        if (
            dashboard is None
            or dashboard.project_id != conversation.project_id
            or dashboard.conversation_id != conversation.id
        ):
            raise not_found("Dashboard")
        require_target_components(dashboard.content, target.component_ids)

    def latest_run(
        self, conversation_id: str, project_id: str, for_update: bool = False
    ) -> WorkflowRun:
        conversation = ConversationRepository(self.session).get_owned(
            self.owner_id, conversation_id, for_update=for_update
        )
        if conversation is None or conversation.project_id != project_id:
            raise not_found("Conversation")
        run = self.runs.latest_for_conversation(
            self.owner_id, conversation.id, for_update=for_update
        )
        if run is None:
            raise not_found("Workflow run")
        return run

    def cancel(self, conversation_id: str, project_id: str) -> WorkflowRun:
        run = self.latest_run(conversation_id, project_id, for_update=True)
        if run.status not in TERMINAL_RUN_STATUSES:
            return WorkflowService(self.session, self.owner_id, self.settings).cancel(
                run.id, "Cancelled by user"
            )
        return run

    def dismiss(
        self,
        conversation_id: str,
        project_id: str,
        clarification_id: str,
    ) -> Tuple[WorkflowRun, WorkflowEvent]:
        _require_project(
            self.session,
            self.owner_id,
            project_id,
            permission="write",
            for_update=True,
        )
        conversation = ConversationRepository(self.session).get_owned(
            self.owner_id,
            conversation_id,
            for_update=True,
            roles=WRITE_PROJECT_ROLES,
        )
        if conversation is None or conversation.project_id != project_id:
            raise not_found("Conversation")
        run = self.runs.latest_for_conversation(
            self.owner_id,
            conversation.id,
            for_update=True,
        )
        if run is None:
            raise not_found("Workflow run")
        event = record_clarification_dismissal(
            self.runs,
            run,
            clarification_id,
            self.settings.workflow_max_events_per_run,
        )
        if conversation.active_run_id == run.id:
            conversation.active_run_id = None
        self.session.flush()
        return run, event


def workflow_status(run: WorkflowRun) -> Dict[str, Any]:
    metadata = {
        "step": run.current_step,
        "response_type": run.response_type,
        "result": run.result,
        "error": run.error,
        "cancel_requested": run.cancel_requested,
        "version": run.version,
    }
    metadata.update(bounded_explainer(run.output))
    return {
        "conversation_id": run.conversation_id,
        "node_id": run.id,
        "run_id": run.id,
        "status": LEGACY_STATUS.get(run.status, run.status),
        "metadata": metadata,
        "updated_at": run.updated_at,
    }


def thinking_event(event: WorkflowEvent) -> Dict[str, Any]:
    payload = event.payload or {}
    default_status = (
        "error" if event.event_type in {"run_failed", "error"} else "completed"
    )
    if event.event_type == "run_started":
        default_status = "active"
    phase = payload.get("phase") or _event_phase(event.event_type)
    return {
        "id": event.id,
        "run_id": event.run_id,
        "sequence": event.sequence,
        "event_key": event.event_key,
        "phase": phase,
        "status": payload.get("status") or default_status,
        "title": payload.get("title") or event.event_type.replace("_", " ").title(),
        "summary": payload.get("summary"),
        "detail": payload.get("detail"),
        "started_at": payload.get("started_at") or event.created_at,
        "completed_at": payload.get("completed_at"),
        "duration_ms": payload.get("duration_ms"),
        "metadata": payload.get("metadata") or {},
    }


def _event_phase(event_type: str) -> str:
    if event_type in {"run_failed", "error"}:
        return "error"
    if event_type in {"run_completed", "run_succeeded"}:
        return "final"
    if event_type == "run_started":
        return "queued"
    return "tool"


class ConversationReadService:
    def __init__(self, session: Session, owner_id: str):
        self.session = session
        self.owner_id = owner_id
        self.runs = WorkflowRepository(session)

    def read(self, conversation_id: str, project_id: str) -> Dict[str, Any]:
        conversation = ConversationRepository(self.session).get_owned(
            self.owner_id, conversation_id
        )
        if conversation is None or conversation.project_id != project_id:
            raise not_found("Conversation")
        runs = WorkflowRepository(self.session).list_runs(self.owner_id, project_id)
        relevant = sorted(
            (run for run in runs if run.conversation_id == conversation.id),
            key=lambda run: run.created_at,
        )
        dashboards = DashboardRepository(self.session).list_owned(
            self.owner_id, project_id
        )
        return {
            "conversation": {
                "id": conversation.id,
                "conversation_id": conversation.id,
                "project_id": conversation.project_id,
                "title": conversation.title,
                "nodes": self._nodes(relevant),
                "dashboards": [
                    {"dashboard_id": item.id, "title": item.title}
                    for item in dashboards
                    if item.conversation_id in (None, conversation.id)
                ],
                "created_at": conversation.created_at,
                "updated_at": conversation.updated_at,
            }
        }

    def _nodes(self, runs: List[WorkflowRun]) -> List[Dict[str, Any]]:
        nodes: List[Dict[str, Any]] = []
        for run in runs:
            nodes.append(self._user_node(run))
            assistant = self._assistant_node(run)
            if assistant:
                nodes.append(assistant)
            for event in self.runs.list_events(self.owner_id, run.id):
                if event.event_type == "clarification_dismissed":
                    nodes.append(self._dismissal_node(event))
        return nodes

    @staticmethod
    def _dismissal_node(event: WorkflowEvent) -> Dict[str, Any]:
        metadata = (event.payload or {}).get("metadata") or {}
        return {
            "node_id": f"{event.id}:user",
            "role": "user",
            "created_at": event.created_at,
            "metadata": {"hidden": True},
            "contents": [
                {
                    "type": "clarification_response",
                    "data": metadata,
                }
            ],
        }

    @staticmethod
    def _user_node(run: WorkflowRun) -> Dict[str, Any]:
        request = run.input.get("chat_request", {})
        return {
            "node_id": f"{run.id}:user",
            "role": "user",
            "created_at": run.created_at,
            "metadata": request.get("user_node_metadata") or {},
            "contents": request.get("user_node_contents") or [],
        }

    @staticmethod
    def _assistant_node(run: WorkflowRun) -> Optional[Dict[str, Any]]:
        output = run.output or {}
        content = output.get("content")
        contents: List[Dict[str, Any]] = []
        if isinstance(content, str) and content:
            contents.append({"type": "text", "data": {"text": content}})
        for clarification in clarification_requests(output).values():
            question = clarification.get("content") or clarification.get("question")
            contents.append(
                {
                    "type": "clarification_request",
                    "data": {
                        "clarification_id": clarification.get("clarification_id"),
                        "reason_code": clarification.get("reason_code"),
                        "question": question,
                        "options": clarification.get("options") or [],
                    },
                }
            )
        dashboard_id = (run.result or {}).get("dashboard_id")
        if dashboard_id:
            contents.append(
                {"type": "dashboard", "data": {"dashboard_id": dashboard_id}}
            )
        if not contents:
            return None
        return {
            "node_id": f"{run.id}:assistant",
            "role": "assistant",
            "created_at": run.completed_at or run.updated_at,
            "metadata": {"response_type": run.response_type},
            "contents": contents,
        }


class DashboardCompatibilityService:
    def __init__(
        self,
        session: Session,
        owner_id: str,
        max_dashboard_bytes: int = 1024 * 1024,
        version_retention: int = 25,
    ):
        self.session = session
        self.owner_id = owner_id
        self.max_dashboard_bytes = max_dashboard_bytes
        self.version_retention = version_retention
        self.repository = DashboardRepository(session)
        self.runs = WorkflowRepository(session)

    def get_data(
        self, conversation_id: str, project_id: str, dashboard_id: Optional[str]
    ) -> Dict[str, Any]:
        self._conversation(conversation_id, project_id)
        dashboard = self._dashboard(conversation_id, project_id, dashboard_id)
        if dashboard is None:
            return {"dashboard_id": None, "dashboard_data": None}
        payload = {
            "dashboard_id": dashboard.id,
            "dashboard_data": dashboard.content,
            "current_version": dashboard.current_version,
        }
        payload.update(self._explainer(conversation_id, project_id, dashboard.id))
        return payload

    def _explainer(
        self,
        conversation_id: str,
        project_id: str,
        dashboard_id: str,
    ) -> Dict[str, Any]:
        for run in self.runs.list_runs(self.owner_id, project_id):
            if run.conversation_id != conversation_id:
                continue
            result_dashboard_id = (run.result or {}).get("dashboard_id")
            edit_target = (run.input or {}).get("edit_target") or {}
            if (
                result_dashboard_id != dashboard_id
                and edit_target.get("dashboard_id") != dashboard_id
            ):
                continue
            explainer = bounded_explainer(run.output)
            if explainer:
                return explainer
        return {}

    def update_style(
        self,
        conversation_id: str,
        dashboard_id: str,
        payload: DashboardStyleUpdate,
        style_key: Literal["template_id", "theme_id"],
    ) -> Dashboard:
        dashboard = self._required_dashboard(
            conversation_id, payload.project_id, dashboard_id, for_update=True
        )
        self._require_expected_version(dashboard, payload.expected_version)
        value = getattr(payload, style_key)
        other_key = "theme_id" if style_key == "template_id" else "template_id"
        if value is None or getattr(payload, other_key) is not None:
            raise ApiError(
                422,
                "INVALID_STYLE_UPDATE",
                f"Provide only {style_key} for this endpoint",
            )
        content = update_dashboard_presentation(dashboard.content, style_key, value)
        return self._save(dashboard, content, "style", None)

    def save_data(
        self,
        conversation_id: str,
        dashboard_id: str,
        payload: DashboardDataUpdate,
    ) -> Dashboard:
        dashboard = self._required_dashboard(
            conversation_id, payload.project_id, dashboard_id, for_update=True
        )
        self._require_expected_version(dashboard, payload.expected_version)
        return self._save(
            dashboard, payload.dashboard_data, "edit", payload.edit_summary
        )

    def versions(
        self, conversation_id: str, project_id: str, dashboard_id: str
    ) -> Dict[str, Any]:
        dashboard = self._required_dashboard(conversation_id, project_id, dashboard_id)
        return {
            "dashboard_id": dashboard.id,
            "current_version": dashboard.current_version,
            "versions": [
                {
                    "version": item.version,
                    "created_at": item.created_at,
                    "edit_summary": item.edit_summary,
                    "source": item.source,
                }
                for item in self.repository.list_versions(dashboard.id)
            ],
        }

    def version(
        self, conversation_id: str, project_id: str, dashboard_id: str, version: int
    ) -> Dict[str, Any]:
        dashboard = self._required_dashboard(conversation_id, project_id, dashboard_id)
        snapshot = self.repository.get_version(dashboard.id, version)
        if snapshot is None:
            raise not_found("Dashboard version")
        return {"dashboard_id": dashboard.id, "dashboard_data": snapshot.content}

    def revert(
        self,
        conversation_id: str,
        dashboard_id: str,
        payload: DashboardRevertRequest,
    ) -> Dict[str, Any]:
        dashboard = self._required_dashboard(
            conversation_id, payload.project_id, dashboard_id, for_update=True
        )
        self._require_expected_version(dashboard, payload.expected_version)
        snapshot = self.repository.get_version(dashboard.id, payload.target_version)
        if snapshot is None:
            raise not_found("Dashboard version")
        self._save(
            dashboard,
            snapshot.content,
            "revert",
            f"Reverted to version {payload.target_version}",
        )
        return {
            "success": True,
            "dashboard_id": dashboard.id,
            "new_version": dashboard.current_version,
            "reverted_to": payload.target_version,
        }

    def _conversation(
        self,
        conversation_id: str,
        project_id: str,
        for_update: bool = False,
    ) -> Conversation:
        _require_project(
            self.session,
            self.owner_id,
            project_id,
            permission="write" if for_update else "read",
        )
        conversation = ConversationRepository(self.session).get_owned(
            self.owner_id,
            conversation_id,
            roles=("owner", "editor") if for_update else ("owner", "editor", "viewer"),
        )
        if conversation is None or conversation.project_id != project_id:
            raise not_found("Conversation")
        return conversation

    def _dashboard(
        self,
        conversation_id: str,
        project_id: str,
        dashboard_id: Optional[str],
        for_update: bool = False,
    ) -> Optional[Dashboard]:
        if dashboard_id:
            dashboard = self.repository.get_owned(
                self.owner_id,
                dashboard_id,
                for_update=for_update,
                roles=("owner", "editor")
                if for_update
                else ("owner", "editor", "viewer"),
            )
            if dashboard is None or dashboard.project_id != project_id:
                raise not_found("Dashboard")
            if dashboard.conversation_id not in (None, conversation_id):
                raise not_found("Dashboard")
            return dashboard
        dashboard = self.repository.latest_for_project(
            self.owner_id, project_id, conversation_id
        )
        return dashboard or self.repository.latest_for_project(
            self.owner_id, project_id
        )

    def _required_dashboard(
        self,
        conversation_id: str,
        project_id: str,
        dashboard_id: str,
        for_update: bool = False,
    ) -> Dashboard:
        self._conversation(conversation_id, project_id, for_update=for_update)
        dashboard = self._dashboard(
            conversation_id, project_id, dashboard_id, for_update=for_update
        )
        if dashboard is None:
            raise not_found("Dashboard")
        return dashboard

    @staticmethod
    def _require_expected_version(dashboard: Dashboard, expected_version: int) -> None:
        if expected_version != dashboard.current_version:
            raise ApiError(409, "DASHBOARD_VERSION_CONFLICT", "Dashboard was updated")

    def _save(
        self,
        dashboard: Dashboard,
        content: Dict[str, Any],
        source: str,
        edit_summary: Optional[str],
    ) -> Dashboard:
        validate_dashboard_content(content, self.max_dashboard_bytes)
        dashboard.content = content
        dashboard.current_version += 1
        self.repository.add_version(dashboard, source, edit_summary)
        self.repository.prune_versions(dashboard.id, self.version_retention)
        self.session.flush()
        return dashboard
