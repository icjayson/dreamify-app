-- Dreamify Platform schema for a fresh Supabase PostgreSQL database.
-- Generated from Alembic revisions 0001_initial_platform through 0009_operator_briefs.
-- Canonical source: services/api/alembic/versions/*.py
-- Every created public table has RLS enabled without public policies so Supabase's
-- Data API fails closed; Dreamify accesses these tables through FastAPI only.
--
-- Apply this file only to an empty Supabase database. For an existing deployment,
-- run Alembic with DIRECT_DATABASE_URL instead so only pending revisions execute.

BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001_initial_platform

CREATE TABLE app_users (
    id VARCHAR(255) NOT NULL, 
    email VARCHAR(320), 
    display_name VARCHAR(160), 
    status VARCHAR(32) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id)
);

CREATE TABLE projects (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    name VARCHAR(160) NOT NULL, 
    description TEXT, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE
);

CREATE INDEX ix_projects_owner_id ON projects (owner_id);

CREATE TABLE stored_objects (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    backend VARCHAR(32) NOT NULL, 
    pathname VARCHAR(1024) NOT NULL, 
    url VARCHAR(2048), 
    content_type VARCHAR(255) NOT NULL, 
    size_bytes BIGINT NOT NULL, 
    checksum_sha256 VARCHAR(64), 
    etag VARCHAR(255), 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    UNIQUE (pathname)
);

CREATE INDEX ix_stored_objects_owner_id ON stored_objects (owner_id);

CREATE TABLE upload_reservations (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    idempotency_key VARCHAR(128), 
    client_request_id VARCHAR(128), 
    pathname VARCHAR(1024) NOT NULL, 
    filename VARCHAR(255) NOT NULL, 
    asset_type VARCHAR(32) NOT NULL, 
    content_type VARCHAR(255) NOT NULL, 
    expected_size_bytes BIGINT NOT NULL, 
    expected_sha256 VARCHAR(64), 
    status VARCHAR(32) NOT NULL, 
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    uploaded_size_bytes BIGINT, 
    uploaded_etag VARCHAR(255), 
    stored_object_id VARCHAR(36), 
    asset_id VARCHAR(36), 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_upload_owner_key UNIQUE (owner_id, idempotency_key), 
    CONSTRAINT uq_upload_owner_client_request UNIQUE (owner_id, client_request_id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    UNIQUE (pathname), 
    FOREIGN KEY(stored_object_id) REFERENCES stored_objects (id) ON DELETE SET NULL, 
    UNIQUE (asset_id)
);

CREATE INDEX ix_upload_reservations_owner_id ON upload_reservations (owner_id);

CREATE INDEX ix_upload_reservations_project_id ON upload_reservations (project_id);

CREATE TABLE assets (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    stored_object_id VARCHAR(36) NOT NULL, 
    filename VARCHAR(255) NOT NULL, 
    asset_type VARCHAR(32) NOT NULL, 
    content_type VARCHAR(255) NOT NULL, 
    size_bytes BIGINT NOT NULL, 
    status VARCHAR(32) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    UNIQUE (stored_object_id), 
    FOREIGN KEY(stored_object_id) REFERENCES stored_objects (id) ON DELETE RESTRICT
);

CREATE INDEX ix_assets_owner_id ON assets (owner_id);

CREATE INDEX ix_assets_project_id ON assets (project_id);

CREATE TABLE conversations (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    project_id VARCHAR(36), 
    title VARCHAR(200) NOT NULL, 
    active_run_id VARCHAR(36), 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_conversations_owner_id ON conversations (owner_id);

CREATE INDEX ix_conversations_project_id ON conversations (project_id);

CREATE TABLE dashboards (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    conversation_id VARCHAR(36), 
    title VARCHAR(200) NOT NULL, 
    status VARCHAR(32) NOT NULL, 
    current_version INTEGER NOT NULL, 
    content JSON NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(conversation_id) REFERENCES conversations (id) ON DELETE SET NULL
);

CREATE INDEX ix_dashboards_owner_id ON dashboards (owner_id);

CREATE INDEX ix_dashboards_project_id ON dashboards (project_id);

CREATE INDEX ix_dashboards_conversation_id ON dashboards (conversation_id);

CREATE TABLE dashboard_versions (
    id VARCHAR(36) NOT NULL, 
    dashboard_id VARCHAR(36) NOT NULL, 
    version INTEGER NOT NULL, 
    content JSON NOT NULL, 
    source VARCHAR(32) NOT NULL, 
    edit_summary TEXT, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_dashboard_version UNIQUE (dashboard_id, version), 
    FOREIGN KEY(dashboard_id) REFERENCES dashboards (id) ON DELETE CASCADE
);

CREATE INDEX ix_dashboard_versions_dashboard_id ON dashboard_versions (dashboard_id);

CREATE TABLE workflow_runs (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    conversation_id VARCHAR(36), 
    parent_run_id VARCHAR(36), 
    client_request_id VARCHAR(128), 
    request_fingerprint VARCHAR(64), 
    workflow_name VARCHAR(120) NOT NULL, 
    status VARCHAR(32) NOT NULL, 
    current_step VARCHAR(32) NOT NULL, 
    response_type VARCHAR(40), 
    cancel_requested BOOLEAN NOT NULL, 
    version INTEGER NOT NULL, 
    input JSON NOT NULL, 
    output JSON, 
    result JSON, 
    response_artifact JSON, 
    error JSON, 
    cancel_reason VARCHAR(256), 
    workflow_execution_id VARCHAR(128), 
    dispatched_at TIMESTAMP WITH TIME ZONE, 
    sandbox_name VARCHAR(255), 
    sandbox_id VARCHAR(255), 
    started_at TIMESTAMP WITH TIME ZONE, 
    completed_at TIMESTAMP WITH TIME ZONE, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_workflow_owner_client_request UNIQUE (owner_id, client_request_id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(conversation_id) REFERENCES conversations (id) ON DELETE SET NULL, 
    FOREIGN KEY(parent_run_id) REFERENCES workflow_runs (id) ON DELETE SET NULL
);

CREATE INDEX ix_workflow_runs_owner_id ON workflow_runs (owner_id);

CREATE INDEX ix_workflow_runs_project_id ON workflow_runs (project_id);

CREATE INDEX ix_workflow_runs_conversation_id ON workflow_runs (conversation_id);

CREATE INDEX ix_workflow_runs_status ON workflow_runs (status);

CREATE TABLE workflow_run_assets (
    run_id VARCHAR(36) NOT NULL, 
    asset_id VARCHAR(36) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (run_id, asset_id), 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE CASCADE, 
    FOREIGN KEY(asset_id) REFERENCES assets (id) ON DELETE RESTRICT
);

CREATE TABLE workflow_step_journals (
    id VARCHAR(36) NOT NULL, 
    run_id VARCHAR(36) NOT NULL, 
    step_key VARCHAR(128) NOT NULL, 
    step VARCHAR(32) NOT NULL, 
    status VARCHAR(32) NOT NULL, 
    result JSON, 
    result_sha256 VARCHAR(64), 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_workflow_step_key UNIQUE (run_id, step_key), 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE CASCADE
);

CREATE INDEX ix_workflow_step_journals_run_id ON workflow_step_journals (run_id);

CREATE TABLE workflow_artifacts (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    run_id VARCHAR(36) NOT NULL, 
    stored_object_id VARCHAR(36) NOT NULL, 
    idempotency_key VARCHAR(128) NOT NULL, 
    kind VARCHAR(32) NOT NULL, 
    size_bytes BIGINT NOT NULL, 
    checksum_sha256 VARCHAR(64) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_workflow_artifact_operation UNIQUE (run_id, idempotency_key), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE CASCADE, 
    UNIQUE (stored_object_id), 
    FOREIGN KEY(stored_object_id) REFERENCES stored_objects (id) ON DELETE RESTRICT
);

CREATE INDEX ix_workflow_artifacts_owner_id ON workflow_artifacts (owner_id);

CREATE INDEX ix_workflow_artifacts_run_id ON workflow_artifacts (run_id);

CREATE TABLE workflow_events (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    run_id VARCHAR(36) NOT NULL, 
    sequence INTEGER NOT NULL, 
    event_key VARCHAR(128) NOT NULL, 
    event_type VARCHAR(80) NOT NULL, 
    payload JSON NOT NULL, 
    payload_object_id VARCHAR(36), 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_workflow_event_sequence UNIQUE (run_id, sequence), 
    CONSTRAINT uq_workflow_event_key UNIQUE (run_id, event_key), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE CASCADE, 
    FOREIGN KEY(payload_object_id) REFERENCES stored_objects (id) ON DELETE SET NULL
);

CREATE INDEX ix_workflow_events_owner_id ON workflow_events (owner_id);

CREATE INDEX ix_workflow_events_run_id ON workflow_events (run_id);

CREATE INDEX ix_workflow_events_run_created ON workflow_events (run_id, created_at);

CREATE TABLE workflow_slots (
    slot_number SERIAL NOT NULL, 
    run_id VARCHAR(36), 
    lease_id VARCHAR(36), 
    idempotency_key VARCHAR(128), 
    acquired_at TIMESTAMP WITH TIME ZONE, 
    lease_expires_at TIMESTAMP WITH TIME ZONE, 
    PRIMARY KEY (slot_number), 
    UNIQUE (run_id), 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE SET NULL, 
    UNIQUE (lease_id)
);

INSERT INTO alembic_version (version_num) VALUES ('0001_initial_platform') RETURNING alembic_version.version_num;

-- Running upgrade 0001_initial_platform -> 0002_provider_connections

CREATE TABLE provider_connections (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    provider VARCHAR(32) NOT NULL, 
    model VARCHAR(128) NOT NULL, 
    encrypted_api_key TEXT NOT NULL, 
    key_version VARCHAR(32) NOT NULL, 
    status VARCHAR(32) NOT NULL, 
    is_active BOOLEAN NOT NULL, 
    verified_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_provider_connection_owner_provider UNIQUE (owner_id, provider), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE
);

CREATE INDEX ix_provider_connections_owner_id ON provider_connections (owner_id);

CREATE UNIQUE INDEX uq_provider_connections_owner_active ON provider_connections (owner_id) WHERE is_active;

ALTER TABLE workflow_runs ADD COLUMN provider_connection_id VARCHAR(36);

ALTER TABLE workflow_runs ADD CONSTRAINT fk_workflow_runs_provider_connection FOREIGN KEY(provider_connection_id) REFERENCES provider_connections (id) ON DELETE SET NULL;

CREATE INDEX ix_workflow_runs_provider_connection_id ON workflow_runs (provider_connection_id);

UPDATE alembic_version SET version_num='0002_provider_connections' WHERE alembic_version.version_num = '0001_initial_platform';

-- Running upgrade 0002_provider_connections -> 0003_daily_run_usage

CREATE TABLE daily_run_usage (
    usage_date DATE NOT NULL, 
    scope VARCHAR(16) NOT NULL, 
    subject_id VARCHAR(255) NOT NULL, 
    run_kind VARCHAR(16) NOT NULL, 
    run_count INTEGER NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (usage_date, scope, subject_id, run_kind), 
    CONSTRAINT ck_daily_run_usage_scope CHECK (scope IN ('user', 'deployment')), 
    CONSTRAINT ck_daily_run_usage_kind CHECK (run_kind IN ('data', 'text')), 
    CONSTRAINT ck_daily_run_usage_count CHECK (run_count >= 0)
);

ALTER TABLE workflow_runs ADD COLUMN run_kind VARCHAR(16) DEFAULT 'text' NOT NULL;

WITH RECURSIVE data_run_tree(id) AS (SELECT workflow_runs.id FROM workflow_runs WHERE EXISTS (SELECT 1 FROM workflow_run_assets WHERE workflow_run_assets.run_id = workflow_runs.id) UNION SELECT child.id FROM workflow_runs AS child JOIN data_run_tree AS parent ON child.parent_run_id = parent.id) UPDATE workflow_runs SET run_kind = 'data' WHERE id IN (SELECT id FROM data_run_tree);

CREATE UNIQUE INDEX uq_workflow_runs_owner_active_data ON workflow_runs (owner_id) WHERE run_kind = 'data' AND status IN ('queued', 'running', 'cancelling');

UPDATE alembic_version SET version_num='0003_daily_run_usage' WHERE alembic_version.version_num = '0002_provider_connections';

-- Running upgrade 0003_daily_run_usage -> 0004_project_previews

ALTER TABLE projects ADD COLUMN is_preview_public BOOLEAN DEFAULT false NOT NULL;

CREATE TABLE project_preview_grants (
    id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(255), 
    email VARCHAR(320), 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_project_preview_grant_identity CHECK (user_id IS NOT NULL OR email IS NOT NULL), 
    CONSTRAINT uq_project_preview_grant_user UNIQUE (project_id, user_id), 
    CONSTRAINT uq_project_preview_grant_email UNIQUE (project_id, email), 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(user_id) REFERENCES app_users (id) ON DELETE CASCADE
);

CREATE INDEX ix_project_preview_grants_project_id ON project_preview_grants (project_id);

CREATE INDEX ix_project_preview_grants_user_id ON project_preview_grants (user_id);

UPDATE alembic_version SET version_num='0004_project_previews' WHERE alembic_version.version_num = '0003_daily_run_usage';

-- Running upgrade 0004_project_previews -> 0005_core_support

CREATE TABLE notifications (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255) NOT NULL, 
    type VARCHAR(40) NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    body TEXT NOT NULL, 
    read BOOLEAN NOT NULL, 
    schedule_id VARCHAR(128), 
    run_id VARCHAR(36), 
    provider VARCHAR(80), 
    asset_id VARCHAR(36), 
    project_id VARCHAR(36), 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_notifications_type CHECK (type IN ('sync_success', 'sync_failed', 'token_expired')), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE CASCADE, 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE SET NULL, 
    FOREIGN KEY(asset_id) REFERENCES assets (id) ON DELETE SET NULL, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE SET NULL
);

CREATE INDEX ix_notifications_owner_id ON notifications (owner_id);

CREATE INDEX ix_notifications_read ON notifications (read);

CREATE INDEX ix_notifications_created_at ON notifications (created_at);

CREATE TABLE feedback_submissions (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255), 
    category VARCHAR(100) NOT NULL, 
    message TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE SET NULL
);

CREATE INDEX ix_feedback_submissions_owner_id ON feedback_submissions (owner_id);

CREATE INDEX ix_feedback_submissions_created_at ON feedback_submissions (created_at);

CREATE TABLE overall_feedback_submissions (
    id VARCHAR(36) NOT NULL, 
    owner_id VARCHAR(255), 
    full_name VARCHAR(120) NOT NULL, 
    email VARCHAR(320) NOT NULL, 
    overall_rating INTEGER NOT NULL, 
    visual_appeal_rating INTEGER NOT NULL, 
    metrics_insights_rating INTEGER NOT NULL, 
    layout_editing_rating INTEGER NOT NULL, 
    share_link_rating INTEGER NOT NULL, 
    requested_connectors TEXT NOT NULL, 
    dashboard_improvements TEXT NOT NULL, 
    export_improvements TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_overall_feedback_overall_rating CHECK (overall_rating BETWEEN 1 AND 5), 
    CONSTRAINT ck_overall_feedback_visual_appeal_rating CHECK (visual_appeal_rating BETWEEN 1 AND 5), 
    CONSTRAINT ck_overall_feedback_metrics_insights_rating CHECK (metrics_insights_rating BETWEEN 1 AND 5), 
    CONSTRAINT ck_overall_feedback_layout_editing_rating CHECK (layout_editing_rating BETWEEN 1 AND 5), 
    CONSTRAINT ck_overall_feedback_share_link_rating CHECK (share_link_rating BETWEEN 1 AND 5), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id) ON DELETE SET NULL
);

CREATE INDEX ix_overall_feedback_submissions_owner_id ON overall_feedback_submissions (owner_id);

CREATE INDEX ix_overall_feedback_submissions_created_at ON overall_feedback_submissions (created_at);

CREATE TABLE blog_posts (
    id VARCHAR(36) NOT NULL, 
    slug VARCHAR(180) NOT NULL, 
    title VARCHAR(240) NOT NULL, 
    description VARCHAR(1000) NOT NULL, 
    content_html TEXT NOT NULL, 
    content_json JSON, 
    cover_image_url VARCHAR(2048), 
    cover_image_alt VARCHAR(500), 
    author VARCHAR(160) NOT NULL, 
    persona VARCHAR(160), 
    tags JSON NOT NULL, 
    target_keyword VARCHAR(255), 
    status VARCHAR(16) NOT NULL, 
    reading_minutes INTEGER NOT NULL, 
    published_at TIMESTAMP WITH TIME ZONE, 
    featured BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_blog_posts_status CHECK (status IN ('draft', 'published'))
);

CREATE UNIQUE INDEX ix_blog_posts_slug ON blog_posts (slug);

CREATE INDEX ix_blog_posts_status ON blog_posts (status);

CREATE INDEX ix_blog_posts_published_at ON blog_posts (published_at);

CREATE UNIQUE INDEX uq_blog_posts_featured ON blog_posts (featured) WHERE featured;

UPDATE alembic_version SET version_num='0005_core_support' WHERE alembic_version.version_num = '0004_project_previews';

-- Running upgrade 0005_core_support -> 0006_project_members

CREATE TABLE project_members (
    id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(255) NOT NULL, 
    role VARCHAR(16) NOT NULL, 
    status VARCHAR(16) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_project_members_role CHECK (role IN ('owner', 'editor', 'viewer')), 
    CONSTRAINT ck_project_members_status CHECK (status IN ('active', 'inactive')), 
    CONSTRAINT uq_project_member_user UNIQUE (project_id, user_id), 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(user_id) REFERENCES app_users (id) ON DELETE CASCADE
);

CREATE INDEX ix_project_members_project_id ON project_members (project_id);

CREATE INDEX ix_project_members_user_id ON project_members (user_id);

CREATE INDEX ix_project_members_user_status ON project_members (user_id, status);

INSERT INTO project_members
                (id, project_id, user_id, role, status, created_at, updated_at)
            SELECT id, id, owner_id, 'owner', 'active', created_at, updated_at
            FROM projects;

UPDATE alembic_version SET version_num='0006_project_members' WHERE alembic_version.version_num = '0005_core_support';

-- Running upgrade 0006_project_members -> 0007_workflow_dispatch_leases

ALTER TABLE workflow_runs ADD COLUMN dispatch_lease_id VARCHAR(36);

ALTER TABLE workflow_runs ADD COLUMN dispatch_lease_expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE workflow_runs ADD COLUMN dispatch_started_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE workflow_runs ADD COLUMN dispatch_attempts INTEGER DEFAULT '0' NOT NULL;

UPDATE alembic_version SET version_num='0007_workflow_dispatch_leases' WHERE alembic_version.version_num = '0006_project_members';

-- Running upgrade 0007_workflow_dispatch_leases -> 0008_workflow_provider_effects

ALTER TABLE workflow_runs ADD COLUMN provider_mode VARCHAR(16) DEFAULT 'demo' NOT NULL;

ALTER TABLE workflow_runs ADD COLUMN provider_name VARCHAR(32) DEFAULT 'demo' NOT NULL;

ALTER TABLE workflow_runs ADD COLUMN provider_model VARCHAR(128) DEFAULT 'deterministic-v1' NOT NULL;

ALTER TABLE workflow_runs ADD COLUMN provider_encrypted_api_key TEXT;

ALTER TABLE workflow_runs ADD COLUMN provider_key_version VARCHAR(32);

ALTER TABLE workflow_runs ADD COLUMN provider_call_count INTEGER DEFAULT '0' NOT NULL;

ALTER TABLE workflow_runs ADD CONSTRAINT ck_workflow_run_provider_call_count CHECK (provider_call_count BETWEEN 0 AND 5);

CREATE TABLE workflow_provider_calls (
    id VARCHAR(36) NOT NULL, 
    run_id VARCHAR(36) NOT NULL, 
    call_key VARCHAR(128) NOT NULL, 
    ordinal INTEGER NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_workflow_provider_call_key UNIQUE (run_id, call_key), 
    CONSTRAINT uq_workflow_provider_call_ordinal UNIQUE (run_id, ordinal), 
    CONSTRAINT ck_workflow_provider_call_ordinal CHECK (ordinal BETWEEN 1 AND 5), 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE CASCADE
);

CREATE INDEX ix_workflow_provider_calls_run_id ON workflow_provider_calls (run_id);

UPDATE alembic_version SET version_num='0008_workflow_provider_effects' WHERE alembic_version.version_num = '0007_workflow_dispatch_leases';

-- Running upgrade 0008_workflow_provider_effects -> 0009_operator_briefs

CREATE TABLE operator_briefs (
    id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    created_by_id VARCHAR(255), 
    run_id VARCHAR(36), 
    source_asset_id VARCHAR(36), 
    schedule_id VARCHAR(128), 
    provider VARCHAR(80) NOT NULL, 
    account_name VARCHAR(160) NOT NULL, 
    headline VARCHAR(240) NOT NULL, 
    body TEXT NOT NULL, 
    severity VARCHAR(16) NOT NULL, 
    recommendation TEXT NOT NULL, 
    changes JSON NOT NULL, 
    metric_snapshot JSON NOT NULL, 
    outcome JSON, 
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_operator_briefs_severity CHECK (severity IN ('alert', 'warn', 'info')), 
    CONSTRAINT uq_operator_briefs_project_run UNIQUE (project_id, run_id), 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(created_by_id) REFERENCES app_users (id) ON DELETE SET NULL, 
    FOREIGN KEY(run_id) REFERENCES workflow_runs (id) ON DELETE SET NULL, 
    FOREIGN KEY(source_asset_id) REFERENCES assets (id) ON DELETE SET NULL
);

CREATE INDEX ix_operator_briefs_project_id ON operator_briefs (project_id);

CREATE INDEX ix_operator_briefs_created_by_id ON operator_briefs (created_by_id);

CREATE INDEX ix_operator_briefs_run_id ON operator_briefs (run_id);

CREATE INDEX ix_operator_briefs_source_asset_id ON operator_briefs (source_asset_id);

CREATE INDEX ix_operator_briefs_expires_at ON operator_briefs (expires_at);

CREATE INDEX ix_operator_briefs_project_created_at ON operator_briefs (project_id, created_at);

UPDATE alembic_version SET version_num='0009_operator_briefs' WHERE alembic_version.version_num = '0008_workflow_provider_effects';

-- Supabase Data API hardening: no anon/authenticated policies are created.
ALTER TABLE public."alembic_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."app_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stored_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."upload_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dashboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dashboard_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_run_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_step_journals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."provider_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."daily_run_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."project_preview_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."feedback_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."overall_feedback_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."blog_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_provider_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."operator_briefs" ENABLE ROW LEVEL SECURITY;

COMMIT;

