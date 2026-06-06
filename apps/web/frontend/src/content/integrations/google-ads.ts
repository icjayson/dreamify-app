import type { IntegrationContent } from "./types";

export const googleAds: IntegrationContent = {
  slug: "google-ads",
  name: "Google Ads",
  category: "Advertising Platform",
  icon: "/google-ads.png",
  title: "Connect Google Ads to Dreamify — AI Dashboards from Your Google Ads Data",
  description:
    "Turn Google Ads campaign data into AI-generated dashboards in minutes. Track CPC, conversions, search terms, and Quality Score without spreadsheets or BI tools.",
  hero: {
    headline: "AI Dashboards from Your Google Ads Data",
    subhead:
      "Pull Search, Display, YouTube, and Performance Max metrics into one dashboard. Dreamify writes the queries, builds the visuals, and keeps everything in sync.",
  },
  metrics: [
    "Spend and budget pacing",
    "Impressions and Search Impression Share",
    "Clicks and CTR",
    "Average CPC and CPM",
    "Conversions and Conversion Value",
    "ROAS and CPA",
    "Quality Score and Ad Strength",
    "Keyword and search term performance",
  ],
  sampleDashboards: [
    {
      title: "Cross-campaign performance",
      body: "Spend, conversions, and CPA across all Google Ads campaigns with week-over-week change.",
    },
    {
      title: "Search term and keyword report",
      body: "Highest-converting search terms, wasted spend on irrelevant queries, and negative keyword suggestions.",
    },
    {
      title: "Conversion funnel with GA4",
      body: "Click → site visit → conversion, joined with GA4 session data for a full funnel view.",
    },
  ],
  setupSteps: [
    "Click Connect Google Ads in Dreamify and complete OAuth",
    "Select the Google Ads accounts to import",
    "Describe the report you want in plain English",
    "Dreamify generates the dashboard with the right metrics and breakdowns",
    "Schedule a weekly summary to your team workspace",
  ],
  faqs: [
    {
      q: "Does Dreamify support Performance Max and Demand Gen?",
      a: "Yes. Dreamify reads all campaign types supported by the Google Ads API, including Performance Max and Demand Gen.",
    },
    {
      q: "Can I see search term data?",
      a: "Yes. Search term reports are available at campaign and ad group level, including wasted-spend detection.",
    },
    {
      q: "How does Dreamify handle multi-account agencies?",
      a: "Connect your manager (MCC) account once and Dreamify imports every client account underneath.",
    },
  ],
  relatedSlugs: ["meta-ads", "ga4", "tiktok-ads"],
};

export default googleAds;
