# Security model

- Git history is rewritten before first GitHub push and scanned with redacted output.
- Clerk identities are accepted only in invitation mode; demo authentication must be explicit and may not be enabled on a hosted production or preview environment. The API verifies issuer and authorized party, treats audience as opt-in, and requires the configured session token to contain a valid `email` claim before it creates or updates an application user. Bounded `name`/`fullName` claims are optional.
- Active project membership is the tenant boundary. Owners and editors can
  mutate core project data, viewers are read-only, and only owners can change
  project settings, preview sharing, deletion, or membership. Child-resource
  creator/uploader IDs are never used as the access boundary.
- Membership removal, deactivation, or role changes lock the project and cannot
  remove its last active owner. Preview grants remain a separate read-only
  dashboard-preview permission and never become project membership.
- OAuth and BYOK secrets are encrypted at rest and excluded from frontend responses, Workflow arguments/results, Blob objects, Sandboxes, and logs. BYOK uses an AES-256-GCM versioned keyring with tenant/provider/row identity as authenticated data. Each run snapshots its encrypted credential/model, resolves plaintext only in a service-authenticated server step, and consumes a database-durable maximum of five provider-call reservations across replay.
- Next.js protects workspace/admin/file-preview routes before the client shell loads. Published dashboard previews are the narrow public exception and still pass the API's explicit preview policy. Authentication tokens are sent in headers, never URL query strings.
- Billing routes are absent in `hobby_demo`; Stripe as a data connector remains independently gated.
- Upload reservations validate declared size and type before issuing scoped access. Finalization verifies actual Blob metadata and checksum.
- Generated Python receives only staged inputs, has no application credentials, uses an import/AST allowlist, has bounded CPU/memory/time/output, and loses network access before execution.
- Connector callbacks and webhooks stay disabled until state/signature verification fails closed and negative tests pass.
- The Next.js server validates its complete production/preview site, API, Clerk,
  private Blob, shared-secret, and pinned Sandbox configuration before serving;
  validation errors contain variable names but never credential values.

BYOK key rotation is additive: install a new version alongside every old key,
switch the current version, verify that stored credentials have been re-encrypted,
and only then remove the retired version. A lost old key is not recoverable from
the database; the affected user must replace their provider credential.
