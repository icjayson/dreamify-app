import { type ElementType } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Home,
  LockKeyhole,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import Seo from "@/components/seo/Seo";
import { getWorkspace, WORKSPACES } from "@/content/workspaces";
import NotFound from "@/pages/NotFound";
import { Button } from "@/components/ui/button";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";
import { FooterSection } from "@/components/homepage-section/footer-section";
import VideoBackground from "@/components/homepage-section/VideoBackground";
import WaveBackground from "../../../src/ui/lightswind/wave-background";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import {
  SlackLogo,
  TelegramLogo,
  WhatsAppLogo,
  ZaloLogo,
} from "@/components/integrations/ChatPlatformLogos";
import { WorkspaceMockModalPreview } from "@/components/seo/ProductMockModals";

const surface =
  "rounded-2xl border border-slate-200/75 bg-white/70 shadow-[0_18px_54px_rgba(15,23,42,0.10)] backdrop-blur-2xl dark:border-white/12 dark:bg-zinc-950/56";
const iconTile =
  "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200/70 bg-blue-50/70 text-primary dark:border-white/10 dark:bg-primary/12";
const chip =
  "inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200/75 bg-white/66 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/7 dark:text-slate-200";

const PLATFORM_META: Record<string, { Logo: ElementType; logoBg: string }> = {
  slack: { Logo: SlackLogo, logoBg: "bg-[#4A154B]" },
  telegram: { Logo: TelegramLogo, logoBg: "bg-[#2AABEE]" },
  zalo: { Logo: ZaloLogo, logoBg: "bg-[#0068FF]" },
  whatsapp: { Logo: WhatsAppLogo, logoBg: "bg-[#25D366]" },
};

