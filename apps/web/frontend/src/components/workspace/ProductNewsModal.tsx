import { Button } from "@/components/ui/button";
import { BUILTIN_TEMPLATES } from "@/constants/builtinTemplates";
import { CONNECTORS } from "@/constants/connectors";
import { cn } from "@/lib/utils";
import TemplateColorPreview from "@/components/templates/TemplateColorPreview";
import {
  CalendarClock,
  ChartNoAxesCombined,
  Files,
  Link2,
  PlugZap,
  Sparkles,
  X,
} from "lucide-react";

export type WorkspaceNewsTargetTab = "new-chat" | "connectors" | "dashboards" | "schedules";

export interface WorkspaceNewsItem {
  id: "multi-file-analyze" | "data-connectors" | "templates" | "dashboard-shared-link" | "schedule-syncs";
  tag: string;
  title: string;
  body: string[];
  ctaLabel: string;
  targetTab: WorkspaceNewsTargetTab;
}

export const WORKSPACE_NEWS_ITEMS: WorkspaceNewsItem[] = [
  {
    id: "multi-file-analyze",
    tag: "MULTI-SOURCE ANALYTICS",
    title: "Analyze multiple files in one run",
    body: [
      "Drop up to 5 CSV or Excel files and ask one question to compare metrics across datasets.",
      "Dreamify merges context automatically so you can identify trends and outliers faster.",
    ],
    ctaLabel: "Start a New Project",
    targetTab: "new-chat",
  },
  {
    id: "data-connectors",
    tag: "DATA CONNECTORS",
    title: "Connect live data sources in minutes",
    body: [
      "Link GA4, Google Ads, Sheets, Stripe, and more from one place.",
      "Use connector-based sync so your dashboards stay fresh without manual uploads.",
    ],
    ctaLabel: "Open Connectors",
    targetTab: "connectors",
  },
  {
    id: "templates",
    tag: "TEMPLATES",
    title: "Launch with beautiful dashboard templates",
    body: [
      "Pick a ready-made template to get KPI layout, charts, and storytelling structure instantly.",
      "Great when you need executive-ready dashboards without starting from scratch.",
    ],
    ctaLabel: "Create with Template",
    targetTab: "new-chat",
  },
  {
    id: "dashboard-shared-link",
    tag: "SHARED LINK",
    title: "Share dashboards with a public link",
    body: [
      "Generate a share link for stakeholders in seconds and keep everyone aligned.",
      "Perfect for async reporting across teams, clients, and decision makers.",
    ],
    ctaLabel: "Go to Dashboards",
    targetTab: "dashboards",
  },
  {
    id: "schedule-syncs",
    tag: "SCHEDULED SYNCS",
    title: "Automate refresh with recurring syncs",
    body: [
      "Set daily or weekly syncs so connector data is updated automatically.",
      "Spend less time on data prep and more time on insights.",
    ],
    ctaLabel: "Set Up Syncs",
    targetTab: "schedules",
  },
];

interface ProductNewsModalProps {
  open: boolean;
  feature: WorkspaceNewsItem | null;
  onClose: () => void;
  onExplore: (feature: WorkspaceNewsItem) => void;
}

