import type { IntegrationContent } from "./types";

export const snowflake: IntegrationContent = {
  slug: "snowflake",
  name: "Snowflake",
  category: "Operations & Database",
  icon: "/snowflake.png",
  title: "Connect Snowflake to Dreamify — AI Dashboards from Your Snowflake Warehouse",
  description:
    "Connect Dreamify to your Snowflake warehouse with a read-only role and get AI-generated dashboards in minutes. Dreamify writes the SQL and keeps everything in sync.",
  hero: {
    headline: "AI Dashboards Directly from Snowflake",
    subhead:
      "Your warehouse already holds the answers. Dreamify turns Snowflake tables into decision-ready dashboards without manual modeling.",
  },
  metrics: [
    "Any aggregation over any table, view, or secure view",
    "Time series from any timestamp column",
    "Cross-schema joins on detected keys",
    "Warehouse-aware scheduling",
    "Per-tenant filtering for governed access",
  ],
  sampleDashboards: [
    {
      title: "Revenue and SaaS metrics",
      body: "MRR, ARR, churn, and cohort retention from warehouse-grade revenue tables.",
    },
    {
      title: "Marketing performance",
      body: "Ad spend joined to attribution and product events across multiple sources.",
    },
    {
      title: "Operational KPIs",
      body: "Order, fulfillment, and support metrics with day-over-day deltas.",
    },
  ],
  setupSteps: [
    "Click Connect Snowflake in Dreamify",
    "Create a read-only role and warehouse for Dreamify",
    "Provide account, user, role, and warehouse details",
    "Pick the databases and schemas to expose",
    "Set refresh cadence and share the dashboard",
  ],
  faqs: [
    {
      q: "Does Dreamify need write access?",
      a: "No. Best practice is a dedicated read-only role with USAGE on the warehouse and SELECT on the chosen schemas.",
    },
    {
      q: "How does Dreamify handle credit costs?",
      a: "Queries run on the warehouse you specify. Dreamify supports query result caching and scheduled refresh to keep credit usage predictable.",
    },
    {
      q: "Can I use Snowflake row access policies?",
      a: "Yes. Dreamify respects any RLS / RAP policies enforced by the warehouse.",
    },
  ],
  relatedSlugs: ["postgresql", "bigquery"],
};

export default snowflake;
