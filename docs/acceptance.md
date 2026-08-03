# Acceptance and release gates

This document is the executable release checklist for the `hobby_demo` profile. A checked item must have command output or a hosted smoke-test result attached to the release or pull request. An unchecked external-service item is a deployment blocker, not an implicit waiver.

## Source integrity

- [x] Original source commits still resolve to the values in `source-manifest.json`.
- [x] Original frontend and Morpheus worktrees are clean; backend differs only by the pre-existing untracked `scripts/churn_cohorts.py`.
- [x] `git fsck --full` succeeds in this repository.
- [x] a full-history Gitleaks scan returns zero findings.
- [x] no Git blob exceeds 100 MiB and no raw marketing video is present.

## Fresh install

- [x] `npm ci` succeeds on Node 22.
- [x] API and sandbox development requirements install on Python 3.12.
- [x] Alembic upgrades an empty PostgreSQL database to `head`.
- [x] the seed command is idempotent and creates demo content and exactly two workflow slots.
- [x] no AWS, legacy-user, billing, credit, or LLM credential is required.

## Web

- [x] lint, strict typecheck, Vitest, and `next build` pass.
- [x] every legacy route pattern has either an App Router entry or an intentional redirect.
- [x] unknown URLs produce a real HTTP 404.
- [x] protected, admin, preview, and workspace pages are `noindex`.
- [x] `/success` and `/cancel` redirect to the free-preview pricing page without a billing request.
- [ ] desktop and mobile smoke screenshots show no hydration/runtime errors.

## API and isolation

- [x] route uniqueness and access-policy tests pass.
- [x] canonical OpenAPI generation is deterministic and generated contracts have no drift.
- [x] owner/editor/viewer positive and negative access, preview-only denial,
  last-owner protection, canonical-owner transfer, and cross-tenant denial are
  tested.
- [x] production settings reject demo auth, local storage, wildcard CORS, and missing database/auth/storage configuration.
- [x] disabled billing and connector operations return typed errors and issue no external request.

## Uploads

- [x] intent reservation, pathname-scoped Blob token, direct upload, HEAD/checksum validation, and transactional finalization pass.
- [x] wrong MIME/hash, expired intent, path substitution, concurrent quota, and orphan cleanup are covered.
- [x] 10 MiB/file, three files/run, 25 MiB/run, and 100 MiB/user limits are enforced before upload and at finalization.
- [x] the browser never proxies a file body through a Vercel Function.

## Workflow and sandbox

- [x] deterministic text and data demo runs pass without a model key.
- [x] duplicate request, replay, cancellation, clarification child-run, lease contention, and superseded-write tests pass.
- [x] event sequence is monotonic and reconnect/polling resumes without duplicate user-visible events.
- [x] runner tests deny secret access, forbidden imports, network, subprocesses, path escape, time exhaustion, and oversized output.
- [x] generated code receives staged input only and emits bounded structured JSON.
- [ ] hosted WDK/Sandbox adapters are enabled only after credentials and hosted smoke tests pass.

## Hosted release

- [ ] GitHub repository is private and `main` has required checks and read-only Actions permissions.
- [x] `dreamify-web` uses root `apps/web`; `dreamify-api` uses root `services/api`.
- [ ] Neon, private upload Blob, public media Blob, and Clerk invite-only application are connected.
- [ ] migrations and idempotent seed have run against the hosted database.
- [ ] default `.vercel.app` URLs pass health, login, project, upload, chat, dashboard version/revert, and logout smoke tests.
- [x] no custom domain or existing EC2/DNS resource changed.

## Baseline test accounting

The imported baseline contained 817 test cases: 190 web, approximately 497 API, and 130 Morpheus. Migration pull requests must classify every baseline test as:

1. migrated unchanged;
2. replaced by an equivalent contract/behavior test; or
3. removed with a written reason because the underlying feature is intentionally excluded (for example billing or an uncertified connector).

Counts alone are not acceptance evidence; the mapping must preserve the behavior and trust boundary that each retained test protected.

The exhaustive accounting is in [`test-migration-ledger.md`](./test-migration-ledger.md) and
[`test-migration-manifest.json`](./test-migration-manifest.json). All 817 baseline cases are now
classified: 168 migrated unchanged, 239 covered by explicit equivalent replacements, and 410
intentionally excluded behind fail-closed guards. The replacement suites are selected by CI and
pass locally; hosted acceptance remains a separate gate.
