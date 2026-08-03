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
  type KlaviyoConnectionStatusResponse,
  type KlaviyoNamedResource,
  type KlaviyoReportResource,
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

const FALLBACK_REPORTS: KlaviyoReportResource[] = [
  { report_type: 'lifecycle_overview', label: 'Lifecycle Overview', resource: 'all', default: true },
  { report_type: 'campaigns', label: 'Campaigns', resource: 'campaigns' },
  { report_type: 'flows', label: 'Flows', resource: 'flows' },
  { report_type: 'profiles', label: 'Profiles', resource: 'profiles' },
  { report_type: 'lists', label: 'Lists', resource: 'lists' },
  { report_type: 'events', label: 'Events', resource: 'events' },
  { report_type: 'metrics', label: 'Metrics', resource: 'metrics' },
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

const EMPTY_RESOURCES: KlaviyoNamedResource[] = [];

export default function KlaviyoIntegrationModal() {
  const {
    isKlaviyoModalOpen: isOpen,
    setKlaviyoModalOpen: setOpen,
    currentProjectId,
    syncKlaviyo,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<KlaviyoConnectionStatusResponse | null>(null);
  const [reports, setReports] = useState<KlaviyoReportResource[]>(FALLBACK_REPORTS);
  const [metrics, setMetrics] = useState<KlaviyoNamedResource[]>(EMPTY_RESOURCES);
  const [campaigns, setCampaigns] = useState<KlaviyoNamedResource[]>(EMPTY_RESOURCES);
  const [flows, setFlows] = useState<KlaviyoNamedResource[]>(EMPTY_RESOURCES);
  const [lists, setLists] = useState<KlaviyoNamedResource[]>(EMPTY_RESOURCES);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState('lifecycle_overview');
  const [metricId, setMetricId] = useState('');
  const [resourceId, setResourceId] = useState('all');
  const [channel, setChannel] = useState('all');
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

  const selectedReport = useMemo(
    () => reports.find((report) => report.report_type === reportType) || FALLBACK_REPORTS[0],
    [reportType, reports]
  );
  const isCustomRange = datePreset === 'custom';
  const metricRequired = ['lifecycle_overview', 'campaigns', 'flows'].includes(reportType);
  const resourceOptions = useMemo(() => {
    if (reportType === 'campaigns') return campaigns;
    if (reportType === 'flows') return flows;
    if (reportType === 'lists') return lists;
    return EMPTY_RESOURCES;
  }, [campaigns, flows, lists, reportType]);
  const showResourceSelector = resourceOptions.length > 0 && ['campaigns', 'flows', 'lists'].includes(reportType);

  const onClose = () => setOpen(false);

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setReports(FALLBACK_REPORTS);
    setMetrics(EMPTY_RESOURCES);
    setCampaigns(EMPTY_RESOURCES);
    setFlows(EMPTY_RESOURCES);
    setLists(EMPTY_RESOURCES);
    setConnecting(false);
    setDisconnecting(false);
    setLoadingResources(false);
    setSyncing(false);
    setError(null);
    setReportType('lifecycle_overview');
    setMetricId('');
    setResourceId('all');
    setChannel('all');
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

  const applyDefaultMetric = useCallback((status?: KlaviyoConnectionStatusResponse | null, availableMetrics: KlaviyoNamedResource[] = []) => {
    const placedOrder = availableMetrics.find((metric) => metric.name.toLowerCase() === 'placed order');
    setMetricId(status?.default_metric_id || placedOrder?.id || availableMetrics[0]?.id || '');
  }, []);

  const loadResources = useCallback(async (status?: KlaviyoConnectionStatusResponse | null) => {
    setLoadingResources(true);
    try {
      const response = await integrationService.fetchKlaviyoResources();
      if (!response.success) throw new Error(response.error || 'Failed to load Klaviyo resources.');
      const nextReports = response.reports.length ? response.reports : FALLBACK_REPORTS;
      setReports(nextReports);
      setMetrics(response.metrics || EMPTY_RESOURCES);
      setCampaigns(response.campaigns || EMPTY_RESOURCES);
      setFlows(response.flows || EMPTY_RESOURCES);
      setLists(response.lists || EMPTY_RESOURCES);
      const metricStatus: KlaviyoConnectionStatusResponse = {
        connected: Boolean(status?.connected),
        ...(status || {}),
        default_metric_id: status?.default_metric_id || response.default_metric_id,
        default_metric_name: status?.default_metric_name || response.default_metric_name,
      };
      applyDefaultMetric(metricStatus, response.metrics || EMPTY_RESOURCES);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Klaviyo resources.');
    } finally {
      setLoadingResources(false);
    }
  }, [applyDefaultMetric]);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getKlaviyoStatus();
    setConnectionStatus(status);
    applyDefaultMetric(status);
    setModalState(status.connected ? 'connected' : 'disconnected');
    if (status.connected) void loadResources(status);
  }, [applyDefaultMetric, loadResources]);

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
      setError(msg || 'Klaviyo authorization failed.');
    };

    const bc = new BroadcastChannel('klaviyo_oauth');
    bc.onmessage = (e) => {
      if (e.data?.type === 'KLAVIYO_OAUTH_SUCCESS') onSuccess();
      else if (e.data?.type === 'KLAVIYO_OAUTH_ERROR') onError(e.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'KLAVIYO_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'KLAVIYO_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);
    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, [checkConnectionStatus]);

  useEffect(() => {
    setResourceId('all');
  }, [reportType]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const baseUrl = integrationService.getKlaviyoOAuthStartUrl();
    const url = baseUrl;
    const width = 620;
    const height = 760;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'klaviyo_oauth',
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
      await integrationService.disconnectKlaviyo();
      setConnectionStatus(null);
      setModalState('disconnected');
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (metricRequired && !metricId) {
      setError('Select a Klaviyo conversion metric before syncing this report.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
      const result = await syncKlaviyo({
        report_type: reportType,
        ...(promptProjectId && { project_id: promptProjectId }),
        date_preset: isCustomRange ? 'custom' : datePreset,
        ...(isCustomRange && startDate && { start_date: formatDateForApi(startDate) }),
        ...(isCustomRange && endDate && { end_date: formatDateForApi(endDate) }),
        row_limit: rowLimit,
        include_pii: includePii,
        max_bytes: Math.max(1, Math.round(maxBytesMb * 1024 * 1024)),
        metric_id: metricId,
        resource_id: resourceId,
        channel,
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
            sourceType: 'Klaviyo',
            accountName: connectionStatus?.account_name || 'Klaviyo',
            propertyName: selectedReport.label || 'Lifecycle Overview',
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
        reportLabel: selectedReport.label || reportType,
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
          const projectName = `${run.entityName || 'Klaviyo'} Project`;
          const result = await integrationService.addConnectorEntityToNewProject(
            run.connectorKey,
            run.entityId,
            { project_name: projectName, prompt: 'Analyze this Klaviyo lifecycle marketing data and build a retention dashboard.', asset_id: run.asset_id }
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
        filename: selectedAsset?.filename || run.asset_filename || 'klaviyo.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Klaviyo',
        accountName: run.accountName || connectionStatus?.account_name || 'Klaviyo',
        propertyName: run.entityName || 'Klaviyo',
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
        sourceType: 'Klaviyo',
        accountName: connectionStatus?.account_name || 'Klaviyo',
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
                <div className="w-12 h-8 flex items-center justify-center overflow-hidden rounded bg-white">
                  <img src="/klaviyo.svg" alt="Klaviyo" className="w-11 h-7 object-contain" />
                </div>
                <DialogTitle className="text-xl font-semibold">Connect Klaviyo</DialogTitle>
              </div>
              <DialogDescription className="text-muted-foreground text-sm">
                Sync lifecycle marketing reports for campaigns, flows, profiles, lists, events, and metrics.
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-4">
              {modalState === 'checking' && (
                <div className={modalStyles.loadingCompact}>
                  <Loader2 className="w-6 h-6 animate-spin mb-2 text-[#35E9A1]" />
                  <p className="text-sm">Checking connection...</p>
                </div>
              )}

              {modalState === 'disconnected' && (
                <div className="space-y-4">
                  <div className={modalStyles.infoPanel}>
                    <p>Dreamify will request read-only Klaviyo OAuth access for lifecycle analytics.</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>Accounts, campaigns, flows, profiles, lists, events, and metrics</li>
                      <li>CSV-compatible exports with row, byte, date-window, and PII controls</li>
                    </ul>
                  </div>
                </div>
              )}

              {modalState === 'connected' && (
                <>
                  <div className="flex items-center justify-between p-3 border border-[#35E9A1]/40 rounded-lg bg-[#35E9A1]/10">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                        <span className="text-sm font-medium text-foreground">Connected</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {connectionStatus?.account_name || connectionStatus?.account_id || 'Klaviyo'}
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
                          <Label className={modalStyles.label}>Channel</Label>
                          <Select value={channel} onValueChange={setChannel}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder="Select channel" />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              <SelectItem value="all">All channels</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="sms">SMS</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {metricRequired && (
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Conversion Metric</Label>
                          <Select value={metricId} onValueChange={setMetricId} disabled={loadingResources || metrics.length === 0}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder={metrics.length ? 'Select metric' : 'No metrics loaded'} />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              {metrics.map((metric) => (
                                <SelectItem key={metric.id} value={metric.id}>{metric.name || metric.id}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {showResourceSelector && (
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Resource</Label>
                          <Select value={resourceId} onValueChange={setResourceId}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder="Select resource" />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              <SelectItem value="all">All {selectedReport.label}</SelectItem>
                              {resourceOptions.map((resource) => (
                                <SelectItem key={resource.id} value={resource.id}>{resource.name || resource.id}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

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

                      {metricRequired && !metricId && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>Placed Order was not found automatically. Select a conversion metric before syncing.</span>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="connected" className="outline-none">
                      <ConnectedEntitiesList connectorKey="klaviyo" onSelectAsset={handleSelectConnectedAsset} />
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
                <Button type="button" onClick={handleConnect} disabled={connecting} className="bg-[#111111] hover:bg-[#2a2a2a] text-white font-medium px-4 py-2 rounded-md transition-colors">
                  {connecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</> : 'Connect with Klaviyo'}
                </Button>
              )}
              {modalState === 'connected' && (
                <Button
                  type="button"
                  onClick={handleSync}
                  disabled={activeTab === 'connected' || syncing || (metricRequired && !metricId)}
                  className={`bg-[#111111] hover:bg-[#2a2a2a] text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
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
              <Button type="button" onClick={handleEmptyKeepSchema} className="bg-[#111111] hover:bg-[#2a2a2a] text-white">
                Keep schema
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
