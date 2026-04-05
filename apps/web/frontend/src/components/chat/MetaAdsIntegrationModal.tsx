import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, MetaAdAccount, MetaConnectionStatusResponse } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarIcon, Link2, Link2Off } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/chat/useChatStore';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

export default function MetaAdsIntegrationModal() {
  const {
    isMetaAdsModalOpen: isOpen,
    setMetaAdsModalOpen: setOpen,
    currentProjectId,
    syncMetaAds,
    addFiles,
  } = useChatStore();

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<MetaConnectionStatusResponse | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Ad account state
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  // Date state
  const [datePreset, setDatePreset] = useState<string>('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When sync returns 0 insight rows, user chooses discard vs keep schema */
  const [emptyRowsDialog, setEmptyRowsDialog] = useState<{
    asset: AssetRecord;
    accountLabel: string;
    columnCount: number;
  } | null>(null);
  const [discardingEmpty, setDiscardingEmpty] = useState(false);

  const { getToken } = useAuth();
  const popupRef = useRef<Window | null>(null);
  const isCustomRange = datePreset === 'custom';

  const onClose = () => setOpen(false);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      checkConnectionAndLoad();
    } else {
      resetState();
    }
  }, [isOpen]);

  // Listen for OAuth result via BroadcastChannel (primary) and postMessage (fallback).
  // BroadcastChannel survives window.opener being cleared by Facebook's COOP headers.
  useEffect(() => {
    const onSuccess = () => {
      setConnecting(false);
      popupRef.current?.close();
      checkConnectionAndLoad();
    };
    const onError = (msg: string) => {
      setConnecting(false);
      popupRef.current?.close();
      setError(msg || 'Meta authorization failed.');
    };

    // Primary: BroadcastChannel
    const bc = new BroadcastChannel('meta_oauth');
    bc.onmessage = (e) => {
      if (e.data?.type === 'META_OAUTH_SUCCESS') onSuccess();
      else if (e.data?.type === 'META_OAUTH_ERROR') onError(e.data.error);
    };

    // Fallback: postMessage (for browsers without BroadcastChannel)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'META_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'META_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);

    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const resetState = () => {
    setConnectionStatus(null);
    setAdAccounts([]);
    setSelectedAccountId('');
    setDatePreset('last_30d');
    setStartDate(subDays(new Date(), 30));
    setEndDate(new Date());
    setError(null);
    setConnecting(false);
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
  };

  // ── Connection check + ad account load ───────────────────────────────────

  const checkConnectionAndLoad = async () => {
    setError(null);
    const status = await integrationService.getMetaConnectionStatus();
    setConnectionStatus(status);
    if (status.connected) {
      loadAdAccounts();
    }
  };

  const loadAdAccounts = async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const response = await integrationService.fetchMetaAdAccounts();
      if (response.success) {
        setAdAccounts(response.ad_accounts || []);
        if (response.ad_accounts?.length > 0) {
          setSelectedAccountId(response.ad_accounts[0].id);
        }
      } else {
        setError(response.error || 'Failed to load ad accounts.');
      }
    } catch {
      setError('An unexpected error occurred while loading ad accounts.');
    } finally {
      setLoadingAccounts(false);
    }
  };

  // ── OAuth popup ───────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const token = await getToken();
    const baseUrl = integrationService.getMetaOAuthStartUrl();
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'meta_oauth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    popupRef.current = popup;

    // Fallback: detect if popup was closed without completing
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        if (connecting) {
          setConnecting(false);
        }
      }
    }, 500);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await integrationService.disconnectMeta();
      setConnectionStatus({ connected: false });
      setAdAccounts([]);
      setSelectedAccountId('');
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  // ── Sync ─────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    if (!selectedAccountId) {
      setError('Please select an ad account.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const selectedAccount = adAccounts.find((a) => a.id === selectedAccountId);
      const result = await syncMetaAds(
        selectedAccountId,
        currentProjectId || undefined,
        isCustomRange ? undefined : datePreset,
        isCustomRange && startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
        isCustomRange && endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
        selectedAccount?.name,
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
            sourceType: 'Meta Ads',
            accountName: selectedAccount?.name || 'Meta Ads',
            propertyName: selectedAccount?.name || result.asset.filename,
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
        accountLabel: selectedAccount?.name || 'Meta Ads',
        columnCount: result.column_count,
      });
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during sync.');
    } finally {
      setSyncing(false);
    }
  };

  const handleEmptyDiscard = async () => {
    if (!emptyRowsDialog) return;
    setDiscardingEmpty(true);
    try {
      const del = await fileService.deleteFile(emptyRowsDialog.asset.asset_id);
      if (!del.success) {
        setError(del.error || 'Could not remove the empty export. You can delete it from project files later.');
      }
      setEmptyRowsDialog(null);
      setOpen(false);
    } finally {
      setDiscardingEmpty(false);
    }
  };

  /** Delete empty export and return to the sync form to pick another date range */
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
        sourceType: 'Meta Ads',
        accountName: emptyRowsDialog.accountLabel,
        propertyName: emptyRowsDialog.accountLabel,
        rowCount: 0,
        columnCount: emptyRowsDialog.columnCount,
        schemaOnly: true,
      },
    ]);
    setEmptyRowsDialog(null);
    setOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const isConnected = connectionStatus?.connected === true;

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px] bg-[#1A1A1A] text-white border-white/10 outline-none z-[200]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <img src="/meta.png" alt="Meta Logo" className="w-8 h-8 object-contain" />
            <DialogTitle className="text-xl font-semibold">Connect Meta Ads</DialogTitle>
          </div>
          <DialogDescription className="text-gray-400 text-sm">
            Import campaign insights directly from your Meta Ads account.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">

          {/* ── Connection status bar ── */}
          <div className={cn(
            "flex items-center justify-between px-3 py-2 rounded-lg border text-sm",
            isConnected
              ? "bg-green-500/10 border-green-500/20 text-green-300"
              : "bg-white/5 border-white/10 text-gray-400"
          )}>
            <div className="flex items-center gap-2">
              {isConnected
                ? <Link2 className="w-4 h-4" />
                : <Link2Off className="w-4 h-4" />}
              <span>{isConnected ? 'Facebook account connected' : 'Not connected'}</span>
            </div>
            {isConnected && (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs text-gray-400 hover:text-red-400 transition-colors"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>

          {/* ── Error banner ── */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Not connected: connect button ── */}
          {!isConnected && (
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting to Meta…
                </>
              ) : (
                <>
                  <img src="/meta.png" alt="" className="w-4 h-4 mr-2 object-contain" />
                  Connect with Meta
                </>
              )}
            </Button>
          )}

          {/* ── Connected: ad account + date pickers ── */}
          {isConnected && (
            <>
              {loadingAccounts ? (
                <div className="flex flex-col items-center py-6 text-gray-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-2 text-blue-500" />
                  <p className="text-sm">Loading ad accounts…</p>
                </div>
              ) : adAccounts.length === 0 ? (
                <div className="text-center py-5 text-gray-400 text-sm border border-white/10 rounded-lg bg-white/5">
                  No ad accounts found. Make sure your Facebook account has access to at least one Meta Ads account.
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-200">Ad Account</label>
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                        <SelectValue placeholder="Select an ad account" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#2A2A2A] border-white/10 text-white z-[201]">
                        {adAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id} className="focus:bg-white/10 focus:text-white">
                            {account.name}
                            {account.currency ? ` (${account.currency})` : ''}
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-200">Start Date</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className={cn("w-full justify-start text-left font-normal bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white", !startDate && "text-muted-foreground")}>
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
                            <Button variant="outline" className={cn("w-full justify-start text-left font-normal bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white", !endDate && "text-muted-foreground")}>
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
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} className="text-gray-400 hover:text-white hover:bg-white/10" disabled={syncing}>
            Cancel
          </Button>
          {isConnected && adAccounts.length > 0 && (
            <Button
              type="button"
              onClick={handleSync}
              disabled={syncing || !selectedAccountId}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Syncing…
                </>
              ) : 'Connect & Sync'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!emptyRowsDialog}>
      <AlertDialogContent className="bg-[#1A1A1A] border-white/10 text-white z-[210] sm:max-w-[440px]">
        <AlertDialogHeader>
          <AlertDialogTitle>No insights in this range</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-400">
            Meta returned no campaign insights for the selected ad account and date range (the export has column
            headers only). You can pick a wider range, keep the schema in the project for reference, or discard this
            export.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end w-full">
            <Button
              type="button"
              variant="outline"
              className="border-white/20 bg-transparent text-gray-300 hover:bg-white/10 hover:text-white"
              disabled={discardingEmpty}
              onClick={() => void handleEmptyTryAnotherRange()}
            >
              Try another range
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={discardingEmpty}
              onClick={() => void handleEmptyDiscard()}
            >
              {discardingEmpty ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Removing…
                </>
              ) : (
                'Discard & close'
              )}
            </Button>
          </div>
          <Button
            type="button"
            className="bg-blue-600 hover:bg-blue-700 text-white w-full"
            disabled={discardingEmpty}
            onClick={handleEmptyKeepSchema}
          >
            Keep schema in project
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
