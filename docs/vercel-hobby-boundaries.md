# Vercel Hobby boundaries

This repository intentionally targets a personal, non-commercial demo. The controls below are application limits, chosen below provider ceilings so failure is predictable and recoverable.

Provider limits change over time. The values in this document were rechecked on 2026-08-03 against the linked provider documentation.

## Runtime

- [Vercel Hobby](https://vercel.com/docs/plans/hobby) is restricted to personal, non-commercial use. It is not the commercial production target for Dreamify.
- With Fluid Compute enabled, [Vercel Functions](https://vercel.com/docs/functions/limitations) have a 300-second Hobby ceiling, a 4.5 MB request/response ceiling, and a 500 MB uncompressed Python bundle ceiling.
- Every web/API function must therefore return or begin streaming promptly. Workflow steps have a 240-second application timeout, and uploaded file bodies never transit a Function.
- The API dependency set excludes dataframe, spreadsheet-engine, warehouse-driver, chart-execution, and model SDK packs. Those belong in the isolated runner or opt-in connectors.

## Sandbox

- A Hobby [Sandbox session](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence) may run for at most 45 minutes. Dreamify uses a 25-minute session and a 20-minute application deadline.
- Two database-backed leases bound data Sandboxes globally, with one active data run per user.
- Generated Python has a 120-second execution timeout, one repair attempt, fixed resource/output limits, no application secret, and no network after staging.
- The deterministic provider and in-process adapter are the deploy-independent release path. The hosted Sandbox adapter remains capability-disabled until its credentialed smoke and adversarial tests pass.

## Storage and database

- Hobby includes 1 GB/month of [Vercel Blob storage](https://vercel.com/docs/vercel-blob/usage-and-pricing). Dreamify stops admission at 750 MiB across the deployment and 100 MiB per user.
- Files are capped at 10 MiB each, three files and 25 MiB per run. The browser uploads directly to a private store using an intent-bound, pathname-scoped client token.
- The public store is limited to non-sensitive marketing/demo assets; user uploads and generated artifacts remain private.
- Neon Free currently includes 0.5 GB per project according to [Neon pricing](https://neon.com/pricing). Dreamify stops write-heavy work at 350 MiB and retains room for indexes, migrations, and cleanup bookkeeping.

## Scheduling and connectors

- Hobby [Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) run at most daily and have hourly precision. Scheduling is off by default; an optional dispatcher can use daily, staggered jobs and database leases, but cannot promise minute-level execution.
- Connectors that need private networks, stable egress IPs, long-running workers, high-frequency webhooks, or large native drivers are unavailable on this profile.
- A connector is active only when its credential exists, its callback/webhook security tests pass, and a provider-specific hosted smoke test is recorded. A visible connector card is not a certification claim.

## Upgrade boundary

Move to a paid production architecture before enabling commercial users, higher file/run limits, unlimited AI, precise schedules, private/static egress, extended log retention, multi-person operational access, or an SLA. The application capability endpoint must expose the effective profile and limits so the UI never infers these guarantees from its build.
