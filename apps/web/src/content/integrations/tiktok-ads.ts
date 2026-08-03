import type { IntegrationContent } from "./types";

export const tiktokAds: IntegrationContent = {
  slug: "tiktok-ads",
  name: "TikTok Ads",
  category: "Advertising Platform",
  icon: "/tiktok.png",
  iconBg: "bg-black",
  title: "Connect TikTok Ads to Dreamify — AI Dashboards Beyond the Native Reporting",
  description:
    "Generate AI-powered TikTok Ads dashboards in minutes. Track spend, CPM, conversions, creative performance, and cross-channel ROAS that TikTok's native reporting can't surface.",
  hero: {
    headline: "AI Dashboards from Your TikTok Ads Data",
    subhead:
      "TikTok Ads Manager is built for ad operators, not founders. Dreamify pulls your TikTok campaign data and turns it into dashboards your whole team can act on.",
  },
  metrics: [
    "Spend, CPM, CPC, CTR",
    "Conversions and CPA",
    "Video views, 6-second views, completion rate",
    "Creative-level performance",
    "Audience and placement breakdown",
    "App install and event metrics",
    "Cross-channel ROAS when combined with Meta and Google Ads",
  ],
  sampleDashboards: [
    {
      title: "Creative performance leaderboard",
      body: "Top-performing creatives ranked by ROAS, CTR, and completion rate — surface winners and laggards automatically.",
    },
    {
      title: "TikTok vs Meta vs Google",
      body: "Multi-channel performance comparison with shared metrics across all three ad platforms.",
    },
    {
      title: "Daily pacing and anomaly detection",
      body: "Daily spend vs target with automated callouts for unusual CPM spikes or conversion drops.",
    },
  ],
  setupSteps: [
    "Click Connect TikTok Ads in Dreamify and authorize through TikTok Business Center",
    "Select the ad accounts to import",
    "Pick a template — Creative Performance, Multi-Channel ROAS, or Pacing",
    "Dreamify generates the dashboard automatically",
    "Schedule reports into Slack, Telegram, Zalo, or WhatsApp",
  ],
  faqs: [
    {
      q: "Does Dreamify support TikTok Shop ads and Spark Ads?",
      a: "Yes. Dreamify reads from the TikTok Marketing API, including Spark Ads, Branded Effect, and TikTok Shop campaign types.",
    },
    {
      q: "How is this different from TikTok Ads Manager?",
      a: "Ads Manager is built for campaign operators. Dreamify is built for the marketer or founder who needs a decision-ready dashboard without learning the platform.",
    },
    {
      q: "Can I unify TikTok with my other ad platforms?",
      a: "Yes. Connect Meta Ads, Google Ads, and TikTok Ads and Dreamify produces a single cross-channel dashboard.",
    },
  ],
  relatedSlugs: ["meta-ads", "google-ads", "appsflyer"],
};

export default tiktokAds;
