export interface ConnectorItem {
  name: string;
  icon: string; // path to icon asset
  isActive?: boolean; // when true, integration is enabled; when false/undefined, show "coming soon"
}

export const CONNECTORS: ConnectorItem[] = [
  { name: "Google Sheets", icon: "/google-sheet.png", isActive: true },
  { name: "GA4", icon: "/GA4.png", isActive: true },
  { name: "Meta", icon: "/meta.png" },
  { name: "Airtable", icon: "/airtable.png" },
  { name: "Stripe", icon: "/stripe.jpeg" },
  { name: "Shopify", icon: "/shopify.png" },
  { name: "HubSpot", icon: "/hubspot.jpeg" },
  { name: "PostgreSQL", icon: "/PostgreSQL.png" },
];


