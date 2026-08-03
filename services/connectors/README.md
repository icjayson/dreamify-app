# Optional connector packs

The default `hobby_demo` profile ships no external connector implementation in the core API bundle. Existing connector source remains available under the imported API history, while certification moves implementations into small dependency-isolated packs.

Planned packs:

- `google`: GA4, Google Sheets, Google Ads, Firebase, Search Console.
- `marketing-crm`: Meta, TikTok Ads, AppsFlyer, HubSpot, Salesforce, Pipedrive, Klaviyo, Mixpanel, PostHog, Customer.io.
- `commerce`: Stripe data import, Shopify, QuickBooks, Amazon Seller, TikTok Shop, Shopee, Lazada, Zendesk.
- `warehouse`: PostgreSQL, BigQuery, Snowflake, Databricks and Supabase.
- `messaging`: Slack, Telegram, Zalo and WhatsApp.

A pack may be enabled only after credentials are configured and its auth, state/signature, retry, tenant-isolation, and provider smoke tests pass. The capabilities endpoint remains authoritative; unconfigured features return `FEATURE_DISABLED`.
