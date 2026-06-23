export type ConnectorCategory =
  | "Advertising Platform"
  | "Marketing & Lifecycle"
  | "Sales & CRM"
  | "E-commerce"
  | "Customer Support & Success"
  | "Analytics Platform"
  | "Product Analytics"
  | "Payment & Finance"
  | "Operations & Database";

export type ProductConnectorCategory =
  | "Advertising"
  | "Analytics"
  | "Product Analytics"
  | "Marketing"
  | "Spreadsheets"
  | "Databases"
  | "Sales & CRM"
  | "Ecommerce"
  | "Finance"
  | "Support"
  | "Mobile & Attribution";

export type ConnectorModalTarget =
  | "ga4"
  | "google_sheets"
  | "meta_ads"
  | "tiktok_ads"
  | "appsflyer"
  | "stripe"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "supabase"
  | "shopify"
  | "klaviyo"
  | "quickbooks"
  | "zendesk"
  | "mixpanel"
  | "posthog"
  | "amazon_seller"
  | "tiktok_shop_seller"
  | "shopee_seller"
  | "lazada_seller"
  | "google_ads"
  | "firebase"
  | "postgres"
  | "bigquery"
  | "snowflake"
  | "databricks";

export interface ConnectorItem {
  name: string;
  icon: string; // path to icon asset
  isActive?: boolean; // when true, integration is enabled; when false/undefined, show "coming soon"
  category: ConnectorCategory;
  connectorKey?: string;
  productDescription?: string;
  productCategory?: ProductConnectorCategory;
  showOnProductPage?: boolean;
  modalTarget?: ConnectorModalTarget;
  /**
   * Optional Tailwind bg class for the icon container.
   * Use for logos that are white/light-coloured and need a dark tile so they
   * remain visible in light mode without swapping the image asset.
   * Falls back to the theme-aware default (`bg-muted dark:bg-white/5`).
   */
  iconBg?: string;
}

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  "Advertising Platform",
  "Marketing & Lifecycle",
  "Analytics Platform",
  "Product Analytics",
  "Sales & CRM",
  "Operations & Database",
  "Customer Support & Success",
  "Payment & Finance",
  "E-commerce",
];

