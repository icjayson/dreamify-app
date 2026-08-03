"""Tenant-safe persistence and application service for Operator Briefs."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.platform.errors import ApiError, not_found
from app.platform.models import (
    Asset,
    OperatorBrief,
    ProjectMember,
    WorkflowRun,
    utc_now,
)
from app.platform.operator_brief_domain import (
    ComposedOperatorBrief,
    build_metric_snapshot,
    compose_brief,
    detect_changes,
    serialize_changes,
)
from app.platform.operator_brief_schemas import (
    OperatorBriefCreate,
    OperatorBriefOutcomeUpdate,
)
from app.platform.repositories import (
    READ_PROJECT_ROLES,
    WRITE_PROJECT_ROLES,
    ProjectRepository,
)

BRIEF_RETENTION_DAYS = 730


class OperatorBriefRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_accessible(
        self, actor_id: str, limit: int, project_id: str | None = None
    ) -> list[OperatorBrief]:
        query = (
            select(OperatorBrief)
            .join(ProjectMember, ProjectMember.project_id == OperatorBrief.project_id)
            .where(
                ProjectMember.user_id == actor_id,
                ProjectMember.status == "active",
            )
            .order_by(OperatorBrief.created_at.desc(), OperatorBrief.id.desc())
            .limit(limit)
        )
        if project_id is not None:
            query = query.where(OperatorBrief.project_id == project_id)
        return list(self.session.scalars(query).all())

    def get_accessible(
        self, actor_id: str, brief_id: str, for_update: bool = False
    ) -> tuple[OperatorBrief, ProjectMember] | None:
        query = (
            select(OperatorBrief, ProjectMember)
            .join(ProjectMember, ProjectMember.project_id == OperatorBrief.project_id)
            .where(
                OperatorBrief.id == brief_id,
                ProjectMember.user_id == actor_id,
                ProjectMember.status == "active",
            )
        )
        if for_update:
            query = query.with_for_update(of=OperatorBrief)
        row = self.session.execute(query).one_or_none()
        return (row[0], row[1]) if row else None

    def latest_snapshot(
        self,
        project_id: str,
        provider: str,
        account_name: str,
        schedule_id: str | None,
    ) -> dict | None:
        query = select(OperatorBrief.metric_snapshot).where(
            OperatorBrief.project_id == project_id,
            OperatorBrief.provider == provider,
            OperatorBrief.account_name == account_name,
        )
        query = (
            query.where(OperatorBrief.schedule_id == schedule_id)
            if schedule_id
            else query.where(OperatorBrief.schedule_id.is_(None))
        )
        return self.session.scalar(
            query.order_by(OperatorBrief.created_at.desc(), OperatorBrief.id.desc())
        )

    def by_run(self, project_id: str, run_id: str) -> OperatorBrief | None:
        return self.session.scalar(
            select(OperatorBrief).where(
                OperatorBrief.project_id == project_id,
                OperatorBrief.run_id == run_id,
            )
        )

    def create(self, **values: object) -> OperatorBrief:
        brief = OperatorBrief(**values)
        self.session.add(brief)
        self.session.flush()
        return brief


class OperatorBriefService:
    def __init__(self, session: Session, actor_id: str) -> None:
        self.session = session
        self.actor_id = actor_id
        self.repository = OperatorBriefRepository(session)

    def list(self, limit: int, project_id: str | None = None) -> list[OperatorBrief]:
        if project_id is not None:
            self._require_project(project_id, READ_PROJECT_ROLES)
        return self.repository.list_accessible(self.actor_id, limit, project_id)

    def get(self, brief_id: str) -> OperatorBrief:
        row = self.repository.get_accessible(self.actor_id, brief_id)
        if row is None:
            raise not_found("Operator brief")
        return row[0]

    def create(self, project_id: str, payload: OperatorBriefCreate) -> OperatorBrief:
        self._require_project(project_id, WRITE_PROJECT_ROLES)
        self._validate_sources(project_id, payload.run_id, payload.source_asset_id)
        if payload.run_id:
            existing = self.repository.by_run(project_id, payload.run_id)
            if existing:
                return existing
        snapshot = build_metric_snapshot(
            payload.metric_snapshot, payload.row_count, payload.column_count
        )
        previous = self.repository.latest_snapshot(
            project_id,
            payload.provider,
            payload.account_name,
            payload.schedule_id,
        )
        changes = detect_changes(previous, snapshot)
        composed = compose_brief(
            payload.provider,
            payload.account_name,
            changes,
            is_first_run=previous is None,
        )
        return self._persist(project_id, payload, snapshot, composed)

    def attach_outcome(
        self, brief_id: str, payload: OperatorBriefOutcomeUpdate
    ) -> OperatorBrief:
        row = self.repository.get_accessible(self.actor_id, brief_id, for_update=True)
        if row is None:
            raise not_found("Operator brief")
        brief, membership = row
        self._require_role(membership.role, WRITE_PROJECT_ROLES)
        brief.outcome = payload.outcome
        brief.updated_at = utc_now()
        self.session.flush()
        return brief

    def _persist(
        self,
        project_id: str,
        payload: OperatorBriefCreate,
        snapshot: dict[str, float],
        composed: ComposedOperatorBrief,
    ) -> OperatorBrief:
        values = {
            "project_id": project_id,
            "created_by_id": self.actor_id,
            "run_id": payload.run_id,
            "source_asset_id": payload.source_asset_id,
            "schedule_id": payload.schedule_id,
            "provider": payload.provider,
            "account_name": payload.account_name,
            "headline": composed.headline,
            "body": composed.as_text(),
            "severity": composed.severity,
            "recommendation": composed.recommendation,
            "changes": serialize_changes(composed.changes),
            "metric_snapshot": snapshot,
            "expires_at": utc_now() + timedelta(days=BRIEF_RETENTION_DAYS),
        }
        try:
            with self.session.begin_nested():
                return self.repository.create(**values)
        except IntegrityError as exc:
            if payload.run_id:
                existing = self.repository.by_run(project_id, payload.run_id)
                if existing:
                    return existing
            raise ApiError(
                409,
                "OPERATOR_BRIEF_WRITE_CONFLICT",
                "Operator brief creation conflicted",
            ) from exc

    def _require_project(self, project_id: str, roles: tuple[str, ...]) -> None:
        access = ProjectRepository(self.session).access(self.actor_id, project_id)
        if access is None:
            raise not_found("Project")
        self._require_role(access[1].role, roles)

    @staticmethod
    def _require_role(role: str, allowed_roles: tuple[str, ...]) -> None:
        if role not in allowed_roles:
            raise ApiError(
                403,
                "PROJECT_ROLE_FORBIDDEN",
                "Project write access is not allowed for this member role",
                {"role": role, "required_permission": "write"},
            )

    def _validate_sources(
        self,
        project_id: str,
        run_id: str | None,
        source_asset_id: str | None,
    ) -> None:
        for model, record_id, label in (
            (WorkflowRun, run_id, "run_id"),
            (Asset, source_asset_id, "source_asset_id"),
        ):
            if record_id is None:
                continue
            record = self.session.get(model, record_id)
            if record is None or record.project_id != project_id:
                raise ApiError(
                    422,
                    "OPERATOR_BRIEF_SOURCE_INVALID",
                    f"{label} must belong to the selected project",
                )
