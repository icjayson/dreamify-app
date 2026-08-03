import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CalendarDays, Loader2, ShieldAlert } from 'lucide-react';
import {
  integrationService,
  type ShopifyConnectionStatusResponse,
  type ShopifyResource,
} from '@/services/integrationService';
import { useChatStore } from '@/chat/useChatStore';
import { fileService, type AssetRecord } from '@/services/fileService';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';
import { connectorModalStyles as modalStyles } from './connectorModalStyles';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

const FALLBACK_RESOURCES: ShopifyResource[] = [
  { report_type: 'sales_overview', label: 'Sales Overview', resource: 'orders', default: true },
  { report_type: 'orders', label: 'Orders', resource: 'orders' },
  { report_type: 'products', label: 'Products', resource: 'products' },
  { report_type: 'customers', label: 'Customers', resource: 'customers' },
  { report_type: 'inventory', label: 'Inventory', resource: 'inventory' },
  { report_type: 'discounts', label: 'Discounts', resource: 'discounts' },
];

type ModalState = 'checking' | 'disconnected' | 'connected';

type ConnectedAssetRun = {
  asset_id?: string;
  asset_filename?: string;
  connectorKey?: string;
  entityId?: string;
  entityName?: string;
  accountName?: string;
  project_id?: string;
  config_snapshot?: { size_bytes?: number };
  sync_version_name?: string;
  version_name?: string;
};

const normalizeShopInput = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  const host = trimmed.replace(/^https?:\/\//, '').split('/')[0];
  return host.includes('.') ? host : `${host}.myshopify.com`;
};

