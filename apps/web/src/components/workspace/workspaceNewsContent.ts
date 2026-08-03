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
      "Drop up to 3 CSV or Excel files and ask one question to compare metrics across datasets.",
      "Dreamify merges context automatically so you can identify trends and outliers faster.",
    ],
    ctaLabel: "Start a New Project",
    targetTab: "new-chat",
  },
  {
    id: "data-connectors",
    tag: "DATA CONNECTORS",
    title: "See which data sources are available",
    body: [
      "File upload is always available in this preview; optional connector cards remain visible for product parity.",
      "A connector activates only after credentials are configured and its provider smoke test succeeds.",
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
    tag: "VERSION HISTORY",
    title: "Edit and restore dashboard versions",
    body: [
      "Refine a generated dashboard, keep immutable versions, and revert safely when an edit is not right.",
      "Export the result when it is ready; public preview links are disabled in the Hobby release.",
    ],
    ctaLabel: "Go to Dashboards",
    targetTab: "dashboards",
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
    alt: "Connector catalog with capability-gated data sources",
  },
  templates: {
    light: "/news-previews/templates-light.jpg",
    dark: "/news-previews/templates-dark.jpg",
    alt: "Dashboard theme picker with ready-made styles",
  },
  "dashboard-shared-link": {
    light: "/news-previews/dashboard-shared-link-light.jpg",
    dark: "/news-previews/dashboard-shared-link-dark.jpg",
    alt: "Dashboard gallery with versioned analytics projects",
  },
  "schedule-syncs": {
    light: "/news-previews/schedule-syncs-light.jpg",
    dark: "/news-previews/schedule-syncs-dark.jpg",
    alt: "Legacy scheduled-sync preview for a feature disabled in the Hobby demo",
  },
};

export const FEATURE_ICONS: Record<WorkspaceNewsItem["id"], LucideIcon> = {
  "multi-file-analyze": Files,
  "data-connectors": PlugZap,
  templates: Layers3,
  "dashboard-shared-link": Link2,
  "schedule-syncs": CalendarClock,
};
