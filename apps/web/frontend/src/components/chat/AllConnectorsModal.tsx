import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, Plug } from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import { CONNECTORS, CONNECTOR_CATEGORIES } from '@/constants/connectors';
import { useChatStore } from '@/chat/useChatStore';
import { integrationService } from '@/services/integrationService';

interface ConnectorStatus {
  connected: boolean;
  info?: string;
}

const ACTIVE_CONNECTORS = CONNECTORS.filter((c) => c.isActive);

export default function AllConnectorsModal() {
  const { user } = useUser();
  const {
    isAllConnectorsModalOpen: isOpen,
    setAllConnectorsModalOpen: setOpen,
    setGA4ModalOpen,
    setGoogleSheetsModalOpen,
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
    setStripeModalOpen,
    setHubSpotModalOpen,
    setSalesforceModalOpen,
    setPipedriveModalOpen,
    setSupabaseModalOpen,
    setShopifyModalOpen,
    setKlaviyoModalOpen,
    setQuickBooksModalOpen,
    setZendeskModalOpen,
    setMixpanelModalOpen,
    setPostHogModalOpen,
    setCustomerIOModalOpen,
    setGoogleSearchConsoleModalOpen,
    setAmazonSellerModalOpen,
    setTikTokShopSellerModalOpen,
    setShopeeSellerModalOpen,
    setLazadaSellerModalOpen,
    setGoogleAdsModalOpen,
    setFirebaseModalOpen,
    setWarehouseModalOpen,
  } = useChatStore();

  const [connectorStatus, setConnectorStatus] = useState<Record<string, ConnectorStatus>>({});
  const [loading, setLoading] = useState(false);

  const fetchStatuses = useCallback(async () => {
    setLoading(true);
    try {
      const results: Record<string, ConnectorStatus> = {};

      const metaStatus = await integrationService.getMetaConnectionStatus();
      if (metaStatus.connected) {
        try {
          const metaAccounts = await integrationService.fetchMetaAdAccounts();
          const first = metaAccounts.ad_accounts?.[0];
          results['Meta Ads'] = { connected: true, info: first ? first.name : 'Meta Ads' };
        } catch {
          results['Meta Ads'] = { connected: true, info: 'Meta Ads' };
        }
      } else {
        results['Meta Ads'] = { connected: false };
      }

      const tiktokStatus = await integrationService.getTikTokConnectionStatus();
      if (tiktokStatus.connected) {
        try {
          const ttAccounts = await integrationService.fetchTikTokAdAccounts();
          const first = ttAccounts.ad_accounts?.[0];
          results['TikTok Ads'] = { connected: true, info: first ? first.name : 'TikTok Ads' };
        } catch {
          results['TikTok Ads'] = { connected: true, info: 'TikTok Ads' };
        }
      } else {
        results['TikTok Ads'] = { connected: false };
      }

      const googleToken = await integrationService.getGoogleOAuthToken();
      if (googleToken.success && googleToken.token) {
        const googleEmail =
          user?.externalAccounts?.find((a) => (a.provider as string).includes('google'))?.emailAddress;
        const info = googleEmail ?? 'Google Account';
        results['GA4'] = { connected: true, info };
        results['Google Sheets'] = { connected: true, info };
        results['Google Ads'] = { connected: true, info };
        results['Firebase'] = { connected: true, info };
      } else {
        results['GA4'] = { connected: false };
        results['Google Sheets'] = { connected: false };
        results['Google Ads'] = { connected: false };
        results['Firebase'] = { connected: false };
      }

      const appsflyerStatus = await integrationService.getAppsFlyerStatus();
      results['AppsFlyer'] = appsflyerStatus.connected
        ? { connected: true, info: 'AppsFlyer' }
        : { connected: false };

      const stripeStatus = await integrationService.getStripeStatus();
      results['Stripe'] = stripeStatus.connected
        ? { connected: true, info: 'Stripe' }
        : { connected: false };

      const hubspotStatus = await integrationService.getHubSpotStatus();
      results['HubSpot'] = hubspotStatus.connected
        ? { connected: true, info: hubspotStatus.portal_domain || hubspotStatus.account_name || 'HubSpot' }
        : { connected: false };

      const salesforceStatus = await integrationService.getSalesforceStatus();
      results['Salesforce'] = salesforceStatus.connected
        ? { connected: true, info: salesforceStatus.account_name || salesforceStatus.instance_domain || 'Salesforce' }
        : { connected: false };

      const pipedriveStatus = await integrationService.getPipedriveStatus();
      results['Pipedrive'] = pipedriveStatus.connected
        ? { connected: true, info: pipedriveStatus.account_name || pipedriveStatus.company_domain || 'Pipedrive' }
        : { connected: false };

      const supabaseStatus = await integrationService.getSupabaseStatus();
      results['Supabase'] = supabaseStatus.connected
        ? { connected: true, info: `${supabaseStatus.connection_count || 0} connection${supabaseStatus.connection_count === 1 ? '' : 's'}` }
        : { connected: false };

      const shopifyStatus = await integrationService.getShopifyStatus();
      results['Shopify'] = shopifyStatus.connected
        ? { connected: true, info: shopifyStatus.shop_domain || shopifyStatus.shop_name || 'Shopify' }
        : { connected: false };

      const klaviyoStatus = await integrationService.getKlaviyoStatus();
      results['Klaviyo'] = klaviyoStatus.connected
        ? { connected: true, info: klaviyoStatus.account_name || klaviyoStatus.account_id || 'Klaviyo' }
        : { connected: false };

      const quickBooksStatus = await integrationService.getQuickBooksStatus();
      results['QuickBooks'] = quickBooksStatus.connected
        ? { connected: true, info: quickBooksStatus.company_name || quickBooksStatus.realm_id || 'QuickBooks' }
        : { connected: false };

      const zendeskStatus = await integrationService.getZendeskStatus();
      results['Zendesk'] = zendeskStatus.connected
        ? { connected: true, info: zendeskStatus.account_name || zendeskStatus.subdomain || 'Zendesk' }
        : { connected: false };

      const mixpanelStatus = await integrationService.getMixpanelStatus();
      results['Mixpanel'] = mixpanelStatus.connected
        ? { connected: true, info: mixpanelStatus.account_name || mixpanelStatus.project_id || 'Mixpanel' }
        : { connected: false };

      const postHogStatus = await integrationService.getPostHogStatus();
      results['PostHog'] = postHogStatus.connected
        ? { connected: true, info: postHogStatus.account_name || postHogStatus.project_id || 'PostHog' }
        : { connected: false };

      const customerIOStatus = await integrationService.getCustomerIOStatus();
      results['Customer.io'] = customerIOStatus.connected
        ? { connected: true, info: customerIOStatus.account_name || customerIOStatus.workspace_id || 'Customer.io' }
        : { connected: false };

      const googleSearchConsoleStatus = await integrationService.getGoogleSearchConsoleStatus();
      results['Google Search Console'] = googleSearchConsoleStatus.connected
        ? { connected: true, info: googleSearchConsoleStatus.account_name || `${googleSearchConsoleStatus.site_count || 0} propert${googleSearchConsoleStatus.site_count === 1 ? 'y' : 'ies'}` }
        : { connected: false };

      const amazonSellerStatus = await integrationService.getAmazonSellerStatus();
      results['Amazon Seller'] = amazonSellerStatus.connected
        ? { connected: true, info: amazonSellerStatus.seller_name || amazonSellerStatus.seller_id || 'Amazon Seller' }
        : { connected: false };

      const tiktokShopStatus = await integrationService.getTikTokShopSellerStatus();
      results['TikTok Shop Seller'] = tiktokShopStatus.connected
        ? { connected: true, info: tiktokShopStatus.account_name || tiktokShopStatus.account_id || 'TikTok Shop Seller' }
        : { connected: false };

      const shopeeSellerStatus = await integrationService.getShopeeSellerStatus();
      results['Shopee Seller'] = shopeeSellerStatus.connected
        ? { connected: true, info: shopeeSellerStatus.account_name || shopeeSellerStatus.account_id || 'Shopee Seller' }
        : { connected: false };

      const lazadaSellerStatus = await integrationService.getLazadaSellerStatus();
      results['Lazada Seller'] = lazadaSellerStatus.connected
        ? { connected: true, info: lazadaSellerStatus.account_name || lazadaSellerStatus.account_id || 'Lazada Seller' }
        : { connected: false };

      const overview = await integrationService.fetchConnectorsOverview();
      if (overview.success) {
        const postgres = overview.connectors.find((connector) => connector.connector_key === 'postgres');
        const bigquery = overview.connectors.find((connector) => connector.connector_key === 'bigquery');
        const snowflake = overview.connectors.find((connector) => connector.connector_key === 'snowflake');
        const databricks = overview.connectors.find((connector) => connector.connector_key === 'databricks');
        const supabase = overview.connectors.find((connector) => connector.connector_key === 'supabase');
        const shopify = overview.connectors.find((connector) => connector.connector_key === 'shopify');
        const klaviyo = overview.connectors.find((connector) => connector.connector_key === 'klaviyo');
        const quickBooks = overview.connectors.find((connector) => connector.connector_key === 'quickbooks');
        const zendesk = overview.connectors.find((connector) => connector.connector_key === 'zendesk');
        const mixpanel = overview.connectors.find((connector) => connector.connector_key === 'mixpanel');
        const posthog = overview.connectors.find((connector) => connector.connector_key === 'posthog');
        const customerIO = overview.connectors.find((connector) => connector.connector_key === 'customer_io');
        const googleSearchConsole = overview.connectors.find((connector) => connector.connector_key === 'google_search_console');
        const amazonSeller = overview.connectors.find((connector) => connector.connector_key === 'amazon_seller');
        const tiktokShopSeller = overview.connectors.find((connector) => connector.connector_key === 'tiktok_shop_seller');
        const shopeeSeller = overview.connectors.find((connector) => connector.connector_key === 'shopee_seller');
        const lazadaSeller = overview.connectors.find((connector) => connector.connector_key === 'lazada_seller');
        if (postgres?.connected) {
          const tableCount = postgres.selected_entities?.length || 0;
          results['PostgreSQL'] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? '' : 's'}` : 'PostgreSQL',
          };
        } else {
          results['PostgreSQL'] = { connected: false };
        }
        if (bigquery?.connected) {
          const tableCount = bigquery.selected_entities?.length || 0;
          results['BigQuery'] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? '' : 's'}` : 'BigQuery',
          };
        } else {
          results['BigQuery'] = { connected: false };
        }
        if (snowflake?.connected) {
          const tableCount = snowflake.selected_entities?.length || 0;
          results['Snowflake'] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? '' : 's'}` : 'Snowflake',
          };
        } else {
          results['Snowflake'] = { connected: false };
        }
        if (databricks?.connected) {
          const tableCount = databricks.selected_entities?.length || 0;
          results['Databricks'] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? '' : 's'}` : 'Databricks',
          };
        } else {
          results['Databricks'] = { connected: false };
        }
        if (supabase?.connected) {
          const entityCount = supabase.selected_entities?.length || 0;
          results['Supabase'] = {
            connected: true,
            info: entityCount > 0 ? `${entityCount} item${entityCount === 1 ? '' : 's'}` : results['Supabase']?.info || 'Supabase',
          };
        }
        if (shopify?.connected) {
          const reportCount = shopify.selected_entities?.length || 0;
          results['Shopify'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Shopify']?.info || 'Shopify',
          };
        }
        if (klaviyo?.connected) {
          const reportCount = klaviyo.selected_entities?.length || 0;
          results['Klaviyo'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Klaviyo']?.info || 'Klaviyo',
          };
        }
        if (quickBooks?.connected) {
          const reportCount = quickBooks.selected_entities?.length || 0;
          results['QuickBooks'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['QuickBooks']?.info || 'QuickBooks',
          };
        }
        if (zendesk?.connected) {
          const reportCount = zendesk.selected_entities?.length || 0;
          results['Zendesk'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Zendesk']?.info || 'Zendesk',
          };
        }
        if (mixpanel?.connected) {
          const reportCount = mixpanel.selected_entities?.length || 0;
          results['Mixpanel'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Mixpanel']?.info || 'Mixpanel',
          };
        }
        if (posthog?.connected) {
          const reportCount = posthog.selected_entities?.length || 0;
          results['PostHog'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['PostHog']?.info || 'PostHog',
          };
        }
        if (customerIO?.connected) {
          const reportCount = customerIO.selected_entities?.length || 0;
          results['Customer.io'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Customer.io']?.info || 'Customer.io',
          };
        }
        if (googleSearchConsole?.connected) {
          const reportCount = googleSearchConsole.selected_entities?.length || 0;
          results['Google Search Console'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Google Search Console']?.info || 'Google Search Console',
          };
        }
        if (amazonSeller?.connected) {
          const reportCount = amazonSeller.selected_entities?.length || 0;
          results['Amazon Seller'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Amazon Seller']?.info || 'Amazon Seller',
          };
        }
        if (tiktokShopSeller?.connected) {
          const reportCount = tiktokShopSeller.selected_entities?.length || 0;
          results['TikTok Shop Seller'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['TikTok Shop Seller']?.info || 'TikTok Shop Seller',
          };
        }
        if (shopeeSeller?.connected) {
          const reportCount = shopeeSeller.selected_entities?.length || 0;
          results['Shopee Seller'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Shopee Seller']?.info || 'Shopee Seller',
          };
        }
        if (lazadaSeller?.connected) {
          const reportCount = lazadaSeller.selected_entities?.length || 0;
          results['Lazada Seller'] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : results['Lazada Seller']?.info || 'Lazada Seller',
          };
        }
      }

      setConnectorStatus(results);
    } catch (e) {
      console.error('AllConnectorsModal: failed to fetch statuses', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen) fetchStatuses();
  }, [isOpen, fetchStatuses]);

  const handleConnectorClick = (connectorName: string) => {
    setOpen(false);
    setTimeout(() => {
      if (connectorName === 'GA4') setGA4ModalOpen(true);
      else if (connectorName === 'Google Sheets') setGoogleSheetsModalOpen(true);
      else if (connectorName === 'Meta Ads') setMetaAdsModalOpen(true);
      else if (connectorName === 'TikTok Ads') setTikTokModalOpen(true);
      else if (connectorName === 'AppsFlyer') setAppsFlyerModalOpen(true);
      else if (connectorName === 'Stripe') setStripeModalOpen(true);
      else if (connectorName === 'HubSpot') setHubSpotModalOpen(true);
      else if (connectorName === 'Salesforce') setSalesforceModalOpen(true);
      else if (connectorName === 'Pipedrive') setPipedriveModalOpen(true);
      else if (connectorName === 'Supabase') setSupabaseModalOpen(true);
      else if (connectorName === 'Shopify') setShopifyModalOpen(true);
      else if (connectorName === 'Klaviyo') setKlaviyoModalOpen(true);
      else if (connectorName === 'QuickBooks') setQuickBooksModalOpen(true);
      else if (connectorName === 'Zendesk') setZendeskModalOpen(true);
      else if (connectorName === 'Mixpanel') setMixpanelModalOpen(true);
      else if (connectorName === 'PostHog') setPostHogModalOpen(true);
      else if (connectorName === 'Customer.io') setCustomerIOModalOpen(true);
      else if (connectorName === 'Google Search Console') setGoogleSearchConsoleModalOpen(true);
      else if (connectorName === 'Amazon Seller') setAmazonSellerModalOpen(true);
      else if (connectorName === 'TikTok Shop Seller') setTikTokShopSellerModalOpen(true);
      else if (connectorName === 'Shopee Seller') setShopeeSellerModalOpen(true);
      else if (connectorName === 'Lazada Seller') setLazadaSellerModalOpen(true);
      else if (connectorName === 'Google Ads') setGoogleAdsModalOpen(true);
      else if (connectorName === 'Firebase') setFirebaseModalOpen(true);
      else if (connectorName === 'PostgreSQL') setWarehouseModalOpen(true, 'postgres');
      else if (connectorName === 'BigQuery') setWarehouseModalOpen(true, 'bigquery');
      else if (connectorName === 'Snowflake') setWarehouseModalOpen(true, 'snowflake');
      else if (connectorName === 'Databricks') setWarehouseModalOpen(true, 'databricks');
    }, 0);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Plug className="w-4 h-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Connect a data source</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Select a platform to connect and start analyzing your data.</p>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">
          {CONNECTOR_CATEGORIES.map((category) => {
            const categoryConnectors = ACTIVE_CONNECTORS.filter((c) => c.category === category);
            if (categoryConnectors.length === 0) return null;

            return (
              <div key={category}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3">
                  {category}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {categoryConnectors.map((connector) => {
                    const status = connectorStatus[connector.name];
                    const isConnected = !loading && (status?.connected ?? false);

                    return (
                      <button
                        key={connector.name}
                        onClick={() => handleConnectorClick(connector.name)}
                        className={`
                          group flex items-center gap-3 w-full text-left
                          px-3.5 py-3 rounded-xl border transition-all duration-150
                          ${isConnected
                            ? 'border-emerald-500/25 bg-emerald-500/5 hover:border-emerald-500/40 hover:bg-emerald-500/10'
                            : 'border-border bg-muted/40 hover:border-border/80 hover:bg-muted/70'
                          }
                        `}
                      >
                        {/* Icon */}
                        <div className={`
                          w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors
                          ${isConnected ? 'bg-emerald-500/10' : 'bg-foreground/5 group-hover:bg-foreground/10'}
                        `}>
                          <img
                            src={connector.icon}
                            alt={connector.name}
                            className="w-5 h-5 object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground leading-tight">{connector.name}</p>
                          {loading ? (
                            <p className="text-xs text-muted-foreground/60 mt-0.5">Checking…</p>
                          ) : isConnected ? (
                            <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-0.5 truncate">{status?.info}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground mt-0.5">Not connected</p>
                          )}
                        </div>

                        {/* Right indicator */}
                        {isConnected ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <span className="text-xs text-muted-foreground border border-border rounded-md px-2.5 py-1 flex-shrink-0 group-hover:border-foreground/30 group-hover:text-foreground/80 transition-colors">
                            Connect
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
