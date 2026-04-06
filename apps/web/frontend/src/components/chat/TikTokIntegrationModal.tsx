import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, TikTokAdAccount, TikTokConnectionStatusResponse } from '@/services/integrationService';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarIcon, Link2, Link2Off, SearchX } from 'lucide-react';
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
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

export default function TikTokIntegrationModal() {
  const {
    isTikTokModalOpen: isOpen,
    setTikTokModalOpen: setOpen,
    currentProjectId,
    syncTikTokAds,
    addFiles,
  } = useChatStore();

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<TikTokConnectionStatusResponse | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Ad account state
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [adAccounts, setAdAccounts] = useState<TikTokAdAccount[]>([]);
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
  useEffect(() => {
    const onSuccess = () => {
      setConnecting(false);
      popupRef.current?.close();
      checkConnectionAndLoad();
    };
    const onError = (msg: string) => {
      setConnecting(false);
      popupRef.current?.close();
      setError(msg || 'TikTok authorization failed.');
    };

    // Primary: BroadcastChannel
    const bc = new BroadcastChannel('tiktok_oauth');
    bc.onmessage = (e) => {
      if (e.data?.type === 'TIKTOK_OAUTH_SUCCESS') onSuccess();
      else if (e.data?.type === 'TIKTOK_OAUTH_ERROR') onError(e.data.error);
    };

    // Fallback: postMessage (for browsers without BroadcastChannel)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TIKTOK_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'TIKTOK_OAUTH_ERROR') onError(event.data.error);
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
    const status = await integrationService.getTikTokConnectionStatus();
    setConnectionStatus(status);
    if (status.connected) {
      loadAdAccounts();
    }
  };

  const loadAdAccounts = async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const response = await integrationService.fetchTikTokAdAccounts();
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
    const baseUrl = integrationService.getTikTokOAuthStartUrl();
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'tiktok_oauth',
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
      await integrationService.disconnectTikTok();
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
      const accountLabel = selectedAccount ? selectedAccount.name : 'TikTok Ads';

      const result = await syncTikTokAds(
        selectedAccountId,
        currentProjectId || undefined,
        isCustomRange ? undefined : datePreset,
        isCustomRange && startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
        isCustomRange && endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
        accountLabel,
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
            sourceType: 'TikTok Ads',
            accountName: accountLabel,
            propertyName: accountLabel,
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
        accountLabel,
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
        sourceType: 'TikTok Ads',
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
      <DialogContent className="sm:max-w-[425px] bg-[#1A1A1A] text-white border-white/10 outline-none z-[200]">
        {!emptyRowsDialog ? (
          <>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <img src="/tiktok.png" alt="TikTok Logo" className="w-8 h-8 object-contain" />
            <DialogTitle className="text-xl font-semibold">Connect TikTok Ads</DialogTitle>
          </div>
          <DialogDescription className="text-gray-400 text-sm">
            Import campaign insights directly from your TikTok Ads account.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">

          {/* ── Connection UI ── */}
          {isConnected && !loadingAccounts ? (
            <div className="flex items-center justify-between p-3 border border-pink-500/30 rounded-lg bg-pink-500/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-md bg-pink-500/20 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4 text-pink-500" />
                </div>
                <span className="text-sm font-medium truncate text-white">
                  TikTok account connected
                </span>
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
          ) : !isConnected ? (
            <div 
              onClick={!connecting ? handleConnect : undefined}
              className={cn(
                "flex items-center justify-between p-3 border border-white/10 rounded-lg bg-[#222] hover:bg-white/5 transition-colors cursor-pointer group",
                connecting && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center shrink-0 group-hover:bg-white/10 transition-colors">
                  {connecting ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <img src="/tiktok.png" alt="" className="w-4 h-4 object-contain opacity-70 group-hover:opacity-100 transition-opacity whitespace-nowrap" />}
                </div>
                <span className="text-sm text-gray-300">Connect with TikTok</span>
              </div>
            </div>
          ) : null}

          {/* ── Error banner ── */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Connected: ad account + date pickers ── */}
          {isConnected && (
            <>
              {loadingAccounts ? (
                <div className="flex flex-col items-center py-6 text-gray-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-2 text-pink-500" />
                  <p className="text-sm">Loading ad accounts…</p>
                </div>
              ) : adAccounts.length === 0 ? (
                <div className="text-center py-5 text-gray-400 text-sm border border-white/10 rounded-lg bg-white/5">
                  No ad accounts found. Make sure your account has access to at least one TikTok Ads account.
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
                        <SelectGroup>
                          <SelectLabel className="text-xs text-gray-500 uppercase tracking-wide px-2 py-1">
                            Ad Accounts
                          </SelectLabel>
                          {adAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id} className="focus:bg-white/10 focus:text-white">
                              {a.name}{a.currency ? ` (${a.currency})` : ''}
                            </SelectItem>
                          ))}
                        </SelectGroup>
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
          <Button
            type="button"
            onClick={handleSync}
            disabled={!isConnected || syncing || !selectedAccountId || adAccounts.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
          >
            {syncing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Syncing…
              </>
            ) : 'Connect & Sync'}
          </Button>
        </DialogFooter>
          </>
        ) : (
          <div className="flex flex-col items-center py-6 animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-6">
              <SearchX className="w-8 h-8 text-orange-400" />
            </div>
            
            <h2 className="text-xl font-semibold text-white mb-2">No insights found</h2>
            
            <p className="text-center text-sm text-gray-400 mb-8 max-w-[300px]">
              TikTok returned no campaign insights for the selected date range. The export only contains schema headers.
            </p>

            <div className="w-full space-y-3">
              <Button 
                type="button"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 shadow-lg shadow-blue-900/20 transition-all font-medium"
                onClick={() => void handleEmptyTryAnotherRange()}
                disabled={discardingEmpty}
              >
                {discardingEmpty ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarIcon className="w-4 h-4 mr-2" />}
                Try another date range
              </Button>
              
              <Button 
                type="button"
                variant="outline"
                className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-all font-medium"
                onClick={handleEmptyKeepSchema}
                disabled={discardingEmpty}
              >
                Keep schema
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
