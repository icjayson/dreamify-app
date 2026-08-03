# Dreamify Platform API

This directory is the clean FastAPI runtime for the Vercel migration. The copied
EC2 modules remain as migration reference, but `app/main.py` imports only
`app/platform/**`; Vercel also excludes the legacy modules from the function
bundle.

## Runtime architecture

- FastAPI on the Vercel Python runtime (Python 3.12, `sin1`, 60-second bound)
- SQLAlchemy 2.0 and Alembic, with FastAPI as schema owner
- Neon PostgreSQL in production; SQLite only for local development/tests
- Clerk JWT authentication with issuer/authorized-party checks and opt-in audience verification
- Vercel Blob private object storage through a provider-neutral adapter
- Explicit free-release capabilities: billing and external connectors disabled
- Project membership is the tenant boundary: active owners and editors can
  write, active viewers are read-only, and only owners manage project settings,
  sharing, deletion, and membership

## Required production configuration

| Variable | Purpose |
|---|---|
| `APP_ENV=production` | Enables production safety checks |
| `DATABASE_URL` | Neon pooled PostgreSQL URL used by request functions |
| `DIRECT_DATABASE_URL` | Neon direct PostgreSQL URL used by Alembic |
| `CORS_ORIGINS` | JSON array or comma-separated exact web origins |
| `CLERK_JWT_PUBLIC_KEY` or `CLERK_JWKS_URL` | Clerk signature verification |
| `CLERK_ISSUER` | Expected Clerk issuer |
| `CLERK_AUDIENCE` | Optional expected API audience; leave empty for Clerk's default session token |
| `CLERK_AUTHORIZED_PARTIES` | Allowed frontend origins for the JWT `azp` claim |
| `STORAGE_BACKEND=vercel_blob` | Selects durable production storage |
| `VERCEL_BLOB_TOKEN` | Private Blob read/write token |
| `VERCEL_BLOB_ACCESS=private` | Must match the connected Blob store |
| `BLOB_UPLOAD_GATEWAY_URL` | Next.js `@vercel/blob/client` gateway URL |
| `BLOB_SIGNING_GATEWAY_URL` | Server-only Next.js 900-second GET signer |
| `BLOB_GATEWAY_SHARED_SECRET` | Server-only callback authentication shared with Next.js |
| `INTERNAL_SERVICE_SHARED_SECRET` | Authentication for the Next.js workflow adapter and API persistence authority |
| `WORKFLOW_DISPATCH_URL` | Next.js durable workflow dispatch endpoint |
| `PROVIDER_ENCRYPTION_KEYS` | Optional one-line JSON keyring of version names to base64-encoded 32-byte AES keys; required only to enable BYOK |
| `PROVIDER_CURRENT_KEY_VERSION` | Version used for new BYOK encryption and read-time rotation |
| `PROVIDER_VALIDATION_TIMEOUT_SECONDS` | Bounded OpenAI/Gemini credential smoke-test timeout |

Production rejects demo auth, local storage, wildcard CORS, automatic schema
creation, and missing database/auth/storage configuration at startup.

### Clerk session-token contract

Dreamify verifies Clerk's ordinary short-lived session token. It does not ask
the browser for a separately named JWT template. In Clerk Dashboard, open
**Sessions → Customize session token** and save these exact custom claims:

```json
{
  "email": "{{user.primary_email_address}}"
}
```

