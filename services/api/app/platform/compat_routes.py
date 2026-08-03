"""Temporary public aliases used while the web client adopts canonical routes."""

import asyncio
import json
import time
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.platform.auth import get_current_user, get_optional_current_user
from app.platform.compatibility import (
    ConversationReadService,
    ConversationWorkflowService,
    DashboardCompatibilityService,
    LegacyAssetService,
    LegacyProjectService,
    PublicPreviewService,
    thinking_event,
    workflow_status,
)
from app.platform.database import (
    ensure_database_write_capacity,
    get_runtime_settings,
    get_session,
)
from app.platform.dispatch import WorkflowDispatcher
from app.platform.dispatch_coordination import DispatchCoordinator
from app.platform.errors import ApiError, feature_disabled
from app.platform.models import AppUser
from app.platform.repositories import WorkflowRepository
from app.platform.routes import get_storage
from app.platform.schemas import (
    AcceptedRunRead,
    AssetRead,
    ConversationChatCreate,
    DashboardDataCompatRead,
    DashboardDataUpdate,
    DashboardRevertRequest,
    DashboardStyleUpdate,
    FilePreviewRead,
    LegacyAssetListRead,
    LegacyAssetRead,
    LegacyProjectListRead,
    LegacyProjectRead,
    ProjectCreate,
    ProjectUpdate,
    PublicDashboardDataRead,
    PublicProjectRead,
    WorkflowEventsCompatRead,
    WorkflowStatusCompatRead,
)
from app.platform.services import (
    TERMINAL_RUN_STATUSES,
    AssetService,
    FilePreviewService,
    ProjectService,
    UploadService,
)
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage

router = APIRouter(prefix="/api/v1")


def _accepted(conversation_id: str, project_id: str, run_id: str) -> Dict[str, object]:
    query = f"?project_id={project_id}"
    base = "/api/v1/conversation"
    return {
        "conversation_id": conversation_id,
        "project_id": project_id,
        "run_id": run_id,
        "status": "accepted",
        "links": {
            "status": f"{base}/workflow-status/{conversation_id}{query}",
            "events": f"{base}/workflow-events/{conversation_id}{query}",
            "stream": f"{base}/{conversation_id}/stream{query}",
            "cancel": f"{base}/{conversation_id}/stop{query}",
        },
    }


