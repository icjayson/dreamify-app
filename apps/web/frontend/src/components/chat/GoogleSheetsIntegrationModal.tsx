import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService } from '@/services/integrationService';
import { Loader2, AlertCircle, FileSpreadsheet, RefreshCw, Plus, ShieldCheck } from 'lucide-react';
import { useChatStore } from '@/chat/useChatStore';
import { fileService } from '@/services/fileService';
import { cn } from '@/lib/utils';
import { useGoogleConnectorAuth } from '@/hooks/useGoogleConnectorAuth';
import { GOOGLE_CONNECTOR_SCOPES } from '@/constants/googleScopes';
import { sanitizeConnectorError, isOAuthScopeError } from '@/utils/connectorErrors';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export default function GoogleSheetsIntegrationModal() {
  const {
    isGoogleSheetsModalOpen: isOpen,
    setGoogleSheetsModalOpen: setOpen,
    googleSheetsFileId: selectedFileId,
    googleSheetsFileName: selectedFileName,
    setGoogleSheetsFileId,
    setGoogleSheetsFileName,
    syncGoogleSheets,
    currentProjectId
  } = useChatStore();

  const {
    isGoogleLinked,
    isAuthorizing,
    error: authError,
    requestScopes,
    hasScopes,
    clearError: clearAuthError,
  } = useGoogleConnectorAuth({ connectorKey: 'google-sheets' });

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthToken, setOAuthToken] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [needsScopes, setNeedsScopes] = useState(false);
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');

  const onClose = () => setOpen(false);

  useEffect(() => {
    if (isOpen) {
      // Load Google Picker API
      if (!window.google) {
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
          window.gapi.load('picker', { callback: () => console.log('Picker loaded') });
        };
        document.body.appendChild(script);
      } else if (window.gapi) {
        window.gapi.load('picker', { callback: () => console.log('Picker loaded') });
      }

      // Pre-check: Picker API needs drive.file scope client-side.
      // If scope is missing, show grant button immediately.
      const requiredScopes = GOOGLE_CONNECTOR_SCOPES['Google Sheets'];
      if (!isGoogleLinked || !hasScopes(requiredScopes)) {
        setNeedsScopes(true);
        setError(
          isGoogleLinked
            ? 'Google Drive file access is required to browse your spreadsheets.'
            : 'Connect your Google account to browse your spreadsheets.'
        );
        return;
      }

      // Scopes look good — load the token
      if (!oauthToken && !selectedFileName && !loading) {
        loadToken();
      }
    } else {
      setOAuthToken(null);
      setError(null);
      setNeedsScopes(false);
      clearAuthError();
      setActiveTab('new');
    }
  }, [isOpen, selectedFileName, isGoogleLinked, hasScopes]);

  const loadToken = async () => {
    setLoading(true);
    setError(null);
    setNeedsScopes(false);
    try {
      const response = await integrationService.getGoogleOAuthToken();
      if (response.success && response.token) {
        setOAuthToken(response.token);
      } else {
        const rawErr = response.error || 'Failed to authenticate with Google.';
        if (isOAuthScopeError(rawErr)) {
          setError(sanitizeConnectorError(rawErr, 'Google Sheets'));
          setNeedsScopes(true);
        } else {
          setError(sanitizeConnectorError(rawErr, 'Google Sheets'));
        }
      }
    } catch (err) {
      setError('Something went wrong while connecting to Google Sheets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGrantAccess = async () => {
    await requestScopes(GOOGLE_CONNECTOR_SCOPES['Google Sheets']);
    // If requestScopes redirected, we won't reach here.
    await loadToken();
  };

  const handleOpenPicker = () => {
    if (!oauthToken) {
      setError('Google OAuth token is missing. Cannot open picker.');
      return;
    }

    if (!window.google || !window.google.picker) {
      setError('Google Picker API not loaded yet. Please try again in a moment.');
      return;
    }

    try {
      setIsPicking(true);
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.SPREADSHEETS);
      view.setMimeTypes('application/vnd.google-apps.spreadsheet');
      view.setMode(window.google.picker.DocsViewMode.GRID);

      const developerKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string;

      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(oauthToken)
        .setDeveloperKey(developerKey)
        .setAppId("869837791185")
        .setOrigin(window.location.protocol + '//' + window.location.host)
        .setCallback((data: any) => {
          if (data.action === 'picked' || (window.google.picker.Action && data.action === window.google.picker.Action.PICKED)) {
            const doc = data.docs[0];
            console.log('Picker: selection made, ensuring modal stay open');
            setIsPicking(false);
            setOpen(true);

            setTimeout(() => {
              console.log('Picker data received, updating state:', doc.name, doc.id);
              setGoogleSheetsFileId(doc.id);
              setGoogleSheetsFileName(doc.name);
              setOpen(true);
              setError(null);
            }, 500);
          } else if (data.action === 'cancel' || data.action === 'close' || (window.google.picker.Action && (data.action === window.google.picker.Action.CANCEL))) {
            console.log('Picker cancelled or closed');
            setIsPicking(false);
            setTimeout(() => setOpen(true), 100);
          } else {
            console.log('Picker action:', data.action);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err: any) {
      console.error('Error in handleOpenPicker:', err);
      setError(`Failed to open Google Picker: ${err.message}`);
    }
  };

  const handleSync = async () => {
    if (!selectedFileId) {
      setError('Please select a spreadsheet to sync.');
      return;
    }

    setSyncing(true);
    setError(null);

    try {
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
      await syncGoogleSheets(promptProjectId || undefined, oauthToken || undefined);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to sync Google Sheets');
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
      sourceType: 'Google Sheets',
      accountName: run.accountName || 'Google Account',
      propertyName: run.entityName || run.config_snapshot?.entity_name,
      syncVersionName: run.sync_version_name || run.version_name,
    };
    useChatStore.getState().addFiles([file]);
    onClose();
  };

  const displayError = authError || error;

  return (
    <Dialog modal={!isPicking} open={isOpen} onOpenChange={(open) => {
      if (!open && isPicking) return;
      if (!open) onClose();
    }}>
      <DialogContent
        className="sm:max-w-[425px] bg-background text-foreground border-border outline-none z-[200]"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <img src="/google-sheet.png" alt="Google Sheets Logo" className="w-8 h-8 object-contain" />
            <DialogTitle className="text-xl font-semibold">Connect Google Sheets</DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground text-sm">
            Select a spreadsheet to import data into your project.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          {/* Loading / Authorizing state */}
          {(loading || isAuthorizing) ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-green-500" />
              <p className="text-sm">
                {isAuthorizing ? 'Requesting Google Drive access…' : 'Authenticating...'}
              </p>
            </div>
          ) : needsScopes ? (
            /* Backend says token is bad — show Grant Access button */
            <div className="p-5 bg-green-500/10 border border-green-500/20 rounded-lg flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-green-300">Google Drive access required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isGoogleLinked
                      ? 'Grant Drive file permission to your connected Google account.'
                      : 'Connect your Google account and grant Drive file permission.'}
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
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium w-full"
              >
                {isGoogleLinked ? 'Grant Drive Access' : 'Connect Google Account'}
              </Button>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
              <TabsList className="grid w-full grid-cols-2 bg-muted border border-border p-1 rounded-lg">
                <TabsTrigger value="new" className="data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md text-sm transition-all">Select New Sheet</TabsTrigger>
                <TabsTrigger value="connected" className="data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md text-sm transition-all">Select Connected Sheet</TabsTrigger>
              </TabsList>

              <TabsContent value="new" className="space-y-4 outline-none">
                {selectedFileName ? (
                  <div
                    className="flex items-center justify-between p-3 border border-green-500/30 rounded-lg bg-green-500/10 animate-in fade-in slide-in-from-bottom-2 duration-300"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-md bg-green-500/20 flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="w-4 h-4 text-green-500" />
                      </div>
                      <span className="text-sm font-medium truncate max-w-[250px] text-foreground">
                        {selectedFileName}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-emerald-500/10"
                      onClick={() => {
                        setGoogleSheetsFileId(null);
                        setGoogleSheetsFileName(null);
                      }}
                      title="Change spreadsheet"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div
                    onClick={handleOpenPicker}
                    className={cn(
                      "flex items-center justify-between p-3 border border-border rounded-lg bg-background hover:bg-emerald-500/10 transition-colors cursor-pointer group",
                      !oauthToken && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/15 transition-colors">
                        <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span className="text-sm text-foreground">Select a spreadsheet from Drive</span>
                    </div>
                    <Plus className="w-4 h-4 text-muted-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="connected" className="outline-none">
                <ConnectedEntitiesList
                  connectorKey="google_sheets"
                  onSelectAsset={handleSelectConnectedAsset}
                />
              </TabsContent>

              {displayError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm mt-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>{displayError}</p>
                </div>
              )}
            </Tabs>
          )}
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-muted"
            disabled={syncing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSync}
            disabled={activeTab === 'connected' || !selectedFileId || syncing || needsScopes}
            className={`bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
          >
            {syncing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              'Connect & Sync'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
