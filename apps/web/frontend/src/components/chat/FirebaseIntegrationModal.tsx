import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, FirebaseProject } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CalendarIcon, Link2, ShieldCheck } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import type { AssetRecord } from '@/services/fileService';
import { useGoogleConnectorAuth } from '@/hooks/useGoogleConnectorAuth';
import { GOOGLE_CONNECTOR_SCOPES } from '@/constants/googleScopes';
import { sanitizeConnectorError, isOAuthScopeError } from '@/utils/connectorErrors';

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
  const [startDate, setStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
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
    setProjects([]);
    setSelectedProjectId('');
    setDatePreset('last_30d');
    setStartDate(subDays(new Date(), 30));
    setEndDate(new Date());
    setError(null);
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
    clearAuthError();
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
  };

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

      const result = await syncFirebase(
        selectedProjectId,
        projectLabel,
        currentProjectId || undefined,
        isCustomRange && startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
        isCustomRange && endDate ? format(endDate, 'yyyy-MM-dd') : undefined
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
        <DialogContent className="sm:max-w-[425px] bg-[#1A1A1A] text-white border-white/10 outline-none z-[200]">
          {!emptyRowsDialog ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <img src="/firebase.png" alt="Firebase Logo" className="w-8 h-8 object-contain" />
                  <DialogTitle className="text-xl font-semibold">Connect Firebase</DialogTitle>
                </div>
                <DialogDescription className="text-gray-400 text-sm">
                  Import analytics and user engagement events from your Firebase project.
                </DialogDescription>
              </DialogHeader>

              <div className="py-6 space-y-4">
                {(modalState === 'checking' || isAuthorizing) && (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-400">
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
                        <p className="text-sm font-medium text-orange-300">Firebase access required</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {isGoogleLinked
                            ? 'Grant Firebase permission to your connected Google account.'
                            : 'Connect your Google account and grant Firebase permission.'}
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
                        <span className="text-sm font-medium truncate text-white">Google account connected</span>
                      </div>
                    </div>

                    {error ? (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    ) : projects.length === 0 ? (
                      <div className="text-center py-6 text-gray-400 text-sm border border-white/10 rounded-lg bg-white/5">
                        No Firebase projects found under this connected account.
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-200">Firebase Project</label>
                          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                              <SelectValue placeholder="Select a project" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#2A2A2A] border-white/10 text-white z-[201]">
                              {projects.map((proj) => (
                                <SelectItem key={proj.id} value={proj.id} className="focus:bg-white/10 focus:text-white">
                                  <div className="flex flex-col">
                                    <span>{proj.name}</span>
                                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">{proj.source_type}</span>
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

                {modalState === 'connected' && projects.length > 0 && !error && (
                  <Button
                    type="button"
                    onClick={handleSync}
                    disabled={syncing || !selectedProjectId}
                    className="bg-[#FFA000] hover:bg-[#FF8F00] text-white font-medium px-4 py-2 rounded-md transition-colors"
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
                  The <span className="text-white font-medium">{emptyRowsDialog.reportLabel}</span> project returned 0 rows for the selected date range.
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
                  className="bg-[#FFA000] hover:bg-[#FF8F00] text-white font-medium px-4 py-2 rounded-md transition-colors"
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
