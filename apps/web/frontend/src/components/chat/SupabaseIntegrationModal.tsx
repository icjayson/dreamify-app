import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { AlertCircle, Database, HardDrive, KeyRound, Loader2, RefreshCw, ShieldCheck, Table2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  integrationService,
  type SupabaseConnection,
  type SupabaseConnectionStatusResponse,
  type SupabaseProject,
  type SupabaseSyncMode,
  type SupabaseTable,
} from '@/services/integrationService';
import { useChatStore } from '@/chat/useChatStore';
import { fileService, type AssetRecord } from '@/services/fileService';
import { ConnectedEntitiesList } from './ConnectedEntitiesList';
import { connectorModalStyles as modalStyles } from './connectorModalStyles';

type ModalState = 'checking' | 'disconnected' | 'connected';
type ActiveTab = 'connect' | 'tables' | 'connected';

type ConnectedAssetRun = {
  asset_id?: string;
  asset_filename?: string;
  connectorKey?: string;
  entityId?: string;
  entityName?: string;
  accountName?: string;
  project_id?: string;
  config_snapshot?: { size_bytes?: number };
  sync_version_name?: string;
  version_name?: string;
};

const SYNC_MODES: Array<{ value: SupabaseSyncMode; label: string }> = [
  { value: 'bounded_table_snapshot', label: 'Table Snapshot' },
  { value: 'profile_only', label: 'Schema Profile' },
  { value: 'aggregated_result', label: 'Aggregated Result' },
  { value: 'app_profile', label: 'Auth & Storage Profile' },
];

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '10 MB';
  if (value >= 1_000_000_000) return `${Math.round(value / 1_000_000_000)} GB`;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)} MB`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} KB`;
  return `${value} B`;
}

function flattenTables(connection?: SupabaseConnection | null): SupabaseTable[] {
  return (connection?.schema_snapshot?.schemas || []).flatMap((schema) =>
    (schema.tables || []).map((table) => ({
      ...table,
      schema: table.schema || schema.name,
    }))
  );
}

function tablePath(table: SupabaseTable): string {
  return `${table.schema}.${table.name}`;
}

function safeSourceName(connection?: SupabaseConnection | null): string {
  return connection?.project_name || connection?.display_name || connection?.project_ref || 'Supabase';
}

