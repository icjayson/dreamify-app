import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
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
  type ZendeskConnectionStatusResponse,
  type ZendeskReportResource,
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

const FALLBACK_REPORTS: ZendeskReportResource[] = [
  { report_type: 'support_overview', label: 'Support Overview', resource: 'all', default: true },
  { report_type: 'tickets', label: 'Tickets', resource: 'tickets' },
  { report_type: 'ticket_events', label: 'Ticket Events', resource: 'ticket_events' },
  { report_type: 'users', label: 'Users', resource: 'users' },
  { report_type: 'organizations', label: 'Organizations', resource: 'organizations' },
  { report_type: 'groups', label: 'Groups', resource: 'groups' },
  { report_type: 'satisfaction_ratings', label: 'Satisfaction Ratings', resource: 'satisfaction_ratings' },
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

function normalizeSubdomainInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.zendesk\.com$/, '');
}

export default function ZendeskIntegrationModal() {
  const {
    isZendeskModalOpen: isOpen,
    setZendeskModalOpen: setOpen,
    currentProjectId,
    syncZendesk,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<ZendeskConnectionStatusResponse | null>(null);
  const [subdomain, setSubdomain] = useState('');
  const [reports, setReports] = useState<ZendeskReportResource[]>(FALLBACK_REPORTS);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState('support_overview');
  const [rowLimit, setRowLimit] = useState(5000);
  const [maxBytesMb, setMaxBytesMb] = useState(10);
  const [includePii, setIncludePii] = useState(false);
  const [datePreset, setDatePreset] = useState('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');
  const popupRef = useRef<Window | null>(null);
  const { getToken } = useAuth();

  const selectedReport = useMemo(
    () => reports.find((report) => report.report_type === reportType) || FALLBACK_REPORTS[0],
    [reportType, reports]
  );
  const isCustomRange = datePreset === 'custom';
  const canIncludePii = ['tickets', 'users', 'organizations'].includes(reportType);

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setSubdomain('');
    setReports(FALLBACK_REPORTS);
    setConnecting(false);
    setDisconnecting(false);
    setLoadingResources(false);
    setSyncing(false);
    setError(null);
    setReportType('support_overview');
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
      const response = await integrationService.fetchZendeskResources();
      if (!response.success) throw new Error(response.error || 'Failed to load Zendesk resources.');
      setReports(response.reports.length ? response.reports : FALLBACK_REPORTS);
      if (response.accounts[0]?.subdomain) setSubdomain(response.accounts[0].subdomain);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Zendesk resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getZendeskStatus();
    setConnectionStatus(status);
    if (status.subdomain) setSubdomain(status.subdomain);
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
      setError(msg || 'Zendesk authorization failed.');
    };

    const bc = new BroadcastChannel('zendesk_oauth');
    bc.onmessage = (event) => {
      if (event.data?.type === 'ZENDESK_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'ZENDESK_OAUTH_ERROR') onError(event.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ZENDESK_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'ZENDESK_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);
    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, [checkConnectionStatus]);

  const handleConnect = async () => {
    const normalizedSubdomain = normalizeSubdomainInput(subdomain);
    if (!normalizedSubdomain) {
      setError('Enter your Zendesk subdomain before connecting.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const token = await getToken();
      const url = integrationService.getZendeskOAuthStartUrl(normalizedSubdomain);
      const popupUrl = token ? `${url}&token=${encodeURIComponent(token)}` : url;
      popupRef.current = window.open(popupUrl, 'zendesk_oauth', 'width=720,height=760');
      if (!popupRef.current) throw new Error('Popup blocked. Allow popups and try again.');
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'Failed to start Zendesk OAuth.');
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await integrationService.disconnectZendesk();
      setConnectionStatus({ connected: false });
      setModalState('disconnected');
      setReports(FALLBACK_REPORTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Zendesk.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (!currentProjectId) {
      setError('Open or create a Dreamify project before syncing Zendesk data.');
      return;
    }
    if (includePii && !canIncludePii) {
      setIncludePii(false);
    }
    if (isCustomRange && (!startDate || !endDate)) {
      setError('Choose both start and end dates for a custom Zendesk sync.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const run = await syncZendesk({
        report_type: reportType,
        project_id: currentProjectId,
        date_preset: datePreset,
        start_date: isCustomRange ? formatInputDate(startDate) : undefined,
        end_date: isCustomRange ? formatInputDate(endDate) : undefined,
        row_limit: rowLimit,
        include_pii: canIncludePii ? includePii : false,
        max_bytes: Math.max(1, maxBytesMb) * 1024 * 1024,
        resource_id: selectedReport.resource || 'all',
      });
      if (run.asset) {
        addFiles([
          {
            fileID: run.asset.asset_id,
            filename: run.asset.filename || 'zendesk.csv',
            size: run.asset.size_bytes || 0,
            ext: run.asset.extension || 'csv',
            status: 'uploaded',
            projectId: run.asset.project_id || currentProjectId,
            sourceType: 'Zendesk',
            accountName: connectionStatus?.account_name || connectionStatus?.subdomain || 'Zendesk',
            propertyName: selectedReport.label,
            rowCount: run.row_count,
            columnCount: run.column_count,
          },
        ]);
      }
      setActiveTab('connected');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync Zendesk data.');
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
            throw new Error(result.error || 'Failed to add connected Zendesk data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const result = await integrationService.addConnectorEntityToNewProject(run.connectorKey, run.entityId, {
            project_name: `${run.entityName || 'Zendesk'} Project`,
            prompt: 'Analyze this Zendesk support data and build a customer success dashboard.',
            asset_id: run.asset_id,
          });
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from connected Zendesk data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from connected Zendesk data.');
        return;
      }
    }

    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'zendesk.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Zendesk',
        accountName: run.accountName || connectionStatus?.account_name || connectionStatus?.subdomain || 'Zendesk',
        propertyName: run.entityName || 'Zendesk',
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
              <img src="/zendesk.svg" alt="Zendesk" className="h-8 w-8" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">Connect Zendesk</DialogTitle>
              <DialogDescription>Sync read-only support and customer success reports.</DialogDescription>
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
            Checking Zendesk connection
          </div>
        ) : modalState === 'disconnected' ? (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="zendesk-subdomain">Zendesk subdomain</Label>
              <div className="flex gap-2">
                <Input
                  id="zendesk-subdomain"
                  value={subdomain}
                  onChange={(event) => setSubdomain(event.target.value)}
                  placeholder="company"
                />
                <div className="flex items-center rounded-md border px-3 text-sm text-muted-foreground">
                  .zendesk.com
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>Dreamify will request Zendesk Support read access for analytics sync.</p>
                <p>Connector is inactive until OAuth, sync, schedules, and smoke tests are passed.</p>
              </div>
            </div>
            <Button className="w-full" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Connect Zendesk
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
                    {connectionStatus?.account_name || connectionStatus?.subdomain || 'Zendesk'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {connectionStatus?.subdomain ? `${connectionStatus.subdomain}.zendesk.com` : 'Zendesk Support'}
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Row cap</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={rowLimit}
                    onChange={(event) => setRowLimit(Number(event.target.value || 1))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Byte cap MB</Label>
                  <Input
                    type="number"
                    min={1}
                    value={maxBytesMb}
                    onChange={(event) => setMaxBytesMb(Number(event.target.value || 1))}
                  />
                </div>
              </div>

              {isCustomRange && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      Start
                    </Label>
                    <Input
                      type="date"
                      value={formatInputDate(startDate)}
                      onChange={(event) => setStartDate(event.target.value ? new Date(event.target.value) : undefined)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      End
                    </Label>
                    <Input
                      type="date"
                      value={formatInputDate(endDate)}
                      onChange={(event) => setEndDate(event.target.value ? new Date(event.target.value) : undefined)}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
                <div>
                  <Label>Include support PII</Label>
                  <p className="text-xs text-muted-foreground">
                    Redacted by default for users, organizations, and ticket requester fields.
                  </p>
                </div>
                <Switch checked={includePii} onCheckedChange={setIncludePii} disabled={!canIncludePii} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button onClick={handleSync} disabled={syncing || loadingResources}>
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sync Zendesk
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="connected" className="mt-4">
              <ConnectedEntitiesList connectorKey="zendesk" onSelectAsset={handleSelectConnectedAsset} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
