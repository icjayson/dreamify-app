import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, Loader2, ShieldAlert } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  integrationService,
  type CustomerIOConnectionStatusResponse,
  type CustomerIONamedResource,
  type CustomerIOReportResource,
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

const FALLBACK_REPORTS: CustomerIOReportResource[] = [
  { report_type: 'lifecycle_overview', label: 'Lifecycle Overview', resource: 'all', default: true },
  { report_type: 'campaigns', label: 'Campaigns', resource: 'campaign' },
  { report_type: 'campaign_actions', label: 'Campaign Actions', resource: 'campaign' },
  { report_type: 'newsletters', label: 'Newsletters', resource: 'newsletter' },
  { report_type: 'segments', label: 'Segments', resource: 'segment' },
  { report_type: 'people', label: 'People', resource: 'person' },
  { report_type: 'events', label: 'Events', resource: 'event' },
  { report_type: 'message_metrics', label: 'Message Metrics', resource: 'metric' },
];

type ModalState = 'checking' | 'disconnected' | 'connected';

type ConnectedAssetRun = {
  asset_id?: string;
  asset_filename?: string;
  connectorKey?: string;
  entityId?: string;
  entityName?: string;
  accountName?: string;
  config_snapshot?: { size_bytes?: number };
  sync_version_name?: string;
  version_name?: string;
};

const formatInputDate = (date?: Date) => (date ? formatDateForApi(date) : '');

function getResourcesForReport(
  reportType: string,
  campaigns: CustomerIONamedResource[],
  newsletters: CustomerIONamedResource[],
  segments: CustomerIONamedResource[],
  people: CustomerIONamedResource[],
): CustomerIONamedResource[] {
  if (['campaigns', 'campaign_actions'].includes(reportType)) return campaigns;
  if (reportType === 'newsletters') return newsletters;
  if (reportType === 'segments') return segments;
  if (reportType === 'people') return people;
  return [];
}

