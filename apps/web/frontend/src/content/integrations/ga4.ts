import type { IntegrationContent } from "./types";

export const ga4: IntegrationContent = {
  slug: "ga4",
  name: "GA4",
  category: "Analytics Platform",
  icon: "/GA4.png",
  title: "Connect GA4 to Dreamify — AI Dashboards from Your Google Analytics 4 Data",
  description:
    "Turn Google Analytics 4 data into clear dashboards in minutes. Sessions, conversions, acquisition channels, retention — all visualized without writing a single GA4 exploration.",
  hero: {
    headline: "AI Dashboards from Your GA4 Data",
    subhead:
      "GA4's exploration UI is powerful but slow. Dreamify reads the same event data and produces dashboards that answer your real questions in seconds.",
  },
  metrics: [
    "Sessions, users, and engaged sessions",
    "Pageviews and screen views",
    "Conversion events and conversion rate",
    "Acquisition by source, medium, campaign",
    "Retention and cohort behavior",
    "Engagement rate and average engagement time",
    "Ecommerce: revenue, transactions, average order value",
    "Funnel and path analysis",
  ],
  sampleDashboards: [
    {
      title: "Acquisition to conversion overview",
      body: "Traffic split by channel with conversion rate, revenue, and CPA when joined with ad spend sources.",
    },
    {
      title: "Funnel and drop-off",
      body: "Step-by-step funnel from landing to conversion with drop-off rate at each stage.",
    },
    {
      title: "Retention cohort",
      body: "Weekly cohort retention curves for new users with segment filters.",
    },
  ],
  setupSteps: [
    "Click Connect GA4 in Dreamify and complete Google OAuth",
    "Pick the GA4 property and data streams to import",
    "Choose a dashboard template or describe the view you want",
    "Dreamify generates the dashboard in under 60 seconds",
    "Share via public link or schedule into Slack, Telegram, Zalo, or WhatsApp",
  ],
  faqs: [
    {
      q: "Does Dreamify need GA4 data exported to BigQuery?",
      a: "No. Dreamify reads directly from the GA4 Data API — no BigQuery export required, though we support it for higher-volume properties.",
    },
    {
      q: "Are custom dimensions and custom events supported?",
      a: "Yes. Custom dimensions and event parameters are discovered automatically and made available as breakdown options.",
    },
    {
      q: "Can I join GA4 with Meta Ads or Google Ads spend?",
      a: "Yes. Connect each source and Dreamify joins on UTM and campaign identifiers automatically.",
    },
  ],
  relatedSlugs: ["google-ads", "meta-ads", "firebase"],
};

export default ga4;
