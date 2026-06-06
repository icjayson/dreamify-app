import type { ComparisonContent } from "./types";

export const tableau: ComparisonContent = {
  slug: "tableau",
  competitor: "Tableau",
  title: "Dreamify vs Tableau — Is Tableau Worth It for an SME?",
  description:
    "Honest comparison: Dreamify vs Tableau. Tableau is the BI gold standard for enterprises. For SMEs and marketing teams, Dreamify delivers 80% of the value in minutes for a fraction of the cost.",
  tldr: [
    { dimension: "Target user", competitor: "Enterprise BI analysts", dreamify: "Marketers, sellers, founders, ops" },
    { dimension: "Time to first dashboard", competitor: "Hours to days", dreamify: "Under 5 minutes" },
    { dimension: "License cost", competitor: "$15–$75/user/mo (Creator: $75)", dreamify: "Sandbox free · Pro $15/mo · Team $18/seat" },
    { dimension: "Setup", competitor: "Server or Cloud install + admin", dreamify: "Browser-based, zero install" },
    { dimension: "AI dashboard generation", competitor: "Limited (Tableau Pulse)", dreamify: "Core feature" },
    { dimension: "Workspace alerts", competitor: "Slack, Teams via setup", dreamify: "Slack, Telegram, Zalo, WhatsApp out of the box" },
  ],
  scenario: {
    title: "Weekly Meta + Google + TikTok ad performance dashboard for a 40-person SME",
    body:
      "Tableau requires an analyst to connect each data source, build the data model, design the visuals, and publish. In Dreamify the marketer who needs the dashboard describes it in plain language and Dreamify generates it. The total cost differential — license + analyst time — is usually 10× or more in Dreamify's favor at this size.",
  },
  competitorPros: [
    "Industry leader in BI visualization",
    "Powerful for advanced analyst workflows",
    "Mature governance for enterprise",
    "Strong community and extension ecosystem",
  ],
  dreamifyWins: [
    {
      title: "10× cheaper at the SME tier",
      body: "$15/mo Pro vs Tableau Creator at $75/user/mo before server costs.",
    },
    {
      title: "Zero analyst overhead",
      body: "No specialist required. Marketers and founders build their own dashboards.",
    },
    {
      title: "Marketing connectors out of the box",
      body: "Meta, Google Ads, GA4, TikTok, AppsFlyer, Firebase, Stripe — connected in clicks.",
    },
    {
      title: "Dashboards live in your team chat",
      body: "Slack, Telegram, Zalo, and WhatsApp built in.",
    },
  ],
  pricing: {
    competitor: "Tableau Creator $75/user/mo · Explorer $42/user/mo · Viewer $15/user/mo + Tableau Server/Cloud",
    dreamify: "Sandbox free · Pro $15/mo · Team $18/seat",
  },
};

export default tableau;
