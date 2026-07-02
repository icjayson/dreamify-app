import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useScheduleStore } from '@/chat/useScheduleStore';
import { CreateScheduleRequest, ProviderKey, FrequencyKey, DateRangePreset } from '@/services/scheduleService';
import { integrationService, type ConnectorOverviewItem, type ConnectorSelectedEntity } from '@/services/integrationService';

type ScheduleProject = {
  id: string;
  title: string;
};

interface CreateScheduleModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill a provider when opened from a connector card */
  defaultProvider?: ProviderKey;
  /** Connector config pre-filled from the connector context */
  defaultConnectorConfig?: Record<string, unknown>;
  defaultAccountName?: string;
  defaultEntityName?: string;
  projectId: string;
  connectorOverview?: ConnectorOverviewItem[];
  projects?: ScheduleProject[];
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  ga4: 'Google Analytics 4',
  meta_ads: 'Meta Ads',
  tiktok: 'TikTok Ads',
  appsflyer: 'AppsFlyer',
  stripe: 'Stripe',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  pipedrive: 'Pipedrive',
  supabase: 'Supabase',
  shopify: 'Shopify',
  klaviyo: 'Klaviyo',
  quickbooks: 'QuickBooks',
  zendesk: 'Zendesk',
  mixpanel: 'Mixpanel',
  posthog: 'PostHog',
  customer_io: 'Customer.io',
  google_search_console: 'Google Search Console',
  amazon_seller: 'Amazon Seller',
  tiktok_shop_seller: 'TikTok Shop Seller',
  shopee_seller: 'Shopee Seller',
  lazada_seller: 'Lazada Seller',
  warehouse: 'Warehouse',
};

const FREQUENCY_OPTIONS: { value: FrequencyKey; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
];

