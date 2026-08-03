import type { IntegrationContent } from "./types";

export const appsflyer: IntegrationContent = {
  slug: "appsflyer",
  name: "AppsFlyer",
  category: "Analytics Platform",
  icon: "/appsflyer.png",
  title: "Connect AppsFlyer to Dreamify — AI Mobile Attribution Dashboards",
  description:
    "Turn AppsFlyer attribution data into actionable mobile growth dashboards. Track installs, in-app events, ROAS, and LTV by media source — no manual exports.",
  hero: {
    headline: "AI Dashboards from Your AppsFlyer Attribution Data",
    subhead:
      "Move beyond CSV exports. Dreamify pulls AppsFlyer attribution and in-app event data and builds the dashboards your growth team needs.",
  },
  metrics: [
    "Installs and re-engagements",
    "Cost, CPI, CPA, ROAS by media source",
    "In-app events and event-level conversion",
    "Cohort LTV by source and campaign",
    "Fraud and rejected installs",
    "Cross-platform performance (iOS, Android, Web)",
  ],
  sampleDashboards: [
    {
      title: "Media source ROAS",
      body: "Spend, installs, and ROAS by media source with channel-level CPA trends.",
    },
    {
      title: "Cohort LTV",
      body: "Cohort LTV curves by acquisition source with day-7 and day-30 milestones.",
    },
    {
      title: "Funnel by event",
      body: "Install → key event → purchase funnel with drop-off rate at each step.",
    },
  ],
  setupSteps: [
    "Click Connect AppsFlyer in Dreamify",
    "Provide your AppsFlyer API token (read-only scopes)",
    "Select the apps and date range to import",
    "Choose a template or describe the dashboard",
    "Dreamify generates the dashboard and keeps it refreshed",
  ],
  faqs: [
    {
      q: "Does Dreamify read cost data from ad networks via AppsFlyer?",
      a: "Yes — if your AppsFlyer setup ingests cost data from Meta, Google, TikTok, and others, Dreamify uses it for ROAS calculation.",
    },
    {
      q: "Can I combine AppsFlyer with Firebase events?",
      a: "Yes. Connect both and Dreamify aligns events for a unified mobile analytics view.",
    },
    {
      q: "How current is the data?",
      a: "Dreamify polls the AppsFlyer API on schedule. Pro and Team plans support hourly refresh.",
    },
  ],
  relatedSlugs: ["firebase", "meta-ads", "tiktok-ads"],
};

export default appsflyer;
