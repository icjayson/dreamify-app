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
  type MixpanelConnectionStatusResponse,
  type MixpanelNamedResource,
  type MixpanelReportResource,
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

const FALLBACK_REPORTS: MixpanelReportResource[] = [
  { report_type: 'product_overview', label: 'Product Overview', resource: 'all', default: true },
  { report_type: 'events', label: 'Raw Events', resource: 'event' },
  { report_type: 'event_breakdown', label: 'Event Breakdown', resource: 'event' },
  { report_type: 'funnels', label: 'Funnels', resource: 'funnel' },
  { report_type: 'retention', label: 'Retention', resource: 'cohort' },
  { report_type: 'cohorts', label: 'Cohorts', resource: 'cohort' },
  { report_type: 'users', label: 'Users', resource: 'user' },
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
  events: MixpanelNamedResource[],
  funnels: MixpanelNamedResource[],
  cohorts: MixpanelNamedResource[],
): MixpanelNamedResource[] {
  if (['events', 'event_breakdown'].includes(reportType)) return events;
  if (reportType === 'funnels') return funnels;
  if (['retention', 'cohorts'].includes(reportType)) return cohorts;
  return [];
}

export default function MixpanelIntegrationModal() {
  const {
    isMixpanelModalOpen: isOpen,
    setMixpanelModalOpen: setOpen,
    currentProjectId,
    syncMixpanel,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<MixpanelConnectionStatusResponse | null>(null);
  const [projectId, setProjectId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [region, setRegion] = useState('US');
  const [reports, setReports] = useState<MixpanelReportResource[]>(FALLBACK_REPORTS);
  const [events, setEvents] = useState<MixpanelNamedResource[]>([]);
  const [funnels, setFunnels] = useState<MixpanelNamedResource[]>([]);
  const [cohorts, setCohorts] = useState<MixpanelNamedResource[]>([]);
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
    () => getResourcesForReport(reportType, events, funnels, cohorts),
    [cohorts, events, funnels, reportType]
  );
  const isCustomRange = datePreset === 'custom';
  const canIncludePii = reportType === 'events' || reportType === 'users';

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setProjectId('');
    setAccountName('');
    setUsername('');
    setSecret('');
    setRegion('US');
    setReports(FALLBACK_REPORTS);
    setEvents([]);
    setFunnels([]);
    setCohorts([]);
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
      const response = await integrationService.fetchMixpanelResources();
      if (!response.success) throw new Error(response.error || 'Failed to load Mixpanel resources.');
      setReports(response.reports.length ? response.reports : FALLBACK_REPORTS);
      setEvents(response.events || []);
      setFunnels(response.funnels || []);
      setCohorts(response.cohorts || []);
      if (response.projects[0]?.id) setProjectId(response.projects[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Mixpanel resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getMixpanelStatus();
    setConnectionStatus(status);
    if (status.project_id) setProjectId(status.project_id);
    if (status.account_name) setAccountName(status.account_name);
    if (status.region) setRegion(status.region);
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
    if (!projectId.trim() || !username.trim() || !secret.trim()) {
      setError('Project ID, service account username, and service account secret are required.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const status = await integrationService.connectMixpanel({
        project_id: projectId.trim(),
        service_account_username: username.trim(),
        service_account_secret: secret,
        region,
        account_name: accountName.trim() || undefined,
      });
      setConnectionStatus(status);
      setModalState('connected');
      setSecret('');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Mixpanel.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await integrationService.disconnectMixpanel();
      setConnectionStatus({ connected: false });
      setModalState('disconnected');
      setReports(FALLBACK_REPORTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Mixpanel.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (!currentProjectId) {
      setError('Open or create a Dreamify project before syncing Mixpanel data.');
      return;
    }
    if (isCustomRange && (!startDate || !endDate)) {
      setError('Choose both start and end dates for a custom Mixpanel sync.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const run = await syncMixpanel({
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
            filename: run.asset.filename || 'mixpanel.csv',
            size: run.asset.size_bytes || 0,
            ext: run.asset.extension || 'csv',
            status: 'uploaded',
            projectId: run.asset.project_id || currentProjectId,
            sourceType: 'Mixpanel',
            accountName: connectionStatus?.account_name || connectionStatus?.project_id || 'Mixpanel',
            propertyName: selectedReport.label,
            rowCount: run.row_count,
            columnCount: run.column_count,
          },
        ]);
      }
      setActiveTab('connected');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync Mixpanel data.');
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
            throw new Error(result.error || 'Failed to add connected Mixpanel data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const result = await integrationService.addConnectorEntityToNewProject(run.connectorKey, run.entityId, {
            project_name: `${run.entityName || 'Mixpanel'} Project`,
            prompt: 'Analyze this Mixpanel product analytics data and build a product growth dashboard.',
            asset_id: run.asset_id,
          });
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from connected Mixpanel data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from connected Mixpanel data.');
        return;
      }
    }

    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'mixpanel.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Mixpanel',
        accountName: run.accountName || connectionStatus?.account_name || connectionStatus?.project_id || 'Mixpanel',
        propertyName: run.entityName || 'Mixpanel',
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
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-black">
              <img src="/mixpanel.svg" alt="Mixpanel" className="h-8 w-8" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">Connect Mixpanel</DialogTitle>
              <DialogDescription>Sync read-only product analytics reports and bounded event extracts.</DialogDescription>
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
            Checking Mixpanel connection
          </div>
        ) : modalState === 'disconnected' ? (
          <div className="space-y-5 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mixpanel-project-id">Project ID</Label>
                <Input id="mixpanel-project-id" value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="1234567" />
              </div>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="mixpanel-account-name">Account label</Label>
              <Input id="mixpanel-account-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Product Analytics" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mixpanel-username">Service account username</Label>
                <Input id="mixpanel-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="svc_xxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mixpanel-secret">Service account secret</Label>
                <Input id="mixpanel-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="••••••••" />
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>Dreamify stores service-account credentials encrypted and uses read-only query/export APIs.</p>
                <p>Connector is inactive in the catalog until connection, sync, schedules, and smoke tests pass.</p>
              </div>
            </div>
            <Button className="w-full" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Connect Mixpanel
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
                    {connectionStatus?.account_name || connectionStatus?.project_id || 'Mixpanel'}
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
                    Distinct IDs, emails, names, and user properties are redacted by default.
                  </p>
                </div>
                <Switch checked={includePii} onCheckedChange={setIncludePii} disabled={!canIncludePii} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
                <Button onClick={handleSync} disabled={syncing || loadingResources}>
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sync Mixpanel
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="connected" className="mt-4">
              <ConnectedEntitiesList connectorKey="mixpanel" onSelectAsset={handleSelectConnectedAsset} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
