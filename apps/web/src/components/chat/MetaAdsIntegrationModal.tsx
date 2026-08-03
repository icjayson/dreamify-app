import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, MetaAdAccount, MetaConnectionStatusResponse, MetaCampaign, MetaAdSet } from '@/services/integrationService';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarDays, Link2, Link2Off, SearchX, Search } from 'lucide-react';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';
import { connectorModalStyles as modalStyles } from './connectorModalStyles';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
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

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());

  const [adsets, setAdsets] = useState<MetaAdSet[]>([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [adsetSearch, setAdsetSearch] = useState('');
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<Set<string>>(new Set());

  // Date state
  const [datePreset, setDatePreset] = useState<string>('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  // Business management scope flag: null=unknown, true=has scope, false=lacks scope
  const [hasBizMgmt, setHasBizMgmt] = useState<boolean | null>(null);

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
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');

  const popupRef = useRef<Window | null>(null);
  const isCustomRange = datePreset === 'custom';

  const onClose = () => setOpen(false);

  const resetState = useCallback(() => {
    setConnectionStatus(null);
    setAdAccounts([]);
    setSelectedAccountId('');
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setError(null);
    setConnecting(false);
    setHasBizMgmt(null);
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);

    setStep(1);
    setCampaigns([]);
    setSelectedCampaignIds(new Set());
    setCampaignSearch('');
    setAdsets([]);
    setSelectedAdsetIds(new Set());
    setAdsetSearch('');
    setActiveTab('new');
  }, []);

  // ── Connection check + ad account load ───────────────────────────────────

  const loadAdAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const response = await integrationService.fetchMetaAdAccounts();
      if (response.success) {
        setAdAccounts(response.ad_accounts || []);
        setHasBizMgmt(response.has_business_management ?? null);
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
  }, []);

  const checkConnectionAndLoad = useCallback(async () => {
    setError(null);
    const status = await integrationService.getMetaConnectionStatus();
    setConnectionStatus(status);
    if (status.connected) {
      void loadAdAccounts();
    }
  }, [loadAdAccounts]);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      void checkConnectionAndLoad();
    } else {
      resetState();
    }
  }, [checkConnectionAndLoad, isOpen, resetState]);

  // Listen for OAuth result via BroadcastChannel (primary) and postMessage (fallback).
  // BroadcastChannel survives window.opener being cleared by Facebook's COOP headers.
  useEffect(() => {
    const onSuccess = () => {
      setConnecting(false);
      popupRef.current?.close();
      void checkConnectionAndLoad();
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
  }, [checkConnectionAndLoad]);

  // ── OAuth popup ───────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const baseUrl = integrationService.getMetaOAuthStartUrl();
    const url = baseUrl;
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

  const handleNextToCampaigns = async () => {
    if (!selectedAccountId) return;
    setLoadingCampaigns(true);
    setStep(2);
    try {
      const dateArg = isCustomRange ? undefined : datePreset;
      const startArg = isCustomRange && startDate ? formatDateForApi(startDate) : undefined;
      const endArg = isCustomRange && endDate ? formatDateForApi(endDate) : undefined;
      const res = await integrationService.fetchMetaCampaigns(selectedAccountId, dateArg, startArg, endArg);
      if (res.success) {
        setCampaigns(res.campaigns);
        setSelectedCampaignIds(new Set(res.campaigns.map((c) => c.id)));
      } else {
        setError(res.error || 'Failed to fetch campaigns');
        setStep(1);
      }
    } catch {
      setError('Failed to fetch campaigns');
      setStep(1);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const handleNextToAdSets = async () => {
    if (selectedCampaignIds.size === 0) return;
    setLoadingAdsets(true);
    setStep(3);
    try {
      const res = await integrationService.fetchMetaAdSets(selectedAccountId, Array.from(selectedCampaignIds));
      if (res.success) {
        setAdsets(res.adsets);
        setSelectedAdsetIds(new Set(res.adsets.map((a) => a.id)));
      } else {
        setError(res.error || 'Failed to fetch adsets');
        setStep(2);
      }
    } catch {
      setError('Failed to fetch adsets');
      setStep(2);
    } finally {
      setLoadingAdsets(false);
    }
  };

  const handleSync = async () => {
    if (!selectedAccountId) {
      setError('Please select an ad account.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const selectedAccount = adAccounts.find((a) => a.id === selectedAccountId);
      const accountLabel = selectedAccount
        ? selectedAccount.source_type === 'business' && selectedAccount.business_name
          ? `${selectedAccount.business_name} — ${selectedAccount.name}`
          : selectedAccount.name
        : 'Meta Ads';
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;

      const result = await syncMetaAds(
        selectedAccountId,
        promptProjectId || undefined,
        isCustomRange ? undefined : datePreset,
        isCustomRange && startDate ? formatDateForApi(startDate) : undefined,
        isCustomRange && endDate ? formatDateForApi(endDate) : undefined,
        accountLabel,
        Array.from(selectedAdsetIds),
        Array.from(selectedCampaignIds)
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
      } catch (err: any) {
        setError(err?.message || 'Failed to create project context from connected data.');
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
      sourceType: 'Meta Ads',
      accountName: run.accountName || run.entityName || 'Meta Ads',
      propertyName: 'Campaigns',
      syncVersionName: run.sync_version_name || run.version_name,
    };
    useChatStore.getState().addFiles([file]);
    onClose();
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
        <DialogContent className={modalStyles.content}>
          {!emptyRowsDialog ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <img src="/meta.png" alt="Meta Logo" className="w-8 h-8 object-contain" />
                  <DialogTitle className="text-xl font-semibold">Connect Meta Ads</DialogTitle>
                </div>
                <DialogDescription className="text-muted-foreground text-sm">
                  Import campaign insights directly from your Meta Ads account.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">

                {/* ── Connection UI ── */}
                {isConnected && !loadingAccounts ? (
                  <div className="flex items-center justify-between p-3 border border-blue-500/30 rounded-lg bg-blue-500/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-md bg-blue-500/20 flex items-center justify-center shrink-0">
                        <Link2 className="w-4 h-4 text-blue-500" />
                      </div>
                      <span className={modalStyles.connectedText}>
                        Facebook account connected
                      </span>
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
                ) : !isConnected ? (
                  <div
                    onClick={!connecting ? handleConnect : undefined}
                    className={cn(
                      modalStyles.disconnectedCard,
                      connecting && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={modalStyles.disconnectedIcon}>
                        {connecting ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /> : <img src="/meta.png" alt="" className="w-4 h-4 object-contain opacity-70 group-hover:opacity-100 transition-opacity" />}
                      </div>
                      <span className={modalStyles.disconnectedText}>Connect with Meta</span>
                    </div>
                  </div>
                ) : null}

                {/* ── Error banner ── */}
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* ── Connected: ad account + date pickers ── */}
                {isConnected && step === 1 && (
                  <>
                    {loadingAccounts ? (
                      <div className={modalStyles.loadingCompact}>
                        <Loader2 className="w-6 h-6 animate-spin mb-2 text-blue-500" />
                        <p className="text-sm">Loading ad accounts…</p>
                      </div>
                    ) : adAccounts.length === 0 ? (
                      <div className={modalStyles.emptyStateCompact}>
                        No ad accounts found. Make sure your Facebook account has access to at least one Meta Ads account.
                      </div>
                    ) : (
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
                                {/* Personal accounts group */}
                                {(() => {
                                  const personal = adAccounts.filter(a => a.source_type === 'personal');
                                  const bizGroups = adAccounts.reduce<Record<string, MetaAdAccount[]>>((acc, a) => {
                                    if (a.source_type === 'business' && a.business_name) {
                                      const k = a.business_id ?? a.business_name;
                                      acc[k] = [...(acc[k] ?? []), a];
                                    }
                                    return acc;
                                  }, {});
                                  const hasBizAccounts = Object.keys(bizGroups).length > 0;

                                  return (
                                    <>
                                      {personal.length > 0 && (
                                        <SelectGroup>
                                          {hasBizAccounts && (
                                            <SelectLabel className={modalStyles.selectLabel}>
                                              Personal
                                            </SelectLabel>
                                          )}
                                          {personal.map(a => (
                                            <SelectItem key={a.id} value={a.id} className="data-[highlighted]:bg-blue-500/15 data-[highlighted]:text-blue-700 dark:data-[highlighted]:text-blue-300">
                                              {a.name}{a.currency ? ` (${a.currency})` : ''}
                                            </SelectItem>
                                          ))}
                                        </SelectGroup>
                                      )}
                                      {Object.entries(bizGroups).map(([k, accounts]) => (
                                        <SelectGroup key={k}>
                                          <SelectLabel className={modalStyles.selectLabel}>
                                            {accounts[0].business_name}
                                          </SelectLabel>
                                          {accounts.map(a => (
                                            <SelectItem key={a.id} value={a.id} className="data-[highlighted]:bg-blue-500/15 data-[highlighted]:text-blue-700 dark:data-[highlighted]:text-blue-300">
                                              {a.name}{a.currency ? ` (${a.currency})` : ''}
                                            </SelectItem>
                                          ))}
                                        </SelectGroup>
                                      ))}
                                    </>
                                  );
                                })()}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Reconnect notice — shown when token lacks business_management scope */}
                          {hasBizMgmt === false && (
                            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2 text-amber-700 dark:text-amber-400 text-sm">
                              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <span>
                                Only personal ad accounts are shown.{' '}
                                <button
                                  type="button"
                                  className="underline hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
                                  onClick={handleConnect}
                                >
                                  Reconnect Meta
                                </button>{' '}
                                to also access Business Suite accounts.
                              </span>
                            </div>
                          )}

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
                            connectorKey="meta_ads"
                            onSelectAsset={handleSelectConnectedAsset}
                          />
                        </TabsContent>
                      </Tabs>
                    )}
                  </>
                )}

                {isConnected && step === 2 && (
                  <div className="flex flex-col space-y-3 animate-in fade-in slide-in-from-right-2 duration-300">
                    <div className={modalStyles.searchBox}>
                      <Search className="w-4 h-4 text-muted-foreground" />
                      <input
                        value={campaignSearch}
                        onChange={e => setCampaignSearch(e.target.value)}
                        placeholder="Search campaigns..."
                        className={modalStyles.searchInput}
                      />
                    </div>
                    {loadingCampaigns ? (
                      <div className="py-8 flex justify-center text-blue-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : (
                      <div className={modalStyles.selectionPanel}>
                        {(() => {
                          const filteredCampaigns = campaigns.filter(c => c.name.toLowerCase().includes(campaignSearch.toLowerCase()) || c.id.includes(campaignSearch));
                          const isAllSelected = filteredCampaigns.length > 0 && filteredCampaigns.every(c => selectedCampaignIds.has(c.id));
                          return (
                            <>
                              {filteredCampaigns.length > 0 && (
                                <div className={modalStyles.selectionRowWithDivider} onClick={() => {
                                  const next = new Set(selectedCampaignIds);
                                  if (isAllSelected) {
                                    filteredCampaigns.forEach(c => next.delete(c.id));
                                  } else {
                                    filteredCampaigns.forEach(c => next.add(c.id));
                                  }
                                  setSelectedCampaignIds(next);
                                }}>
                                  <Checkbox checked={isAllSelected} className={modalStyles.checkbox} />
                                  <div className="flex flex-col min-w-0">
                                    <span className={modalStyles.selectionTitle}>Select All Campaigns</span>
                                  </div>
                                </div>
                              )}
                              {filteredCampaigns.map(camp => (
                                <div key={camp.id} className={modalStyles.selectionRow} onClick={() => {
                                  const next = new Set(selectedCampaignIds);
                                  if (next.has(camp.id)) next.delete(camp.id);
                                  else next.add(camp.id);
                                  setSelectedCampaignIds(next);
                                }}>
                                  <Checkbox checked={selectedCampaignIds.has(camp.id)} className={modalStyles.checkbox} />
                                  <div className="flex flex-col min-w-0">
                                    <span className={modalStyles.selectionTitle}>{camp.name}</span>
                                    <span className={modalStyles.selectionMeta}>ID: {camp.id} • {camp.status}</span>
                                  </div>
                                </div>
                              ))}
                              {filteredCampaigns.length === 0 && <div className="text-center text-sm text-muted-foreground py-4">No campaigns found.</div>}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {isConnected && step === 3 && (
                  <div className="flex flex-col space-y-3 animate-in fade-in slide-in-from-right-2 duration-300">
                    <div className={modalStyles.searchBox}>
                      <Search className="w-4 h-4 text-muted-foreground" />
                      <input
                        value={adsetSearch}
                        onChange={e => setAdsetSearch(e.target.value)}
                        placeholder="Search ad sets..."
                        className={modalStyles.searchInput}
                      />
                    </div>
                    {loadingAdsets ? (
                      <div className="py-8 flex justify-center text-blue-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : (
                      <div className={modalStyles.selectionPanel}>
                        {(() => {
                          const filteredAdsets = adsets.filter(a => a.name.toLowerCase().includes(adsetSearch.toLowerCase()) || a.id.includes(adsetSearch));
                          const isAllSelected = filteredAdsets.length > 0 && filteredAdsets.every(a => selectedAdsetIds.has(a.id));
                          return (
                            <>
                              {filteredAdsets.length > 0 && (
                                <div className={modalStyles.selectionRowWithDivider} onClick={() => {
                                  const next = new Set(selectedAdsetIds);
                                  if (isAllSelected) {
                                    filteredAdsets.forEach(a => next.delete(a.id));
                                  } else {
                                    filteredAdsets.forEach(a => next.add(a.id));
                                  }
                                  setSelectedAdsetIds(next);
                                }}>
                                  <Checkbox checked={isAllSelected} className={modalStyles.checkbox} />
                                  <div className="flex flex-col min-w-0">
                                    <span className={modalStyles.selectionTitle}>Select All Ad Sets</span>
                                  </div>
                                </div>
                              )}
                              {filteredAdsets.map(adset => (
                                <div key={adset.id} className={modalStyles.selectionRow} onClick={() => {
                                  const next = new Set(selectedAdsetIds);
                                  if (next.has(adset.id)) next.delete(adset.id);
                                  else next.add(adset.id);
                                  setSelectedAdsetIds(next);
                                }}>
                                  <Checkbox checked={selectedAdsetIds.has(adset.id)} className={modalStyles.checkbox} />
                                  <div className="flex flex-col min-w-0">
                                    <span className={modalStyles.selectionTitle}>{adset.name}</span>
                                    <span className={modalStyles.selectionMeta}>ID: {adset.id} • {adset.status}</span>
                                  </div>
                                </div>
                              ))}
                              {filteredAdsets.length === 0 && <div className="text-center text-sm text-muted-foreground py-4">No adsets found in selected campaigns.</div>}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter className="sm:justify-end gap-2">
                {step > 1 && (
                  <Button type="button" variant="outline" onClick={() => setStep((step - 1) as 1 | 2 | 3)} className={modalStyles.outlineButton} disabled={syncing}>
                    Back
                  </Button>
                )}
                {step === 1 && (
                  <Button type="button" variant="ghost" onClick={onClose} className={modalStyles.ghostButton} disabled={syncing}>
                    Cancel
                  </Button>
                )}

                {step === 1 && (
                  <Button
                    type="button"
                    onClick={handleNextToCampaigns}
                    disabled={activeTab === 'connected' || !isConnected || !selectedAccountId || adAccounts.length === 0}
                    className={`bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
                  >
                    Next
                  </Button>
                )}

                {step === 2 && (
                  <Button
                    type="button"
                    onClick={handleNextToAdSets}
                    disabled={selectedCampaignIds.size === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
                  >
                    Next
                  </Button>
                )}

                {step === 3 && (
                  <Button
                    type="button"
                    onClick={handleSync}
                    disabled={!isConnected || syncing || selectedAdsetIds.size === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
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
            </>
          ) : (
            <div className="flex flex-col items-center py-6 animate-in fade-in zoom-in-95 duration-300">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-6">
                <SearchX className="w-8 h-8 text-orange-400" />
              </div>

              <h2 className={modalStyles.noDataTitle}>No insights found</h2>

              <p className={modalStyles.noDataDescription}>
                Meta returned no campaign insights for the selected date range. The export only contains schema headers.
              </p>

              <div className="w-full space-y-3">
                <Button
                  type="button"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 shadow-lg shadow-blue-900/20 transition-all font-medium"
                  onClick={() => void handleEmptyTryAnotherRange()}
                  disabled={discardingEmpty}
                >
                  {discardingEmpty ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarDays className="w-4 h-4 mr-2" />}
                  Try another date range
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={modalStyles.secondaryActionButton}
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
