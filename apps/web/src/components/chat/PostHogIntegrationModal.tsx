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
  type PostHogConnectionStatusResponse,
  type PostHogNamedResource,
  type PostHogReportResource,
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

const FALLBACK_REPORTS: PostHogReportResource[] = [
  { report_type: 'product_overview', label: 'Product Overview', resource: 'all', default: true },
  { report_type: 'events', label: 'Events', resource: 'event' },
  { report_type: 'event_breakdown', label: 'Event Breakdown', resource: 'event' },
  { report_type: 'insights', label: 'Insights', resource: 'insight' },
  { report_type: 'funnels', label: 'Funnels', resource: 'insight' },
  { report_type: 'retention', label: 'Retention', resource: 'insight' },
  { report_type: 'cohorts', label: 'Cohorts', resource: 'cohort' },
  { report_type: 'persons', label: 'Persons', resource: 'person' },
  { report_type: 'feature_flags', label: 'Feature Flags', resource: 'feature_flag' },
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
  events: PostHogNamedResource[],
  insights: PostHogNamedResource[],
  cohorts: PostHogNamedResource[],
  featureFlags: PostHogNamedResource[],
): PostHogNamedResource[] {
  if (['events', 'event_breakdown'].includes(reportType)) return events;
  if (['insights', 'funnels', 'retention'].includes(reportType)) return insights;
  if (reportType === 'cohorts') return cohorts;
  if (reportType === 'feature_flags') return featureFlags;
  return [];
}

export default function PostHogIntegrationModal() {
  const {
    isPostHogModalOpen: isOpen,
    setPostHogModalOpen: setOpen,
    currentProjectId,
    syncPostHog,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<PostHogConnectionStatusResponse | null>(null);
  const [projectId, setProjectId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [region, setRegion] = useState('US');
  const [baseUrl, setBaseUrl] = useState('');
  const [reports, setReports] = useState<PostHogReportResource[]>(FALLBACK_REPORTS);
  const [events, setEvents] = useState<PostHogNamedResource[]>([]);
  const [insights, setInsights] = useState<PostHogNamedResource[]>([]);
  const [cohorts, setCohorts] = useState<PostHogNamedResource[]>([]);
  const [featureFlags, setFeatureFlags] = useState<PostHogNamedResource[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState('product_overview');
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
    () => getResourcesForReport(reportType, events, insights, cohorts, featureFlags),
    [cohorts, events, featureFlags, insights, reportType]
  );
  const isCustomRange = datePreset === 'custom';
  const canIncludePii = reportType === 'events' || reportType === 'persons';

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setProjectId('');
    setAccountName('');
    setApiKey('');
    setRegion('US');
    setBaseUrl('');
    setReports(FALLBACK_REPORTS);
    setEvents([]);
    setInsights([]);
    setCohorts([]);
    setFeatureFlags([]);
    setError(null);
    setReportType('product_overview');
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
      const response = await integrationService.fetchPostHogResources();
      if (!response.success) throw new Error(response.error || 'Failed to load PostHog resources.');
      setReports(response.reports.length ? response.reports : FALLBACK_REPORTS);
      setEvents(response.events || []);
      setInsights(response.insights || []);
      setCohorts(response.cohorts || []);
      setFeatureFlags(response.feature_flags || []);
      if (response.projects[0]?.id) setProjectId(response.projects[0].id);
      if (response.projects[0]?.base_url) setBaseUrl(response.projects[0].base_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PostHog resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getPostHogStatus();
    setConnectionStatus(status);
    if (status.project_id) setProjectId(status.project_id);
    if (status.account_name) setAccountName(status.account_name);
    if (status.region) setRegion(status.region);
    if (status.base_url) setBaseUrl(status.base_url);
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
    if (!projectId.trim() || !apiKey.trim()) {
      setError('Project ID and personal API key are required.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const status = await integrationService.connectPostHog({
        project_id: projectId.trim(),
        personal_api_key: apiKey,
        region,
        base_url: baseUrl.trim() || undefined,
        account_name: accountName.trim() || undefined,
      });
      setConnectionStatus(status);
      setModalState('connected');
      setApiKey('');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect PostHog.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await integrationService.disconnectPostHog();
      setConnectionStatus({ connected: false });
      setModalState('disconnected');
      setReports(FALLBACK_REPORTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect PostHog.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (!currentProjectId) {
      setError('Open or create a Dreamify project before syncing PostHog data.');
      return;
    }
    if (isCustomRange && (!startDate || !endDate)) {
      setError('Choose both start and end dates for a custom PostHog sync.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const run = await syncPostHog({
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
            filename: run.asset.filename || 'posthog.csv',
            size: run.asset.size_bytes || 0,
            ext: run.asset.extension || 'csv',
            status: 'uploaded',
            projectId: run.asset.project_id || currentProjectId,
            sourceType: 'PostHog',
            accountName: connectionStatus?.account_name || connectionStatus?.project_id || 'PostHog',
            propertyName: selectedReport.label,
            rowCount: run.row_count,
            columnCount: run.column_count,
          },
        ]);
      }
      setActiveTab('connected');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync PostHog data.');
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
            throw new Error(result.error || 'Failed to add connected PostHog data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const result = await integrationService.addConnectorEntityToNewProject(run.connectorKey, run.entityId, {
            project_name: `${run.entityName || 'PostHog'} Project`,
            prompt: 'Analyze this PostHog product analytics data and build a product growth dashboard.',
            asset_id: run.asset_id,
          });
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from connected PostHog data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from connected PostHog data.');
        return;
      }
    }

    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'posthog.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'PostHog',
        accountName: run.accountName || connectionStatus?.account_name || connectionStatus?.project_id || 'PostHog',
        propertyName: run.entityName || 'PostHog',
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
              <img src="/posthog.svg" alt="PostHog" className="h-8 w-8" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">Connect PostHog</DialogTitle>
              <DialogDescription>Sync read-only product analytics reports through generated HogQL and saved resources.</DialogDescription>
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
            Checking PostHog connection
          </div>
        ) : modalState === 'disconnected' ? (
          <div className="space-y-5 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="posthog-project-id">Project ID</Label>
                <Input id="posthog-project-id" value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="12345" />
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">US Cloud</SelectItem>
                    <SelectItem value="EU">EU Cloud</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="posthog-base-url">Base URL</Label>
              <Input id="posthog-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://us.posthog.com or self-hosted URL" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="posthog-account-name">Account label</Label>
              <Input id="posthog-account-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Product Analytics" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="posthog-api-key">Personal API key</Label>
              <Input id="posthog-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="phx_..." />
            </div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>Dreamify stores the personal API key encrypted and uses generated, allowlisted HogQL only.</p>
                <p>Connector is inactive in the catalog until connection, sync, schedules, and smoke tests pass.</p>
              </div>
            </div>
            <Button className="w-full" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Connect PostHog
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
                    {connectionStatus?.account_name || connectionStatus?.project_id || 'PostHog'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Project {connectionStatus?.project_id || projectId || 'unknown'} · {connectionStatus?.region || region}
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
                  <Label>Include product-user PII</Label>
                  <p className="text-xs text-muted-foreground">
                    Distinct IDs, emails, names, phones, and person properties are redacted by default.
                  </p>
                </div>
                <Switch checked={includePii} onCheckedChange={setIncludePii} disabled={!canIncludePii} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
                <Button onClick={handleSync} disabled={syncing || loadingResources}>
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sync PostHog
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="connected" className="mt-4">
              <ConnectedEntitiesList connectorKey="posthog" onSelectAsset={handleSelectConnectedAsset} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
