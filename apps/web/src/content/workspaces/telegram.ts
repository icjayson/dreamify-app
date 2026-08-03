import type { WorkspaceContent } from "./types";

export const telegram: WorkspaceContent = {
  slug: "telegram",
  name: "Telegram",
  title: "Dreamify for Telegram — AI Dashboard Bot for Your Team Chat",
  description:
    "Get AI-generated dashboards and alerts delivered to Telegram. The Dreamify Telegram bot posts scheduled reports, anomaly alerts, and answers follow-up questions in any chat.",
  hero: {
    headline: "AI Dashboards in Telegram",
    subhead:
      "For founder teams, agencies, and APAC operators who run their business in Telegram — Dreamify lives where you already are.",
  },
  capabilities: [
    {
      title: "Scheduled reports to any chat",
      body: "Send daily, weekly, or monthly dashboards to private chats, group chats, or channels.",
    },
    {
      title: "Threshold alerts",
      body: "Get pinged the moment a key metric crosses a threshold — spend caps, conversion drops, MRR changes.",
    },
    {
      title: "Reply-to-ask Q&A",
      body: "Reply to a dashboard message to ask the bot a follow-up question in plain language.",
    },
    {
      title: "On-demand snapshots",
      body: "Type a command and the bot generates a fresh dashboard image instantly.",
    },
  ],
  setupSteps: [
    "Open Dreamify and go to Workspace Integrations",
    "Click Connect Telegram",
    "Start a chat with the Dreamify bot and use the pairing code Dreamify shows",
    "Pick the chat to receive scheduled reports",
    "Configure schedules and alert rules per dashboard",
  ],
  useCases: [
    {
      persona: "APAC SME founders",
      example: "Daily revenue + ad spend snapshot delivered to your Telegram team chat at 9am local.",
    },
    {
      persona: "Performance marketing agencies",
      example: "One client per Telegram group with their dashboards scheduled in.",
    },
    {
      persona: "Crypto / Web3 operators",
      example: "On-chain volumes, treasury balance, and KPI metrics in your ops Telegram.",
    },
  ],
  faqs: [
    {
      q: "Can I use Dreamify with Telegram channels (broadcast)?",
      a: "Yes. Add the bot as an admin to the channel and configure scheduled posts.",
    },
    {
      q: "Does the bot work in group chats?",
      a: "Yes. Add the bot to any group and configure who can ask follow-up questions.",
    },
    {
      q: "Is my data secure when posted to Telegram?",
      a: "Dreamify only posts the dashboards you explicitly enable. Telegram conversations are not used to train any model.",
    },
  ],
};

export default telegram;
