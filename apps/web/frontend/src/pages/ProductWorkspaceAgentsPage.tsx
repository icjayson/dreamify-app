import { type ElementType, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  ArrowRight,
  Bot,
  ChevronRight,
  MessageSquarePlus,
  Send,
  ShieldCheck,
} from "lucide-react";
import { CONNECTORS } from "@/constants/connectors";
import { Button } from "@/components/ui/button";
import FeedbackModal from "@/components/ui/FeedbackModal";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";
import { FooterSection } from "@/components/homepage-section/footer-section";
import { ProductFaqAccordion } from "@/components/seo/ProductFaqAccordion";
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
import Seo from "@/components/seo/Seo";

const LIVE_PRODUCT_CONNECTORS = CONNECTORS.filter(
  (connector) => connector.isActive && connector.showOnProductPage === true,
);

const CHANNELS: {
  slug: string;
  name: string;
  description: string;
  helper: string;
  logoBg: string;
  Logo: ElementType;
}[] = [
  {
    slug: "slack",
    name: "Slack",
    description: "Ask Dreamify in shared channels and keep the answer in the thread.",
    helper: "Best for team analysis threads",
    logoBg: "bg-[#4A154B]",
    Logo: SlackLogo,
  },
  {
    slug: "telegram",
    name: "Telegram",
    description: "Bring dashboard answers into fast-moving team chats and groups.",
    helper: "Best for lightweight operations teams",
    logoBg: "bg-[#2AABEE]",
    Logo: TelegramLogo,
  },
  {
    slug: "zalo",
    name: "Zalo",
    description: "Use Dreamify in local team conversations and direct messages.",
    helper: "Best for Vietnam-based teams",
    logoBg: "bg-[#0068FF]",
    Logo: ZaloLogo,
  },
  {
    slug: "whatsapp",
    name: "WhatsApp",
    description: "Send analysis, updates, and dashboard links back to your team.",
    helper: "Best for distributed operators",
    logoBg: "bg-[#25D366]",
    Logo: WhatsAppLogo,
  },
];

// Shared between visible FAQ section and FAQPage JSON-LD — same source of truth.
const WORKSPACE_AGENTS_FAQ: { question: string; answer: string }[] = [
  {
    question: "What are workspace agents?",
    answer:
      "A workspace agent is Dreamify running inside your team's chat — Slack, Telegram, Zalo, or WhatsApp. Ask a question in a channel and the agent answers in-thread with a fresh chart from your connected data. Schedule a recurring snapshot to land in any channel. Get an anomaly alert the moment a key metric moves outside expected ranges.\n\nThe point is that dashboards belong where attention already lives. Workspace agents put live data answers in the same conversation where the decision gets made, instead of a BI portal nobody opens.",
  },
  {
    question: "Which chat platforms does Dreamify support?",
    answer:
      "Dreamify supports Slack, Telegram, Zalo, and WhatsApp workspace agents today. Each agent runs as a bot inside your team chat and can answer questions, generate dashboards, and post scheduled snapshots. More platforms are added on a rolling basis based on which channels teams request most.",
  },
  {
    question: "How do workspace agents differ from the Dreamify app?",
    answer:
      "Workspace agents bring the Dreamify experience into your team chat — ask a question in Slack or WhatsApp and get a dashboard answer right in the thread, without leaving the conversation. The full Dreamify app remains available for deeper editing, sharing, and dashboard management.",
  },
  {
    question: "Is data secure when posted to a workspace chat?",
    answer:
      "Dreamify only posts the dashboards and answers you explicitly request. Source credentials and raw data stay inside Dreamify — what gets sent to Slack, Telegram, Zalo, or WhatsApp is the rendered chart or numeric answer, not the underlying tables.",
  },
  {
    question: "Can I schedule reports to a specific channel or chat?",
    answer:
      "Yes. Each connected workspace lets you pick a destination channel, group, or direct message and a schedule (daily, weekly, monthly, or custom). Threshold and anomaly alerts can also be routed to dedicated channels.",
  },
];

const WORKSPACE_AGENT_PROOFS = [
  {
    src: "/workspaceagents.png",
    alt: "Dreamify workspace agent response in Slack showing installs and DAU dashboard proof.",
    label: "Installs dashboard",
  },
  {
    src: "/workspaceagents2.png",
    alt: "Dreamify workspace agent response in Slack showing cohort analysis dashboard proof.",
    label: "Cohort analysis",
  },
] as const;

