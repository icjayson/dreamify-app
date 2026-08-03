"""Add notifications, feedback, and blog persistence.

Revision ID: 0005_core_support
Revises: 0004_project_previews
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0005_core_support"
down_revision: Optional[str] = "0004_project_previews"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def upgrade() -> None:
    _create_notifications()
    _create_feedback()
    _create_overall_feedback()
    _create_blog_posts()


def _create_notifications() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("read", sa.Boolean(), nullable=False),
        sa.Column("schedule_id", sa.String(128), nullable=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("provider", sa.String(80), nullable=True),
        sa.Column(
            "asset_id",
            sa.String(36),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('sync_success', 'sync_failed', 'token_expired')",
            name="ck_notifications_type",
        ),
    )
    for column in ("owner_id", "read", "created_at"):
        op.create_index(f"ix_notifications_{column}", "notifications", [column])


def _create_feedback() -> None:
    op.create_table(
        "feedback_submissions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_feedback_submissions_owner_id", "feedback_submissions", ["owner_id"]
    )
    op.create_index(
        "ix_feedback_submissions_created_at",
        "feedback_submissions",
        ["created_at"],
    )


def _create_overall_feedback() -> None:
    rating_fields = (
        "overall_rating",
        "visual_appeal_rating",
        "metrics_insights_rating",
        "layout_editing_rating",
        "share_link_rating",
    )
    op.create_table(
        "overall_feedback_submissions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(255),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        *(sa.Column(field, sa.Integer(), nullable=False) for field in rating_fields),
        sa.Column("requested_connectors", sa.Text(), nullable=False),
        sa.Column("dashboard_improvements", sa.Text(), nullable=False),
        sa.Column("export_improvements", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        *(
            sa.CheckConstraint(
                f"{field} BETWEEN 1 AND 5",
                name=f"ck_overall_feedback_{field}",
            )
            for field in rating_fields
        ),
    )
    op.create_index(
        "ix_overall_feedback_submissions_owner_id",
        "overall_feedback_submissions",
        ["owner_id"],
    )
    op.create_index(
        "ix_overall_feedback_submissions_created_at",
        "overall_feedback_submissions",
        ["created_at"],
    )


def _create_blog_posts() -> None:
    op.create_table(
        "blog_posts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("slug", sa.String(180), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.String(1000), nullable=False),
        sa.Column("content_html", sa.Text(), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=True),
        sa.Column("cover_image_url", sa.String(2048), nullable=True),
        sa.Column("cover_image_alt", sa.String(500), nullable=True),
        sa.Column("author", sa.String(160), nullable=False),
        sa.Column("persona", sa.String(160), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("target_keyword", sa.String(255), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reading_minutes", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("featured", sa.Boolean(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "status IN ('draft', 'published')", name="ck_blog_posts_status"
        ),
    )
    op.create_index("ix_blog_posts_slug", "blog_posts", ["slug"], unique=True)
    op.create_index("ix_blog_posts_status", "blog_posts", ["status"])
    op.create_index("ix_blog_posts_published_at", "blog_posts", ["published_at"])
    op.create_index(
        "uq_blog_posts_featured",
        "blog_posts",
        ["featured"],
        unique=True,
        sqlite_where=sa.text("featured = 1"),
        postgresql_where=sa.text("featured"),
    )


def downgrade() -> None:
    op.drop_table("blog_posts")
    op.drop_table("overall_feedback_submissions")
    op.drop_table("feedback_submissions")
    op.drop_table("notifications")
