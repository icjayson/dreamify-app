import type { IntegrationContent } from "./types";

export const bigquery: IntegrationContent = {
  slug: "bigquery",
  name: "BigQuery",
  category: "Operations & Database",
  icon: "/PostgreSQL.png",
  title: "Connect BigQuery to Dreamify — AI Dashboards from Your Warehouse",
  description:
    "Point Dreamify at your Google BigQuery dataset and get AI-generated dashboards in minutes. Dreamify writes the SQL, picks the visuals, and keeps everything refreshed.",
  hero: {
    headline: "AI Dashboards Directly from BigQuery",
    subhead:
      "Stop hand-writing dashboards against BigQuery. Connect read-only, describe the dashboard, and Dreamify generates it on demand.",
  },
  metrics: [
    "Any aggregation over any table or view",
    "Time series from any timestamp column",
    "Cross-table joins on detected keys",
    "Partition-aware queries to keep cost down",
    "Scheduled refresh with cost-aware sampling",
  ],
  sampleDashboards: [
    {
      title: "Product analytics from event tables",
      body: "DAU, retention, and feature usage queried directly from your event tables.",
    },
    {
      title: "Business KPIs from a warehouse",
      body: "Revenue, customer count, and pipeline from authoritative warehouse data.",
    },
    {
      title: "Marketing performance from joined sources",
      body: "Ad spend joined to web/app events via UTMs for true cross-channel ROAS.",
    },
  ],
  setupSteps: [
    "Click Connect BigQuery in Dreamify",
    "Provide a read-only service account with access to the dataset",
    "Pick the datasets and tables to expose",
    "Describe the dashboard you want — Dreamify writes the SQL",
    "Set refresh cadence and share the dashboard",
  ],
  faqs: [
    {
      q: "Does Dreamify need write access to BigQuery?",
      a: "No. Dreamify uses a read-only service account scoped to the datasets you choose.",
    },
    {
      q: "How does Dreamify control query cost?",
      a: "Queries are partition-aware and Dreamify can sample or cap row counts on previews to limit scan size.",
    },
    {
      q: "Can I write my own SQL?",
      a: "Yes. You can edit the generated SQL or paste in your own — Dreamify visualizes the result.",
    },
  ],
  relatedSlugs: ["postgresql", "snowflake"],
};

export default bigquery;
