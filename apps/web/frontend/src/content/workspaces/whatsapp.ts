import type { WorkspaceContent } from "./types";

export const whatsapp: WorkspaceContent = {
  slug: "whatsapp",
  name: "WhatsApp",
  title: "Dreamify for WhatsApp — AI Dashboards Delivered Through WhatsApp",
  description:
    "Get AI-generated dashboards and alerts straight to WhatsApp. Scheduled reports, threshold pings, and reply-to-ask follow-ups for the global SME workspace.",
  hero: {
    headline: "AI Dashboards in WhatsApp",
    subhead:
      "WhatsApp is where most SMEs already run their business conversations. Dreamify meets you there with scheduled dashboards, alerts, and on-demand Q&A.",
  },
  capabilities: [
    {
      title: "Scheduled reports",
      body: "Daily, weekly, or monthly dashboard snapshots delivered to a WhatsApp chat or group.",
    },
    {
      title: "Threshold and anomaly alerts",
      body: "Get pinged on WhatsApp the moment metrics move outside expected ranges.",
    },
    {
      title: "Reply-to-ask Q&A",
      body: "Reply to any Dreamify WhatsApp message to ask a follow-up question — answers return as charts.",
    },
    {
      title: "On-demand metric lookups",
      body: "Send a quick prompt and get the latest number on any tracked metric.",
    },
  ],
  setupSteps: [
    "Open Dreamify and go to Workspace Integrations",
    "Click Connect WhatsApp",
    "Provide your WhatsApp Business number and verify it",
    "Pick the destination chats or groups",
    "Configure schedules and alert rules per dashboard",
  ],
  useCases: [
    {
      persona: "Global SME founders",
      example: "Daily revenue + cash position snapshot delivered to your founder WhatsApp at 8am.",
    },
    {
      persona: "Distributed teams",
      example: "Field operators get their store-level KPIs without opening a dashboard tool.",
    },
    {
      persona: "Agency client reporting",
      example: "Each client receives a weekly WhatsApp summary of their accounts' performance.",
    },
  ],
  faqs: [
    {
      q: "Do I need a WhatsApp Business account?",
      a: "WhatsApp Business or WhatsApp Business Cloud API is required to receive bot-driven scheduled messages reliably.",
    },
    {
      q: "Can the bot respond to follow-up questions?",
      a: "Yes. Reply to a Dreamify message and ask any follow-up — Dreamify returns a new chart and short explanation.",
    },
    {
      q: "Is my data secure over WhatsApp?",
      a: "Dreamify only sends the dashboards and alerts you explicitly enable. Source data stays inside Dreamify.",
    },
  ],
};

export default whatsapp;
