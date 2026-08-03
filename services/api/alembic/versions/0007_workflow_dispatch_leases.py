"""Add database-durable workflow dispatch leases and receipts.

Revision ID: 0007_workflow_dispatch_leases
Revises: 0006_project_members
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0007_workflow_dispatch_leases"
down_revision: Optional[str] = "0006_project_members"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("workflow_runs") as batch:
        batch.add_column(sa.Column("dispatch_lease_id", sa.String(36), nullable=True))
        batch.add_column(
            sa.Column(
                "dispatch_lease_expires_at", sa.DateTime(timezone=True), nullable=True
            )
        )
        batch.add_column(
            sa.Column("dispatch_started_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "dispatch_attempts",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("workflow_runs") as batch:
        batch.drop_column("dispatch_attempts")
        batch.drop_column("dispatch_started_at")
        batch.drop_column("dispatch_lease_expires_at")
        batch.drop_column("dispatch_lease_id")
