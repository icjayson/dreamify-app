export type ConnectorCategory =
  | "Advertising Platform"
  | "Sales & CRM"
  | "E-commerce"
  | "Analytics Platform"
  | "Payment & Finance"
  | "Operations & Database";

export type ProductConnectorCategory =
  | "Advertising"
  | "Analytics"
  | "Spreadsheets"
  | "Databases"
  | "Sales & CRM"
  | "Ecommerce"
  | "Finance"
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
  "Analytics Platform",
  "Sales & CRM",
  "Operations & Database",
  "Payment & Finance",
  "E-commerce",
];

export const CONNECTORS: ConnectorItem[] = [
  // ── Advertising Platform ─────────────────────────────────────────────────────
  {
    name: "Meta Ads",
    icon: "/meta.png",
    isActive: true,
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
    isActive: true,
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
  { name: "Shopee Ads",  icon: "/shopee-ads.png",               category: "Advertising Platform" },
  { name: "Apple Ads",   icon: "/apple-ads.png",               category: "Advertising Platform", iconBg: "bg-black" },
  { name: "Unity Ads",   icon: "/unity-ads.png",               category: "Advertising Platform", iconBg: "bg-[#222222]" },

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
    isActive: true,
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

  // ── Payment & Finance ─────────────────────────────────────────────────────────
  {
    name: "Stripe",
    icon: "/stripe.png",
    isActive: true,
    category: "Payment & Finance",
    connectorKey: "stripe",
    productDescription: "Track payments, revenue, and subscription metrics.",
    productCategory: "Finance",
    showOnProductPage: true,
    modalTarget: "stripe",
  },
  { name: "PayPal",      icon: "/paypal.png",                  category: "Payment & Finance" },

  // ── Sales & CRM ─────────────────────────────────────────────────────────────
  {
    name: "HubSpot",
    icon: "/hubspot.png",
    isActive: true,
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
    isActive: true,
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
    isActive: true,
    category: "Sales & CRM",
    connectorKey: "pipedrive",
    productDescription: "Analyze deal stages, leads, contacts, activities, products, and owner performance.",
    productCategory: "Sales & CRM",
    showOnProductPage: true,
    modalTarget: "pipedrive",
    iconBg: "bg-white",
  },

  // ── E-commerce ────────────────────────────────────────────────────────────────
  { name: "TikTok Shop Seller", icon: "/tiktokshop.png",  iconBg: "bg-black",    category: "E-commerce" },
  { name: "Shopee Seller",      icon: "/shopee.png",                             category: "E-commerce" },
  { name: "Lazada Seller",      icon: "/lazada.png",                             category: "E-commerce" },
  {
    name: "Shopify",
    icon: "/shopify.png",
    isActive: true,
    category: "E-commerce",
    connectorKey: "shopify",
    productDescription: "Analyze orders, customers, products, inventory, discounts, and ecommerce revenue.",
    productCategory: "Ecommerce",
    showOnProductPage: true,
    modalTarget: "shopify",
    iconBg: "bg-white",
  },
  { name: "WooCommerce",        icon: "/woocommerce.png",                        category: "E-commerce" },
  { name: "Amazon Seller",      icon: "/amazon-seller.png",                      category: "E-commerce" },

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
  { name: "Microsoft Excel Online", icon: "/microsoft-excel-online.png",               category: "Operations & Database" },
  { name: "Notion",                 icon: "/notion.png",                               category: "Operations & Database" },
  { name: "Lark",                   icon: "/lark.png",                                 category: "Operations & Database" },
  { name: "Airtable",               icon: "/airtable.png",                             category: "Operations & Database" },
  {
    name: "PostgreSQL",
    icon: "/PostgreSQL.png",
    isActive: true,
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
    isActive: true,
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
    isActive: true,
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
    isActive: true,
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
    isActive: true,
    category: "Operations & Database",
    connectorKey: "supabase",
    productDescription: "Connect Supabase projects with schema, RLS, Auth, Storage, and bounded table extracts.",
    productCategory: "Databases",
    showOnProductPage: true,
    modalTarget: "supabase",
    iconBg: "bg-[#051f1a]",
  },
  { name: "Oracle",                 icon: "/oracle.png",                               category: "Operations & Database" },
];
