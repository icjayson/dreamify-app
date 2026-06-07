import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CalendarDays, Loader2 } from 'lucide-react';
import {
  integrationService,
  type SalesforceConnectionStatusResponse,
  type SalesforceField,
  type SalesforceOwner,
} from '@/services/integrationService';
import { useChatStore } from '@/chat/useChatStore';
import { fileService, type AssetRecord } from '@/services/fileService';
import { formatDateForApi, subtractDays } from '@/utils/timestamp';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';
import { connectorModalStyles as modalStyles } from './connectorModalStyles';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

const REPORT_TYPES = [
  { value: 'sales_pipeline', label: 'Sales Pipeline', objectName: 'Opportunity' },
  { value: 'leads', label: 'Leads', objectName: 'Lead' },
  { value: 'accounts_contacts', label: 'Accounts & Contacts', objectName: 'Contact' },
  { value: 'activities', label: 'Activities', objectName: 'Task' },
  { value: 'campaigns', label: 'Campaigns', objectName: 'Campaign' },
];

type ModalState = 'checking' | 'disconnected' | 'connected';

type ConnectedAssetRun = {
  asset_id?: string;
  asset_filename?: string;
  connectorKey?: string;
  entityId?: string;
  entityName?: string;
  accountName?: string;
  project_id?: string;
  config_snapshot?: {
    size_bytes?: number;
  };
  sync_version_name?: string;
  version_name?: string;
};

const reportLabel = (value: string) => REPORT_TYPES.find((r) => r.value === value)?.label || value;
const reportObject = (value: string) => REPORT_TYPES.find((r) => r.value === value)?.objectName || 'Opportunity';

