import { type ElementType } from "react";
import { Link, useNavigate, useParams } from "@/lib/navigation";
import {
  ArrowRight,
  BellRing,
  Bot,
  CalendarClock,
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
import NotFound from "@/legacy-pages/NotFound";
import { Button } from "@/components/ui/button";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";
import { FooterSection } from "@/components/homepage-section/footer-section";
import VideoBackground from "@/components/homepage-section/VideoBackground";
import WaveBackground from "@/ui/lightswind/wave-background";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import {
  SlackLogo,
  TelegramLogo,
  WhatsAppLogo,
  ZaloLogo,
} from "@/components/integrations/ChatPlatformLogos";
import { WorkspaceMockModalPreview } from "@/components/seo/ProductMockModals";
import {
  connectorCapability,
  featureCapability,
  useCapabilities,
} from "@/hooks/useCapabilities";

const surface =
  "rounded-2xl border border-border/70 bg-background/70 shadow-[0_18px_54px_rgba(15,23,42,0.10)] backdrop-blur-2xl";
const iconTile =
  "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary";
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
  const { capabilities } = useCapabilities();
  const workspace = platform ? getWorkspace(platform) : undefined;
  const availability = connectorCapability(capabilities, workspace?.slug);
  const scheduling = featureCapability(capabilities, "scheduling");

  if (!workspace) return <NotFound />;

  const canonical = `https://dreamify-web.vercel.app/product/workspace-agents/${workspace.slug}`;
  const meta = PLATFORM_META[workspace.slug] ?? PLATFORM_META.slack;
  const unavailableReason = availability.reason || "This workspace agent has not been certified for the Hobby demo.";
  const pageTitle = availability.enabled
    ? workspace.title
    : `${workspace.name} Workspace Agent Preview — Unavailable`;
  const pageDescription = availability.enabled
    ? workspace.description
    : `${workspace.name} remains visible as a catalog preview. It cannot connect or send messages until deployment credentials and provider smoke tests pass.`;
  const displayCapabilities = availability.enabled
    ? workspace.capabilities
    : [
      { title: "Catalog preview only", body: unavailableReason },
      { title: "No outbound messages", body: "The default Hobby demo does not call the chat provider or send dashboards to a workspace." },
      { title: "Separate scheduling gate", body: scheduling.reason || "Scheduling is disabled for the Hobby demo." },
      { title: "Web workflow remains available", body: "Use file upload, chat, dashboard editing, version history, and export in Dreamify itself." },
    ];
  const displaySetupSteps = availability.enabled
    ? workspace.setupSteps
    : [
      "The deployment owner configures server-side provider credentials",
      "OAuth state or webhook signatures pass security tests",
      "A stable callback URL is configured outside preview deployments",
      "The provider-specific smoke test succeeds",
      "The capabilities API explicitly enables this workspace agent",
    ];
  const displayUseCases = availability.enabled
    ? workspace.useCases
    : [
      { persona: "Current release", example: "Use Dreamify's web workspace for file-based analysis and dashboard editing." },
      { persona: "Catalog concept", example: `The ${workspace.name} mock illustrates a possible certified delivery experience; it sends no messages.` },
      { persona: "Activation rule", example: "A card becomes available only after credentials, security checks, and provider smoke testing pass." },
    ];
  const displayFaqs = availability.enabled
    ? workspace.faqs
    : [
      { q: `Is Dreamify for ${workspace.name} active?`, a: `No. ${unavailableReason}` },
      { q: "Can I activate it from this page?", a: "No. Public catalog pages cannot bypass the server capability policy." },
      { q: "Can it post scheduled reports?", a: scheduling.enabled ? "Scheduling is enabled separately by the deployment capabilities." : `No. ${scheduling.reason || "Scheduling is disabled."}` },
    ];

  return (
    <>
      <Seo
        title={pageTitle}
        description={pageDescription}
        canonical={canonical}
        noindex={!availability.enabled}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": `${canonical}#webpage`,
            url: canonical,
            name: pageTitle,
            description: pageDescription,
            isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
            inLanguage: "en",
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://dreamify-web.vercel.app/" },
              { "@type": "ListItem", position: 2, name: "Product", item: "https://dreamify-web.vercel.app/landingpage" },
              { "@type": "ListItem", position: 3, name: "Workspace Agents", item: "https://dreamify-web.vercel.app/product/workspace-agents" },
              { "@type": "ListItem", position: 4, name: workspace.name, item: canonical },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: displayFaqs.map((f) => ({
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
              <nav className="mb-10 inline-flex max-w-full items-center gap-2 overflow-hidden rounded-2xl border border-border/70 bg-background/70 px-3 py-2 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur-xl">
                <Home className="h-4 w-4 text-primary" />
                <ChevronRight className="h-3.5 w-3.5" />
                <Link to="/product/workspace-agents" className="truncate no-underline hover:text-primary">
                  Workspace Agents
                </Link>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="truncate text-foreground">{workspace.name}</span>
              </nav>

              <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr]">
                <div>
                  <div className={cn(surface, "mb-7 inline-flex items-center gap-3 px-3 py-3")}>
                    <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm", meta.logoBg)}>
                      <meta.Logo className="h-7 w-7" aria-hidden />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold text-foreground">{workspace.name}</p>
                        <span className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-bold",
                          availability.enabled
                            ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-700 dark:text-emerald-200"
                            : "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-200",
                        )}>
                          {availability.enabled ? "Available" : "Unavailable"}
                        </span>
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Workspace agent
                      </p>
                    </div>
                  </div>

                  <h1 className="max-w-3xl text-5xl font-black leading-[0.94] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
                    {availability.enabled ? workspace.hero.headline : `${workspace.name} workspace-agent concept`}
                  </h1>
                  <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
                    {availability.enabled ? workspace.hero.subhead : unavailableReason}
                  </p>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Button
                      onClick={() => navigate("/login")}
                      disabled={!availability.enabled}
                      title={availability.enabled ? `Connect ${workspace.name}` : unavailableReason}
                      className="button-gradient h-12 rounded-xl px-6 text-sm font-bold text-white shadow-[0_14px_34px_rgba(37,99,235,0.28)]"
                    >
                      {availability.enabled ? `Connect ${workspace.name}` : `${workspace.name} unavailable`}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <WorkspaceMockModalPreview
                  workspace={workspace}
                  meta={meta}
                  unavailableReason={availability.enabled ? undefined : unavailableReason}
                />
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[0.84fr_1.16fr]">
              <div className={cn(surface, "p-6")}>
                <div className={iconTile}>
                  <Workflow className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-tight text-foreground">
                  {availability.enabled ? "What you can do" : "Current release status"}
                </h2>
                <p className="mt-3 text-base leading-7 text-muted-foreground">
                  {availability.enabled
                    ? `Use Dreamify in ${workspace.name} without moving your team out of the conversation.`
                    : `This ${workspace.name} page is an interface preview, not an active integration.`}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {displayCapabilities.map((capability, index) => {
                  const Icon = [CalendarClock, BellRing, MessageSquare, Sparkles][index % 4];
                  return (
                    <div key={capability.title} className={cn(surface, "p-5")}>
                      <div className={iconTile}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-5 text-lg font-black text-foreground">{capability.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-muted-foreground">{capability.body}</p>
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
                  <h2 className="mt-5 text-2xl font-black tracking-tight text-foreground">
                    {availability.enabled ? `Set up Dreamify in ${workspace.name}` : "Certification requirements"}
                  </h2>
                  <p className="mt-3 text-base leading-7 text-muted-foreground">
                    {availability.enabled
                      ? "Route dashboards and alerts into the right team channel."
                      : "Every gate must pass before a Connect action is exposed."}
                  </p>
                </div>
                <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {displaySetupSteps.map((step, index) => (
                    <li key={step} className="relative rounded-2xl border border-border/70 bg-background/55 p-4 shadow-sm">
                      <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-black text-white shadow-[0_8px_22px_rgba(37,99,235,0.3)]">
                        {index + 1}
                      </span>
                      <p className="text-sm font-bold leading-6 text-foreground">{step}</p>
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
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-foreground">
                    {availability.enabled ? `Where ${workspace.name} agents fit` : "How to interpret this preview"}
                  </h2>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {displayUseCases.map((useCase) => (
                  <div key={useCase.persona} className={cn(surface, "p-6")}>
                    <div className="mb-5 inline-flex rounded-xl border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-black text-primary">
                      {useCase.persona}
                    </div>
                    <p className="text-sm leading-7 text-muted-foreground">{useCase.example}</p>
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
                <h2 className="mt-5 text-2xl font-black tracking-tight text-foreground">
                  Frequently asked questions
                </h2>
                <p className="mt-3 text-base leading-7 text-muted-foreground">
                  Common questions about Dreamify for {workspace.name}.
                </p>
              </div>
              <div className={cn(surface, "divide-y divide-border/60 p-2")}>
                {displayFaqs.map((faq) => (
                  <details key={faq.q} className="group rounded-xl px-4 py-4 open:bg-foreground/5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-black text-foreground">
                      {faq.q}
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open:rotate-90 group-open:text-primary" />
                    </summary>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{faq.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className={cn(surface, "mx-auto max-w-7xl p-6")}>
              <h2 className="text-2xl font-black tracking-tight text-foreground">Other catalog previews</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {WORKSPACES.filter((item) => item.slug !== workspace.slug).map((item) => {
                  const itemMeta = PLATFORM_META[item.slug] ?? PLATFORM_META.slack;
                  return (
                    <Link
                      key={item.slug}
                      to={`/product/workspace-agents/${item.slug}`}
                      className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-background/55 p-4 no-underline shadow-sm backdrop-blur-xl transition-colors hover:border-primary/40"
                    >
                      <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm", itemMeta.logoBg)}>
                        <itemMeta.Logo className="h-7 w-7" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black text-foreground">{item.name}</span>
                        <span className="mt-1 block truncate text-xs font-semibold text-muted-foreground">
                          {connectorCapability(capabilities, item.slug).enabled ? "Available" : "Unavailable"}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="relative px-5 py-5 sm:px-8">
            <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
              {[
                { title: "No credentials in the mock", body: "This catalog preview receives no provider credential and sends no message.", Icon: LockKeyhole },
                { title: "Capability-gated routing", body: "Outbound delivery remains blocked unless the server explicitly enables it.", Icon: Send },
                { title: "Web-first release", body: "Generate and review dashboard output in the Dreamify web workspace.", Icon: Sparkles },
              ].map(({ title, body, Icon }) => (
                <div key={title} className={cn(surface, "p-5")}>
                  <div className={iconTile}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-base font-black text-foreground">{title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{body}</p>
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
                  <h2 className="text-xl font-black tracking-tight text-foreground">
                    {availability.enabled ? `Bring Dreamify into ${workspace.name}.` : `${workspace.name} remains unavailable.`}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {availability.enabled
                      ? "Open the invite-only workspace to review connector setup."
                      : "Use file upload in the web app while this connector completes certification."}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => navigate("/login")}
                disabled={!availability.enabled}
                title={availability.enabled ? `Connect ${workspace.name}` : unavailableReason}
                className="button-gradient h-11 rounded-xl px-5 font-bold text-white"
              >
                {availability.enabled ? "Open workspace" : "Unavailable in Hobby demo"}
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
