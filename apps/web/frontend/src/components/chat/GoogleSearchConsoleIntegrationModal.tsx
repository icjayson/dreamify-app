import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { AlertCircle, CalendarDays, Loader2, Search, ShieldAlert } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  integrationService,
  type GoogleSearchConsoleConnectionStatusResponse,
  type GoogleSearchConsoleReportResource,
  type GoogleSearchConsoleSearchType,
  type GoogleSearchConsoleSite,
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

const FALLBACK_REPORTS: GoogleSearchConsoleReportResource[] = [
  { report_type: 'search_overview', label: 'Search Overview', dimensions: ['date'], default: true },
  { report_type: 'queries', label: 'Queries', dimensions: ['query'] },
  { report_type: 'pages', label: 'Pages', dimensions: ['page'] },
  { report_type: 'countries', label: 'Countries', dimensions: ['country'] },
  { report_type: 'devices', label: 'Devices', dimensions: ['device'] },
  { report_type: 'dates', label: 'Dates', dimensions: ['date'] },
  { report_type: 'query_page', label: 'Query and Page', dimensions: ['query', 'page'] },
];

const FALLBACK_SEARCH_TYPES: GoogleSearchConsoleSearchType[] = [
  { id: 'web', label: 'Web' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'news', label: 'News' },
  { id: 'discover', label: 'Discover' },
  { id: 'googleNews', label: 'Google News' },
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

export default function GoogleSearchConsoleIntegrationModal() {
  const {
    isGoogleSearchConsoleModalOpen: isOpen,
    setGoogleSearchConsoleModalOpen: setOpen,
    currentProjectId,
    syncGoogleSearchConsole,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<GoogleSearchConsoleConnectionStatusResponse | null>(null);
  const [sites, setSites] = useState<GoogleSearchConsoleSite[]>([]);
  const [reports, setReports] = useState<GoogleSearchConsoleReportResource[]>(FALLBACK_REPORTS);
  const [searchTypes, setSearchTypes] = useState<GoogleSearchConsoleSearchType[]>(FALLBACK_SEARCH_TYPES);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState('');
  const [reportType, setReportType] = useState('search_overview');
  const [searchType, setSearchType] = useState('web');
  const [rowLimit, setRowLimit] = useState(5000);
  const [maxBytesMb, setMaxBytesMb] = useState(10);
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
  const selectedSite = useMemo(
    () => sites.find((site) => site.site_key === siteKey) || sites[0],
    [siteKey, sites]
  );
  const isCustomRange = datePreset === 'custom';

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setSites([]);
    setReports(FALLBACK_REPORTS);
    setSearchTypes(FALLBACK_SEARCH_TYPES);
    setConnecting(false);
    setDisconnecting(false);
    setLoadingResources(false);
    setSyncing(false);
    setError(null);
    setSiteKey('');
    setReportType('search_overview');
    setSearchType('web');
    setRowLimit(5000);
    setMaxBytesMb(10);
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setActiveTab('new');
  }, []);

  const loadResources = useCallback(async () => {
    setLoadingResources(true);
    try {
      const response = await integrationService.fetchGoogleSearchConsoleResources();
      if (!response.success) throw new Error(response.error || 'Failed to load Google Search Console resources.');
      setReports(response.reports.length ? response.reports : FALLBACK_REPORTS);
      setSearchTypes(response.search_types.length ? response.search_types : FALLBACK_SEARCH_TYPES);
      setSites(response.sites || []);
      if (response.sites[0]?.site_key) setSiteKey((current) => current || response.sites[0].site_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Google Search Console resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getGoogleSearchConsoleStatus();
    setConnectionStatus(status);
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
      setError(msg || 'Google Search Console authorization failed.');
    };

    const bc = new BroadcastChannel('google_search_console_oauth');
    bc.onmessage = (event) => {
      if (event.data?.type === 'GOOGLE_SEARCH_CONSOLE_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'GOOGLE_SEARCH_CONSOLE_OAUTH_ERROR') onError(event.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_SEARCH_CONSOLE_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'GOOGLE_SEARCH_CONSOLE_OAUTH_ERROR') onError(event.data.error);
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
    try {
      const token = await getToken();
      const url = integrationService.getGoogleSearchConsoleOAuthStartUrl();
      const popupUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
      popupRef.current = window.open(popupUrl, 'google_search_console_oauth', 'width=720,height=760');
      if (!popupRef.current) throw new Error('Popup blocked. Allow popups and try again.');
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'Failed to start Google Search Console OAuth.');
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await integrationService.disconnectGoogleSearchConsole();
      setConnectionStatus({ connected: false });
      setModalState('disconnected');
      setSites([]);
      setReports(FALLBACK_REPORTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Google Search Console.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (!currentProjectId) {
      setError('Open or create a Dreamify project before syncing Google Search Console data.');
      return;
    }
    if (!selectedSite?.site_key) {
      setError('Choose a verified Search Console property before syncing.');
      return;
    }
    if (isCustomRange && (!startDate || !endDate)) {
      setError('Choose both start and end dates for a custom Search Console sync.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const run = await syncGoogleSearchConsole({
        report_type: reportType,
        project_id: currentProjectId,
        site_key: selectedSite.site_key,
        site_url: selectedSite.site_url,
        search_type: searchType,
        date_preset: datePreset,
        start_date: isCustomRange ? formatInputDate(startDate) : undefined,
        end_date: isCustomRange ? formatInputDate(endDate) : undefined,
        row_limit: rowLimit,
        max_bytes: Math.max(1, maxBytesMb) * 1024 * 1024,
      });
      if (run.asset) {
        addFiles([
          {
            fileID: run.asset.asset_id,
            filename: run.asset.filename || 'google-search-console.csv',
            size: run.asset.size_bytes || 0,
            ext: run.asset.extension || 'csv',
            status: 'uploaded',
            projectId: run.asset.project_id || currentProjectId,
            sourceType: 'Google Search Console',
            accountName: selectedSite.site_url || connectionStatus?.account_name || 'Google Search Console',
            propertyName: selectedReport.label,
            rowCount: run.row_count,
            columnCount: run.column_count,
          },
        ]);
      }
      setActiveTab('connected');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync Google Search Console data.');
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
            throw new Error(result.error || 'Failed to add connected Search Console data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const result = await integrationService.addConnectorEntityToNewProject(run.connectorKey, run.entityId, {
            project_name: `${run.entityName || 'Search Console'} Project`,
            prompt: 'Analyze this Google Search Console data and build an organic search performance dashboard.',
            asset_id: run.asset_id,
          });
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from connected Search Console data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from connected Search Console data.');
        return;
      }
    }

    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'google-search-console.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Google Search Console',
        accountName: run.accountName || selectedSite?.site_url || connectionStatus?.account_name || 'Google Search Console',
        propertyName: run.entityName || 'Search Console',
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
              <Search className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">Connect Google Search Console</DialogTitle>
              <DialogDescription>Sync read-only organic search and SEO performance reports.</DialogDescription>
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
            Checking Search Console connection
          </div>
        ) : modalState === 'disconnected' ? (
          <div className="space-y-5 py-2">
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>Dreamify will request read-only Search Console access for verified properties.</p>
                <p>Connector is inactive until OAuth, sync, schedules, and smoke tests are passed.</p>
              </div>
            </div>
            <Button className="w-full" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Connect Google Search Console
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
                  <p className="truncate font-medium">{connectionStatus?.account_name || 'Google Search Console'}</p>
                  <p className="text-xs text-muted-foreground">
                    {sites.length ? `${sites.length} verified propert${sites.length === 1 ? 'y' : 'ies'}` : 'No verified properties loaded'}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  Disconnect
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Search Console property</Label>
                <Select value={selectedSite?.site_key || siteKey} onValueChange={setSiteKey} disabled={loadingResources || sites.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingResources ? 'Loading properties...' : 'Choose a property'} />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.site_key} value={site.site_key}>
                        {site.site_url}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  <Label>Search type</Label>
                  <Select value={searchType} onValueChange={setSearchType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {searchTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>Search Console can anonymize low-volume/private queries and fresh data may be incomplete.</p>
                <p>Dreamify stores the final API result as CSV-compatible data for Morpheus today.</p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button onClick={handleSync} disabled={syncing || loadingResources || sites.length === 0}>
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sync Search Console
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="connected" className="mt-4">
              <ConnectedEntitiesList connectorKey="google_search_console" onSelectAsset={handleSelectConnectedAsset} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
