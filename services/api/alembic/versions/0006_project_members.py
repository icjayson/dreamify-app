"""Add project membership roles and backfill project owners.

Revision ID: 0006_project_members
Revises: 0005_core_support
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0006_project_members"
down_revision: Optional[str] = "0005_core_support"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "role IN ('owner', 'editor', 'viewer')",
            name="ck_project_members_role",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'inactive')",
            name="ck_project_members_status",
        ),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_member_user"),
    )
    op.create_index("ix_project_members_project_id", "project_members", ["project_id"])
    op.create_index("ix_project_members_user_id", "project_members", ["user_id"])
    op.create_index(
        "ix_project_members_user_status",
        "project_members",
        ["user_id", "status"],
    )
    op.execute(
        sa.text(
            """
            INSERT INTO project_members
                (id, project_id, user_id, role, status, created_at, updated_at)
            SELECT id, id, owner_id, 'owner', 'active', created_at, updated_at
            FROM projects
            """
        )
    )


def downgrade() -> None:
    op.drop_table("project_members")
