import type { ComparisonContent } from "./types";

export const powerBi: ComparisonContent = {
  slug: "power-bi",
  competitor: "Power BI",
  title: "Dreamify vs Power BI — A Power BI Alternative for Marketers and SMEs",
  description:
    "Honest comparison: Dreamify vs Microsoft Power BI. Power BI is a powerful BI platform built for analysts. Dreamify is built for marketers and founders who need dashboards without the BI overhead.",
  tldr: [
    { dimension: "Target user", competitor: "Data analysts, BI developers", dreamify: "Marketers, sellers, founders, ops" },
    { dimension: "Learning curve", competitor: "Days to weeks (DAX, modeling)", dreamify: "Minutes" },
    { dimension: "Time to first dashboard", competitor: "Hours to days", dreamify: "Under 5 minutes" },
    { dimension: "Marketing connectors", competitor: "Power Query / paid connectors", dreamify: "Meta, Google Ads, GA4, TikTok, AppsFlyer, Firebase, Stripe — native" },
    { dimension: "Workspace alerts", competitor: "Teams native; others require Power Automate", dreamify: "Slack, Telegram, Zalo, WhatsApp out of the box" },
    { dimension: "Pricing", competitor: "$10–$20/user/month + capacity costs", dreamify: "Free non-commercial preview · billing disabled" },
  ],
  scenario: {
    title: "Cross-channel ad ROAS dashboard for a 50-person SME",
    body:
      "In Power BI you import each data source via Power Query, define a data model with relationships, write DAX measures for ROAS, build the visuals, then publish a dataset to the service. Usually a BI specialist owns this. In Dreamify the same dashboard is generated from a one-sentence description in under five minutes — by the marketer who needs it.",
  },
  competitorPros: [
    "Industry standard for enterprise BI",
    "Deep DAX modeling for complex calculations",
    "Tight Microsoft 365 integration",
    "Mature governance, RLS, and capacity controls",
  ],
  dreamifyWins: [
    {
      title: "No BI specialist required",
      body: "Marketers, founders, and operators build their own dashboards. No DAX, no Power Query, no data model design.",
    },
    {
      title: "Marketing data is first-class",
      body: "Meta, Google Ads, GA4, TikTok, AppsFlyer — connected in one click. No Power Query custom connector hunt.",
    },
    {
      title: "Lives in your team chat",
      body: "Slack, Telegram, Zalo, and WhatsApp delivery built in. Power BI requires Power Automate plumbing.",
    },
    {
      title: "Predictable SME pricing",
      body: "Free invitation-only preview with published technical run and storage limits.",
    },
  ],
  pricing: {
    competitor: "Power BI Pro $10/user/mo · Premium Per User $20/user/mo · Premium capacity from $4,995/mo",
    dreamify: "Free non-commercial preview · billing disabled",
  },
  migrationNotes:
    "Enterprises with mature BI teams often keep Power BI for governed reporting and add Dreamify for the marketing and operator dashboards that move faster than BI delivery cycles.",
};

export default powerBi;
