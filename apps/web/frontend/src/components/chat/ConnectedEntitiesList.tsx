import React, { useState, useEffect, useMemo } from 'react';
import { integrationService, ConnectorSelectedEntity, ConnectorEntityRunItem } from '@/services/integrationService';
import { ChevronDown, ChevronRight, Loader2, Database, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatToDisplay } from '@/utils/timestamp';

interface ConnectedEntitiesListProps {
  connectorKey: string;
  filterAccountName?: string;
  availableEntityIds?: string[];
  onSelectAsset: (asset: any) => void;
}

export function ConnectedEntitiesList({ connectorKey, filterAccountName, availableEntityIds, onSelectAsset }: ConnectedEntitiesListProps) {
  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<ConnectorSelectedEntity[]>([]);
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);

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
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchEntities();
  }, [connectorKey, filterAccountName]);

  if (loading) {
    return <div className="py-4 text-center text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />Loading connected properties...</div>;
  }

  if (entities.length === 0) {
    return <div className="py-4 text-center text-sm text-gray-400 border border-white/10 rounded-lg bg-white/5">No connected properties found for this account.</div>;
  }

  return (
    <div className="space-y-2 mt-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
      {entities.map(entity => (
        <EntityHistoryItem 
          key={entity.id} 
          connectorKey={connectorKey} 
          entity={entity} 
          isExpanded={expandedEntityId === entity.id}
          onToggle={() => setExpandedEntityId(expandedEntityId === entity.id ? null : entity.id)}
          onSelectAsset={(asset) => onSelectAsset({ ...asset, entityName: entity.name, accountName: entity.account_name || filterAccountName })}
        />
      ))}
    </div>
  );
}

function EntityHistoryItem({ 
  connectorKey, 
  entity, 
  isExpanded, 
  onToggle, 
  onSelectAsset 
}: { 
  connectorKey: string; 
  entity: ConnectorSelectedEntity; 
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
    <div className="border border-white/10 rounded-lg bg-white/5 overflow-hidden">
      <button 
        type="button" 
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-200">{entity.name}</span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="p-2 border-t border-white/10 bg-[#2A2A2A]/50">
          {loading ? (
            <div className="py-4 text-center text-sm text-gray-400 flex flex-col items-center">
              <Loader2 className="w-4 h-4 animate-spin mb-2" />
              Loading history...
            </div>
          ) : sortedHistory.length === 0 ? (
            <div className="py-3 text-center text-xs text-gray-500">No sync history available</div>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
              {sortedHistory.map((run, idx) => (
                <button
                  key={run.run_id}
                  type="button"
                  className="w-full flex flex-col p-2 rounded hover:bg-white/10 transition-colors text-left group"
                  onClick={() => onSelectAsset({ ...run, sync_version_name: getSyncVersionLabel(run, idx) })}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-200 group-hover:text-orange-400 transition-colors">
                      {getSyncVersionLabel(run, idx)}
                    </span>
                    {run.status === 'success' ? (
                      <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Success</span>
                    ) : (
                      <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Failed</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
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