export default function SupabaseIntegrationModal() {
  const {
    isSupabaseModalOpen: isOpen,
    setSupabaseModalOpen: setOpen,
    currentProjectId,
    syncSupabase,
    addFiles,
  } = useChatStore();
  const { getToken } = useAuth();
  const popupRef = useRef<Window | null>(null);

  const [modalState, setModalState] = useState<ModalState>('checking');
  const [status, setStatus] = useState<SupabaseConnectionStatusResponse | null>(null);
  const [projects, setProjects] = useState<SupabaseProject[]>([]);
  const [connections, setConnections] = useState<SupabaseConnection[]>([]);
  const [selectedProjectRef, setSelectedProjectRef] = useState('');
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [connectionUri, setConnectionUri] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [schemaAllowlist, setSchemaAllowlist] = useState('public');
  const [sourceTimezone, setSourceTimezone] = useState('UTC');
  const [maxExportBytes, setMaxExportBytes] = useState(10_485_760);
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [syncMode, setSyncMode] = useState<SupabaseSyncMode>('bounded_table_snapshot');
  const [selectedTablePath, setSelectedTablePath] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [rowLimit, setRowLimit] = useState(5000);
  const [dateFilterColumn, setDateFilterColumn] = useState('none');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [groupColumns, setGroupColumns] = useState('');
  const [metricColumns, setMetricColumns] = useState('');
  const [bucket, setBucket] = useState('all');
  const [activeTab, setActiveTab] = useState<ActiveTab>('connect');
  const [connectingOAuth, setConnectingOAuth] = useState(false);
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [refreshingSchema, setRefreshingSchema] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sample, setSample] = useState<{ columns: string[]; rows: unknown[][]; generated_sql: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.ref === selectedProjectRef) || null,
    [projects, selectedProjectRef]
  );
  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.connection_id === selectedConnectionId) || null,
    [connections, selectedConnectionId]
  );
  const tables = useMemo(() => flattenTables(selectedConnection), [selectedConnection]);
  const selectedTable = useMemo(
    () => tables.find((table) => tablePath(table) === selectedTablePath) || null,
    [selectedTablePath, tables]
  );
  const tableColumns = selectedTable?.columns || [];
  const needsTable = syncMode === 'bounded_table_snapshot' || syncMode === 'aggregated_result';

  const onClose = () => setOpen(false);

  const resetTransientState = useCallback(() => {
    setError(null);
    setConnectingOAuth(false);
    setCreatingConnection(false);
    setRefreshingSchema(false);
    setSampling(false);
    setSyncing(false);
    setDisconnecting(false);
    setSample(null);
    setActiveTab('connect');
  }, []);

  const loadConnections = useCallback(async () => {
    const response = await integrationService.fetchSupabaseConnections();
    if (!response.success) throw new Error(response.error || 'Failed to load Supabase connections.');
    setConnections(response.connections || []);
    setSelectedConnectionId((current) => current || response.connections[0]?.connection_id || '');
    return response.connections || [];
  }, []);

  const loadProjects = useCallback(async () => {
    const response = await integrationService.fetchSupabaseProjects();
    if (!response.success) throw new Error(response.error || 'Failed to load Supabase projects.');
    setProjects(response.projects || []);
    setSelectedProjectRef((current) => current || response.projects[0]?.ref || '');
    return response.projects || [];
  }, []);

  const checkConnectionStatus = useCallback(async () => {
    setModalState('checking');
    setError(null);
    const nextStatus = await integrationService.getSupabaseStatus();
    setStatus(nextStatus);
    setModalState(nextStatus.connected ? 'connected' : 'disconnected');
    if (!nextStatus.connected) return;

    try {
      const connectionList = await loadConnections();
      if (nextStatus.oauth_connected) {
        await loadProjects();
      }
      if (connectionList.length > 0) setActiveTab('tables');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Supabase metadata.');
    }
  }, [loadConnections, loadProjects]);

  useEffect(() => {
    if (isOpen) {
      void checkConnectionStatus();
    } else {
      setProjects([]);
      setConnections([]);
      setSelectedProjectRef('');
      setSelectedConnectionId('');
      setSelectedTablePath('');
      setSelectedColumns([]);
      resetTransientState();
      setModalState('checking');
    }
  }, [checkConnectionStatus, isOpen, resetTransientState]);

  useEffect(() => {
    if (!selectedConnection) return;
    if (!selectedProjectRef) setSelectedProjectRef(selectedConnection.project_ref);
    setSchemaAllowlist((selectedConnection.include_schemas || ['public']).join(', ') || 'public');
    setSourceTimezone(selectedConnection.source_timezone || 'UTC');
    setMaxExportBytes(selectedConnection.max_export_bytes || 10_485_760);
  }, [selectedConnection, selectedProjectRef]);

  useEffect(() => {
    if (tables.length === 0) {
      setSelectedTablePath('');
      setSelectedColumns([]);
      return;
    }
    setSelectedTablePath((current) => current || tablePath(tables[0]));
  }, [tables]);

  useEffect(() => {
    if (!selectedTable) {
      setSelectedColumns([]);
      return;
    }
    setSelectedColumns(selectedTable.columns.map((column) => column.name).slice(0, 20));
    setDateFilterColumn('none');
    setSample(null);
  }, [selectedTable]);

  useEffect(() => {
    const onSuccess = () => {
      setConnectingOAuth(false);
      popupRef.current?.close();
      void checkConnectionStatus();
    };
    const onError = (msg: string) => {
      setConnectingOAuth(false);
      popupRef.current?.close();
      setError(msg || 'Supabase authorization failed.');
    };

    const bc = new BroadcastChannel('supabase_oauth');
    bc.onmessage = (event) => {
      if (event.data?.type === 'SUPABASE_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'SUPABASE_OAUTH_ERROR') onError(event.data.error);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SUPABASE_OAUTH_SUCCESS') onSuccess();
      else if (event.data?.type === 'SUPABASE_OAUTH_ERROR') onError(event.data.error);
    };
    window.addEventListener('message', handleMessage);
    return () => {
      bc.close();
      window.removeEventListener('message', handleMessage);
    };
  }, [checkConnectionStatus]);

  const handleOAuthConnect = async () => {
    setConnectingOAuth(true);
    setError(null);
    const token = await getToken();
    const baseUrl = integrationService.getSupabaseOAuthStartUrl();
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const width = 620;
    const height = 760;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'supabase_oauth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    popupRef.current = popup;
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        setConnectingOAuth(false);
      }
    }, 500);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await integrationService.disconnectSupabase();
      setStatus(null);
      setProjects([]);
      setConnections([]);
      setModalState('disconnected');
      setActiveTab('connect');
    } catch {
      setError('Failed to disconnect Supabase. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCreateConnection = async () => {
    setCreatingConnection(true);
    setError(null);
    try {
      if (!selectedProjectRef) throw new Error('Choose a Supabase project first.');
      if (!connectionUri.trim() && !dbPassword.trim()) {
        throw new Error('Provide a database password or a full Postgres connection URI.');
      }
      const created = await integrationService.createSupabaseConnection({
        project_ref: selectedProjectRef,
        project_name: selectedProject?.name || selectedProjectRef,
        organization_id: selectedProject?.organization_id || '',
        connection_uri: connectionUri.trim(),
        db_password: dbPassword.trim(),
        display_name: displayName.trim(),
        include_schemas: splitCsv(schemaAllowlist),
        source_timezone: sourceTimezone || 'UTC',
        service_role_key: serviceRoleKey.trim(),
        max_export_bytes: maxExportBytes,
      });
      setConnections((prev) => [created, ...prev.filter((item) => item.connection_id !== created.connection_id)]);
      setSelectedConnectionId(created.connection_id);
      setActiveTab('tables');
      const refreshed = await integrationService.refreshSupabaseSchema(created.connection_id);
      setConnections((prev) => prev.map((item) => item.connection_id === refreshed.connection_id ? refreshed : item));
      setConnectionUri('');
      setDbPassword('');
      setServiceRoleKey('');
      void checkConnectionStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Supabase.');
    } finally {
      setCreatingConnection(false);
    }
  };

  const handleRefreshSchema = async () => {
    if (!selectedConnectionId) return;
    setRefreshingSchema(true);
    setError(null);
    try {
      const refreshed = await integrationService.refreshSupabaseSchema(selectedConnectionId);
      setConnections((prev) => prev.map((item) => item.connection_id === refreshed.connection_id ? refreshed : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh Supabase schema.');
    } finally {
      setRefreshingSchema(false);
    }
  };

  const handleSample = async () => {
    if (!selectedConnectionId || !selectedTable) return;
    setSampling(true);
    setError(null);
    try {
      const response = await integrationService.sampleSupabaseTable(selectedConnectionId, {
        schema_name: selectedTable.schema,
        table_name: selectedTable.name,
        columns: selectedColumns,
        limit: 25,
      });
      if (!response.success) throw new Error(response.error || 'Failed to sample Supabase table.');
      setSample({
        columns: response.columns || [],
        rows: response.rows || [],
        generated_sql: response.generated_sql || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sample Supabase table.');
    } finally {
      setSampling(false);
    }
  };

  const handleColumnToggle = (columnName: string) => {
    setSelectedColumns((current) =>
      current.includes(columnName)
        ? current.filter((item) => item !== columnName)
        : [...current, columnName]
    );
  };

  const handleSync = async () => {
    if (!selectedConnectionId) return;
    setSyncing(true);
    setError(null);
    try {
      if (needsTable && !selectedTable) throw new Error('Choose a table before syncing.');
      const promptProjectId = currentProjectId || useChatStore.getState().uploadedFiles.find((file) => file.projectId)?.projectId;
      const result = await syncSupabase({
        connection_id: selectedConnectionId,
        sync_mode: syncMode,
        ...(promptProjectId && { project_id: promptProjectId }),
        ...(selectedTable && {
          schema_name: selectedTable.schema,
          table_name: selectedTable.name,
        }),
        columns: selectedColumns,
        row_limit: rowLimit,
        max_bytes: maxExportBytes,
        date_filter_column: dateFilterColumn === 'none' ? undefined : dateFilterColumn,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        group_by_columns: splitCsv(groupColumns),
        metric_columns: splitCsv(metricColumns),
        bucket,
      });
      addFiles([
        {
          fileID: result.asset.asset_id,
          filename: result.asset.filename,
          size: result.asset.size_bytes || 0,
          ext: result.asset.extension || 'csv',
          status: 'uploaded',
          projectId: result.asset.project_id || undefined,
          sourceType: 'Supabase',
          accountName: safeSourceName(selectedConnection),
          propertyName: syncMode === 'profile_only'
            ? 'Schema Profile'
            : syncMode === 'app_profile'
              ? 'Auth & Storage Profile'
              : selectedTablePath || 'Supabase',
          rowCount: result.row_count,
          columnCount: result.column_count,
          schemaOnly: (result.row_count || 0) === 0,
        },
      ]);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync Supabase data.');
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
            throw new Error(result.error || 'Failed to add Supabase data to the current project.');
          }
          selectedAsset = result.assets[0];
          resolvedProjectId = result.project.id;
        } else {
          const projectName = `${run.entityName || 'Supabase'} Project`;
          const result = await integrationService.addConnectorEntityToNewProject(
            run.connectorKey,
            run.entityId,
            { project_name: projectName, prompt: 'Analyze this Supabase application database data and build a dashboard.', asset_id: run.asset_id }
          );
          if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
            throw new Error(result.error || 'Failed to create project context from Supabase data.');
          }
          selectedAsset = result.asset;
          resolvedProjectId = result.project.project_id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project context from Supabase data.');
        return;
      }
    }
    addFiles([
      {
        fileID: selectedAsset?.asset_id || run.asset_id,
        filename: selectedAsset?.filename || run.asset_filename || 'supabase.csv',
        size: selectedAsset?.size_bytes || run.config_snapshot?.size_bytes || 0,
        ext: selectedAsset?.extension || 'csv',
        status: 'uploaded',
        projectId: resolvedProjectId,
        sourceType: 'Supabase',
        accountName: run.accountName || 'Supabase',
        propertyName: run.entityName || 'Supabase',
        syncVersionName: run.sync_version_name || run.version_name,
      },
    ]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalStyles.content}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 flex items-center justify-center overflow-hidden rounded bg-[#051f1a]">
              <img src="/supabase.svg" alt="Supabase" className="w-8 h-8 object-contain" />
            </div>
            <DialogTitle className="text-xl font-semibold">Connect Supabase</DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground text-sm">
            Sync application tables with schema, RLS, Auth, and Storage context.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">
          {modalState === 'checking' && (
            <div className={modalStyles.loadingCompact}>
              <Loader2 className="w-6 h-6 animate-spin mb-2 text-[#3ECF8E]" />
              <p className="text-sm">Checking connection...</p>
            </div>
          )}

          {modalState === 'disconnected' && (
            <div className="space-y-4">
              <div className={modalStyles.infoPanel}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2"><Database className="h-4 w-4 text-[#3ECF8E]" /> Postgres tables</div>
                  <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#3ECF8E]" /> RLS profile</div>
                  <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-[#3ECF8E]" /> Auth summary</div>
                  <div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-[#3ECF8E]" /> Storage summary</div>
                </div>
              </div>
            </div>
          )}

          {modalState === 'connected' && (
            <>
              <div className="flex items-center justify-between p-3 border border-[#3ECF8E]/30 rounded-lg bg-[#3ECF8E]/10">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                    <span className="text-sm font-medium text-foreground">
                      {status?.oauth_connected ? 'Management API connected' : 'Database connected'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {connections.length > 0 ? `${connections.length} connection${connections.length === 1 ? '' : 's'}` : 'Supabase'}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" className={modalStyles.ghostButtonSmall} onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              </div>

              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ActiveTab)} className="mt-4">
                <TabsList className={modalStyles.tabsListWithMargin}>
                  <TabsTrigger value="connect" className={modalStyles.tabsTrigger}>Connect</TabsTrigger>
                  <TabsTrigger value="tables" className={modalStyles.tabsTrigger}>Tables</TabsTrigger>
                  <TabsTrigger value="connected" className={modalStyles.tabsTrigger}>Synced</TabsTrigger>
                </TabsList>

                <TabsContent value="connect" className="space-y-4 outline-none">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Project</Label>
                      <Select value={selectedProjectRef} onValueChange={setSelectedProjectRef} disabled={!status?.oauth_connected || projects.length === 0}>
                        <SelectTrigger className={modalStyles.selectTrigger}>
                          <SelectValue placeholder={status?.oauth_connected ? 'Select project' : 'Connect OAuth'} />
                        </SelectTrigger>
                        <SelectContent className={modalStyles.selectContent}>
                          {projects.map((project) => (
                            <SelectItem key={project.ref} value={project.ref}>{project.name || project.ref}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Display Name</Label>
                      <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={selectedProject?.name || 'Supabase'} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className={modalStyles.label}>Postgres URI</Label>
                    <Textarea
                      value={connectionUri}
                      onChange={(event) => setConnectionUri(event.target.value)}
                      placeholder="postgresql://user:password@db.project-ref.supabase.co:5432/postgres"
                      className="min-h-[72px] font-mono text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>DB Password</Label>
                      <Input type="password" value={dbPassword} onChange={(event) => setDbPassword(event.target.value)} placeholder="Used when URI is empty" />
                    </div>
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Schema Allowlist</Label>
                      <Input value={schemaAllowlist} onChange={(event) => setSchemaAllowlist(event.target.value)} placeholder="public" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Timezone</Label>
                      <Input value={sourceTimezone} onChange={(event) => setSourceTimezone(event.target.value)} placeholder="UTC" />
                    </div>
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Byte Cap</Label>
                      <Input
                        type="number"
                        min={1000000}
                        value={maxExportBytes}
                        onChange={(event) => setMaxExportBytes(Math.max(1_000_000, Number(event.target.value) || 10_485_760))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className={modalStyles.label}>Service Role Key</Label>
                    <Input type="password" value={serviceRoleKey} onChange={(event) => setServiceRoleKey(event.target.value)} placeholder="Optional" />
                  </div>
                </TabsContent>

                <TabsContent value="tables" className="space-y-4 outline-none">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Connection</Label>
                      <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId} disabled={connections.length === 0}>
                        <SelectTrigger className={modalStyles.selectTrigger}>
                          <SelectValue placeholder="Choose connection" />
                        </SelectTrigger>
                        <SelectContent className={modalStyles.selectContent}>
                          {connections.map((connection) => (
                            <SelectItem key={connection.connection_id} value={connection.connection_id}>
                              {connection.display_name || connection.project_ref}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Sync Mode</Label>
                      <Select value={syncMode} onValueChange={(value) => setSyncMode(value as SupabaseSyncMode)}>
                        <SelectTrigger className={modalStyles.selectTrigger}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={modalStyles.selectContent}>
                          {SYNC_MODES.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {selectedConnection && (
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{selectedConnection.connection_mode || 'direct'}</Badge>
                      <Badge variant="secondary">{formatBytes(selectedConnection.max_export_bytes)} cap</Badge>
                      {selectedConnection.credential_risk === 'admin_role' && <Badge variant="destructive">Admin credential</Badge>}
                    </div>
                  )}

                  {needsTable && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className={modalStyles.label}>Table</Label>
                          <Button type="button" size="sm" variant="ghost" onClick={handleRefreshSchema} disabled={!selectedConnectionId || refreshingSchema}>
                            {refreshingSchema ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Refresh
                          </Button>
                        </div>
                        <Select value={selectedTablePath} onValueChange={setSelectedTablePath} disabled={tables.length === 0}>
                          <SelectTrigger className={modalStyles.selectTrigger}>
                            <SelectValue placeholder={tables.length === 0 ? 'Refresh schema first' : 'Choose table'} />
                          </SelectTrigger>
                          <SelectContent className={modalStyles.selectContent}>
                            {tables.map((table) => (
                              <SelectItem key={tablePath(table)} value={tablePath(table)}>
                                {tablePath(table)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedTable && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Table2 className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{tablePath(selectedTable)}</span>
                            {selectedTable.rls_enabled && <Badge variant="secondary">RLS enabled</Badge>}
                            {(selectedTable.policy_count || 0) > 0 && <Badge variant="secondary">{selectedTable.policy_count} policies</Badge>}
                            {(selectedTable.row_estimate || 0) > 0 && <Badge variant="secondary">{selectedTable.row_estimate} rows est.</Badge>}
                          </div>
                          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                            {tableColumns.map((column) => (
                              <button
                                key={column.name}
                                type="button"
                                onClick={() => handleColumnToggle(column.name)}
                                className={`flex items-center justify-between rounded border px-2 py-1.5 text-left text-xs transition-colors ${
                                  selectedColumns.includes(column.name)
                                    ? 'border-[#3ECF8E]/70 bg-[#3ECF8E]/10 text-foreground'
                                    : 'border-border bg-background text-muted-foreground'
                                }`}
                              >
                                <span className="truncate">{column.name}</span>
                                {column.possible_pii && <span className="ml-2 text-[10px] text-amber-600">PII</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Row Cap</Label>
                          <Input
                            type="number"
                            min={1}
                            max={50000}
                            value={rowLimit}
                            onChange={(event) => setRowLimit(Math.max(1, Math.min(50000, Number(event.target.value) || 5000)))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className={modalStyles.label}>Date Column</Label>
                          <Select value={dateFilterColumn} onValueChange={setDateFilterColumn}>
                            <SelectTrigger className={modalStyles.selectTrigger}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={modalStyles.selectContent}>
                              <SelectItem value="none">No date filter</SelectItem>
                              {tableColumns.map((column) => (
                                <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {dateFilterColumn !== 'none' && (
                        <div className="grid grid-cols-2 gap-3">
                          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                        </div>
                      )}

                      {syncMode === 'aggregated_result' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label className={modalStyles.label}>Group Columns</Label>
                            <Input value={groupColumns} onChange={(event) => setGroupColumns(event.target.value)} placeholder="status, plan" />
                          </div>
                          <div className="space-y-2">
                            <Label className={modalStyles.label}>Metric Columns</Label>
                            <Input value={metricColumns} onChange={(event) => setMetricColumns(event.target.value)} placeholder="amount, quantity" />
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {syncMode === 'app_profile' && (
                    <div className="space-y-2">
                      <Label className={modalStyles.label}>Storage Bucket</Label>
                      <Input value={bucket} onChange={(event) => setBucket(event.target.value || 'all')} placeholder="all" />
                    </div>
                  )}

                  {sample && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground truncate">
                        {sample.generated_sql}
                      </div>
                      <div className="max-h-44 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/30">
                            <tr>{sample.columns.map((column) => <th key={column} className="px-2 py-1 text-left font-medium">{column}</th>)}</tr>
                          </thead>
                          <tbody>
                            {sample.rows.map((row, idx) => (
                              <tr key={idx} className="border-t border-border/50">
                                {row.map((cell, cellIdx) => <td key={`${idx}-${cellIdx}`} className="px-2 py-1 text-muted-foreground">{String(cell ?? '')}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="connected" className="outline-none">
                  <ConnectedEntitiesList connectorKey="supabase" onSelectAsset={handleSelectConnectedAsset} />
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
          <Button type="button" variant="ghost" onClick={onClose} className={modalStyles.ghostButton} disabled={connectingOAuth || creatingConnection || syncing}>
            Cancel
          </Button>
          {modalState === 'disconnected' && (
            <Button type="button" onClick={handleOAuthConnect} disabled={connectingOAuth} className="bg-[#3ECF8E] hover:bg-[#35b77e] text-[#051f1a] font-medium px-4 py-2 rounded-md transition-colors">
              {connectingOAuth ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</> : 'Connect Supabase'}
            </Button>
          )}
          {modalState === 'connected' && activeTab === 'connect' && (
            <Button type="button" onClick={handleCreateConnection} disabled={creatingConnection || !selectedProjectRef} className="bg-[#3ECF8E] hover:bg-[#35b77e] text-[#051f1a] font-medium px-4 py-2 rounded-md transition-colors">
              {creatingConnection ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</> : 'Save Connection'}
            </Button>
          )}
          {modalState === 'connected' && activeTab === 'tables' && (
            <>
              {needsTable && (
                <Button type="button" variant="outline" onClick={handleSample} disabled={!selectedTable || sampling}>
                  {sampling ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sampling...</> : 'Sample'}
                </Button>
              )}
              <Button type="button" onClick={handleSync} disabled={!selectedConnectionId || (needsTable && !selectedTable) || syncing} className="bg-[#3ECF8E] hover:bg-[#35b77e] text-[#051f1a] font-medium px-4 py-2 rounded-md transition-colors">
                {syncing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing...</> : 'Sync Data'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
