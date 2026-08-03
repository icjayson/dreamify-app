import type { CustomerCaseStudy } from "./types";

export const CUSTOMERS: CustomerCaseStudy[] = [
  {
    slug: "vietnamese-ecommerce-sme",
    customerName: "Vietnamese e-commerce SME",
    industry: "E-commerce",
    size: "20–50 employees",
    region: "Vietnam",
    persona: "Marketer",
    title: "Vietnamese e-commerce SME cuts weekly reporting time by 85%",
    description:
      "How a Ho Chi Minh City e-commerce team replaced manual Meta + TikTok Shop reporting with Dreamify dashboards delivered to Zalo.",
    featuredMetric: { label: "Hours/week saved on reporting", value: "6 hrs → 50 min" },
    challenge:
      "The marketing operator spent six hours every Friday consolidating Meta Ads, TikTok Shop, and Shopee Seller data into a Google Sheet, then screenshotted charts into the founder's Zalo group.",
    solution:
      "Connected Meta Ads and TikTok Ads to Dreamify, scheduled a unified ROAS dashboard to deliver into Zalo every Monday at 8am local. Anomaly alerts ping the team Zalo chat the moment daily spend pacing crosses a threshold.",
    outcomes: [
      { label: "Reporting time", value: "6 hrs/week → 50 min" },
      { label: "Decision lag", value: "5 days → same day" },
      { label: "Reports per week", value: "1 → 5 (daily)" },
    ],
    placeholder: true,
  },
  {
    slug: "saas-founder-50",
    customerName: "SaaS founder (50-person team)",
    industry: "SaaS",
    size: "50 employees",
    region: "Global",
    persona: "Founder",
    title: "50-person SaaS hits 'first dashboard in under 10 minutes' onboarding goal",
    description:
      "How a Series A SaaS founder set up MRR, churn, and signup dashboards across the company in a single afternoon.",
    featuredMetric: { label: "Time from sign-up to first dashboard", value: "< 10 minutes" },
    challenge:
      "The founder wanted self-serve dashboards for every team lead without giving the (small) data team a six-month dashboard backlog.",
    solution:
      "Each team lead connected their own data (Stripe for revenue, GA4 for product, Sheets for ops) and generated their own dashboards. The founder's weekly snapshot is auto-delivered to Slack.",
    outcomes: [
      { label: "Dashboards built in week 1", value: "12" },
      { label: "Data team tickets avoided", value: "20+/quarter" },
      { label: "Founder weekly review prep", value: "2 hrs → 5 min" },
    ],
    placeholder: true,
  },
  {
    slug: "performance-marketing-agency",
    customerName: "Performance marketing agency",
    industry: "Marketing Agency",
    size: "15 analysts",
    region: "APAC",
    persona: "Marketer",
    title: "Performance agency triples the number of client dashboards per analyst",
    description:
      "How an APAC agency replaced per-client spreadsheet reporting with Dreamify dashboards delivered into Telegram client groups.",
    featuredMetric: { label: "Client dashboards per analyst", value: "4 → 12" },
    challenge:
      "Each analyst could only maintain four client dashboards because reporting was manual. Growth was capped by analyst hours.",
    solution:
      "Each client account is connected once in Dreamify. Dashboards auto-refresh and deliver to per-client Telegram groups with anomaly alerts.",
    outcomes: [
      { label: "Client capacity per analyst", value: "4 → 12 accounts" },
      { label: "Reporting hours/client/week", value: "5 → 1" },
      { label: "Client NPS on reporting", value: "+30 pts" },
    ],
    placeholder: true,
  },
  {
    slug: "d2c-brand-revenue",
    customerName: "D2C brand",
    industry: "D2C / E-commerce",
    size: "25 employees",
    region: "Southeast Asia",
    persona: "Operator",
    title: "D2C brand moves from weekly to daily revenue dashboards",
    description:
      "How a Southeast Asian D2C brand replaced their Friday revenue spreadsheet with a daily Dreamify dashboard in Slack.",
    featuredMetric: { label: "Revenue refresh cadence", value: "Weekly → Daily" },
    challenge:
      "Daily revenue numbers existed in Stripe and Shopify, but no one looked at them until the Friday revenue spreadsheet went out — meaning bad days weren't caught until they were already over.",
    solution:
      "Dreamify pulls Stripe and Shopify daily and posts a single-image revenue snapshot to Slack every morning at 9am. Anomaly alerts fire on day-over-day drops > 15%.",
    outcomes: [
      { label: "Time to detect a revenue dip", value: "5 days → same day" },
      { label: "Manual revenue reports", value: "1/week → 0" },
      { label: "Daily snapshots delivered", value: "365/year" },
    ],
    placeholder: true,
  },
  {
    slug: "agency-onboarding",
    customerName: "Marketing agency partner",
    industry: "Marketing Agency",
    size: "8 sellers",
    region: "Global",
    persona: "Seller",
    title: "Agency cuts new client onboarding time from 2 weeks to 2 days",
    description:
      "How an agency uses Dreamify to ship a working client dashboard during the sales process, dramatically shortening time-to-value.",
    featuredMetric: { label: "Client onboarding time", value: "14 days → 2 days" },
    challenge:
      "New clients waited two weeks for their first dashboard — a window when buyer's remorse was highest.",
    solution:
      "Account managers connect client data and generate a dashboard during the kickoff call. Clients see their data live before the call ends.",
    outcomes: [
      { label: "Time to first dashboard", value: "14 days → < 1 hour" },
      { label: "Sales cycle", value: "−30%" },
      { label: "Churn in first 60 days", value: "−40%" },
    ],
    placeholder: true,
  },
];

export const getCustomer = (slug: string): CustomerCaseStudy | undefined =>
  CUSTOMERS.find((c) => c.slug === slug);

export type { CustomerCaseStudy };
