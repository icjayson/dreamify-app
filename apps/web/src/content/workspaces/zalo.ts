import type { WorkspaceContent } from "./types";

export const zalo: WorkspaceContent = {
  slug: "zalo",
  name: "Zalo",
  title: "Dreamify for Zalo — AI Dashboards Delivered to Your Zalo Chat",
  description:
    "Vietnam SMEs run on Zalo. Dreamify delivers AI-generated dashboards, alerts, and answers directly into Zalo chats and Official Accounts — no extra tools required.",
  hero: {
    headline: "AI Dashboards in Zalo",
    subhead:
      "For Vietnamese SMEs and APAC operators whose teams live in Zalo — Dreamify brings dashboards into the conversation, not a separate tab.",
  },
  capabilities: [
    {
      title: "Scheduled reports to Zalo chats",
      body: "Daily, weekly, and monthly snapshots delivered to personal chats, group chats, or your Official Account followers.",
    },
    {
      title: "Anomaly alerts",
      body: "Get instant Zalo notifications when ad spend pacing, conversions, or revenue moves outside expected ranges.",
    },
    {
      title: "Reply-to-ask Q&A",
      body: "Reply to any Dreamify message in Zalo and ask a follow-up question — answers come back as a fresh chart.",
    },
    {
      title: "On-demand snapshots via Zalo Mini App",
      body: "Open the Dreamify Mini App inside Zalo for fast, mobile-first dashboard access.",
    },
  ],
  setupSteps: [
    "Open Dreamify and go to Workspace Integrations",
    "Click Connect Zalo",
    "Authenticate with your Zalo Official Account or personal account",
    "Pick the chats or audience groups for delivery",
    "Configure schedules and alert rules per dashboard",
  ],
  useCases: [
    {
      persona: "Vietnamese e-commerce SMEs",
      example: "Daily Shopee/TikTok Shop sales + Meta Ads spend snapshot delivered to the founder's Zalo group at 8am.",
    },
    {
      persona: "Performance marketing agencies in Vietnam",
      example: "Each client account has its own Zalo group with scheduled dashboards.",
    },
    {
      persona: "Local operations teams",
      example: "Store-level KPIs delivered to district manager Zalo chats every morning.",
    },
  ],
  faqs: [
    {
      q: "Do I need a Zalo Official Account?",
      a: "An OA is recommended for broadcast and team distribution. Personal Zalo accounts work for individual notifications.",
    },
    {
      q: "Is Dreamify available as a Zalo Mini App?",
      a: "Yes — the Dreamify Mini App provides fast mobile dashboard access from inside Zalo.",
    },
    {
      q: "Can the bot respond in Vietnamese?",
      a: "Yes. Dreamify understands and replies in Vietnamese for follow-up questions.",
    },
  ],
};

export default zalo;
