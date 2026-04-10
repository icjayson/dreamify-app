import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService } from '@/services/integrationService';
import { Loader2, AlertCircle, RotateCcw, FileSpreadsheet, X, RefreshCw, Plus } from 'lucide-react';
import { useChatStore } from '@/chat/useChatStore';
import { cn } from '@/lib/utils';

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

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthToken, setOAuthToken] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  const onClose = () => setOpen(false);

  useEffect(() => {
    console.log('GoogleSheetsModal Effect - isOpen:', isOpen, 'hasToken:', !!oauthToken, 'hasFile:', !!selectedFileName);
    if (isOpen) {
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

      // Only load token if we don't have one and don't have a file selected yet
      if (!oauthToken && !selectedFileName && !loading) {
        loadToken();
      }
    } else {
      setOAuthToken(null);
      setError(null);
    }
  }, [isOpen, selectedFileName]); // oauthToken intentionally left out to avoid loops, loading as well

  const loadToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await integrationService.getGoogleOAuthToken();
      if (response.success && response.token) {
        setOAuthToken(response.token);
      } else {
        setError(response.error || 'Failed to authenticate with Google.');
      }
    } catch (err) {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
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
            
            // SIGNIFICANT timeout ensures the Picker UI is gone and focus is back 
            // before we trigger a React paint, making it more reliable.
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
            // Re-open/ensure open after picker closes
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
      await syncGoogleSheets(currentProjectId || undefined, oauthToken || undefined);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to sync Google Sheets');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog modal={!isPicking} open={isOpen} onOpenChange={(open) => {
      console.log('Modal onOpenChange:', open, 'isPicking:', isPicking);
      // Do NOT close if we are in picking mode (unless it's an explicit close we want to allow)
      if (!open && isPicking) return;
      if (!open) onClose();
    }}>
      <DialogContent 
        className="sm:max-w-[425px] bg-[#1A1A1A] text-white border-white/10 outline-none z-[200]"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <img src="/google-sheet.png" alt="Google Sheets Logo" className="w-8 h-8 object-contain" />
            <DialogTitle className="text-xl font-semibold">Connect Google Sheets</DialogTitle>
          </div>
          <DialogDescription className="text-gray-400 text-sm">
            Select a spreadsheet to import data into your project.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-green-500" />
              <p className="text-sm">Authenticating...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedFileName ? (
                <div 
                  className="flex items-center justify-between p-3 border border-green-500/30 rounded-lg bg-green-500/10 animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-md bg-green-500/20 flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-4 h-4 text-green-500" />
                    </div>
                    <span className="text-sm font-medium truncate max-w-[250px] text-white">
                      {selectedFileName}
                    </span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/10"
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
                    "flex items-center justify-between p-3 border border-white/10 rounded-lg bg-[#222] hover:bg-white/5 transition-colors cursor-pointer group",
                    !oauthToken && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center shrink-0 group-hover:bg-white/10 transition-colors">
                      <FileSpreadsheet className="w-4 h-4 text-gray-400" />
                    </div>
                    <span className="text-sm text-gray-300">Select a spreadsheet from Drive</span>
                  </div>
                  <Plus className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition-colors" />
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm mt-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
            </div>
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
          <Button
            type="button"
            onClick={handleSync}
            disabled={!selectedFileId || syncing}
            className="bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
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