const DATE_PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_14d', label: 'Last 14 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00 UTC`,
}));

const DOW_OPTIONS = [
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
];

const EMPTY_CONNECTOR_CONFIG: Record<string, unknown> = {};
const EMPTY_CONNECTOR_OVERVIEW: ConnectorOverviewItem[] = [];
const EMPTY_PROJECTS: ScheduleProject[] = [];

const CONNECTOR_TO_PROVIDER: Record<string, ProviderKey> = {
  ga4: 'ga4',
  meta_ads: 'meta_ads',
  tiktok_ads: 'tiktok',
  appsflyer: 'appsflyer',
  stripe: 'stripe',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  pipedrive: 'pipedrive',
  supabase: 'supabase',
  shopify: 'shopify',
  klaviyo: 'klaviyo',
  quickbooks: 'quickbooks',
  zendesk: 'zendesk',
  mixpanel: 'mixpanel',
  posthog: 'posthog',
  customer_io: 'customer_io',
  google_search_console: 'google_search_console',
  amazon_seller: 'amazon_seller',
  tiktok_shop_seller: 'tiktok_shop_seller',
  shopee_seller: 'shopee_seller',
  lazada_seller: 'lazada_seller',
  postgres: 'warehouse',
  bigquery: 'warehouse',
  snowflake: 'warehouse',
  databricks: 'warehouse',
};

const PROVIDER_TO_CONNECTOR: Record<ProviderKey, string> = {
  ga4: 'ga4',
  meta_ads: 'meta_ads',
  tiktok: 'tiktok_ads',
  appsflyer: 'appsflyer',
  stripe: 'stripe',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  pipedrive: 'pipedrive',
  supabase: 'supabase',
  shopify: 'shopify',
  klaviyo: 'klaviyo',
  quickbooks: 'quickbooks',
  zendesk: 'zendesk',
  mixpanel: 'mixpanel',
  posthog: 'posthog',
  customer_io: 'customer_io',
  google_search_console: 'google_search_console',
  amazon_seller: 'amazon_seller',
  tiktok_shop_seller: 'tiktok_shop_seller',
  shopee_seller: 'shopee_seller',
  lazada_seller: 'lazada_seller',
  warehouse: 'postgres',
};

const STRIPE_REPORT_ENTITIES: ConnectorSelectedEntity[] = [
  { id: 'charges', name: 'Charges', type: 'report' },
  { id: 'subscriptions', name: 'Subscriptions', type: 'report' },
  { id: 'customers', name: 'Customers', type: 'report' },
];

const HUBSPOT_REPORT_ENTITIES: ConnectorSelectedEntity[] = [
  { id: 'hubspot:sales_pipeline:all:all', name: 'Sales Pipeline', type: 'report', report_type: 'sales_pipeline', pipeline_id: 'all', owner_id: 'all' },
  { id: 'hubspot:contacts:all:all', name: 'Contacts', type: 'report', report_type: 'contacts', pipeline_id: 'all', owner_id: 'all' },
  { id: 'hubspot:companies:all:all', name: 'Companies', type: 'report', report_type: 'companies', pipeline_id: 'all', owner_id: 'all' },
  { id: 'hubspot:activities:all:all', name: 'Activities', type: 'report', report_type: 'activities', pipeline_id: 'all', owner_id: 'all' },
];

const SALESFORCE_REPORT_ENTITIES: ConnectorSelectedEntity[] = [
  { id: 'salesforce:sales_pipeline:all:all', name: 'Sales Pipeline', type: 'report', report_type: 'sales_pipeline', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:leads:all:all', name: 'Leads', type: 'report', report_type: 'leads', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:accounts_contacts:all:all', name: 'Accounts & Contacts', type: 'report', report_type: 'accounts_contacts', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:activities:all:all', name: 'Activities', type: 'report', report_type: 'activities', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:campaigns:all:all', name: 'Campaigns', type: 'report', report_type: 'campaigns', object_name: 'all', owner_id: 'all' },
];

const PIPEDRIVE_REPORT_ENTITIES: ConnectorSelectedEntity[] = [
  { id: 'pipedrive:sales_pipeline:all:all', name: 'Sales Pipeline', type: 'report', report_type: 'sales_pipeline', pipeline_id: 'all', owner_id: 'all' },
  { id: 'pipedrive:leads:all:all', name: 'Leads', type: 'report', report_type: 'leads', pipeline_id: 'all', owner_id: 'all' },
  { id: 'pipedrive:contacts_organizations:all:all', name: 'Contacts & Organizations', type: 'report', report_type: 'contacts_organizations', pipeline_id: 'all', owner_id: 'all' },
  { id: 'pipedrive:activities:all:all', name: 'Activities', type: 'report', report_type: 'activities', pipeline_id: 'all', owner_id: 'all' },
  { id: 'pipedrive:products:all:all', name: 'Products', type: 'report', report_type: 'products', pipeline_id: 'all', owner_id: 'all' },
];

function buildShopifyReportEntities(shopDomain: string): ConnectorSelectedEntity[] {
  const domain = shopDomain.trim();
  if (!domain) return [];
  return [
    { id: `shopify:sales_overview:${domain}:orders`, name: 'Sales Overview', type: 'report', report_type: 'sales_overview', shop_domain: domain, resource: 'orders' },
    { id: `shopify:orders:${domain}:orders`, name: 'Orders', type: 'report', report_type: 'orders', shop_domain: domain, resource: 'orders' },
    { id: `shopify:products:${domain}:products`, name: 'Products', type: 'report', report_type: 'products', shop_domain: domain, resource: 'products' },
    { id: `shopify:customers:${domain}:customers`, name: 'Customers', type: 'report', report_type: 'customers', shop_domain: domain, resource: 'customers' },
    { id: `shopify:inventory:${domain}:inventory`, name: 'Inventory', type: 'report', report_type: 'inventory', shop_domain: domain, resource: 'inventory' },
    { id: `shopify:discounts:${domain}:discounts`, name: 'Discounts', type: 'report', report_type: 'discounts', shop_domain: domain, resource: 'discounts' },
  ];
}

function buildKlaviyoReportEntities(accountId: string, accountName = 'Klaviyo'): ConnectorSelectedEntity[] {
  const account = accountId.trim() || 'all';
  return [
    { id: `klaviyo:lifecycle_overview:${account}:all`, name: 'Lifecycle Overview', type: 'report', report_type: 'lifecycle_overview', account_id: account, resource_id: 'all', account_name: accountName },
    { id: `klaviyo:campaigns:${account}:all`, name: 'Campaigns', type: 'report', report_type: 'campaigns', account_id: account, resource_id: 'all', account_name: accountName },
    { id: `klaviyo:flows:${account}:all`, name: 'Flows', type: 'report', report_type: 'flows', account_id: account, resource_id: 'all', account_name: accountName },
    { id: `klaviyo:profiles:${account}:all`, name: 'Profiles', type: 'report', report_type: 'profiles', account_id: account, resource_id: 'all', account_name: accountName },
    { id: `klaviyo:lists:${account}:all`, name: 'Lists', type: 'report', report_type: 'lists', account_id: account, resource_id: 'all', account_name: accountName },
    { id: `klaviyo:events:${account}:all`, name: 'Events', type: 'report', report_type: 'events', account_id: account, resource_id: 'all', account_name: accountName },
    { id: `klaviyo:metrics:${account}:all`, name: 'Metrics', type: 'report', report_type: 'metrics', account_id: account, resource_id: 'all', account_name: accountName },
  ];
}

function buildQuickBooksReportEntities(realmId: string, accountName = 'QuickBooks'): ConnectorSelectedEntity[] {
  const realm = realmId.trim() || 'all';
  return [
    { id: `quickbooks:finance_overview:${realm}:all`, name: 'Finance Overview', type: 'report', report_type: 'finance_overview', realm_id: realm, resource_id: 'all', account_name: accountName },
    { id: `quickbooks:profit_and_loss:${realm}:reports`, name: 'Profit and Loss', type: 'report', report_type: 'profit_and_loss', realm_id: realm, resource_id: 'reports', account_name: accountName },
    { id: `quickbooks:balance_sheet:${realm}:reports`, name: 'Balance Sheet', type: 'report', report_type: 'balance_sheet', realm_id: realm, resource_id: 'reports', account_name: accountName },
    { id: `quickbooks:cash_flow:${realm}:reports`, name: 'Cash Flow', type: 'report', report_type: 'cash_flow', realm_id: realm, resource_id: 'reports', account_name: accountName },
    { id: `quickbooks:invoices:${realm}:Invoice`, name: 'Invoices', type: 'report', report_type: 'invoices', realm_id: realm, resource_id: 'Invoice', account_name: accountName },
    { id: `quickbooks:bills:${realm}:Bill`, name: 'Bills', type: 'report', report_type: 'bills', realm_id: realm, resource_id: 'Bill', account_name: accountName },
    { id: `quickbooks:payments:${realm}:Payment`, name: 'Payments', type: 'report', report_type: 'payments', realm_id: realm, resource_id: 'Payment', account_name: accountName },
    { id: `quickbooks:customers:${realm}:Customer`, name: 'Customers', type: 'report', report_type: 'customers', realm_id: realm, resource_id: 'Customer', account_name: accountName },
    { id: `quickbooks:vendors:${realm}:Vendor`, name: 'Vendors', type: 'report', report_type: 'vendors', realm_id: realm, resource_id: 'Vendor', account_name: accountName },
    { id: `quickbooks:items:${realm}:Item`, name: 'Items', type: 'report', report_type: 'items', realm_id: realm, resource_id: 'Item', account_name: accountName },
    { id: `quickbooks:accounts:${realm}:Account`, name: 'Accounts', type: 'report', report_type: 'accounts', realm_id: realm, resource_id: 'Account', account_name: accountName },
  ];
}

function buildZendeskReportEntities(subdomain: string, accountName = 'Zendesk'): ConnectorSelectedEntity[] {
  const domain = subdomain.trim() || 'all';
  return [
    { id: `zendesk:support_overview:${domain}:all`, name: 'Support Overview', type: 'report', report_type: 'support_overview', subdomain: domain, resource_id: 'all', account_name: accountName },
    { id: `zendesk:tickets:${domain}:tickets`, name: 'Tickets', type: 'report', report_type: 'tickets', subdomain: domain, resource_id: 'tickets', account_name: accountName },
    { id: `zendesk:ticket_events:${domain}:ticket_events`, name: 'Ticket Events', type: 'report', report_type: 'ticket_events', subdomain: domain, resource_id: 'ticket_events', account_name: accountName },
    { id: `zendesk:users:${domain}:users`, name: 'Users', type: 'report', report_type: 'users', subdomain: domain, resource_id: 'users', account_name: accountName },
    { id: `zendesk:organizations:${domain}:organizations`, name: 'Organizations', type: 'report', report_type: 'organizations', subdomain: domain, resource_id: 'organizations', account_name: accountName },
    { id: `zendesk:groups:${domain}:groups`, name: 'Groups', type: 'report', report_type: 'groups', subdomain: domain, resource_id: 'groups', account_name: accountName },
    { id: `zendesk:satisfaction_ratings:${domain}:satisfaction_ratings`, name: 'Satisfaction Ratings', type: 'report', report_type: 'satisfaction_ratings', subdomain: domain, resource_id: 'satisfaction_ratings', account_name: accountName },
  ];
}

function buildMixpanelReportEntities(projectId: string, accountName = 'Mixpanel', region = 'US'): ConnectorSelectedEntity[] {
  const project = projectId.trim() || 'all';
  const selectedRegion = region.trim().toUpperCase() || 'US';
  return [
    { id: `mixpanel:product_overview:${project}:all`, name: 'Product Overview', type: 'report', report_type: 'product_overview', project_id: project, resource_id: 'all', region: selectedRegion, account_name: accountName },
    { id: `mixpanel:events:${project}:all`, name: 'Raw Events', type: 'report', report_type: 'events', project_id: project, resource_id: 'all', region: selectedRegion, account_name: accountName },
    { id: `mixpanel:event_breakdown:${project}:all`, name: 'Event Breakdown', type: 'report', report_type: 'event_breakdown', project_id: project, resource_id: 'all', region: selectedRegion, account_name: accountName },
    { id: `mixpanel:funnels:${project}:all`, name: 'Funnels', type: 'report', report_type: 'funnels', project_id: project, resource_id: 'all', region: selectedRegion, account_name: accountName },
    { id: `mixpanel:retention:${project}:all`, name: 'Retention', type: 'report', report_type: 'retention', project_id: project, resource_id: 'all', region: selectedRegion, account_name: accountName },
    { id: `mixpanel:cohorts:${project}:all`, name: 'Cohorts', type: 'report', report_type: 'cohorts', project_id: project, resource_id: 'all', region: selectedRegion, account_name: accountName },
    { id: `mixpanel:users:${project}:all`, name: 'Users', type: 'report', report_type: 'users', project_id: project, resource_id: 'all', region: selectedRegion, account_name: accountName },
  ];
}

function buildPostHogReportEntities(projectId: string, accountName = 'PostHog', region = 'US', baseUrl = ''): ConnectorSelectedEntity[] {
  const project = projectId.trim() || 'all';
  const selectedRegion = region.trim().toUpperCase() || 'US';
  return [
    { id: `posthog:product_overview:${project}:all`, name: 'Product Overview', type: 'report', report_type: 'product_overview', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:events:${project}:all`, name: 'Events', type: 'report', report_type: 'events', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:event_breakdown:${project}:all`, name: 'Event Breakdown', type: 'report', report_type: 'event_breakdown', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:insights:${project}:all`, name: 'Insights', type: 'report', report_type: 'insights', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:funnels:${project}:all`, name: 'Funnels', type: 'report', report_type: 'funnels', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:retention:${project}:all`, name: 'Retention', type: 'report', report_type: 'retention', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:cohorts:${project}:all`, name: 'Cohorts', type: 'report', report_type: 'cohorts', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:persons:${project}:all`, name: 'Persons', type: 'report', report_type: 'persons', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `posthog:feature_flags:${project}:all`, name: 'Feature Flags', type: 'report', report_type: 'feature_flags', project_id: project, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
  ];
}

