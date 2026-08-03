"""Authenticated project-member routes for Operator Briefs."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.platform.auth import get_current_user
from app.platform.database import (
    ensure_database_write_capacity,
    get_runtime_settings,
    get_session,
)
from app.platform.models import AppUser, OperatorBrief
from app.platform.operator_brief_schemas import (
    OperatorBriefCreate,
    OperatorBriefOutcomeUpdate,
    OperatorBriefRead,
)
from app.platform.operator_brief_service import OperatorBriefService
from app.platform.settings import Settings

router = APIRouter(prefix="/api/v1", tags=["operator-briefs"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[AppUser, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(get_runtime_settings)]
ProjectFilter = Annotated[str | None, Query(min_length=1, max_length=36)]
BriefLimit = Annotated[int, Query(ge=1, le=100)]


def service(
    session: SessionDep,
    user: UserDep,
) -> OperatorBriefService:
    return OperatorBriefService(session, user.id)


BriefServiceDep = Annotated[OperatorBriefService, Depends(service)]


@router.get("/operator-briefs", response_model=list[OperatorBriefRead])
def list_operator_briefs(
    briefs: BriefServiceDep,
    project_id: ProjectFilter = None,
    limit: BriefLimit = 50,
) -> list[OperatorBrief]:
    return briefs.list(limit, project_id)


@router.get("/operator-briefs/{brief_id}", response_model=OperatorBriefRead)
def get_operator_brief(
    brief_id: str,
    briefs: BriefServiceDep,
) -> OperatorBrief:
    return briefs.get(brief_id)


@router.patch("/operator-briefs/{brief_id}/outcome", response_model=OperatorBriefRead)
def attach_operator_brief_outcome(
    brief_id: str,
    payload: OperatorBriefOutcomeUpdate,
    briefs: BriefServiceDep,
    settings: SettingsDep,
) -> OperatorBrief:
    ensure_database_write_capacity(briefs.session, settings)
    return briefs.attach_outcome(brief_id, payload)


@router.get(
    "/projects/{project_id}/operator-briefs",
    response_model=list[OperatorBriefRead],
)
def list_project_operator_briefs(
    project_id: str,
    briefs: BriefServiceDep,
    limit: BriefLimit = 50,
) -> list[OperatorBrief]:
    return briefs.list(limit, project_id)


@router.post(
    "/projects/{project_id}/operator-briefs",
    response_model=OperatorBriefRead,
    status_code=status.HTTP_201_CREATED,
)
def create_operator_brief(
    project_id: str,
    payload: OperatorBriefCreate,
    briefs: BriefServiceDep,
    settings: SettingsDep,
) -> OperatorBrief:
    ensure_database_write_capacity(briefs.session, settings)
    return briefs.create(project_id, payload)
