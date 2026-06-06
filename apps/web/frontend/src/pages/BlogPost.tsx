import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Clock, BookOpen, ChevronDown, ListTree } from "lucide-react";
import Seo from "@/components/seo/Seo";
import NotFound from "@/pages/NotFound";
import BlogContent from "@/components/blog/BlogContent";
import { FooterSection } from "@/components/homepage-section/footer-section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { slugify } from "@/utils/slugify";
import { blogService, type BlogPostSummary } from "@/services/blogService";

const formatDate = (value: string | null): string => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Parse the post HTML, assign a stable id to each H2/H3, and return both the
 * id-augmented HTML (so anchors resolve) and the table-of-contents entries.
 */
const buildToc = (html: string): { html: string; toc: TocItem[] } => {
  if (typeof window === "undefined" || !html) return { html, toc: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const used = new Set<string>();
  const toc: TocItem[] = [];
  doc.querySelectorAll("h2, h3").forEach((el) => {
    const text = el.textContent?.trim() ?? "";
    if (!text) return;
    const base = slugify(text) || "section";
    let id = base;
    let i = 1;
    while (used.has(id)) id = `${base}-${i++}`;
    used.add(id);
    el.id = id;
    toc.push({ id, text, level: el.tagName === "H2" ? 2 : 3 });
  });
  return { html: doc.body.innerHTML, toc };
};

const RelatedCard = ({ post }: { post: BlogPostSummary }) => (
  <Link to={`/blog/${post.slug}`} className="group block">
    <Card className="flex h-full flex-col overflow-hidden border-border/60 bg-background/70 backdrop-blur-md transition-all hover:border-primary/40 hover:shadow-lg">
      <div className="aspect-[16/9] overflow-hidden">
        {post.cover_image_url ? (
          <img src={post.cover_image_url} alt={post.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
            <BookOpen className="h-8 w-8 text-primary/40" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="text-base font-semibold leading-snug text-foreground">{post.title}</h3>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{post.description}</p>
      </div>
    </Card>
  </Link>
);

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();

  const { data: post, isLoading } = useQuery({
    queryKey: ["blog-post", slug],
    queryFn: () => blogService.getPost(slug!),
    enabled: !!slug,
  });

  const { data: allPosts } = useQuery({
    queryKey: ["blog-posts"],
    queryFn: () => blogService.listPosts(),
  });

  const [tocOpen, setTocOpen] = useState(true);
  const { html: bodyHtml, toc } = useMemo(() => buildToc(post?.content_html ?? ""), [post?.content_html]);

  const scrollToHeading = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  // Blog detail pages use a plain solid background (adapts to light/dark via
  // CSS variables) — no video/wave background.
  const themedShell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <main>{children}</main>
    </div>
  );

  if (isLoading) {
    return themedShell(
      <div className="mx-auto max-w-3xl px-5 pb-20 pt-36 sm:px-8 sm:pt-40 lg:pt-40">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-6 h-12 w-full" />
        <Skeleton className="mt-3 h-12 w-2/3" />
        <Skeleton className="mt-8 aspect-[16/9] w-full rounded-2xl" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>,
    );
  }

  if (!post) return <NotFound />;

  const canonical = `https://app.dreamify.dev/blog/${post.slug}`;
  const related = (allPosts ?? []).filter((p) => p.slug !== post.slug).slice(0, 3);

  return (
    <>
      <Seo
        title={post.title}
        description={post.description}
        canonical={canonical}
        ogType="article"
        ogImage={post.cover_image_url || undefined}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.description,
            image: post.cover_image_url || undefined,
            datePublished: post.published_at || undefined,
            dateModified: post.updated_at || post.published_at || undefined,
            author: { "@type": "Organization", name: post.author },
            publisher: { "@id": "https://app.dreamify.dev/#organization" },
            mainEntityOfPage: canonical,
            keywords: post.target_keyword || undefined,
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://app.dreamify.dev/" },
              { "@type": "ListItem", position: 2, name: "Blog", item: "https://app.dreamify.dev/blog" },
              { "@type": "ListItem", position: 3, name: post.title, item: canonical },
            ],
          },
        ]}
      />
      {themedShell(
        <>
          <article className="px-5 pb-16 pt-36 sm:px-8 sm:pt-40 lg:pt-40">
            <div className="mx-auto max-w-3xl">
              <Link to="/blog" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
                All posts
              </Link>

              {post.tags.length > 0 && (
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  {post.tags.map((t) => (
                    <Badge key={t} variant="outline">{t}</Badge>
                  ))}
                </div>
              )}

              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
                {post.title}
              </h1>
              <p className="mt-4 text-lg leading-8 text-muted-foreground">{post.description}</p>

              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{post.author}</span>
                {post.published_at && <span aria-hidden>·</span>}
                {post.published_at && <span>{formatDate(post.published_at)}</span>}
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {post.reading_minutes} min read
                </span>
              </div>

              {/* Table of contents — sits in the hero, under the meta cluster.
                  Expandable, default open. */}
              {toc.length > 0 && (
                <div className="mt-6 overflow-hidden rounded-xl border border-border/60 bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setTocOpen((o) => !o)}
                    aria-expanded={tocOpen}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ListTree className="h-4 w-4 text-primary" />
                      Table of contents
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !tocOpen && "-rotate-90")} />
                  </button>
                  {tocOpen && (
                    <nav className="border-t border-border/60 px-4 py-3">
                      <ul className="space-y-1.5">
                        {toc.map((item) => (
                          <li key={item.id} className={item.level === 3 ? "ml-4" : ""}>
                            <a
                              href={`#${item.id}`}
                              onClick={(e) => scrollToHeading(e, item.id)}
                              className="text-sm leading-6 text-muted-foreground transition-colors hover:text-primary"
                            >
                              {item.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  )}
                </div>
              )}

              {post.cover_image_url && (
                <div className="mt-8 overflow-hidden rounded-2xl border border-border/60">
                  <img src={post.cover_image_url} alt={post.title} className="aspect-[16/9] w-full object-cover" />
                </div>
              )}

              <div className="mt-10">
                <BlogContent html={bodyHtml} className="prose-headings:scroll-mt-28" />
              </div>

              {/* CTA */}
              <div className="mt-12 flex flex-col items-start gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-6 sm:p-8">
                <h2 className="text-xl font-bold tracking-tight text-foreground">Try Dreamify free</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Generate your first AI dashboard in minutes — no SQL, no credit card.
                </p>
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </article>

          {/* Keep reading — fixed right sidebar on wide screens, with cover previews */}
          {related.length > 0 && (
            <aside className="fixed right-6 top-32 z-30 hidden w-56 xl:block">
              <div className="rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm backdrop-blur-md">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keep reading</h2>
                <ul className="space-y-4">
                  {related.map((p) => (
                    <li key={p.slug}>
                      <Link to={`/blog/${p.slug}`} className="group block">
                        <div className="aspect-[16/9] overflow-hidden rounded-md border border-border/60">
                          {p.cover_image_url ? (
                            <img
                              src={p.cover_image_url}
                              alt={p.title}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
                              <BookOpen className="h-6 w-6 text-primary/40" />
                            </div>
                          )}
                        </div>
                        <span className="mt-2 block line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
                          {p.title}
                        </span>
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {p.reading_minutes} min read
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          )}

          {/* Keep reading — bottom grid fallback on narrow screens */}
          {related.length > 0 && (
            <section className="px-5 pb-20 sm:px-8 xl:hidden">
              <div className="mx-auto max-w-6xl">
                <h2 className="mb-6 text-2xl font-bold tracking-tight text-foreground">Keep reading</h2>
                <div className="grid gap-6 md:grid-cols-3">
                  {related.map((p) => (
                    <RelatedCard key={p.slug} post={p} />
                  ))}
                </div>
              </div>
            </section>
          )}

          <FooterSection />
        </>,
      )}
    </>
  );
}
