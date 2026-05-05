import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { integrationService, GA4Account } from '@/services/integrationService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, ShieldCheck, CalendarDays } from 'lucide-react';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useChatStore } from '@/chat/useChatStore';
import { useGoogleConnectorAuth } from '@/hooks/useGoogleConnectorAuth';
import { GOOGLE_CONNECTOR_SCOPES } from '@/constants/googleScopes';
import { sanitizeConnectorError, isOAuthScopeError } from '@/utils/connectorErrors';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';

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

const getPresetRange = (preset: string): { from: Date; to: Date } => {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'last_7d':
      return { from: subtractDays(7), to };
    case 'last_90d':
      return { from: subtractDays(90), to };
    case 'this_month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
    case 'last_month': {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastOfLastMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
      return {
        from: new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1),
        to: new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), lastOfLastMonth.getDate()),
      };
    }
    case 'this_year':
      return { from: new Date(now.getFullYear(), 0, 1), to };
    case 'last_year':
      return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear() - 1, 11, 31) };
    case 'last_30d':
    default:
      return { from: subtractDays(30), to };
  }
};

export default function GA4IntegrationModal() {
  const {
    isGA4ModalOpen: isOpen,
    setGA4ModalOpen: setOpen,
    currentProjectId,
    syncGA4
  } = useChatStore();

  const {
    isGoogleLinked,
    isAuthorizing,
    error: authError,
    requestScopes,
    clearError: clearAuthError,
  } = useGoogleConnectorAuth({ connectorKey: 'ga4' });

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsScopes, setNeedsScopes] = useState(false);

  const [accounts, setAccounts] = useState<GA4Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');

  const [datePreset, setDatePreset] = useState<string>('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');

  const onClose = () => setOpen(false);

  useEffect(() => {
    if (isOpen) {
      loadProperties();
    } else {
      setAccounts([]);
      setSelectedAccountId('');
      setSelectedPropertyId('');
      setDatePreset('last_30d');
      setStartDate(subtractDays(30));
      setEndDate(new Date());
      setError(null);
      setNeedsScopes(false);
      clearAuthError();
      setActiveTab('new');
    }
  }, [isOpen]);

  const loadProperties = async () => {
    setLoading(true);
    setError(null);
    setNeedsScopes(false);
    try {
      const response = await integrationService.fetchGoogleAnalyticsProperties();
      if (response.success) {
        setAccounts(response.accounts || []);
        if (response.accounts && response.accounts.length > 0) {
          setSelectedAccountId(response.accounts[0].account_id);
        }
      } else {
        const rawErr = response.error || 'Failed to fetch Google Analytics properties.';
        if (isOAuthScopeError(rawErr)) {
          setError(sanitizeConnectorError(rawErr, 'Google Analytics'));
          setNeedsScopes(true);
        } else {
          setError(sanitizeConnectorError(rawErr, 'Google Analytics'));
        }
      }
    } catch (err) {
      setError('Something went wrong while connecting to Google Analytics. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGrantAccess = async () => {
    await requestScopes(GOOGLE_CONNECTOR_SCOPES.GA4);
    // If requestScopes redirected, we won't reach here.
    // If it resolved without redirect (rare), retry loading.
    await loadProperties();
  };

  const handleSync = async () => {
    if (!selectedPropertyId) {
      setError('Please select a property to sync.');
      return;
    }

    setSyncing(true);
    setError(null);

    try {
      const selectedAccount = accounts.find(a => a.account_id === selectedAccountId);
      const selectedProperty = selectedAccount?.properties.find(p => p.property_id === selectedPropertyId);

      await syncGA4(
        selectedPropertyId,
        currentProjectId || undefined,
        startDate ? formatDateForApi(startDate) : '30daysAgo',
        endDate ? formatDateForApi(endDate) : 'today',
        selectedAccount?.account_name,
        selectedProperty?.display_name
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during sync.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectConnectedAsset = (run: any) => {
    if (!run.asset_id) return;
    const selectedAccountName = accounts.find(a => a.account_id === selectedAccountId)?.account_name || run.accountName;
    const file = {
      fileID: run.asset_id,
      filename: run.asset_filename || 'data.csv',
      size: run.config_snapshot?.size_bytes || 0,
      ext: 'csv',
      status: 'uploaded' as const,
      sourceType: 'GA4',
      accountName: selectedAccountName,
      propertyName: run.entityName || run.config_snapshot?.entity_name,
      syncVersionName: run.sync_version_name || run.version_name,
    };
    useChatStore.getState().addFiles([file]);
    onClose();
  };

  const selectedAccount = accounts.find(a => a.account_id === selectedAccountId);
  const availableProperties = selectedAccount?.properties || [];
  const displayError = authError || error;
  const isCustomRange = datePreset === 'custom';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-[425px] bg-[#1A1A1A] text-white border-white/10 outline-none z-[200]"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <img src="/GA4.png" alt="GA4 Logo" className="w-8 h-8 object-contain" />
            <DialogTitle className="text-xl font-semibold">Connect Google Analytics</DialogTitle>
          </div>
          <DialogDescription className="text-gray-400 text-sm">
            Select a property to import data from Google Analytics 4.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">
          {/* Loading / Authorizing state */}
          {(loading || isAuthorizing) ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-orange-500" />
              <p className="text-sm">
                {isAuthorizing ? 'Requesting Google Analytics access…' : 'Loading accounts and properties...'}
              </p>
            </div>
          ) : needsScopes ? (
            /* Backend says token is bad — show Grant Access button */
            <div className="p-5 bg-orange-500/10 border border-orange-500/20 rounded-lg flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-orange-300">Google Analytics access required</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {isGoogleLinked
                      ? 'Grant Analytics permission to your connected Google account.'
                      : 'Connect your Google account and grant Analytics permission.'}
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
                {isGoogleLinked ? 'Grant Analytics Access' : 'Connect Google Account'}
              </Button>
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm border border-white/10 rounded-lg bg-white/5">
              No Google Analytics accounts found. Make sure your Google account has GA4 access.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-200">Account</label>
                <Select
                  value={selectedAccountId}
                  onValueChange={(val) => {
                    setSelectedAccountId(val);
                    setSelectedPropertyId('');
                  }}
                >
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                    <SelectValue placeholder="Select an account" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#2A2A2A] border-white/10 text-white z-[201]">
                    {accounts.map((account) => (
                      <SelectItem key={account.account_id} value={account.account_id} className="focus:bg-white/10 focus:text-white">
                        {account.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-4">
                <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/10 p-1 rounded-lg">
                  <TabsTrigger value="new" className="data-[state=active]:bg-[#3A3A3A] data-[state=active]:text-white rounded-md text-sm transition-all">Connect New Property</TabsTrigger>
                  <TabsTrigger value="connected" className="data-[state=active]:bg-[#3A3A3A] data-[state=active]:text-white rounded-md text-sm transition-all">Select Connected Property</TabsTrigger>
                </TabsList>

                <TabsContent value="new" className="space-y-4 mt-4 outline-none">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-200">Property</label>
                    <Select
                      value={selectedPropertyId}
                      onValueChange={setSelectedPropertyId}
                      disabled={!selectedAccountId || availableProperties.length === 0}
                    >
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                        <SelectValue placeholder="Select a property" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#2A2A2A] border-white/10 text-white max-h-60 z-[201]">
                        {availableProperties.map((property) => (
                          <SelectItem key={property.property_id} value={property.property_id} className="focus:bg-white/10 focus:text-white">
                            {property.display_name}
                          </SelectItem>
                        ))}
                        {availableProperties.length === 0 && (
                          <div className="px-2 py-4 text-center text-sm text-gray-400">
                            No properties found
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-200">Date Range</label>
                    <Select
                      value={datePreset}
                      onValueChange={(value) => {
                        setDatePreset(value);
                        if (value !== 'custom') {
                          const range = getPresetRange(value);
                          setStartDate(range.from);
                          setEndDate(range.to);
                        }
                      }}
                    >
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

                <TabsContent value="connected" className="mt-4 outline-none">
                  <ConnectedEntitiesList
                    connectorKey="ga4"
                    filterAccountName={selectedAccount?.account_name}
                    availableEntityIds={selectedAccount?.properties.map(p => p.property_id)}
                    onSelectAsset={handleSelectConnectedAsset}
                  />
                </TabsContent>
              </Tabs>
            </>
          )}

          {/* Show non-token errors inline when data loaded but had issues */}
          {!needsScopes && !loading && displayError && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3 text-red-400">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm">{displayError}</div>
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
            disabled={activeTab === 'connected' || loading || syncing || !selectedPropertyId || accounts.length === 0 || needsScopes}
            className={`bg-orange-500 hover:bg-orange-600 text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
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
