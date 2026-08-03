import type { BlogPost } from "./types";

export const post: BlogPost = {
  slug: "marketing-dashboard-in-5-minutes",
  title: "How to Build a Marketing Dashboard in 5 Minutes (No SQL Required)",
  description:
    "A step-by-step guide to building a multi-channel marketing dashboard in under five minutes — without SQL, BI tools, or a data team.",
  targetKeyword: "marketing dashboard automation",
  persona: "Marketer",
  publishedAt: "2026-06-06",
  updatedAt: "2026-06-06",
  author: "Dreamify Team",
  sections: [
    {
      heading: "Why most marketing dashboards take a week to build",
      paragraphs: [
        "If you've ever tried to build a marketing dashboard, you know the pattern: pull data from Meta Ads, paste into a spreadsheet, do the same for Google Ads and GA4, write a few VLOOKUPs, fight with pivot tables, draw a chart, and pray that no one wants a small tweak before Friday.",
        "The reason it takes a week isn't because the data is hard. It's because every step is manual. Each platform has its own export format, its own metric names, and its own refresh cadence. By the time you finish, the data is already stale.",
      ],
    },
    {
      heading: "What a 5-minute dashboard actually looks like",
      paragraphs: [
        "Connect your ad accounts (Meta, Google, TikTok) and GA4 in a single click each. Describe the dashboard you want in plain English — for example, 'weekly ROAS by channel with spend pacing.' The AI generates the dashboard with the right metrics, chart types, and breakdowns.",
        "From there you can refine: ask follow-up questions, change a metric, schedule the dashboard to Slack or WhatsApp. Total time end-to-end is well under five minutes for a first draft.",
      ],
    },
    {
      heading: "The five steps",
      paragraphs: [
        "Step 1: Connect your sources. Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase — each in one click via OAuth.",
        "Step 2: Pick or describe a template. Start from 'Cross-channel ROAS' or just type what you want.",
        "Step 3: Review the generated dashboard. Charts, filters, and KPIs are pre-arranged.",
        "Step 4: Refine in chat. Ask for a different breakdown, a new metric, or a tweak — the AI updates the dashboard in place.",
        "Step 5: Share or schedule. Public link, embed, or scheduled delivery to Slack, Telegram, Zalo, or WhatsApp.",
      ],
    },
    {
      heading: "When this approach breaks down",
      paragraphs: [
        "If your dashboard requires a custom semantic model with governance, RLS, and a 50-table data warehouse, you still want a traditional BI tool. The five-minute path works for marketing, sales, founder, and ops dashboards where speed matters more than perfect governance.",
        "Most SME marketing dashboards fall in that bucket. The five-minute approach gets you 90% of the value at 5% of the effort.",
      ],
    },
  ],
};

export default post;
