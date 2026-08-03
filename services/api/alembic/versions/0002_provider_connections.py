"""Add encrypted tenant-scoped model provider connections.

Revision ID: 0002_provider_connections
Revises: 0001_initial_platform
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0002_provider_connections"
down_revision: Optional[str] = "0001_initial_platform"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "provider_connections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("encrypted_api_key", sa.Text(), nullable=False),
        sa.Column("key_version", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "owner_id",
            "provider",
            name="uq_provider_connection_owner_provider",
        ),
    )
    op.create_index(
        "ix_provider_connections_owner_id",
        "provider_connections",
        ["owner_id"],
    )
    op.create_index(
        "uq_provider_connections_owner_active",
        "provider_connections",
        ["owner_id"],
        unique=True,
        sqlite_where=sa.text("is_active = 1"),
        postgresql_where=sa.text("is_active"),
    )
    with op.batch_alter_table("workflow_runs") as batch:
        batch.add_column(
            sa.Column("provider_connection_id", sa.String(36), nullable=True)
        )
        batch.create_foreign_key(
            "fk_workflow_runs_provider_connection",
            "provider_connections",
            ["provider_connection_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index(
            "ix_workflow_runs_provider_connection_id",
            ["provider_connection_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("workflow_runs") as batch:
        batch.drop_index("ix_workflow_runs_provider_connection_id")
        batch.drop_constraint(
            "fk_workflow_runs_provider_connection",
            type_="foreignkey",
        )
        batch.drop_column("provider_connection_id")
    op.drop_index(
        "uq_provider_connections_owner_active",
        table_name="provider_connections",
    )
    op.drop_index(
        "ix_provider_connections_owner_id",
        table_name="provider_connections",
    )
    op.drop_table("provider_connections")
