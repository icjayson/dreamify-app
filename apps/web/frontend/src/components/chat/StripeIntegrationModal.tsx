import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, StripeConnectionStatusResponse } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarDays } from 'lucide-react';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';
import { connectorModalStyles as modalStyles } from './connectorModalStyles';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
];

const REPORT_TYPES = [
  { value: 'charges', label: 'Charges (Revenue)' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'customers', label: 'Customers' },
];

type ModalState = 'checking' | 'disconnected' | 'connected';

export default function StripeIntegrationModal() {
  const {
    isStripeModalOpen: isOpen,
    setStripeModalOpen: setOpen,
    currentProjectId,
    syncStripe,
    addFiles,
  } = useChatStore();

  // Connection state machine
  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<StripeConnectionStatusResponse | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Report type
  const [reportType, setReportType] = useState<string>('charges');

  // Date state
  const [datePreset, setDatePreset] = useState<string>('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyRowsDialog, setEmptyRowsDialog] = useState<{
    asset: AssetRecord;
    reportLabel: string;
    columnCount: number;
  } | null>(null);
  const [discardingEmpty, setDiscardingEmpty] = useState(false);
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');

  const { getToken } = useAuth();
  const popupRef = useRef<Window | null>(null);
  const isCustomRange = datePreset === 'custom';
  const onClose = () => setOpen(false);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      checkConnectionStatus();
    } else {
      resetState();
    }
  }, [isOpen]);

  // Listen for OAuth result via BroadcastChannel (primary) and postMessage (fallback)
  useEffect(() => {
    const onSuccess = () => {
      setConnecting(false);
      popupRef.current?.close();
      checkConnectionStatus();
    };
    const onError = (msg: string) => {
      setConnecting(false);
      popupRef.current?.close();
      setError(msg || 'Stripe authorization failed.');
    };

    const bc = new BroadcastChannel('stripe_oauth');
    bc.onmessage = (e) => {
      if (e.data?.type === 'STRIPE_OAUTH_SUCCESS') onSuccess();
      else if (e.data?.type === 'STRIPE_OAUTH_ERROR') onError(e.data.error);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'STRIPE_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'STRIPE_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);

    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const resetState = () => {
    setModalState('checking');
    setConnectionStatus(null);
    setReportType('charges');
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setError(null);
    setConnecting(false);
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
    setActiveTab('new');
  };

  // ── Connection check ─────────────────────────────────────────────────────

  const checkConnectionStatus = async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getStripeStatus();
    setConnectionStatus(status);
    if (status.connected) {
      setModalState('connected');
    } else {
      setModalState('disconnected');
    }
  };

  // ── OAuth popup ───────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const token = await getToken();
    const baseUrl = integrationService.getStripeOAuthStartUrl();
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'stripe_oauth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    popupRef.current = popup;

    // Detect popup closed without completing OAuth (no stale-closure check needed)
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
      await integrationService.disconnectStripe();
      setConnectionStatus(null);
      setModalState('disconnected');
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  // ── Sync ─────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const reportLabel = REPORT_TYPES.find((r) => r.value === reportType)?.label || reportType;
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;

      const result = await syncStripe(
        reportType,
        promptProjectId || undefined,
        isCustomRange ? undefined : datePreset,
        isCustomRange && startDate ? formatDateForApi(startDate) : undefined,
        isCustomRange && endDate ? formatDateForApi(endDate) : undefined,
      );

      if (result.row_count > 0) {
        addFiles([
          {
            fileID: result.asset.asset_id,
            filename: result.asset.filename,
            size: result.asset.size_bytes || 0,
            ext: result.asset.extension || 'csv',
            status: 'uploaded',
            projectId: result.asset.project_id || undefined,
            sourceType: 'Stripe',
            accountName: reportLabel,
            propertyName: reportType,
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
        reportLabel,
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

  const handleSelectConnectedAsset = async (run: any) => {
    if (!run.asset_id) return;
    const existingProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
    let resolvedProjectId = existingProjectId || undefined;
    let selectedAsset: any = null;
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
          const projectName = `${run.entityName || run.accountName || 'Connected Data'} Project`;
          const defaultPrompt = 'Analyze this data and build a dashboard.';
          const result = await integrationService.addConnectorEntityToNewProject(
            run.connectorKey,
            run.entityId,
            { project_name: projectName, prompt: defaultPrompt, asset_id: run.asset_id }
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
    } else {
      resolvedProjectId = run.project_id || resolvedProjectId;
    }
    const file = {
      fileID: selectedAsset?.asset_id || run.asset_id,
      filename: selectedAsset?.filename || run.asset_filename || 'data.csv',
      size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
      ext: selectedAsset?.extension || 'csv',
      status: 'uploaded' as const,
      projectId: resolvedProjectId,
      sourceType: 'Stripe',
      accountName: run.accountName || run.entityName || 'Stripe',
      propertyName: run.entityName || 'Stripe',
      syncVersionName: run.sync_version_name || run.version_name,
    };
    useChatStore.getState().addFiles([file]);
    onClose();
  };

  const handleEmptyTryAnotherRange = async () => {
    if (!emptyRowsDialog) return;
    setDiscardingEmpty(true);
    try {
      const del = await fileService.deleteFile(emptyRowsDialog.asset.asset_id);
      if (!del.success) {
        setError(del.error || 'Could not remove the empty export.');
      }
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
        sourceType: 'Stripe',
        accountName: emptyRowsDialog.reportLabel,
        propertyName: emptyRowsDialog.reportLabel,
        rowCount: 0,
        columnCount: emptyRowsDialog.columnCount,
        schemaOnly: true,
      },
    ]);
    setEmptyRowsDialog(null);
    setOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className={modalStyles.content}>
          {!emptyRowsDialog ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-8 h-8 flex items-center justify-center overflow-hidden rounded">
                    <img src="/stripe.png" alt="Stripe" className="w-8 h-8 rounded object-cover" />
                  </div>
                  <DialogTitle className="text-xl font-semibold">Connect Stripe</DialogTitle>
                </div>
            <DialogDescription className="text-muted-foreground text-sm">
                  Import charges, subscriptions, or customer data from your Stripe account.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">

                {/* ── Checking ── */}
                {modalState === 'checking' && (
                  <div className={modalStyles.loadingCompact}>
                    <Loader2 className="w-6 h-6 animate-spin mb-2 text-[#635BFF]" />
                    <p className="text-sm">Checking connection…</p>
                  </div>
                )}

                {/* ── Disconnected: OAuth connect button ── */}
                {modalState === 'disconnected' && (
                  <div className="space-y-4">
                    <div className={modalStyles.infoPanel}>
                      <p>Dreamify will request <span className="text-foreground font-medium">read access</span> to your Stripe account to sync:</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li>Charges &amp; payment data</li>
                        <li>Subscriptions</li>
                        <li>Customer records</li>
                      </ul>
                    </div>
                    <p className={modalStyles.subtleText}>
                      You'll be redirected to Stripe to authorize access. Your secret key is never shared with Dreamify.
                    </p>
                  </div>
                )}

                {/* ── Connected: report type + date range ── */}
                {modalState === 'connected' && (
                  <>
                    <div className="flex items-center justify-between p-3 border border-[#635BFF]/30 rounded-lg bg-[#635BFF]/10">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                        <span className="text-sm font-medium text-foreground">Connected</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={modalStyles.ghostButtonSmall}
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                      >
                        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </Button>
                    </div>

                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-4">
                      <TabsList className={modalStyles.tabsListWithMargin}>
                        <TabsTrigger value="new" className={modalStyles.tabsTrigger}>Connect New</TabsTrigger>
                        <TabsTrigger value="connected" className={modalStyles.tabsTrigger}>Select Connected</TabsTrigger>
                      </TabsList>

                      <TabsContent value="new" className="space-y-4 outline-none">
                        <div className="space-y-2">
                          <label className={modalStyles.label}>Report Type</label>
                          <Select value={reportType} onValueChange={setReportType}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder="Select report type" />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              {REPORT_TYPES.map((rt) => (
                                <SelectItem key={rt.value} value={rt.value} className="data-[highlighted]:bg-violet-500/15 data-[highlighted]:text-violet-600 dark:data-[highlighted]:text-violet-300">
                                  {rt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className={modalStyles.label}>Date Range</label>
                          <Select value={datePreset} onValueChange={setDatePreset}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder="Select date range" />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              {DATE_PRESETS.map((preset) => (
                                <SelectItem key={preset.value} value={preset.value} className="data-[highlighted]:bg-violet-500/15 data-[highlighted]:text-violet-600 dark:data-[highlighted]:text-violet-300">
                                  {preset.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {isCustomRange && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className={modalStyles.label}>Start Date</label>
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
                              <label className={modalStyles.label}>End Date</label>
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
                      </TabsContent>
                      <TabsContent value="connected" className="outline-none">
                        <ConnectedEntitiesList
                          connectorKey="stripe"
                          onSelectAsset={handleSelectConnectedAsset}
                        />
                      </TabsContent>
                    </Tabs>
                  </>
                )}

                {/* ── Error banner ── */}
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <DialogFooter className="sm:justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  className={modalStyles.ghostButton}
                  disabled={connecting || syncing}
                >
                  Cancel
                </Button>

                {modalState === 'disconnected' && (
                  <Button
                    type="button"
                    onClick={handleConnect}
                    disabled={connecting}
                    className="bg-[#635BFF] hover:bg-[#5248E8] text-white font-medium px-4 py-2 rounded-md transition-colors"
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting…
                      </>
                    ) : (
                      'Connect with Stripe'
                    )}
                  </Button>
                )}

                {modalState === 'connected' && (
                  <Button
                    type="button"
                    onClick={handleSync}
                    disabled={activeTab === 'connected' || syncing}
                    className={`bg-[#635BFF] hover:bg-[#5248E8] text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
                  >
                    {syncing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing…
                      </>
                    ) : (
                      'Sync Data'
                    )}
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-semibold">No data found</DialogTitle>
                <DialogDescription className="text-muted-foreground text-sm">
                  The <span className="text-foreground font-medium">{emptyRowsDialog.reportLabel}</span> report returned 0 rows for the selected date range.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 text-sm text-muted-foreground">
                You can try a different date range, or keep the empty file with just the column headers (schema only).
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleEmptyTryAnotherRange}
                  disabled={discardingEmpty}
                  className={modalStyles.ghostButton}
                >
                  {discardingEmpty ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Try different dates
                </Button>
                <Button
                  type="button"
                  onClick={handleEmptyKeepSchema}
                  disabled={discardingEmpty}
                  className="bg-[#635BFF] hover:bg-[#5248E8] text-white font-medium px-4 py-2 rounded-md transition-colors"
                >
                  Keep schema
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
