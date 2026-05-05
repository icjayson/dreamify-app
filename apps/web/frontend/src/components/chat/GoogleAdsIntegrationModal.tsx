import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, GoogleAdsAccount } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarDays, Link2, ShieldCheck } from 'lucide-react';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';
import { useGoogleConnectorAuth } from '@/hooks/useGoogleConnectorAuth';
import { GOOGLE_CONNECTOR_SCOPES } from '@/constants/googleScopes';
import { sanitizeConnectorError, isOAuthScopeError } from '@/utils/connectorErrors';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
];

type ModalState = 'checking' | 'needs_scopes' | 'connected';

export default function GoogleAdsIntegrationModal() {
  const {
    isGoogleAdsModalOpen: isOpen,
    setGoogleAdsModalOpen: setOpen,
    currentProjectId,
    syncGoogleAds,
    addFiles,
  } = useChatStore();

  const {
    isGoogleLinked,
    isAuthorizing,
    error: authError,
    requestScopes,
    clearError: clearAuthError,
  } = useGoogleConnectorAuth({ connectorKey: 'google-ads' });

  // Connection state machine
  const [modalState, setModalState] = useState<ModalState>('checking');
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

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

  const isCustomRange = datePreset === 'custom';
  const onClose = () => setOpen(false);

  useEffect(() => {
    if (isOpen) {
      initModal();
    } else {
      resetState();
    }
  }, [isOpen]);

  const resetState = () => {
    setModalState('checking');
    setAccounts([]);
    setSelectedAccountId('');
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setError(null);
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
    clearAuthError();
    setActiveTab('new');
  };

  const initModal = async () => {
    // Try loading data immediately (optimistic)
    // If backend says token is bad, we'll show the grant button
    await checkConnectionStatus();
  };

  const checkConnectionStatus = async () => {
    setModalState('checking');
    setError(null);
    try {
      const response = await integrationService.fetchGoogleAdsAccounts();
      if (response.success) {
        setAccounts(response.ad_accounts || []);
        if (response.ad_accounts && response.ad_accounts.length > 0) {
          setSelectedAccountId(response.ad_accounts[0].id);
        }
        setModalState('connected');
      } else {
        const rawErr = response.error || 'Failed to fetch Google Ads accounts.';
        // Developer token errors are config issues, not user scope issues
        const isDeveloperTokenError = /developer.token/i.test(rawErr);
        if (!isDeveloperTokenError && isOAuthScopeError(rawErr)) {
          setError(sanitizeConnectorError(rawErr, 'Google Ads'));
          setModalState('needs_scopes');
        } else {
          setError(sanitizeConnectorError(rawErr, 'Google Ads'));
          setModalState('connected');
        }
      }
    } catch (err) {
      setError('Something went wrong while connecting to Google Ads. Please try again.');
      setModalState('connected');
    }
  };

  const handleGrantAccess = async () => {
    await requestScopes(GOOGLE_CONNECTOR_SCOPES['Google Ads']);
    // If requestScopes redirected, we won't reach here.
    await checkConnectionStatus();
  };

  const handleSync = async () => {
    if (!selectedAccountId) {
      setError('Please select an Ad Account to sync.');
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
      const accountLabel = selectedAccount?.name || 'Google Ads';

      const result = await syncGoogleAds(
        selectedAccountId,
        currentProjectId || undefined,
        isCustomRange && startDate ? formatDateForApi(startDate) : undefined,
        isCustomRange && endDate ? formatDateForApi(endDate) : undefined,
        accountLabel
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
            sourceType: 'Google Ads',
            accountName: accountLabel,
            propertyName: 'Campaigns',
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
        reportLabel: accountLabel,
        columnCount: result.column_count,
      });
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'An unexpected error occurred during sync.';
      if (isOAuthScopeError(rawMsg)) {
        setModalState('needs_scopes');
      }
      setError(sanitizeConnectorError(rawMsg, 'Google Ads'));
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectConnectedAsset = (run: any) => {
    if (!run.asset_id) return;
    const file = {
      fileID: run.asset_id,
      filename: run.asset_filename || 'data.csv',
      size: run.config_snapshot?.size_bytes || 0,
      ext: 'csv',
      status: 'uploaded' as const,
      sourceType: 'Google Ads',
      accountName: run.accountName || run.entityName || 'Google Ads',
      propertyName: 'Campaigns',
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
        sourceType: 'Google Ads',
        accountName: emptyRowsDialog.reportLabel,
        propertyName: 'Campaigns',
        rowCount: 0,
        columnCount: emptyRowsDialog.columnCount,
        schemaOnly: true,
      },
    ]);
    setEmptyRowsDialog(null);
    setOpen(false);
  };

  const displayError = authError || error;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[425px] bg-[#1A1A1A] text-white border-white/10 outline-none z-[200]">
          {!emptyRowsDialog ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <img src="/google-ads.png" alt="Google Ads Logo" className="w-8 h-8 object-contain" />
                  <DialogTitle className="text-xl font-semibold">Connect Google Ads</DialogTitle>
                </div>
                <DialogDescription className="text-gray-400 text-sm">
                  Import campaigns, adsets, and performance metrics from your Google Ads account.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">
                {(modalState === 'checking' || isAuthorizing) && (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#4285F4]" />
                    <p className="text-sm">
                      {isAuthorizing ? 'Requesting Google Ads access…' : 'Checking connection…'}
                    </p>
                  </div>
                )}

                {modalState === 'needs_scopes' && !isAuthorizing && (
                  <div className="p-5 bg-[#4285F4]/10 border border-[#4285F4]/20 rounded-lg flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#4285F4]/20 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4 text-[#4285F4]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-blue-300">Google Ads access required</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {isGoogleLinked
                            ? 'Grant Ads permission to your connected Google account.'
                            : 'Connect your Google account and grant Ads permission.'}
                        </p>
                      </div>
                    </div>
                    {displayError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{displayError}</span>
                      </div>
                    )}
                    <Button
                      onClick={handleGrantAccess}
                      className="bg-white text-black hover:bg-gray-100 text-sm font-medium w-full"
                    >
                      {isGoogleLinked ? 'Grant Ads Access' : 'Connect Google Account'}
                    </Button>
                  </div>
                )}

                {modalState === 'connected' && (
                  <>
                    <div className="flex items-center justify-between p-3 border border-[#4285F4]/30 rounded-lg bg-[#4285F4]/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-md bg-[#4285F4]/20 flex items-center justify-center shrink-0">
                          <Link2 className="w-4 h-4 text-[#4285F4]" />
                        </div>
                        <span className="text-sm font-medium truncate text-white">Google account connected</span>
                      </div>
                    </div>

                    {error ? (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    ) : accounts.length === 0 ? (
                      <div className="text-center py-6 text-gray-400 text-sm border border-white/10 rounded-lg bg-white/5">
                        No Google Ads accounts found under this connected account.
                      </div>
                    ) : (
                      <>
                        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                          <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/10 p-1 rounded-lg mb-4">
                            <TabsTrigger value="new" className="data-[state=active]:bg-[#3A3A3A] data-[state=active]:text-white rounded-md text-sm transition-all">Connect New Ad Account</TabsTrigger>
                            <TabsTrigger value="connected" className="data-[state=active]:bg-[#3A3A3A] data-[state=active]:text-white rounded-md text-sm transition-all">Select Connected Ad Account</TabsTrigger>
                          </TabsList>

                          <TabsContent value="new" className="space-y-4 outline-none">
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-gray-200">Ad Account</label>
                              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                                  <SelectValue placeholder="Select an ad account" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-white/10 text-white z-[201]">
                                  {accounts.map((acct) => (
                                    <SelectItem key={acct.id} value={acct.id} className="focus:bg-white/10 focus:text-white">
                                      <div className="flex flex-col">
                                        <span>{acct.name}</span>
                                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">{acct.source_type} account</span>
                                      </div>
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
                                  <div className="relative">
                                    <input
                                      type="date"
                                      value={startDate ? formatDateForApi(startDate) : ''}
                                      onChange={(e) => setStartDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                                      className="date-input-themed w-full px-3 py-2 pr-10 rounded-md border border-white/10 bg-white/5 text-sm text-white"
                                    />
                                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white" />
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-gray-200">End Date</label>
                                  <div className="relative">
                                    <input
                                      type="date"
                                      value={endDate ? formatDateForApi(endDate) : ''}
                                      onChange={(e) => setEndDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                                      className="date-input-themed w-full px-3 py-2 pr-10 rounded-md border border-white/10 bg-white/5 text-sm text-white"
                                    />
                                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white" />
                                  </div>
                                </div>
                              </div>
                            )}
                          </TabsContent>
                          <TabsContent value="connected" className="outline-none">
                            <ConnectedEntitiesList
                              connectorKey="google_ads"
                              onSelectAsset={handleSelectConnectedAsset}
                            />
                          </TabsContent>
                        </Tabs>
                      </>
                    )}
                  </>
                )}
              </div>

              <DialogFooter className="sm:justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  className="text-gray-400 hover:text-white hover:bg-white/10"
                  disabled={syncing}
                >
                  Cancel
                </Button>

                {modalState === 'connected' && accounts.length > 0 && !error && (
                  <Button
                    type="button"
                    onClick={handleSync}
                    disabled={activeTab === 'connected' || syncing || !selectedAccountId}
                    className={`bg-[#4285F4] hover:bg-[#3367d6] text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
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
                <DialogDescription className="text-gray-400 text-sm">
                  The <span className="text-white font-medium">{emptyRowsDialog.reportLabel}</span> ad account returned 0 rows for the selected date range.
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
                  className="bg-[#4285F4] hover:bg-[#3367d6] text-white font-medium px-4 py-2 rounded-md transition-colors"
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
