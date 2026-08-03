# Operations runbook

## Deploy

1. In Clerk Dashboard, set the application to invitation-only and configure the
   exact required `email` session-token claim documented in
   `services/api/README.md`. Name claims are optional.
   Leave `CLERK_AUDIENCE` empty unless the same session token has a matching
   custom `aud` claim.
2. Confirm CI, secret scanning, contract drift, and Vercel builds are green.
3. Apply Alembic migrations with `DIRECT_DATABASE_URL` from a controlled environment.
4. Run the idempotent seed command.
5. Deploy the API project, then configure its stable URL in the web project.
6. Deploy the web project and run the end-to-end demo smoke test.

## Hosted environment preflight

Configure every value for both Vercel **Production** and **Preview** before
deploying. The web runtime refuses to serve when this matrix is incomplete:

| Contract | Required web variables |
|---|---|
| Public origins | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL` |
| Server API origin | `DREAMIFY_API_URL` (same origin as the public API URL) |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_DEMO_AUTH_MODE=false` |
| Private uploads | `BLOB_READ_WRITE_TOKEN` or `BLOB_PRIVATE_READ_WRITE_TOKEN`, plus `BLOB_GATEWAY_SHARED_SECRET` |
| Durable workflow | `INTERNAL_SERVICE_SHARED_SECRET`, `SANDBOX_SNAPSHOT_ID` |

All public URLs must be origin-only HTTPS URLs. Both service secrets must be at
least 32 characters and independently generated. The Blob token and all secret
variables are server-only. Preview may use a separate Clerk instance and data
plane, but each key pair must come from the same instance and OAuth callbacks
must not point at production applications.

The API project must receive the corresponding exact CORS/Clerk origins, Blob
token, Blob gateway secret, internal service secret, workflow dispatch URL,
Neon URLs, and runtime mode. A deploy that reports `WEB_ENV_INVALID` is a
configuration failure; correct the scoped Vercel variables instead of bypassing
the preflight.

BYOK is optional. If enabled, create one random 32-byte encryption key, store its
standard-base64 value in the API project's server-only
`PROVIDER_ENCRYPTION_KEYS` JSON keyring, and set the matching
`PROVIDER_CURRENT_KEY_VERSION`. Do not copy this keyring to the web project.

Generate each service secret independently; never copy placeholder text from an
example file and never reuse the Blob gateway secret as the Workflow internal
secret. One safe local generation command is `openssl rand -base64 48`. Generate
the optional provider key with `openssl rand -base64 32` and place that value in
the versioned JSON keyring.

## Quota response

Application soft stops return a typed quota error before Blob, Neon, Function, or Sandbox quotas are exhausted. Do not raise limits on Hobby without measuring actual usage. Cleanup expired reservations, temporary artifacts, and stale workflow leases before admitting more work.

## Incident response

- Disable affected capability flags rather than leaving partially configured integrations available.
- Revoke BYOK/OAuth credentials on suspected exposure. Rotate the encryption
  key additively, keep old versions available through re-encryption, and remove
  a retired version only after no stored ciphertext references it.
- Cancel active runs, stop known Sandboxes, and release expired workflow leases.
- Use Vercel deployment rollback for the new demo only. The legacy EC2 deployment and DNS are outside this system and remain untouched.
