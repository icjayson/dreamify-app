import type { MetadataRoute } from "next";

import { listPublishedBlogPosts } from "@/server/blog";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://dreamify-web.vercel.app").replace(/\/$/, "");
  const routes = ["", "/about", "/pricing", "/features", "/security", "/product/data-connectors", "/blog", "/docs", "/privacy", "/terms"];
  const staticRoutes: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${base}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));
  const posts = await listPublishedBlogPosts();
  const blogRoutes: MetadataRoute.Sitemap = (posts ?? []).map((post) => ({
    url: `${base}/blog/${post.slug}`,
    lastModified: post.updated_at ?? post.published_at ?? undefined,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  return [...staticRoutes, ...blogRoutes];
}
