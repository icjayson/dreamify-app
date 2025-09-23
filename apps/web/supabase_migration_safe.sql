-- Safe migration script for Clerk-Supabase integration
-- This script handles existing policies and ensures clean setup

-- Step 1: Create users table (safe with IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    clerk_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    full_name TEXT,
    first_name TEXT,
    last_name TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Create indexes (safe with IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_users_clerk_user_id ON public.users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- Step 3: Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Step 4: Drop all existing policies to ensure clean recreation
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    -- Get all existing policies for the users table
    FOR policy_record IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'users' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', policy_record.policyname);
        RAISE NOTICE 'Dropped existing policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- Step 5: Create updated RLS policies following official Clerk pattern
-- Using only 'sub' claim as per official documentation
CREATE POLICY "Users can view own data" ON public.users
    FOR SELECT USING (
        auth.jwt() ->> 'sub' = clerk_user_id
    );

CREATE POLICY "Users can update own data" ON public.users
    FOR UPDATE USING (
        auth.jwt() ->> 'sub' = clerk_user_id
    );

CREATE POLICY "Users can insert own data" ON public.users
    FOR INSERT WITH CHECK (
        auth.jwt() ->> 'sub' = clerk_user_id
    );

CREATE POLICY "Users can delete own data" ON public.users
    FOR DELETE USING (
        auth.jwt() ->> 'sub' = clerk_user_id
    );

-- Step 6: Create or replace the updated_at function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

 -- Step 7: Drop and recreate trigger
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON public.users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Step 8: Grant permissions
GRANT ALL ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;

-- Step 9: Create helper functions
CREATE OR REPLACE FUNCTION get_current_clerk_user_id()
RETURNS TEXT AS $$
BEGIN
    RETURN auth.jwt() ->> 'sub';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- COMPATIBILITY: ADD/POPULATE user_id ON PROJECTS/DASHBOARDS/DATA_SOURCES/CHAT_MESSAGES
-- =============================================

-- Projects.user_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='projects'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema='public' AND table_name='projects' AND column_name='user_id'
        ) THEN
            ALTER TABLE public.projects ADD COLUMN user_id UUID;
            -- Backfill user_id
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema='public' AND table_name='workspaces' AND column_name='owner_user_id'
            ) THEN
                -- Use workspaces.owner_user_id when available
                UPDATE public.projects p
                SET user_id = w.owner_user_id
                FROM public.workspaces w
                WHERE p.user_id IS NULL AND p.workspace_id = w.id;
            ELSIF EXISTS (
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema='public' AND table_name='workspace_members'
            ) THEN
                -- Prefer explicit owner role
                UPDATE public.projects p
                SET user_id = wm_owner.user_id
                FROM (
                    SELECT DISTINCT ON (workspace_id) workspace_id, user_id
                    FROM public.workspace_members
                    WHERE role = 'owner'
                    ORDER BY workspace_id, joined_at ASC
                ) wm_owner
                WHERE p.user_id IS NULL AND p.workspace_id = wm_owner.workspace_id;

                -- Fallback to any member if still NULL
                UPDATE public.projects p
                SET user_id = wm_any.user_id
                FROM (
                    SELECT DISTINCT ON (workspace_id) workspace_id, user_id
                    FROM public.workspace_members
                    ORDER BY workspace_id, joined_at ASC
                ) wm_any
                WHERE p.user_id IS NULL AND p.workspace_id = wm_any.workspace_id;
            END IF;
            -- Add FK and index
            BEGIN
                ALTER TABLE public.projects
                    ADD CONSTRAINT projects_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL; END;
            CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
        END IF;
    END IF;
END $$;

-- Dashboards.user_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dashboards'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema='public' AND table_name='dashboards' AND column_name='user_id'
        ) THEN
            ALTER TABLE public.dashboards ADD COLUMN user_id UUID;
            -- Backfill from related project
            UPDATE public.dashboards d
            SET user_id = p.user_id
            FROM public.projects p
            WHERE d.user_id IS NULL AND d.project_id = p.id;
            -- Add FK and index
            BEGIN
                ALTER TABLE public.dashboards
                    ADD CONSTRAINT dashboards_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL; END;
            CREATE INDEX IF NOT EXISTS idx_dashboards_user_id ON public.dashboards(user_id);
        END IF;
    END IF;
END $$;

-- (Removed) Data sources backfill not needed; table removed

