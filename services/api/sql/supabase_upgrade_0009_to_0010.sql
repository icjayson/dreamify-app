-- Upgrade an existing Dreamify Supabase schema from Alembic 0009 to 0010.
-- Safe to re-run at 0010. This script never drops tables or data.
-- For any earlier revision, use Alembic instead of skipping migrations.

BEGIN;

DO $$
DECLARE
    current_revision text;
    table_name text;
    expected_tables text[] := ARRAY[
        'alembic_version',
        'app_users',
        'projects',
        'stored_objects',
        'upload_reservations',
        'assets',
        'conversations',
        'dashboards',
        'dashboard_versions',
        'workflow_runs',
        'workflow_run_assets',
        'workflow_step_journals',
        'workflow_artifacts',
        'workflow_events',
        'workflow_slots',
        'provider_connections',
        'daily_run_usage',
        'project_preview_grants',
        'notifications',
        'feedback_submissions',
        'overall_feedback_submissions',
        'blog_posts',
        'project_members',
        'workflow_provider_calls',
        'operator_briefs'
    ];
BEGIN
    IF to_regclass('public.alembic_version') IS NULL THEN
        RAISE EXCEPTION
            'Dreamify alembic_version is missing; apply supabase_schema.sql only to an empty database';
    END IF;

    SELECT version_num
    INTO STRICT current_revision
    FROM public.alembic_version;

    IF current_revision NOT IN ('0009_operator_briefs', '0010_enable_supabase_rls') THEN
        RAISE EXCEPTION
            'Expected Dreamify revision 0009 or 0010, found %. Run Alembic upgrade head instead.',
            current_revision;
    END IF;

    FOREACH table_name IN ARRAY expected_tables LOOP
        IF to_regclass(format('public.%I', table_name)) IS NULL THEN
            RAISE EXCEPTION
                'Dreamify schema is incomplete: missing public.%', table_name;
        END IF;
        EXECUTE format(
            'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
            table_name
        );
    END LOOP;

    IF current_revision = '0009_operator_briefs' THEN
        UPDATE public.alembic_version
        SET version_num = '0010_enable_supabase_rls'
        WHERE version_num = '0009_operator_briefs';
    END IF;
END
$$;

COMMIT;

SELECT version_num AS dreamify_schema_revision
FROM public.alembic_version;