function buildCustomerIOReportEntities(workspaceId: string, accountName = 'Customer.io', region = 'US', baseUrl = ''): ConnectorSelectedEntity[] {
  const workspace = workspaceId.trim() || 'all';
  const selectedRegion = region.trim().toUpperCase() || 'US';
  return [
    { id: `customer_io:lifecycle_overview:${workspace}:all`, name: 'Lifecycle Overview', type: 'report', report_type: 'lifecycle_overview', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `customer_io:campaigns:${workspace}:all`, name: 'Campaigns', type: 'report', report_type: 'campaigns', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `customer_io:campaign_actions:${workspace}:all`, name: 'Campaign Actions', type: 'report', report_type: 'campaign_actions', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `customer_io:newsletters:${workspace}:all`, name: 'Newsletters', type: 'report', report_type: 'newsletters', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `customer_io:segments:${workspace}:all`, name: 'Segments', type: 'report', report_type: 'segments', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `customer_io:people:${workspace}:all`, name: 'People', type: 'report', report_type: 'people', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `customer_io:events:${workspace}:all`, name: 'Events', type: 'report', report_type: 'events', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
    { id: `customer_io:message_metrics:${workspace}:all`, name: 'Message Metrics', type: 'report', report_type: 'message_metrics', workspace_id: workspace, resource_id: 'all', region: selectedRegion, base_url: baseUrl, account_name: accountName },
  ];
}

function buildGoogleSearchConsoleReportEntities(siteKey: string, siteUrl: string, accountName = 'Google Search Console', searchType = 'web'): ConnectorSelectedEntity[] {
  const key = siteKey.trim();
  if (!key) return [];
  const selectedSearchType = searchType.trim() || 'web';
  const siteName = siteUrl.trim() || key;
  return [
    { id: `google_search_console:search_overview:${key}:${selectedSearchType}`, name: `${siteName} - Search Overview`, type: 'report', report_type: 'search_overview', site_key: key, site_url: siteUrl, search_type: selectedSearchType, account_name: accountName },
    { id: `google_search_console:queries:${key}:${selectedSearchType}`, name: `${siteName} - Queries`, type: 'report', report_type: 'queries', site_key: key, site_url: siteUrl, search_type: selectedSearchType, account_name: accountName },
    { id: `google_search_console:pages:${key}:${selectedSearchType}`, name: `${siteName} - Pages`, type: 'report', report_type: 'pages', site_key: key, site_url: siteUrl, search_type: selectedSearchType, account_name: accountName },
    { id: `google_search_console:countries:${key}:${selectedSearchType}`, name: `${siteName} - Countries`, type: 'report', report_type: 'countries', site_key: key, site_url: siteUrl, search_type: selectedSearchType, account_name: accountName },
    { id: `google_search_console:devices:${key}:${selectedSearchType}`, name: `${siteName} - Devices`, type: 'report', report_type: 'devices', site_key: key, site_url: siteUrl, search_type: selectedSearchType, account_name: accountName },
    { id: `google_search_console:dates:${key}:${selectedSearchType}`, name: `${siteName} - Dates`, type: 'report', report_type: 'dates', site_key: key, site_url: siteUrl, search_type: selectedSearchType, account_name: accountName },
    { id: `google_search_console:query_page:${key}:${selectedSearchType}`, name: `${siteName} - Query and Page`, type: 'report', report_type: 'query_page', site_key: key, site_url: siteUrl, search_type: selectedSearchType, account_name: accountName },
  ];
}

function buildAmazonSellerReportEntities(sellerId: string, accountName = 'Amazon Seller', marketplaceId = 'all'): ConnectorSelectedEntity[] {
  const seller = sellerId.trim() || 'all';
  const marketplace = marketplaceId.trim() || 'all';
  return [
    { id: `amazon_seller:sales_overview:${seller}:${marketplace}`, name: 'Sales Overview', type: 'report', report_type: 'sales_overview', seller_id: seller, marketplace_id: marketplace, account_name: accountName },
    { id: `amazon_seller:orders:${seller}:${marketplace}`, name: 'Orders', type: 'report', report_type: 'orders', seller_id: seller, marketplace_id: marketplace, account_name: accountName },
    { id: `amazon_seller:order_items:${seller}:${marketplace}`, name: 'Order Items', type: 'report', report_type: 'order_items', seller_id: seller, marketplace_id: marketplace, account_name: accountName },
    { id: `amazon_seller:inventory:${seller}:${marketplace}`, name: 'Inventory', type: 'report', report_type: 'inventory', seller_id: seller, marketplace_id: marketplace, account_name: accountName },
    { id: `amazon_seller:listings:${seller}:${marketplace}`, name: 'Listings', type: 'report', report_type: 'listings', seller_id: seller, marketplace_id: marketplace, account_name: accountName },
    { id: `amazon_seller:returns:${seller}:${marketplace}`, name: 'Returns', type: 'report', report_type: 'returns', seller_id: seller, marketplace_id: marketplace, account_name: accountName },
  ];
}

function buildTikTokShopSellerReportEntities(shopId: string, accountName = 'TikTok Shop Seller', region = 'US'): ConnectorSelectedEntity[] {
  const shop = shopId.trim() || 'all';
  const selectedRegion = region.trim().toUpperCase() || 'US';
  return [
    { id: `tiktok_shop_seller:sales_overview:${shop}:${selectedRegion}`, name: 'Sales Overview', type: 'report', report_type: 'sales_overview', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `tiktok_shop_seller:orders:${shop}:${selectedRegion}`, name: 'Orders', type: 'report', report_type: 'orders', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `tiktok_shop_seller:order_items:${shop}:${selectedRegion}`, name: 'Order Items', type: 'report', report_type: 'order_items', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `tiktok_shop_seller:products:${shop}:${selectedRegion}`, name: 'Products', type: 'report', report_type: 'products', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `tiktok_shop_seller:inventory:${shop}:${selectedRegion}`, name: 'Inventory', type: 'report', report_type: 'inventory', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `tiktok_shop_seller:returns:${shop}:${selectedRegion}`, name: 'Returns', type: 'report', report_type: 'returns', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `tiktok_shop_seller:settlements:${shop}:${selectedRegion}`, name: 'Settlements', type: 'report', report_type: 'settlements', shop_id: shop, region: selectedRegion, account_name: accountName },
  ];
}

function buildShopeeSellerReportEntities(shopId: string, accountName = 'Shopee Seller', region = 'VN'): ConnectorSelectedEntity[] {
  const shop = shopId.trim() || 'all';
  const selectedRegion = region.trim().toUpperCase() || 'VN';
  return [
    { id: `shopee_seller:sales_overview:${shop}:${selectedRegion}`, name: 'Sales Overview', type: 'report', report_type: 'sales_overview', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `shopee_seller:orders:${shop}:${selectedRegion}`, name: 'Orders', type: 'report', report_type: 'orders', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `shopee_seller:order_items:${shop}:${selectedRegion}`, name: 'Order Items', type: 'report', report_type: 'order_items', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `shopee_seller:products:${shop}:${selectedRegion}`, name: 'Products', type: 'report', report_type: 'products', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `shopee_seller:inventory:${shop}:${selectedRegion}`, name: 'Inventory', type: 'report', report_type: 'inventory', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `shopee_seller:returns:${shop}:${selectedRegion}`, name: 'Returns', type: 'report', report_type: 'returns', shop_id: shop, region: selectedRegion, account_name: accountName },
    { id: `shopee_seller:income:${shop}:${selectedRegion}`, name: 'Income', type: 'report', report_type: 'income', shop_id: shop, region: selectedRegion, account_name: accountName },
  ];
}

function buildLazadaSellerReportEntities(sellerId: string, accountName = 'Lazada Seller', region = 'VN'): ConnectorSelectedEntity[] {
  const seller = sellerId.trim() || 'all';
  const selectedRegion = region.trim().toUpperCase() || 'VN';
  return [
    { id: `lazada_seller:sales_overview:${seller}:${selectedRegion}`, name: 'Sales Overview', type: 'report', report_type: 'sales_overview', seller_id: seller, region: selectedRegion, account_name: accountName },
    { id: `lazada_seller:orders:${seller}:${selectedRegion}`, name: 'Orders', type: 'report', report_type: 'orders', seller_id: seller, region: selectedRegion, account_name: accountName },
    { id: `lazada_seller:order_items:${seller}:${selectedRegion}`, name: 'Order Items', type: 'report', report_type: 'order_items', seller_id: seller, region: selectedRegion, account_name: accountName },
    { id: `lazada_seller:products:${seller}:${selectedRegion}`, name: 'Products', type: 'report', report_type: 'products', seller_id: seller, region: selectedRegion, account_name: accountName },
    { id: `lazada_seller:inventory:${seller}:${selectedRegion}`, name: 'Inventory', type: 'report', report_type: 'inventory', seller_id: seller, region: selectedRegion, account_name: accountName },
    { id: `lazada_seller:returns:${seller}:${selectedRegion}`, name: 'Returns', type: 'report', report_type: 'returns', seller_id: seller, region: selectedRegion, account_name: accountName },
    { id: `lazada_seller:finance:${seller}:${selectedRegion}`, name: 'Finance', type: 'report', report_type: 'finance', seller_id: seller, region: selectedRegion, account_name: accountName },
  ];
}

function getEntityIdFromConfig(provider: ProviderKey, config: Record<string, unknown>) {
  if (provider === 'ga4') return String(config.property_id || '');
  if (provider === 'meta_ads' || provider === 'tiktok') return String(config.ad_account_id || '');
  if (provider === 'appsflyer') return String(config.app_id || '');
  if (provider === 'stripe') return String(config.report_type || 'charges');
  if (provider === 'hubspot') return String(config.entity_id || `hubspot:${config.report_type || 'sales_pipeline'}:${config.pipeline_id || 'all'}:${config.owner_id || 'all'}`);
  if (provider === 'salesforce') return String(config.entity_id || `salesforce:${config.report_type || 'sales_pipeline'}:${config.object_name || 'all'}:${config.owner_id || 'all'}`);
  if (provider === 'pipedrive') return String(config.entity_id || `pipedrive:${config.report_type || 'sales_pipeline'}:${config.pipeline_id || 'all'}:${config.owner_id || 'all'}`);
  if (provider === 'shopify') return String(config.entity_id || `shopify:${config.report_type || 'sales_overview'}:${config.shop_domain || ''}:${config.resource || 'all'}`);
  if (provider === 'klaviyo') return String(config.entity_id || `klaviyo:${config.report_type || 'lifecycle_overview'}:${config.account_id || 'all'}:${config.resource_id || 'all'}`);
  if (provider === 'quickbooks') return String(config.entity_id || `quickbooks:${config.report_type || 'finance_overview'}:${config.realm_id || 'all'}:${config.resource_id || 'all'}`);
  if (provider === 'zendesk') return String(config.entity_id || `zendesk:${config.report_type || 'support_overview'}:${config.subdomain || 'all'}:${config.resource_id || 'all'}`);
  if (provider === 'mixpanel') return String(config.entity_id || `mixpanel:${config.report_type || 'product_overview'}:${config.project_id || 'all'}:${config.resource_id || 'all'}`);
  if (provider === 'posthog') return String(config.entity_id || `posthog:${config.report_type || 'product_overview'}:${config.project_id || 'all'}:${config.resource_id || 'all'}`);
  if (provider === 'customer_io') return String(config.entity_id || `customer_io:${config.report_type || 'lifecycle_overview'}:${config.workspace_id || 'all'}:${config.resource_id || 'all'}`);
  if (provider === 'google_search_console') return String(config.entity_id || `google_search_console:${config.report_type || 'search_overview'}:${config.site_key || 'all'}:${config.search_type || 'web'}`);
  if (provider === 'amazon_seller') return String(config.entity_id || `amazon_seller:${config.report_type || 'sales_overview'}:${config.seller_id || 'all'}:${config.marketplace_id || 'all'}`);
  if (provider === 'tiktok_shop_seller') return String(config.entity_id || `tiktok_shop_seller:${config.report_type || 'sales_overview'}:${config.shop_id || 'all'}:${config.region || 'US'}`);
  if (provider === 'shopee_seller') return String(config.entity_id || `shopee_seller:${config.report_type || 'sales_overview'}:${config.shop_id || 'all'}:${config.region || 'VN'}`);
  if (provider === 'lazada_seller') return String(config.entity_id || `lazada_seller:${config.report_type || 'sales_overview'}:${config.seller_id || 'all'}:${config.region || 'VN'}`);
  if (provider === 'supabase') {
    const entityId = String(config.entity_id || '');
    if (entityId) return entityId;
    const connectionId = String(config.connection_id || '');
    const syncMode = String(config.sync_mode || 'bounded_table_snapshot');
    if (!connectionId) return '';
    if (syncMode === 'app_profile') return `supabase:${connectionId}:storage:${config.bucket || 'all'}`;
    if (syncMode === 'profile_only') return `supabase:${connectionId}:profile`;
    const schema = String(config.schema || config.schema_name || '');
    const table = String(config.table || config.table_name || '');
    return schema && table ? `supabase:${connectionId}:table:${schema}.${table}` : '';
  }
  if (provider === 'warehouse') {
    const entityId = String(config.entity_id || '');
    if (entityId) return entityId;
    const connectionId = String(config.connection_id || '');
    const schema = String(config.schema || config.schema_name || '');
    const table = String(config.table || config.table_name || '');
    return connectionId && schema && table ? `${connectionId}:${schema}.${table}` : '';
  }
  return '';
}

function buildConnectorConfig(provider: ProviderKey, entity: ConnectorSelectedEntity): Record<string, unknown> {
  if (provider === 'ga4') {
    return { property_id: entity.id, property_name: entity.name, account_name: entity.account_name || entity.name };
  }
  if (provider === 'meta_ads' || provider === 'tiktok') {
    return { ad_account_id: entity.id, account_name: entity.account_name || entity.name };
  }
  if (provider === 'appsflyer') {
    return { app_id: entity.id, app_name: entity.name };
  }
  if (provider === 'hubspot') {
    const [, reportType = 'sales_pipeline', pipelineId = 'all', ownerId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      pipeline_id: entity.pipeline_id || pipelineId,
      owner_id: entity.owner_id || ownerId,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_associations: true,
    };
  }
  if (provider === 'salesforce') {
    const [, reportType = 'sales_pipeline', objectName = 'all', ownerId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      object_name: entity.object_name || objectName,
      owner_id: entity.owner_id || ownerId,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
    };
  }
  if (provider === 'pipedrive') {
    const [, reportType = 'sales_pipeline', pipelineId = 'all', ownerId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      pipeline_id: entity.pipeline_id || pipelineId,
      owner_id: entity.owner_id || ownerId,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
    };
  }
  if (provider === 'shopify') {
    const [, reportType = 'sales_overview', shopDomain = '', resource = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      shop_domain: entity.shop_domain || shopDomain,
      resource: entity.resource || resource,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'klaviyo') {
    const [, reportType = 'lifecycle_overview', accountId = 'all', resourceId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      account_id: entity.account_id || accountId,
      resource_id: entity.resource_id || resourceId,
      metric_id: entity.metric_id || '',
      channel: entity.channel || 'all',
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'quickbooks') {
    const [, reportType = 'finance_overview', realmId = 'all', resourceId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      realm_id: entity.realm_id || realmId,
      resource_id: entity.resource_id || resourceId,
      accounting_basis: entity.accounting_basis || 'Accrual',
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'zendesk') {
    const [, reportType = 'support_overview', subdomain = 'all', resourceId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      subdomain: entity.subdomain || subdomain,
      resource_id: entity.resource_id || resourceId,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'mixpanel') {
    const [, reportType = 'product_overview', projectId = 'all', resourceId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      project_id: entity.project_id || entity.account_id || projectId,
      resource_id: entity.resource_id || resourceId,
      region: entity.region || 'US',
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'posthog') {
    const [, reportType = 'product_overview', projectId = 'all', resourceId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      project_id: entity.project_id || entity.account_id || projectId,
      resource_id: entity.resource_id || resourceId,
      region: entity.region || 'US',
      base_url: entity.base_url || '',
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'customer_io') {
    const [, reportType = 'lifecycle_overview', workspaceId = 'all', resourceId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      workspace_id: entity.workspace_id || entity.account_id || workspaceId,
      resource_id: entity.resource_id || resourceId,
      region: entity.region || 'US',
      base_url: entity.base_url || '',
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'google_search_console') {
    const [, reportType = 'search_overview', siteKey = 'all', searchType = 'web'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      site_key: entity.site_key || siteKey,
      site_url: entity.site_url || '',
      search_type: entity.search_type || searchType,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
    };
  }
  if (provider === 'amazon_seller') {
    const [, reportType = 'sales_overview', sellerId = 'all', marketplaceId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      seller_id: entity.seller_id || sellerId,
      marketplace_id: entity.marketplace_id || marketplaceId,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'tiktok_shop_seller') {
    const [, reportType = 'sales_overview', shopId = 'all', region = 'US'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      shop_id: entity.shop_id || shopId,
      region: entity.region || region,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'shopee_seller') {
    const [, reportType = 'sales_overview', shopId = 'all', region = 'VN'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      shop_id: entity.shop_id || shopId,
      region: entity.region || region,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'lazada_seller') {
    const [, reportType = 'sales_overview', sellerId = 'all', region = 'VN'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      seller_id: entity.seller_id || sellerId,
      region: entity.region || region,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_pii: false,
    };
  }
  if (provider === 'supabase') {
    const [, connectionIdFromId = '', kindFromId = '', pathFromId = ''] = entity.id.split(':');
    const dotIndex = pathFromId.lastIndexOf('.');
    const schemaFromId = dotIndex >= 0 ? pathFromId.slice(0, dotIndex) : '';
    const tableFromId = dotIndex >= 0 ? pathFromId.slice(dotIndex + 1) : '';
    const syncMode = entity.sync_mode || (kindFromId === 'profile' ? 'profile_only' : kindFromId === 'storage' || kindFromId === 'auth_users' ? 'app_profile' : 'bounded_table_snapshot');
    return {
      connection_id: entity.connection_id || connectionIdFromId,
      sync_mode: syncMode,
      schema: entity.schema_name || schemaFromId,
      table: entity.table_name || tableFromId,
      bucket: entity.bucket || (kindFromId === 'storage' ? pathFromId : 'all'),
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
    };
  }
  if (provider === 'warehouse') {
    const [connectionIdFromId, tablePath = ''] = entity.id.split(':');
    const dotIndex = tablePath.lastIndexOf('.');
    const schemaFromId = dotIndex >= 0 ? tablePath.slice(0, dotIndex) : '';
    const tableFromId = dotIndex >= 0 ? tablePath.slice(dotIndex + 1) : tablePath;
    const connectionId = entity.connection_id || connectionIdFromId;
    const schema = entity.schema_name || schemaFromId;
    const table = entity.table_name || tableFromId;
    return {
      connector_key: entity.connector_key || 'postgres',
      connection_id: connectionId,
      schema,
      table,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
    };
  }
  return { report_type: ['charges', 'subscriptions', 'customers'].includes(entity.id) ? entity.id : 'charges' };
}

function mergeEntities(
  existing: ConnectorSelectedEntity[],
  incoming: ConnectorSelectedEntity[]
): ConnectorSelectedEntity[] {
  const byId = new Map<string, ConnectorSelectedEntity>();
  existing.forEach((entity) => byId.set(`${entity.type || ''}:${entity.id}`, entity));
  incoming.forEach((entity) => byId.set(`${entity.type || ''}:${entity.id}`, entity));
  return Array.from(byId.values());
}

async function fetchProviderEntities(provider: ProviderKey): Promise<ConnectorSelectedEntity[]> {
  if (provider === 'ga4') {
    const response = await integrationService.fetchGoogleAnalyticsProperties();
    if (!response.success) throw new Error(response.error || 'Failed to load Google Analytics properties.');
    return response.accounts.flatMap((account) =>
      account.properties.map((property) => ({
        id: property.property_id,
        name: property.display_name || property.property_id,
        type: 'property',
        account_name: account.account_name,
      }))
    );
  }

  if (provider === 'meta_ads') {
    const response = await integrationService.fetchMetaAdAccounts();
    if (!response.success) throw new Error(response.error || 'Failed to load Meta ad accounts.');
    return response.ad_accounts.map((account) => ({
      id: account.id,
      name: account.name || account.id,
      type: 'account',
    }));
  }

  if (provider === 'tiktok') {
    const response = await integrationService.fetchTikTokAdAccounts();
    if (!response.success) throw new Error(response.error || 'Failed to load TikTok ad accounts.');
    return response.ad_accounts.map((account) => ({
      id: account.id,
      name: account.name || account.id,
      type: 'account',
    }));
  }

  if (provider === 'appsflyer') {
    const response = await integrationService.fetchAppsFlyerApps();
    if (!response.success) throw new Error(response.error || 'Failed to load AppsFlyer apps.');
    return response.apps.map((app) => ({
      id: app.app_id,
      name: app.app_name || app.app_id,
      type: 'app',
    }));
  }

  if (provider === 'warehouse') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load warehouse tables.');
    return response.connectors
      .filter((connector) => ['postgres', 'bigquery', 'snowflake', 'databricks'].includes(connector.connector_key))
      .flatMap((connector) => connector.selected_entities || []);
  }

  if (provider === 'hubspot') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load HubSpot reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'hubspot');
    return mergeEntities(connector?.selected_entities || [], HUBSPOT_REPORT_ENTITIES);
  }

  if (provider === 'salesforce') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Salesforce reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'salesforce');
    return mergeEntities(connector?.selected_entities || [], SALESFORCE_REPORT_ENTITIES);
  }

  if (provider === 'pipedrive') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Pipedrive reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'pipedrive');
    return mergeEntities(connector?.selected_entities || [], PIPEDRIVE_REPORT_ENTITIES);
  }

  if (provider === 'shopify') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Shopify reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'shopify');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getShopifyStatus();
    if (!status.connected || !status.shop_domain) return [];
    return buildShopifyReportEntities(status.shop_domain);
  }

  if (provider === 'klaviyo') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Klaviyo reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'klaviyo');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getKlaviyoStatus();
    if (!status.connected) return [];
    return buildKlaviyoReportEntities(status.account_id || 'all', status.account_name || 'Klaviyo');
  }

  if (provider === 'quickbooks') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load QuickBooks reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'quickbooks');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getQuickBooksStatus();
    if (!status.connected) return [];
    return buildQuickBooksReportEntities(status.realm_id || 'all', status.company_name || 'QuickBooks');
  }

  if (provider === 'zendesk') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Zendesk reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'zendesk');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getZendeskStatus();
    if (!status.connected) return [];
    return buildZendeskReportEntities(status.subdomain || 'all', status.account_name || 'Zendesk');
  }

  if (provider === 'mixpanel') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Mixpanel reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'mixpanel');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getMixpanelStatus();
    if (!status.connected) return [];
    return buildMixpanelReportEntities(status.project_id || 'all', status.account_name || 'Mixpanel', status.region || 'US');
  }

  if (provider === 'posthog') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load PostHog reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'posthog');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getPostHogStatus();
    if (!status.connected) return [];
    return buildPostHogReportEntities(status.project_id || 'all', status.account_name || 'PostHog', status.region || 'US', status.base_url || '');
  }

  if (provider === 'customer_io') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Customer.io reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'customer_io');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getCustomerIOStatus();
    if (!status.connected) return [];
    return buildCustomerIOReportEntities(status.workspace_id || 'all', status.account_name || 'Customer.io', status.region || 'US', status.api_base_url || '');
  }

  if (provider === 'google_search_console') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Google Search Console reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'google_search_console');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const resources = await integrationService.fetchGoogleSearchConsoleResources();
    if (!resources.success) throw new Error(resources.error || 'Failed to load Google Search Console properties.');
    return resources.sites.flatMap((site) =>
      buildGoogleSearchConsoleReportEntities(
        site.site_key,
        site.site_url,
        resources.account_name || 'Google Search Console',
        'web',
      )
    );
  }

  if (provider === 'amazon_seller') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Amazon Seller reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'amazon_seller');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getAmazonSellerStatus();
    if (!status.connected) return [];
    return buildAmazonSellerReportEntities(status.seller_id || 'all', status.seller_name || 'Amazon Seller', 'all');
  }

  if (provider === 'tiktok_shop_seller') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load TikTok Shop reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'tiktok_shop_seller');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getTikTokShopSellerStatus();
    if (!status.connected) return [];
    const defaultShopId = status.shops?.[0]?.id || 'all';
    return buildTikTokShopSellerReportEntities(defaultShopId, status.account_name || 'TikTok Shop Seller', status.region || 'US');
  }

  if (provider === 'shopee_seller') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Shopee Seller reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'shopee_seller');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getShopeeSellerStatus();
    if (!status.connected) return [];
    const defaultShopId = status.shops?.[0]?.id || 'all';
    return buildShopeeSellerReportEntities(defaultShopId, status.account_name || 'Shopee Seller', status.region || 'VN');
  }

  if (provider === 'lazada_seller') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Lazada Seller reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'lazada_seller');
    const existingEntities = connector?.selected_entities || [];
    if (existingEntities.length > 0) return existingEntities;
    const status = await integrationService.getLazadaSellerStatus();
    if (!status.connected) return [];
    const defaultSellerId = status.sellers?.[0]?.id || 'all';
    return buildLazadaSellerReportEntities(defaultSellerId, status.account_name || 'Lazada Seller', status.region || 'VN');
  }

  if (provider === 'supabase') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Supabase entities.');
    const connector = response.connectors.find((item) => item.connector_key === 'supabase');
    return connector?.selected_entities || [];
  }

  return STRIPE_REPORT_ENTITIES;
}

