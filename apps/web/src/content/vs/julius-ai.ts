import type { ComparisonContent } from "./types";

export const juliusAi: ComparisonContent = {
  slug: "julius-ai",
  competitor: "Julius AI",
  title: "Dreamify vs Julius AI — Which AI Data Tool Is Right for You?",
  description:
    "Honest comparison: Dreamify vs Julius AI. Julius is an AI data analyst chat. Dreamify is purpose-built for marketing and SME dashboards. Here's how they differ.",
  tldr: [
    { dimension: "Primary use", competitor: "Ad-hoc data Q&A chat", dreamify: "Persistent dashboards + workspace alerts" },
    { dimension: "Data connectors", competitor: "Upload-first; limited live connectors", dreamify: "Live: Meta, Google Ads, GA4, TikTok, Stripe, GA4, Sheets, Postgres" },
    { dimension: "Workspace integration", competitor: "None native", dreamify: "Slack, Telegram, Zalo, WhatsApp" },
    { dimension: "Scheduled reporting", competitor: "Limited", dreamify: "Native — schedule any dashboard" },
    { dimension: "Target user", competitor: "Analysts and curious tinkerers", dreamify: "Marketers, sellers, founders, ops" },
    { dimension: "Pricing", competitor: "$20/mo+", dreamify: "Free non-commercial preview · billing disabled" },
  ],
  scenario: {
    title: "Building a weekly Meta + Google Ads dashboard",
    body:
      "With Julius AI you'd upload an export, ask questions in chat, and re-upload every week. With Dreamify you connect the ad accounts once, generate the dashboard, and schedule the report to Slack every Monday morning. The Julius path is great for one-off analysis. The Dreamify path is built for the recurring report.",
  },
  competitorPros: [
    "Strong for open-ended data exploration in chat",
    "Good for one-off statistical analysis on uploaded files",
    "Generates Python notebooks if you want them",
  ],
  dreamifyWins: [
    {
      title: "Live connectors for marketing data",
      body: "Direct connections to Meta, Google Ads, GA4, TikTok, AppsFlyer, Firebase, and Stripe — no manual exports.",
    },
    {
      title: "Workspace delivery",
      body: "Dashboards live in Slack, Telegram, Zalo, and WhatsApp where your team works — not in a separate tab.",
    },
    {
      title: "Built for recurring reports",
      body: "Schedule, alert, and snapshot dashboards. Julius is optimized for one-shot Q&A.",
    },
    {
      title: "Cheaper at the entry tier",
      body: "The Hobby demo is free and capability-gated; only certified integrations activate.",
    },
  ],
  pricing: { competitor: "From $20/mo per user", dreamify: "Free non-commercial preview · billing disabled" },
  migrationNotes:
    "If you use Julius today, keep using it for ad-hoc data chat. Add Dreamify for the recurring dashboards that send themselves into Slack or WhatsApp.",
};

export default juliusAi;
