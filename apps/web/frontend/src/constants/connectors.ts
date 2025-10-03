export interface ConnectorItem {
  name: string;
  icon: string; // path to icon asset
}

export const CONNECTORS: ConnectorItem[] = [
  { name: "Google Sheets", icon: "/google-sheet.png" },
  { name: "GA4", icon: "/GA4.png" },
  { name: "Meta", icon: "/meta.png" },
  { name: "Airtable", icon: "/airtable.png" },
  { name: "Stripe", icon: "/stripe.jpeg" },
  { name: "Shopify", icon: "/shopify.png" },
  { name: "HubSpot", icon: "/hubspot.jpeg" },
  { name: "PostgreSQL", icon: "/PostgreSQL.png" },
];


