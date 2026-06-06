import type { ComparisonContent } from "./types";

export const omni: ComparisonContent = {
  slug: "omni",
  competitor: "Omni",
  title: "Dreamify vs Omni — Modern BI Platform or AI Dashboard Generator?",
  description:
    "Honest comparison: Dreamify vs Omni Analytics. Omni is a modern BI platform built for data teams. Dreamify is an AI dashboard generator built for marketers and operators.",
  tldr: [
    { dimension: "Primary user", competitor: "Data team + business consumers", dreamify: "Marketers, sellers, founders, ops" },
    { dimension: "Modeling layer", competitor: "Yes (semantic model required)", dreamify: "No — Dreamify reads source data directly" },
    { dimension: "Time to first dashboard", competitor: "Days (modeling) → hours (dashboard)", dreamify: "Minutes" },
    { dimension: "Workspace delivery", competitor: "Slack and email", dreamify: "Slack, Telegram, Zalo, WhatsApp" },
    { dimension: "Pricing", competitor: "Enterprise / mid-market", dreamify: "Sandbox free · Pro $15/mo · Team $18/seat" },
  ],
  scenario: {
    title: "Multi-channel marketing dashboard for a 60-person company",
    body:
      "Omni shines when you have a data team that wants a governed semantic model and self-serve BI on top. Dreamify shines when you don't have that team — and you need the dashboard now.",
  },
  competitorPros: [
    "Strong modern BI with a semantic model",
    "Excellent for governed self-serve analytics",
    "Good ecosystem of integrations for data teams",
  ],
  dreamifyWins: [
    {
      title: "No semantic model required",
      body: "Dreamify reads from your data sources directly. No dbt-style modeling step.",
    },
    {
      title: "AI builds the dashboard",
      body: "Describe what you want; Dreamify generates it. Omni still expects you to drag and drop.",
    },
    {
      title: "Workspace breadth",
      body: "Slack, Telegram, Zalo, and WhatsApp — meets your team where they are.",
    },
    {
      title: "Predictable SME pricing",
      body: "$15/mo Pro or $18/seat Team. No enterprise procurement cycle.",
    },
  ],
  pricing: { competitor: "Enterprise / mid-market pricing", dreamify: "Sandbox free · Pro $15/mo · Team $18/seat" },
};

export default omni;
