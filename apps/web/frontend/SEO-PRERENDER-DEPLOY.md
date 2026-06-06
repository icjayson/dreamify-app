# SEO Prerender — Production Deploy Guide

This guide covers deploying Section D (build-time prerendering of marketing routes) to production at `app.dreamify.dev`.

The prerender pipeline produces one static HTML file per marketing route under `dist/<route>/index.html`. Each file contains the full Helmet head (title, meta, canonical, OG, Twitter, JSON-LD) and the rendered React body — so crawlers see real per-route content instead of an empty SPA shell.

---

## 1. Prerequisites

- Node 18+ on the build machine (CI runner or deploy box)
- nginx serving the SPA from `dist/`
- Environment variables available at build time (same set used by the existing `npm run build`):
  - `VITE_CLERK_PUBLISHABLE_KEY` (required — without it, the React app throws on mount and the prerender captures the empty shell for every route)
  - `VITE_GA_ID` (recommended)
  - any other `VITE_*` vars your environment uses

The prerender launches headless Chromium (via puppeteer). The puppeteer install pulls a Chromium binary (~170 MB) into `node_modules`. CI runners with image caching won't notice; cold installs will be slower.

---

## 2. The required nginx change

This is the **single change that activates** the prerendered files. Without it, the files exist in `dist/` but are never served.

File: [dreamify-config/prod/nginx/sites-available/dreamify-frontend](../../dreamify-config/prod/nginx/sites-available/dreamify-frontend)

Change line 8:

```diff
  location / {
-     try_files $uri /index.html;
+     try_files $uri $uri/index.html /index.html;
  }
```

### Why this change

| Request | Old behavior | New behavior |
|---|---|---|
| `/static/foo.js` | Serves the file | Serves the file |
| `/landingpage` | Falls back to `/index.html` (SPA shell — empty body for crawlers) | Serves `dist/landingpage/index.html` (prerendered) |
| `/some/unknown/route` | Falls back to `/index.html` (SPA handles or 404s) | Same — falls back to `/index.html` |

Humans get the same fast first paint (the prerendered HTML hydrates into the existing React SPA). Crawlers get the per-route SEO content they need.

### Apply on the server

```bash
# After editing the config file
sudo nginx -t                  # validate
sudo systemctl reload nginx    # apply (no downtime)
```

If `nginx -t` fails, do NOT reload — fix the config first.

---

## 3. Build with prerender

### Local test

```bash
cd frontend

# Set the same env vars your production deploy uses
export VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx   # or your test key for staging
export VITE_GA_ID=G-XXXXXXXXXX

npm install                # ensures puppeteer + http-server are installed
npm run build:seo          # runs `vite build && node scripts/prerender.mjs`
```

You should see one `✓` line per route, ending with `Prerender complete.`

Then verify locally:

```bash
# Spot-check a few routes
grep -o '<title>[^<]*</title>' dist/landingpage/index.html
grep -o '<title>[^<]*</title>' dist/vs/julius-ai/index.html
grep -o '<title>[^<]*</title>' dist/integrations/meta-ads/index.html
```

Each should show the per-route title — not the default `Dreamify — AI Data Visualization | Dashboards in Minutes, Not Days`.

### Smoke test before deploy

```bash
npx http-server dist -p 4173 -s &
SERVER_PID=$!
sleep 2

# Simulate Googlebot / a non-JS crawler
curl -s -A "Googlebot" http://127.0.0.1:4173/landingpage | grep -o '<title>[^<]*</title>'
curl -s -A "Googlebot" http://127.0.0.1:4173/blog/marketing-dashboard-in-5-minutes | grep -o '<h1>[^<]*</h1>' | head -3

kill $SERVER_PID
```

If the titles and H1s match the per-route content, the build is good.

---

## 4. CI / deploy script change

Wherever you currently call `npm run build`, swap to `npm run build:seo`.

### Example: shell deploy script

```diff
- npm run build
+ npm run build:seo
```