-- Chat messages.user_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chat_messages'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema='public' AND table_name='chat_messages' AND column_name='user_id'
        ) THEN
            ALTER TABLE public.chat_messages ADD COLUMN user_id UUID;
            -- Backfill from related project
            UPDATE public.chat_messages cm
            SET user_id = p.user_id
            FROM public.projects p
            WHERE cm.user_id IS NULL AND cm.project_id = p.id;
            -- Add FK and index
            BEGIN
                ALTER TABLE public.chat_messages
                    ADD CONSTRAINT chat_messages_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL; END;
            CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id_created_at ON public.chat_messages(user_id, created_at DESC);
        END IF;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION user_owns_record(record_clerk_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN auth.jwt() ->> 'sub' = record_clerk_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 10: Verification and success message
DO $$
BEGIN
    RAISE NOTICE '=== Clerk-Supabase Integration Setup Complete ===';
    RAISE NOTICE 'Users table: %', 
        CASE WHEN EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') 
        THEN 'CREATED' ELSE 'ERROR' END;
    
    RAISE NOTICE 'RLS enabled: %', 
        CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relname = 'users' AND relrowsecurity = true) 
        THEN 'YES' ELSE 'NO' END;
    
    RAISE NOTICE 'Policies created: %', 
        (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'users' AND schemaname = 'public');
    
    RAISE NOTICE '=== Setup Complete - Ready for Clerk Integration ===';
END $$;

-- =============================================
-- AUGMENT USERS TABLE FOR APP NEEDS
-- =============================================

-- Add helpful operational fields to users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_last_sign_in_at ON public.users(last_sign_in_at DESC);

-- Helper to resolve current user UUID from Clerk sub
CREATE OR REPLACE FUNCTION get_current_user_uuid()
RETURNS UUID AS $$
DECLARE
    current_uuid UUID;
BEGIN
    SELECT id INTO current_uuid
    FROM public.users
    WHERE clerk_user_id = auth.jwt() ->> 'sub'
    LIMIT 1;
    RETURN current_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- COMPATIBILITY: ALTER EXISTING WORKSPACES TO ADD OWNER COLUMN
-- =============================================

-- Add owner_user_id to existing workspaces table and backfill from workspace_members if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'workspaces'
    ) THEN
        -- Add column if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'owner_user_id'
        ) THEN
            ALTER TABLE public.workspaces ADD COLUMN owner_user_id UUID;

            -- Backfill from workspace_members if it exists
            IF EXISTS (
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = 'workspace_members'
            ) THEN
                -- Prefer explicit owner role first
                UPDATE public.workspaces w
                SET owner_user_id = wm_owner.user_id
                FROM (
                    SELECT DISTINCT ON (workspace_id) workspace_id, user_id
                    FROM public.workspace_members
                    WHERE role = 'owner'
                    ORDER BY workspace_id, joined_at ASC
                ) wm_owner
                WHERE w.owner_user_id IS NULL AND w.id = wm_owner.workspace_id;

                -- Fallback to any member if no owner flagged
                UPDATE public.workspaces w
                SET owner_user_id = wm_any.user_id
                FROM (
                    SELECT DISTINCT ON (workspace_id) workspace_id, user_id
                    FROM public.workspace_members
                    ORDER BY workspace_id, joined_at ASC
                ) wm_any
                WHERE w.owner_user_id IS NULL AND w.id = wm_any.workspace_id;
            END IF;

            -- Add FK constraint if missing
            BEGIN
                ALTER TABLE public.workspaces
                    ADD CONSTRAINT workspaces_owner_user_fk
                    FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_object THEN
                NULL;
            END;

            -- Add partial unique index to enforce 1 user ↔ 1 workspace once populated
            CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_owner_user_id
                ON public.workspaces(owner_user_id)
                WHERE owner_user_id IS NOT NULL;
        END IF;
    END IF;
END $$;