Invitation signup must require an email address. The API requires `sub`, `exp`,
`iss`, an allowed `azp`, and a valid `email`; a token without that custom claim
fails closed with `AUTH_EMAIL_CLAIM_INVALID`. Optional `name` or `fullName`
claims are accepted when they are non-empty strings of at most 160 characters;
email-only invitees do not need either name claim. Clerk's default session
claims do not include an `aud` value. Keep `CLERK_AUDIENCE` unset unless the
session-token claims editor also adds the exact matching static claim, for
example `"aud": "dreamify-api"`. When configured, PyJWT verifies it on every
request.
See Clerk's [session token](https://clerk.com/docs/guides/sessions/session-tokens)
and [custom claims](https://clerk.com/docs/guides/sessions/customize-session-tokens)
documentation.

The Hobby demo publishes its bounded resource profile: 10 MiB per file,
three files and 25 MiB per run, 100,000 rows and 200 columns per file, 100 MiB
per user, 750 MiB per deployment, two workflow slots, 1 MiB dashboard/artifact
payloads, and 32 KiB events. Declared daily UI/runtime gates are five data runs and 20
text runs per user, plus 10 deployment runs. Every value is explicit in
`GET /api/v1/capabilities`; see `.env.example` for the matching variable names.

## Database setup

Install dependencies, migrate with the direct database URL, and run the
idempotent seed:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m alembic upgrade head
.venv/bin/python scripts/seed_database.py
```

The seed writes the versioned `sales.csv` fixture through the configured object
storage adapter and creates one deterministic demo user, owner membership,
project, asset, conversation, dashboard, and initial dashboard version. Running
it again is safe: database rows are not duplicated, and a missing demo CSV is
created at its checksum-addressed pathname. If content already at that immutable
path has different metadata or bytes, the seed fails closed instead of
overwriting it.

`AUTO_CREATE_SCHEMA` is for hermetic tests/local bootstrap only and is rejected
in production. Deployments must apply Alembic before routing production traffic.

## API surface

- `GET /api/v1/health` and `GET /api/v1/health/ready`
- `GET /api/v1/capabilities`
- `GET /api/v1/users/me`
- Tenant-scoped BYOK configuration under `/api/v1/provider-connections`;
  reads are redacted and writes validate the credential before encryption
- CRUD for `/api/v1/projects`, `/api/v1/conversations`, and
  `/api/v1/dashboards`
- Owner-managed registered-user roles under
  `/api/v1/projects/{project_id}/members`
- Read/soft-delete assets and list project assets
- Submit idempotent chat work with `POST /api/v1/conversation/chat`; the API
  persists the run before synchronously dispatching a durable Next.js workflow
- Poll status/events or use the bounded SSE compatibility stream, with
  `Last-Event-ID`/`after` cursors and polling fallback
- Service-only workflow claim, context, step journal, transition, response,
  artifact, capacity, cancel, and asset resolution endpoints under
  `/api/v1/internal/**`
- Reserve, upload, inspect, and finalize asset metadata under `/api/v1/uploads`
- Connector and billing paths return stable `FEATURE_DISABLED` errors

Project resources are looked up through an active project membership in the
same database query. Creator/uploader `owner_id` fields remain audit and quota
attribution, not an authorization boundary. A user without membership receives
the same `404 NOT_FOUND` response as an unknown ID; a member whose role cannot
perform a write receives typed `PROJECT_ROLE_FORBIDDEN`. At least one active
owner is required, and transferring/removing the canonical owner is atomic.
Workflow state mutation requires `X-Internal-Service-Secret`; browser users can
only submit, read, or request cancellation. The complete access classification
is embedded in OpenAPI as `x-dreamify-access` and startup fails if a deployed
operation is missing from the policy manifest.

## Model-provider credentials

Deterministic demo mode requires no LLM credential. To enable user-managed
OpenAI or Gemini keys, set `PROVIDER_ENCRYPTION_KEYS` in the API project to a
single-line JSON object such as `{"v1":"<base64-encoded-32-byte-key>"}` and set
`PROVIDER_CURRENT_KEY_VERSION=v1`. The value is a server-only Vercel secret, not
a `NEXT_PUBLIC_*` variable. Saving a provider performs a bounded model-access
smoke test and stores only AES-256-GCM ciphertext bound to tenant, provider,
connection ID, and key version.

For rotation, add the new version while retaining every version that still
decrypts stored rows, then change `PROVIDER_CURRENT_KEY_VERSION`. Credentials
are re-encrypted on a later verified read. Remove an old version only after all
rows have migrated. User-facing reads, capabilities, Workflow state, events,
artifacts, Blob objects, Sandbox inputs, and logs never contain the key. The
plaintext is resolved only through the service-authenticated internal API inside
the server Workflow step and is held only in that step's model client.

## Durable workflow handshake

1. The browser sends a unique `client_request_id` to
   `POST /api/v1/conversation/chat`.
2. FastAPI validates membership and limits, persists a queued run, then calls the
   configured Next.js dispatch endpoint with the run ID as its idempotency key.
3. The Next.js durable workflow claims the run through the service-only API and
   uses the API as the authority for step replay, state transitions, capacity,
   events, artifacts, and terminal response persistence.
4. Browser reads are cursor-based. The SSE endpoint closes after a short bounded
   window by design; clients reconnect or fall back to polling.
5. Cancellation first records `cancelling` and `cancel_requested=true`; only the
   workflow authority records the final `cancelled` state.

## Vercel Blob upload handshake

1. The browser creates an upload intent with project, filename, content type,
   exact byte size, optional SHA-256, and a `client_request_id`.
2. The API returns the exact Blob pathname and Next.js gateway target.
3. The gateway calls `POST /api/v1/uploads/blob-token/validate`, forwarding the
   user's Clerk authorization. It must upload the exact pathname with
   `addRandomSuffix: false`.
4. The Vercel completion webhook calls `POST /api/v1/uploads/blob-completed`
   using only `X-Blob-Gateway-Secret`; JWTs must never be stored in token payload.
5. FastAPI resolves the uploader and project membership after gateway
   authentication, re-reads Blob
   metadata, optionally downloads and hashes the object, and finalizes one asset
   idempotently.
6. The browser can poll `GET /api/v1/uploads/intents/{intent_id}` until the state
   is `finalized` and `asset_id` is present.

Workflow creation binds an explicit list of asset IDs to the run. Morpheus calls
the internal resolver with `run_id` and `object_id`; the API verifies the
run/project/asset association before asking the Next.js signing gateway for a
GET-only URL valid for 900 seconds. Creator IDs do not prevent project members
from using one another's project assets. Public run/event APIs never expose that
URL.

Local development uses the same intent/finalize contract but uploads bytes to
`PUT /api/v1/uploads/{intent_id}/content`. This local proxy is unavailable when
the Vercel Blob adapter is selected.

## Test and deployment checks

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/generate_openapi.py --check
.venv/bin/python -m compileall -q app api alembic scripts/seed_database.py
DATABASE_URL=sqlite:////tmp/dreamify-migration.sqlite \
  .venv/bin/python -m alembic upgrade head
DATABASE_URL=sqlite:////tmp/dreamify-migration.sqlite \
  .venv/bin/python -m alembic check
```

Create a separate Vercel project whose Root Directory is `services/api`. The
checked-in `vercel.json` deploys the single `api/index.py` function in `sin1`.
The canonical API contract is `packages/contracts/openapi.json`; regenerate it
with `scripts/generate_openapi.py` after an intentional route or schema change.

## Intentionally unavailable in this release

- Stripe/Polar billing and credit debits
- GA4, Stripe-data, warehouse, and chat-platform connectors
- EC2 filesystem, S3, and DynamoDB compatibility
- Long-running Morpheus execution inside the FastAPI request function
- Migration of legacy users or legacy DynamoDB/S3 records

Those capabilities remain visible as disabled through `/api/v1/capabilities` so
the web application can hide unavailable controls without guessing.