export default function SalesforceIntegrationModal() {
  const {
    isSalesforceModalOpen: isOpen,
    setSalesforceModalOpen: setOpen,
    currentProjectId,
    syncSalesforce,
    addFiles,
  } = useChatStore();

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [connectionStatus, setConnectionStatus] = useState<SalesforceConnectionStatusResponse | null>(null);
  const [owners, setOwners] = useState<SalesforceOwner[]>([]);
  const [fields, setFields] = useState<SalesforceField[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState('sales_pipeline');
  const [objectName, setObjectName] = useState('all');
  const [ownerId, setOwnerId] = useState('all');
  const [rowLimit, setRowLimit] = useState(5000);
  const [datePreset, setDatePreset] = useState('last_30d');
  const [startDate, setStartDate] = useState<Date | undefined>(subtractDays(30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [activeTab, setActiveTab] = useState<'new' | 'connected'>('new');
  const [emptyRowsDialog, setEmptyRowsDialog] = useState<{
    asset: AssetRecord;
    reportLabel: string;
    columnCount: number;
  } | null>(null);
  const [discardingEmpty, setDiscardingEmpty] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const { getToken } = useAuth();
  const isCustomRange = datePreset === 'custom';
  const currentObjectName = reportObject(reportType);
  const onClose = () => setOpen(false);

  const resetState = useCallback(() => {
    setModalState('checking');
    setConnectionStatus(null);
    setOwners([]);
    setFields([]);
    setConnecting(false);
    setDisconnecting(false);
    setLoadingMetadata(false);
    setSyncing(false);
    setError(null);
    setReportType('sales_pipeline');
    setObjectName('all');
    setOwnerId('all');
    setRowLimit(5000);
    setDatePreset('last_30d');
    setStartDate(subtractDays(30));
    setEndDate(new Date());
    setActiveTab('new');
    setEmptyRowsDialog(null);
    setDiscardingEmpty(false);
  }, []);

  const loadMetadata = useCallback(async (objectForFields: string) => {
    setLoadingMetadata(true);
    try {
      const [ownerRes, fieldRes] = await Promise.all([
        integrationService.fetchSalesforceOwners(),
        integrationService.fetchSalesforceFields(objectForFields),
      ]);
      if (!ownerRes.success) throw new Error(ownerRes.error || 'Failed to load Salesforce owners.');
      if (!fieldRes.success) throw new Error(fieldRes.error || 'Failed to load Salesforce fields.');
      setOwners(ownerRes.owners || []);
      setFields(fieldRes.fields || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Salesforce metadata.');
    } finally {
      setLoadingMetadata(false);
    }
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const status = await integrationService.getSalesforceStatus();
    setConnectionStatus(status);
    setModalState(status.connected ? 'connected' : 'disconnected');
    if (status.connected) void loadMetadata(currentObjectName);
  }, [currentObjectName, loadMetadata]);

  useEffect(() => {
    if (isOpen) {
      void checkConnectionStatus();
    } else {
      resetState();
    }
  }, [checkConnectionStatus, isOpen, resetState]);

  useEffect(() => {
    if (modalState === 'connected') {
      void loadMetadata(currentObjectName);
    }
  }, [currentObjectName, loadMetadata, modalState]);

  useEffect(() => {
    const onSuccess = () => {
      setConnecting(false);
      popupRef.current?.close();
      void checkConnectionStatus();
    };
    const onError = (msg: string) => {
      setConnecting(false);
      popupRef.current?.close();
      setError(msg || 'Salesforce authorization failed.');
    };

    const bc = new BroadcastChannel('salesforce_oauth');
    bc.onmessage = (e) => {
      if (e.data?.type === 'SALESFORCE_OAUTH_SUCCESS') onSuccess();
      else if (e.data?.type === 'SALESFORCE_OAUTH_ERROR') onError(e.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SALESFORCE_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'SALESFORCE_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);
    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, [checkConnectionStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const token = await getToken();
    const baseUrl = integrationService.getSalesforceOAuthStartUrl();
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const width = 620;
    const height = 760;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'salesforce_oauth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    popupRef.current = popup;
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        setConnecting(false);
      }
    }, 500);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await integrationService.disconnectSalesforce();
      setConnectionStatus(null);
      setModalState('disconnected');
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const label = reportLabel(reportType);
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
      const result = await syncSalesforce(
        reportType,
        promptProjectId || undefined,
        isCustomRange ? undefined : datePreset,
        isCustomRange && startDate ? formatDateForApi(startDate) : undefined,
        isCustomRange && endDate ? formatDateForApi(endDate) : undefined,
        objectName,
        ownerId,
        rowLimit,
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
            sourceType: 'Salesforce',
            accountName: connectionStatus?.account_name || connectionStatus?.instance_domain || 'Salesforce',
            propertyName: label,
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
        reportLabel: label,
        columnCount: result.column_count,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred during sync.';
      if (message.toLowerCase().includes('reconnect') || message.toLowerCase().includes('revoked')) {
        setModalState('disconnected');
      }
      setError(message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectConnectedAsset = async (run: ConnectedAssetRun) => {
    if (!run.asset_id) return;
    const existingProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
    let resolvedProjectId = existingProjectId || undefined;
    let selectedAsset: AssetRecord | null = null;
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
          const projectName = `${run.entityName || 'Salesforce'} Project`;
          const result = await integrationService.addConnectorEntityToNewProject(
            run.connectorKey,
            run.entityId,
            { project_name: projectName, prompt: 'Analyze this Salesforce CRM data and build a dashboard.', asset_id: run.asset_id }
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
    }
    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'salesforce.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Salesforce',
        accountName: run.accountName || 'Salesforce',
        propertyName: run.entityName || 'Salesforce',
        syncVersionName: run.sync_version_name || run.version_name,
      },
    ]);
    onClose();
  };

  const handleEmptyTryAnotherRange = async () => {
    if (!emptyRowsDialog) return;
    setDiscardingEmpty(true);
    try {
      const del = await fileService.deleteFile(emptyRowsDialog.asset.asset_id);
      if (!del.success) setError(del.error || 'Could not remove the empty export.');
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
        sourceType: 'Salesforce',
        accountName: connectionStatus?.account_name || 'Salesforce',
        propertyName: emptyRowsDialog.reportLabel,
        rowCount: 0,
        columnCount: emptyRowsDialog.columnCount,
        schemaOnly: true,
      },
    ]);
    setEmptyRowsDialog(null);
    setOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalStyles.content}>
        {!emptyRowsDialog ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-8 flex items-center justify-center overflow-hidden rounded">
                  <img src="/salesforce.svg" alt="Salesforce" className="w-10 h-8 object-contain" />
                </div>
                <DialogTitle className="text-xl font-semibold">Connect Salesforce</DialogTitle>
              </div>
              <DialogDescription className="text-muted-foreground text-sm">
                Sync Sales Cloud pipeline, leads, accounts, activities, and campaigns.
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-4">
              {modalState === 'checking' && (
                <div className={modalStyles.loadingCompact}>
                  <Loader2 className="w-6 h-6 animate-spin mb-2 text-[#00A1E0]" />
                  <p className="text-sm">Checking connection...</p>
                </div>
              )}

              {modalState === 'disconnected' && (
                <div className="space-y-4">
                  <div className={modalStyles.infoPanel}>
                    <p>Dreamify will request read access to Salesforce CRM data for sales reporting.</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>Opportunities, leads, accounts, and contacts</li>
                      <li>Owners, activities, and campaigns</li>
                      <li>Bounded CSV exports for AI dashboards</li>
                    </ul>
                  </div>
                </div>
              )}

              {modalState === 'connected' && (
                <>
                  <div className="flex items-center justify-between p-3 border border-[#00A1E0]/30 rounded-lg bg-[#00A1E0]/10">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                        <span className="text-sm font-medium text-foreground">Connected</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {connectionStatus?.account_name || connectionStatus?.instance_domain || 'Salesforce'}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className={modalStyles.ghostButtonSmall} onClick={handleDisconnect} disabled={disconnecting}>
                      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  </div>

                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'new' | 'connected')} className="mt-4">
                    <TabsList className={modalStyles.tabsListWithMargin}>
                      <TabsTrigger value="new" className={modalStyles.tabsTrigger}>Connect New</TabsTrigger>
                      <TabsTrigger value="connected" className={modalStyles.tabsTrigger}>Select Connected</TabsTrigger>
                    </TabsList>

                    <TabsContent value="new" className="space-y-4 outline-none">
                      <div className="space-y-2">
                        <Label className={modalStyles.label}>Report Type</Label>
                        <Select value={reportType} onValueChange={(value) => { setReportType(value); setObjectName('all'); }}>
                          <SelectTrigger className={modalStyles.selectTrigger}>
                            <SelectValue placeholder="Select report type" />
                          </SelectTrigger>
                          <SelectContent className={modalStyles.selectContent}>
                            {REPORT_TYPES.map((rt) => (
                              <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Object Scope</Label>
                          <Select value={objectName} onValueChange={setObjectName}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder="All report objects" />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              <SelectItem value="all">Default report object</SelectItem>
                              <SelectItem value={currentObjectName}>{currentObjectName}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Owner</Label>
                          <Select value={ownerId} onValueChange={setOwnerId} disabled={loadingMetadata}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder={loadingMetadata ? 'Loading...' : 'All owners'} />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              <SelectItem value="all">All owners</SelectItem>
                              {owners.map((owner) => (
                                <SelectItem key={owner.id} value={owner.id}>{owner.name || owner.email || owner.id}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Date Range</Label>
                          <Select value={datePreset} onValueChange={setDatePreset}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue placeholder="Select date range" />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              {DATE_PRESETS.map((preset) => (
                                <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Row Cap</Label>
                          <Input
                            type="number"
                            min={1}
                            max={10000}
                            value={rowLimit}
                            onChange={(e) => setRowLimit(Math.max(1, Math.min(10000, Number(e.target.value) || 5000)))}
                            className="bg-background border-border text-foreground"
                          />
                        </div>
                      </div>

                      {isCustomRange && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className={modalStyles.label}>Start Date</Label>
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
                            <Label className={modalStyles.label}>End Date</Label>
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

                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-sm text-foreground">{currentObjectName} fields</Label>
                          {loadingMetadata && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(fields.length ? fields.slice(0, 12) : [{ name: 'Id', label: 'Id', type: 'id' }]).map((field) => (
                            <span key={field.name} className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                              {field.label || field.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="connected" className="outline-none">
                      <ConnectedEntitiesList connectorKey="salesforce" onSelectAsset={handleSelectConnectedAsset} />
                    </TabsContent>
                  </Tabs>
                </>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-700 dark:text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <DialogFooter className="sm:justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} className={modalStyles.ghostButton} disabled={connecting || syncing}>
                Cancel
              </Button>
              {modalState === 'disconnected' && (
                <Button type="button" onClick={handleConnect} disabled={connecting} className="bg-[#00A1E0] hover:bg-[#0584b8] text-white font-medium px-4 py-2 rounded-md transition-colors">
                  {connecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</> : 'Connect with Salesforce'}
                </Button>
              )}
              {modalState === 'connected' && (
                <Button
                  type="button"
                  onClick={handleSync}
                  disabled={activeTab === 'connected' || syncing}
                  className={`bg-[#00A1E0] hover:bg-[#0584b8] text-white font-medium px-4 py-2 rounded-md transition-colors ${activeTab === 'connected' ? 'opacity-0 pointer-events-none' : ''}`}
                >
                  {syncing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing...</> : 'Sync Data'}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">No data found</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                The <span className="text-foreground font-medium">{emptyRowsDialog.reportLabel}</span> report returned 0 rows for the selected range.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 text-sm text-muted-foreground">
              Try a different date range, or keep the empty file with just the column headers.
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button type="button" variant="ghost" onClick={handleEmptyTryAnotherRange} disabled={discardingEmpty} className={modalStyles.ghostButton}>
                {discardingEmpty ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Try different dates
              </Button>
              <Button type="button" onClick={handleEmptyKeepSchema} disabled={discardingEmpty} className="bg-[#00A1E0] hover:bg-[#0584b8] text-white font-medium px-4 py-2 rounded-md transition-colors">
                Keep schema
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
