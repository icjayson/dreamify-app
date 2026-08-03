"""Add explicit dashboard preview visibility and viewer grants.

Revision ID: 0004_project_previews
Revises: 0003_daily_run_usage
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0004_project_previews"
down_revision: Optional[str] = "0003_daily_run_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column(
                "is_preview_public",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
    op.create_table(
        "project_preview_grants",
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
            nullable=True,
        ),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "user_id IS NOT NULL OR email IS NOT NULL",
            name="ck_project_preview_grant_identity",
        ),
        sa.UniqueConstraint(
            "project_id", "user_id", name="uq_project_preview_grant_user"
        ),
        sa.UniqueConstraint(
            "project_id", "email", name="uq_project_preview_grant_email"
        ),
    )
    op.create_index(
        "ix_project_preview_grants_project_id",
        "project_preview_grants",
        ["project_id"],
    )
    op.create_index(
        "ix_project_preview_grants_user_id",
        "project_preview_grants",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_project_preview_grants_user_id", table_name="project_preview_grants"
    )
    op.drop_index(
        "ix_project_preview_grants_project_id", table_name="project_preview_grants"
    )
    op.drop_table("project_preview_grants")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("is_preview_public")
