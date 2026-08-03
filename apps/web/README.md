# Dreamify Web

Dreamify Web is the Next.js App Router frontend for the private, non-commercial Hobby demo. It preserves the existing React UI through a client-only compatibility shell while Next.js owns routing, redirects, metadata, `robots.txt`, `sitemap.xml`, true 404 responses, and the private Vercel Blob upload gateway.

## Local development

Run commands from the monorepo root whenever possible:

```bash
npm install
npm run dev --workspace @dreamify/web
```

Copy `.env.example` to an ignored local environment file and provide only the services you use. With no Clerk key, the app uses a local demo identity. With no capabilities response, it applies the locked `hobby_demo` limits. Billing and credit network calls are disabled in every case.

Useful checks:

```bash
npm run lint --workspace @dreamify/web
npm run typecheck --workspace @dreamify/web
npm test --workspace @dreamify/web
npm run build --workspace @dreamify/web
```

## Vercel project

- Root directory: `apps/web`
- Framework preset: Next.js
- Region: Singapore (`sin1`), configured in `vercel.json`
- Build command: `npm run build`
- Install command: use the repository-level npm lockfile

Set `NEXT_PUBLIC_API_URL` to the FastAPI deployment. Set `DREAMIFY_API_URL` to its server-reachable URL. A private Blob store must provide `BLOB_PRIVATE_READ_WRITE_TOKEN` (or Vercel's standard `BLOB_READ_WRITE_TOKEN`), and the web and API projects must share `BLOB_GATEWAY_SHARED_SECRET`.

Production and preview deployments run a fail-closed server preflight during
App Router startup and in the request proxy. It requires HTTPS origin-only
values for `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, and
`DREAMIFY_API_URL`; matching Clerk publishable/secret keys;
`NEXT_PUBLIC_DEMO_AUTH_MODE=false`; one private Blob token; independently
generated `BLOB_GATEWAY_SHARED_SECRET` and
`INTERNAL_SERVICE_SHARED_SECRET` values of at least 32 characters; and a pinned
`SANDBOX_SNAPSHOT_ID` beginning with `snap_`. The browser and server API origins
must match. Missing or placeholder configuration raises `WEB_ENV_INVALID`
before the application serves a request. Local builds and `vercel dev` do not
require hosted credentials.

## Upload contract

The browser first creates `POST /api/v1/uploads/intents`, then uploads directly to private Blob through `POST /api/blob/upload`. The gateway validates the exact pathname, content type, size, user, project, and reservation with FastAPI before issuing a pathname-scoped token. Blob completion uses a server-only shared secret; the browser token is never embedded in the callback payload. The browser finally calls the idempotent intent finalizer.

After authorizing asset ownership and run membership, FastAPI can request a private object URL from `POST /api/blob/sign`. This server-only route requires `X-Blob-Gateway-Secret`, scopes access to one `uploads/` pathname and GET operation for at most 15 minutes, returns an ISO-8601 `expires_at`, and never returns Blob credentials.

Preview limits are 10 MiB per file, three files per run, and 25 MiB total per run. CSV, XLSX, XLS, and flat JSON are supported.

## Migration boundary

`src/legacy-pages` and the existing components remain inside a client-only bridge for UI parity. A small adapter in `src/lib/navigation.tsx` maps their existing navigation calls to Next.js; React Router is not shipped. New platform entrypoints belong in `app`, and new shared frontend behavior should use Next.js APIs directly.

`npm run lint` checks all TypeScript under `app` and `src` with warnings treated as failures. The only excluded TypeScript is the dormant, unreferenced `src/ui/lightswind` gallery snapshot; its active `wave-background.tsx` primitive remains linted. A pre-lint boundary check fails if any other gallery primitive is imported, so code must enter the linted application graph before it can become runtime code. TypeScript and the production build additionally validate the complete reachable dependency graph.