-- Rename owner_user_id -> user_id when both exist, then drop old index/constraints
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='workspaces' AND column_name='owner_user_id'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='workspaces' AND column_name='user_id'
    ) IS FALSE THEN
        -- If user_id not present yet, add and copy values
        ALTER TABLE public.workspaces ADD COLUMN user_id UUID;
        UPDATE public.workspaces SET user_id = owner_user_id WHERE user_id IS NULL;
        -- Add FK and unique index for user_id
        BEGIN
            ALTER TABLE public.workspaces
                ADD CONSTRAINT workspaces_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL; END;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_user_id
            ON public.workspaces(user_id)
            WHERE user_id IS NOT NULL;
        -- Drop any existing policies referencing owner_user_id before dropping the column
        DECLARE pol RECORD;
        BEGIN
            FOR pol IN (
                SELECT schemaname, tablename, policyname
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename IN ('workspaces','projects','dashboards','chat_messages')
            ) LOOP
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
            END LOOP;
        END;
        -- Drop old FK and index if exist, then drop column
        BEGIN
            ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_owner_user_fk;
        EXCEPTION WHEN undefined_object THEN NULL; END;
        DROP INDEX IF EXISTS uq_workspaces_owner_user_id;
        ALTER TABLE public.workspaces DROP COLUMN owner_user_id;
    END IF;
END $$;

-- =============================================
-- WORKSPACES (1 user ↔ 1 workspace)
-- =============================================

CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    slug TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    settings JSONB DEFAULT '{}'::jsonb,
    plan TEXT DEFAULT 'free',
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON public.workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_created_at ON public.workspaces(created_at DESC);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- RLS: only the owner can access their workspace
DROP POLICY IF EXISTS "Workspace owner can select" ON public.workspaces;
CREATE POLICY "Workspace owner can select" ON public.workspaces
    FOR SELECT USING (
        user_id = get_current_user_uuid()
    );

DROP POLICY IF EXISTS "Workspace owner can insert" ON public.workspaces;
CREATE POLICY "Workspace owner can insert" ON public.workspaces
    FOR INSERT WITH CHECK (
        user_id = get_current_user_uuid()
    );

DROP POLICY IF EXISTS "Workspace owner can update" ON public.workspaces;
CREATE POLICY "Workspace owner can update" ON public.workspaces
    FOR UPDATE USING (
        user_id = get_current_user_uuid()
    );

DROP POLICY IF EXISTS "Workspace owner can delete" ON public.workspaces;
CREATE POLICY "Workspace owner can delete" ON public.workspaces
    FOR DELETE USING (
        user_id = get_current_user_uuid()
    );

-- updated_at trigger
DROP TRIGGER IF EXISTS update_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER update_workspaces_updated_at
    BEFORE UPDATE ON public.workspaces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- PROJECTS (belong to single-user workspace)
-- =============================================