export const CONNECTORS: ConnectorItem[] = [
  // ── Advertising Platform ─────────────────────────────────────────────────────
  {
    name: "Meta Ads",
    icon: "/meta.png",
    isActive: false,
    category: "Advertising Platform",
    connectorKey: "meta_ads",
    productDescription: "Monitor ad performance across Facebook and Instagram.",
    productCategory: "Advertising",
    showOnProductPage: true,
    modalTarget: "meta_ads",
  },
  {
    name: "TikTok Ads",
    icon: "/tiktok.png",
    isActive: false,
    category: "Advertising Platform",
    iconBg: "bg-black",
    connectorKey: "tiktok_ads",
    productDescription: "Measure and optimize your TikTok ad campaigns.",
    productCategory: "Advertising",
    showOnProductPage: true,
    modalTarget: "tiktok_ads",
  },
  {
    name: "Google Ads",
    icon: "/google-ads.png",
    isActive: true,
    category: "Advertising Platform",
    connectorKey: "google_ads",
    productDescription: "Track performance across campaigns and channels.",
    productCategory: "Advertising",
    showOnProductPage: true,
    modalTarget: "google_ads",
  },
  { name: "LinkedIn Ads", icon: "/logo-favicon.png", isActive: false, category: "Advertising Platform", productDescription: "Analyze LinkedIn campaign performance, B2B audiences, leads, and pipeline influence.", productCategory: "Advertising", showOnProductPage: true },
  { name: "Shopee Ads",  icon: "/shopee-ads.png", isActive: false, category: "Advertising Platform" },
  { name: "Apple Ads",   icon: "/apple-ads.png", isActive: false, category: "Advertising Platform", iconBg: "bg-black" },
  { name: "Unity Ads",   icon: "/unity-ads.png", isActive: false, category: "Advertising Platform", iconBg: "bg-[#222222]" },

  // ── Analytics Platform ────────────────────────────────────────────────────────
  {
    name: "GA4",
    icon: "/GA4.png",
    isActive: true,
    category: "Analytics Platform",
    connectorKey: "ga4",
    productDescription: "Understand user behavior and measure what matters.",
    productCategory: "Analytics",
    showOnProductPage: true,
    modalTarget: "ga4",
  },
  {
    name: "AppsFlyer",
    icon: "/appsflyer.png",
    isActive: false,
    category: "Analytics Platform",
    connectorKey: "appsflyer",
    productDescription: "Bring attribution and analytics together for mobile growth.",
    productCategory: "Mobile & Attribution",
    showOnProductPage: true,
    modalTarget: "appsflyer",
  },
  {
    name: "Firebase",
    icon: "/firebase.png",
    isActive: true,
    category: "Analytics Platform",
    connectorKey: "firebase",
    productDescription: "Analyze app events, engagement, and product signals.",
    productCategory: "Analytics",
    showOnProductPage: true,
    modalTarget: "firebase",
  },

  // ── Product Analytics ────────────────────────────────────────────────────────
  {
    name: "Mixpanel",
    icon: "/mixpanel.svg",
    isActive: false,
    category: "Product Analytics",
    connectorKey: "mixpanel",
    productDescription: "Analyze activation, funnels, retention, cohorts, product events, and product-led revenue.",
    productCategory: "Product Analytics",
    showOnProductPage: true,
    modalTarget: "mixpanel",
    iconBg: "bg-black",
  },
  {
    name: "PostHog",
    icon: "/posthog.svg",
    isActive: false,
    category: "Product Analytics",
    connectorKey: "posthog",
    productDescription: "Analyze events, persons, cohorts, insights, funnels, retention, feature flags, and product-led growth.",
    productCategory: "Product Analytics",
    showOnProductPage: true,
    modalTarget: "posthog",
    iconBg: "bg-white",
  },
  { name: "Amplitude", icon: "/logo-favicon.png", isActive: false, category: "Product Analytics", productDescription: "Analyze behavioral cohorts, funnels, retention, experimentation, and product journeys.", productCategory: "Product Analytics", showOnProductPage: true },
  { name: "Pendo", icon: "/logo-favicon.png", isActive: false, category: "Product Analytics", productDescription: "Analyze product adoption, guides, accounts, feature usage, and user feedback.", productCategory: "Product Analytics", showOnProductPage: true },
  { name: "Segment", icon: "/logo-favicon.png", isActive: false, category: "Product Analytics", productDescription: "Bring customer event streams and profile traits into Dreamify analytics.", productCategory: "Product Analytics", showOnProductPage: true },

  // ── Marketing & Lifecycle ───────────────────────────────────────────────────
  { name: "Customer.io", icon: "/logo-favicon.png", isActive: false, category: "Marketing & Lifecycle", productDescription: "Analyze lifecycle journeys, broadcasts, segments, conversions, and messaging performance.", productCategory: "Marketing", showOnProductPage: true },
  { name: "Mailchimp", icon: "/logo-favicon.png", isActive: false, category: "Marketing & Lifecycle", productDescription: "Analyze email campaigns, audiences, list growth, engagement, and ecommerce impact.", productCategory: "Marketing", showOnProductPage: true },
  { name: "Braze", icon: "/logo-favicon.png", isActive: false, category: "Marketing & Lifecycle", productDescription: "Analyze cross-channel campaigns, canvases, cohorts, and customer lifecycle performance.", productCategory: "Marketing", showOnProductPage: true },
  { name: "Google Search Console", icon: "/logo-favicon.png", isActive: false, category: "Marketing & Lifecycle", productDescription: "Analyze organic search queries, pages, clicks, impressions, CTR, and SEO growth.", productCategory: "Marketing", showOnProductPage: true },

  // ── Payment & Finance ─────────────────────────────────────────────────────────
  {
    name: "Stripe",
    icon: "/stripe.png",
    isActive: false,
    category: "Payment & Finance",
    connectorKey: "stripe",
    productDescription: "Track payments, revenue, and subscription metrics.",
    productCategory: "Finance",
    showOnProductPage: true,
    modalTarget: "stripe",
  },
  { name: "PayPal",      icon: "/paypal.png", isActive: false, category: "Payment & Finance" },
  {
    name: "QuickBooks",
    icon: "/quickbooks.svg",
    isActive: false,
    category: "Payment & Finance",
    connectorKey: "quickbooks",
    productDescription: "Analyze P&L, balance sheet, cash flow, invoices, bills, customers, vendors, items, and accounts.",
    productCategory: "Finance",
    showOnProductPage: true,
    modalTarget: "quickbooks",
    iconBg: "bg-white",
  },

  // ── Customer Support & Success ────────────────────────────────────────────────
  {
    name: "Zendesk",
    icon: "/zendesk.svg",
    isActive: false,
    category: "Customer Support & Success",
    connectorKey: "zendesk",
    productDescription: "Analyze tickets, SLA pressure, CSAT, support backlog, users, organizations, and customer health.",
    productCategory: "Support",
    showOnProductPage: true,
    modalTarget: "zendesk",
    iconBg: "bg-white",
  },
  { name: "Intercom", icon: "/logo-favicon.png", isActive: false, category: "Customer Support & Success", productDescription: "Analyze conversations, support workload, customer segments, and success signals.", productCategory: "Support", showOnProductPage: true },

  // ── Sales & CRM ─────────────────────────────────────────────────────────────
  {
    name: "HubSpot",
    icon: "/hubspot.png",
    isActive: false,
    category: "Sales & CRM",
    connectorKey: "hubspot",
    productDescription: "Analyze CRM pipeline, owners, contacts, companies, and activities.",
    productCategory: "Sales & CRM",
    showOnProductPage: true,
    modalTarget: "hubspot",
  },
  {
    name: "Salesforce",
    icon: "/salesforce.svg",
    isActive: false,
    category: "Sales & CRM",
    connectorKey: "salesforce",
    productDescription: "Analyze Sales Cloud pipeline, leads, accounts, activities, and campaigns.",
    productCategory: "Sales & CRM",
    showOnProductPage: true,
    modalTarget: "salesforce",
  },
  {
    name: "Pipedrive",
    icon: "/pipedrive.svg",
    isActive: false,
    category: "Sales & CRM",
    connectorKey: "pipedrive",
    productDescription: "Analyze deal stages, leads, contacts, activities, products, and owner performance.",
    productCategory: "Sales & CRM",
    showOnProductPage: true,
    modalTarget: "pipedrive",
    iconBg: "bg-white",
  },
  { name: "Close", icon: "/logo-favicon.png", isActive: false, category: "Sales & CRM", productDescription: "Analyze outbound-heavy sales pipelines, calling, email, opportunities, and sales activity.", productCategory: "Sales & CRM", showOnProductPage: true },
  { name: "Outreach", icon: "/logo-favicon.png", isActive: false, category: "Sales & CRM", productDescription: "Analyze sequences, rep activity, touches, meetings, and outbound conversion.", productCategory: "Sales & CRM", showOnProductPage: true },
  { name: "Salesloft", icon: "/logo-favicon.png", isActive: false, category: "Sales & CRM", productDescription: "Analyze cadence performance, seller activity, meetings, calls, and pipeline creation.", productCategory: "Sales & CRM", showOnProductPage: true },
  { name: "Gong", icon: "/logo-favicon.png", isActive: false, category: "Sales & CRM", productDescription: "Analyze call intelligence, deal risk, conversation themes, and sales coaching signals.", productCategory: "Sales & CRM", showOnProductPage: true },

  // ── E-commerce ────────────────────────────────────────────────────────────────
  {
    name: "TikTok Shop Seller",
    icon: "/tiktokshop.png",
    isActive: false,
    iconBg: "bg-black",
    category: "E-commerce",
    connectorKey: "tiktok_shop_seller",
    productDescription: "Analyze TikTok Shop orders, products, inventory, returns, settlements, and social-commerce revenue.",
    productCategory: "Ecommerce",
    showOnProductPage: true,
    modalTarget: "tiktok_shop_seller",
  },
  {
    name: "Shopee Seller",
    icon: "/shopee.png",
    isActive: false,
    category: "E-commerce",
    connectorKey: "shopee_seller",
    productDescription: "Analyze Shopee orders, order items, products, inventory, returns, income, and SEA marketplace revenue.",
    productCategory: "Ecommerce",
    showOnProductPage: true,
    modalTarget: "shopee_seller",
  },
  {
    name: "Lazada Seller",
    icon: "/lazada.png",
    isActive: false,
    category: "E-commerce",
    connectorKey: "lazada_seller",
    productDescription: "Analyze Lazada orders, order items, products, inventory, returns, finance, and SEA marketplace revenue.",
    productCategory: "Ecommerce",
    showOnProductPage: true,
    modalTarget: "lazada_seller",
  },
  {
    name: "Shopify",
    icon: "/shopify.png",
    isActive: false,
    category: "E-commerce",
    connectorKey: "shopify",
    productDescription: "Analyze orders, customers, products, inventory, discounts, and ecommerce revenue.",
    productCategory: "Ecommerce",
    showOnProductPage: true,
    modalTarget: "shopify",
    iconBg: "bg-white",
  },
  {
    name: "Klaviyo",
    icon: "/klaviyo.svg",
    isActive: false,
    category: "E-commerce",
    connectorKey: "klaviyo",
    productDescription: "Analyze email, SMS, flows, campaigns, profiles, and retention revenue.",
    productCategory: "Ecommerce",
    showOnProductPage: true,
    modalTarget: "klaviyo",
    iconBg: "bg-white",
  },
  { name: "WooCommerce",        icon: "/woocommerce.png", isActive: false, category: "E-commerce" },
  {
    name: "Amazon Seller",
    icon: "/amazon-seller.png",
    isActive: false,
    category: "E-commerce",
    connectorKey: "amazon_seller",
    productDescription: "Analyze Seller Central orders, inventory, listings, returns, and marketplace revenue.",
    productCategory: "Ecommerce",
    showOnProductPage: true,
    modalTarget: "amazon_seller",
    iconBg: "bg-white",
  },

  // ── Operations & Database ─────────────────────────────────────────────────────
  {
    name: "Google Sheets",
    icon: "/google-sheet.png",
    isActive: true,
    category: "Operations & Database",
    connectorKey: "google_sheets",
    productDescription: "Bring spreadsheet data to life with AI dashboards.",
    productCategory: "Spreadsheets",
    showOnProductPage: true,
    modalTarget: "google_sheets",
  },
  { name: "Microsoft Excel Online", icon: "/microsoft-excel-online.png", isActive: false,              category: "Operations & Database" },
  { name: "Notion",                 icon: "/notion.png",             isActive: false,                  category: "Operations & Database" },
  { name: "Lark",                   icon: "/lark.png",               isActive: false,                  category: "Operations & Database" },
  { name: "Airtable",               icon: "/airtable.png",           isActive: false,                  category: "Operations & Database" },
  {
    name: "PostgreSQL",
    icon: "/PostgreSQL.png",
    isActive: false,
    category: "Operations & Database",
    connectorKey: "postgres",
    productDescription: "Connect your PostgreSQL database in minutes.",
    productCategory: "Databases",
    showOnProductPage: true,
    modalTarget: "postgres",
  },
  {
    name: "BigQuery",
    icon: "/bigquery.svg",
    isActive: false,
    category: "Operations & Database",
    connectorKey: "bigquery",
    productDescription: "Connect BigQuery datasets with schema-aware bounded extracts.",
    productCategory: "Databases",
    showOnProductPage: true,
    modalTarget: "bigquery",
  },
  {
    name: "Snowflake",
    icon: "/snowflake.png",
    isActive: false,
    category: "Operations & Database",
    connectorKey: "snowflake",
    productDescription: "Sync governed Snowflake tables with schema-aware bounded extracts.",
    productCategory: "Databases",
    showOnProductPage: true,
    modalTarget: "snowflake",
  },
  {
    name: "Databricks",
    icon: "/databricks.svg",
    isActive: false,
    category: "Operations & Database",
    connectorKey: "databricks",
    productDescription: "Connect Delta tables and Unity Catalog schemas through Databricks SQL Warehouses.",
    productCategory: "Databases",
    showOnProductPage: true,
    modalTarget: "databricks",
    iconBg: "bg-white",
  },
  {
    name: "Supabase",
    icon: "/supabase.svg",
    isActive: false,
    category: "Operations & Database",
    connectorKey: "supabase",
    productDescription: "Connect Supabase projects with schema, RLS, Auth, Storage, and bounded table extracts.",
    productCategory: "Databases",
    showOnProductPage: true,
    modalTarget: "supabase",
    iconBg: "bg-[#051f1a]",
  },
  { name: "Oracle",                 icon: "/oracle.png", isActive: false, category: "Operations & Database" },
];
