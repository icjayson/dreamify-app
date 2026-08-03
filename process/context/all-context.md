# Dreamify platform context

## Product profile

`dreamify-platform` is a fresh-install, invitation-only, non-commercial
`hobby_demo`. It is not a data migration or a replacement for the live EC2/DNS
deployment. Billing, credit debits, scheduling, and uncertified external
connectors fail closed. File upload plus deterministic analysis is the guaranteed
release path; tenant-managed OpenAI or Gemini credentials are optional.

## Locked source baseline

| Service | Immutable source commit | Sanitized target |
|---|---|---|
| Frontend | `d3f484ca0632f03c860936b2c1e51cec19cd39b5` | `apps/web` |
| API | `1f0e8d0e1cbfeeaa4d896367f9cd2fa29e925d41` | `services/api` |
| Morpheus | `2ec92c73cd80ec3d55bd7196defb6ed33995525a` | `services/morpheus-sandbox` |

The source repositories are separate worktrees and must not be edited. The only
known pre-existing source change is untracked
`dreamify-backend/scripts/churn_cohorts.py`, which is excluded from this repo.
`dreamify-config`, environment files, credential-bearing YAML, dependency trees,
and raw marketing video are excluded. Commit maps and exact sanitized tips live
under `migration/` and `docs/source-manifest.json`.

## Runtime boundaries

- `apps/web`: Next.js App Router, Clerk boundary, direct Blob upload gateway,
  resumable SSE client, and Vercel Workflow entrypoint. The native blog routes
  render on the server; the remaining imported UI is intentionally hosted in a
  client compatibility shell while preserving its URLs and behavior.
- `services/api`: FastAPI/SQLAlchemy/Alembic schema owner. PostgreSQL is required
  in production; SQLite is only a hermetic local/test adapter.
- `packages/workflow`: replay-safe TypeScript orchestration with durable API
  journals and a deterministic provider or run-pinned BYOK provider.
- `services/morpheus-sandbox`: command-only, pinned Python runner. The imported
  LangChain FastAPI server is history/reference and is not deployed.
- Vercel Blob stores private uploads/artifacts. Postgres stores users, project
  membership, reservations, conversations, dashboards/versions, run state,
  events, provider-call reservations, and operator briefs.

## Public contracts and trust boundaries

- Active project membership is the tenant boundary. Owners manage membership
  and sharing, editors may write project content, viewers are read-only, and
  outsiders receive the same 404 as an unknown resource.
- FastAPI's Pydantic OpenAPI document is canonical. Generated TypeScript and
  `x-dreamify-access` policy metadata must not drift.
- Browser uploads are intent-scoped and direct to private Blob. Function bodies
  never proxy hosted file bytes.
- Chat submission is idempotent by `client_request_id` and returns a durable run.
  Events are monotonic and cursor-resumable; polling is the bounded fallback.
- BYOK ciphertext and its key version are snapshotted onto a run. Plaintext is
  resolved only inside a service-authenticated Workflow step. The durable model
  call journal enforces five calls per run across replay and redeploy.
- Large bodies use immutable Blob references. Dashboard JSON is capped at 1 MiB
  and event payloads at 32 KiB.

## External state

- Private GitHub repository: `hungnq74/dreamify-platform` (awaiting validated
  first push at the time this context was written).
- Vercel projects: `dreamify-web` (`apps/web`) and `dreamify-api`
  (`services/api`). Private/public Blob stores and the pinned Sandbox snapshot
  are provisioned.
- Hosted release is blocked until the account owner accepts Neon Marketplace
  terms and creates/configures a new invitation-only Clerk application.
- A private repository on the current GitHub plan cannot enable protected-main
  rules; CI still runs read-only, but that policy gate requires GitHub Pro or a
  public repository.

## Important implementation constraints

- Never read or write `.env`; `.env.example` contains placeholders only.
- Never introduce AWS, billing, credit, legacy-user, or import-time filesystem
  requirements into the deployable core.
- Do not enable a connector merely because its UI card exists.
- Do not deploy production while database/auth settings are incomplete. Runtime
  settings intentionally fail closed.
- Keep the two original Vercel project roots and the default `.vercel.app`
  domains; custom DNS is out of scope.
