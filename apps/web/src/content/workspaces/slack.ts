import type { WorkspaceContent } from "./types";

export const slack: WorkspaceContent = {
  slug: "slack",
  name: "Slack",
  title: "Dreamify for Slack — AI Dashboards and Alerts in Your Channels",
  description:
    "Bring decision-ready dashboards into Slack. Schedule reports, get anomaly alerts, and ask follow-up questions with the Dreamify Slack bot — no leaving the channel.",
  hero: {
    headline: "Dashboards That Live in Slack",
    subhead:
      "Your team already lives in Slack. Stop sending them screenshots of dashboards. Dreamify delivers the dashboard itself — and answers follow-up questions in-thread.",
  },
  capabilities: [
    {
      title: "Scheduled dashboard delivery",
      body: "Send a daily, weekly, or monthly snapshot of any dashboard to any channel. Charts render natively in Slack.",
    },
    {
      title: "Anomaly and threshold alerts",
      body: "Spend over budget, conversions dropping, MRR slipping — Dreamify pings the right channel automatically.",
    },
    {
      title: "Ask follow-up questions",
      body: "Reply to a dashboard message and ask Dreamify questions in natural language. It answers in-thread with new charts.",
    },
    {
      title: "Share dashboard links",
      body: "Drop any Dreamify dashboard link into Slack and get a rich unfurled preview.",
    },
  ],
  setupSteps: [
    "Open Dreamify and go to Workspace Integrations",
    "Click Connect Slack and authorize the workspace",
    "Pick the default channel for scheduled reports",
    "Configure schedules and alert thresholds per dashboard",
    "Invite the Dreamify bot to any channel where it should post",
  ],
  useCases: [
    {
      persona: "Marketing team",
      example: "#marketing-ops gets a Monday 9am snapshot of last week's Meta + Google Ads ROAS, with anomaly callouts.",
    },
    {
      persona: "Founders",
      example: "#leadership receives MRR, churn, and signups every Friday — no spreadsheet pasting.",
    },
    {
      persona: "Customer-facing operators",
      example: "#cs-alerts pings when daily refund volume crosses a threshold.",
    },
  ],
  faqs: [
    {
      q: "Does Dreamify post charts as images or interactive blocks?",
      a: "Both. Slack messages include a static chart image plus a link to the live interactive dashboard.",
    },
    {
      q: "Can different channels get different reports?",
      a: "Yes. Each channel has its own schedule and dashboard list.",
    },
    {
      q: "Is the Dreamify Slack app available on the Slack App Directory?",
      a: "Yes — search for Dreamify in the Slack App Directory, or connect from inside Dreamify.",
    },
  ],
};

export default slack;
