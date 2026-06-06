#!/usr/bin/env node
/**
 * One-time migration helper: bundles the static TypeScript blog content
 * (src/content/blog) and writes it as JSON the backend seed script can ingest.
 *
 * Usage:  node scripts/export-blog-seed.mjs
 * Output: scripts/blog-seed.json
 *
 * The static content model is `sections: { heading, paragraphs[] }[]`; we flatten
 * each section into the new rich-HTML model (`<h2>` + `<p>`) used by the CMS.
 */
import esbuild from "esbuild";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const sectionsToHtml = (sections) =>
  sections
    .map(
      (s) =>
        `<h2>${escapeHtml(s.heading)}</h2>\n` +
        s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")
    )
    .join("\n");

async function main() {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "src/content/blog/index.ts")],
    bundle: true,
    format: "esm",
    write: false,
    platform: "node",
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  const mod = await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );

  const posts = mod.POSTS.map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    target_keyword: p.targetKeyword ?? null,
    persona: p.persona ?? null,
    author: p.author ?? "Dreamify Team",
    status: "published",
    published_at: p.publishedAt ?? null,
    // Temporary cover until real images are uploaded via the CMS.
    cover_image_url: "/og-image.png",
    content_html: sectionsToHtml(p.sections ?? []),
  }));

  const outPath = path.join(ROOT, "scripts/blog-seed.json");
  await writeFile(outPath, JSON.stringify(posts, null, 2), "utf8");
  console.log(`Wrote ${posts.length} posts → ${outPath}`);
}

main().catch((e) => {
  console.error("export-blog-seed failed:", e);
  process.exit(1);
});
