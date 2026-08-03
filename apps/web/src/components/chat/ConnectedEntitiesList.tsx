import React, { useState, useEffect, useMemo } from 'react';
import { integrationService, ConnectorSelectedEntity, ConnectorEntityRunItem } from '@/services/integrationService';
import { ChevronDown, ChevronRight, Loader2, Database, Clock } from 'lucide-react';
import { formatToDisplay } from '@/utils/timestamp';

interface ConnectedEntitiesListProps {
  connectorKey: string;
  filterAccountName?: string;
  availableEntityIds?: string[];
  onSelectAsset: (asset: any) => void;
}

const CONNECTOR_ACCENT_STYLES: Record<string, { rowHoverBg: string; runHoverText: string }> = {
  ga4: { rowHoverBg: 'hover:bg-orange-500/10', runHoverText: 'group-hover:text-orange-500' },
  google_ads: { rowHoverBg: 'hover:bg-blue-500/10', runHoverText: 'group-hover:text-blue-500' },
  meta_ads: { rowHoverBg: 'hover:bg-blue-500/10', runHoverText: 'group-hover:text-blue-500' },
  tiktok_ads: { rowHoverBg: 'hover:bg-sky-500/10', runHoverText: 'group-hover:text-sky-500' },
  stripe: { rowHoverBg: 'hover:bg-violet-500/10', runHoverText: 'group-hover:text-violet-500' },
  appsflyer: { rowHoverBg: 'hover:bg-violet-500/10', runHoverText: 'group-hover:text-violet-500' },
  google_sheets: { rowHoverBg: 'hover:bg-emerald-500/10', runHoverText: 'group-hover:text-emerald-500' },
  firebase: { rowHoverBg: 'hover:bg-amber-500/10', runHoverText: 'group-hover:text-amber-500' },
};

