import type { IntegrationContent } from "./types";

export const stripe: IntegrationContent = {
  slug: "stripe",
  name: "Stripe",
  category: "Payment & Finance",
  icon: "/stripe.png",
  title: "Connect Stripe to Dreamify — AI Revenue, MRR, and Churn Dashboards",
  description:
    "Generate Stripe revenue dashboards in minutes. MRR, ARR, churn, LTV, cohort retention — all auto-built from your Stripe data with no SQL.",
  hero: {
    headline: "Stripe Revenue Dashboards Without the Data Team",
    subhead:
      "Stripe's native reporting is fine for finance. Dreamify gives every founder and operator the SaaS metrics they actually look at: MRR, churn, LTV, and cohorts.",
  },
  metrics: [
    "Gross revenue, net revenue, refunds",
    "MRR, ARR, new MRR, expansion MRR, churn MRR",
    "Customer count and growth",
    "Churn rate, retention rate",
    "Lifetime value (LTV)",
    "Cohort retention curves",
    "Failed payments and dunning success",
    "Plan-level performance",
  ],
  sampleDashboards: [
    {
      title: "SaaS metrics overview",
      body: "MRR, ARR, churn, and net new MRR with month-over-month change and 12-month projection.",
    },
    {
      title: "Cohort retention",
      body: "Cumulative and rolling retention curves with cohort size and revenue per cohort.",
    },
    {
      title: "Failed payment recovery",
      body: "Failed payment volume, dunning recovery rate, and lost MRR by cause.",
    },
  ],
  setupSteps: [
    "Click Connect Stripe in Dreamify",
    "Authorize Stripe with read-only access",
    "Dreamify imports customers, subscriptions, invoices, and charges",
    "Pick a SaaS metrics template or describe what you want",
    "Dashboard generates in under 60 seconds",
  ],
  faqs: [
    {
      q: "Does Dreamify support both subscription and one-time charges?",
      a: "Yes. Both are visualized — subscription metrics (MRR, ARR) and transactional revenue can be shown together or separately.",
    },
    {
      q: "Is Dreamify read-only with Stripe?",
      a: "Yes. Dreamify only requests read scopes — no charges, refunds, or customer changes are possible.",
    },
    {
      q: "Can I see metrics by product or plan?",
      a: "Yes. Every metric can be sliced by product, plan, billing interval, and country.",
    },
  ],
  relatedSlugs: ["google-sheets", "postgresql"],
};

export default stripe;
