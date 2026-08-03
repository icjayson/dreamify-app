"""Add the normalized tenant-scoped Operator Brief ledger.

Revision ID: 0009_operator_briefs
Revises: 0008_workflow_provider_effects
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_operator_briefs"
down_revision: str | None = "0008_workflow_provider_effects"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "operator_briefs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_asset_id",
            sa.String(36),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("schedule_id", sa.String(128), nullable=True),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("account_name", sa.String(160), nullable=False),
        sa.Column("headline", sa.String(240), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.Column("metric_snapshot", sa.JSON(), nullable=False),
        sa.Column("outcome", sa.JSON(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "severity IN ('alert', 'warn', 'info')",
            name="ck_operator_briefs_severity",
        ),
        sa.UniqueConstraint(
            "project_id", "run_id", name="uq_operator_briefs_project_run"
        ),
    )
    for column in (
        "project_id",
        "created_by_id",
        "run_id",
        "source_asset_id",
        "expires_at",
    ):
        op.create_index(f"ix_operator_briefs_{column}", "operator_briefs", [column])
    op.create_index(
        "ix_operator_briefs_project_created_at",
        "operator_briefs",
        ["project_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("operator_briefs")
