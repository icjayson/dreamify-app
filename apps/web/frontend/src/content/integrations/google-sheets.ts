import type { IntegrationContent } from "./types";

export const googleSheets: IntegrationContent = {
  slug: "google-sheets",
  name: "Google Sheets",
  category: "Operations & Database",
  icon: "/google-sheet.png",
  title: "Connect Google Sheets to Dreamify — Turn Any Spreadsheet into a Live Dashboard",
  description:
    "Connect any Google Sheet and Dreamify generates a dashboard from your data in minutes. No formulas, no pivot tables, no chart wizards. Your sheet stays the source of truth.",
  hero: {
    headline: "Turn Any Spreadsheet into a Live Dashboard",
    subhead:
      "Your CRM exports, manual KPI trackers, budget sheets, and ops logs become real-time dashboards the moment you connect them.",
  },
  metrics: [
    "Auto-detected numeric and categorical columns",
    "Time series from any date column",
    "Aggregated metrics with group-by support",
    "Cross-sheet joins on shared keys",
    "Live refresh on edit",
  ],
  sampleDashboards: [
    {
      title: "Founder weekly snapshot",
      body: "KPIs from your weekly tracker sheet visualized with trend, week-over-week, and target gap.",
    },
    {
      title: "Sales pipeline from a CRM export",
      body: "Pipeline value by stage and owner from a CSV/Sheets export, refreshed daily.",
    },
    {
      title: "Budget vs actual",
      body: "Compare a budget sheet against actuals from Stripe, Meta Ads, or Google Ads in one chart.",
    },
  ],
  setupSteps: [
    "Click Connect Google Sheets in Dreamify",
    "Authorize Google and pick the spreadsheet (or paste a share link)",
    "Confirm the sheet and header row Dreamify detected",
    "Describe the dashboard you want — or pick a template",
    "Dreamify generates and refreshes on schedule",
  ],
  faqs: [
    {
      q: "Does Dreamify modify my spreadsheet?",
      a: "No. Dreamify is read-only by default. Your sheet stays exactly as you maintain it.",
    },
    {
      q: "How big a sheet can I connect?",
      a: "Sheets with up to 1 million rows are supported on Pro and Team plans. Larger workloads should use PostgreSQL or a warehouse.",
    },
    {
      q: "What about Microsoft Excel?",
      a: "Excel Online is on the roadmap. Today you can upload .xlsx and .csv files directly.",
    },
  ],
  relatedSlugs: ["postgresql", "stripe"],
};

export default googleSheets;
