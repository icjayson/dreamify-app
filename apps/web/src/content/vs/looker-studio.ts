import type { ComparisonContent } from "./types";

export const lookerStudio: ComparisonContent = {
  slug: "looker-studio",
  competitor: "Looker Studio",
  title: "Dreamify vs Looker Studio — Free Dashboard Tool or AI Dashboard Generator?",
  description:
    "Honest comparison: Dreamify vs Looker Studio (formerly Data Studio). Looker Studio is free and flexible — but takes hours per dashboard. Dreamify generates dashboards in minutes with AI.",
  tldr: [
    { dimension: "Cost", competitor: "Free", dreamify: "Free non-commercial preview · billing disabled" },
    { dimension: "Time to first dashboard", competitor: "1–3 hours (manual config)", dreamify: "Under 5 minutes" },
    { dimension: "AI-generated layouts", competitor: "No", dreamify: "Yes" },
    { dimension: "Marketing connectors", competitor: "GA4, Google Ads native; others need paid connectors", dreamify: "Meta, Google Ads, GA4, TikTok, AppsFlyer, Firebase, Stripe" },
    { dimension: "Workspace alerts", competitor: "Email only", dreamify: "Slack, Telegram, Zalo, WhatsApp" },
    { dimension: "Natural language Q&A", competitor: "No", dreamify: "Yes" },
  ],
  scenario: {
    title: "Building a weekly multi-channel marketing dashboard",
    body:
      "In Looker Studio you wire each data source individually, drag chart components onto a canvas, configure each metric, write calculated fields for ROAS, and rebuild whenever a new campaign launches. In Dreamify you connect each data source once, describe what you want, and the dashboard is ready in minutes. When your team is in Slack or Telegram, the dashboard goes there automatically.",
  },
  competitorPros: [
    "Free with a Google account",
    "Native connectors to Google products (Ads, GA4, Sheets, BigQuery)",
    "Highly flexible layout — every pixel under your control",
    "Embedded in many Google Workspace flows",
  ],
  dreamifyWins: [
    {
      title: "AI generates the dashboard for you",
      body: "Describe the dashboard you want in plain language; Dreamify builds it. No drag-and-drop, no calculated fields.",
    },
    {
      title: "Non-Google connectors are first-class",
      body: "Meta Ads, TikTok Ads, Stripe, AppsFlyer, Firebase — no third-party paid connector required.",
    },
    {
      title: "Workspace-native delivery",
      body: "Dashboards land in Slack, Telegram, Zalo, and WhatsApp. Looker Studio is email-only.",
    },
    {
      title: "Ask follow-up questions",
      body: "Reply to a dashboard with a question and get a new chart back. Looker Studio is read-only.",
    },
  ],
  pricing: { competitor: "Free (paid third-party connectors for non-Google data)", dreamify: "Free non-commercial preview · billing disabled" },
  migrationNotes:
    "Many teams use both: Looker Studio for one-off custom dashboards, Dreamify for the recurring multi-channel dashboards that need to live in team chat.",
};

export default lookerStudio;
