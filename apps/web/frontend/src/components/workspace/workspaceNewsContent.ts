import {
  CalendarClock,
  Files,
  Layers3,
  Link2,
  PlugZap,
  type LucideIcon,
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

export const PREVIEW_SOURCES: Record<
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
    alt: "Dashboards gallery - shareable with a public link",
  },
  "schedule-syncs": {
    light: "/news-previews/schedule-syncs-light.jpg",
    dark: "/news-previews/schedule-syncs-dark.jpg",
    alt: "Scheduled syncs that refresh connector data automatically",
  },
};

export const FEATURE_ICONS: Record<WorkspaceNewsItem["id"], LucideIcon> = {
  "multi-file-analyze": Files,
  "data-connectors": PlugZap,
  templates: Layers3,
  "dashboard-shared-link": Link2,
  "schedule-syncs": CalendarClock,
};
