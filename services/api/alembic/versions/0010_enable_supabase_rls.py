"""Enable fail-closed RLS for every Dreamify-owned public table.

Revision ID: 0010_enable_supabase_rls
Revises: 0009_operator_briefs
"""

from alembic import op


revision = "0010_enable_supabase_rls"
down_revision = "0009_operator_briefs"
branch_labels = None
depends_on = None


PUBLIC_TABLES = (
    "alembic_version",
    "app_users",
    "projects",
    "stored_objects",
    "upload_reservations",
    "assets",
    "conversations",
    "dashboards",
    "dashboard_versions",
    "workflow_runs",
    "workflow_run_assets",
    "workflow_step_journals",
    "workflow_artifacts",
    "workflow_events",
    "workflow_slots",
    "provider_connections",
    "daily_run_usage",
    "project_preview_grants",
    "notifications",
    "feedback_submissions",
    "overall_feedback_submissions",
    "blog_posts",
    "project_members",
    "workflow_provider_calls",
    "operator_briefs",
)


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table_name in PUBLIC_TABLES:
        op.execute(f'ALTER TABLE public."{table_name}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table_name in PUBLIC_TABLES:
        op.execute(f'ALTER TABLE public."{table_name}" DISABLE ROW LEVEL SECURITY')
