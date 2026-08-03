import React, { useCallback, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, GoogleAdsAccount } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarDays, Link2, ShieldCheck } from 'lucide-react';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';
import { useGoogleConnectorAuth } from '@/hooks/useGoogleConnectorAuth';
import { GOOGLE_CONNECTOR_SCOPES } from '@/constants/googleScopes';
import { sanitizeConnectorError, isOAuthScopeError } from '@/utils/connectorErrors';
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

  const resetState = useCallback(() => {
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
  }, [clearAuthError]);

  const checkConnectionStatus = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Try loading data immediately (optimistic). If the backend reports
      // missing scopes, the modal switches to its grant-access state.
      void checkConnectionStatus();
    } else {
      resetState();
    }
  }, [checkConnectionStatus, isOpen, resetState]);

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
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;

      const result = await syncGoogleAds(
        selectedAccountId,
        promptProjectId || undefined,
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
        <DialogContent className={modalStyles.content}>
          {!emptyRowsDialog ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <img src="/google-ads.png" alt="Google Ads Logo" className="w-8 h-8 object-contain" />
                  <DialogTitle className="text-xl font-semibold">Connect Google Ads</DialogTitle>
                </div>
            <DialogDescription className="text-muted-foreground text-sm">
                  Import campaigns, adsets, and performance metrics from your Google Ads account.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">
                {(modalState === 'checking' || isAuthorizing) && (
                  <div className={modalStyles.loading}>
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
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Google Ads access required</p>
                        <p className={`${modalStyles.subtleText} mt-0.5`}>
                          {isGoogleLinked
                            ? 'Grant Ads permission to your connected Google account.'
                            : 'Connect your Google account and grant Ads permission.'}
                        </p>
                      </div>
                    </div>
                    {displayError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{displayError}</span>
                      </div>
                    )}
                    <Button
                      onClick={handleGrantAccess}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium w-full"
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
                        <span className={modalStyles.connectedText}>Google account connected</span>
                      </div>
                    </div>

                    {error ? (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    ) : accounts.length === 0 ? (
                      <div className={modalStyles.emptyState}>
                        No Google Ads accounts found under this connected account.
                      </div>
                    ) : (
                      <>
                        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                          <TabsList className={modalStyles.tabsListWithMargin}>
                            <TabsTrigger value="new" className={modalStyles.tabsTrigger}>Connect New Ad Account</TabsTrigger>
                            <TabsTrigger value="connected" className={modalStyles.tabsTrigger}>Select Connected Ad Account</TabsTrigger>
                          </TabsList>

                          <TabsContent value="new" className="space-y-4 outline-none">
                            <div className="space-y-2">
                              <label className={modalStyles.label}>Ad Account</label>
                              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                                <SelectTrigger className={modalStyles.selectTrigger}>
                                  <SelectValue placeholder="Select an ad account" />
                                </SelectTrigger>
                                <SelectContent className={modalStyles.selectContent}>
                                  {accounts.map((acct) => (
                                    <SelectItem key={acct.id} value={acct.id} className="data-[highlighted]:bg-blue-500/15 data-[highlighted]:text-blue-700 dark:data-[highlighted]:text-blue-300">
                                      <div className="flex flex-col">
                                        <span>{acct.name}</span>
                                        <span className={modalStyles.selectMetaText}>{acct.source_type} account</span>
                                      </div>
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
                                    <SelectItem key={preset.value} value={preset.value} className="data-[highlighted]:bg-blue-500/15 data-[highlighted]:text-blue-700 dark:data-[highlighted]:text-blue-300">
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
                  className={modalStyles.ghostButton}
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
                <DialogDescription className="text-muted-foreground text-sm">
                  The <span className="text-foreground font-medium">{emptyRowsDialog.reportLabel}</span> ad account returned 0 rows for the selected date range.
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
