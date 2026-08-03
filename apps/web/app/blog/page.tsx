import type { Metadata } from "next";
import Link from "next/link";

import { BlogShell } from "./blog-shell";
import { listPublishedBlogPosts, type BlogPostSummary } from "@/server/blog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog",
  description: "Practical guides to data analysis, visualization, and dashboard design.",
  alternates: { canonical: "/blog" },
};

function dateLabel(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function PostImage({ post, eager = false }: { post: BlogPostSummary; eager?: boolean }) {
  if (!post.cover_image_url) {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/20 via-primary/5 to-transparent text-sm text-primary/60">
        Dreamify guide
      </div>
    );
  }
  return (
    <img
      src={post.cover_image_url}
      alt={post.cover_image_alt || post.title}
      loading={eager ? "eager" : "lazy"}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

function PostMeta({ post }: { post: BlogPostSummary }) {
  return (
    <p className="text-xs text-muted-foreground">
      {dateLabel(post.published_at)}{post.published_at ? " · " : ""}{post.reading_minutes} min read
    </p>
  );
}

export default async function BlogIndexPage() {
  const posts = await listPublishedBlogPosts();
  const featured = posts?.find((post) => post.featured) ?? posts?.[0];
  const remaining = posts?.filter((post) => post.slug !== featured?.slug) ?? [];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dreamify-web.vercel.app";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Dreamify Blog",
    url: `${siteUrl.replace(/\/$/, "")}/blog`,
  };

  return (
    <BlogShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <section className="px-5 pb-8 pt-36 sm:px-8 sm:pt-40">
        <div className="mx-auto max-w-6xl">
          <p className="mb-4 inline-flex rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Dreamify Blog
          </p>
          <h1 className="max-w-3xl text-4xl font-medium tracking-tight sm:text-5xl">
            Guides on AI dashboards, analytics, and shipping reports faster
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Practical writing for the invite-only Hobby preview and teams learning how to turn bounded data files into useful dashboards.
          </p>
        </div>
      </section>
      <section className="px-5 pb-20 sm:px-8">
        <div className="mx-auto max-w-6xl">
          {posts === null ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center">
              <p className="font-medium">The blog API is temporarily unavailable.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try again after the API deployment is healthy.</p>
            </div>
          ) : posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center">
              <p className="font-medium">No posts published yet.</p>
            </div>
          ) : (
            <>
              {featured ? (
                <Link href={`/blog/${featured.slug}`} className="group mb-10 grid overflow-hidden rounded-xl border border-border/60 bg-card md:grid-cols-2 md:items-center">
                  <div className="aspect-[16/9] overflow-hidden"><PostImage post={featured} eager /></div>
                  <div className="flex flex-col gap-3 p-6">
                    <div className="flex flex-wrap gap-2">
                      {featured.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">{tag}</span>)}
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{featured.title}</h2>
                    <p className="text-sm leading-7 text-muted-foreground">{featured.description}</p>
                    <PostMeta post={featured} />
                    <span className="text-sm font-medium text-primary">Read article →</span>
                  </div>
                </Link>
              ) : null}
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {remaining.map((post) => (
                  <Link key={post.slug} href={`/blog/${post.slug}`} className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-colors hover:border-primary/40">
                    <div className="aspect-[16/9] overflow-hidden"><PostImage post={post} /></div>
                    <div className="flex flex-1 flex-col gap-2.5 p-5">
                      <h2 className="text-lg font-semibold leading-snug">{post.title}</h2>
                      <p className="line-clamp-3 flex-1 text-sm leading-6 text-muted-foreground">{post.description}</p>
                      <PostMeta post={post} />
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </BlogShell>
  );
}
