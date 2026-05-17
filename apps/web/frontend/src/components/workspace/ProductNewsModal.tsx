import { Button } from "@/components/ui/button";
import ProductPreviewMedia from "@/components/workspace/ProductPreviewMedia";
import {
  CalendarClock,
  Files,
  Layers3,
  Link2,
  PlugZap,
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
    tag: "THEMES",
    title: "Launch with beautiful dashboard themes",
    body: [
      "Pick a ready-made color theme to style metrics, charts, cards, and dashboard background instantly.",
      "Great when you need executive-ready dashboards without starting from scratch.",
    ],
    ctaLabel: "Create with Theme",
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

const PREVIEW_SOURCES: Record<
  WorkspaceNewsItem["id"],
  { light: string; dark: string; alt: string }
> = {
  "multi-file-analyze": {
    light: "/news-previews/multi-file-light.jpg",
    dark: "/news-previews/multi-file-dark.jpg",
    alt: "Start a new multi-file analysis project in Dreamify",
  },
  "data-connectors": {
    light: "/news-previews/data-connectors-light.jpg",
    dark: "/news-previews/data-connectors-dark.jpg",
    alt: "Connectors marketplace with live data sources",
  },
  templates: {
    light: "/news-previews/templates-light.jpg",
    dark: "/news-previews/templates-dark.jpg",
    alt: "Dashboard theme picker with ready-made styles",
  },
  "dashboard-shared-link": {
    light: "/news-previews/dashboard-shared-link-light.jpg",
    dark: "/news-previews/dashboard-shared-link-dark.jpg",
    alt: "Dashboards gallery — shareable with a public link",
  },
  "schedule-syncs": {
    light: "/news-previews/schedule-syncs-light.jpg",
    dark: "/news-previews/schedule-syncs-dark.jpg",
    alt: "Scheduled syncs that refresh connector data automatically",
  },
};

function FeatureIcon({ featureId }: { featureId: WorkspaceNewsItem["id"] }) {
  if (featureId === "multi-file-analyze") return <Files className="h-4 w-4" />;
  if (featureId === "data-connectors") return <PlugZap className="h-4 w-4" />;
  if (featureId === "templates") return <Layers3 className="h-4 w-4" />;
  if (featureId === "dashboard-shared-link") return <Link2 className="h-4 w-4" />;
  return <CalendarClock className="h-4 w-4" />;
}

export default function ProductNewsModal({ open, feature, onClose, onExplore }: ProductNewsModalProps) {
  if (!open || !feature) return null;

  const preview = PREVIEW_SOURCES[feature.id];

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-3 sm:p-5">
      <div
        className="absolute inset-0 animate-fade-in bg-background/30 backdrop-blur-md dark:bg-black/75"
        onClick={onClose}
      />

      <div className="relative z-[241] w-full max-w-[920px] animate-scale-in overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_40px_140px_-48px_hsl(var(--primary)/0.55)] ring-1 ring-foreground/5">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid max-h-[calc(100vh-32px)] grid-cols-1 overflow-y-auto md:max-h-none md:min-h-[468px] md:grid-cols-[0.88fr_1.12fr] md:overflow-hidden">
          <div className="flex flex-col justify-between p-5 pr-12 sm:p-6 sm:pr-14 md:p-7">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <FeatureIcon featureId={feature.id} />
                {feature.tag}
              </div>
              <h3 className="mt-5 max-w-sm bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-2xl font-semibold leading-tight text-transparent sm:text-3xl">
                {feature.title}
              </h3>
              <div className="mt-4 max-w-sm space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                {feature.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <Button
                onClick={() => onExplore(feature)}
                className="h-auto w-full rounded-lg py-2.5 text-sm shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5"
              >
                {feature.ctaLabel}
              </Button>
              <button
                onClick={onClose}
                className="w-full rounded-lg py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Maybe later
              </button>
            </div>
          </div>

          <ProductPreviewMedia
            lightSrc={preview.light}
            darkSrc={preview.dark}
            alt={preview.alt}
          />
        </div>
      </div>
    </div>
  );
}
