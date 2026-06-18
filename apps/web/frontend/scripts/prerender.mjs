#!/usr/bin/env node
/**
 * Post-build prerender for SEO marketing routes.
 *
 * Runs after `vite build`. Spins up a local static server pointing at dist/
 * with SPA fallback, launches puppeteer, visits each marketing route, waits
 * for React Helmet to populate the head, then snapshots the rendered HTML to
 * dist/<route>/index.html.
 *
 * Authenticated routes are NOT prerendered.
 *
 * NOTE for deploy: nginx must be configured with `try_files $uri $uri/index.html /index.html;`
 * for these prerendered files to be served. Current config uses `try_files $uri /index.html;`
 * which bypasses the per-route folders.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ROUTES = [
  "/",
  "/pricing",
  "/about",
  "/landingpage",
  "/features",
  "/security",
  "/docs",
  "/privacy",
  "/terms",
  "/product/data-connectors",
  "/product/data-connectors/meta-ads",
  "/product/data-connectors/google-ads",
  "/product/data-connectors/ga4",
  "/product/data-connectors/tiktok-ads",
  "/product/data-connectors/google-sheets",
  "/product/data-connectors/stripe",
  "/product/data-connectors/appsflyer",
  "/product/data-connectors/firebase",
  "/product/data-connectors/postgresql",
  "/product/data-connectors/bigquery",
  "/product/data-connectors/snowflake",
  "/product/workspace-agents",
  "/product/workspace-agents/slack",
  "/product/workspace-agents/telegram",
  "/product/workspace-agents/zalo",
  "/product/workspace-agents/whatsapp",
  "/vs",
  "/vs/julius-ai",
  "/vs/looker-studio",
  "/vs/power-bi",
  "/vs/airbook",
  "/vs/omni",
  "/vs/tableau",
  "/vs/chatgpt-for-data",
  "/blog",
  // Individual /blog/<slug> routes are discovered at build time from the API
  // (see discoverBlogRoutes) so CMS-authored posts get prerendered too.
  "/customers",
  "/customers/vietnamese-ecommerce-sme",
  "/customers/saas-founder-50",
  "/customers/performance-marketing-agency",
  "/customers/d2c-brand-revenue",
  "/customers/agency-onboarding",
];

// Discover published blog slugs from the API so CMS posts are prerendered.
// Controlled by PRERENDER_API_URL (falls back to VITE_API_URL). Never throws —
// on any failure we simply prerender /blog without individual post routes.
async function discoverBlogRoutes() {
  const apiBase = (process.env.PRERENDER_API_URL || process.env.VITE_API_URL || "").replace(/\/$/, "");
  if (!apiBase) {
    console.warn("[blog] No PRERENDER_API_URL/VITE_API_URL set; skipping blog post prerender");
    return [];
  }
  try {
    const res = await fetch(`${apiBase}/api/v1/blog/posts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = await res.json();
    const routes = (Array.isArray(posts) ? posts : [])
      .filter((p) => p && p.slug)
      .map((p) => `/blog/${p.slug}`);
    console.log(`[blog] Discovered ${routes.length} blog post routes from API`);
    return routes;
  } catch (e) {
    console.warn(`[blog] Could not discover blog routes (${e.message}); prerendering /blog only`);
    return [];
  }
}

function startStaticServer() {
  // Use http-server with SPA fallback so unknown routes resolve to /index.html
  const proc = spawn(
    "npx",
    ["--no-install", "http-server", DIST, "-p", String(PORT), "-s", "--proxy", `${ORIGIN}?`],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  return new Promise((resolve, reject) => {
    let ready = false;
    const onData = (buf) => {
      const txt = buf.toString();
      if (!ready && /Available on|Hit CTRL-C to stop/.test(txt)) {
        ready = true;
        resolve(proc);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (!ready) reject(new Error(`http-server exited early (code ${code})`));
    });
    // Safety timeout
    setTimeout(() => {
      if (!ready) {
        ready = true;
        resolve(proc);
      }
    }, 3000);
  });
}

async function prerenderRoute(browser, route) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.warn(`[${route}] pageerror:`, e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // Suppress noisy Clerk warnings during prerender
      const text = msg.text();
      if (/clerk/i.test(text) || /publishable key/i.test(text)) return;
      console.warn(`[${route}] console.error:`, text);
    }
  });

  try {
    await page.goto(`${ORIGIN}${route}`, { waitUntil: "networkidle0", timeout: 45000 });

    // Wait for Helmet to update the title away from the default "Dreamify —"
    // index.html default, OR for the H1 inside main to appear.
    await page.waitForFunction(
      () => document.querySelector("main h1") !== null,
      { timeout: 15000 }
    ).catch(() => {
      console.warn(`[${route}] main h1 not detected within timeout; capturing anyway`);
    });

    // Small settle delay for any in-flight head mutations from Helmet.
    await new Promise((r) => setTimeout(r, 250));

    const html = await page.content();

    // Write to dist/<route>/index.html
    const outDir = path.join(DIST, route.replace(/^\//, ""));
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), html, "utf8");

    // Quick verification — capture title for the console log
    const title = await page.title();
    console.log(`  ✓ ${route}  →  ${title.slice(0, 80)}`);
  } finally {
    await page.close();
  }
}

async function main() {
  const blogRoutes = await discoverBlogRoutes();
  const routes = [...ROUTES, ...blogRoutes];
  console.log(`Prerendering ${routes.length} marketing routes from ${DIST}`);

  const server = await startStaticServer();
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Serialize page renders to avoid overwhelming the local server
    for (const route of routes) {
      try {
        await prerenderRoute(browser, route);
      } catch (e) {
        console.error(`  ✗ ${route}  →  ${e.message}`);
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }

  console.log("Prerender complete.");
}

main().catch((e) => {
  console.error("Prerender failed:", e);
  process.exit(1);
});
