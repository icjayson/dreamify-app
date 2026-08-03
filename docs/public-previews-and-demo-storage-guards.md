# Public dashboard previews and demo storage guards

## Dashboard preview contract

Dashboard previews use the current web deployment URL:

`/workspace/project/preview?projectId=<project-id>`

The Hobby release does not allocate custom subdomains or share slugs. A project
preview is private by default. Its owner can explicitly make it public or add up
to 50 preview viewers by registered user ID or normalized email address. Adding
an email creates an allow-list entry only; Dreamify does not send an invitation
email. A private email grant becomes usable only when an authenticated Clerk
identity has that exact email. Active project members retain preview access,
while preview-only viewers receive no project, asset, chat, or dashboard-edit
permission.

The read surface is deliberately narrow:

- `GET /api/v1/public/project/{project_id}` returns project and latest saved
  dashboard metadata, but never the owner ID, viewer allow-list, asset metadata,
  storage references, or credentials.
- `GET /api/v1/public/project/{project_id}/dashboard` returns only the latest
  saved dashboard JSON, including dashboards that are not tied to a chat.
- `GET /api/v1/public/conversation/{conversation_id}/dashboard?project_id=...`
  remains as a conversation-scoped compatibility read with the same policy.
- Both responses are `private, no-store` because a private grant can be revoked.
- Private anonymous access returns `PREVIEW_PRIVATE`; an authenticated identity
  without a matching grant returns `PREVIEW_ACCESS_DENIED`.

All dashboard create and edit paths reject JSON larger than 1 MiB with
`DASHBOARD_TOO_LARGE`. Public preview routes never read or return raw uploaded
files.

## Project-member file previews

`GET /api/v1/files/preview/{asset_id}` is authenticated and scoped to active
project members. It
reads a private stored object server-side and supports bounded CSV/text-CSV and
flat JSON record previews without pandas or spreadsheet libraries.

- Request window: `limit=1..5000`, `offset=0..100000`.
- File, row, and column limits reuse the capability profile: 10 MiB, 100,000
  data rows, and 200 columns.
- JSON must be an array of objects whose values are scalar JSON values.
- XLS/XLSX preview returns typed `PREVIEW_FORMAT_UNSUPPORTED`; those formats can
  still be analyzed by the bounded Sandbox workflow.
- Active viewers can read previews but cannot upload, mutate, or delete assets.
- Cross-tenant asset IDs return `404`, and bearer tokens are sent only in the
  Authorization header, never in a query string.

## Postgres soft stop

`MAX_DATABASE_BYTES` defaults to `367001600` bytes (350 MiB) and is published as
`limits.max_database_bytes`. Before new upload reservations/finalization,
workflow runs, dashboard writes, and workflow artifacts, the API checks
`pg_database_size(current_database())`. At or above the threshold it rejects the
growth operation with `DATABASE_SOFT_LIMIT` and HTTP 507. Idempotent reads and
cleanup paths remain available. SQLite deliberately bypasses this PostgreSQL-
specific check for deterministic local tests.
