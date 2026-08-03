"""Add persisted daily run quotas and data-run classification.

Revision ID: 0003_daily_run_usage
Revises: 0002_provider_connections
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0003_daily_run_usage"
down_revision: Optional[str] = "0002_provider_connections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE_DATA_RUN_PREDICATE = sa.text(
    "run_kind = 'data' AND status IN ('queued', 'running', 'cancelling')"
)


def upgrade() -> None:
    op.create_table(
        "daily_run_usage",
        sa.Column("usage_date", sa.Date(), primary_key=True),
        sa.Column("scope", sa.String(16), primary_key=True),
        sa.Column("subject_id", sa.String(255), primary_key=True),
        sa.Column("run_kind", sa.String(16), primary_key=True),
        sa.Column("run_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "scope IN ('user', 'deployment')",
            name="ck_daily_run_usage_scope",
        ),
        sa.CheckConstraint(
            "run_kind IN ('data', 'text')",
            name="ck_daily_run_usage_kind",
        ),
        sa.CheckConstraint(
            "run_count >= 0",
            name="ck_daily_run_usage_count",
        ),
    )
    with op.batch_alter_table("workflow_runs") as batch:
        batch.add_column(
            sa.Column(
                "run_kind",
                sa.String(16),
                nullable=False,
                server_default="text",
            )
        )
    op.execute(
        sa.text(
            "WITH RECURSIVE data_run_tree(id) AS ("
            "SELECT workflow_runs.id FROM workflow_runs "
            "WHERE EXISTS ("
            "SELECT 1 FROM workflow_run_assets "
            "WHERE workflow_run_assets.run_id = workflow_runs.id"
            ") UNION "
            "SELECT child.id FROM workflow_runs AS child "
            "JOIN data_run_tree AS parent ON child.parent_run_id = parent.id"
            ") UPDATE workflow_runs SET run_kind = 'data' "
            "WHERE id IN (SELECT id FROM data_run_tree)"
        )
    )
    op.create_index(
        "uq_workflow_runs_owner_active_data",
        "workflow_runs",
        ["owner_id"],
        unique=True,
        sqlite_where=ACTIVE_DATA_RUN_PREDICATE,
        postgresql_where=ACTIVE_DATA_RUN_PREDICATE,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_workflow_runs_owner_active_data",
        table_name="workflow_runs",
    )
    with op.batch_alter_table("workflow_runs") as batch:
        batch.drop_column("run_kind")
    op.drop_table("daily_run_usage")
