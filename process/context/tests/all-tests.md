# Dreamify verification matrix

Run checks from the new monorepo root unless a command changes directory.
Node verification must use Node 22; Python verification uses Python 3.12 for the
API and the pinned runner version declared by the Sandbox image/CI.

| Surface | Trusted commands |
|---|---|
| Web | `npm run lint --workspace @dreamify/web`; `npm run typecheck --workspace @dreamify/web`; `npm run test --workspace @dreamify/web`; `npm run build --workspace @dreamify/web` |
| Workflow | `npm run typecheck --workspace @dreamify/workflow`; `npm run test --workspace @dreamify/workflow`; `npm run build --workspace @dreamify/workflow` |
| Contracts | `npm run check --workspace @dreamify/contracts`; `cd services/api && ../../.venv/bin/python scripts/generate_openapi.py --check` |
| API | `cd services/api && .venv/bin/python -m ruff format --check app/platform tests_platform alembic api/index.py scripts/seed_database.py scripts/generate_openapi.py`; repeat with `ruff check --select E,F,I`; then `.venv/bin/python -m pytest -q tests_platform` |
| Database | upgrade an empty PostgreSQL database to `head`, run `alembic check`, run `scripts/seed_database.py` twice, and verify eight blogs plus exactly two workflow slots |
| Sandbox | `cd services/morpheus-sandbox && .venv/bin/python -m pytest -q tests`; Ruff format/check for `runner tests` |
| Governance | `node scripts/check-test-migration-ledger.mjs`; `git diff --check`; `git fsck --full --strict`; full-history and working-tree Gitleaks scans |
| Dependencies | `npm audit --audit-level=high`; `pip-audit` for API and Sandbox locked requirements; `pip check` in clean environments |

## Baseline ledger

The immutable source inventory contains 817 cases: 190 web, 497 API, and 130
Morpheus. `docs/test-migration-manifest.json` is the machine-checked one-entry
per-source-file ledger. A source case is accepted only when it is:

1. byte-identical and executed;
2. mapped to an explicit equivalent behavior test that passes; or
3. intentionally excluded with a product-scope reason and a CI-selected
   fail-closed guard.

Preserving a legacy file without executing it is inventory evidence, not a
passing acceptance gate. The validator must remain service-aware when recording
local evidence; API or Sandbox replacement cases must not be counted as web
test coverage.

## Required high-risk evidence

- Auth/membership: owner/editor/viewer positive paths, last-owner/transfer
  boundaries, preview-only denial, and cross-tenant 404 behavior.
- Upload: exact 10 MiB admission, 10 MiB + 1 rejection, MIME/hash/size/path
  mismatch, expiry, quota serialization, orphan cleanup, and hosted direct-Blob
  smoke after credentials exist.
- Workflow: duplicate request, step replay, durable five-call budget, provider
  timeout/429/5xx, cancellation, clarification child run, lease contention,
  superseded result, SSE reconnect/dedupe, and polling fallback.
- Sandbox: forbidden imports, secret/path access, network, subprocess, timeout,
  memory/output bounds, and schema validation.
- Disabled product surfaces: zero billing/credit/checkout requests and typed 503
  for connector/schedule operations.

## Known external gaps

Hosted Clerk, Neon, Workflow, Blob, and Sandbox end-to-end smoke tests cannot pass
until the account-owner actions in `docs/deployment-status.md` are completed.
Local adapters and the built Sandbox snapshot do not substitute for that hosted
evidence. Browser visual parity is a separate gate from unit tests and builds.
