import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { integrationService, AppsFlyerApp, AppsFlyerConnectionStatusResponse } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarIcon, Eye, EyeOff, Smartphone } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';

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
  const [startDate, setStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
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

  const resetState = () => {
    setModalState('checking');
    setApiToken('');
    setShowToken(false);
    setApps([]);
    setSelectedAppId('');
    setDatePreset('last_30d');
    setStartDate(subDays(new Date(), 30));
    setEndDate(new Date());
    setError(null);
    setConnecting(false);
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
  };

  // ── Connection check ─────────────────────────────────────────────────────

  const checkConnectionStatus = async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getAppsFlyerStatus();
    if (status.connected) {
      setModalState('connected');
      loadApps();
    } else {
      setModalState('disconnected');
    }
  };

  const loadApps = async () => {
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
  };

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

      const result = await syncAppsFlyer(
        selectedAppId,
        appLabel,
        currentProjectId || undefined,
        isCustomRange ? undefined : datePreset,
        isCustomRange && startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
        isCustomRange && endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
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
        <DialogContent className="sm:max-w-[425px] bg-[#1A1A1A] text-white border-white/10 outline-none z-[200]">
          {!emptyRowsDialog ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-8 h-8 flex items-center justify-center">
                    <Smartphone className="w-6 h-6 text-violet-400" />
                  </div>
                  <DialogTitle className="text-xl font-semibold">Connect AppsFlyer</DialogTitle>
                </div>
                <DialogDescription className="text-gray-400 text-sm">
                  Import mobile attribution data from your AppsFlyer account.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">

                {/* ── Checking ── */}
                {modalState === 'checking' && (
                  <div className="flex flex-col items-center py-6 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin mb-2 text-violet-500" />
                    <p className="text-sm">Checking connection…</p>
                  </div>
                )}

                {/* ── Disconnected: token input ── */}
                {modalState === 'disconnected' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-200">API Token</label>
                      <div className="relative">
                        <Input
                          type={showToken ? 'text' : 'password'}
                          placeholder="Paste your AppsFlyer API token"
                          value={apiToken}
                          onChange={(e) => setApiToken(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !connecting && handleConnect()}
                          className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                        >
                          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        Find your token in AppsFlyer{' '}
                        <span className="text-gray-400">→ username dropdown → Security center → Manage your AppsFlyer tokens</span>
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
                        <span className="text-sm font-medium text-white">Connected</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-gray-400 hover:text-white hover:bg-white/10 px-2"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                      >
                        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </Button>
                    </div>

                    {loadingApps ? (
                      <div className="flex flex-col items-center py-6 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mb-2 text-violet-500" />
                        <p className="text-sm">Loading apps…</p>
                      </div>
                    ) : apps.length === 0 ? (
                      <div className="text-center py-5 text-gray-400 text-sm border border-white/10 rounded-lg bg-white/5">
                        No apps found. Make sure your API token has access to at least one app.
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-200">App</label>
                          <Select value={selectedAppId} onValueChange={setSelectedAppId}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                              <SelectValue placeholder="Select an app" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#2A2A2A] border-white/10 text-white z-[201]">
                              {apps.map((app) => (
                                <SelectItem key={app.app_id} value={app.app_id} className="focus:bg-white/10 focus:text-white">
                                  {app.app_name}{app.platform ? ` (${app.platform})` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-200">Date Range</label>
                          <Select value={datePreset} onValueChange={setDatePreset}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                              <SelectValue placeholder="Select date range" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#2A2A2A] border-white/10 text-white z-[201]">
                              {DATE_PRESETS.map((preset) => (
                                <SelectItem key={preset.value} value={preset.value} className="focus:bg-white/10 focus:text-white">
                                  {preset.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {isCustomRange && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-gray-200">Start Date</label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      'w-full justify-start text-left font-normal bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white',
                                      !startDate && 'text-muted-foreground',
                                    )}
                                  >
                                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                                    <span className="truncate">{startDate ? format(startDate, 'dd/MM/yy') : 'Pick a date'}</span>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 bg-[#2A2A2A] border-white/10 text-white z-[201]">
                                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-gray-200">End Date</label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      'w-full justify-start text-left font-normal bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white',
                                      !endDate && 'text-muted-foreground',
                                    )}
                                  >
                                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                                    <span className="truncate">{endDate ? format(endDate, 'dd/MM/yy') : 'Pick a date'}</span>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 bg-[#2A2A2A] border-white/10 text-white z-[201]">
                                  <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus />
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                {/* ── Error banner ── */}
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm">
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
                  className="text-gray-400 hover:text-white hover:bg-white/10"
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
                    disabled={syncing || !selectedAppId}
                    className="bg-violet-600 hover:bg-violet-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
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
                <DialogDescription className="text-gray-400 text-sm">
                  The partners report for <span className="text-white font-medium">{emptyRowsDialog.appLabel}</span> returned 0 rows for the selected date range.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 text-sm text-gray-400">
                You can try a different date range, or keep the empty file with just the column headers (schema only).
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleEmptyTryAnotherRange}
                  disabled={discardingEmpty}
                  className="text-gray-400 hover:text-white hover:bg-white/10"
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