export function ConnectedEntitiesList({ connectorKey, filterAccountName, availableEntityIds, onSelectAsset }: ConnectedEntitiesListProps) {
  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<ConnectorSelectedEntity[]>([]);
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  const [syncVersionCountByEntityId, setSyncVersionCountByEntityId] = useState<Record<string, number>>({});
  const accentStyles = CONNECTOR_ACCENT_STYLES[connectorKey] || {
    rowHoverBg: 'hover:bg-primary/10',
    runHoverText: 'group-hover:text-primary',
  };

  useEffect(() => {
    const fetchEntities = async () => {
      setLoading(true);
      try {
        const res = await integrationService.fetchConnectorsOverview();
        if (res.success) {
          const connector = res.connectors.find(c => c.connector_key === connectorKey);
          let foundEntities = connector?.selected_entities || [];
          
          if (availableEntityIds && availableEntityIds.length > 0) {
            foundEntities = foundEntities.filter(e => availableEntityIds.includes(e.id));
          } else if (filterAccountName) {
            // Fallback for connectors that don't pass availableEntityIds
            // Allow e.account_name to be missing for legacy connected entities
            foundEntities = foundEntities.filter(e => !e.account_name || e.account_name === filterAccountName);
          }
          
          setEntities(foundEntities);
          const counts = await Promise.all(
            foundEntities.map(async (entity) => {
              try {
                const historyRes = await integrationService.fetchConnectorEntityHistory(connectorKey, entity.id, 50);
                return [entity.id, historyRes.success ? (historyRes.runs || []).length : 0] as const;
              } catch {
                return [entity.id, 0] as const;
              }
            })
          );
          setSyncVersionCountByEntityId(Object.fromEntries(counts));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchEntities();
  }, [availableEntityIds, connectorKey, filterAccountName]);

  if (loading) {
    return <div className="py-4 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />Loading connected properties...</div>;
  }

  if (entities.length === 0) {
    return <div className="py-4 text-center text-sm text-muted-foreground border border-border rounded-lg bg-muted/30">No connected properties found for this account.</div>;
  }

  return (
    <div className="space-y-2 mt-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
      {entities.map(entity => (
        <EntityHistoryItem 
          key={entity.id} 
          connectorKey={connectorKey} 
          entity={entity} 
          accentStyles={accentStyles}
          syncVersionCount={syncVersionCountByEntityId[entity.id]}
          isExpanded={expandedEntityId === entity.id}
          onToggle={() => setExpandedEntityId(expandedEntityId === entity.id ? null : entity.id)}
          onSelectAsset={(asset) =>
            onSelectAsset({
              ...asset,
              connectorKey,
              entityId: entity.id,
              entityName: entity.name,
              accountName: entity.account_name || filterAccountName,
            })
          }
        />
      ))}
    </div>
  );
}

function EntityHistoryItem({ 
  connectorKey, 
  entity, 
  accentStyles,
  syncVersionCount,
  isExpanded, 
  onToggle, 
  onSelectAsset 
}: { 
  connectorKey: string; 
  entity: ConnectorSelectedEntity; 
  accentStyles: { rowHoverBg: string; runHoverText: string };
  syncVersionCount?: number;
  isExpanded: boolean; 
  onToggle: () => void;
  onSelectAsset: (asset: any) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ConnectorEntityRunItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (isExpanded && !hasLoaded) {
      const loadHistory = async () => {
        setLoading(true);
        try {
          const res = await integrationService.fetchConnectorEntityHistory(connectorKey, entity.id, 50);
          if (res.success) {
            setHistory(res.runs || []);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
          setHasLoaded(true);
        }
      };
      loadHistory();
    }
  }, [isExpanded, hasLoaded, connectorKey, entity.id]);

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      const timeA = new Date(a.triggered_at || a.completed_at || 0).getTime();
      const timeB = new Date(b.triggered_at || b.completed_at || 0).getTime();
      return timeA - timeB;
    });
  }, [history]);

  const getSyncVersionLabel = (run: ConnectorEntityRunItem, index: number) => {
    if (run.sync_version_name?.trim()) return run.sync_version_name;
    if ((run as any).version_name?.trim()) return (run as any).version_name;
    return `Sync Version ${index + 1}`;
  };

  return (
    <div className="border border-border rounded-lg bg-background overflow-hidden">
      <button 
        type="button" 
        onClick={onToggle}
        className={`w-full flex items-center justify-between p-3 text-left transition-colors focus:outline-none ${accentStyles.rowHoverBg}`}
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{entity.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {typeof syncVersionCount === 'number' ? syncVersionCount : 0} sync version{(syncVersionCount ?? 0) === 1 ? '' : 's'}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="p-2 border-t border-border bg-muted/30">
          {loading ? (
            <div className="py-4 text-center text-sm text-muted-foreground flex flex-col items-center">
              <Loader2 className="w-4 h-4 animate-spin mb-2" />
              Loading history...
            </div>
          ) : sortedHistory.length === 0 ? (
            <div className="py-3 text-center text-xs text-muted-foreground">No sync history available</div>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
              {sortedHistory.map((run, idx) => (
                <button
                  key={run.run_id}
                  type="button"
                  className={`w-full flex flex-col p-2 rounded transition-colors text-left group ${accentStyles.rowHoverBg}`}
                  onClick={() => onSelectAsset({ ...run, sync_version_name: getSyncVersionLabel(run, idx) })}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium text-foreground transition-colors ${accentStyles.runHoverText}`}>
                      {getSyncVersionLabel(run, idx)}
                    </span>
                    {run.status === 'success' ? (
                      <span className="text-[10px] bg-green-500/20 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">Success</span>
                    ) : (
                      <span className="text-[10px] bg-red-500/20 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">Failed</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {run.completed_at ? formatToDisplay(run.completed_at, { format: 'date' }) : 'Unknown'}
                    </span>
                    {run.rows_fetched != null && (
                      <span>{run.rows_fetched} rows</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