export default function ShopifyIntegrationModal() {
  const {
    isShopifyModalOpen: isOpen,
    setShopifyModalOpen: setOpen,
    currentProjectId,
    syncShopify,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<ShopifyConnectionStatusResponse | null>(null);
  const [resources, setResources] = useState<ShopifyResource[]>(FALLBACK_RESOURCES);
  const [shopDomain, setShopDomain] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState('sales_overview');
  const [rowLimit, setRowLimit] = useState(5000);
  const [maxBytesMb, setMaxBytesMb] = useState(10);
  const [includePii, setIncludePii] = useState(false);
  const [datePreset, setDatePreset] = useState('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');
  const [emptyRowsDialog, setEmptyRowsDialog] = useState<{
    asset: AssetRecord;
    reportLabel: string;
    columnCount: number;
  } | null>(null);
  const [discardingEmpty, setDiscardingEmpty] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const selectedResource = useMemo(
    () => resources.find((resource) => resource.report_type === reportType) || FALLBACK_RESOURCES[0],
    [reportType, resources]
  );
  const isCustomRange = datePreset === 'custom';
  const needsReadAllOrdersWarning =
    !connectionStatus?.read_all_orders_enabled &&
    ['sales_overview', 'orders'].includes(reportType) &&
    (datePreset === 'last_90d' || isCustomRange);

  const onClose = () => setOpen(false);

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setResources(FALLBACK_RESOURCES);
    setShopDomain('');
    setConnecting(false);
    setDisconnecting(false);
    setLoadingResources(false);
    setSyncing(false);
    setError(null);
    setReportType('sales_overview');
    setRowLimit(5000);
    setMaxBytesMb(10);
    setIncludePii(false);
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setActiveTab('new');
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
  }, []);

  const loadResources = useCallback(async () => {
    setLoadingResources(true);
    try {
      const response = await integrationService.fetchShopifyResources();
      if (!response.success) throw new Error(response.error || 'Failed to load Shopify resources.');
      setResources(response.resources.length ? response.resources : FALLBACK_RESOURCES);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Shopify resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getShopifyStatus();
    setConnectionStatus(status);
    if (status.shop_domain) setShopDomain(status.shop_domain);
    setModalState(status.connected ? 'connected' : 'disconnected');
    if (status.connected) void loadResources();
  }, [loadResources]);

  useEffect(() => {
    if (isOpen) {
      void checkConnectionStatus();
    } else {
      resetState();
    }
  }, [checkConnectionStatus, isOpen, resetState]);

  useEffect(() => {
    const onSuccess = () => {
      setConnecting(false);
      popupRef.current?.close();
      void checkConnectionStatus();
    };
    const onError = (msg: string) => {
      setConnecting(false);
      popupRef.current?.close();
      setError(msg || 'Shopify authorization failed.');
    };

    const bc = new BroadcastChannel('shopify_oauth');
    bc.onmessage = (e) => {
      if (e.data?.type === 'SHOPIFY_OAUTH_SUCCESS') onSuccess();
      else if (e.data?.type === 'SHOPIFY_OAUTH_ERROR') onError(e.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SHOPIFY_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'SHOPIFY_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);
    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, [checkConnectionStatus]);

  const handleConnect = async () => {
    const normalizedShop = normalizeShopInput(shopDomain);
    if (!normalizedShop.endsWith('.myshopify.com')) {
      setError('Enter a valid Shopify *.myshopify.com shop domain.');
      return;
    }
    setConnecting(true);
    setError(null);
    const baseUrl = integrationService.getShopifyOAuthStartUrl(normalizedShop);
    const url = baseUrl;
    const width = 620;
    const height = 760;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'shopify_oauth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!popup) {
      setConnecting(false);
      setError('Popup blocked. Allow popups for Dreamify and try again.');
      return;
    }
    popupRef.current = popup;
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        setConnecting(false);
      }
    }, 500);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await integrationService.disconnectShopify();
      setConnectionStatus(null);
      setModalState('disconnected');
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const label = selectedResource.label || reportType;
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
      const result = await syncShopify({
        report_type: reportType,
        ...(promptProjectId && { project_id: promptProjectId }),
        date_preset: isCustomRange ? 'custom' : datePreset,
        ...(isCustomRange && startDate && { start_date: formatDateForApi(startDate) }),
        ...(isCustomRange && endDate && { end_date: formatDateForApi(endDate) }),
        row_limit: rowLimit,
        include_pii: includePii,
        max_bytes: Math.max(1, Math.round(maxBytesMb * 1024 * 1024)),
        resource: selectedResource.resource || 'all',
      });

      if (result.row_count > 0) {
        addFiles([
          {
            fileID: result.asset.asset_id,
            filename: result.asset.filename,
            size: result.asset.size_bytes || 0,
            ext: result.asset.extension || 'csv',
            status: 'uploaded',
            projectId: result.asset.project_id || undefined,
            sourceType: 'Shopify',
            accountName: connectionStatus?.shop_name || connectionStatus?.shop_domain || 'Shopify',
            propertyName: label,
            rowCount: result.row_count,
            columnCount: result.column_count,
            schemaOnly: false,
          },
        ]);
        setOpen(false);
        return;
      }

      setEmptyRowsDialog({
        asset: result.asset,
        reportLabel: label,
        columnCount: result.column_count,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred during sync.';
      if (message.toLowerCase().includes('reconnect') || message.toLowerCase().includes('revoked')) {
        setModalState('disconnected');
      }
      setError(message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectConnectedAsset = async (run: ConnectedAssetRun) => {
    if (!run.asset_id) return;
    const existingProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
    let resolvedProjectId = existingProjectId || undefined;
    let selectedAsset: AssetRecord | null = null;
    if (run.connectorKey && run.entityId) {
      try {
        if (existingProjectId) {
          const result = await fileService.addAssetsToProject([run.asset_id], existingProjectId);
          if (!result.success || !result.project?.id || !result.assets[0]?.asset_id) {
            throw new Error(result.error || 'Failed to add connected data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const projectName = `${run.entityName || 'Shopify'} Project`;
          const result = await integrationService.addConnectorEntityToNewProject(
            run.connectorKey,
            run.entityId,
            { project_name: projectName, prompt: 'Analyze this Shopify commerce data and build a revenue dashboard.', asset_id: run.asset_id }
          );
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from connected data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from connected data.');
        return;
      }
    }
    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'shopify.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Shopify',
        accountName: run.accountName || connectionStatus?.shop_name || 'Shopify',
        propertyName: run.entityName || 'Shopify',
        syncVersionName: run.sync_version_name || run.version_name,
      },
    ]);
    onClose();
  };

  const handleEmptyTryAnotherRange = async () => {
    if (!emptyRowsDialog) return;
    setDiscardingEmpty(true);
    try {
      const del = await fileService.deleteFile(emptyRowsDialog.asset.asset_id);
      if (!del.success) setError(del.error || 'Could not remove the empty export.');
      setEmptyRowsDialog(null);
    } finally {
      setDiscardingEmpty(false);
    }
  };

  const handleEmptyKeepSchema = () => {
    if (!emptyRowsDialog) return;
    const a = emptyRowsDialog.asset;
    addFiles([
      {
        fileID: a.asset_id,
        filename: a.filename,
        size: a.size_bytes || 0,
        ext: a.extension || 'csv',
        status: 'uploaded',
        projectId: a.project_id || undefined,
        sourceType: 'Shopify',
        accountName: connectionStatus?.shop_name || 'Shopify',
        propertyName: emptyRowsDialog.reportLabel,
        rowCount: 0,
        columnCount: emptyRowsDialog.columnCount,
        schemaOnly: true,
      },
    ]);
    setEmptyRowsDialog(null);
    setOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalStyles.content}>
        {!emptyRowsDialog ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-8 flex items-center justify-center overflow-hidden rounded bg-white">
                  <img src="/shopify.png" alt="Shopify" className="w-8 h-8 object-contain" />
                </div>
                <DialogTitle className="text-xl font-semibold">Connect Shopify</DialogTitle>
              </div>
              <DialogDescription className="text-muted-foreground text-sm">
                Sync commerce revenue, orders, customers, products, inventory, and discounts.
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-4">
              {modalState === 'checking' && (
                <div className={modalStyles.loadingCompact}>
                  <Loader2 className="w-6 h-6 animate-spin mb-2 text-[#95bf47]" />
                  <p className="text-sm">Checking connection...</p>
                </div>
              )}

              {modalState === 'disconnected' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className={modalStyles.label}>Shop domain</Label>
                    <Input
                      value={shopDomain}
                      onChange={(event) => setShopDomain(event.target.value)}
                      placeholder="your-store.myshopify.com"
                      className="bg-background border-border text-foreground"
                    />
                  </div>
                  <div className={modalStyles.infoPanel}>
                    <p>Dreamify will request read-only Shopify Admin API access for commerce reporting.</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>Orders, products, customers, inventory, fulfillments, and discounts</li>
                      <li>CSV-compatible exports with row and byte caps</li>
                    </ul>
                  </div>
                </div>
              )}

              {modalState === 'connected' && (
                <>
                  <div className="flex items-center justify-between p-3 border border-[#95bf47]/40 rounded-lg bg-[#95bf47]/10">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        <span className="text-sm font-medium text-foreground">Connected</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {connectionStatus?.shop_name || connectionStatus?.shop_domain || 'Shopify'}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className={modalStyles.ghostButtonSmall} onClick={handleDisconnect} disabled={disconnecting}>
                      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  </div>

                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'new' | 'connected')} className="mt-4">
                    <TabsList className={modalStyles.tabsListWithMargin}>
                      <TabsTrigger value="new" className={modalStyles.tabsTrigger}>Connect New</TabsTrigger>
                      <TabsTrigger value="connected" className={modalStyles.tabsTrigger}>Select Connected</TabsTrigger>
                    </TabsList>

                    <TabsContent value="new" className="space-y-4 outline-none">
                      <div className="space-y-2">
                        <Label className={modalStyles.label}>Report Type</Label>
                        <Select value={reportType} onValueChange={setReportType} disabled={loadingResources}>
                          <SelectTrigger className={modalStyles.selectTrigger}>
                            <SelectValue placeholder={loadingResources ? 'Loading...' : 'Select report type'} />
                          </SelectTrigger>
                          <SelectContent className={modalStyles.selectContent}>
                            {resources.map((resource) => (
                              <SelectItem key={resource.report_type} value={resource.report_type}>{resource.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Date Range</Label>
                          <Select value={datePreset} onValueChange={setDatePreset}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder="Select date range" />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              {DATE_PRESETS.map((preset) => (
                                <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Row Cap</Label>
                          <Input
                            type="number"
                            min={1}
                            max={10000}
                            value={rowLimit}
                            onChange={(e) => setRowLimit(Math.max(1, Math.min(10000, Number(e.target.value) || 5000)))}
                            className="bg-background border-border text-foreground"
                          />
                        </div>
                      </div>

                      {isCustomRange && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className={modalStyles.label}>Start Date</Label>
                            <div className="relative">
                              <input
                                type="date"
                                value={startDate ? formatDateForApi(startDate) : ''}
                                onChange={(e) => setStartDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                                className={modalStyles.dateInput}
                              />
                              <CalendarDays className={modalStyles.dateIcon} />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className={modalStyles.label}>End Date</Label>
                            <div className="relative">
                              <input
                                type="date"
                                value={endDate ? formatDateForApi(endDate) : ''}
                                onChange={(e) => setEndDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                                className={modalStyles.dateInput}
                              />
                              <CalendarDays className={modalStyles.dateIcon} />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Byte Cap (MB)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={maxBytesMb}
                            onChange={(e) => setMaxBytesMb(Math.max(1, Math.min(100, Number(e.target.value) || 10)))}
                            className="bg-background border-border text-foreground"
                          />
                        </div>
                        <div className="flex items-end">
                          <label className="flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-sm">
                            <span>Include PII</span>
                            <Switch checked={includePii} onCheckedChange={setIncludePii} />
                          </label>
                        </div>
                      </div>

                      {needsReadAllOrdersWarning && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>Historical order windows beyond 60 days require Shopify read_all_orders approval.</span>
                        </div>
                      )}

                      {rowLimit > 2500 && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                          Large extracts use Shopify Bulk Operations and remain bounded by the row and byte caps.
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="connected" className="outline-none">
                      <ConnectedEntitiesList connectorKey="shopify" onSelectAsset={handleSelectConnectedAsset} />
                    </TabsContent>
                  </Tabs>
                </>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <DialogFooter className="sm:justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} className={modalStyles.ghostButton} disabled={connecting || syncing}>
                Cancel
              </Button>
              {modalState === 'disconnected' && (
                <Button type="button" onClick={handleConnect} disabled={connecting || !shopDomain.trim()} className="bg-[#95bf47] hover:bg-[#7da43a] text-white font-medium px-4 py-2 rounded-md transition-colors">
                  {connecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</> : 'Connect with Shopify'}
                </Button>
              )}
              {modalState === 'connected' && (
                <Button
                  type="button"
                  onClick={handleSync}
                  disabled={activeTab === 'connected' || syncing}
                  className={`bg-[#95bf47] hover:bg-[#7da43a] text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
                >
                  {syncing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing...</> : 'Sync Data'}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">No data found</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                The <span className="text-foreground font-medium">{emptyRowsDialog.reportLabel}</span> report returned 0 rows for the selected range.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 text-sm text-muted-foreground">
              Keep the schema-only file for setup, or remove it and try another range.
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={handleEmptyTryAnotherRange} disabled={discardingEmpty}>
                {discardingEmpty ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Removing...</> : 'Try another range'}
              </Button>
              <Button type="button" onClick={handleEmptyKeepSchema} className="bg-[#95bf47] hover:bg-[#7da43a] text-white">
                Keep schema
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
