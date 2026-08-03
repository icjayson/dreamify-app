"""Service-authenticated routes used by the durable workflow adapter."""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.platform.auth import require_internal_service
from app.platform.database import get_runtime_settings, get_session
from app.platform.dispatch_coordination import DispatchCoordinator, DispatchLease
from app.platform.internal_workflow import InternalWorkflowService, serialize_run
from app.platform.providers import InternalProviderService
from app.platform.routes import get_storage
from app.platform.schemas import (
    InternalProviderCredentialRead,
    InternalRunEnvelope,
    InternalWorkflowCancelRequest,
    WorkflowArtifactCreate,
    WorkflowArtifactEnvelope,
    WorkflowArtifactValueRead,
    WorkflowCapacityAcquireRequest,
    WorkflowCapacityReleaseRequest,
    WorkflowClaimRead,
    WorkflowClaimRequest,
    WorkflowContextEnvelope,
    WorkflowDispatchAuthorizeRequest,
    WorkflowDispatchReceiptRequest,
    WorkflowDispatchStateRead,
    WorkflowLeaseEnvelope,
    WorkflowProviderCallRead,
    WorkflowProviderCallReserveRequest,
    WorkflowResponseCommitRequest,
    WorkflowResponseRead,
    WorkflowStepBeginRequest,
    WorkflowStepCompleteRequest,
    WorkflowStepResultRead,
    WorkflowTransitionRequest,
)
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage

router = APIRouter(
    prefix="/api/v1/internal/workflow",
    tags=["internal-workflow"],
    dependencies=[Depends(require_internal_service)],
)


def dispatch_state(lease: DispatchLease) -> dict:
    return {
        "outcome": lease.outcome,
        "dispatch_lease_id": lease.lease_id,
        "workflow_execution_id": lease.workflow_execution_id,
    }


@router.post(
    "/runs/{run_id}/dispatch/authorize", response_model=WorkflowDispatchStateRead
)
def authorize_dispatch(
    run_id: str,
    payload: WorkflowDispatchAuthorizeRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return dispatch_state(
        DispatchCoordinator(session, settings).authorize(
            run_id, payload.dispatch_lease_id
        )
    )


@router.post(
    "/runs/{run_id}/dispatch/receipt", response_model=WorkflowDispatchStateRead
)
def record_dispatch_receipt(
    run_id: str,
    payload: WorkflowDispatchReceiptRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
):
    return dispatch_state(
        DispatchCoordinator(session, settings).record(
            run_id,
            payload.dispatch_lease_id,
            payload.workflow_execution_id,
        )
    )


def service(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
) -> InternalWorkflowService:
    return InternalWorkflowService(session, settings, storage)


def provider_service(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
) -> InternalProviderService:
    return InternalProviderService(session, settings)


@router.post("/runs/{run_id}/claim", response_model=WorkflowClaimRead)
def claim_run(
    run_id: str,
    payload: WorkflowClaimRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    outcome, run = workflow.claim(run_id, payload)
    return {"outcome": outcome, "run": serialize_run(run)}


@router.get("/runs/{run_id}", response_model=InternalRunEnvelope)
def get_run(
    run_id: str,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"run": serialize_run(workflow.get_run(run_id))}


@router.get("/runs/{run_id}/context", response_model=WorkflowContextEnvelope)
def get_context(
    run_id: str,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"context": workflow.context(run_id)}


@router.post(
    "/runs/{run_id}/provider-calls/reserve",
    response_model=WorkflowProviderCallRead,
)
def reserve_provider_call(
    run_id: str,
    payload: WorkflowProviderCallReserveRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    return workflow.reserve_provider_call(run_id, payload)


@router.post(
    "/runs/{run_id}/provider/resolve",
    response_model=InternalProviderCredentialRead,
)
def resolve_provider(
    run_id: str,
    response: Response,
    providers: InternalProviderService = Depends(provider_service),
):
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return providers.resolve(run_id)


@router.post("/runs/{run_id}/steps/{step_key}/begin", status_code=204)
def begin_step(
    run_id: str,
    step_key: str,
    payload: WorkflowStepBeginRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    workflow.begin_step(run_id, step_key, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/runs/{run_id}/steps/{step_key}", response_model=WorkflowStepResultRead)
def get_step_result(
    run_id: str,
    step_key: str,
    workflow: InternalWorkflowService = Depends(service),
):
    return workflow.step_result(run_id, step_key)


@router.put("/runs/{run_id}/steps/{step_key}", status_code=204)
def complete_step(
    run_id: str,
    step_key: str,
    payload: WorkflowStepCompleteRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    workflow.complete_step(run_id, step_key, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/runs/{run_id}/transition", response_model=InternalRunEnvelope)
def transition_run(
    run_id: str,
    payload: WorkflowTransitionRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"run": serialize_run(workflow.transition(run_id, payload))}


@router.post("/runs/{run_id}/response", response_model=InternalRunEnvelope)
def commit_response(
    run_id: str,
    payload: WorkflowResponseCommitRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"run": serialize_run(workflow.commit_response(run_id, payload))}


@router.get("/runs/{run_id}/response", response_model=WorkflowResponseRead)
def get_response(
    run_id: str,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"response": workflow.response(run_id)}


@router.post("/runs/{run_id}/cancel", response_model=InternalRunEnvelope)
def cancel_run(
    run_id: str,
    payload: InternalWorkflowCancelRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"run": serialize_run(workflow.request_cancellation(run_id, payload))}


@router.post("/runs/{run_id}/artifacts", response_model=WorkflowArtifactEnvelope)
def put_artifact(
    run_id: str,
    payload: WorkflowArtifactCreate,
    workflow: InternalWorkflowService = Depends(service),
):
    artifact = workflow.put_artifact(run_id, payload)
    return {
        "artifact": {
            "object_id": artifact.stored_object_id,
            "kind": artifact.kind,
            "size_bytes": artifact.size_bytes,
            "sha256": artifact.checksum_sha256,
        }
    }


@router.get(
    "/runs/{run_id}/artifacts/{object_id}", response_model=WorkflowArtifactValueRead
)
def get_artifact(
    run_id: str,
    object_id: str,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"value": workflow.get_artifact(run_id, object_id)}


@router.post("/capacity/acquire", response_model=WorkflowLeaseEnvelope)
def acquire_capacity(
    payload: WorkflowCapacityAcquireRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    return {"lease": workflow.acquire_capacity(payload)}


@router.post("/capacity/release", status_code=204)
def release_capacity(
    payload: WorkflowCapacityReleaseRequest,
    workflow: InternalWorkflowService = Depends(service),
):
    workflow.release_capacity(payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
