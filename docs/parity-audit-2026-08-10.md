# Dreamify source-to-Vercel parity audit

Audited on 2026-08-10 against the local source archives under
`/Users/jaysonjew/Documents/Dreamify` and the current `dreamify-platform`
working tree. Credential-bearing config, attachments, and every `.env` file
were deliberately excluded from inspection.

## Outcome

The web migration is feature-route complete for the recorded source baseline,
and the core authenticated file, project, conversation, dashboard, workflow,
feedback, CMS, notification, and operator-brief paths have Postgres-backed API
replacements. The repository is not a clone of every legacy backend feature:
the locked `hobby_demo` profile deliberately excludes billing, precise
scheduling, AWS persistence, and uncertified external connectors.

Calling the migration “all legacy features cloned” would therefore be
incorrect. The existing 817-case ledger classifies 157 cases as migrated
unchanged, 250 as equivalent replacements, and 410 as intentionally excluded.
The exclusions comprise connector/chat-platform behavior, schedules,
billing/credits, the server-side Python chart renderer, automatic LLM project
naming, and implicit project-wide asset forwarding.

## Verified surface

- All 190 recorded web cases are retained or replaced; none are excluded.
- The UI parity baseline contains 50 route patterns: 41 rendered routes, eight
  intentional redirects, and one real not-found case, plus 28 connector modal
  targets.
- The active FastAPI replacement exposes 169 method/path operations, including
  compatibility aliases and typed fail-closed routes for excluded capabilities.
- The copied EC2 route modules remain reference code only. `app/main.py`
  registers the bounded `app/platform` routers, not the legacy AWS runtime.
- Tenant data access is bound to an active project membership; external
  workflow mutation uses a separate service secret.

## Authentication finding and repair

The legacy frontend variable names were incompatible with Next.js. `VITE_*`
values are ignored by the migrated web app; the correct names are documented in
`apps/web/.env.example` and `docs/local-clerk-supabase.md`.

The previous Supabase launcher also forced `DEMO_AUTH_MODE=true`, which made a
real Clerk frontend and FastAPI disagree. The launcher now supports an explicit
`--auth-mode clerk`, configures issuer/JWKS/authorized parties/CORS together,
and never persists the prompted database password.

FastAPI still verifies RS256 signature, expiry, issuer, subject, and authorized
party. It now accepts Clerk's default session token without a custom email
claim, matching the source authentication contract. If optional email or name
claims are configured, malformed values continue to fail closed.

The source provider set also exposed a real parity gap: DeepSeek existed beside
OpenAI and Gemini, but the active Vercel Workflow omitted it. DeepSeek is now an
encrypted user-managed BYOK option using the fixed official API origin and the
current V4 model names; no global provider credential is bundled.

## Supabase schema finding and repair

The platform schema consists of 24 SQLAlchemy application tables plus
`alembic_version`. `services/api/sql/supabase_schema.sql` is generated from the
complete Alembic chain and is now current through
`0010_enable_supabase_rls`.

The audit found that the fresh-database SQL export enabled RLS while an
`alembic upgrade head` against an existing Supabase database did not. Revision
0010 makes fail-closed RLS canonical for both deployment paths. The secure local
launcher can apply migrations and then verifies revision, table completeness,
and PostgreSQL RLS before starting FastAPI.

This validates the new platform schema; it does not copy legacy production
records. The legacy backend stores core and connector state through DynamoDB
repositories and stores objects in S3. Because AWS and DynamoDB are explicitly
out of scope, no SQL file can truthfully contain “all current legacy data.” A
data migration requires owner-provided, sanitized exports plus an explicit
mapping/import project for users, projects, assets, conversations, dashboards,
workflow history, and object blobs.

## Credential decision

No pasted credential was read from disk, written to the repository, or wired
into browser code. Provider keys belong in rotated server-side secrets or the
encrypted BYOK flow. AWS and DynamoDB credentials are intentionally unused.

## Remaining acceptance gates

1. Rotate every credential exposed outside its intended secret store.
2. Configure one invite-only Clerk instance in local and Vercel environments.
3. Apply Alembic revision 0010 to the target Supabase project and run the secure
   schema verifier.
4. Run an authenticated hosted smoke test for login, project refresh, upload,
   workflow completion, dashboard load, and logout.
5. If legacy records are required, approve a separate sanitized DynamoDB/S3
   export and import scope. This cannot be represented as schema-only SQL.
6. Treat excluded connectors, schedules, and billing as future certification
   projects; do not silently activate their retained reference code.