CREATE TABLE IF NOT EXISTS public.projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    slug TEXT UNIQUE,
    thumbnail_url TEXT,
    settings JSONB DEFAULT '{}'::jsonb,
    default_dashboard_id UUID NULL,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT projects_default_dashboard_fk FOREIGN KEY (default_dashboard_id) REFERENCES public.dashboards(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON public.projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON public.projects(created_at DESC);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Enforcement: project.user_id must equal workspace.owner_user_id
CREATE OR REPLACE FUNCTION projects_enforce_owner()
RETURNS TRIGGER AS $$
DECLARE
    ws_user UUID;
BEGIN
    SELECT user_id INTO ws_user FROM public.workspaces WHERE id = NEW.workspace_id;
    IF ws_user IS NULL OR NEW.user_id <> ws_user THEN
        RAISE EXCEPTION 'Project user_id must match the workspace user_id';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_enforce_owner_trigger ON public.projects;
CREATE TRIGGER projects_enforce_owner_trigger
    BEFORE INSERT OR UPDATE ON public.projects
    FOR EACH ROW
    EXECUTE FUNCTION projects_enforce_owner();

-- RLS for projects
DROP POLICY IF EXISTS "Owner can select projects" ON public.projects;
CREATE POLICY "Owner can select projects" ON public.projects
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.workspaces w
            WHERE w.id = projects.workspace_id
              AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can insert projects" ON public.projects;
CREATE POLICY "Owner can insert projects" ON public.projects
    FOR INSERT WITH CHECK (
        user_id = get_current_user_uuid() AND
        EXISTS (
            SELECT 1 FROM public.workspaces w
            WHERE w.id = workspace_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can update projects" ON public.projects;
CREATE POLICY "Owner can update projects" ON public.projects
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.workspaces w
            WHERE w.id = projects.workspace_id
              AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can delete projects" ON public.projects;
CREATE POLICY "Owner can delete projects" ON public.projects
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.workspaces w
            WHERE w.id = projects.workspace_id
              AND w.user_id = get_current_user_uuid()
        )
    );

DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- DASHBOARDS (unified with previews)
-- =============================================

CREATE TABLE IF NOT EXISTS public.dashboards (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    configuration JSONB NOT NULL,
    version INT DEFAULT 1,
    is_published BOOLEAN DEFAULT FALSE,
    published_url TEXT,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_dashboards_project_id ON public.dashboards(project_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_user_id ON public.dashboards(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_published ON public.dashboards(is_published);
CREATE INDEX IF NOT EXISTS idx_dashboards_published_url ON public.dashboards(published_url);

ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;

-- Enforcement: dashboard.user_id must equal project.user_id
CREATE OR REPLACE FUNCTION dashboards_enforce_project_user()
RETURNS TRIGGER AS $$
DECLARE
    proj_user UUID;
BEGIN
    SELECT user_id INTO proj_user FROM public.projects WHERE id = NEW.project_id;
    IF proj_user IS NULL OR NEW.user_id <> proj_user THEN
        RAISE EXCEPTION 'Dashboard user_id must match the project user_id';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dashboards_enforce_project_user_trigger ON public.dashboards;
CREATE TRIGGER dashboards_enforce_project_user_trigger
    BEFORE INSERT OR UPDATE ON public.dashboards
    FOR EACH ROW
    EXECUTE FUNCTION dashboards_enforce_project_user();

-- RLS for dashboards
DROP POLICY IF EXISTS "Owner can select dashboards" ON public.dashboards;
CREATE POLICY "Owner can select dashboards" ON public.dashboards
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = dashboards.project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can insert dashboards" ON public.dashboards;
CREATE POLICY "Owner can insert dashboards" ON public.dashboards
    FOR INSERT WITH CHECK (
        user_id = get_current_user_uuid() AND
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can update dashboards" ON public.dashboards;
CREATE POLICY "Owner can update dashboards" ON public.dashboards
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = dashboards.project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can delete dashboards" ON public.dashboards;
CREATE POLICY "Owner can delete dashboards" ON public.dashboards
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = dashboards.project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP TRIGGER IF EXISTS update_dashboards_updated_at ON public.dashboards;
CREATE TRIGGER update_dashboards_updated_at
    BEFORE UPDATE ON public.dashboards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- (Removed) DATA SOURCES: Not needed in current model

-- =============================================
-- CHAT MESSAGES (per project and user)
-- =============================================

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
    content TEXT NOT NULL,
    content_json JSONB,
    parent_message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
    attachments JSONB DEFAULT '[]'::jsonb,
    tool_calls JSONB DEFAULT '[]'::jsonb,
    token_usage JSONB DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id_created_at ON public.chat_messages(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id_created_at ON public.chat_messages(user_id, created_at DESC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Enforcement: chat_message.user_id must equal project.user_id
CREATE OR REPLACE FUNCTION chat_messages_enforce_project_user()
RETURNS TRIGGER AS $$
DECLARE
    proj_user UUID;
BEGIN
    SELECT user_id INTO proj_user FROM public.projects WHERE id = NEW.project_id;
    IF proj_user IS NULL OR NEW.user_id <> proj_user THEN
        RAISE EXCEPTION 'Chat message user_id must match the project user_id';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_enforce_project_user_trigger ON public.chat_messages;
CREATE TRIGGER chat_messages_enforce_project_user_trigger
    BEFORE INSERT OR UPDATE ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION chat_messages_enforce_project_user();

-- RLS for chat_messages
DROP POLICY IF EXISTS "Owner can select chat messages" ON public.chat_messages;
CREATE POLICY "Owner can select chat messages" ON public.chat_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = chat_messages.project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can insert chat messages" ON public.chat_messages;
CREATE POLICY "Owner can insert chat messages" ON public.chat_messages
    FOR INSERT WITH CHECK (
        user_id = get_current_user_uuid() AND
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can update chat messages" ON public.chat_messages;
CREATE POLICY "Owner can update chat messages" ON public.chat_messages
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = chat_messages.project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP POLICY IF EXISTS "Owner can delete chat messages" ON public.chat_messages;
CREATE POLICY "Owner can delete chat messages" ON public.chat_messages
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.workspaces w ON w.id = p.workspace_id
            WHERE p.id = chat_messages.project_id AND w.user_id = get_current_user_uuid()
        )
    );

DROP TRIGGER IF EXISTS update_chat_messages_updated_at ON public.chat_messages;
CREATE TRIGGER update_chat_messages_updated_at
    BEFORE UPDATE ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- GRANTS
-- =============================================

GRANT ALL ON public.workspaces TO authenticated;
GRANT ALL ON public.projects TO authenticated;
GRANT ALL ON public.dashboards TO authenticated;
-- (Removed) data_sources grants not needed
GRANT ALL ON public.chat_messages TO authenticated;

GRANT ALL ON public.workspaces TO service_role;
GRANT ALL ON public.projects TO service_role;
GRANT ALL ON public.dashboards TO service_role;
-- (Removed) data_sources grants not needed
GRANT ALL ON public.chat_messages TO service_role;

-- =============================================
-- HELPERS
-- =============================================

-- Get single workspace for a user (1:1)
CREATE OR REPLACE FUNCTION get_user_workspace(user_clerk_id TEXT)
RETURNS TABLE (
    workspace_id UUID,
    workspace_name TEXT,
    workspace_slug TEXT,
    plan TEXT,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT w.id, w.name, w.slug, w.plan, w.created_at
    FROM public.workspaces w
    JOIN public.users u ON u.id = w.owner_user_id
    WHERE u.clerk_user_id = user_clerk_id
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Extend get_workspace_projects
-- Drop existing function to allow return type changes safely
DROP FUNCTION IF EXISTS public.get_workspace_projects(UUID);

CREATE FUNCTION get_workspace_projects(workspace_uuid UUID)
RETURNS TABLE (
    project_id UUID,
    project_name TEXT,
    project_description TEXT,
    project_thumbnail_url TEXT,
    project_created_at TIMESTAMP WITH TIME ZONE,
    project_updated_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    dashboard_count BIGINT,
    data_source_count BIGINT,
    chat_message_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.name,
        p.description,
        p.thumbnail_url,
        p.created_at,
        p.updated_at,
        p.last_activity_at,
        COALESCE(d.cnt, 0) AS dashboard_count,
        0 AS data_source_count,
        COALESCE(cm.cnt, 0) AS chat_message_count
    FROM public.projects p
    LEFT JOIN (
        SELECT project_id, COUNT(*) AS cnt FROM public.dashboards GROUP BY project_id
    ) d ON d.project_id = p.id
    -- data_sources removed; keep column for API compatibility as zero
    LEFT JOIN (
        SELECT project_id, COUNT(*) AS cnt FROM public.chat_messages GROUP BY project_id
    ) cm ON cm.project_id = p.id
    WHERE p.workspace_id = workspace_uuid
    ORDER BY p.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- OPTIONAL SEED (owner workspace) - safe
-- =============================================

-- Insert a default workspace for an existing user if not present
DO $$
DECLARE
    u RECORD;
BEGIN
    SELECT id, full_name INTO u FROM public.users ORDER BY created_at ASC LIMIT 1;
    IF u.id IS NOT NULL THEN
        INSERT INTO public.workspaces (user_id, name, slug)
        VALUES (u.id, COALESCE(u.full_name, 'My Workspace'), 'my-workspace')
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
END $$;

-- =============================================
-- DEPRECATE LEGACY workspace_members TABLE (single-user workspace model)
-- =============================================

-- After backfills above, remove legacy membership table if it exists
DROP TABLE IF EXISTS public.workspace_members CASCADE;

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
BEGIN
    -- Check tables
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'workspaces' AND table_schema = 'public') THEN
        RAISE NOTICE 'Workspaces table ready';
    END IF;
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'projects' AND table_schema = 'public') THEN
        RAISE NOTICE 'Projects table ready';
    END IF;
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'dashboards' AND table_schema = 'public') THEN
        RAISE NOTICE 'Dashboards table ready';
    END IF;
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chat_messages' AND table_schema = 'public') THEN
        RAISE NOTICE 'Chat messages table ready';
    END IF;

    -- RLS enabled checks
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'workspaces' AND relrowsecurity = true) THEN
        RAISE NOTICE 'RLS enabled on workspaces';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'projects' AND relrowsecurity = true) THEN
        RAISE NOTICE 'RLS enabled on projects';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'dashboards' AND relrowsecurity = true) THEN
        RAISE NOTICE 'RLS enabled on dashboards';
    END IF;
    -- data_sources removed; no verification needed
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'chat_messages' AND relrowsecurity = true) THEN
        RAISE NOTICE 'RLS enabled on chat_messages';
    END IF;

    RAISE NOTICE 'Workspace/Project/Dashboard/DataSource/Chat schema setup completed successfully!';
END $$;