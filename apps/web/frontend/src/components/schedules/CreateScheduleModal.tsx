import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useScheduleStore } from '@/chat/useScheduleStore';
import { CreateScheduleRequest, ProviderKey, FrequencyKey, DateRangePreset } from '@/services/scheduleService';
import { integrationService, type ConnectorOverviewItem, type ConnectorSelectedEntity } from '@/services/integrationService';

type ScheduleProject = {
  id: string;
  title: string;
};

interface CreateScheduleModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill a provider when opened from a connector card */
  defaultProvider?: ProviderKey;
  /** Connector config pre-filled from the connector context */
  defaultConnectorConfig?: Record<string, unknown>;
  defaultAccountName?: string;
  defaultEntityName?: string;
  projectId: string;
  connectorOverview?: ConnectorOverviewItem[];
  projects?: ScheduleProject[];
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  ga4: 'Google Analytics 4',
  meta_ads: 'Meta Ads',
  tiktok: 'TikTok Ads',
  appsflyer: 'AppsFlyer',
  stripe: 'Stripe',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  warehouse: 'Warehouse',
};

const FREQUENCY_OPTIONS: { value: FrequencyKey; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
];

const DATE_PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_14d', label: 'Last 14 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00 UTC`,
}));

const DOW_OPTIONS = [
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
];

const EMPTY_CONNECTOR_CONFIG: Record<string, unknown> = {};
const EMPTY_CONNECTOR_OVERVIEW: ConnectorOverviewItem[] = [];
const EMPTY_PROJECTS: ScheduleProject[] = [];

const CONNECTOR_TO_PROVIDER: Record<string, ProviderKey> = {
  ga4: 'ga4',
  meta_ads: 'meta_ads',
  tiktok_ads: 'tiktok',
  appsflyer: 'appsflyer',
  stripe: 'stripe',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  postgres: 'warehouse',
  bigquery: 'warehouse',
  snowflake: 'warehouse',
  databricks: 'warehouse',
};

const PROVIDER_TO_CONNECTOR: Record<ProviderKey, string> = {
  ga4: 'ga4',
  meta_ads: 'meta_ads',
  tiktok: 'tiktok_ads',
  appsflyer: 'appsflyer',
  stripe: 'stripe',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  warehouse: 'postgres',
};

const STRIPE_REPORT_ENTITIES: ConnectorSelectedEntity[] = [
  { id: 'charges', name: 'Charges', type: 'report' },
  { id: 'subscriptions', name: 'Subscriptions', type: 'report' },
  { id: 'customers', name: 'Customers', type: 'report' },
];

const HUBSPOT_REPORT_ENTITIES: ConnectorSelectedEntity[] = [
  { id: 'hubspot:sales_pipeline:all:all', name: 'Sales Pipeline', type: 'report', report_type: 'sales_pipeline', pipeline_id: 'all', owner_id: 'all' },
  { id: 'hubspot:contacts:all:all', name: 'Contacts', type: 'report', report_type: 'contacts', pipeline_id: 'all', owner_id: 'all' },
  { id: 'hubspot:companies:all:all', name: 'Companies', type: 'report', report_type: 'companies', pipeline_id: 'all', owner_id: 'all' },
  { id: 'hubspot:activities:all:all', name: 'Activities', type: 'report', report_type: 'activities', pipeline_id: 'all', owner_id: 'all' },
];

const SALESFORCE_REPORT_ENTITIES: ConnectorSelectedEntity[] = [
  { id: 'salesforce:sales_pipeline:all:all', name: 'Sales Pipeline', type: 'report', report_type: 'sales_pipeline', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:leads:all:all', name: 'Leads', type: 'report', report_type: 'leads', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:accounts_contacts:all:all', name: 'Accounts & Contacts', type: 'report', report_type: 'accounts_contacts', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:activities:all:all', name: 'Activities', type: 'report', report_type: 'activities', object_name: 'all', owner_id: 'all' },
  { id: 'salesforce:campaigns:all:all', name: 'Campaigns', type: 'report', report_type: 'campaigns', object_name: 'all', owner_id: 'all' },
];

function getEntityIdFromConfig(provider: ProviderKey, config: Record<string, unknown>) {
  if (provider === 'ga4') return String(config.property_id || '');
  if (provider === 'meta_ads' || provider === 'tiktok') return String(config.ad_account_id || '');
  if (provider === 'appsflyer') return String(config.app_id || '');
  if (provider === 'stripe') return String(config.report_type || 'charges');
  if (provider === 'hubspot') return String(config.entity_id || `hubspot:${config.report_type || 'sales_pipeline'}:${config.pipeline_id || 'all'}:${config.owner_id || 'all'}`);
  if (provider === 'salesforce') return String(config.entity_id || `salesforce:${config.report_type || 'sales_pipeline'}:${config.object_name || 'all'}:${config.owner_id || 'all'}`);
  if (provider === 'warehouse') {
    const entityId = String(config.entity_id || '');
    if (entityId) return entityId;
    const connectionId = String(config.connection_id || '');
    const schema = String(config.schema || config.schema_name || '');
    const table = String(config.table || config.table_name || '');
    return connectionId && schema && table ? `${connectionId}:${schema}.${table}` : '';
  }
  return '';
}

function buildConnectorConfig(provider: ProviderKey, entity: ConnectorSelectedEntity): Record<string, unknown> {
  if (provider === 'ga4') {
    return { property_id: entity.id, property_name: entity.name, account_name: entity.account_name || entity.name };
  }
  if (provider === 'meta_ads' || provider === 'tiktok') {
    return { ad_account_id: entity.id, account_name: entity.account_name || entity.name };
  }
  if (provider === 'appsflyer') {
    return { app_id: entity.id, app_name: entity.name };
  }
  if (provider === 'hubspot') {
    const [, reportType = 'sales_pipeline', pipelineId = 'all', ownerId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      pipeline_id: entity.pipeline_id || pipelineId,
      owner_id: entity.owner_id || ownerId,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
      include_associations: true,
    };
  }
  if (provider === 'salesforce') {
    const [, reportType = 'sales_pipeline', objectName = 'all', ownerId = 'all'] = entity.id.split(':');
    return {
      report_type: entity.report_type || reportType,
      object_name: entity.object_name || objectName,
      owner_id: entity.owner_id || ownerId,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
    };
  }
  if (provider === 'warehouse') {
    const [connectionIdFromId, tablePath = ''] = entity.id.split(':');
    const dotIndex = tablePath.lastIndexOf('.');
    const schemaFromId = dotIndex >= 0 ? tablePath.slice(0, dotIndex) : '';
    const tableFromId = dotIndex >= 0 ? tablePath.slice(dotIndex + 1) : tablePath;
    const connectionId = entity.connection_id || connectionIdFromId;
    const schema = entity.schema_name || schemaFromId;
    const table = entity.table_name || tableFromId;
    return {
      connector_key: entity.connector_key || 'postgres',
      connection_id: connectionId,
      schema,
      table,
      entity_id: entity.id,
      entity_name: entity.name,
      row_limit: 5000,
    };
  }
  return { report_type: ['charges', 'subscriptions', 'customers'].includes(entity.id) ? entity.id : 'charges' };
}

function mergeEntities(
  existing: ConnectorSelectedEntity[],
  incoming: ConnectorSelectedEntity[]
): ConnectorSelectedEntity[] {
  const byId = new Map<string, ConnectorSelectedEntity>();
  existing.forEach((entity) => byId.set(`${entity.type || ''}:${entity.id}`, entity));
  incoming.forEach((entity) => byId.set(`${entity.type || ''}:${entity.id}`, entity));
  return Array.from(byId.values());
}

async function fetchProviderEntities(provider: ProviderKey): Promise<ConnectorSelectedEntity[]> {
  if (provider === 'ga4') {
    const response = await integrationService.fetchGoogleAnalyticsProperties();
    if (!response.success) throw new Error(response.error || 'Failed to load Google Analytics properties.');
    return response.accounts.flatMap((account) =>
      account.properties.map((property) => ({
        id: property.property_id,
        name: property.display_name || property.property_id,
        type: 'property',
        account_name: account.account_name,
      }))
    );
  }

  if (provider === 'meta_ads') {
    const response = await integrationService.fetchMetaAdAccounts();
    if (!response.success) throw new Error(response.error || 'Failed to load Meta ad accounts.');
    return response.ad_accounts.map((account) => ({
      id: account.id,
      name: account.name || account.id,
      type: 'account',
    }));
  }

  if (provider === 'tiktok') {
    const response = await integrationService.fetchTikTokAdAccounts();
    if (!response.success) throw new Error(response.error || 'Failed to load TikTok ad accounts.');
    return response.ad_accounts.map((account) => ({
      id: account.id,
      name: account.name || account.id,
      type: 'account',
    }));
  }

  if (provider === 'appsflyer') {
    const response = await integrationService.fetchAppsFlyerApps();
    if (!response.success) throw new Error(response.error || 'Failed to load AppsFlyer apps.');
    return response.apps.map((app) => ({
      id: app.app_id,
      name: app.app_name || app.app_id,
      type: 'app',
    }));
  }

  if (provider === 'warehouse') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load warehouse tables.');
    return response.connectors
      .filter((connector) => ['postgres', 'bigquery', 'snowflake', 'databricks'].includes(connector.connector_key))
      .flatMap((connector) => connector.selected_entities || []);
  }

  if (provider === 'hubspot') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load HubSpot reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'hubspot');
    return mergeEntities(connector?.selected_entities || [], HUBSPOT_REPORT_ENTITIES);
  }

  if (provider === 'salesforce') {
    const response = await integrationService.fetchConnectorsOverview();
    if (!response.success) throw new Error(response.error || 'Failed to load Salesforce reports.');
    const connector = response.connectors.find((item) => item.connector_key === 'salesforce');
    return mergeEntities(connector?.selected_entities || [], SALESFORCE_REPORT_ENTITIES);
  }

  return STRIPE_REPORT_ENTITIES;
}

export function CreateScheduleModal({
  open,
  onClose,
  defaultProvider,
  defaultConnectorConfig = EMPTY_CONNECTOR_CONFIG,
  defaultAccountName = '',
  defaultEntityName = '',
  projectId,
  connectorOverview = EMPTY_CONNECTOR_OVERVIEW,
  projects = EMPTY_PROJECTS,
}: CreateScheduleModalProps) {
  const { createSchedule } = useScheduleStore();

  const [provider, setProvider] = useState<ProviderKey>(defaultProvider ?? 'ga4');
  const [modalConnectorOverview, setModalConnectorOverview] = useState<ConnectorOverviewItem[]>(connectorOverview);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [frequency, setFrequency] = useState<FrequencyKey>('daily');
  const [hourUtc, setHourUtc] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('last_30d');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [entityLoadingProvider, setEntityLoadingProvider] = useState<ProviderKey | null>(null);
  const [loadedEntityProviders, setLoadedEntityProviders] = useState<Partial<Record<ProviderKey, boolean>>>({});
  const [entityLoadErrors, setEntityLoadErrors] = useState<Partial<Record<ProviderKey, string>>>({});
  const [error, setError] = useState<string | null>(null);

  // Slack action
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackChannelId, setSlackChannelId] = useState('');

  // Auto-refresh
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshConvId, setAutoRefreshConvId] = useState('');
  const DEFAULT_AUTO_REFRESH_PROMPT = 'Refresh this dashboard with the latest synced data.';

  const showDayPicker = frequency === 'weekly' || frequency === 'biweekly';
  const hasDefaultConnectorConfig = Object.keys(defaultConnectorConfig).length > 0;

  const sourceOptions = useMemo(() => {
    const grouped = new Map<ProviderKey, {
      connectorKey: string;
      provider: ProviderKey;
      label: string;
      entities: ConnectorSelectedEntity[];
    }>();

    modalConnectorOverview.forEach((connector) => {
      const mappedProvider = CONNECTOR_TO_PROVIDER[connector.connector_key];
      if (!mappedProvider || !connector.connected) return;
      const connectorEntities = connector.selected_entities || [];
      const entities = connector.connector_key === 'stripe' && connectorEntities.length === 0
        ? STRIPE_REPORT_ENTITIES
        : connector.connector_key === 'hubspot' && connectorEntities.length === 0
          ? HUBSPOT_REPORT_ENTITIES
          : connector.connector_key === 'salesforce' && connectorEntities.length === 0
            ? SALESFORCE_REPORT_ENTITIES
          : connectorEntities;

      if (mappedProvider === 'warehouse') {
        const current = grouped.get('warehouse') || {
          connectorKey: 'warehouse',
          provider: 'warehouse',
          label: 'Warehouse',
          entities: [],
        };
        current.entities = mergeEntities(current.entities, entities);
        grouped.set('warehouse', current);
        return;
      }

      grouped.set(mappedProvider, {
        connectorKey: connector.connector_key,
        provider: mappedProvider,
        label: connector.display_name,
        entities,
      });
    });

    return Array.from(grouped.values());
  }, [modalConnectorOverview]);

  const selectedSource = sourceOptions.find((source) => source.provider === provider);
  const selectedEntity = selectedSource?.entities.find((entity) => entity.id === selectedEntityId);
  const projectOptions = useMemo(
    () => projects.length > 0
      ? projects
      : projectId
        ? [{ id: projectId, title: 'Current project' }]
        : [],
    [projectId, projects]
  );

  useEffect(() => {
    setModalConnectorOverview(connectorOverview);
  }, [connectorOverview]);

  useEffect(() => {
    if (!open) return;
    setLoadedEntityProviders({});
    setEntityLoadErrors({});
    setEntityLoadingProvider(null);
  }, [open]);

  useEffect(() => {
    if (!open || hasDefaultConnectorConfig) return;
    let cancelled = false;

    setIsLoadingSources(true);
    integrationService.fetchConnectorsOverview()
      .then((response) => {
        if (cancelled) return;
        if (response.success) {
          setModalConnectorOverview(response.connectors);
          return;
        }
        setError(response.error || 'Failed to load connected data sources.');
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load connected data sources.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSources(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, hasDefaultConnectorConfig]);

  useEffect(() => {
    if (!open) return;
    const initialProvider = defaultProvider ?? sourceOptions[0]?.provider ?? 'ga4';
    const initialSource = sourceOptions.find((source) => source.provider === initialProvider);
    const defaultEntityId = getEntityIdFromConfig(initialProvider, defaultConnectorConfig);

    setProvider(initialProvider);
    setSelectedEntityId(defaultEntityId || initialSource?.entities[0]?.id || '');
    setSelectedProjectId(projectId || projectOptions[0]?.id || '');
    setError(null);
  }, [open, defaultProvider, defaultConnectorConfig, projectId, projectOptions, sourceOptions]);

  useEffect(() => {
    if (!open || hasDefaultConnectorConfig) return;
    const source = selectedSource;
    if (!source || source.entities.length > 0 || loadedEntityProviders[provider]) return;

    let cancelled = false;
    setEntityLoadingProvider(provider);
    setEntityLoadErrors((prev) => ({ ...prev, [provider]: undefined }));

    fetchProviderEntities(provider)
      .then((entities) => {
        if (cancelled) return;
        setLoadedEntityProviders((prev) => ({ ...prev, [provider]: true }));
        if (entities.length === 0) return;

        const connectorKey = PROVIDER_TO_CONNECTOR[provider];
        setModalConnectorOverview((prev) => {
          if (provider === 'warehouse') {
            return prev.map((connector) => {
              if (!['postgres', 'bigquery', 'snowflake', 'databricks'].includes(connector.connector_key)) return connector;
              const connectorEntities = entities.filter((entity) =>
                String(entity.connector_key || 'postgres') === connector.connector_key
              );
              return {
                ...connector,
                selected_entities: mergeEntities(connector.selected_entities || [], connectorEntities),
              };
            });
          }
          return prev.map((connector) =>
            connector.connector_key === connectorKey
              ? { ...connector, selected_entities: mergeEntities(connector.selected_entities || [], entities) }
              : connector
          );
        });
        setSelectedEntityId((current) => current || entities[0]?.id || '');
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadedEntityProviders((prev) => ({ ...prev, [provider]: true }));
          setEntityLoadErrors((prev) => ({
            ...prev,
            [provider]: err instanceof Error ? err.message : 'Failed to load accounts for this connector.',
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setEntityLoadingProvider(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, hasDefaultConnectorConfig, selectedSource, loadedEntityProviders, provider]);

  const handleProviderChange = (value: string) => {
    const nextProvider = value as ProviderKey;
    const nextSource = sourceOptions.find((source) => source.provider === nextProvider);
    setProvider(nextProvider);
    setSelectedEntityId(nextSource?.entities[0]?.id || '');
  };

  const handleSubmit = async () => {
    setError(null);
    if (slackEnabled && !slackChannelId.trim()) {
      setError('Please enter a Slack channel ID to enable the Slack action.');
      return;
    }
    if (autoRefreshEnabled && !autoRefreshConvId.trim()) {
      setError('Please enter a conversation ID to enable auto-refresh.');
      return;
    }
    const resolvedProjectId = selectedProjectId || projectId;
    if (!resolvedProjectId) {
      setError('Please choose a destination project before creating a schedule.');
      return;
    }
    if (!hasDefaultConnectorConfig && !selectedEntity) {
      setError('Please choose a connected account or entity before creating a schedule.');
      return;
    }
    setIsSubmitting(true);
    try {
      const connectorConfig = hasDefaultConnectorConfig
        ? defaultConnectorConfig
        : buildConnectorConfig(provider, selectedEntity as ConnectorSelectedEntity);
      const accountName = defaultAccountName
        || selectedEntity?.account_name
        || selectedEntity?.name
        || PROVIDER_LABELS[provider];
      const req: CreateScheduleRequest = {
        provider,
        connector_config: connectorConfig,
        project_id: resolvedProjectId,
        account_name: accountName,
        frequency,
        hour_utc: hourUtc,
        day_of_week: dayOfWeek,
        date_range_preset: datePreset,
        on_complete_actions: slackEnabled && slackChannelId.trim()
          ? [{ type: 'slack', channel_id: slackChannelId.trim() }]
          : undefined,
        auto_refresh_conversation_id: autoRefreshEnabled && autoRefreshConvId.trim()
          ? autoRefreshConvId.trim()
          : undefined,
        auto_refresh_prompt: autoRefreshEnabled ? DEFAULT_AUTO_REFRESH_PROMPT : undefined,
      };
      await createSchedule(req);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule Automatic Sync</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider */}
          <div className="space-y-1.5">
            <Label>Connector</Label>
            <Select
              value={provider}
              onValueChange={handleProviderChange}
              disabled={!!defaultProvider || hasDefaultConnectorConfig || isLoadingSources || sourceOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingSources ? 'Loading connectors...' : 'Choose a connector'} />
              </SelectTrigger>
              <SelectContent className="z-[201]">
                {(hasDefaultConnectorConfig
                  ? [{ provider, label: PROVIDER_LABELS[provider] }]
                  : sourceOptions
                ).map((source) => (
                  <SelectItem key={source.provider} value={source.provider}>{source.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!hasDefaultConnectorConfig && !isLoadingSources && sourceOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Connect a supported data source before creating an automatic schedule.
              </p>
            )}
          </div>

          {/* Entity */}
          <div className="space-y-1.5">
            <Label>Account / Entity</Label>
            {hasDefaultConnectorConfig ? (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                {defaultEntityName || defaultAccountName || getEntityIdFromConfig(provider, defaultConnectorConfig) || PROVIDER_LABELS[provider]}
              </div>
            ) : (
              <Select
                value={selectedEntityId}
                onValueChange={setSelectedEntityId}
                disabled={!selectedSource || entityLoadingProvider === provider || selectedSource.entities.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={entityLoadingProvider === provider ? 'Loading accounts...' : 'Choose an entity'} />
                </SelectTrigger>
                <SelectContent className="z-[201]">
                  {(selectedSource?.entities || []).map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.name || entity.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!hasDefaultConnectorConfig && selectedSource && entityLoadingProvider !== provider && selectedSource.entities.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No account or entity is available for this connector yet.
              </p>
            )}
            {!hasDefaultConnectorConfig && entityLoadErrors[provider] && (
              <p className="text-xs text-destructive">{entityLoadErrors[provider]}</p>
            )}
          </div>

          {/* Project */}
          <div className="space-y-1.5">
            <Label>Destination Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={projectOptions.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent className="z-[201]">
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projectOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">Create a project before scheduling automatic syncs.</p>
            )}
          </div>

          {/* Frequency */}
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as FrequencyKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="z-[201]">
                {FREQUENCY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time */}
          <div className="space-y-1.5">
            <Label>Time (UTC)</Label>
            <Select value={String(hourUtc)} onValueChange={(v) => setHourUtc(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="z-[201]">
                {HOUR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Day of week */}
          {showDayPicker && (
            <div className="space-y-1.5">
              <Label>Day of Week</Label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="z-[201]">
                  {DOW_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date range */}
          <div className="space-y-1.5">
            <Label>Data Window</Label>
            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DateRangePreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="z-[201]">
                {DATE_PRESET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Each sync will pull this rolling window of data.
            </p>
          </div>

          {/* Slack action */}
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Post to Slack after sync</p>
                <p className="text-xs text-muted-foreground">
                  Automatically analyze data and post a summary to a Slack channel
                </p>
              </div>
              <Switch
                checked={slackEnabled}
                onCheckedChange={setSlackEnabled}
              />
            </div>
            {slackEnabled && (
              <div className="space-y-1.5">
                <Label>Slack Channel ID</Label>
                <Input
                  placeholder="e.g. C1234567890"
                  value={slackChannelId}
                  onChange={(e) => setSlackChannelId(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Find the channel ID in Slack: right-click channel → View channel details → scroll to bottom.
                </p>
              </div>
            )}
          </div>

          {/* Auto-refresh */}
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Auto-refresh dashboard</p>
                <p className="text-xs text-muted-foreground">
                  Re-run analysis on an existing conversation after each sync
                </p>
              </div>
              <Switch
                checked={autoRefreshEnabled}
                onCheckedChange={setAutoRefreshEnabled}
              />
            </div>
            {autoRefreshEnabled && (
              <div className="space-y-1.5">
                <Label>Conversation ID</Label>
                <Input
                  placeholder="Paste conversation UUID"
                  value={autoRefreshConvId}
                  onChange={(e) => setAutoRefreshConvId(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Find this in the project URL or from the Dreamify API.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