export default function CustomerIOIntegrationModal() {
  const {
    isCustomerIOModalOpen: isOpen,
    setCustomerIOModalOpen: setOpen,
    currentProjectId,
    syncCustomerIO,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<CustomerIOConnectionStatusResponse | null>(null);
  const [workspaceId, setWorkspaceId] = useState('all');
  const [accountName, setAccountName] = useState('');
  const [appApiKey, setAppApiKey] = useState('');
  const [region, setRegion] = useState('US');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [reports, setReports] = useState<CustomerIOReportResource[]>(FALLBACK_REPORTS);
  const [campaigns, setCampaigns] = useState<CustomerIONamedResource[]>([]);
  const [newsletters, setNewsletters] = useState<CustomerIONamedResource[]>([]);
  const [segments, setSegments] = useState<CustomerIONamedResource[]>([]);
  const [people, setPeople] = useState<CustomerIONamedResource[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState('lifecycle_overview');
  const [resourceId, setResourceId] = useState('all');
  const [rowLimit, setRowLimit] = useState(5000);
  const [maxBytesMb, setMaxBytesMb] = useState(10);
  const [includePii, setIncludePii] = useState(false);
  const [datePreset, setDatePreset] = useState('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');

  const selectedReport = useMemo(
    () => reports.find((report) => report.report_type === reportType) || FALLBACK_REPORTS[0],
    [reportType, reports]
  );
  const selectableResources = useMemo(
    () => getResourcesForReport(reportType, campaigns, newsletters, segments, people),
    [campaigns, newsletters, people, reportType, segments]
  );
  const isCustomRange = datePreset === 'custom';
  const canIncludePii = ['people', 'events', 'message_metrics'].includes(reportType);

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setWorkspaceId('all');
    setAccountName('');
    setAppApiKey('');
    setRegion('US');
    setApiBaseUrl('');
    setReports(FALLBACK_REPORTS);
    setCampaigns([]);
    setNewsletters([]);
    setSegments([]);
    setPeople([]);
    setError(null);
    setReportType('lifecycle_overview');
    setResourceId('all');
    setRowLimit(5000);
    setMaxBytesMb(10);
    setIncludePii(false);
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setActiveTab('new');
  }, []);

  const loadResources = useCallback(async () => {
    setLoadingResources(true);
    try {
      const response = await integrationService.fetchCustomerIOResources();
      if (!response.success) throw new Error(response.error || 'Failed to load Customer.io resources.');
      setReports(response.reports.length ? response.reports : FALLBACK_REPORTS);
      setCampaigns(response.campaigns || []);
      setNewsletters(response.newsletters || []);
      setSegments(response.segments || []);
      setPeople(response.people || []);
      if (response.workspaces[0]?.id) setWorkspaceId(response.workspaces[0].id);
      if (response.workspaces[0]?.api_base_url) setApiBaseUrl(response.workspaces[0].api_base_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Customer.io resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getCustomerIOStatus();
    setConnectionStatus(status);
    if (status.workspace_id) setWorkspaceId(status.workspace_id);
    if (status.account_name) setAccountName(status.account_name);
    if (status.region) setRegion(status.region);
    if (status.api_base_url) setApiBaseUrl(status.api_base_url);
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
    if (!canIncludePii && includePii) setIncludePii(false);
    setResourceId('all');
  }, [canIncludePii, includePii, reportType]);

  const handleConnect = async () => {
    if (!appApiKey.trim()) {
      setError('Customer.io App API key is required.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const status = await integrationService.connectCustomerIO({
        app_api_key: appApiKey,
        region,
        api_base_url: apiBaseUrl.trim() || undefined,
        account_name: accountName.trim() || undefined,
        workspace_id: workspaceId.trim() || undefined,
      });
      setConnectionStatus(status);
      setModalState('connected');
      setAppApiKey('');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Customer.io.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await integrationService.disconnectCustomerIO();
      setConnectionStatus({ connected: false });
      setModalState('disconnected');
      setReports(FALLBACK_REPORTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Customer.io.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (!currentProjectId) {
      setError('Open or create a Dreamify project before syncing Customer.io data.');
      return;
    }
    if (isCustomRange && (!startDate || !endDate)) {
      setError('Choose both start and end dates for a custom Customer.io sync.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const run = await syncCustomerIO({
        report_type: reportType,
        project_id: currentProjectId,
        date_preset: datePreset,
        start_date: isCustomRange ? formatInputDate(startDate) : undefined,
        end_date: isCustomRange ? formatInputDate(endDate) : undefined,
        row_limit: rowLimit,
        include_pii: canIncludePii ? includePii : false,
        max_bytes: Math.max(1, maxBytesMb) * 1024 * 1024,
        resource_id: resourceId || selectedReport.resource || 'all',
      });
      if (run.asset) {
        addFiles([
          {
            fileID: run.asset.asset_id,
            filename: run.asset.filename || 'customer_io.csv',
            size: run.asset.size_bytes || 0,
            ext: run.asset.extension || 'csv',
            status: 'uploaded',
            projectId: run.asset.project_id || currentProjectId,
            sourceType: 'Customer.io',
            accountName: connectionStatus?.account_name || 'Customer.io',
            propertyName: selectedReport.label,
            rowCount: run.row_count,
            columnCount: run.column_count,
          },
        ]);
      }
      setActiveTab('connected');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync Customer.io data.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectConnectedAsset = async (run: ConnectedAssetRun) => {
    if (!run.asset_id) return;
    const existingProjectId =
      currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
    let resolvedProjectId = existingProjectId || undefined;
    let selectedAsset: AssetRecord | null = null;

    if (run.connectorKey && run.entityId) {
      try {
        if (existingProjectId) {
          const result = await fileService.addAssetsToProject([run.asset_id], existingProjectId);
          if (!result.success || !result.project?.id || !result.assets[0]?.asset_id) {
            throw new Error(result.error || 'Failed to add connected Customer.io data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const result = await integrationService.addConnectorEntityToNewProject(run.connectorKey, run.entityId, {
            project_name: `${run.entityName || 'Customer.io'} Project`,
            prompt: 'Analyze this Customer.io lifecycle marketing data and build a lifecycle performance dashboard.',
            asset_id: run.asset_id,
          });
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from connected Customer.io data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from connected Customer.io data.');
        return;
      }
    }

    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'customer_io.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Customer.io',
        accountName: run.accountName || connectionStatus?.account_name || 'Customer.io',
        propertyName: run.entityName || 'Customer.io',
        syncVersionName: run.sync_version_name || run.version_name,
      },
    ]);
    setOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className={modalStyles.content}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-white">
              <img src="/customer-io.svg" alt="Customer.io" className="h-8 w-8" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">Connect Customer.io</DialogTitle>
              <DialogDescription>Sync read-only lifecycle marketing reports from campaigns, newsletters, segments, people, and events.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {modalState === 'checking' ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Checking Customer.io connection
          </div>
        ) : modalState === 'disconnected' ? (
          <div className="space-y-5 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Region</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">US</SelectItem>
                    <SelectItem value="EU">EU</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-io-workspace-id">Workspace ID</Label>
                <Input id="customer-io-workspace-id" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="all" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-io-base-url">API base URL</Label>
              <Input id="customer-io-base-url" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="Optional custom Customer.io App API URL" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-io-account-name">Account label</Label>
              <Input id="customer-io-account-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Lifecycle Marketing" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-io-api-key">App API key</Label>
              <Input id="customer-io-api-key" type="password" value={appApiKey} onChange={(event) => setAppApiKey(event.target.value)} placeholder="cioapp_..." />
            </div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>Dreamify stores the App API key encrypted and only performs read-only analytics syncs.</p>
                <p>Customer.io stays inactive in the connector catalog until connection, sync, schedules, and smoke tests pass.</p>
              </div>
            </div>
            <Button className="w-full" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Connect Customer.io
            </Button>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'new' | 'connected')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">New Sync</TabsTrigger>
              <TabsTrigger value="connected">Connected Reports</TabsTrigger>
            </TabsList>

            <TabsContent value="new" className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {connectionStatus?.account_name || 'Customer.io'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Workspace {connectionStatus?.workspace_id || workspaceId || 'all'} · {connectionStatus?.region || region}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  Disconnect
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Report</Label>
                  <Select value={reportType} onValueChange={setReportType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {reports.map((report) => (
                        <SelectItem key={report.report_type} value={report.report_type}>
                          {report.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date range</Label>
                  <Select value={datePreset} onValueChange={setDatePreset}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DATE_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectableResources.length > 0 && (
                <div className="space-y-2">
                  <Label>Resource</Label>
                  <Select value={resourceId} onValueChange={setResourceId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {selectableResources.map((resource) => (
                        <SelectItem key={resource.id} value={resource.id}>
                          {resource.name || resource.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Row cap</Label>
                  <Input type="number" min={1} max={10000} value={rowLimit} onChange={(event) => setRowLimit(Number(event.target.value || 1))} />
                </div>
                <div className="space-y-2">
                  <Label>Byte cap MB</Label>
                  <Input type="number" min={1} value={maxBytesMb} onChange={(event) => setMaxBytesMb(Number(event.target.value || 1))} />
                </div>
              </div>

              {isCustomRange && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />Start</Label>
                    <Input type="date" value={formatInputDate(startDate)} onChange={(event) => setStartDate(event.target.value ? new Date(event.target.value) : undefined)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />End</Label>
                    <Input type="date" value={formatInputDate(endDate)} onChange={(event) => setEndDate(event.target.value ? new Date(event.target.value) : undefined)} />
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
                <div>
                  <Label>Include person and message PII</Label>
                  <p className="text-xs text-muted-foreground">
                    Person IDs, emails, names, phones, and user attributes are redacted by default.
                  </p>
                </div>
                <Switch checked={includePii} onCheckedChange={setIncludePii} disabled={!canIncludePii} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
                <Button onClick={handleSync} disabled={syncing || loadingResources}>
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sync Customer.io
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="connected" className="mt-4">
              <ConnectedEntitiesList connectorKey="customer_io" onSelectAsset={handleSelectConnectedAsset} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