const WorkspacePageSeo = () => {
  const { platform } = useParams<{ platform: string }>();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const workspace = platform ? getWorkspace(platform) : undefined;

  if (!workspace) return <NotFound />;

  const canonical = `https://app.dreamify.dev/product/workspace-agents/${workspace.slug}`;
  const meta = PLATFORM_META[workspace.slug] ?? PLATFORM_META.slack;

  return (
    <>
      <Seo
        title={workspace.title}
        description={workspace.description}
        canonical={canonical}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": `${canonical}#webpage`,
            url: canonical,
            name: workspace.title,
            isPartOf: { "@id": "https://app.dreamify.dev/#website" },
            inLanguage: "en",
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://app.dreamify.dev/" },
              { "@type": "ListItem", position: 2, name: "Product", item: "https://app.dreamify.dev/landingpage" },
              { "@type": "ListItem", position: 3, name: "Workspace Agents", item: "https://app.dreamify.dev/product/workspace-agents" },
              { "@type": "ListItem", position: 4, name: workspace.name, item: canonical },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: workspace.faqs.map((f) => ({
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
                <Link to="/product/workspace-agents" className="truncate no-underline hover:text-primary">
                  Workspace Agents
                </Link>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="truncate text-slate-950 dark:text-white">{workspace.name}</span>
              </nav>

              <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr]">
                <div>
                  <div className={cn(surface, "mb-7 inline-flex items-center gap-3 px-3 py-3")}>
                    <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm", meta.logoBg)}>
                      <meta.Logo className="h-7 w-7" aria-hidden />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold text-slate-950 dark:text-white">{workspace.name}</p>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/12 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-200">
                          Active
                        </span>
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        Workspace agent
                      </p>
                    </div>
                  </div>

                  <h1 className="max-w-3xl text-5xl font-black leading-[0.94] tracking-tight text-slate-950 dark:text-white sm:text-6xl lg:text-7xl">
                    {workspace.hero.headline}
                  </h1>
                  <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                    {workspace.hero.subhead}
                  </p>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Button
                      onClick={() => navigate("/signup")}
                      className="button-gradient h-12 rounded-xl px-6 text-sm font-bold text-white shadow-[0_14px_34px_rgba(37,99,235,0.28)]"
                    >
                      Connect {workspace.name}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <WorkspaceMockModalPreview workspace={workspace} meta={meta} />
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[0.84fr_1.16fr]">
              <div className={cn(surface, "p-6")}>
                <div className={iconTile}>
                  <Workflow className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                  What you can do
                </h2>
                <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
                  Use Dreamify in {workspace.name} without moving your team out of the conversation.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {workspace.capabilities.map((capability, index) => {
                  const Icon = [CalendarClock, BellRing, MessageSquare, Sparkles][index % 4];
                  return (
                    <div key={capability.title} className={cn(surface, "p-5")}>
                      <div className={iconTile}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-5 text-lg font-black text-slate-950 dark:text-white">{capability.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{capability.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className={cn(surface, "mx-auto max-w-7xl p-6")}>
              <div className="grid gap-6 lg:grid-cols-[0.25fr_0.75fr] lg:items-center">
                <div>
                  <div className={iconTile}>
                    <Send className="h-6 w-6" />
                  </div>
                  <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                    Set up Dreamify in {workspace.name}
                  </h2>
                  <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
                    Route dashboards and alerts into the right team channel.
                  </p>
                </div>
                <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {workspace.setupSteps.map((step, index) => (
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
            <div className="mx-auto max-w-7xl">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Use cases</p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">
                    Where {workspace.name} agents fit
                  </h2>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {workspace.useCases.map((useCase) => (
                  <div key={useCase.persona} className={cn(surface, "p-6")}>
                    <div className="mb-5 inline-flex rounded-xl border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-black text-primary">
                      {useCase.persona}
                    </div>
                    <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">{useCase.example}</p>
                  </div>
                ))}
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
                  Common questions about Dreamify for {workspace.name}.
                </p>
              </div>
              <div className={cn(surface, "divide-y divide-slate-200/70 p-2 dark:divide-white/10")}>
                {workspace.faqs.map((faq) => (
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

          <section className="relative px-5 py-5 sm:px-8">
            <div className={cn(surface, "mx-auto max-w-7xl p-6")}>
              <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">Also works with</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {WORKSPACES.filter((item) => item.slug !== workspace.slug).map((item) => {
                  const itemMeta = PLATFORM_META[item.slug] ?? PLATFORM_META.slack;
                  return (
                    <Link
                      key={item.slug}
                      to={`/product/workspace-agents/${item.slug}`}
                      className="group flex items-center gap-4 rounded-2xl border border-slate-200/75 bg-white/60 p-4 no-underline shadow-sm backdrop-blur-xl transition-colors hover:border-primary/40 dark:border-white/10 dark:bg-white/7"
                    >
                      <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm", itemMeta.logoBg)}>
                        <itemMeta.Logo className="h-7 w-7" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black text-slate-950 dark:text-white">{item.name}</span>
                        <span className="mt-1 block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">Workspace agent</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-primary" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
              {[
                { title: "No source credentials in chat", body: "Raw tables and credentials stay inside Dreamify.", Icon: LockKeyhole },
                { title: "Channel-specific routing", body: "Pick where each report or alert should land.", Icon: Send },
                { title: "Human-readable answers", body: "Dashboards arrive with concise context your team can act on.", Icon: Sparkles },
              ].map(({ title, body, Icon }) => (
                <div key={title} className={cn(surface, "p-5")}>
                  <div className={iconTile}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-base font-black text-slate-950 dark:text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="relative px-5 pb-16 pt-5 sm:px-8">
            <div className={cn(surface, "mx-auto flex max-w-7xl flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between")}>
              <div className="flex items-center gap-4">
                <span className={iconTile}>
                  <Bot className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">Bring Dreamify into {workspace.name}.</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Start free, connect a data source, and send your first dashboard into the workspace your team already uses.
                  </p>
                </div>
              </div>
              <Button onClick={() => navigate("/signup")} className="button-gradient h-11 rounded-xl px-5 font-bold text-white">
                Start free
                <ArrowRight className="h-4 w-4" />
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

export default WorkspacePageSeo;
