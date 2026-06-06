import { useEffect, useMemo, useState } from 'react';
import { Database, Loader2, RefreshCw, Table2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  type WarehouseSampleResponse,
  type WarehouseTable,
} from '@/services/integrationService';

function tableKey(table: WarehouseTable): string {
  return `${table.schema}.${table.name}`;
}

function parseSchemaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function WarehouseIntegrationModal() {
  const { toast } = useToast();
  const {
    isWarehouseModalOpen: isOpen,
    setWarehouseModalOpen: setOpen,
    currentProjectId,
    addFiles,
  } = useChatStore();

  const [connections, setConnections] = useState<WarehouseConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [selectedTableKey, setSelectedTableKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [connectionUri, setConnectionUri] = useState('');
  const [includeSchemas, setIncludeSchemas] = useState('');
  const [sourceTimezone, setSourceTimezone] = useState('UTC');
  const [rowLimit, setRowLimit] = useState('5000');
  const [selectedColumns, setSelectedColumns] = useState('');
  const [sample, setSample] = useState<WarehouseSampleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedConnection = connections.find((connection) => connection.connection_id === selectedConnectionId);
  const tables = useMemo(() => (
    selectedConnection?.schema_snapshot?.schemas.flatMap((schema) => schema.tables) || []
  ), [selectedConnection]);
  const selectedTable = tables.find((table) => tableKey(table) === selectedTableKey);
  const columnOptions = selectedTable?.columns || [];

  const loadConnections = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await integrationService.fetchWarehouseConnections();
      if (!response.success) throw new Error(response.error || 'Failed to load PostgreSQL connections.');
      setConnections(response.connections);
      const firstId = response.connections[0]?.connection_id || '';
      setSelectedConnectionId((current) => current || firstId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PostgreSQL connections.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadConnections();
    } else {
      setError(null);
      setSample(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedTableKey(tables[0] ? tableKey(tables[0]) : '');
    setSelectedColumns('');
    setSample(null);
  }, [selectedConnectionId, tables]);

  const handleQuickConnect = async () => {
    if (!connectionUri.trim()) {
      setError('Paste a PostgreSQL connection URI first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const connection = await integrationService.quickConnectWarehouse({
        connector_key: 'postgres',
        connection_uri: connectionUri.trim(),
        display_name: displayName.trim(),
        include_schemas: parseSchemaList(includeSchemas),
        source_timezone: sourceTimezone.trim() || 'UTC',
      });
      const refreshed = await integrationService.refreshWarehouseSchema(connection.connection_id);
      setConnections((prev) => [refreshed, ...prev.filter((item) => item.connection_id !== refreshed.connection_id)]);
      setSelectedConnectionId(refreshed.connection_id);
      setConnectionUri('');
      setDisplayName('');
      toast({ title: 'PostgreSQL connected', description: 'Schema is ready to browse.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect PostgreSQL.');
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
      const columns = parseSchemaList(selectedColumns);
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
      const columns = parseSchemaList(selectedColumns);
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
        sourceType: 'PostgreSQL',
        accountName: selectedConnection?.display_name,
        propertyName: `${selectedTable.schema}.${selectedTable.name}`,
      }]);
      window.dispatchEvent(new CustomEvent('dreamify:connector-synced', { detail: { connector: 'PostgreSQL', at: Date.now() } }));
      toast({ title: 'Warehouse extract synced', description: `${result.row_count ?? 0} rows added to Dreamify.` });
      setOpen(false);
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
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="h-4 w-4" />
            </div>
            <DialogTitle>PostgreSQL Warehouse</DialogTitle>
          </div>
        </DialogHeader>

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
            <Button onClick={handleQuickConnect} disabled={loading} className="w-full sm:w-auto">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              Connect and Refresh Schema
            </Button>
          </TabsContent>

          <TabsContent value="tables" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-1.5">
                <Label>Connection</Label>
                <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId} disabled={connections.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={loading ? 'Loading...' : 'Choose a connection'} />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((connection) => (
                      <SelectItem key={connection.connection_id} value={connection.connection_id}>
                        {connection.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  Preview · {sample.generated_sql}
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

            {!loading && connections.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                Connect PostgreSQL first, then refresh schema to browse tables.
              </p>
            )}
          </TabsContent>
        </Tabs>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