### Example: GitHub Actions

```yaml
- name: Build (with prerender)
  env:
    VITE_CLERK_PUBLISHABLE_KEY: ${{ secrets.VITE_CLERK_PUBLISHABLE_KEY }}
    VITE_GA_ID: ${{ vars.VITE_GA_ID }}
  run: |
    cd frontend
    npm ci
    npm run build:seo
```

### Build time impact

| Step | Time |
|---|---|
| `vite build` | ~10s |
| `prerender` (41 routes, serialized) | ~60–90s |
| **Total** | ~70–100s |

For faster CI, the prerender script visits routes serially. If you need parallelism, edit [scripts/prerender.mjs](scripts/prerender.mjs) to use `Promise.all` over a chunked batch — be aware that the local `http-server` and headless Chromium can be sensitive to concurrency.

---

## 5. Deploy order

The nginx change and the prerendered build are independent — but order matters for zero-downtime:

1. **Ship the build first.** Deploy the new `dist/` (containing the prerendered per-route folders) to the server. With the old nginx config still active, every route falls back to the root `index.html` — same as today, no regression.
2. **Then update nginx.** Apply the `try_files` change and reload nginx. Crawlers immediately start receiving per-route content.

This way, if anything goes wrong with the build, the nginx change is a separate, reversible step.

---

## 6. Verification after deploy

Run these against production once the nginx change is live:

```bash
# Title check — should be the per-route title, not the homepage default
curl -s https://app.dreamify.dev/landingpage | grep -o '<title>[^<]*</title>'
curl -s https://app.dreamify.dev/vs/julius-ai | grep -o '<title>[^<]*</title>'
curl -s https://app.dreamify.dev/integrations/meta-ads | grep -o '<title>[^<]*</title>'

# JSON-LD count — should be ≥ 4 on every interior page
curl -s https://app.dreamify.dev/blog/marketing-dashboard-in-5-minutes | grep -c 'application/ld+json'

# Verify a per-page H1 lives in the body (not just the head)
curl -s https://app.dreamify.dev/customers/saas-founder-50 | grep -o '<h1[^>]*>[^<]*</h1>'
```

### Google Search Console

After the deploy lands:

1. **URL Inspection > Test Live URL** on `/landingpage`, `/vs/julius-ai`, `/integrations/meta-ads` — rendered HTML should match what you see in the browser
2. **Coverage** — request indexing for the top 5–10 marketing routes
3. **Sitemaps** — resubmit `https://app.dreamify.dev/sitemap.xml`

### Validators

| Check | URL |
|---|---|
| Rich Results | https://search.google.com/test/rich-results |
| Schema | https://validator.schema.org/ |
| OG card | https://www.opengraph.xyz/ |
| Twitter card | https://cards-dev.twitter.com/validator |

Run each against `/landingpage` first, then a representative route from each category.

---

## 7. Rollback

The implementation is designed to be cheaply reversible at any stage.

### Rollback nginx change only

Revert the one line and reload:

```bash
# Revert to old try_files
sudo sed -i 's|try_files $uri $uri/index.html /index.html;|try_files $uri /index.html;|' \
  /etc/nginx/sites-available/dreamify-frontend
sudo nginx -t && sudo systemctl reload nginx
```

After this, all routes fall back to `dist/index.html` (the SPA shell). The prerendered files sit on disk but are not served — same behavior as before Section D.

### Rollback the build

Just run the existing build instead:

```bash
npm run build     # no prerender — produces a clean SPA-only dist/
```

No prerendered folders will be generated, and nginx (whether on the old or new config) will fall back to the root `index.html` for unknown routes.

### Rollback both

Redeploy from the previous successful build artifact and revert nginx. No code in the existing app depends on the prerender pipeline — removing it is purely additive cleanup.

---

## 8. Troubleshooting

### "Missing Clerk Publishable Key" during prerender

Cause: `VITE_CLERK_PUBLISHABLE_KEY` is not set in the build environment. `vite build` doesn't read `.env.development` in production mode.

