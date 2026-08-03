"""Persist immutable provider snapshots and durable model-call effects.

Revision ID: 0008_workflow_provider_effects
Revises: 0007_workflow_dispatch_leases
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0008_workflow_provider_effects"
down_revision: Optional[str] = "0007_workflow_dispatch_leases"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("workflow_runs") as batch:
        batch.add_column(
            sa.Column(
                "provider_mode", sa.String(16), nullable=False, server_default="demo"
            )
        )
        batch.add_column(
            sa.Column(
                "provider_name", sa.String(32), nullable=False, server_default="demo"
            )
        )
        batch.add_column(
            sa.Column(
                "provider_model",
                sa.String(128),
                nullable=False,
                server_default="deterministic-v1",
            )
        )
        batch.add_column(
            sa.Column("provider_encrypted_api_key", sa.Text(), nullable=True)
        )
        batch.add_column(
            sa.Column("provider_key_version", sa.String(32), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "provider_call_count", sa.Integer(), nullable=False, server_default="0"
            )
        )
        batch.create_check_constraint(
            "ck_workflow_run_provider_call_count",
            "provider_call_count BETWEEN 0 AND 5",
        )
    op.create_table(
        "workflow_provider_calls",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("call_key", sa.String(128), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("run_id", "call_key", name="uq_workflow_provider_call_key"),
        sa.UniqueConstraint(
            "run_id", "ordinal", name="uq_workflow_provider_call_ordinal"
        ),
        sa.CheckConstraint(
            "ordinal BETWEEN 1 AND 5",
            name="ck_workflow_provider_call_ordinal",
        ),
    )
    op.create_index(
        "ix_workflow_provider_calls_run_id", "workflow_provider_calls", ["run_id"]
    )


def downgrade() -> None:
    op.drop_table("workflow_provider_calls")
    with op.batch_alter_table("workflow_runs") as batch:
        batch.drop_constraint("ck_workflow_run_provider_call_count", type_="check")
        batch.drop_column("provider_call_count")
        batch.drop_column("provider_key_version")
        batch.drop_column("provider_encrypted_api_key")
        batch.drop_column("provider_model")
        batch.drop_column("provider_name")
        batch.drop_column("provider_mode")
