export interface ConnectorItem {
  name: string;
  icon: string; // path to icon asset
  isActive?: boolean; // when true, integration is enabled; when false/undefined, show "coming soon"
}

export const CONNECTORS: ConnectorItem[] = [
  { name: "Google Sheets", icon: "/google-sheet.png", isActive: true },
  { name: "GA4", icon: "/GA4.png", isActive: true },
  { name: "Google Ads", icon: "/google-ads.svg", isActive: true },
  { name: "Meta Ads", icon: "/meta.png", isActive: true },
  { name: "TikTok Ads", icon: "/tiktok.png", isActive: true },
  { name: "AppsFlyer", icon: "/appsflyer.png", isActive: true },
  { name: "Firebase", icon: "/firebase.svg", isActive: true },
  { name: "Airtable", icon: "/airtable.png" },
  { name: "Stripe", icon: "/stripe.jpeg", isActive: true },
  { name: "Shopify", icon: "/shopify.png" },
  { name: "HubSpot", icon: "/hubspot.jpeg" },
  { name: "PostgreSQL", icon: "/PostgreSQL.png" },
];
