import React, { useCallback, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, FirebaseProject } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarDays, Link2, ShieldCheck } from 'lucide-react';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';
import { useGoogleConnectorAuth } from '@/hooks/useGoogleConnectorAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';
import { GOOGLE_CONNECTOR_SCOPES } from '@/constants/googleScopes';
import { sanitizeConnectorError, isOAuthScopeError } from '@/utils/connectorErrors';
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

export default function FirebaseIntegrationModal() {
  const {
    isFirebaseModalOpen: isOpen,
    setFirebaseModalOpen: setOpen,
    currentProjectId,
    syncFirebase,
    addFiles,
  } = useChatStore();

  const {
    isGoogleLinked,
    isAuthorizing,
    error: authError,
    requestScopes,
    clearError: clearAuthError,
  } = useGoogleConnectorAuth({ connectorKey: 'firebase' });

  // Connection state machine
  const [modalState, setModalState] = useState<ModalState>('checking');
  const [projects, setProjects] = useState<FirebaseProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

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
    setProjects([]);
    setSelectedProjectId('');
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
      const response = await integrationService.fetchFirebaseProjects();
      if (response.success) {
        setProjects(response.projects || []);
        if (response.projects && response.projects.length > 0) {
          setSelectedProjectId(response.projects[0].id);
        }
        setModalState('connected');
      } else {
        const rawErr = response.error || 'Failed to fetch Firebase projects.';
        if (isOAuthScopeError(rawErr)) {
          setError(sanitizeConnectorError(rawErr, 'Firebase'));
          setModalState('needs_scopes');
        } else {
          setError(sanitizeConnectorError(rawErr, 'Firebase'));
          setModalState('connected');
        }
      }
    } catch (err) {
      setError('Something went wrong while connecting to Firebase. Please try again.');
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
    await requestScopes(GOOGLE_CONNECTOR_SCOPES.Firebase);
    // If requestScopes redirected, we won't reach here.
    await checkConnectionStatus();
  };

  const handleSync = async () => {
    if (!selectedProjectId) {
      setError('Please select a Firebase Project to sync.');
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      const selectedProject = projects.find((p) => p.id === selectedProjectId);
      const projectLabel = selectedProject?.name || 'Firebase';
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;

      const result = await syncFirebase(
        selectedProjectId,
        projectLabel,
        promptProjectId || undefined,
        isCustomRange && startDate ? formatDateForApi(startDate) : undefined,
        isCustomRange && endDate ? formatDateForApi(endDate) : undefined
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
            sourceType: 'Firebase',
            accountName: projectLabel,
            propertyName: 'Analytics',
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
        reportLabel: projectLabel,
        columnCount: result.column_count,
      });
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'An unexpected error occurred during sync.';
      if (isOAuthScopeError(rawMsg)) {
        setModalState('needs_scopes');
      }
      setError(sanitizeConnectorError(rawMsg, 'Firebase'));
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
      sourceType: 'Firebase',
      accountName: run.accountName || run.entityName || 'Firebase',
      propertyName: 'Analytics',
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
        sourceType: 'Firebase',
        accountName: emptyRowsDialog.reportLabel,
        propertyName: 'Analytics',
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
                  <img src="/firebase.png" alt="Firebase Logo" className="w-8 h-8 object-contain" />
                  <DialogTitle className="text-xl font-semibold">Connect Firebase</DialogTitle>
                </div>
            <DialogDescription className="text-muted-foreground text-sm">
                  Import analytics and user engagement events from your Firebase project.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">
                {(modalState === 'checking' || isAuthorizing) && (
                  <div className={modalStyles.loading}>
                    <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#FFA000]" />
                    <p className="text-sm">
                      {isAuthorizing ? 'Requesting Firebase access…' : 'Checking connection…'}
                    </p>
                  </div>
                )}

                {modalState === 'needs_scopes' && !isAuthorizing && (
                  <div className="p-5 bg-[#FFA000]/10 border border-[#FFA000]/20 rounded-lg flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#FFA000]/20 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4 text-[#FFA000]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-orange-700 dark:text-orange-300">Firebase access required</p>
                        <p className={`${modalStyles.subtleText} mt-0.5`}>
                          {isGoogleLinked
                            ? 'Grant Firebase permission to your connected Google account.'
                            : 'Connect your Google account and grant Firebase permission.'}
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
                      {isGoogleLinked ? 'Grant Firebase Access' : 'Connect Google Account'}
                    </Button>
                  </div>
                )}

                {modalState === 'connected' && (
                  <>
                    <div className="flex items-center justify-between p-3 border border-[#FFA000]/30 rounded-lg bg-[#FFA000]/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-md bg-[#FFA000]/20 flex items-center justify-center shrink-0">
                          <Link2 className="w-4 h-4 text-[#FFA000]" />
                        </div>
                        <span className={modalStyles.connectedText}>Google account connected</span>
                      </div>
                    </div>

                    {error ? (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    ) : projects.length === 0 ? (
                      <div className={modalStyles.emptyState}>
                        No Firebase projects found under this connected account.
                      </div>
                    ) : (
                      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-4">
                        <TabsList className={modalStyles.tabsList}>
                          <TabsTrigger value="new" className={modalStyles.tabsTrigger}>Connect New Project</TabsTrigger>
                          <TabsTrigger value="connected" className={modalStyles.tabsTrigger}>Select Connected Project</TabsTrigger>
                        </TabsList>

                        <TabsContent value="new" className="space-y-4 mt-4 outline-none">
                          <div className="space-y-2">
                            <label className={modalStyles.label}>Firebase Project</label>
                            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                              <SelectTrigger className={modalStyles.selectTrigger}>
                                <SelectValue placeholder="Select a project" />
                              </SelectTrigger>
                              <SelectContent className={modalStyles.selectContent}>
                                {projects.map((proj) => (
                                  <SelectItem key={proj.id} value={proj.id} className="data-[highlighted]:bg-amber-500/15 data-[highlighted]:text-amber-700 dark:data-[highlighted]:text-amber-300">
                                    <div className="flex flex-col">
                                      <span>{proj.name}</span>
                                      <span className={modalStyles.selectMetaText}>{proj.source_type}</span>
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
                                  <SelectItem key={preset.value} value={preset.value} className="data-[highlighted]:bg-amber-500/15 data-[highlighted]:text-amber-700 dark:data-[highlighted]:text-amber-300">
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

                        <TabsContent value="connected" className="mt-4 outline-none">
                          <ConnectedEntitiesList
                            connectorKey="firebase"
                            availableEntityIds={projects.map(p => p.id)}
                            onSelectAsset={handleSelectConnectedAsset}
                          />
                        </TabsContent>
                      </Tabs>
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

                {modalState === 'connected' && projects.length > 0 && !error && (
                  <Button
                    type="button"
                    onClick={handleSync}
                    disabled={activeTab === 'connected' || syncing || !selectedProjectId}
                    className={`bg-[#FFA000] hover:bg-[#FF8F00] text-zinc-950 font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
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
                  The <span className="text-foreground font-medium">{emptyRowsDialog.reportLabel}</span> project returned 0 rows for the selected date range.
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
                  className="bg-[#FFA000] hover:bg-[#FF8F00] text-zinc-950 font-medium px-4 py-2 rounded-md transition-colors"
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
