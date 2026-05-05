export type ConnectorCategory =
  | "Advertising Platform"
  | "E-commerce"
  | "Analytics Platform"
  | "Payment & Finance"
  | "Operations & Database";

export interface ConnectorItem {
  name: string;
  icon: string; // path to icon asset
  isActive?: boolean; // when true, integration is enabled; when false/undefined, show "coming soon"
  category: ConnectorCategory;
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
  "Operations & Database",
  "Payment & Finance",
  "E-commerce",
];

export const CONNECTORS: ConnectorItem[] = [
  // ── Advertising Platform ─────────────────────────────────────────────────────
  { name: "Meta Ads",    icon: "/meta.png",       isActive: true, category: "Advertising Platform" },
  { name: "TikTok Ads",  icon: "/tiktok.png",     isActive: true, category: "Advertising Platform", iconBg: "bg-black" },
  { name: "Google Ads",  icon: "/google-ads.png", isActive: true, category: "Advertising Platform" },
  { name: "Shopee Ads",  icon: "/shopee-ads.png",               category: "Advertising Platform" },
  { name: "Apple Ads",   icon: "/apple-ads.png",               category: "Advertising Platform", iconBg: "bg-black" },
  { name: "Unity Ads",   icon: "/unity-ads.png",               category: "Advertising Platform", iconBg: "bg-[#222222]" },

  // ── Analytics Platform ────────────────────────────────────────────────────────
  { name: "GA4",         icon: "/GA4.png",        isActive: true, category: "Analytics Platform" },
  { name: "AppsFlyer",   icon: "/appsflyer.png",  isActive: true, category: "Analytics Platform" },
  { name: "Firebase",    icon: "/firebase.png",   isActive: true, category: "Analytics Platform" },

  // ── Payment & Finance ─────────────────────────────────────────────────────────
  { name: "Stripe",      icon: "/stripe.png",     isActive: true, category: "Payment & Finance" },
  { name: "PayPal",      icon: "/paypal.png",                  category: "Payment & Finance" },

  // ── E-commerce ────────────────────────────────────────────────────────────────
  { name: "TikTok Shop Seller", icon: "/tiktokshop.png",  iconBg: "bg-black",    category: "E-commerce" },
  { name: "Shopee Seller",      icon: "/shopee.png",                             category: "E-commerce" },
  { name: "Lazada Seller",      icon: "/lazada.png",                             category: "E-commerce" },
  { name: "Shopify",            icon: "/shopify.png",                            category: "E-commerce" },
  { name: "WooCommerce",        icon: "/woocommerce.png",                        category: "E-commerce" },
  { name: "Amazon Seller",      icon: "/amazon-seller.png",                      category: "E-commerce" },

  // ── Operations & Database ─────────────────────────────────────────────────────
  { name: "Google Sheets",          icon: "/google-sheet.png",            isActive: true, category: "Operations & Database" },
  { name: "Microsoft Excel Online", icon: "/microsoft-excel-online.png",               category: "Operations & Database" },
  { name: "Notion",                 icon: "/notion.png",                               category: "Operations & Database" },
  { name: "Lark",                   icon: "/lark.png",                                 category: "Operations & Database" },
  { name: "Airtable",               icon: "/airtable.png",                             category: "Operations & Database" },
  { name: "HubSpot",                icon: "/hubspot.png",                              category: "Operations & Database" },
  { name: "PostgreSQL",             icon: "/PostgreSQL.png",                           category: "Operations & Database" },
  { name: "Snowflake",              icon: "/snowflake.png",                            category: "Operations & Database" },
  { name: "Oracle",                 icon: "/oracle.png",                               category: "Operations & Database" },
];
