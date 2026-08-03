import type { ComparisonContent } from "./types";

export const airbook: ComparisonContent = {
  slug: "airbook",
  competitor: "Airbook",
  title: "Dreamify vs Airbook — Notebook-Style AI vs Dashboard-First AI",
  description:
    "Honest comparison: Dreamify vs Airbook. Airbook is an AI-native data notebook. Dreamify is an AI dashboard generator built for marketers and operators.",
  tldr: [
    { dimension: "Primary surface", competitor: "Data notebook (cells, prose, code)", dreamify: "Persistent dashboards" },
    { dimension: "Target user", competitor: "Data professionals", dreamify: "Marketers, sellers, founders, ops" },
    { dimension: "Workspace delivery", competitor: "Email and link-share", dreamify: "Slack, Telegram, Zalo, WhatsApp" },
    { dimension: "Recurring reports", competitor: "Manual re-run", dreamify: "Native scheduled delivery" },
    { dimension: "Pricing", competitor: "Mid-market analyst tooling", dreamify: "Free non-commercial preview · billing disabled" },
  ],
  scenario: {
    title: "Recurring weekly KPI report for a 30-person SaaS",
    body:
      "Airbook is great when one analyst is producing a narrative report with code + visuals + prose. Dreamify is great when the founder wants the same KPIs delivered to Slack every Monday without anyone re-running anything.",
  },
  competitorPros: [
    "Excellent for analyst-authored narrative reports",
    "Mixes code, prose, and visuals in one document",
    "Good for ad-hoc exploration with SQL or Python",
  ],
  dreamifyWins: [
    {
      title: "Dashboards, not notebooks",
      body: "For recurring KPIs, a notebook is overkill. Dreamify gives you a persistent dashboard with scheduled delivery.",
    },
    {
      title: "Non-technical end users",
      body: "Marketers and founders build their own dashboards in Dreamify. Airbook still expects an analyst hand on the keyboard.",
    },
    {
      title: "Workspace-native",
      body: "Slack, Telegram, Zalo, and WhatsApp delivery — no email link to chase.",
    },
  ],
  pricing: { competitor: "Mid-market analyst tooling pricing", dreamify: "Free non-commercial preview · billing disabled" },
};

export default airbook;
