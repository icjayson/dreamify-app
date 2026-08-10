# Local Clerk + Supabase bootstrap

This runbook starts the Next.js web app and FastAPI against Supabase without
placing the database password in shell history or a repository file.

## 1. Rotate exposed credentials

Do not reuse a credential pasted into chat, logs, screenshots, or committed
files. Rotate all affected provider, database, cloud, and Clerk secret keys
before continuing. A Clerk publishable key is intended for browser use, but it
must still belong to the same rotated Clerk instance as the server secret.

## 2. Configure the web app

Create `apps/web/.env.local` yourself and keep it untracked. Use the variable
names in `apps/web/.env.example`. The migration from Vite to Next.js requires
these renames:

| Legacy Vite name | Next.js name |
|---|---|
| `VITE_API_URL` | `NEXT_PUBLIC_API_URL` |
| `VITE_CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| `VITE_GOOGLE_PICKER_API_KEY` | `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` |

For real Clerk authentication locally, set `NEXT_PUBLIC_API_URL` to the local
FastAPI origin, configure the rotated Clerk publishable and secret keys, and
set `NEXT_PUBLIC_DEMO_AUTH_MODE=false`. Never prefix `CLERK_SECRET_KEY` with
`NEXT_PUBLIC_`.

Do not add global OpenAI, Gemini, or DeepSeek secrets to the web app. Dreamify
uses server-side, encrypted user-managed OpenAI, Gemini, or DeepSeek credentials. AWS, DynamoDB,
billing, and uncertified connectors remain disabled in `hobby_demo`.

## 3. Locate Clerk verification metadata

In the Clerk dashboard, copy the instance's Frontend API URL. Use that exact
origin as the issuer. Its JWKS URL is the same origin followed by
`/.well-known/jwks.json`. Keep `CLERK_AUDIENCE` unset unless a matching `aud`
claim was deliberately added to the session token.

The API accepts Clerk's default signed session token. An optional custom
`email` claim may be added for email-based invitations and owner lookup, but it
is no longer required for authentication.

## 4. Start FastAPI and migrate Supabase

From the API directory, run the secure launcher with non-secret connection
metadata and Clerk public verification metadata:

```bash
cd /Users/jaysonjew/Documents/dreamify-platform/services/api

../../.venv/bin/python scripts/run_local_supabase_api.py \
  --db-host '<SUPABASE_POOLER_HOST>' \
  --db-user '<SUPABASE_POOLER_USER>' \
  --db-port 5432 \
  --db-name postgres \
  --migrate \
  --auth-mode clerk \
  --clerk-issuer 'https://<CLERK_FRONTEND_API_DOMAIN>' \
  --clerk-jwks-url 'https://<CLERK_FRONTEND_API_DOMAIN>/.well-known/jwks.json' \
  --clerk-authorized-party 'http://localhost:3000'
```

The launcher prompts for the raw Supabase password, safely percent-encodes
special characters, applies Alembic through `0010_enable_supabase_rls`, checks
all 24 application tables plus `alembic_version`, verifies RLS, and starts the
API on `http://127.0.0.1:5000`.

`services/api/sql/supabase_schema.sql` is only for an empty database. If the
SQL editor reports that `alembic_version` already exists, do not drop it and do
not re-run the fresh schema. Prefer the launcher with `--migrate`. A database
already at revision `0009_operator_briefs` may alternatively apply the guarded
`services/api/sql/supabase_upgrade_0009_to_0010.sql` file in Supabase SQL Editor.

Use `--auth-mode demo` instead when testing without Clerk. The web app must use
the same auth mode; do not run a Clerk frontend against a demo-mode API.

## 5. Start Next.js

In a second terminal:

```bash
cd /Users/jaysonjew/Documents/dreamify-platform
npm run dev
```

Open `http://localhost:3000`. A healthy setup returns HTTP 200 from
`http://127.0.0.1:5000/health` and authenticated project requests send a Clerk
Bearer token to FastAPI.

## 6. Vercel configuration

Set production and preview variables in the corresponding Vercel project, not
in committed files. The web and API origins must be HTTPS; demo auth must be
false; Clerk keys must come from one instance; and the API needs the exact
issuer, JWKS URL, authorized web origins, database URLs, Blob configuration,
and independently generated internal shared secrets described by the two
`.env.example` files.
