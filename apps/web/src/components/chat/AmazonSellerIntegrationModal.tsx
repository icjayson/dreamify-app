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
  type AmazonSellerConnectionStatusResponse,
  type AmazonSellerMarketplace,
  type AmazonSellerReportResource,
} from '@/services/integrationService';
import { useChatStore } from '@/chat/useChatStore';
import { fileService, type AssetRecord } from '@/services/fileService';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';
import { connectorModalStyles as modalStyles } from './connectorModalStyles';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_14d', label: 'Last 14 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

const REGIONS = [
  { value: 'NA', label: 'North America' },
  { value: 'EU', label: 'Europe' },
  { value: 'FE', label: 'Far East' },
];

const FALLBACK_REPORTS: AmazonSellerReportResource[] = [
  { report_type: 'sales_overview', label: 'Sales Overview', default: true },
  { report_type: 'orders', label: 'Orders' },
  { report_type: 'order_items', label: 'Order Items' },
  { report_type: 'inventory', label: 'Inventory' },
  { report_type: 'listings', label: 'Listings' },
  { report_type: 'returns', label: 'Returns' },
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

export default function AmazonSellerIntegrationModal() {
  const {
    isAmazonSellerModalOpen: isOpen,
    setAmazonSellerModalOpen: setOpen,
    currentProjectId,
    syncAmazonSeller,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<AmazonSellerConnectionStatusResponse | null>(null);
  const [reports, setReports] = useState<AmazonSellerReportResource[]>(FALLBACK_REPORTS);
  const [marketplaces, setMarketplaces] = useState<AmazonSellerMarketplace[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState('NA');
  const [reportType, setReportType] = useState('sales_overview');
  const [marketplaceId, setMarketplaceId] = useState('all');
  const [rowLimit, setRowLimit] = useState(5000);
  const [maxBytesMb, setMaxBytesMb] = useState(10);
  const [includePii, setIncludePii] = useState(false);
  const [datePreset, setDatePreset] = useState('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');
  const popupRef = useRef<Window | null>(null);

  const selectedReport = useMemo(
    () => reports.find((report) => report.report_type === reportType) || FALLBACK_REPORTS[0],
    [reportType, reports]
  );
  const isCustomRange = datePreset === 'custom';

  const onClose = () => setOpen(false);

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setReports(FALLBACK_REPORTS);
    setMarketplaces([]);
    setConnecting(false);
    setDisconnecting(false);
    setLoadingResources(false);
    setSyncing(false);
    setError(null);
    setRegion('NA');
    setReportType('sales_overview');
    setMarketplaceId('all');
    setRowLimit(5000);
    setMaxBytesMb(10);
    setIncludePii(false);
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setActiveTab('new');
  }, []);

  const loadResources = useCallback(async (status?: AmazonSellerConnectionStatusResponse | null) => {
    setLoadingResources(true);
    try {
      const response = await integrationService.fetchAmazonSellerResources();
      if (!response.success) throw new Error(response.error || 'Failed to load Amazon Seller resources.');
      setReports(response.reports.length ? response.reports : FALLBACK_REPORTS);
      const nextMarketplaces = response.marketplaces.length ? response.marketplaces : status?.marketplaces || [];
      setMarketplaces(nextMarketplaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Amazon Seller resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getAmazonSellerStatus();
    setConnectionStatus(status);
    if (status.selling_region) setRegion(status.selling_region);
    setMarketplaces(status.marketplaces || []);
    setModalState(status.connected ? 'connected' : 'disconnected');
    if (status.connected) void loadResources(status);
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
      setError(msg || 'Amazon Seller authorization failed.');
    };

    const bc = new BroadcastChannel('amazon_seller_oauth');
    bc.onmessage = (e) => {
      if (e.data?.type === 'AMAZON_SELLER_OAUTH_SUCCESS') onSuccess();
      else if (e.data?.type === 'AMAZON_SELLER_OAUTH_ERROR') onError(e.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'AMAZON_SELLER_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'AMAZON_SELLER_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);
    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, [checkConnectionStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const baseUrl = integrationService.getAmazonSellerOAuthStartUrl(region);
    const url = baseUrl;
    const width = 700;
    const height = 780;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'amazon_seller_oauth',
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
      await integrationService.disconnectAmazonSeller();
      setConnectionStatus(null);
      setModalState('disconnected');
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (includePii) {
      setError('Amazon Seller v1 does not support restricted buyer PII export.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
      const result = await syncAmazonSeller({
        report_type: reportType,
        ...(promptProjectId && { project_id: promptProjectId }),
        date_preset: isCustomRange ? 'custom' : datePreset,
        ...(isCustomRange && startDate && { start_date: formatDateForApi(startDate) }),
        ...(isCustomRange && endDate && { end_date: formatDateForApi(endDate) }),
        marketplace_id: marketplaceId,
        row_limit: rowLimit,
        include_pii: false,
        max_bytes: Math.max(1, Math.round(maxBytesMb * 1024 * 1024)),
      });
      addFiles([
        {
          fileID: result.asset.asset_id,
          filename: result.asset.filename,
          size: result.asset.size_bytes || 0,
          ext: result.asset.extension || 'csv',
          status: 'uploaded',
          projectId: result.asset.project_id || undefined,
          sourceType: 'Amazon Seller',
          accountName: connectionStatus?.seller_name || 'Amazon Seller',
          propertyName: selectedReport.label || 'Sales Overview',
          rowCount: result.row_count,
          columnCount: result.column_count,
          schemaOnly: (result.row_count || 0) === 0,
        },
      ]);
      setOpen(false);
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
          const projectName = `${run.entityName || 'Amazon Seller'} Project`;
          const result = await integrationService.addConnectorEntityToNewProject(
            run.connectorKey,
            run.entityId,
            { project_name: projectName, prompt: 'Analyze this Amazon Seller marketplace data and build a commerce dashboard.', asset_id: run.asset_id }
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
        filename: selectedAsset?.filename || run.asset_filename || 'amazon_seller.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Amazon Seller',
        accountName: run.accountName || connectionStatus?.seller_name || 'Amazon Seller',
        propertyName: run.entityName || 'Amazon Seller',
        syncVersionName: run.sync_version_name || run.version_name,
      },
    ]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalStyles.content}>
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <div className="flex h-8 w-12 items-center justify-center overflow-hidden rounded bg-white">
              <img src="/amazon-seller.png" alt="Amazon Seller" className="h-7 w-11 object-contain" />
            </div>
            <DialogTitle className="text-xl font-semibold">Connect Amazon Seller</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Sync Seller Central orders, inventory, listings, returns, and marketplace revenue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-6">
          {modalState === 'checking' && (
            <div className={modalStyles.loadingCompact}>
              <Loader2 className="mb-2 h-6 w-6 animate-spin text-[#FF9900]" />
              <p className="text-sm">Checking connection...</p>
            </div>
          )}

          {modalState === 'disconnected' && (
            <div className="space-y-4">
              <div className={modalStyles.infoPanel}>
                <p>Dreamify will request read-only Amazon Selling Partner API access.</p>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  <li>Orders, report exports, listings, inventory, and returns</li>
                  <li>CSV-compatible assets with date, row, byte, and marketplace caps</li>
                  <li>Restricted buyer PII is not requested in v1</li>
                </ul>
              </div>
              <div className="space-y-2">
                <Label className={modalStyles.label}>Selling Region</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger className={modalStyles.selectTrigger}>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent className={modalStyles.selectContent}>
                    {REGIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {modalState === 'connected' && (
            <>
              <div className="flex items-center justify-between rounded-lg border border-[#FF9900]/40 bg-[#FF9900]/10 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-sm font-medium text-foreground">Connected</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {connectionStatus?.seller_name || connectionStatus?.seller_id || 'Amazon Seller'}
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
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Report Type</Label>
                      <Select value={reportType} onValueChange={setReportType} disabled={loadingResources}>
                        <SelectTrigger className={modalStyles.selectTrigger}>
                          <SelectValue placeholder={loadingResources ? 'Loading...' : 'Select report type'} />
                        </SelectTrigger>
                        <SelectContent className={modalStyles.selectContent}>
                          {reports.map((report) => (
                            <SelectItem key={report.report_type} value={report.report_type}>{report.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Marketplace</Label>
                      <Select value={marketplaceId} onValueChange={setMarketplaceId} disabled={loadingResources}>
                        <SelectTrigger className={modalStyles.selectTrigger}>
                          <SelectValue placeholder="Select marketplace" />
                        </SelectTrigger>
                        <SelectContent className={modalStyles.selectContent}>
                          <SelectItem value="all">All marketplaces</SelectItem>
                          {marketplaces.map((marketplace) => (
                            <SelectItem key={marketplace.id} value={marketplace.id}>
                              {marketplace.name || marketplace.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
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
                        className="border-border bg-background text-foreground"
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
                        className="border-border bg-background text-foreground"
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-sm opacity-70">
                        <span>Include PII</span>
                        <Switch checked={includePii} onCheckedChange={setIncludePii} disabled />
                      </label>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>Buyer name, email, and address fields remain redacted. Restricted Data Token support is intentionally out of scope for v1.</span>
                  </div>
                </TabsContent>

                <TabsContent value="connected" className="outline-none">
                  <ConnectedEntitiesList connectorKey="amazon_seller" onSelectAsset={handleSelectConnectedAsset} />
                </TabsContent>
              </Tabs>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} className={modalStyles.ghostButton} disabled={connecting || syncing}>
            Cancel
          </Button>
          {modalState === 'disconnected' && (
            <Button type="button" onClick={handleConnect} disabled={connecting} className="bg-[#111111] hover:bg-[#2a2a2a] text-white font-medium px-4 py-2 rounded-md transition-colors">
              {connecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect Amazon Seller'
              )}
            </Button>
          )}
          {modalState === 'connected' && activeTab === 'new' && (
            <Button type="button" onClick={handleSync} disabled={syncing || loadingResources} className="bg-[#111111] hover:bg-[#2a2a2a] text-white font-medium px-4 py-2 rounded-md transition-colors">
              {syncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                'Sync Amazon Seller'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