Fix: export the key before running `npm run build:seo`, or set it in your CI environment.

### Every prerendered file has the same default title

Cause: React failed to mount in the headless browser (almost always due to a missing env var that throws in [main.tsx](src/main.tsx)). The script captured the [index.html](index.html) shell instead.

Diagnosis: re-run with verbose logging:

```bash
node scripts/prerender.mjs 2>&1 | grep -E "pageerror|console.error"
```

If you see `pageerror: Missing Clerk Publishable Key` or similar, set the env var and rebuild.

### Puppeteer fails to launch

On bare-bones CI containers without Chromium dependencies:

```bash
# Debian/Ubuntu — install Chromium runtime deps
sudo apt-get update && sudo apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
  libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
  libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 \
  libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 \
  libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
  libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
  libxtst6 lsb-release wget xdg-utils
```

GitHub's `ubuntu-latest` runner has these pre-installed.

### "http-server exited early" error

Cause: port 4173 is already in use, or `http-server` isn't installed.

Fix: change the `PORT` constant at the top of [scripts/prerender.mjs](scripts/prerender.mjs), or `npm install` if devDependencies are missing.

### Prerender succeeds but a specific route shows the default title

Cause: the React Helmet for that route wasn't applied before the snapshot — usually because the page took longer than the waitForFunction timeout (15s).

Fix: increase the timeout in [scripts/prerender.mjs](scripts/prerender.mjs), or add a specific selector for that page to the wait condition.

### Bundle hash mismatch between prerendered HTML and served JS

Cause: the prerendered HTML references JS chunks (e.g., `/assets/index-abc123.js`) that came from one build, but the deployed `dist/` came from a different build.

Fix: always run `npm run build:seo` (single build that produces both) — don't try to combine artifacts from two separate builds.

---

## 9. What's prerendered, what isn't

**Prerendered** (no auth gating, public SEO surface):
- `/`, `/pricing`, `/about`
- `/landingpage`, `/features`, `/security`
- `/integrations`, `/integrations/<active-connector>`
- `/workspaces`, `/workspaces/<active-platform>`
- `/vs/<competitor>`
- `/blog`, `/blog/<slug>`
- `/customers`, `/customers/<slug>`

**Not prerendered** (authenticated app surface — never served to crawlers anyway via [robots.txt](public/robots.txt) Disallow):
- `/workspace`, `/workspace/**`
- `/admin`, `/admin/**`
- `/preview/**`, `/templates`, `/feedback`
- `/login`, `/signup`, `/sso-callback`
- `/cancel`, `/success`
- `/zalo-upload/<token>`

If you add a new marketing route, also add it to the `ROUTES` array in [scripts/prerender.mjs](scripts/prerender.mjs) and to [public/sitemap.xml](public/sitemap.xml).

---

## 10. Files reference

| File | Purpose |
|---|---|
| [package.json](package.json) | `build:seo` and `prerender` npm scripts; `puppeteer` + `http-server` devDeps |
| [scripts/prerender.mjs](scripts/prerender.mjs) | The puppeteer post-build prerender script |
| [public/robots.txt](public/robots.txt) | AI crawler grants + auth route Disallow + sitemap pointer |
| [public/sitemap.xml](public/sitemap.xml) | All 41 marketing URLs |
| [public/llms.txt](public/llms.txt) | LLM crawler entry-point manifest |
| [index.html](index.html) | Base shell with Helmet-overrideable meta + JSON-LD |
| [src/components/seo/Seo.tsx](src/components/seo/Seo.tsx) | Per-route Helmet helper |
| [src/components/seo/MarketingShell.tsx](src/components/seo/MarketingShell.tsx) | Shared layout for marketing pages |
| [dreamify-config/prod/nginx/sites-available/dreamify-frontend](../../dreamify-config/prod/nginx/sites-available/dreamify-frontend) | The nginx config that needs the one-line `try_files` change |