export function CreateScheduleModal({
  open,
  onClose,
  defaultProvider,
  defaultConnectorConfig = EMPTY_CONNECTOR_CONFIG,
  defaultAccountName = '',
  defaultEntityName = '',
  projectId,
  connectorOverview = EMPTY_CONNECTOR_OVERVIEW,
  projects = EMPTY_PROJECTS,
}: CreateScheduleModalProps) {
  const { createSchedule } = useScheduleStore();

  const [provider, setProvider] = useState<ProviderKey>(defaultProvider ?? 'ga4');
  const [modalConnectorOverview, setModalConnectorOverview] = useState<ConnectorOverviewItem[]>(connectorOverview);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [frequency, setFrequency] = useState<FrequencyKey>('daily');
  const [hourUtc, setHourUtc] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('last_30d');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [entityLoadingProvider, setEntityLoadingProvider] = useState<ProviderKey | null>(null);
  const [loadedEntityProviders, setLoadedEntityProviders] = useState<Partial<Record<ProviderKey, boolean>>>({});
  const [entityLoadErrors, setEntityLoadErrors] = useState<Partial<Record<ProviderKey, string>>>({});
  const [error, setError] = useState<string | null>(null);

  // Slack action
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackChannelId, setSlackChannelId] = useState('');

  // Auto-refresh
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshConvId, setAutoRefreshConvId] = useState('');
  const DEFAULT_AUTO_REFRESH_PROMPT = 'Refresh this dashboard with the latest synced data.';

  const showDayPicker = frequency === 'weekly' || frequency === 'biweekly';
  const hasDefaultConnectorConfig = Object.keys(defaultConnectorConfig).length > 0;

  const sourceOptions = useMemo(() => {
    const grouped = new Map<ProviderKey, {
      connectorKey: string;
      provider: ProviderKey;
      label: string;
      entities: ConnectorSelectedEntity[];
    }>();

    modalConnectorOverview.forEach((connector) => {
      const mappedProvider = CONNECTOR_TO_PROVIDER[connector.connector_key];
      if (!mappedProvider || !connector.connected) return;
      const connectorEntities = connector.selected_entities || [];
      const shopDomain =
        String(connector.account_name || '').includes('.myshopify.com')
          ? String(connector.account_name)
          : '';
      const klaviyoAccountId = connector.selected_entities?.[0]?.account_id || 'all';
      const quickBooksRealmId = connector.selected_entities?.[0]?.realm_id || 'all';
      const zendeskSubdomain = connector.selected_entities?.[0]?.subdomain || 'all';
      const mixpanelProjectId = connector.selected_entities?.[0]?.project_id || connector.selected_entities?.[0]?.account_id || 'all';
      const mixpanelRegion = connector.selected_entities?.[0]?.region || 'US';
      const postHogProjectId = connector.selected_entities?.[0]?.project_id || connector.selected_entities?.[0]?.account_id || 'all';
      const postHogRegion = connector.selected_entities?.[0]?.region || 'US';
      const postHogBaseUrl = connector.selected_entities?.[0]?.base_url || '';
      const customerIOWorkspaceId = connector.selected_entities?.[0]?.workspace_id || connector.selected_entities?.[0]?.account_id || 'all';
      const customerIORegion = connector.selected_entities?.[0]?.region || 'US';
      const customerIOBaseUrl = connector.selected_entities?.[0]?.base_url || '';
      const googleSearchConsoleSiteKey = connector.selected_entities?.[0]?.site_key || '';
      const googleSearchConsoleSiteUrl = connector.selected_entities?.[0]?.site_url || '';
      const googleSearchConsoleSearchType = connector.selected_entities?.[0]?.search_type || 'web';
      const amazonSellerId = connector.selected_entities?.[0]?.seller_id || 'all';
      const tiktokShopId = connector.selected_entities?.[0]?.shop_id || 'all';
      const tiktokShopRegion = connector.selected_entities?.[0]?.region || 'US';
      const shopeeShopId = connector.selected_entities?.[0]?.shop_id || 'all';
      const shopeeRegion = connector.selected_entities?.[0]?.region || 'VN';
      const lazadaSellerId = connector.selected_entities?.[0]?.seller_id || 'all';
      const lazadaRegion = connector.selected_entities?.[0]?.region || 'VN';
      const entities = connector.connector_key === 'stripe' && connectorEntities.length === 0
        ? STRIPE_REPORT_ENTITIES
        : connector.connector_key === 'hubspot' && connectorEntities.length === 0
          ? HUBSPOT_REPORT_ENTITIES
          : connector.connector_key === 'salesforce' && connectorEntities.length === 0
            ? SALESFORCE_REPORT_ENTITIES
            : connector.connector_key === 'pipedrive' && connectorEntities.length === 0
              ? PIPEDRIVE_REPORT_ENTITIES
              : connector.connector_key === 'shopify' && connectorEntities.length === 0
                ? buildShopifyReportEntities(shopDomain)
                : connector.connector_key === 'klaviyo' && connectorEntities.length === 0
                  ? buildKlaviyoReportEntities(String(klaviyoAccountId), connector.account_name || 'Klaviyo')
                  : connector.connector_key === 'quickbooks' && connectorEntities.length === 0
                    ? buildQuickBooksReportEntities(String(quickBooksRealmId), connector.account_name || 'QuickBooks')
                    : connector.connector_key === 'zendesk' && connectorEntities.length === 0
                      ? buildZendeskReportEntities(String(zendeskSubdomain), connector.account_name || 'Zendesk')
                      : connector.connector_key === 'mixpanel' && connectorEntities.length === 0
                        ? buildMixpanelReportEntities(String(mixpanelProjectId), connector.account_name || 'Mixpanel', String(mixpanelRegion))
                        : connector.connector_key === 'posthog' && connectorEntities.length === 0
                          ? buildPostHogReportEntities(String(postHogProjectId), connector.account_name || 'PostHog', String(postHogRegion), String(postHogBaseUrl))
                          : connector.connector_key === 'customer_io' && connectorEntities.length === 0
                            ? buildCustomerIOReportEntities(String(customerIOWorkspaceId), connector.account_name || 'Customer.io', String(customerIORegion), String(customerIOBaseUrl))
                            : connector.connector_key === 'google_search_console' && connectorEntities.length === 0
                              ? buildGoogleSearchConsoleReportEntities(String(googleSearchConsoleSiteKey), String(googleSearchConsoleSiteUrl), connector.account_name || 'Google Search Console', String(googleSearchConsoleSearchType))
                              : connector.connector_key === 'amazon_seller' && connectorEntities.length === 0
                                ? buildAmazonSellerReportEntities(String(amazonSellerId), connector.account_name || 'Amazon Seller')
                                : connector.connector_key === 'tiktok_shop_seller' && connectorEntities.length === 0
                                  ? buildTikTokShopSellerReportEntities(String(tiktokShopId), connector.account_name || 'TikTok Shop Seller', String(tiktokShopRegion))
                                  : connector.connector_key === 'shopee_seller' && connectorEntities.length === 0
                                    ? buildShopeeSellerReportEntities(String(shopeeShopId), connector.account_name || 'Shopee Seller', String(shopeeRegion))
                                    : connector.connector_key === 'lazada_seller' && connectorEntities.length === 0
                                      ? buildLazadaSellerReportEntities(String(lazadaSellerId), connector.account_name || 'Lazada Seller', String(lazadaRegion))
                                      : connectorEntities;

      if (mappedProvider === 'warehouse') {
        const current = grouped.get('warehouse') || {
          connectorKey: 'warehouse',
          provider: 'warehouse',
          label: 'Warehouse',
          entities: [],
        };
        current.entities = mergeEntities(current.entities, entities);
        grouped.set('warehouse', current);
        return;
      }

      grouped.set(mappedProvider, {
        connectorKey: connector.connector_key,
        provider: mappedProvider,
        label: connector.display_name,
        entities,
      });
    });

    return Array.from(grouped.values());
  }, [modalConnectorOverview]);

  const selectedSource = sourceOptions.find((source) => source.provider === provider);
  const selectedEntity = selectedSource?.entities.find((entity) => entity.id === selectedEntityId);
  const projectOptions = useMemo(
    () => projects.length > 0
      ? projects
      : projectId
        ? [{ id: projectId, title: 'Current project' }]
        : [],
    [projectId, projects]
  );

  useEffect(() => {
    setModalConnectorOverview(connectorOverview);
  }, [connectorOverview]);

  useEffect(() => {
    if (!open) return;
    setLoadedEntityProviders({});
    setEntityLoadErrors({});
    setEntityLoadingProvider(null);
  }, [open]);

  useEffect(() => {
    if (!open || hasDefaultConnectorConfig) return;
    let cancelled = false;

    setIsLoadingSources(true);
    integrationService.fetchConnectorsOverview()
      .then((response) => {
        if (cancelled) return;
        if (response.success) {
          setModalConnectorOverview(response.connectors);
          return;
        }
        setError(response.error || 'Failed to load connected data sources.');
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load connected data sources.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSources(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, hasDefaultConnectorConfig]);

  useEffect(() => {
    if (!open) return;
    const initialProvider = defaultProvider ?? sourceOptions[0]?.provider ?? 'ga4';
    const initialSource = sourceOptions.find((source) => source.provider === initialProvider);
    const defaultEntityId = getEntityIdFromConfig(initialProvider, defaultConnectorConfig);

    setProvider(initialProvider);
    setSelectedEntityId(defaultEntityId || initialSource?.entities[0]?.id || '');
    setSelectedProjectId(projectId || projectOptions[0]?.id || '');
    setError(null);
  }, [open, defaultProvider, defaultConnectorConfig, projectId, projectOptions, sourceOptions]);

  useEffect(() => {
    if (!open || hasDefaultConnectorConfig) return;
    const source = selectedSource;
    if (!source || source.entities.length > 0 || loadedEntityProviders[provider]) return;

    let cancelled = false;
    setEntityLoadingProvider(provider);
    setEntityLoadErrors((prev) => ({ ...prev, [provider]: undefined }));

    fetchProviderEntities(provider)
      .then((entities) => {
        if (cancelled) return;
        setLoadedEntityProviders((prev) => ({ ...prev, [provider]: true }));
        if (entities.length === 0) return;

        const connectorKey = PROVIDER_TO_CONNECTOR[provider];
        setModalConnectorOverview((prev) => {
          if (provider === 'warehouse') {
            return prev.map((connector) => {
              if (!['postgres', 'bigquery', 'snowflake', 'databricks'].includes(connector.connector_key)) return connector;
              const connectorEntities = entities.filter((entity) =>
                String(entity.connector_key || 'postgres') === connector.connector_key
              );
              return {
                ...connector,
                selected_entities: mergeEntities(connector.selected_entities || [], connectorEntities),
              };
            });
          }
          return prev.map((connector) =>
            connector.connector_key === connectorKey
              ? { ...connector, selected_entities: mergeEntities(connector.selected_entities || [], entities) }
              : connector
          );
        });
        setSelectedEntityId((current) => current || entities[0]?.id || '');
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadedEntityProviders((prev) => ({ ...prev, [provider]: true }));
          setEntityLoadErrors((prev) => ({
            ...prev,
            [provider]: err instanceof Error ? err.message : 'Failed to load accounts for this connector.',
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setEntityLoadingProvider(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, hasDefaultConnectorConfig, selectedSource, loadedEntityProviders, provider]);

  const handleProviderChange = (value: string) => {
    const nextProvider = value as ProviderKey;
    const nextSource = sourceOptions.find((source) => source.provider === nextProvider);
    setProvider(nextProvider);
    setSelectedEntityId(nextSource?.entities[0]?.id || '');
  };

  const handleSubmit = async () => {
    setError(null);
    if (slackEnabled && !slackChannelId.trim()) {
      setError('Please enter a Slack channel ID to enable the Slack action.');
      return;
    }
    if (autoRefreshEnabled && !autoRefreshConvId.trim()) {
      setError('Please enter a conversation ID to enable auto-refresh.');
      return;
    }
    const resolvedProjectId = selectedProjectId || projectId;
    if (!resolvedProjectId) {
      setError('Please choose a destination project before creating a schedule.');
      return;
    }
    if (!hasDefaultConnectorConfig && !selectedEntity) {
      setError('Please choose a connected account or entity before creating a schedule.');
      return;
    }
    setIsSubmitting(true);
    try {
      const connectorConfig = hasDefaultConnectorConfig
        ? defaultConnectorConfig
        : buildConnectorConfig(provider, selectedEntity as ConnectorSelectedEntity);
      const accountName = defaultAccountName
        || selectedEntity?.account_name
        || selectedEntity?.name
        || PROVIDER_LABELS[provider];
      const req: CreateScheduleRequest = {
        provider,
        connector_config: connectorConfig,
        project_id: resolvedProjectId,
        account_name: accountName,
        frequency,
        hour_utc: hourUtc,
        day_of_week: dayOfWeek,
        date_range_preset: datePreset,
        on_complete_actions: slackEnabled && slackChannelId.trim()
          ? [{ type: 'slack', channel_id: slackChannelId.trim() }]
          : undefined,
        auto_refresh_conversation_id: autoRefreshEnabled && autoRefreshConvId.trim()
          ? autoRefreshConvId.trim()
          : undefined,
        auto_refresh_prompt: autoRefreshEnabled ? DEFAULT_AUTO_REFRESH_PROMPT : undefined,
      };
      await createSchedule(req);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule Automatic Sync</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider */}
          <div className="space-y-1.5">
            <Label>Connector</Label>
            <Select
              value={provider}
              onValueChange={handleProviderChange}
              disabled={!!defaultProvider || hasDefaultConnectorConfig || isLoadingSources || sourceOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingSources ? 'Loading connectors...' : 'Choose a connector'} />
              </SelectTrigger>
              <SelectContent className="z-[201]">
                {(hasDefaultConnectorConfig
                  ? [{ provider, label: PROVIDER_LABELS[provider] }]
                  : sourceOptions
                ).map((source) => (
                  <SelectItem key={source.provider} value={source.provider}>{source.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!hasDefaultConnectorConfig && !isLoadingSources && sourceOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Connect a supported data source before creating an automatic schedule.
              </p>
            )}
          </div>

          {/* Entity */}
          <div className="space-y-1.5">
            <Label>Account / Entity</Label>
            {hasDefaultConnectorConfig ? (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                {defaultEntityName || defaultAccountName || getEntityIdFromConfig(provider, defaultConnectorConfig) || PROVIDER_LABELS[provider]}
              </div>
            ) : (
              <Select
                value={selectedEntityId}
                onValueChange={setSelectedEntityId}
                disabled={!selectedSource || entityLoadingProvider === provider || selectedSource.entities.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={entityLoadingProvider === provider ? 'Loading accounts...' : 'Choose an entity'} />
                </SelectTrigger>
                <SelectContent className="z-[201]">
                  {(selectedSource?.entities || []).map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.name || entity.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!hasDefaultConnectorConfig && selectedSource && entityLoadingProvider !== provider && selectedSource.entities.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No account or entity is available for this connector yet.
              </p>
            )}
            {!hasDefaultConnectorConfig && entityLoadErrors[provider] && (
              <p className="text-xs text-destructive">{entityLoadErrors[provider]}</p>
            )}
          </div>

          {/* Project */}
          <div className="space-y-1.5">
            <Label>Destination Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={projectOptions.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent className="z-[201]">
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projectOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">Create a project before scheduling automatic syncs.</p>
            )}
          </div>

          {/* Frequency */}
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as FrequencyKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="z-[201]">
                {FREQUENCY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time */}
          <div className="space-y-1.5">
            <Label>Time (UTC)</Label>
            <Select value={String(hourUtc)} onValueChange={(v) => setHourUtc(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="z-[201]">
                {HOUR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Day of week */}
          {showDayPicker && (
            <div className="space-y-1.5">
              <Label>Day of Week</Label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="z-[201]">
                  {DOW_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date range */}
          <div className="space-y-1.5">
            <Label>Data Window</Label>
            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DateRangePreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="z-[201]">
                {DATE_PRESET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Each sync will pull this rolling window of data.
            </p>
          </div>

          {/* Slack action */}
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Post to Slack after sync</p>
                <p className="text-xs text-muted-foreground">
                  Automatically analyze data and post a summary to a Slack channel
                </p>
              </div>
              <Switch
                checked={slackEnabled}
                onCheckedChange={setSlackEnabled}
              />
            </div>
            {slackEnabled && (
              <div className="space-y-1.5">
                <Label>Slack Channel ID</Label>
                <Input
                  placeholder="e.g. C1234567890"
                  value={slackChannelId}
                  onChange={(e) => setSlackChannelId(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Find the channel ID in Slack: right-click channel → View channel details → scroll to bottom.
                </p>
              </div>
            )}
          </div>

          {/* Auto-refresh */}
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Auto-refresh dashboard</p>
                <p className="text-xs text-muted-foreground">
                  Re-run analysis on an existing conversation after each sync
                </p>
              </div>
              <Switch
                checked={autoRefreshEnabled}
                onCheckedChange={setAutoRefreshEnabled}
              />
            </div>
            {autoRefreshEnabled && (
              <div className="space-y-1.5">
                <Label>Conversation ID</Label>
                <Input
                  placeholder="Paste conversation UUID"
                  value={autoRefreshConvId}
                  onChange={(e) => setAutoRefreshConvId(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Find this in the project URL or from the Dreamify API.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
