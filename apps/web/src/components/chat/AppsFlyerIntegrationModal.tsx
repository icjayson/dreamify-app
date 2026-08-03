import React, { useCallback, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { integrationService, AppsFlyerApp, AppsFlyerConnectionStatusResponse } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarDays, Eye, EyeOff, Smartphone } from 'lucide-react';
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

type ModalState = 'checking' | 'disconnected' | 'connected';

export default function AppsFlyerIntegrationModal() {
  const {
    isAppsFlyerModalOpen: isOpen,
    setAppsFlyerModalOpen: setOpen,
    currentProjectId,
    syncAppsFlyer,
    addFiles,
  } = useChatStore();

  // Connection state machine
  const [modalState, setModalState] = useState<ModalState>('checking');
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // App list state
  const [loadingApps, setLoadingApps] = useState(false);
  const [apps, setApps] = useState<AppsFlyerApp[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>('');

  // Date state
  const [datePreset, setDatePreset] = useState<string>('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyRowsDialog, setEmptyRowsDialog] = useState<{
    asset: AssetRecord;
    appLabel: string;
    columnCount: number;
  } | null>(null);
  const [discardingEmpty, setDiscardingEmpty] = useState(false);
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');

  const isCustomRange = datePreset === 'custom';
  const onClose = () => setOpen(false);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  const resetState = useCallback(() => {
    setModalState('checking');
    setApiToken('');
    setShowToken(false);
    setApps([]);
    setSelectedAppId('');
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setError(null);
    setConnecting(false);
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
    setActiveTab('new');
  }, []);

  const loadApps = useCallback(async () => {
    setLoadingApps(true);
    setError(null);
    try {
      const response = await integrationService.fetchAppsFlyerApps();
      if (response.success) {
        setApps(response.apps || []);
        if (response.apps?.length > 0) {
          setSelectedAppId(response.apps[0].app_id);
        }
      } else {
        setError(response.error || 'Failed to load apps.');
      }
    } catch {
      setError('An unexpected error occurred while loading apps.');
    } finally {
      setLoadingApps(false);
    }
  }, []);

  // ── Connection check ─────────────────────────────────────────────────────

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getAppsFlyerStatus();
    if (status.connected) {
      setModalState('connected');
      void loadApps();
    } else {
      setModalState('disconnected');
    }
  }, [loadApps]);

  useEffect(() => {
    if (isOpen) {
      void checkConnectionStatus();
    } else {
      resetState();
    }
  }, [checkConnectionStatus, isOpen, resetState]);

  // ── Connect (token validation) ───────────────────────────────────────────

  const handleConnect = async () => {
    if (!apiToken.trim()) {
      setError('Please enter your AppsFlyer API token.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const result = await integrationService.connectAppsFlyer(apiToken.trim());
      if (result.success) {
        setApiToken('');
        setModalState('connected');
        loadApps();
      } else {
        setError(result.error || 'Failed to validate token. Please check and try again.');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await integrationService.disconnectAppsFlyer();
      setApps([]);
      setSelectedAppId('');
      setModalState('disconnected');
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  // ── Sync ─────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    if (!selectedAppId) {
      setError('Please select an app.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const selectedApp = apps.find((a) => a.app_id === selectedAppId);
      const appLabel = selectedApp?.app_name || selectedAppId;
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;

      const result = await syncAppsFlyer(
        selectedAppId,
        appLabel,
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
            sourceType: 'AppsFlyer',
            accountName: appLabel,
            propertyName: selectedAppId,
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
        appLabel,
        columnCount: result.column_count,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred during sync.');
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
      sourceType: 'AppsFlyer',
      accountName: run.accountName || run.entityName || 'AppsFlyer',
      propertyName: 'AppsFlyer',
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
        sourceType: 'AppsFlyer',
        accountName: emptyRowsDialog.appLabel,
        propertyName: emptyRowsDialog.appLabel,
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
                  <div className="w-8 h-8 flex items-center justify-center">
                    <Smartphone className="w-6 h-6 text-violet-400" />
                  </div>
                  <DialogTitle className="text-xl font-semibold">Connect AppsFlyer</DialogTitle>
                </div>
            <DialogDescription className="text-muted-foreground text-sm">
                  Import mobile attribution data from your AppsFlyer account.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">

                {/* ── Checking ── */}
                {modalState === 'checking' && (
                  <div className={modalStyles.loadingCompact}>
                    <Loader2 className="w-6 h-6 animate-spin mb-2 text-violet-500" />
                    <p className="text-sm">Checking connection…</p>
                  </div>
                )}

                {/* ── Disconnected: token input ── */}
                {modalState === 'disconnected' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className={modalStyles.label}>API Token</label>
                      <div className="relative">
                        <Input
                          type={showToken ? 'text' : 'password'}
                          placeholder="Paste your AppsFlyer API token"
                          value={apiToken}
                          onChange={(e) => setApiToken(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !connecting && handleConnect()}
                          className="bg-background border-border text-foreground placeholder:text-muted-foreground pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className={modalStyles.subtleText}>
                        Find your token in AppsFlyer{' '}
                        <span className="text-muted-foreground">→ username dropdown → Security center → Manage your AppsFlyer tokens</span>
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Connected: app select + date range ── */}
                {modalState === 'connected' && (
                  <>
                    <div className="flex items-center justify-between p-3 border border-violet-500/30 rounded-lg bg-violet-500/10">
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

                    {loadingApps ? (
                      <div className={modalStyles.loadingCompact}>
                        <Loader2 className="w-6 h-6 animate-spin mb-2 text-violet-500" />
                        <p className="text-sm">Loading apps…</p>
                      </div>
                    ) : apps.length === 0 ? (
                      <div className={modalStyles.emptyStateCompact}>
                        No apps found. Make sure your API token has access to at least one app.
                      </div>
                    ) : (
                      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                        <TabsList className={modalStyles.tabsListWithMargin}>
                          <TabsTrigger value="new" className={modalStyles.tabsTrigger}>Connect New</TabsTrigger>
                          <TabsTrigger value="connected" className={modalStyles.tabsTrigger}>Select Connected</TabsTrigger>
                        </TabsList>

                        <TabsContent value="new" className="space-y-4 outline-none">
                          <div className="space-y-2">
                            <label className={modalStyles.label}>App</label>
                            <Select value={selectedAppId} onValueChange={setSelectedAppId}>
                              <SelectTrigger className={modalStyles.selectTrigger}>
                                <SelectValue placeholder="Select an app" />
                              </SelectTrigger>
                              <SelectContent className={modalStyles.selectContent}>
                                {apps.map((app) => (
                                  <SelectItem key={app.app_id} value={app.app_id} className="data-[highlighted]:bg-violet-500/15 data-[highlighted]:text-violet-600 dark:data-[highlighted]:text-violet-300">
                                    {app.app_name}{app.platform ? ` (${app.platform})` : ''}
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
                            connectorKey="appsflyer"
                            onSelectAsset={handleSelectConnectedAsset}
                          />
                        </TabsContent>
                      </Tabs>
                    )}
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
                    disabled={connecting || !apiToken.trim()}
                    className="bg-violet-600 hover:bg-violet-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Validating…
                      </>
                    ) : (
                      'Validate & Save'
                    )}
                  </Button>
                )}

                {modalState === 'connected' && !loadingApps && apps.length > 0 && (
                  <Button
                    type="button"
                    onClick={handleSync}
                    disabled={activeTab === 'connected' || syncing || !selectedAppId}
                    className={`bg-violet-600 hover:bg-violet-700 text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
                  >
                    {syncing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing…
                      </>
                    ) : (
                      'Connect & Sync'
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
                  The partners report for <span className="text-foreground font-medium">{emptyRowsDialog.appLabel}</span> returned 0 rows for the selected date range.
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
                  className="bg-violet-600 hover:bg-violet-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
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
