import type { IntegrationContent } from "./types";

export const metaAds: IntegrationContent = {
  slug: "meta-ads",
  name: "Meta Ads",
  category: "Advertising Platform",
  icon: "/meta.png",
  title: "Connect Meta Ads to Dreamify — AI Dashboards from Your Meta Ads Data",
  description:
    "Generate AI-powered Meta Ads dashboards in minutes. Track spend, CPM, CPC, ROAS, and conversions across Facebook and Instagram campaigns. No formulas, no BI setup.",
  hero: {
    headline: "AI Dashboards from Your Meta Ads Data",
    subhead:
      "Stop rebuilding the same Meta Ads report every Friday. Dreamify pulls your Facebook and Instagram campaign data and generates decision-ready dashboards in minutes.",
  },
  metrics: [
    "Spend",
    "Impressions",
    "Reach",
    "Clicks",
    "CPC",
    "CPM",
    "CTR",
    "Conversions",
    "Cost per Conversion",
    "ROAS",
    "Frequency",
    "Video views and view rate",
    "Engagement actions",
  ],
  sampleDashboards: [
    {
      title: "Multi-campaign performance overview",
      body: "Side-by-side spend, ROAS, and conversion trends across all active campaigns with anomaly callouts.",
    },
    {
      title: "Audience and creative breakdown",
      body: "Performance sliced by audience segment, placement, and creative variant — surface the winners automatically.",
    },
    {
      title: "Daily pacing vs target",
      body: "Track daily spend against a target budget with end-of-month projection.",
    },
  ],
  setupSteps: [
    "Click Connect Meta Ads in Dreamify and authorize through Meta Business",
    "Pick the ad accounts you want to import",
    "Describe the dashboard you want — or choose a template",
    "Dreamify generates the dashboard in under 60 seconds",
    "Schedule reports to Slack, Telegram, Zalo, or WhatsApp",
  ],
  faqs: [
    {
      q: "Does Dreamify read from the Meta Marketing API?",
      a: "Yes. Dreamify uses the same Marketing API surface that powers Meta Ads Manager, so every metric you see in Ads Manager is available.",
    },
    {
      q: "How fresh is the data?",
      a: "Refresh cadence depends on your plan — Pro and Team support hourly refresh; Sandbox refreshes daily.",
    },
    {
      q: "Can I combine Meta Ads with Google Ads and GA4 in one dashboard?",
      a: "Yes. Connect each source and Dreamify unifies the metrics into a multi-channel view automatically.",
    },
  ],
  relatedSlugs: ["google-ads", "tiktok-ads", "ga4"],
};

export default metaAds;
