import type { IntegrationContent } from "./types";

export const firebase: IntegrationContent = {
  slug: "firebase",
  name: "Firebase",
  category: "Analytics Platform",
  icon: "/firebase.png",
  title: "Connect Firebase to Dreamify — AI Product and Engagement Dashboards",
  description:
    "Generate product analytics dashboards from your Firebase events in minutes. DAU, retention, funnels, and event-level engagement without writing a single BigQuery SQL query.",
  hero: {
    headline: "AI Dashboards from Your Firebase Events",
    subhead:
      "Firebase Analytics is great for collecting events. Dreamify is great for turning them into the product dashboards you actually need.",
  },
  metrics: [
    "DAU, WAU, MAU and stickiness ratio",
    "Event volume by event name",
    "User properties and audience segments",
    "Retention and cohort analysis",
    "Funnel completion and drop-off",
    "Crash-free user rate (when Crashlytics is linked)",
    "Revenue events and in-app purchases",
  ],
  sampleDashboards: [
    {
      title: "Product engagement overview",
      body: "DAU, WAU, MAU, stickiness, and core event volume trends.",
    },
    {
      title: "Funnel and drop-off",
      body: "Onboarding or feature funnel with step-by-step drop-off rates.",
    },
    {
      title: "Cohort retention",
      body: "Weekly cohort retention curves segmented by acquisition source or user property.",
    },
  ],
  setupSteps: [
    "Click Connect Firebase in Dreamify",
    "Authorize the Firebase project (read-only)",
    "Pick the events and user properties to import",
    "Choose a template — Engagement, Funnel, or Retention",
    "Dreamify generates the dashboard automatically",
  ],
  faqs: [
    {
      q: "Does Dreamify need BigQuery export enabled?",
      a: "BigQuery export is recommended for high-volume apps because the Firebase Analytics API has lower limits. Dreamify supports both paths.",
    },
    {
      q: "Can I combine Firebase with AppsFlyer attribution?",
      a: "Yes. Connect both and Dreamify joins event data to attribution for full marketing-to-product visibility.",
    },
    {
      q: "Are custom events supported?",
      a: "Yes. All custom events and parameters are auto-detected and available for analysis.",
    },
  ],
  relatedSlugs: ["appsflyer", "ga4"],
};

export default firebase;
