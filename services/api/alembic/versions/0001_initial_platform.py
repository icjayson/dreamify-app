"""Create clean Dreamify platform schema.

Revision ID: 0001_initial_platform
Revises:
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0001_initial_platform"
down_revision: Optional[str] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def timestamps() -> list:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "app_users",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("display_name", sa.String(160), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        *timestamps(),
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])
    op.create_table(
        "stored_objects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("backend", sa.String(32), nullable=False),
        sa.Column("pathname", sa.String(1024), nullable=False, unique=True),
        sa.Column("url", sa.String(2048), nullable=True),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("etag", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_stored_objects_owner_id", "stored_objects", ["owner_id"])
    op.create_table(
        "upload_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("client_request_id", sa.String(128), nullable=True),
        sa.Column("pathname", sa.String(1024), nullable=False, unique=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("asset_type", sa.String(32), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("expected_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("expected_sha256", sa.String(64), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("uploaded_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("uploaded_etag", sa.String(255), nullable=True),
        sa.Column(
            "stored_object_id",
            sa.String(36),
            sa.ForeignKey("stored_objects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("asset_id", sa.String(36), nullable=True, unique=True),
        *timestamps(),
        sa.UniqueConstraint("owner_id", "idempotency_key", name="uq_upload_owner_key"),
        sa.UniqueConstraint(
            "owner_id",
            "client_request_id",
            name="uq_upload_owner_client_request",
        ),
    )
    op.create_index(
        "ix_upload_reservations_owner_id", "upload_reservations", ["owner_id"]
    )
    op.create_index(
        "ix_upload_reservations_project_id", "upload_reservations", ["project_id"]
    )
    op.create_table(
        "assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "stored_object_id",
            sa.String(36),
            sa.ForeignKey("stored_objects.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("asset_type", sa.String(32), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_assets_owner_id", "assets", ["owner_id"])
    op.create_index("ix_assets_project_id", "assets", ["project_id"])
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("active_run_id", sa.String(36), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_conversations_owner_id", "conversations", ["owner_id"])
    op.create_index("ix_conversations_project_id", "conversations", ["project_id"])
    op.create_table(
        "dashboards",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_dashboards_owner_id", "dashboards", ["owner_id"])
    op.create_index("ix_dashboards_project_id", "dashboards", ["project_id"])
    op.create_index("ix_dashboards_conversation_id", "dashboards", ["conversation_id"])
    op.create_table(
        "dashboard_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "dashboard_id",
            sa.String(36),
            sa.ForeignKey("dashboards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("edit_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("dashboard_id", "version", name="uq_dashboard_version"),
    )
    op.create_index(
        "ix_dashboard_versions_dashboard_id", "dashboard_versions", ["dashboard_id"]
    )
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "parent_run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("client_request_id", sa.String(128), nullable=True),
        sa.Column("request_fingerprint", sa.String(64), nullable=True),
        sa.Column("workflow_name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_step", sa.String(32), nullable=False),
        sa.Column("response_type", sa.String(40), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("input", sa.JSON(), nullable=False),
        sa.Column("output", sa.JSON(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("response_artifact", sa.JSON(), nullable=True),
        sa.Column("error", sa.JSON(), nullable=True),
        sa.Column("cancel_reason", sa.String(256), nullable=True),
        sa.Column("workflow_execution_id", sa.String(128), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sandbox_name", sa.String(255), nullable=True),
        sa.Column("sandbox_id", sa.String(255), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
        sa.UniqueConstraint(
            "owner_id",
            "client_request_id",
            name="uq_workflow_owner_client_request",
        ),
    )
    op.create_index("ix_workflow_runs_owner_id", "workflow_runs", ["owner_id"])
    op.create_index("ix_workflow_runs_project_id", "workflow_runs", ["project_id"])
    op.create_index(
        "ix_workflow_runs_conversation_id", "workflow_runs", ["conversation_id"]
    )
    op.create_index("ix_workflow_runs_status", "workflow_runs", ["status"])
    op.create_table(
        "workflow_run_assets",
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "asset_id",
            sa.String(36),
            sa.ForeignKey("assets.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "workflow_step_journals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_key", sa.String(128), nullable=False),
        sa.Column("step", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("result_sha256", sa.String(64), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("run_id", "step_key", name="uq_workflow_step_key"),
    )
    op.create_index(
        "ix_workflow_step_journals_run_id", "workflow_step_journals", ["run_id"]
    )
    op.create_table(
        "workflow_artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "stored_object_id",
            sa.String(36),
            sa.ForeignKey("stored_objects.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "run_id",
            "idempotency_key",
            name="uq_workflow_artifact_operation",
        ),
    )
    op.create_index(
        "ix_workflow_artifacts_owner_id", "workflow_artifacts", ["owner_id"]
    )
    op.create_index("ix_workflow_artifacts_run_id", "workflow_artifacts", ["run_id"])
    op.create_table(
        "workflow_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_key", sa.String(128), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "payload_object_id",
            sa.String(36),
            sa.ForeignKey("stored_objects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("run_id", "sequence", name="uq_workflow_event_sequence"),
        sa.UniqueConstraint("run_id", "event_key", name="uq_workflow_event_key"),
    )
    op.create_index("ix_workflow_events_owner_id", "workflow_events", ["owner_id"])
    op.create_index("ix_workflow_events_run_id", "workflow_events", ["run_id"])
    op.create_index(
        "ix_workflow_events_run_created", "workflow_events", ["run_id", "created_at"]
    )
    op.create_table(
        "workflow_slots",
        sa.Column("slot_number", sa.Integer(), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
        sa.Column("lease_id", sa.String(36), nullable=True, unique=True),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("workflow_slots")
    op.drop_table("workflow_events")
    op.drop_table("workflow_artifacts")
    op.drop_table("workflow_step_journals")
    op.drop_table("workflow_run_assets")
    op.drop_table("workflow_runs")
    op.drop_table("dashboard_versions")
    op.drop_table("dashboards")
    op.drop_table("conversations")
    op.drop_table("assets")
    op.drop_table("upload_reservations")
    op.drop_table("stored_objects")
    op.drop_table("projects")
    op.drop_table("app_users")
