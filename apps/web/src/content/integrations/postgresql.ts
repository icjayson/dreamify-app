import type { IntegrationContent } from "./types";

export const postgresql: IntegrationContent = {
  slug: "postgresql",
  name: "PostgreSQL",
  category: "Operations & Database",
  icon: "/PostgreSQL.png",
  title: "Connect PostgreSQL to Dreamify — Query-Free AI Dashboards from Your Database",
  description:
    "Point Dreamify at your PostgreSQL database and get AI-generated dashboards in minutes. Dreamify writes the SQL, picks the visuals, and keeps everything refreshed.",
  hero: {
    headline: "AI Dashboards Directly from PostgreSQL",
    subhead:
      "No more rebuilding the same Metabase dashboard. Connect your Postgres database read-only and Dreamify generates dashboards on demand.",
  },
  metrics: [
    "Any aggregation over any table or view",
    "Time series from any timestamp column",
    "Cross-table joins on detected foreign keys",
    "Filterable breakdowns by any column",
    "Live refresh on a schedule",
  ],
  sampleDashboards: [
    {
      title: "Product analytics from app events",
      body: "DAU, retention, and feature usage queried directly from your events table.",
    },
    {
      title: "Business KPIs from production data",
      body: "Revenue, customer count, conversion rate — read from the authoritative source.",
    },
    {
      title: "Operational health",
      body: "Order counts, fulfillment latency, error rates by service.",
    },
  ],
  setupSteps: [
    "Click Connect PostgreSQL in Dreamify",
    "Provide read-only credentials and connection details (Dreamify supports SSH tunnel and SSL)",
    "Pick the schemas and tables to expose",
    "Describe the dashboard you want — Dreamify writes the SQL",
    "Set the refresh cadence and share the dashboard",
  ],
  faqs: [
    {
      q: "Does Dreamify need write access?",
      a: "No. Dreamify only requires a read-only role. Best practice is to create a dedicated readonly user.",
    },
    {
      q: "How does Dreamify protect my database?",
      a: "Connections support SSL and SSH tunneling. Credentials are encrypted at rest and never exposed in the UI.",
    },
    {
      q: "Can I write my own SQL?",
      a: "Yes. You can edit the SQL Dreamify generated, or paste in your own queries — Dreamify will visualize the result.",
    },
  ],
  relatedSlugs: ["google-sheets"],
};

export default postgresql;