@router.post(
    "/conversation/chat",
    response_model=AcceptedRunRead,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["compatibility-chat"],
)
def create_chat_run(
    payload: ConversationChatCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    prepared = ConversationWorkflowService(session, user.id, settings).prepare(payload)
    session.commit()
    coordinator = DispatchCoordinator(session, settings)
    lease = coordinator.acquire(prepared.run.id)
    session.commit()
    if lease.should_dispatch and lease.lease_id:
        try:
            receipt = WorkflowDispatcher(settings).dispatch(
                prepared.run, lease.lease_id
            )
        except ApiError as error:
            if error.code == "WORKFLOW_DISPATCH_REJECTED":
                coordinator.release(prepared.run.id, lease.lease_id)
                session.commit()
            raise
        if receipt.workflow_execution_id:
            coordinator.record(
                prepared.run.id, lease.lease_id, receipt.workflow_execution_id
            )
        session.commit()
    return _accepted(prepared.conversation.id, prepared.run.project_id, prepared.run.id)


@router.get(
    "/conversation/workflow-status/{conversation_id}",
    response_model=WorkflowStatusCompatRead,
    tags=["compatibility-workflows"],
)
def get_conversation_workflow_status(
    conversation_id: str,
    project_id: str = Query(),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    run = ConversationWorkflowService(session, user.id, settings).latest_run(
        conversation_id, project_id
    )
    return workflow_status(run)


@router.get(
    "/conversation/workflow-events/{conversation_id}",
    response_model=WorkflowEventsCompatRead,
    tags=["compatibility-workflows"],
)
def get_conversation_workflow_events(
    conversation_id: str,
    project_id: str = Query(),
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    workflow = ConversationWorkflowService(session, user.id, settings)
    run = workflow.latest_run(conversation_id, project_id)
    events = WorkflowRepository(session).list_events(user.id, run.id, after, limit)
    return {
        "conversation_id": conversation_id,
        "run_id": run.id,
        "status": workflow_status(run),
        "events": [thinking_event(event) for event in events],
        "next_after": events[-1].sequence if events else after,
    }


def _event_frame(event) -> str:
    payload = json.dumps(jsonable_encoder(thinking_event(event)), separators=(",", ":"))
    return f"id: {event.sequence}\nevent: event\ndata: {payload}\n\n"


def _status_frame(run) -> str:
    payload = json.dumps(jsonable_encoder(workflow_status(run)), separators=(",", ":"))
    return f"event: status\ndata: {payload}\n\n"


def _stream_cursor(after: Optional[int], last_event_id: Optional[str]) -> int:
    if after is not None:
        return after
    if last_event_id is None or not last_event_id.strip():
        return 0
    try:
        cursor = int(last_event_id)
    except ValueError as exc:
        raise ApiError(
            400, "INVALID_EVENT_CURSOR", "Last-Event-ID must be an integer"
        ) from exc
    if cursor < 0:
        raise ApiError(
            400, "INVALID_EVENT_CURSOR", "Last-Event-ID must be non-negative"
        )
    return cursor


@router.get(
    "/conversation/{conversation_id}/stream",
    tags=["compatibility-workflows"],
)
def stream_conversation_workflow(
    conversation_id: str,
    request: Request,
    project_id: str = Query(),
    after: Optional[int] = Query(default=None, ge=0),
    last_event_id: Optional[str] = Header(default=None, alias="Last-Event-ID"),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    cursor = _stream_cursor(after, last_event_id)
    ConversationWorkflowService(session, user.id, settings).latest_run(
        conversation_id, project_id
    )
    database = request.app.state.database

    async def generate():
        current = cursor
        last_status = None
        deadline = time.monotonic() + settings.workflow_sse_max_seconds
        yield "retry: 2000\n\n"
        while time.monotonic() < deadline:
            with database.session() as poll_session:
                workflow = ConversationWorkflowService(poll_session, user.id, settings)
                run = workflow.latest_run(conversation_id, project_id)
                events = WorkflowRepository(poll_session).list_events(
                    user.id, run.id, current, 100
                )
                encoded_status = _status_frame(run)
                terminal = run.status in TERMINAL_RUN_STATUSES
            if encoded_status != last_status:
                yield encoded_status
                last_status = encoded_status
            for event in events:
                yield _event_frame(event)
                current = event.sequence
            if terminal:
                return
            yield ": keep-alive\n\n"
            await asyncio.sleep(settings.workflow_sse_poll_seconds)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/conversation/{conversation_id}/stop",
    tags=["compatibility-workflows"],
)
def stop_conversation_workflow(
    conversation_id: str,
    project_id: str = Query(),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    run = ConversationWorkflowService(session, user.id, settings).cancel(
        conversation_id, project_id
    )
    return {
        "success": True,
        "message": "Workflow cancellation requested",
        "conversation_id": conversation_id,
        "run_id": run.id,
        "status": workflow_status(run)["status"],
    }


@router.get("/conversation/{conversation_id}", tags=["compatibility-chat"])
def load_conversation(
    conversation_id: str,
    project_id: str = Query(),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ConversationReadService(session, user.id).read(conversation_id, project_id)


@router.post(
    "/conversation/{conversation_id}/clarification/{clarification_id}/dismiss",
    tags=["compatibility-chat"],
)
def dismiss_clarification(
    conversation_id: str,
    clarification_id: str,
    project_id: str = Query(),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    run, _event = ConversationWorkflowService(session, user.id, settings).dismiss(
        conversation_id,
        project_id,
        clarification_id,
    )
    return {
        "success": True,
        "message": "Clarification dismissed",
        "conversation_id": conversation_id,
        "clarification_id": clarification_id,
        "run_id": run.id,
        "status": workflow_status(run)["status"],
    }


@router.get(
    "/conversation/{conversation_id}/dashboard",
    response_model=DashboardDataCompatRead,
    tags=["compatibility-dashboards"],
)
def get_conversation_dashboard(
    conversation_id: str,
    project_id: str = Query(),
    dashboard_id: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    return DashboardCompatibilityService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).get_data(conversation_id, project_id, dashboard_id)


@router.put(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/template",
    tags=["compatibility-dashboards"],
)
def update_dashboard_template(
    conversation_id: str,
    dashboard_id: str,
    payload: DashboardStyleUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    DashboardCompatibilityService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).update_style(conversation_id, dashboard_id, payload, "template_id")
    return {"success": True}


@router.put(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/theme",
    tags=["compatibility-dashboards"],
)
def update_dashboard_theme(
    conversation_id: str,
    dashboard_id: str,
    payload: DashboardStyleUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    DashboardCompatibilityService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).update_style(conversation_id, dashboard_id, payload, "theme_id")
    return {"success": True}


@router.put(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/data",
    tags=["compatibility-dashboards"],
)
def save_dashboard_data(
    conversation_id: str,
    dashboard_id: str,
    payload: DashboardDataUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    DashboardCompatibilityService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).save_data(conversation_id, dashboard_id, payload)
    return {"success": True}


@router.get(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/versions",
    tags=["compatibility-dashboards"],
)
def list_legacy_dashboard_versions(
    conversation_id: str,
    dashboard_id: str,
    project_id: str = Query(),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    return DashboardCompatibilityService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).versions(conversation_id, project_id, dashboard_id)


@router.get(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/versions/{version}",
    response_model=DashboardDataCompatRead,
    tags=["compatibility-dashboards"],
)
def get_legacy_dashboard_version(
    conversation_id: str,
    dashboard_id: str,
    version: int,
    project_id: str = Query(),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    return DashboardCompatibilityService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).version(conversation_id, project_id, dashboard_id, version)


@router.post(
    "/conversation/{conversation_id}/dashboard/{dashboard_id}/revert",
    tags=["compatibility-dashboards"],
)
def revert_legacy_dashboard(
    conversation_id: str,
    dashboard_id: str,
    payload: DashboardRevertRequest,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    return DashboardCompatibilityService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).revert(conversation_id, dashboard_id, payload)


def _private_preview_response(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization, X-Demo-User"


@router.get(
    "/public/project/{project_id}",
    response_model=PublicProjectRead,
    tags=["public-previews"],
)
def get_public_project_preview(
    project_id: str,
    response: Response,
    session: Session = Depends(get_session),
    user: Optional[AppUser] = Depends(get_optional_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    _private_preview_response(response)
    return PublicPreviewService(session, user, settings.max_dashboard_bytes).project(
        project_id
    )


@router.get(
    "/public/project/{project_id}/dashboard",
    response_model=PublicDashboardDataRead,
    tags=["public-previews"],
)
def get_latest_public_dashboard_preview(
    project_id: str,
    response: Response,
    session: Session = Depends(get_session),
    user: Optional[AppUser] = Depends(get_optional_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    _private_preview_response(response)
    return PublicPreviewService(
        session, user, settings.max_dashboard_bytes
    ).latest_dashboard(project_id)


@router.get(
    "/public/conversation/{conversation_id}/dashboard",
    response_model=PublicDashboardDataRead,
    tags=["public-previews"],
)
def get_public_dashboard_preview(
    conversation_id: str,
    response: Response,
    project_id: str = Query(),
    session: Session = Depends(get_session),
    user: Optional[AppUser] = Depends(get_optional_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    _private_preview_response(response)
    return PublicPreviewService(session, user, settings.max_dashboard_bytes).dashboard(
        project_id, conversation_id
    )


@router.post(
    "/user/project/create",
    response_model=LegacyProjectRead,
    tags=["compatibility-projects"],
)
def legacy_create_project(
    payload: ProjectCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    project = ProjectService(session, user.id).create(payload.name, payload.description)
    return LegacyProjectService(session, user.id).serialize(project)


@router.get(
    "/user/project/list",
    response_model=LegacyProjectListRead,
    tags=["compatibility-projects"],
)
def legacy_list_projects(
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return {"projects": LegacyProjectService(session, user.id).list()}


@router.get(
    "/user/project/recent",
    response_model=LegacyProjectListRead,
    tags=["compatibility-projects"],
)
def legacy_recent_projects(
    limit: int = Query(default=10, ge=1, le=100),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return {"projects": LegacyProjectService(session, user.id).list(limit)}


@router.get(
    "/user/project/detail/{project_id}",
    response_model=LegacyProjectRead,
    tags=["compatibility-projects"],
)
def legacy_get_project(
    project_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    project = ProjectService(session, user.id).get(project_id)
    return LegacyProjectService(session, user.id).serialize(project)


@router.put(
    "/user/project/{project_id}",
    response_model=LegacyProjectRead,
    tags=["compatibility-projects"],
)
def legacy_update_project(
    project_id: str,
    payload: ProjectUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    project = ProjectService(session, user.id).update(
        project_id, payload.model_dump(exclude_unset=True)
    )
    return LegacyProjectService(session, user.id).serialize(project)


@router.delete("/user/project/{project_id}", tags=["compatibility-projects"])
def legacy_delete_project(
    project_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    ProjectService(session, user.id).delete(project_id)
    return {"success": True}


@router.get(
    "/user/asset/list",
    response_model=LegacyAssetListRead,
    tags=["compatibility-assets"],
)
def legacy_list_assets(
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    storage: ObjectStorage = Depends(get_storage),
):
    return {"assets": LegacyAssetService(session, user.id, storage).list()}


@router.get(
    "/user/asset/{asset_id}",
    response_model=LegacyAssetRead,
    tags=["compatibility-assets"],
)
def legacy_get_asset(
    asset_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    storage: ObjectStorage = Depends(get_storage),
):
    return LegacyAssetService(session, user.id, storage).get(asset_id)


@router.delete("/user/asset/{asset_id}", tags=["compatibility-assets"])
def legacy_delete_asset(
    asset_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    AssetService(session, user.id).delete(asset_id)
    return {"success": True}


@router.get("/user/asset/{asset_id}/download-url", tags=["compatibility-assets"])
def legacy_asset_download(
    asset_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    storage: ObjectStorage = Depends(get_storage),
):
    return LegacyAssetService(session, user.id, storage).download(asset_id)


@router.post(
    "/uploads/intents/{reservation_id}/finalize",
    response_model=AssetRead,
    tags=["compatibility-uploads"],
)
def finalize_upload_alias(
    reservation_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return UploadService(session, user.id, settings, storage).finalize(reservation_id)


@router.api_route("/user/asset/{action:path}", methods=["POST"], tags=["disabled"])
def legacy_asset_mutation_disabled(action: str, _user=Depends(get_current_user)):
    raise feature_disabled("legacy asset mutation")


@router.get(
    "/files/preview/{asset_id}",
    response_model=FilePreviewRead,
    tags=["compatibility-assets"],
)
def preview_file(
    asset_id: str,
    limit: int = Query(default=100, ge=1, le=5_000),
    offset: int = Query(default=0, ge=0, le=100_000),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return FilePreviewService(session, user.id, settings, storage).bounded_read(
        asset_id, limit, offset
    )


@router.get(
    "/dashboard/{action:path}",
    tags=["disabled"],
    operation_id="legacy_dashboard_disabled_get",
)
@router.post(
    "/dashboard/{action:path}",
    tags=["disabled"],
    operation_id="legacy_dashboard_disabled_post",
)
@router.put(
    "/dashboard/{action:path}",
    tags=["disabled"],
    operation_id="legacy_dashboard_disabled_put",
)
@router.patch(
    "/dashboard/{action:path}",
    tags=["disabled"],
    operation_id="legacy_dashboard_disabled_patch",
)
@router.delete(
    "/dashboard/{action:path}",
    tags=["disabled"],
    operation_id="legacy_dashboard_disabled_delete",
)
def legacy_dashboard_disabled(action: str, _user=Depends(get_current_user)):
    raise feature_disabled("legacy dashboard generation")


@router.get(
    "/integration/{action:path}",
    tags=["disabled"],
    operation_id="legacy_integration_disabled_get",
)
@router.post(
    "/integration/{action:path}",
    tags=["disabled"],
    operation_id="legacy_integration_disabled_post",
)
@router.put(
    "/integration/{action:path}",
    tags=["disabled"],
    operation_id="legacy_integration_disabled_put",
)
@router.patch(
    "/integration/{action:path}",
    tags=["disabled"],
    operation_id="legacy_integration_disabled_patch",
)
@router.delete(
    "/integration/{action:path}",
    tags=["disabled"],
    operation_id="legacy_integration_disabled_delete",
)
def legacy_integration_disabled(action: str, _user=Depends(get_current_user)):
    raise feature_disabled("external connectors")
