import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, BookOpen } from "lucide-react";
import Seo from "@/components/seo/Seo";
import { FooterSection } from "@/components/homepage-section/footer-section";
import VideoBackground from "@/components/homepage-section/VideoBackground";
import WaveBackground from "../../../src/ui/lightswind/wave-background";
import { useTheme } from "@/hooks/useTheme";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { blogService, type BlogPostSummary } from "@/services/blogService";

const formatDate = (value: string | null): string => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const CoverImage = ({ post, className }: { post: BlogPostSummary; className?: string }) => {
  if (post.cover_image_url) {
    return (
      <img
        src={post.cover_image_url}
        alt={post.title}
        loading="lazy"
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    <div className={cn("flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent", className)}>
      <BookOpen className="h-10 w-10 text-primary/40" />
    </div>
  );
};

const MetaRow = ({ post }: { post: BlogPostSummary }) => (
  <div className="flex items-center gap-3 text-xs text-muted-foreground">
    {post.published_at && <span>{formatDate(post.published_at)}</span>}
    {post.published_at && <span aria-hidden>·</span>}
    <span className="inline-flex items-center gap-1">
      <Clock className="h-3.5 w-3.5" />
      {post.reading_minutes} min read
    </span>
  </div>
);

export default function BlogIndex() {
  const { resolvedTheme } = useTheme();
  const { data, isLoading } = useQuery({
    queryKey: ["blog-posts"],
    queryFn: () => blogService.listPosts(),
  });

  const posts = data ?? [];
  const [featured, ...rest] = posts;

  return (
    <>
      <Seo
        title="Dreamify Blog — AI Data Visualization, Dashboards, and SME Analytics"
        description="Practical guides on AI data visualization, marketing dashboards, and analytics for SMEs without a data team."
        canonical="https://app.dreamify.dev/blog"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Blog",
          url: "https://app.dreamify.dev/blog",
          name: "Dreamify Blog",
          publisher: { "@id": "https://app.dreamify.dev/#organization" },
        }}
      />
      <div className="min-h-screen overflow-x-hidden overflow-y-auto homepage-scrollbar bg-background text-foreground">
        {resolvedTheme === "dark" ? (
          <WaveBackground className="fixed inset-0 z-0" />
        ) : (
          <VideoBackground className="fixed inset-0 z-0" />
        )}
        <div className={cn("fixed inset-0 z-[1]", resolvedTheme === "dark" ? "bg-black/72" : "bg-white/35")} />

        <main className="relative z-10">
          {/* Hero */}
          <section className="px-5 pb-8 pt-36 sm:px-8 sm:pt-40 lg:pt-40">
            <div className="mx-auto max-w-6xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Dreamify Blog
              </div>
              <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                Guides on AI dashboards, analytics, and shipping reports faster
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                Practical writing on AI data visualization, dashboard automation, and what actually works for SMEs without a data team.
              </p>
            </div>
          </section>

          <section className="px-5 pb-20 sm:px-8">
            <div className="mx-auto max-w-6xl">
              {isLoading ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-3">
                      <Skeleton className="aspect-[16/9] w-full rounded-xl" />
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-background/65 p-12 text-center">
                  <p className="text-sm font-medium text-foreground">No posts published yet.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Check back soon — new guides are on the way.</p>
                </div>
              ) : (
                <>
                  {/* Featured */}
                  {featured && (
                    <Link to={`/blog/${featured.slug}`} className="group mb-10 block">
                      <Card className="grid overflow-hidden border-border/60 bg-background/70 backdrop-blur-md transition-all hover:border-primary/40 hover:shadow-lg md:grid-cols-2">
                        <div className="aspect-[16/10] overflow-hidden md:aspect-auto">
                          <CoverImage post={featured} className="transition-transform duration-300 group-hover:scale-[1.03]" />
                        </div>
                        <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
                          {featured.tags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                              {featured.tags.slice(0, 2).map((t) => (
                                <Badge key={t} variant="outline">{t}</Badge>
                              ))}
                            </div>
                          )}
                          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{featured.title}</h2>
                          <p className="text-sm leading-7 text-muted-foreground">{featured.description}</p>
                          <MetaRow post={featured} />
                          <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                            Read article
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                          </span>
                        </div>
                      </Card>
                    </Link>
                  )}

                  {/* Grid */}
                  {rest.length > 0 && (
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {rest.map((post) => (
                        <Link key={post.slug} to={`/blog/${post.slug}`} className="group block">
                          <Card className="flex h-full flex-col overflow-hidden border-border/60 bg-background/70 backdrop-blur-md transition-all hover:border-primary/40 hover:shadow-lg">
                            <div className="aspect-[16/9] overflow-hidden">
                              <CoverImage post={post} className="transition-transform duration-300 group-hover:scale-[1.04]" />
                            </div>
                            <div className="flex flex-1 flex-col gap-2.5 p-5">
                              {post.tags.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                  {post.tags.slice(0, 1).map((t) => (
                                    <Badge key={t} variant="outline">{t}</Badge>
                                  ))}
                                </div>
                              )}
                              <h3 className="text-lg font-semibold leading-snug text-foreground">{post.title}</h3>
                              <p className="line-clamp-3 flex-1 text-sm leading-6 text-muted-foreground">{post.description}</p>
                              <MetaRow post={post} />
                            </div>
                          </Card>
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <FooterSection />
        </main>
      </div>
    </>
  );
}
