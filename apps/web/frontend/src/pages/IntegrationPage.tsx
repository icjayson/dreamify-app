import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  HelpCircle,
  Home,
  Layers3,
  Link2,
  MessageSquarePlus,
  PlugZap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Seo from "@/components/seo/Seo";
import { getIntegration, INTEGRATIONS } from "@/content/integrations";
import NotFound from "@/pages/NotFound";
import { Button } from "@/components/ui/button";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";
import { FooterSection } from "@/components/homepage-section/footer-section";
import VideoBackground from "@/components/homepage-section/VideoBackground";
import WaveBackground from "../../../src/ui/lightswind/wave-background";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { ConnectorMockModalPreview } from "@/components/seo/ProductMockModals";

const surface =
  "rounded-2xl border border-slate-200/75 bg-white/70 shadow-[0_18px_54px_rgba(15,23,42,0.10)] backdrop-blur-2xl dark:border-white/12 dark:bg-zinc-950/56";
const iconTile =
  "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200/70 bg-blue-50/70 text-primary dark:border-white/10 dark:bg-primary/12";
const chip =
  "inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200/75 bg-white/66 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/7 dark:text-slate-200";

const IntegrationPage = () => {
  const { tool } = useParams<{ tool: string }>();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const integration = tool ? getIntegration(tool) : undefined;

  if (!integration) return <NotFound />;

  const canonical = `https://app.dreamify.dev/product/data-connectors/${integration.slug}`;
  const related = (integration.relatedSlugs ?? [])
    .map((s) => INTEGRATIONS.find((i) => i.slug === s))
    .filter(Boolean);

  return (
    <>
      <Seo
        title={integration.title}
        description={integration.description}
        canonical={canonical}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: `Dreamify + ${integration.name}`,
            description: integration.description,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            url: canonical,
            publisher: { "@id": "https://app.dreamify.dev/#organization" },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://app.dreamify.dev/" },
              { "@type": "ListItem", position: 2, name: "Product", item: "https://app.dreamify.dev/landingpage" },
              { "@type": "ListItem", position: 3, name: "Data Connectors", item: "https://app.dreamify.dev/product/data-connectors" },
              { "@type": "ListItem", position: 4, name: integration.name, item: canonical },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: integration.faqs.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          },
        ]}
      />

      <div className="min-h-screen overflow-x-hidden overflow-y-auto bg-background text-foreground homepage-scrollbar">
        {resolvedTheme === "dark" ? (
          <WaveBackground className="fixed inset-0 z-0" />
        ) : (
          <VideoBackground className="fixed inset-0 z-0" />
        )}
        <div className={cn("fixed inset-0 z-[1]", resolvedTheme === "dark" ? "bg-black/72" : "bg-white/36")} />

        <main className="relative z-10">
          <section className="relative px-5 pb-10 pt-28 sm:px-8 lg:pb-16 lg:pt-32">
            <div className="mx-auto w-full max-w-7xl">
              <nav className="mb-10 inline-flex max-w-full items-center gap-2 overflow-hidden rounded-2xl border border-slate-200/75 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/7 dark:text-slate-300">
                <Home className="h-4 w-4 text-primary" />
                <ChevronRight className="h-3.5 w-3.5" />
                <Link to="/product/data-connectors" className="truncate no-underline hover:text-primary">
                  Data Connectors
                </Link>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="truncate text-slate-950 dark:text-white">{integration.name}</span>
              </nav>

              <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr]">
                <div>
                  <div className={cn(surface, "mb-7 inline-flex items-center gap-3 px-3 py-3")}>
                    <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/75 bg-white/72 dark:border-white/10 dark:bg-white/8", integration.iconBg)}>
                      <img src={integration.icon} alt="" className="h-8 w-8 object-contain" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold text-slate-950 dark:text-white">{integration.name}</p>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/12 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-200">
                          Active
                        </span>
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        {integration.category}
                      </p>
                    </div>
                  </div>

                  <h1 className="max-w-3xl text-5xl font-black leading-[0.94] tracking-tight text-slate-950 dark:text-white sm:text-6xl lg:text-7xl">
                    {integration.hero.headline}
                  </h1>
                  <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                    {integration.hero.subhead}
                  </p>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Button
                      onClick={() => navigate("/signup")}
                      className="button-gradient h-12 rounded-xl px-6 text-sm font-bold text-white shadow-[0_14px_34px_rgba(37,99,235,0.28)]"
                    >
                      Connect {integration.name}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <ConnectorMockModalPreview integration={integration} />
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[0.84fr_1.16fr]">
              <div className={cn(surface, "p-6")}>
                <div className={iconTile}>
                  <BarChart3 className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                  Key metrics available
                </h2>
                <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
                  Explore the data Dreamify can visualize for you.
                </p>
              </div>
              <div className={cn(surface, "p-6")}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {integration.metrics.map((metric) => (
                    <div key={metric} className={chip}>
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      {metric}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[0.84fr_1.16fr]">
              <div className={cn(surface, "p-6")}>
                <div className={iconTile}>
                  <Layers3 className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                  Sample dashboards
                </h2>
                <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
                  Start with ready-to-use dashboard templates.
                </p>
              </div>
              <div className={cn(surface, "divide-y divide-slate-200/70 overflow-hidden p-2 dark:divide-white/10")}>
                {integration.sampleDashboards.map((dashboard, index) => (
                  <div key={dashboard.title} className="group flex items-center gap-4 rounded-xl px-4 py-4 transition-colors hover:bg-white/55 dark:hover:bg-white/7">
                    <span className={iconTile}>
                      {[BarChart3, Sparkles, Layers3][index % 3] &&
                        (() => {
                          const Icon = [BarChart3, Sparkles, Layers3][index % 3];
                          return <Icon className="h-5 w-5" />;
                        })()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-black text-slate-950 dark:text-white">{dashboard.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{dashboard.body}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className={cn(surface, "mx-auto max-w-7xl p-6")}>
              <div className="grid gap-6 lg:grid-cols-[0.25fr_0.75fr] lg:items-center">
                <div>
                  <div className={iconTile}>
                    <Clock3 className="h-6 w-6" />
                  </div>
                  <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                    Set up {integration.name}
                  </h2>
                  <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
                    Connect your account and get your first dashboard in minutes.
                  </p>
                </div>
                <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {integration.setupSteps.map((step, index) => (
                    <li key={step} className="relative rounded-2xl border border-slate-200/75 bg-white/60 p-4 shadow-sm dark:border-white/10 dark:bg-white/7">
                      <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-black text-white shadow-[0_8px_22px_rgba(37,99,235,0.3)]">
                        {index + 1}
                      </span>
                      <p className="text-sm font-bold leading-6 text-slate-800 dark:text-slate-100">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[0.34fr_0.66fr]">
              <div className={cn(surface, "p-6")}>
                <div className={iconTile}>
                  <HelpCircle className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                  Frequently asked questions
                </h2>
                <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
                  Common questions about {integration.name} connector.
                </p>
              </div>
              <div className={cn(surface, "divide-y divide-slate-200/70 p-2 dark:divide-white/10")}>
                {integration.faqs.map((faq) => (
                  <details key={faq.q} className="group rounded-xl px-4 py-4 open:bg-white/55 dark:open:bg-white/7">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-black text-slate-950 dark:text-white">
                      {faq.q}
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-90 group-open:text-primary" />
                    </summary>
                    <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{faq.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          <section className="relative px-5 pb-16 pt-5 sm:px-8">
            <div className={cn(surface, "mx-auto flex max-w-7xl flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between")}>
              <div className="flex items-center gap-4">
                <span className={iconTile}>
                  <MessageSquarePlus className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">Need another connector?</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Tell us what you need next. Dreamify uses connector requests to prioritize the sources teams ask for most.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="h-11 rounded-xl border-slate-200/80 bg-white/40 px-5 font-bold backdrop-blur-xl hover:bg-white/55">
                <Link to="/feedback">
                  Request a connector
                  <MessageSquarePlus className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </section>

          <FooterSection />
        </main>
        <FeedbackFloatingButton />
      </div>
    </>
  );
};

export default IntegrationPage;
