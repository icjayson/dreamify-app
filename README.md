# Dreamify Platform

Dreamify is a fresh-install, invite-only analytics demo designed for Vercel Hobby. The repository preserves sanitized history from the original frontend, API, and Morpheus services while replacing EC2-specific runtime assumptions with Next.js, FastAPI, Neon Postgres, Vercel Blob, Workflow, and an isolated Python runner.

This profile is for personal, non-commercial evaluation. It does not migrate legacy users or AWS data, does not process payments, and does not change the existing Dreamify EC2 deployment or DNS.

## Repository layout

- `apps/web`: Next.js App Router UI, Clerk integration, Blob upload bridge, run streaming, and workflow entrypoints.
- `services/api`: FastAPI application configured only from the runtime environment, with a SQLAlchemy/Alembic schema and Vercel Python entrypoint.
- `services/morpheus-sandbox`: bounded Python data-analysis runner intended for Vercel Sandbox.
- `services/connectors`: optional connector packs; disabled in the default profile.
- `packages/contracts`: canonical API and workflow schemas with generated TypeScript types.
- `packages/workflow`: deterministic demo/BYOK workflow engine.
- `packages/demo-fixtures`: seed datasets and deterministic demo output.

## Prerequisites

- Node.js 22 and npm.
- Python 3.12+.
- A PostgreSQL database for local development or a Neon Free project.
- A Clerk development application configured for invitation-only access.
- Vercel Blob stores for hosted uploads. Local development uses ignored filesystem storage.

No LLM key is required: every tenant starts on deterministic demo analysis.
Authenticated users can opt into OpenAI or Gemini from Account settings after
the API deployment owner configures the server-only credential-encryption
keyring. Provider keys are never public Vercel variables.

## Local bootstrap

The applications intentionally do not load dotenv files. The committed examples
document variable names only; provide values through the shell, CI, or the Vercel
dashboard.

1. Start PostgreSQL with `docker compose up -d postgres`.
2. Run `make install`, `make migrate`, and `make seed`. These two database commands
   explicitly use the Compose PostgreSQL URL and local filesystem storage; they do
   not silently fall back to SQLite.
3. Start FastAPI with the explicit local profile shown below, then start the web app
   in a second shell with `npm run dev`.
4. Run `make verify` before opening a pull request.

```bash
cd services/api
APP_ENV=development \
DATABASE_URL=postgresql://dreamify:dreamify_local_only@127.0.0.1:5432/dreamify \
DEMO_AUTH_MODE=true \
STORAGE_BACKEND=local \
LOCAL_STORAGE_PATH=/tmp/dreamify-storage \
../../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 5000
```

To target another database for migration or seed, pass it explicitly as
`LOCAL_DATABASE_URL`, for example `make migrate LOCAL_DATABASE_URL='postgresql://…'`.

## Vercel deployment

Create two projects from this repository:

| Project | Root directory | Purpose |
|---|---|---|
| `dreamify-web` | `apps/web` | Next.js, Workflow, SSE, and Blob token handling |
| `dreamify-api` | `services/api` | FastAPI core API |

Provision Neon and two Blob stores through Vercel, apply Alembic migrations using the direct database URL, seed once, and set the web project's public API URL to the deployed API project. The default Vercel domains remain in use; no production DNS change is part of this repository.

See [architecture](docs/architecture.md), [security model](docs/security.md), [Hobby boundaries](docs/vercel-hobby-boundaries.md), [operations runbook](docs/runbook.md), [release acceptance gates](docs/acceptance.md), and [current infrastructure status](docs/deployment-status.md).

## Hobby profile boundaries

- 10 MiB per file, three files and 25 MiB per workflow run.
- 100,000 rows and 200 columns per file.
- Two concurrent data-analysis slots.
- Billing and credit debits are disabled.
- External connectors are capability-gated and disabled without credentials.
- Vercel Hobby is not a commercial production plan.