export default function ProductWorkspaceAgentsPage() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const { resolvedTheme } = useTheme();
  const channelsRef = useRef<HTMLElement>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const liveConnectors = useMemo(() => LIVE_PRODUCT_CONNECTORS, []);

  const openWorkspace = () => {
    navigate(isSignedIn ? "/workspace?tab=connectors" : "/login");
  };

  const scrollToFlow = () => {
    channelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <Seo
        title="Workspace Agents — Dreamify | Slack, Telegram, Zalo, WhatsApp Dashboard Bots"
        description="Dreamify lives where your team works. Ask in Slack, Telegram, Zalo, or WhatsApp; turn answers into AI dashboards and send them back to the team."
        canonical="https://app.dreamify.dev/product/workspace-agents"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": "https://app.dreamify.dev/product/workspace-agents#webpage",
            name: "Dreamify Workspace Agents",
            url: "https://app.dreamify.dev/product/workspace-agents",
            description:
              "Dreamify workspace agents bring AI dashboards into Slack, Telegram, Zalo, and WhatsApp.",
            isPartOf: { "@id": "https://app.dreamify.dev/#website" },
            about: { "@id": "https://app.dreamify.dev/#organization" },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://app.dreamify.dev/" },
              { "@type": "ListItem", position: 2, name: "Product", item: "https://app.dreamify.dev/landingpage" },
              { "@type": "ListItem", position: 3, name: "Workspace Agents", item: "https://app.dreamify.dev/product/workspace-agents" },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Dreamify Workspace Agents",
            itemListElement: CHANNELS.map((c, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: c.name,
              url: `https://app.dreamify.dev/product/workspace-agents/${c.slug}`,
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: WORKSPACE_AGENTS_FAQ.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
        ]}
      />
    <div className="min-h-screen overflow-x-hidden overflow-y-auto homepage-scrollbar bg-background text-foreground">
      {resolvedTheme === "dark" ? (
        <WaveBackground className="fixed inset-0 z-0" />
      ) : (
        <VideoBackground className="fixed inset-0 z-0" />
      )}
      <div className={cn("fixed inset-0 z-[1]", resolvedTheme === "dark" ? "bg-black/60" : "bg-white/20")} />

      <main className="relative z-10">
        <section className="relative flex min-h-[calc(100vh-2rem)] items-center px-5 pb-8 pt-28 sm:px-8 lg:pb-10 lg:pt-24 xl:pt-20">
          <div className="mx-auto grid min-w-0 w-full max-w-[84rem] items-center gap-8 lg:grid-cols-[0.78fr_1.22fr]">
            <div className="min-w-0 text-center lg:text-left">
              <div className={cn(
                "mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em]",
                resolvedTheme === "dark"
                  ? "border-white/30 bg-white/20 text-white"
                  : "border-primary/25 bg-primary/10 text-primary",
              )}>
                <Bot className="h-3.5 w-3.5" />
                Workspace Agents
              </div>
              <h1
                className="font-instrument-serif text-4xl font-semibold italic leading-[0.95] tracking-normal text-foreground dark:text-white sm:text-6xl lg:text-6xl xl:text-[4.25rem]"
                aria-label="Workspace Agents — Dreamify dashboards inside Slack, Telegram, Zalo, and WhatsApp"
              >
                Dreamify lives in
                <span className="block text-primary">your team workspace.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg lg:mx-0">
                Ask in Slack, turn connected data into dashboards, and send insights back to your team.
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <Button
                  onClick={openWorkspace}
                  className="button-gradient h-11 rounded-md px-6 text-sm text-white"
                >
                  {isSignedIn ? "Open workspace" : "Log in"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={scrollToFlow}
                  className="h-11 rounded-md px-6 text-sm"
                >
                  See it in action
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <WorkspaceAgentProofStack />
          </div>
        </section>

        <section ref={channelsRef} className="relative px-5 py-12 sm:px-8" id="supported-channels">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Workspace agents</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Supported team channels
                </h2>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Each channel routes to the workspace connector tab for setup. Public cards do not show private connection status.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {CHANNELS.map((channel) => (
                <Link
                  key={channel.name}
                  to={`/product/workspace-agents/${channel.slug}`}
                  className="group flex min-h-32 w-full items-center gap-4 rounded-lg border border-border/60 bg-background/70 p-5 text-left shadow-sm backdrop-blur-xl transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  aria-label={`Learn about the ${channel.name} workspace agent`}
                >
                  <div className={cn("flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg", channel.logoBg)}>
                    <channel.Logo className="h-7 w-7" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">{channel.name}</h3>
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Supported
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{channel.description}</p>
                    <p className="mt-2 text-xs font-medium text-foreground/70">{channel.helper}</p>
                  </div>
                  <ChevronRight
                    className="h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="relative px-5 py-12 sm:px-8">
          <div className="mx-auto max-w-6xl rounded-lg border border-border/60 bg-background/70 p-5 shadow-sm backdrop-blur-xl sm:p-6">
            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Powered by live data</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Connect once. Use everywhere.
                </h2>
              </div>
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Data stays governed in Dreamify
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {liveConnectors.map((connector) => (
                <div
                  key={connector.name}
                  className="flex min-h-16 items-center gap-3 rounded-md border border-border/60 bg-background/70 p-3"
                >
                  <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md", connector.iconBg ?? "bg-muted dark:bg-white/5")}>
                    <img
                      src={connector.icon}
                      alt=""
                      className={cn("h-7 w-7 object-contain", connector.name === "TikTok Ads" && "scale-125")}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{connector.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{connector.productCategory ?? connector.category}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative px-5 py-12 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 rounded-lg border border-border/60 bg-background/70 p-5 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Need another workspace platform?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Tell us where your team works. Dreamify uses requests to prioritize the channels teams ask for most.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setFeedbackOpen(true)}
              className="h-11 rounded-md px-5 text-sm"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Request a platform
            </Button>
          </div>
        </section>

        <ProductFaqAccordion
          headingId="workspace-agents-faq"
          title="Frequently asked questions"
          description="The most common questions teams ask about Dreamify workspace agents."
          items={WORKSPACE_AGENTS_FAQ}
        />

        <FooterSection />
      </main>
      <FeedbackFloatingButton />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        category="Request Connector & Workspace"
        placeholder="Which workspace platform would you like to see? (e.g. Microsoft Teams, Discord, Line...)"
      />
    </div>
    </>
  );
}

function WorkspaceAgentProofStack() {
  const [primaryProof, secondaryProof] = WORKSPACE_AGENT_PROOFS;

  return (
    <div className="relative mx-auto w-full max-w-[760px] min-w-0 lg:translate-y-6 xl:max-w-[820px] xl:translate-y-8">
      <div className="relative mx-auto flex w-full flex-col items-center gap-3 lg:block">
        <ProofCard
          proof={secondaryProof}
          className="order-2 w-[86%] max-w-[360px] lg:absolute lg:right-0 lg:top-9 lg:order-none lg:z-0 lg:w-[48%] lg:max-w-none lg:rotate-[2deg]"
          imageClassName="max-h-[250px] sm:max-h-[330px] lg:max-h-[min(53vh,500px)] xl:max-h-[min(56vh,560px)]"
          labelClassName="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
        />
        <ProofCard
          proof={primaryProof}
          className="order-1 w-full max-w-[420px] lg:relative lg:z-10 lg:ml-0 lg:w-[70%] lg:max-w-[560px]"
          imageClassName="max-h-[390px] sm:max-h-[500px] lg:max-h-[min(60vh,580px)] xl:max-h-[min(64vh,640px)]"
          labelClassName="bg-primary/10 text-primary"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 p-2 text-[11px] text-muted-foreground backdrop-blur-xl sm:text-xs">
        <span className="font-semibold text-foreground">Available workspace agents:</span>
        {CHANNELS.map((channel) => (
          <span
            key={channel.name}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2 py-0.5 font-medium text-foreground"
          >
            <span className={cn("flex h-4 w-4 items-center justify-center rounded", channel.logoBg)}>
              <channel.Logo className="h-3 w-3" aria-hidden />
            </span>
            {channel.name}
          </span>
        ))}
      </div>
    </div>
  );
}

type WorkspaceAgentProof = (typeof WORKSPACE_AGENT_PROOFS)[number];

function ProofCard({
  proof,
  className,
  imageClassName,
  labelClassName,
}: {
  proof: WorkspaceAgentProof;
  className?: string;
  imageClassName?: string;
  labelClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/65 bg-white/45 p-2 shadow-2xl shadow-primary/10 backdrop-blur-2xl dark:border-white/10 dark:bg-black/30 sm:p-2.5",
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm">
        <span
          className={cn(
            "absolute right-3 top-3 z-10 rounded-full border border-white/70 px-2.5 py-1 text-[10px] font-semibold shadow-sm backdrop-blur-md sm:text-xs",
            labelClassName,
          )}
        >
          {proof.label}
        </span>
        <img
          src={proof.src}
          alt={proof.alt}
          className={cn("mx-auto block w-full object-contain object-top sm:w-auto", imageClassName)}
          draggable={false}
          loading="eager"
        />
      </div>
    </div>
  );
}