function MultiFileBanner() {
  const files = ["Revenue_Q1.xlsx", "Ad_Spend.csv", "CRM_Leads.xlsx", "Retention.csv"];
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-600 p-5">
      <div className="absolute -top-8 -right-6 h-28 w-28 rounded-full bg-white/20 blur-2xl" />
      <div className="absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-cyan-300/40 blur-2xl" />
      <div className="absolute right-2 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full bg-fuchsia-300/30 blur-3xl" />

      <div className="relative flex h-full min-h-[300px] flex-col rounded-2xl border border-white/25 bg-black/20 p-4 backdrop-blur-md">
        <div className="mb-3 flex items-center gap-2 text-white/90">
          <Files className="h-4 w-4" />
          <span className="text-xs font-semibold tracking-wide">Multi-file input</span>
        </div>
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file}
              className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-1.5"
            >
              <span className="truncate text-xs text-white/95">{file}</span>
              <span className="ml-2 text-[10px] font-medium text-emerald-200">Ready</span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-white/15 bg-white/10 p-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/70">Merged insights</div>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-md bg-white/10 py-1.5 text-white">+22% ROAS</div>
            <div className="rounded-md bg-white/10 py-1.5 text-white">-14% CPA</div>
            <div className="rounded-md bg-white/10 py-1.5 text-white">+9% LTV</div>
          </div>
        </div>
        <div className="mt-auto pt-3">
          <div className="rounded-xl border border-white/15 bg-white/10 p-3">
            <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/70">Cross-file confidence</div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full w-[95%] rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" />
            </div>
            <p className="mt-1 text-[10px] text-white/85">95% strong correlation across all uploaded datasets</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectorsBanner() {
  const activeConnectors = CONNECTORS.filter((c) => c.isActive).slice(0, 8);
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 p-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_40%)]" />
      <div className="absolute -bottom-16 -left-14 h-40 w-40 rounded-full bg-lime-300/25 blur-3xl" />
      <div className="relative flex h-full min-h-[300px] flex-col rounded-2xl border border-white/25 bg-black/20 p-4 backdrop-blur-md">
        <div className="mb-3 flex items-center gap-2 text-white/90">
          <PlugZap className="h-4 w-4" />
          <span className="text-xs font-semibold tracking-wide">Popular connectors</span>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {activeConnectors.map((connector) => (
            <div
              key={connector.name}
              className={cn(
                "flex h-14 flex-col items-center justify-center rounded-xl border border-white/15 bg-white/10 p-1.5",
                connector.iconBg
              )}
            >
              <img src={connector.icon} alt={connector.name} className="mb-1 h-6 w-6 object-contain" />
              <span className="line-clamp-1 text-[9px] text-white/90">{connector.name}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto grid grid-cols-2 gap-2.5 pt-3">
          <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <p className="text-[10px] text-white/75">Active sources</p>
            <p className="text-sm font-semibold text-white">8 connected</p>
          </div>
          <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <p className="text-[10px] text-white/75">Sync health</p>
            <p className="text-sm font-semibold text-emerald-100">Stable</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplatesBanner() {
  const templateNames = BUILTIN_TEMPLATES.slice(0, 3).map((t) => t.name);
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 p-5">
      <div className="absolute -right-12 top-1/3 h-36 w-36 rounded-full bg-red-200/35 blur-3xl" />
      <div className="relative flex h-full min-h-[300px] flex-col rounded-2xl border border-white/25 bg-black/20 p-4 backdrop-blur-md">
        <div className="mb-3 flex items-center gap-2 text-white/90">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-semibold tracking-wide">Template-ready layouts</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/20">
          <TemplateColorPreview theme="default" className="h-40 w-full" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {templateNames.map((name) => (
            <span key={name} className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] text-white/95">
              {name}
            </span>
          ))}
        </div>
        <div className="mt-auto pt-3">
          <div className="rounded-xl border border-white/20 bg-white/10 p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/70">Designer tip</p>
            <p className="mt-1 text-xs text-white/90">
              Start with a template, then refine colors and metrics for your brand voice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SharedLinkBanner() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 p-5">
      <div className="absolute -left-10 -top-10 h-36 w-36 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="relative flex h-full min-h-[300px] flex-col rounded-2xl border border-white/20 bg-black/20 p-4 backdrop-blur-md">
        <div className="mb-3 flex items-center gap-2 text-white/90">
          <Link2 className="h-4 w-4" />
          <span className="text-xs font-semibold tracking-wide">Dashboard sharing</span>
        </div>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-2.5 py-2 text-[11px] text-white/95">
          <span className="truncate">dreamify.app/dashboard/team-growth-q2</span>
        </div>
        <div className="rounded-xl border border-white/20 bg-white/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] text-white/85">Weekly KPI Snapshot</span>
            <ChartNoAxesCombined className="h-3.5 w-3.5 text-emerald-200" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            <div className="rounded-md bg-white/10 px-1 py-1.5 text-white">Revenue +18%</div>
            <div className="rounded-md bg-white/10 px-1 py-1.5 text-white">CAC -9%</div>
            <div className="rounded-md bg-white/10 px-1 py-1.5 text-white">LTV +12%</div>
          </div>
        </div>
        <div className="mt-auto pt-3">
          <div className="rounded-xl border border-white/20 bg-white/10 p-3">
            <p className="text-[10px] text-white/75">Link access</p>
            <div className="mt-1 flex items-center justify-between text-xs text-white">
              <span>Team + External</span>
              <span className="rounded-full bg-emerald-300/30 px-2 py-0.5 text-[10px] text-emerald-100">Live</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleBanner() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 p-5">
      <div className="absolute -right-12 -bottom-14 h-40 w-40 rounded-full bg-rose-200/25 blur-3xl" />
      <div className="relative flex h-full min-h-[300px] flex-col rounded-2xl border border-white/20 bg-black/20 p-4 backdrop-blur-md">
        <div className="mb-3 flex items-center gap-2 text-white/90">
          <CalendarClock className="h-4 w-4" />
          <span className="text-xs font-semibold tracking-wide">Auto-sync timeline</span>
        </div>
        <div className="space-y-2.5">
          {[
            { source: "GA4", cadence: "Daily 07:00 UTC", status: "Active" },
            { source: "Meta Ads", cadence: "Weekly Mon", status: "Active" },
            { source: "Stripe", cadence: "Daily 09:00 UTC", status: "Paused" },
          ].map((row) => (
            <div key={row.source} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white">{row.source}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                    row.status === "Active" ? "bg-emerald-300/30 text-emerald-100" : "bg-zinc-300/30 text-zinc-100"
                  )}
                >
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-white/80">{row.cadence}</p>
            </div>
          ))}
        </div>
        <div className="mt-auto pt-3">
          <div className="rounded-xl border border-white/20 bg-white/10 p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/70">Next run</p>
            <div className="mt-1 flex items-end justify-between">
              <p className="text-sm font-semibold text-white">in 1h 24m</p>
              <p className="text-[10px] text-emerald-100">No action needed</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewsBanner({ featureId }: { featureId: WorkspaceNewsItem["id"] }) {
  if (featureId === "multi-file-analyze") return <MultiFileBanner />;
  if (featureId === "data-connectors") return <ConnectorsBanner />;
  if (featureId === "templates") return <TemplatesBanner />;
  if (featureId === "dashboard-shared-link") return <SharedLinkBanner />;
  return <ScheduleBanner />;
}

export default function ProductNewsModal({ open, feature, onClose, onExplore }: ProductNewsModalProps) {
  if (!open || !feature) return null;

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative z-[241] w-full max-w-4xl overflow-hidden rounded-3xl border border-border/50 bg-muted shadow-2xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 rounded-full border border-border/50 bg-background/70 p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid min-h-[460px] grid-cols-1 md:grid-cols-2">
          <div className="flex flex-col justify-between p-6 md:p-7">
            <div>
              <span className="inline-flex rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                {feature.tag}
              </span>
              <h3 className="mt-4 text-3xl font-semibold leading-tight text-foreground">{feature.title}</h3>
              <div className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
                {feature.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-2.5">
              <Button
                onClick={() => onExplore(feature)}
                className="w-full button-gradient h-auto rounded-xl py-2.5 text-sm"
              >
                {feature.ctaLabel}
              </Button>
              <button
                onClick={onClose}
                className="w-full rounded-xl border border-border/50 bg-transparent py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Maybe later
              </button>
            </div>
          </div>

          <div className="min-h-[300px] md:min-h-full">
            <NewsBanner featureId={feature.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
