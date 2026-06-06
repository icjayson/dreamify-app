import type { ComparisonContent } from "./types";

export const chatgptForData: ComparisonContent = {
  slug: "chatgpt-for-data",
  competitor: "ChatGPT (for data analysis)",
  title: "Dreamify vs ChatGPT for Data Analysis — Why a Purpose-Built Tool Wins",
  description:
    "Honest comparison: Dreamify vs ChatGPT's Advanced Data Analysis. ChatGPT is great for one-off questions. Dreamify is built for recurring dashboards, live data connections, and team delivery.",
  tldr: [
    { dimension: "Primary use", competitor: "One-off Q&A on uploaded files", dreamify: "Persistent dashboards on live data" },
    { dimension: "Live data connectors", competitor: "Limited; mostly file upload", dreamify: "Meta, Google Ads, GA4, TikTok, Stripe, GA4, Sheets, Postgres" },
    { dimension: "Scheduled delivery", competitor: "No", dreamify: "Yes — Slack, Telegram, Zalo, WhatsApp" },
    { dimension: "Recurring reports", competitor: "Re-upload each time", dreamify: "Auto-refresh" },
    { dimension: "Team sharing", competitor: "Chat link", dreamify: "Public dashboard links, in-workspace posts" },
  ],
  scenario: {
    title: "Weekly multi-channel ad ROAS dashboard",
    body:
      "ChatGPT can answer one ROAS question from a CSV upload. Dreamify connects directly to Meta, Google Ads, TikTok, and GA4, generates the dashboard once, and ships it to your team's Slack every Monday at 9am — forever.",
  },
  competitorPros: [
    "Excellent for one-off analytical questions",
    "Great at generating Python code for transformations",
    "Familiar interface for many teams",
  ],
  dreamifyWins: [
    {
      title: "Live data, not file uploads",
      body: "Native connectors to marketing, analytics, and database sources — no re-uploading every week.",
    },
    {
      title: "Recurring delivery",
      body: "Scheduled reports, anomaly alerts, and follow-up Q&A in your team's workspace.",
    },
    {
      title: "Persistent dashboards",
      body: "Dashboards stay alive and refresh themselves. ChatGPT conversations don't.",
    },
    {
      title: "Built for marketing, not generic data",
      body: "Templates and metrics pre-tuned for Meta, Google Ads, GA4, TikTok, AppsFlyer, Firebase, Stripe.",
    },
  ],
  pricing: { competitor: "ChatGPT Plus $20/mo · Team $30/seat/mo", dreamify: "Sandbox free · Pro $15/mo · Team $18/seat" },
  migrationNotes:
    "Most teams keep ChatGPT for general assistance and add Dreamify for the recurring data dashboards. The workflows complement each other.",
};

export default chatgptForData;
