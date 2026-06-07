import { useEffect, useMemo, useState } from 'react';
import { Cloud, Database, Loader2, RefreshCw, Snowflake, Table2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useChatStore } from '@/chat/useChatStore';
import {
  integrationService,
  type WarehouseConnection,
  type WarehouseConnectorKey,
  type WarehouseSampleResponse,
  type WarehouseTable,
} from '@/services/integrationService';

const WAREHOUSE_LABELS: Record<WarehouseConnectorKey, string> = {
  postgres: 'PostgreSQL',
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  databricks: 'Databricks',
};

function tableKey(table: WarehouseTable): string {
  return `${table.schema}.${table.name}`;
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPositiveNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export default function WarehouseIntegrationModal() {
  const { toast } = useToast();
  const {
    isWarehouseModalOpen: isOpen,
    warehouseModalConnectorKey,
    setWarehouseModalOpen: setOpen,
    currentProjectId,
    addFiles,
  } = useChatStore();

  const [connectorKey, setConnectorKey] = useState<WarehouseConnectorKey>(warehouseModalConnectorKey);
  const [connections, setConnections] = useState<WarehouseConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [selectedTableKey, setSelectedTableKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [connectionUri, setConnectionUri] = useState('');
  const [includeSchemas, setIncludeSchemas] = useState('');
  const [bigQueryProjectId, setBigQueryProjectId] = useState('');
  const [bigQueryLocation, setBigQueryLocation] = useState('US');
  const [bigQueryServiceAccountJson, setBigQueryServiceAccountJson] = useState('');
  const [includedDatasets, setIncludedDatasets] = useState('');
  const [maxBillingBytes, setMaxBillingBytes] = useState('10737418240');
  const [snowflakeAccount, setSnowflakeAccount] = useState('');
  const [snowflakeUsername, setSnowflakeUsername] = useState('');
  const [snowflakePrivateKeyPem, setSnowflakePrivateKeyPem] = useState('');
  const [snowflakePrivateKeyPassphrase, setSnowflakePrivateKeyPassphrase] = useState('');
  const [snowflakeWarehouse, setSnowflakeWarehouse] = useState('');
  const [snowflakeDatabase, setSnowflakeDatabase] = useState('');
  const [snowflakeRole, setSnowflakeRole] = useState('');
  const [includedSchemas, setIncludedSchemas] = useState('');
  const [maxAssignedBytes, setMaxAssignedBytes] = useState('10737418240');
  const [databricksServerHostname, setDatabricksServerHostname] = useState('');
  const [databricksHttpPath, setDatabricksHttpPath] = useState('');
  const [databricksAccessToken, setDatabricksAccessToken] = useState('');
  const [databricksCatalog, setDatabricksCatalog] = useState('');
  const [databricksIncludedSchemas, setDatabricksIncludedSchemas] = useState('');
  const [maxResultBytes, setMaxResultBytes] = useState('10737418240');
  const [statementTimeoutSeconds, setStatementTimeoutSeconds] = useState('300');
  const [sourceTimezone, setSourceTimezone] = useState('UTC');
  const [rowLimit, setRowLimit] = useState('5000');
  const [selectedColumns, setSelectedColumns] = useState('');
  const [sample, setSample] = useState<WarehouseSampleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectorLabel = WAREHOUSE_LABELS[connectorKey];
  const modeConnections = useMemo(
    () => connections.filter((connection) => connection.connector_key === connectorKey),
    [connections, connectorKey]
  );
  const selectedConnection = modeConnections.find((connection) => connection.connection_id === selectedConnectionId);
  const tables = useMemo(() => (
    selectedConnection?.schema_snapshot?.schemas.flatMap((schema) => schema.tables) || []
  ), [selectedConnection]);
  const selectedTable = tables.find((table) => tableKey(table) === selectedTableKey);
  const columnOptions = selectedTable?.columns || [];
  const WarehouseIcon = connectorKey === 'bigquery' ? Cloud : connectorKey === 'snowflake' ? Snowflake : Database;

  const loadConnections = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await integrationService.fetchWarehouseConnections();
      if (!response.success) throw new Error(response.error || 'Failed to load warehouse connections.');
      setConnections(response.connections);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load warehouse connections.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setConnectorKey(warehouseModalConnectorKey);
      void loadConnections();
    } else {
      setError(null);
      setSample(null);
    }
  }, [isOpen, warehouseModalConnectorKey]);

  useEffect(() => {
    const currentStillVisible = modeConnections.some((connection) => connection.connection_id === selectedConnectionId);
    if (!currentStillVisible) {
      setSelectedConnectionId(modeConnections[0]?.connection_id || '');
    }
  }, [modeConnections, selectedConnectionId]);

  useEffect(() => {
    setSelectedTableKey(tables[0] ? tableKey(tables[0]) : '');
    setSelectedColumns('');
    setSample(null);
  }, [selectedConnectionId, tables]);

  const handleModeChange = (value: string) => {
    if (!value) return;
    setConnectorKey(value as WarehouseConnectorKey);
    setError(null);
    setSample(null);
  };

  const handleQuickConnect = async () => {
    if (connectorKey === 'postgres' && !connectionUri.trim()) {
      setError('Paste a PostgreSQL connection URI first.');
      return;
    }
    if (connectorKey === 'bigquery') {
      if (!bigQueryProjectId.trim()) {
        setError('Enter a BigQuery project ID first.');
        return;
      }
      if (!bigQueryLocation.trim()) {
        setError('Enter the BigQuery location first.');
        return;
      }
      if (!bigQueryServiceAccountJson.trim()) {
        setError('Paste a BigQuery service account JSON key first.');
        return;
      }
    }
    if (connectorKey === 'snowflake') {
      if (!snowflakeAccount.trim()) {
        setError('Enter a Snowflake account identifier first.');
        return;
      }
      if (!snowflakeUsername.trim()) {
        setError('Enter a Snowflake username first.');
        return;
      }
      if (!snowflakePrivateKeyPem.trim()) {
        setError('Paste a Snowflake private key PEM first.');
        return;
      }
      if (!snowflakeWarehouse.trim()) {
        setError('Enter a Snowflake warehouse first.');
        return;
      }
      if (!snowflakeDatabase.trim()) {
        setError('Enter a Snowflake database first.');
        return;
      }
    }
    if (connectorKey === 'databricks') {
      if (!databricksServerHostname.trim()) {
        setError('Enter a Databricks server hostname first.');
        return;
      }
      if (!databricksHttpPath.trim()) {
        setError('Enter a Databricks SQL Warehouse HTTP path first.');
        return;
      }
      if (!databricksAccessToken.trim()) {
        setError('Paste a Databricks access token first.');
        return;
      }
      if (!databricksCatalog.trim()) {
        setError('Enter a Databricks catalog first.');
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const connection = await integrationService.quickConnectWarehouse({
        connector_key: connectorKey,
        connection_uri: connectorKey === 'postgres' ? connectionUri.trim() : '',
        display_name: displayName.trim(),
        include_schemas: connectorKey === 'postgres' ? parseList(includeSchemas) : [],
        included_datasets: connectorKey === 'bigquery' ? parseList(includedDatasets) : [],
        project_id: connectorKey === 'bigquery' ? bigQueryProjectId.trim() : '',
        location: connectorKey === 'bigquery' ? bigQueryLocation.trim() : '',
        service_account_json: connectorKey === 'bigquery' ? bigQueryServiceAccountJson.trim() : '',
        max_billing_bytes: connectorKey === 'bigquery' ? toPositiveNumber(maxBillingBytes) : undefined,
        account: connectorKey === 'snowflake' ? snowflakeAccount.trim() : '',
        username: connectorKey === 'snowflake' ? snowflakeUsername.trim() : '',
        private_key_pem: connectorKey === 'snowflake' ? snowflakePrivateKeyPem.trim() : '',
        private_key_passphrase: connectorKey === 'snowflake' ? snowflakePrivateKeyPassphrase.trim() : '',
        warehouse: connectorKey === 'snowflake' ? snowflakeWarehouse.trim() : '',
        database: connectorKey === 'snowflake' ? snowflakeDatabase.trim() : '',
        role: connectorKey === 'snowflake' ? snowflakeRole.trim() : '',
        max_assigned_bytes: connectorKey === 'snowflake' ? toPositiveNumber(maxAssignedBytes) : undefined,
        server_hostname: connectorKey === 'databricks' ? databricksServerHostname.trim() : '',
        http_path: connectorKey === 'databricks' ? databricksHttpPath.trim() : '',
        access_token: connectorKey === 'databricks' ? databricksAccessToken.trim() : '',
        catalog: connectorKey === 'databricks' ? databricksCatalog.trim() : '',
        included_schemas: connectorKey === 'databricks' ? parseList(databricksIncludedSchemas) : connectorKey === 'snowflake' ? parseList(includedSchemas) : [],
        max_result_bytes: connectorKey === 'databricks' ? toPositiveNumber(maxResultBytes) : undefined,
        statement_timeout_seconds: connectorKey === 'databricks' ? toPositiveNumber(statementTimeoutSeconds) : undefined,
        source_timezone: sourceTimezone.trim() || 'UTC',
      });
      const refreshed = await integrationService.refreshWarehouseSchema(connection.connection_id);
      setConnections((prev) => [refreshed, ...prev.filter((item) => item.connection_id !== refreshed.connection_id)]);
      setSelectedConnectionId(refreshed.connection_id);
      setConnectionUri('');
      setBigQueryServiceAccountJson('');
      setSnowflakePrivateKeyPem('');
      setSnowflakePrivateKeyPassphrase('');
      setDatabricksAccessToken('');
      setDisplayName('');
      toast({ title: `${connectorLabel} connected`, description: 'Schema is ready to browse.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to connect ${connectorLabel}.`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshSchema = async () => {
    if (!selectedConnectionId) return;
    setRefreshing(true);
    setError(null);
    try {
      const refreshed = await integrationService.refreshWarehouseSchema(selectedConnectionId);
      setConnections((prev) => prev.map((item) => item.connection_id === refreshed.connection_id ? refreshed : item));
      toast({ title: 'Schema refreshed', description: `${refreshed.schema_snapshot.table_count} tables found.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh schema.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSample = async () => {
    if (!selectedConnectionId || !selectedTable) return;
    setSampling(true);
    setError(null);
    try {
      const columns = parseList(selectedColumns);
      const result = await integrationService.sampleWarehouseTable(selectedConnectionId, {
        schema_name: selectedTable.schema,
        table_name: selectedTable.name,
        columns: columns.length > 0 ? columns : undefined,
        limit: 25,
      });
      if (!result.success) throw new Error(result.error || 'Failed to sample table.');
      setSample(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sample table.');
    } finally {
      setSampling(false);
    }
  };

  const handleSync = async () => {
    if (!selectedConnectionId || !selectedTable) return;
    setSyncing(true);
    setError(null);
    try {
      const columns = parseList(selectedColumns);
      const result = await integrationService.syncWarehouseTable(selectedConnectionId, {
        schema_name: selectedTable.schema,
        table_name: selectedTable.name,
        columns: columns.length > 0 ? columns : undefined,
        project_id: currentProjectId || undefined,
        row_limit: Number(rowLimit) || 5000,
      });
      if (!result.success || !result.asset) throw new Error(result.error || 'Failed to sync table.');

      addFiles([{
        fileID: result.asset.asset_id,
        filename: result.asset.filename || `${selectedTable.schema}.${selectedTable.name}.csv`,
        size: result.asset.size_bytes || 0,
        ext: result.asset.extension || 'csv',
        status: 'uploaded',
        projectId: result.asset.project_id,
        rowCount: result.row_count,
        columnCount: result.column_count,
        sourceType: connectorLabel,
        accountName: selectedConnection?.display_name,
        propertyName: `${selectedTable.schema}.${selectedTable.name}`,
      }]);
      window.dispatchEvent(new CustomEvent('dreamify:connector-synced', { detail: { connector: connectorLabel, at: Date.now() } }));
      toast({ title: 'Warehouse extract synced', description: `${result.row_count ?? 0} rows added to Dreamify.` });
      setOpen(false, connectorKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync warehouse table.');
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteConnection = async () => {
    if (!selectedConnectionId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await integrationService.deleteWarehouseConnection(selectedConnectionId);
      if (!response.success) throw new Error(response.error || 'Failed to delete connection.');
      setConnections((prev) => prev.filter((item) => item.connection_id !== selectedConnectionId));
      setSelectedConnectionId('');
      toast({ title: 'Connection deleted' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => setOpen(open, connectorKey)}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <WarehouseIcon className="h-4 w-4" />
            </div>
            <DialogTitle>{connectorLabel} Warehouse</DialogTitle>
          </div>
        </DialogHeader>

        <ToggleGroup
          type="single"
          value={connectorKey}
          onValueChange={handleModeChange}
          className="w-full justify-start rounded-lg bg-muted/50 p-1"
        >
          <ToggleGroupItem value="postgres" aria-label="PostgreSQL warehouse" className="flex-1 text-xs sm:text-sm">
            PostgreSQL
          </ToggleGroupItem>
          <ToggleGroupItem value="bigquery" aria-label="BigQuery warehouse" className="flex-1 text-xs sm:text-sm">
            BigQuery
          </ToggleGroupItem>
          <ToggleGroupItem value="snowflake" aria-label="Snowflake warehouse" className="flex-1 text-xs sm:text-sm">
            Snowflake
          </ToggleGroupItem>
          <ToggleGroupItem value="databricks" aria-label="Databricks warehouse" className="flex-1 text-xs sm:text-sm">
            Databricks
          </ToggleGroupItem>
        </ToggleGroup>

        <Tabs defaultValue="connect" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="connect">Connect</TabsTrigger>
            <TabsTrigger value="tables">Tables</TabsTrigger>
          </TabsList>

          <TabsContent value="connect" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Display name</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Production warehouse" />
              </div>
              <div className="space-y-1.5">
                <Label>Source timezone</Label>
                <Input value={sourceTimezone} onChange={(e) => setSourceTimezone(e.target.value)} placeholder="UTC" />
              </div>
            </div>

            {connectorKey === 'postgres' ? (
              <>
                <div className="space-y-1.5">
                  <Label>Connection URI</Label>
                  <Input
                    value={connectionUri}
                    onChange={(e) => setConnectionUri(e.target.value)}
                    placeholder="postgresql://user:password@host:5432/database"
                    type="password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Restrict schemas</Label>
                  <Input
                    value={includeSchemas}
                    onChange={(e) => setIncludeSchemas(e.target.value)}
                    placeholder="public, analytics"
                  />
                </div>
              </>
            ) : connectorKey === 'bigquery' ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Project ID</Label>
                    <Input
                      value={bigQueryProjectId}
                      onChange={(e) => setBigQueryProjectId(e.target.value)}
                      placeholder="my-gcp-project"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Location</Label>
                    <Input
                      value={bigQueryLocation}
                      onChange={(e) => setBigQueryLocation(e.target.value)}
                      placeholder="US"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Service account JSON</Label>
                  <Textarea
                    value={bigQueryServiceAccountJson}
                    onChange={(e) => setBigQueryServiceAccountJson(e.target.value)}
                    placeholder='{"type":"service_account","project_id":"..."}'
                    className="min-h-28 font-mono text-xs"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Restrict datasets</Label>
                    <Input
                      value={includedDatasets}
                      onChange={(e) => setIncludedDatasets(e.target.value)}
                      placeholder="analytics, reporting"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max billing bytes</Label>
                    <Input
                      value={maxBillingBytes}
                      onChange={(e) => setMaxBillingBytes(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </>
            ) : connectorKey === 'snowflake' ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Account identifier</Label>
                    <Input
                      value={snowflakeAccount}
                      onChange={(e) => setSnowflakeAccount(e.target.value)}
                      placeholder="org-account or account.region"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input
                      value={snowflakeUsername}
                      onChange={(e) => setSnowflakeUsername(e.target.value)}
                      placeholder="svc_dreamify"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Private key PEM</Label>
                  <Textarea
                    value={snowflakePrivateKeyPem}
                    onChange={(e) => setSnowflakePrivateKeyPem(e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    className="min-h-28 font-mono text-xs"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Private key passphrase</Label>
                    <Input
                      value={snowflakePrivateKeyPassphrase}
                      onChange={(e) => setSnowflakePrivateKeyPassphrase(e.target.value)}
                      type="password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Input
                      value={snowflakeRole}
                      onChange={(e) => setSnowflakeRole(e.target.value)}
                      placeholder="REPORTER"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Warehouse</Label>
                    <Input
                      value={snowflakeWarehouse}
                      onChange={(e) => setSnowflakeWarehouse(e.target.value)}
                      placeholder="COMPUTE_WH"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Database</Label>
                    <Input
                      value={snowflakeDatabase}
                      onChange={(e) => setSnowflakeDatabase(e.target.value)}
                      placeholder="ANALYTICS"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Restrict schemas</Label>
                    <Input
                      value={includedSchemas}
                      onChange={(e) => setIncludedSchemas(e.target.value)}
                      placeholder="PUBLIC, REPORTING"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max assigned bytes</Label>
                    <Input
                      value={maxAssignedBytes}
                      onChange={(e) => setMaxAssignedBytes(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Server hostname</Label>
                    <Input
                      value={databricksServerHostname}
                      onChange={(e) => setDatabricksServerHostname(e.target.value)}
                      placeholder="dbc-...cloud.databricks.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>HTTP path</Label>
                    <Input
                      value={databricksHttpPath}
                      onChange={(e) => setDatabricksHttpPath(e.target.value)}
                      placeholder="sql/1.0/warehouses/..."
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Catalog</Label>
                    <Input
                      value={databricksCatalog}
                      onChange={(e) => setDatabricksCatalog(e.target.value)}
                      placeholder="main"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Access token</Label>
                    <Input
                      value={databricksAccessToken}
                      onChange={(e) => setDatabricksAccessToken(e.target.value)}
                      type="password"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Restrict schemas</Label>
                    <Input
                      value={databricksIncludedSchemas}
                      onChange={(e) => setDatabricksIncludedSchemas(e.target.value)}
                      placeholder="analytics, reporting"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max result bytes</Label>
                    <Input
                      value={maxResultBytes}
                      onChange={(e) => setMaxResultBytes(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Timeout seconds</Label>
                    <Input
                      value={statementTimeoutSeconds}
                      onChange={(e) => setStatementTimeoutSeconds(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </>
            )}

            <Button onClick={handleQuickConnect} disabled={loading} className="w-full sm:w-auto">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WarehouseIcon className="mr-2 h-4 w-4" />}
              Connect and Refresh Schema
            </Button>
          </TabsContent>

          <TabsContent value="tables" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-1.5">
                <Label>Connection</Label>
                <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId} disabled={modeConnections.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={loading ? 'Loading...' : `Choose a ${connectorLabel} connection`} />
                  </SelectTrigger>
                  <SelectContent>
                    {modeConnections.map((connection) => (
                      <SelectItem key={connection.connection_id} value={connection.connection_id}>
                        {connection.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedConnection && (
                  <p className="text-xs text-muted-foreground">
                    {connectorKey === 'bigquery'
                      ? `${selectedConnection.project_id || selectedConnection.database || 'Project'} / ${selectedConnection.location || 'location'}`
                      : connectorKey === 'snowflake'
                        ? `${selectedConnection.account || selectedConnection.database || 'Account'} / ${selectedConnection.warehouse || 'warehouse'}`
                        : connectorKey === 'databricks'
                          ? `${selectedConnection.server_hostname || 'Workspace'} / ${selectedConnection.catalog || selectedConnection.database || 'catalog'}`
                          : `${selectedConnection.host || selectedConnection.database || 'Database'}`}
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={handleRefreshSchema} disabled={!selectedConnectionId || refreshing}>
                {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Button variant="outline" onClick={handleDeleteConnection} disabled={!selectedConnectionId || loading}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Table or view</Label>
                <Select value={selectedTableKey} onValueChange={setSelectedTableKey} disabled={tables.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a table" />
                  </SelectTrigger>
                  <SelectContent>
                    {tables.map((table) => (
                      <SelectItem key={tableKey(table)} value={tableKey(table)}>
                        {table.schema}.{table.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Row cap</Label>
                <Input value={rowLimit} onChange={(e) => setRowLimit(e.target.value)} inputMode="numeric" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Selected columns</Label>
              <Input
                value={selectedColumns}
                onChange={(e) => setSelectedColumns(e.target.value)}
                placeholder={columnOptions.slice(0, 4).map((column) => column.name).join(', ') || 'Leave blank for all columns'}
              />
              {columnOptions.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {columnOptions.length} columns available.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleSample} disabled={!selectedTable || sampling}>
                {sampling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Table2 className="mr-2 h-4 w-4" />}
                Sample
              </Button>
              <Button onClick={handleSync} disabled={!selectedTable || syncing}>
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                Sync Bounded Extract
              </Button>
            </div>

            {sample && (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">
                  Preview: {sample.generated_sql}
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-background">
                      <tr>
                        {sample.columns.map((column) => (
                          <th key={column} className="border-b border-border px-3 py-2 font-medium">{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sample.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-border/60 last:border-0">
                          {sample.columns.map((column, columnIndex) => (
                            <td key={`${rowIndex}-${column}`} className="max-w-48 truncate px-3 py-2 text-muted-foreground">
                              {String(row[columnIndex] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!loading && modeConnections.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                Connect {connectorLabel} first, then refresh schema to browse tables.
              </p>
            )}
          </TabsContent>
        </Tabs>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
