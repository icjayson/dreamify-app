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
  type QuickBooksConnectionStatusResponse,
  type QuickBooksReportResource,
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
  { value: 'last_180d', label: 'Last 180 days' },
  { value: 'custom', label: 'Custom range' },
];

const FALLBACK_REPORTS: QuickBooksReportResource[] = [
  { report_type: 'finance_overview', label: 'Finance Overview', resource: 'reports', default: true },
  { report_type: 'profit_and_loss', label: 'Profit and Loss', resource: 'reports' },
  { report_type: 'balance_sheet', label: 'Balance Sheet', resource: 'reports' },
  { report_type: 'cash_flow', label: 'Cash Flow', resource: 'reports' },
  { report_type: 'invoices', label: 'Invoices', resource: 'Invoice' },
  { report_type: 'bills', label: 'Bills', resource: 'Bill' },
  { report_type: 'payments', label: 'Payments', resource: 'Payment' },
  { report_type: 'customers', label: 'Customers', resource: 'Customer' },
  { report_type: 'vendors', label: 'Vendors', resource: 'Vendor' },
  { report_type: 'items', label: 'Items', resource: 'Item' },
  { report_type: 'accounts', label: 'Accounts', resource: 'Account' },
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

export default function QuickBooksIntegrationModal() {
  const {
    isQuickBooksModalOpen: isOpen,
    setQuickBooksModalOpen: setOpen,
    currentProjectId,
    syncQuickBooks,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<QuickBooksConnectionStatusResponse | null>(null);
  const [reports, setReports] = useState<QuickBooksReportResource[]>(FALLBACK_REPORTS);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState('finance_overview');
  const [accountingBasis, setAccountingBasis] = useState('Accrual');
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
  const isEntityReport = !['finance_overview', 'profit_and_loss', 'balance_sheet', 'cash_flow'].includes(reportType);

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setReports(FALLBACK_REPORTS);
    setConnecting(false);
    setDisconnecting(false);
    setLoadingResources(false);
    setSyncing(false);
    setError(null);
    setReportType('finance_overview');
    setAccountingBasis('Accrual');
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
      const response = await integrationService.fetchQuickBooksResources();
      if (!response.success) throw new Error(response.error || 'Failed to load QuickBooks resources.');
      setReports(response.reports.length ? response.reports : FALLBACK_REPORTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load QuickBooks resources.');
    } finally {
      setLoadingResources(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getQuickBooksStatus();
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
      setError(msg || 'QuickBooks authorization failed.');
    };

    const bc = new BroadcastChannel('quickbooks_oauth');
    bc.onmessage = (event) => {
      if (event.data?.type === 'QUICKBOOKS_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'QUICKBOOKS_OAUTH_ERROR') onError(event.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'QUICKBOOKS_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'QUICKBOOKS_OAUTH_ERROR') onError(event.data.error);
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
      const url = integrationService.getQuickBooksOAuthStartUrl();
      const popupUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
      popupRef.current = window.open(popupUrl, 'quickbooks_oauth', 'width=720,height=760');
      if (!popupRef.current) throw new Error('Popup blocked. Allow popups and try again.');
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'Failed to start QuickBooks OAuth.');
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await integrationService.disconnectQuickBooks();
      setConnectionStatus({ connected: false });
      setModalState('disconnected');
      setReports(FALLBACK_REPORTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect QuickBooks.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    if (!currentProjectId) {
      setError('Open or create a Dreamify project before syncing QuickBooks data.');
      return;
    }
    if (includePii && !isEntityReport) {
      setIncludePii(false);
    }
    if (isCustomRange && (!startDate || !endDate)) {
      setError('Choose both start and end dates for a custom QuickBooks sync.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const run = await syncQuickBooks({
        report_type: reportType,
        project_id: currentProjectId,
        date_preset: datePreset,
        start_date: isCustomRange ? formatInputDate(startDate) : undefined,
        end_date: isCustomRange ? formatInputDate(endDate) : undefined,
        row_limit: rowLimit,
        include_pii: isEntityReport ? includePii : false,
        max_bytes: Math.max(1, maxBytesMb) * 1024 * 1024,
        accounting_basis: accountingBasis,
        resource_id: selectedReport.resource || 'all',
      });
      if (run.asset) {
        addFiles([
          {
            fileID: run.asset.asset_id,
            filename: run.asset.filename || 'quickbooks.csv',
            size: run.asset.size_bytes || 0,
            ext: run.asset.extension || 'csv',
            status: 'uploaded',
            projectId: run.asset.project_id || currentProjectId,
            sourceType: 'QuickBooks',
            accountName: connectionStatus?.company_name || 'QuickBooks',
            propertyName: selectedReport.label,
            rowCount: run.row_count,
            columnCount: run.column_count,
          },
        ]);
      }
      setActiveTab('connected');
      void loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync QuickBooks data.');
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
            throw new Error(result.error || 'Failed to add connected QuickBooks data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const result = await integrationService.addConnectorEntityToNewProject(run.connectorKey, run.entityId, {
            project_name: `${run.entityName || 'QuickBooks'} Project`,
            prompt: 'Analyze this QuickBooks finance data and build an operating dashboard.',
            asset_id: run.asset_id,
          });
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from connected QuickBooks data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from connected QuickBooks data.');
        return;
      }
    }

    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'quickbooks.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'QuickBooks',
        accountName: run.accountName || connectionStatus?.company_name || 'QuickBooks',
        propertyName: run.entityName || 'QuickBooks',
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
              <img src="/quickbooks.svg" alt="QuickBooks" className="h-8 w-8" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">Connect QuickBooks</DialogTitle>
              <DialogDescription>Sync read-only finance and accounting reports.</DialogDescription>
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
            Checking QuickBooks connection
          </div>
        ) : modalState === 'disconnected' ? (
          <div className="space-y-5 py-2">
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>Dreamify will request QuickBooks accounting access for read-only analytics sync.</p>
                <p>Connector is inactive until OAuth, sync, schedules, and smoke tests are passed.</p>
              </div>
            </div>
            <Button className="w-full" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Connect QuickBooks
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
                    {connectionStatus?.company_name || connectionStatus?.realm_id || 'QuickBooks'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {connectionStatus?.environment || 'production'} · minor version {connectionStatus?.minor_version || '75'}
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
                  <Label>Accounting basis</Label>
                  <Select value={accountingBasis} onValueChange={setAccountingBasis}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Accrual">Accrual</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
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
                  <Label>Include customer/vendor PII</Label>
                  <p className="text-xs text-muted-foreground">
                    Applies only to entity reports. Statement reports stay non-PII.
                  </p>
                </div>
                <Switch checked={includePii} onCheckedChange={setIncludePii} disabled={!isEntityReport} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button onClick={handleSync} disabled={syncing || loadingResources}>
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sync QuickBooks
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="connected" className="mt-4">
              <ConnectedEntitiesList connectorKey="quickbooks" onSelectAsset={handleSelectConnectedAsset} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
