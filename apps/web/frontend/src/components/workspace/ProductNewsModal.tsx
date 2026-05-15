import { Button } from "@/components/ui/button";
import TemplateColorPreview from "@/components/templates/TemplateColorPreview";
import { BUILTIN_TEMPLATES } from "@/constants/builtinTemplates";
import { CONNECTORS, type ConnectorItem } from "@/constants/connectors";
import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Eye,
  Files,
  FileSpreadsheet,
  Globe2,
  Layers3,
  Link2,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  Sparkles,
  Users,
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

type StatusTone = "neutral" | "success" | "warning" | "accent";

const statusToneClass: Record<StatusTone, string> = {
  neutral: "border-border/70 bg-muted/70 text-muted-foreground",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  accent: "border-primary/25 bg-primary/10 text-primary",
};

function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        statusToneClass[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

function ProductPreviewFrame({
  title,
  subtitle,
  icon: Icon,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex h-full min-h-[340px] w-full flex-col overflow-hidden border-t border-border/60 bg-background/80 p-3 md:min-h-full md:border-l md:border-t-0 md:p-4">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),transparent_34%,hsl(var(--accent)/0.07))]" />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-[0_24px_80px_-44px_hsl(var(--foreground)/0.55)]">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-primary shadow-sm">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{title}</p>
              <p className="truncate text-[10px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="h-2 w-2 rounded-full bg-muted-foreground/35" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
        {footer ? <div className="border-t border-border/70 bg-muted/30 px-3 py-2">{footer}</div> : null}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/80 p-2.5 shadow-sm">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{value}</p>
        <StatusPill tone="success">{change}</StatusPill>
      </div>
    </div>
  );
}

function MiniLineChart() {
  return (
    <div className="rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">Weekly KPI trend</p>
          <p className="text-[10px] text-muted-foreground">Revenue, CAC, LTV</p>
        </div>
        <StatusPill tone="success">+18%</StatusPill>
      </div>
      <svg viewBox="0 0 240 82" className="h-20 w-full" role="img" aria-label="Rising KPI trend chart">
        <path d="M0 69H240" className="stroke-border" strokeWidth="1" />
        <path d="M0 42H240" className="stroke-border/70" strokeWidth="1" />
        <path d="M0 16H240" className="stroke-border/70" strokeWidth="1" />
        <path
          d="M5 64 C34 55 45 59 68 44 C92 28 110 39 135 27 C165 12 185 18 214 10 C225 7 233 8 238 6"
          fill="none"
          className="stroke-primary"
          strokeLinecap="round"
          strokeWidth="3"
        />
        <path
          d="M5 72 C36 66 52 62 75 56 C108 47 127 51 156 39 C184 28 205 31 238 22"
          fill="none"
          className="stroke-accent"
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

function ConnectorLogoTile({
  connector,
  selected = false,
}: {
  connector: ConnectorItem;
  selected?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-xl border bg-background/85 p-2 shadow-sm",
        selected ? "border-primary/40 ring-2 ring-primary/10" : "border-border/70"
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted p-1.5",
          connector.iconBg
        )}
      >
        <img src={connector.icon} alt="" className="h-full w-full object-contain" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{connector.name}</p>
        <p className="text-[10px] text-muted-foreground">{selected ? "Selected source" : "Available"}</p>
      </div>
    </div>
  );
}

function FileRow({
  name,
  rows,
  status,
  selected,
}: {
  name: string;
  rows: string;
  status: string;
  selected?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border bg-background/85 p-2 shadow-sm",
        selected ? "border-primary/40 ring-2 ring-primary/10" : "border-border/70"
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted text-primary">
        <FileSpreadsheet className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{name}</p>
        <p className="text-[10px] text-muted-foreground">{rows}</p>
      </div>
      <StatusPill tone="success">{status}</StatusPill>
    </div>
  );
}

function MultiFileBanner() {
  const files = [
    { name: "Revenue_Q1.xlsx", rows: "18 columns / 12.4k rows", status: "Ready", selected: true },
    { name: "Ad_Spend.csv", rows: "9 columns / 8.7k rows", status: "Mapped" },
    { name: "CRM_Leads.xlsx", rows: "14 columns / 6.2k rows", status: "Clean" },
  ];

  return (
    <ProductPreviewFrame title="New Project" subtitle="Multi-file analysis run" icon={Files}>
      <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="min-h-0 space-y-2">
          {files.map((file) => (
            <FileRow key={file.name} {...file} />
          ))}
          <div className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">Merged schema</p>
              <StatusPill tone="accent">32 fields</StatusPill>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
              {["date", "channel", "campaign", "revenue", "spend", "lead_source"].map((field) => (
                <span key={field} className="rounded-md border border-border/60 bg-background/70 px-2 py-1">
                  {field}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3">
          <div className="grid grid-cols-2 gap-2">
            <MetricTile label="ROAS" value="4.8x" change="+22%" />
            <MetricTile label="CPA" value="$18.40" change="-14%" />
          </div>
          <div className="rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">AI preparation</p>
              <StatusPill tone="success">95%</StatusPill>
            </div>
            <div className="space-y-2">
              {[
                "Join keys detected",
                "Currency normalized",
                "Outliers flagged",
              ].map((step) => (
                <div key={step} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[95%] rounded-full bg-primary" />
            </div>
          </div>
        </div>
      </div>
    </ProductPreviewFrame>
  );
}

function ConnectorsBanner() {
  const activeConnectors = CONNECTORS.filter((connector) => connector.isActive).slice(0, 6);
  const selectedConnector = activeConnectors.find((connector) => connector.name === "GA4") ?? activeConnectors[0];

  return (
    <ProductPreviewFrame title="Connectors" subtitle="Live source marketplace" icon={PlugZap}>
      <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[1fr_0.95fr]">
        <div className="grid min-h-0 grid-cols-2 gap-2">
          {activeConnectors.map((connector) => (
            <ConnectorLogoTile
              key={connector.name}
              connector={connector}
              selected={connector.name === selectedConnector.name}
            />
          ))}
        </div>
        <div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-foreground">Selected source</p>
              <p className="mt-1 text-lg font-semibold leading-none text-foreground">{selectedConnector.name}</p>
            </div>
            <StatusPill tone="success">Connected</StatusPill>
          </div>
          <div className="mt-4 space-y-2">
            {[
              { label: "Last sync", value: "8 minutes ago" },
              { label: "Rows updated", value: "24,891 events" },
              { label: "Health", value: "No action needed" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg bg-muted/45 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground">{row.label}</span>
                <span className="text-[11px] font-medium text-foreground">{row.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto pt-3">
            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-foreground">Auto-refresh enabled</span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>
    </ProductPreviewFrame>
  );
}

function TemplatesBanner() {
  const templates = BUILTIN_TEMPLATES.slice(0, 3);
  const activeTemplate = templates[1] ?? templates[0];

  return (
    <ProductPreviewFrame title="Templates" subtitle="Executive-ready dashboard starts" icon={Sparkles}>
      <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="space-y-2">
          {templates.map((template) => {
            const selected = template.id === activeTemplate.id;
            return (
              <button
                key={template.id}
                type="button"
                className={cn(
                  "w-full rounded-xl border bg-background/85 p-2.5 text-left shadow-sm transition-colors",
                  selected ? "border-primary/40 ring-2 ring-primary/10" : "border-border/70"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{template.name}</p>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                      {template.description}
                    </p>
                  </div>
                  {selected ? <StatusPill tone="accent">Active</StatusPill> : null}
                </div>
              </button>
            );
          })}
          <div className="grid grid-cols-2 gap-2">
            <MetricTile label="Setup time" value="2 min" change="-80%" />
            <MetricTile label="Blocks" value="7" change="Ready" />
          </div>
        </div>
        <div className="min-h-0 overflow-hidden rounded-xl border border-border/70 bg-background/85 p-2.5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-foreground">Preview</p>
              <p className="text-[10px] text-muted-foreground">{activeTemplate?.category ?? "Executive"} layout</p>
            </div>
            <StatusPill tone="success">Dashboard-ready</StatusPill>
          </div>
          <div className="h-[226px] overflow-hidden rounded-lg border border-border/70 bg-muted/40">
            <TemplateColorPreview theme={activeTemplate?.suggested_theme ?? "default"} className="h-full" />
          </div>
        </div>
      </div>
    </ProductPreviewFrame>
  );
}

function SharedLinkBanner() {
  return (
    <ProductPreviewFrame title="Dashboards" subtitle="Public stakeholder view" icon={Link2}>
      <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[1fr_0.9fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">Share link</p>
              <StatusPill tone="success">Live</StatusPill>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/45 px-2.5 py-2">
              <Globe2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate text-[11px] text-foreground">dreamify.app/dashboard/team-growth-q2</span>
              <Copy className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
          </div>
          <MiniLineChart />
          <div className="grid grid-cols-3 gap-2">
            <MetricTile label="Revenue" value="$842k" change="+18%" />
            <MetricTile label="CAC" value="$41" change="-9%" />
            <MetricTile label="LTV" value="$612" change="+12%" />
          </div>
        </div>
        <div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
          <p className="text-xs font-medium text-foreground">Access controls</p>
          <div className="mt-3 space-y-2">
            {[
              { icon: Users, label: "Team members", status: "Can edit", tone: "accent" as const },
              { icon: Globe2, label: "External viewers", status: "View only", tone: "success" as const },
              { icon: LockKeyhole, label: "Sensitive metrics", status: "Hidden", tone: "neutral" as const },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2 rounded-lg bg-muted/45 px-2.5 py-2">
                <row.icon className="h-3.5 w-3.5 text-primary" />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{row.label}</span>
                <StatusPill tone={row.tone}>{row.status}</StatusPill>
              </div>
            ))}
          </div>
          <div className="mt-auto rounded-lg border border-border/70 bg-muted/35 p-2.5">
            <div className="flex items-center gap-2 text-xs text-foreground">
              <Eye className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">214 views this week</span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Stakeholders always see the latest dashboard state.</p>
          </div>
        </div>
      </div>
    </ProductPreviewFrame>
  );
}

function ScheduleBanner() {
  const schedules = [
    { source: "GA4", cadence: "Daily 07:00", status: "Active", tone: "success" as const },
    { source: "Meta Ads", cadence: "Weekly Mon", status: "Active", tone: "success" as const },
    { source: "Stripe", cadence: "Daily 09:00", status: "Paused", tone: "warning" as const },
  ];

  return (
    <ProductPreviewFrame title="Schedules" subtitle="Recurring connector refresh" icon={CalendarClock}>
      <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[1.04fr_0.96fr]">
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div key={schedule.source} className="rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted text-primary">
                    <Database className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{schedule.source}</p>
                    <p className="text-[10px] text-muted-foreground">{schedule.cadence}</p>
                  </div>
                </div>
                <StatusPill tone={schedule.tone}>{schedule.status}</StatusPill>
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-foreground">Next run</p>
              <p className="mt-1 text-2xl font-semibold leading-none text-foreground">1h 24m</p>
            </div>
            <StatusPill tone="accent">Queued</StatusPill>
          </div>
          <div className="mt-4 space-y-3">
            {[
              { label: "Pull connector data", done: true },
              { label: "Refresh dashboard cards", done: true },
              { label: "Notify workspace", done: false },
            ].map((step) => (
              <div key={step.label} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border",
                    step.done
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                      : "border-primary/30 bg-primary/10 text-primary"
                  )}
                >
                  {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                </span>
                <span className="text-xs text-foreground">{step.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
            <MetricTile label="Success rate" value="99.2%" change="+2%" />
            <MetricTile label="Fresh assets" value="18" change="Ready" />
          </div>
        </div>
      </div>
    </ProductPreviewFrame>
  );
}

function NewsBanner({ featureId }: { featureId: WorkspaceNewsItem["id"] }) {
  if (featureId === "multi-file-analyze") return <MultiFileBanner />;
  if (featureId === "data-connectors") return <ConnectorsBanner />;
  if (featureId === "templates") return <TemplatesBanner />;
  if (featureId === "dashboard-shared-link") return <SharedLinkBanner />;
  return <ScheduleBanner />;
}

function FeatureIcon({ featureId }: { featureId: WorkspaceNewsItem["id"] }) {
  if (featureId === "multi-file-analyze") return <Files className="h-4 w-4" />;
  if (featureId === "data-connectors") return <PlugZap className="h-4 w-4" />;
  if (featureId === "templates") return <Layers3 className="h-4 w-4" />;
  if (featureId === "dashboard-shared-link") return <Link2 className="h-4 w-4" />;
  return <CalendarClock className="h-4 w-4" />;
}

export default function ProductNewsModal({ open, feature, onClose, onExplore }: ProductNewsModalProps) {
  if (!open || !feature) return null;

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-background/20 backdrop-blur-sm dark:bg-black/70" onClick={onClose} />

      <div className="relative z-[241] w-full max-w-[900px] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_32px_120px_-48px_hsl(var(--foreground)/0.65)]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid max-h-[calc(100vh-32px)] grid-cols-1 overflow-y-auto md:max-h-none md:min-h-[468px] md:grid-cols-[0.9fr_1.1fr] md:overflow-hidden">
          <div className="flex flex-col justify-between p-5 pr-12 sm:p-6 sm:pr-14 md:p-7">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <FeatureIcon featureId={feature.id} />
                {feature.tag}
              </div>
              <h3 className="mt-5 max-w-sm text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
                {feature.title}
              </h3>
              <div className="mt-4 max-w-sm space-y-2 text-sm leading-relaxed text-muted-foreground">
                {feature.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-2.5">
              <Button
                onClick={() => onExplore(feature)}
                className="h-auto w-full rounded-lg py-2.5 text-sm"
              >
                {feature.ctaLabel}
              </Button>
              <button
                onClick={onClose}
                className="w-full rounded-lg border border-border/70 bg-background/30 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                Maybe later
              </button>
            </div>
          </div>

          <NewsBanner featureId={feature.id} />
        </div>
      </div>
    </div>
  );
}
