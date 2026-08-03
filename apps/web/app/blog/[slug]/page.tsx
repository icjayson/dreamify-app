import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BlogShell } from "../blog-shell";
import { getPublishedBlogPost, sanitizeBlogHtml } from "@/server/blog";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedBlogPost(slug);
  if (!post) return { title: "Blog post unavailable", robots: { index: false, follow: false } };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at ?? undefined,
      images: post.cover_image_url ? [{ url: post.cover_image_url, alt: post.cover_image_alt || post.title }] : undefined,
    },
  };
}

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

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPublishedBlogPost(slug);
  if (!post) notFound();

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://dreamify-web.vercel.app").replace(/\/$/, "");
  const canonical = `${siteUrl}/blog/${post.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    image: post.cover_image_url ?? undefined,
    datePublished: post.published_at ?? undefined,
    dateModified: post.updated_at ?? post.published_at ?? undefined,
    author: { "@type": "Organization", name: post.author },
    mainEntityOfPage: canonical,
  };

  return (
    <BlogShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <article className="px-5 pb-20 pt-36 sm:px-8 sm:pt-40">
        <div className="mx-auto max-w-3xl">
          <Link href="/blog" className="text-sm font-medium text-muted-foreground hover:text-foreground">← All posts</Link>
          <div className="mt-6 flex flex-wrap gap-2">
            {post.tags.map((tag) => <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">{tag}</span>)}
          </div>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{post.title}</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{post.description}</p>
          <p className="mt-5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{post.author}</span>
            {post.published_at ? ` · ${dateLabel(post.published_at)}` : ""} · {post.reading_minutes} min read
          </p>
          {post.cover_image_url ? (
            <div className="mt-8 overflow-hidden rounded-2xl border border-border/60">
              <img src={post.cover_image_url} alt={post.cover_image_alt || post.title} className="aspect-[16/9] w-full object-cover" />
            </div>
          ) : null}
          <div
            className="prose prose-neutral mt-10 max-w-none dark:prose-invert prose-a:text-primary prose-img:rounded-xl prose-p:leading-7"
            dangerouslySetInnerHTML={{ __html: sanitizeBlogHtml(post.content_html) }}
          />
          <section className="mt-12 rounded-2xl border border-primary/15 bg-primary/5 p-6 sm:p-8">
            <h2 className="text-xl font-bold tracking-tight">Request access to the Free preview</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Invitation-only, personal and non-commercial. Billing and credit debits are disabled.
            </p>
            <Link href="/signup" className="mt-4 inline-flex rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">Request access</Link>
          </section>
        </div>
      </article>
    </BlogShell>
  );
}
