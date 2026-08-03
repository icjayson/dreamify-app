# Migration validation report

Validated on 2026-08-03 against the complete working tree pushed to the private
`dreamify-platform` repository. This report separates local implementation evidence
from hosted acceptance. A local pass does not waive an unchecked hosted gate in
[`acceptance.md`](./acceptance.md).

## Outcome

The greenfield monorepo is locally release-ready for the `hobby_demo` profile.
The Next.js web app, FastAPI core, generated contracts, deterministic Workflow,
and bounded Python runner build and test without AWS, billing, legacy data, or
an LLM key. The hosted release is not yet approved because Neon legal acceptance,
a new invite-only Clerk application, first deployment, and hosted smoke tests
require account-owner configuration.

## Source sanitation and integrity

- Original frontend: `d3f484ca0632f03c860936b2c1e51cec19cd39b5`,
  tree `ed343f7d3527d7a76dfb75135e06ff1f976b929c`, clean.
- Original backend commit: `1f0e8d0e1cbfeeaa4d896367f9cd2fa29e925d41`,
  tree `214d0c8848eed48e25a936a933a62f887ae98145`, with only the
  pre-existing untracked `scripts/churn_cohorts.py`.
- Original Morpheus: `2ec92c73cd80ec3d55bd7196defb6ed33995525a`,
  tree `36304f25c0c4e055d938e238c7d1df1ebc2b8ef2`, clean.
- `git fsck --full --strict` exits successfully. Reported dangling objects are
  local unreachable rewrite artifacts, not reachable corruption.
- Gitleaks scanned all 485 reachable commits with zero findings.
- The largest reachable blob is 1,996,651 bytes. No raw video, real `.env`,
  credential YAML, or `node_modules` path is tracked.

## Automated validation

| Area | Command or evidence | Result |
|---|---|---|
| Monorepo | Node 22 `npm run verify` | pass: lint, strict typecheck, 47 Vitest files / 362 tests, Next production build |
| Web | Vitest | 40 files / 298 tests pass |
| Contracts | generation/drift and Vitest | 8 tests pass; canonical OpenAPI current |
| Workflow | typecheck and Vitest | 5 files / 55 tests pass |
| API | Ruff format/check, compileall, OpenAPI check, `pytest -q tests_platform` | 141 tests pass |
| Sandbox | Ruff format/check and `pytest -q tests` | 32 tests pass |
| Dependencies | `npm audit --audit-level=high`, Python `pip check`, local Python audit | no npm vulnerability and no broken/audited Python dependency finding |
| Baseline ledger | `node scripts/check-test-migration-ledger.mjs` | all 817 cases classified: 157 unchanged, 250 equivalent, 410 intentionally excluded |
| Git hygiene | staged/working-tree `git diff --check`, full-history Gitleaks, `git fsck` | pass |

The excluded 410 baseline cases belong to the retired EC2/AWS persistence,
billing/credits, and uncertified connector runtime. Their public surfaces either
do not ship or fail closed; retained trust boundaries have replacement tests.

## Database, upload, and isolation evidence

- Alembic upgraded a fresh ephemeral PostgreSQL database through revision `0009`.
- The seed ran twice without duplicates and produced eight blog posts, one demo
  project, one demo asset/conversation/dashboard version, and exactly two
  workflow slots.
- A local direct-upload journey accepted a CSV, finalized the object
  idempotently, returned a six-row/four-column preview, and denied a
  cross-tenant preview with HTTP 404.
- Contract tests cover exact pathname authorization, MIME and checksum mismatch,
  expiry, quota races, cleanup, file/run/user limits, and transactional finalize.
- Hosted uploads use `@vercel/blob/client`; the Next.js Function exchanges and
  validates a scoped token and receives completion metadata, never the file body.

## Browser acceptance

Desktop smoke at 1280 x 720 passed for the home page, pricing, eight-post blog,
workspace project, connector-disabled behavior, true 404, protected-route
`noindex`, and `/success`/`/cancel` redirects. A fresh deterministic text request
completed with the expected demo answer and no browser warnings. The local API
health/readiness routes returned HTTP 200.

Mobile visual parity remains unverified because the available browser session
could not change viewport. Browser file-picker injection was also unavailable;
the transport was instead covered by two web unit tests and the direct API upload
journey above.

## Size and platform bounds

- Web source excluding generated dependencies/build output: 31,241,864 bytes,
  below the 50 MiB release target.
- Largest initial public media asset: 1,996,651 bytes, below 3 MiB.
- Estimated installed deployable API bundle: about 59.1 MB, below Vercel's
  500 MB Python bundle limit.
- API and Workflow contracts enforce 4.5 MB request-body avoidance, 10 MiB
  direct-upload objects, bounded 32 KiB events, and Workflow step deadlines below
  240 seconds.

## Hosted blockers and skipped checks

1. Neon cannot be provisioned until the account owner accepts its Marketplace
   legal terms. No terms were accepted automatically.
2. Clerk requires a newly created invite-only application and the documented
   custom `email` session claim.
3. The private GitHub repository cannot enforce protected `main` on the current
   plan; GitHub returns an upgrade-required HTTP 403. The repository was not made
   public as a workaround.
4. The Vercel projects and Blob stores exist and both projects are Git-connected,
   but no production deployment is attempted while database/auth configuration
   is incomplete. Therefore hosted
   login, upload, Workflow/Sandbox, BYOK, dashboard revert, and logout remain
   unverified.
5. Real OpenAI/Gemini BYOK calls and connector certification are intentionally
   outside the keyless core acceptance run. Their gates remain fail closed.

## Residual risk

The first migration keeps complex dashboard/editor screens behind a Next.js
client compatibility boundary, so hydration and mobile parity deserve a hosted
cross-browser pass after Clerk is connected. Hobby resource caps are enforced by
the application, but Neon/Blob aggregate soft-stop behavior still needs a hosted
quota exercise. This deployment remains a personal, non-commercial demo and is
not a commercial SLA.
