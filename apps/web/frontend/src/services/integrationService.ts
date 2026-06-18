import { api } from './api';
import { AssetRecord } from './fileService';

export interface GA4Property {
  property_id: string;
  display_name: string;
}

export interface GA4Account {
  account_id: string;
  account_name: string;
  properties: GA4Property[];
}

export interface GA4PropertiesResponse {
  success: boolean;
  accounts: GA4Account[];
  error?: string;
}

export interface GA4SyncRequest {
  property_id: string;
  project_id?: string;
  start_date?: string;
  end_date?: string;
  account_name?: string;
  property_name?: string;
}

export interface GA4SyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  error?: string;
}

export interface ConnectorSelectedEntity {
  id: string;
  name: string;
  type?: string;
  account_name?: string;
  connection_id?: string;
  connector_key?: string;
  database_type?: string;
  catalog_name?: string;
  schema_name?: string;
  source_schema_name?: string;
  table_name?: string;
  report_type?: string;
  pipeline_id?: string;
  object_name?: string;
  owner_id?: string;
  project_ref?: string;
  sync_mode?: string;
  bucket?: string;
  shop_domain?: string;
  resource?: string;
  account_id?: string;
  resource_id?: string;
  metric_id?: string;
  channel?: string;
  realm_id?: string;
  accounting_basis?: string;
  seller_id?: string;
  marketplace_id?: string;
  shop_id?: string;
  region?: string;
}

export interface ConnectorOverviewItem {
  connector_key: string;
  display_name: string;
  connected: boolean;
  selected_entities: ConnectorSelectedEntity[];
  account_name?: string;
}

export interface ConnectorsOverviewResponse {
  success: boolean;
  connectors: ConnectorOverviewItem[];
  error?: string;
}

export interface ConnectorRelatedProject {
  project_id: string;
  project_name: string;
  project_created_at?: string;
  latest_dashboard_id?: string;
  dashboard_title?: string;
  dashboard_preview_key?: string;
  conversation_id?: string;
  input_data_file_name?: string;
  sync_version_name?: string;
}

export interface ConnectorEntityDetailResponse {
  success: boolean;
  connector_key: string;
  display_name: string;
  connected: boolean;
  entity: ConnectorSelectedEntity;
  latest_asset?: AssetRecord;
  latest_schedule?: Record<string, unknown> | null;
  related_projects: ConnectorRelatedProject[];
  last_synced_at?: string;
  account_name?: string;
  error?: string;
}

export interface ConnectorEntityRunItem {
  run_id: string;
  schedule_id?: string;
  status?: string;
  triggered_at?: string;
  completed_at?: string;
  rows_fetched?: number;
  columns_fetched?: number;
  asset_id?: string;
  asset_filename?: string;
  date_range_start?: string;
  date_range_end?: string;
  config_snapshot?: Record<string, unknown>;
  sync_version_name?: string;
}

export interface ConnectorEntityHistoryResponse {
  success: boolean;
  runs: ConnectorEntityRunItem[];
  error?: string;
}

export interface AddToNewProjectResponse {
  success: boolean;
  project: {
    project_id: string;
    name?: string;
  };
  asset: AssetRecord;
  prompt: string;
  error?: string;
}

export interface DeleteConnectorEntityResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface UpdateSyncVersionNameResponse {
  success: boolean;
  run_id: string;
  sync_version_name?: string;
  error?: string;
}

export interface WarehouseColumn {
  name: string;
  ordinal_position?: number;
  data_type?: string;
  native_type?: string;
  nullable?: boolean;
  mode?: string;
  description?: string;
}

export interface WarehouseTable {
  schema: string;
  name: string;
  catalog?: string;
  source_schema?: string;
  type?: string;
  row_count?: number;
  columns: WarehouseColumn[];
}

export interface WarehouseSchema {
  name: string;
  catalog?: string;
  source_schema?: string;
  tables: WarehouseTable[];
}

export interface WarehouseSchemaSnapshot {
  refreshed_at?: string;
  schemas: WarehouseSchema[];
  table_count: number;
  schema_fingerprint?: string;
  project_id?: string;
  location?: string;
  account?: string;
  warehouse?: string;
  database?: string;
  role?: string;
  catalog?: string;
  warehouse_id?: string;
}

export type WarehouseConnectorKey = 'postgres' | 'bigquery' | 'snowflake' | 'databricks';

export interface WarehouseConnection {
  connection_id: string;
  connector_key: WarehouseConnectorKey;
  database_type: WarehouseConnectorKey;
  display_name: string;
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  account?: string;
  warehouse?: string;
  role?: string;
  include_schemas: string[];
  included_schemas?: string[];
  project_id?: string;
  location?: string;
  included_datasets?: string[];
  service_account_email?: string;
  max_billing_bytes?: number;
  max_assigned_bytes?: number;
  server_hostname?: string;
  http_path?: string;
  catalog?: string;
  warehouse_id?: string;
  max_result_bytes?: number;
  statement_timeout_seconds?: number;
  source_timezone: string;
  schema_snapshot: WarehouseSchemaSnapshot;
  created_at?: string;
  updated_at?: string;
}

export interface WarehouseConnectionsResponse {
  success: boolean;
  connections: WarehouseConnection[];
  error?: string;
}

export interface WarehouseQuickConnectRequest {
  connector_key?: WarehouseConnectorKey;
  connection_uri?: string;
  display_name?: string;
  include_schemas?: string[];
  source_timezone?: string;
  project_id?: string;
  location?: string;
  service_account_json?: string;
  included_datasets?: string[];
  max_billing_bytes?: number;
  account?: string;
  username?: string;
  private_key_pem?: string;
  private_key_passphrase?: string;
  warehouse?: string;
  database?: string;
  role?: string;
  included_schemas?: string[];
  max_assigned_bytes?: number;
  server_hostname?: string;
  http_path?: string;
  access_token?: string;
  catalog?: string;
  max_result_bytes?: number;
  statement_timeout_seconds?: number;
}

export interface WarehouseSampleResponse {
  success: boolean;
  columns: string[];
  rows: unknown[][];
  generated_sql: string;
  error?: string;
}

export interface WarehouseSyncRequest {
  schema_name: string;
  table_name: string;
  columns?: string[];
  project_id?: string;
  row_limit?: number;
}

export type SupabaseSyncMode = 'profile_only' | 'bounded_table_snapshot' | 'aggregated_result' | 'app_profile';

export interface SupabaseColumn {
  name: string;
  ordinal_position?: number;
  data_type?: string;
  native_type?: string;
  nullable?: boolean;
  possible_pii?: boolean;
}

export interface SupabaseTable {
  schema: string;
  name: string;
  type?: string;
  row_estimate?: number;
  rls_enabled?: boolean;
  policy_count?: number;
  grant_count?: number;
  index_count?: number;
  primary_key_columns?: string[];
  columns: SupabaseColumn[];
}

export interface SupabaseSchema {
  name: string;
  tables: SupabaseTable[];
}

export interface SupabaseSchemaSnapshot {
  refreshed_at?: string;
  schemas?: SupabaseSchema[];
  table_count?: number;
  schema_fingerprint?: string;
}

export interface SupabaseConnectionStatusResponse {
  connected: boolean;
  oauth_connected?: boolean;
  connection_count?: number;
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface SupabaseProject {
  ref: string;
  name: string;
  region?: string;
  status?: string;
  organization_id?: string;
}

export interface SupabaseProjectsResponse {
  success: boolean;
  projects: SupabaseProject[];
  error?: string;
}

export interface SupabaseConnection {
  connection_id: string;
  connector_key: 'supabase';
  database_type: 'supabase';
  display_name?: string;
  project_ref: string;
  project_name?: string;
  organization_id?: string;
  connection_mode?: string;
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  include_schemas: string[];
  source_timezone: string;
  max_export_bytes?: number;
  credential_risk?: 'read_only' | 'admin_role' | string;
  schema_snapshot?: SupabaseSchemaSnapshot;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseConnectionsResponse {
  success: boolean;
  connections: SupabaseConnection[];
  error?: string;
}

export interface SupabaseConnectionCreateRequest {
  project_ref: string;
  project_name?: string;
  organization_id?: string;
  connection_uri?: string;
  db_password?: string;
  display_name?: string;
  include_schemas?: string[];
  include_system_schemas?: boolean;
  source_timezone?: string;
  service_role_key?: string;
  max_export_bytes?: number;
}

export interface SupabaseSampleResponse {
  success: boolean;
  columns: string[];
  rows: unknown[][];
  generated_sql: string;
  error?: string;
}

export interface SupabaseSyncRequest {
  connection_id: string;
  sync_mode?: SupabaseSyncMode;
  project_id?: string;
  schema_name?: string;
  table_name?: string;
  columns?: string[];
  row_limit?: number;
  max_bytes?: number;
  date_filter_column?: string;
  start_date?: string;
  end_date?: string;
  group_by_columns?: string[];
  metric_columns?: string[];
  bucket?: string;
}

export interface SupabaseSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  error?: string;
}

export interface ShopifyConnectionStatusResponse {
  connected: boolean;
  shop_id?: string;
  shop_domain?: string;
  shop_name?: string;
  shop_url?: string;
  currency?: string;
  timezone?: string;
  account_name?: string;
  scopes?: string[];
  read_all_orders_enabled?: boolean;
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface ShopifyResource {
  report_type: string;
  label: string;
  resource: string;
  default?: boolean;
}

export interface ShopifyResourcesResponse {
  success: boolean;
  resources: ShopifyResource[];
  error?: string;
}

export interface ShopifySyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  row_limit?: number;
  include_pii?: boolean;
  max_bytes?: number;
  resource?: string;
}

export interface ShopifySyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
  error?: string;
}

export interface KlaviyoConnectionStatusResponse {
  connected: boolean;
  account_id?: string;
  account_name?: string;
  timezone?: string;
  currency?: string;
  api_revision?: string;
  scopes?: string[];
  default_metric_id?: string;
  default_metric_name?: string;
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface KlaviyoReportResource {
  report_type: string;
  label: string;
  resource: string;
  default?: boolean;
}

export interface KlaviyoNamedResource {
  id: string;
  name: string;
  type?: string;
  status?: string;
  channel?: string;
  updated_at?: string;
}

export interface KlaviyoResourcesResponse {
  success: boolean;
  reports: KlaviyoReportResource[];
  metrics: KlaviyoNamedResource[];
  campaigns: KlaviyoNamedResource[];
  flows: KlaviyoNamedResource[];
  lists: KlaviyoNamedResource[];
  default_metric_id?: string;
  default_metric_name?: string;
  error?: string;
}

export interface KlaviyoSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  row_limit?: number;
  include_pii?: boolean;
  max_bytes?: number;
  metric_id?: string;
  resource_id?: string;
  channel?: string;
}

export interface KlaviyoSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
  error?: string;
}

export interface AmazonSellerMarketplace {
  id: string;
  name: string;
  country_code?: string;
}

export interface AmazonSellerConnectionStatusResponse {
  connected: boolean;
  seller_id?: string;
  seller_name?: string;
  selling_region?: string;
  marketplaces?: AmazonSellerMarketplace[];
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface AmazonSellerReportResource {
  report_type: string;
  label: string;
  default?: boolean;
}

export interface AmazonSellerResourcesResponse {
  success: boolean;
  reports: AmazonSellerReportResource[];
  marketplaces: AmazonSellerMarketplace[];
  error?: string;
}

export interface AmazonSellerSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  marketplace_id?: string;
  row_limit?: number;
  include_pii?: boolean;
  max_bytes?: number;
}

export interface AmazonSellerSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
  error?: string;
}

export interface QuickBooksRealm {
  id: string;
  name: string;
  environment?: string;
}

export interface QuickBooksConnectionStatusResponse {
  connected: boolean;
  realm_id?: string;
  company_name?: string;
  environment?: string;
  minor_version?: string;
  country?: string;
  currency?: string;
  scopes?: string[];
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface QuickBooksReportResource {
  report_type: string;
  label: string;
  resource: string;
  default?: boolean;
}

export interface QuickBooksResourcesResponse {
  success: boolean;
  reports: QuickBooksReportResource[];
  realms: QuickBooksRealm[];
  error?: string;
}

export interface QuickBooksSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  row_limit?: number;
  include_pii?: boolean;
  max_bytes?: number;
  accounting_basis?: string;
  resource_id?: string;
}

export interface QuickBooksSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
  error?: string;
}

export interface TikTokShopSellerShop {
  id: string;
  name: string;
  region?: string;
  shop_cipher?: string;
}

export interface TikTokShopSellerConnectionStatusResponse {
  connected: boolean;
  account_id?: string;
  account_name?: string;
  region?: string;
  shops?: TikTokShopSellerShop[];
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface TikTokShopSellerReportResource {
  report_type: string;
  label: string;
  default?: boolean;
}

export interface TikTokShopSellerResourcesResponse {
  success: boolean;
  reports: TikTokShopSellerReportResource[];
  shops: TikTokShopSellerShop[];
  regions?: Record<string, string>;
  error?: string;
}

export interface TikTokShopSellerSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  shop_id?: string;
  region?: string;
  row_limit?: number;
  include_pii?: boolean;
  max_bytes?: number;
}

export interface TikTokShopSellerSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
  error?: string;
}

export interface ShopeeSellerShop {
  id: string;
  name: string;
  region?: string;
}

export interface ShopeeSellerConnectionStatusResponse {
  connected: boolean;
  account_id?: string;
  account_name?: string;
  region?: string;
  shops?: ShopeeSellerShop[];
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface ShopeeSellerReportResource {
  report_type: string;
  label: string;
  default?: boolean;
}

export interface ShopeeSellerResourcesResponse {
  success: boolean;
  reports: ShopeeSellerReportResource[];
  shops: ShopeeSellerShop[];
  regions?: Record<string, string>;
  error?: string;
}

export interface ShopeeSellerSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  shop_id?: string;
  region?: string;
  row_limit?: number;
  include_pii?: boolean;
  max_bytes?: number;
}

export interface ShopeeSellerSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
  error?: string;
}

export interface LazadaSellerAccount {
  id: string;
  name: string;
  region?: string;
}

export interface LazadaSellerConnectionStatusResponse {
  connected: boolean;
  account_id?: string;
  account_name?: string;
  region?: string;
  sellers?: LazadaSellerAccount[];
  selected_entities?: ConnectorSelectedEntity[];
  connected_at?: string;
}

export interface LazadaSellerReportResource {
  report_type: string;
  label: string;
  default?: boolean;
}

export interface LazadaSellerResourcesResponse {
  success: boolean;
  reports: LazadaSellerReportResource[];
  sellers: LazadaSellerAccount[];
  regions?: Record<string, string>;
  error?: string;
}

export interface LazadaSellerSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  seller_id?: string;
  region?: string;
  row_limit?: number;
  include_pii?: boolean;
  max_bytes?: number;
}

export interface LazadaSellerSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
  error?: string;
}

class IntegrationService {
  private baseUrl = '/api/v1/integration';

  async fetchConnectorsOverview(): Promise<ConnectorsOverviewResponse> {
    try {
      const res = await api.get<ConnectorsOverviewResponse>(`${this.baseUrl}/connectors/overview`);
      if (res.success && res.data) return res.data;
      return { success: false, connectors: [], error: res.error || 'Failed to fetch connectors overview' };
    } catch (error) {
      return { success: false, connectors: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async quickConnectWarehouse(payload: WarehouseQuickConnectRequest): Promise<WarehouseConnection> {
    const res = await api.post<WarehouseConnection>(`${this.baseUrl}/warehouse/connections/quick-connect`, {
      connector_key: payload.connector_key || 'postgres',
      connection_uri: payload.connection_uri || '',
      display_name: payload.display_name || '',
      include_schemas: payload.include_schemas || [],
      source_timezone: payload.source_timezone || 'UTC',
      project_id: payload.project_id || '',
      location: payload.location || '',
      service_account_json: payload.service_account_json || '',
      included_datasets: payload.included_datasets || [],
      max_billing_bytes: payload.max_billing_bytes,
      account: payload.account || '',
      username: payload.username || '',
      private_key_pem: payload.private_key_pem || '',
      private_key_passphrase: payload.private_key_passphrase || '',
      warehouse: payload.warehouse || '',
      database: payload.database || '',
      role: payload.role || '',
      included_schemas: payload.included_schemas || [],
      max_assigned_bytes: payload.max_assigned_bytes,
      server_hostname: payload.server_hostname || '',
      http_path: payload.http_path || '',
      access_token: payload.access_token || '',
      catalog: payload.catalog || '',
      max_result_bytes: payload.max_result_bytes,
      statement_timeout_seconds: payload.statement_timeout_seconds,
    });
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to connect warehouse');
  }

  async fetchWarehouseConnections(): Promise<WarehouseConnectionsResponse> {
    try {
      const res = await api.get<WarehouseConnectionsResponse>(`${this.baseUrl}/warehouse/connections`);
      if (res.success && res.data) return res.data;
      return { success: false, connections: [], error: res.error || 'Failed to load warehouse connections' };
    } catch (error) {
      return { success: false, connections: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async refreshWarehouseSchema(connectionId: string): Promise<WarehouseConnection> {
    const res = await api.post<WarehouseConnection>(
      `${this.baseUrl}/warehouse/connections/${encodeURIComponent(connectionId)}/schema/refresh`,
      {}
    );
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to refresh warehouse schema');
  }

  async sampleWarehouseTable(
    connectionId: string,
    payload: { schema_name: string; table_name: string; columns?: string[]; limit?: number }
  ): Promise<WarehouseSampleResponse> {
    try {
      const res = await api.post<WarehouseSampleResponse>(
        `${this.baseUrl}/warehouse/connections/${encodeURIComponent(connectionId)}/tables/sample`,
        payload
      );
      if (res.success && res.data) return res.data;
      return { success: false, columns: [], rows: [], generated_sql: '', error: res.error || 'Failed to sample table' };
    } catch (error) {
      return { success: false, columns: [], rows: [], generated_sql: '', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncWarehouseTable(connectionId: string, payload: WarehouseSyncRequest): Promise<GA4SyncResponse> {
    try {
      const res = await api.post<GA4SyncResponse>(
        `${this.baseUrl}/warehouse/connections/${encodeURIComponent(connectionId)}/sync`,
        payload
      );
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync warehouse table' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deleteWarehouseConnection(connectionId: string): Promise<DeleteConnectorEntityResponse> {
    try {
      const res = await api.delete<DeleteConnectorEntityResponse>(
        `${this.baseUrl}/warehouse/connections/${encodeURIComponent(connectionId)}`
      );
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to delete warehouse connection' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchConnectorEntityDetail(connectorKey: string, entityId: string): Promise<ConnectorEntityDetailResponse> {
    try {
      const res = await api.get<ConnectorEntityDetailResponse>(
        `${this.baseUrl}/connectors/${encodeURIComponent(connectorKey)}/entities/${encodeURIComponent(entityId)}/detail`
      );
      if (res.success && res.data) return res.data;
      return {
        success: false,
        connector_key: connectorKey,
        display_name: connectorKey,
        connected: false,
        entity: { id: entityId, name: entityId },
        related_projects: [],
        error: res.error || 'Failed to fetch connector detail',
      };
    } catch (error) {
      return {
        success: false,
        connector_key: connectorKey,
        display_name: connectorKey,
        connected: false,
        entity: { id: entityId, name: entityId },
        related_projects: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async fetchConnectorEntityHistory(
    connectorKey: string,
    entityId: string,
    limit = 20
  ): Promise<ConnectorEntityHistoryResponse> {
    try {
      const res = await api.get<ConnectorEntityHistoryResponse>(
        `${this.baseUrl}/connectors/${encodeURIComponent(connectorKey)}/entities/${encodeURIComponent(entityId)}/history?limit=${limit}`
      );
      if (res.success && res.data) return res.data;
      return { success: false, runs: [], error: res.error || 'Failed to fetch connector history' };
    } catch (error) {
      return { success: false, runs: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async refreshConnectorEntity(
    connectorKey: string,
    entityId: string,
    payload?: {
      date_preset?: string;
      start_date?: string;
      end_date?: string;
      campaign_ids?: string[];
      adset_ids?: string[];
    }
  ): Promise<GA4SyncResponse> {
    try {
      const res = await api.post<GA4SyncResponse>(
        `${this.baseUrl}/connectors/${encodeURIComponent(connectorKey)}/entities/${encodeURIComponent(entityId)}/refresh`,
        payload ?? {}
      );
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to refresh connector data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateConnectorSyncVersionName(
    connectorKey: string,
    entityId: string,
    runId: string,
    syncVersionName: string
  ): Promise<UpdateSyncVersionNameResponse> {
    try {
      const res = await api.patch<UpdateSyncVersionNameResponse>(
        `${this.baseUrl}/connectors/${encodeURIComponent(connectorKey)}/entities/${encodeURIComponent(entityId)}/history/${encodeURIComponent(runId)}/version-name`,
        { sync_version_name: syncVersionName }
      );
      if (res.success && res.data) return res.data;
      return { success: false, run_id: runId, error: res.error || "Failed to update sync version name" };
    } catch (error) {
      return { success: false, run_id: runId, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async addConnectorEntityToNewProject(
    connectorKey: string,
    entityId: string,
    payload: { project_name?: string; prompt?: string; asset_id?: string }
  ): Promise<AddToNewProjectResponse> {
    try {
      const res = await api.post<AddToNewProjectResponse>(
        `${this.baseUrl}/connectors/${encodeURIComponent(connectorKey)}/entities/${encodeURIComponent(entityId)}/add-to-new-project`,
        payload
      );
      if (res.success && res.data) return res.data;
      return {
        success: false,
        project: { project_id: '' },
        asset: {} as AssetRecord,
        prompt: payload.prompt || '',
        error: res.error || 'Failed to create project from connector data',
      };
    } catch (error) {
      return {
        success: false,
        project: { project_id: '' },
        asset: {} as AssetRecord,
        prompt: payload.prompt || '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async deleteConnectorEntity(connectorKey: string, entityId: string): Promise<DeleteConnectorEntityResponse> {
    try {
      const res = await api.delete<DeleteConnectorEntityResponse>(
        `${this.baseUrl}/connectors/${encodeURIComponent(connectorKey)}/entities/${encodeURIComponent(entityId)}`
      );
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || "Failed to delete connector entity" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async fetchGoogleAnalyticsProperties(): Promise<GA4PropertiesResponse> {
    try {
      const res = await api.get<GA4PropertiesResponse>(`${this.baseUrl}/google/properties`);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, accounts: [], error: res.error || 'Failed to fetch GA4 properties' };
    } catch (error) {
      return { success: false, accounts: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getGoogleOAuthToken(): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const res = await api.get<{ success: boolean; token?: string; error?: string }>(`${this.baseUrl}/google/token`);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to fetch Google token' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncGoogleSheetData(fileId: string, projectId?: string, accessToken?: string): Promise<GA4SyncResponse> {
    try {
      const payload: { file_id: string; project_id?: string; access_token?: string } = {
        file_id: fileId
      };
      if (projectId) payload.project_id = projectId;
      if (accessToken) payload.access_token = accessToken;
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/google-sheets/sync`, payload);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to sync Google Sheet data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncGoogleAnalyticsData(
    propertyId: string,
    projectId?: string,
    startDate?: string,
    endDate?: string,
    accountName?: string,
    propertyName?: string
  ): Promise<GA4SyncResponse> {
    try {
      const payload: GA4SyncRequest = {
        property_id: propertyId,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(accountName && { account_name: accountName }),
        ...(propertyName && { property_name: propertyName }),
      };
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/google/sync`, payload);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to sync GA4 data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  getMetaOAuthStartUrl(): string {
    // The backend redirects to Facebook OAuth — open this in a popup
    return '/api/v1/integration/meta/oauth/start';
  }

  getStripeOAuthStartUrl(): string {
    // The backend redirects to Stripe Connect OAuth — open this in a popup
    return '/api/v1/integration/stripe/oauth/start';
  }

  getHubSpotOAuthStartUrl(): string {
    return '/api/v1/integration/hubspot/oauth/start';
  }

  getSalesforceOAuthStartUrl(): string {
    return '/api/v1/integration/salesforce/oauth/start';
  }

  getPipedriveOAuthStartUrl(): string {
    return '/api/v1/integration/pipedrive/oauth/start';
  }

  getSupabaseOAuthStartUrl(): string {
    return '/api/v1/integration/supabase/oauth/start';
  }

  getShopifyOAuthStartUrl(shop: string): string {
    return `/api/v1/integration/shopify/oauth/start?shop=${encodeURIComponent(shop)}`;
  }

  getKlaviyoOAuthStartUrl(): string {
    return '/api/v1/integration/klaviyo/oauth/start';
  }

  getQuickBooksOAuthStartUrl(): string {
    return '/api/v1/integration/quickbooks/oauth/start';
  }

  getAmazonSellerOAuthStartUrl(region: string): string {
    return `/api/v1/integration/amazon-seller/oauth/start?region=${encodeURIComponent(region || 'NA')}`;
  }

  getTikTokShopSellerOAuthStartUrl(region: string): string {
    return `/api/v1/integration/tiktok-shop-seller/oauth/start?region=${encodeURIComponent(region || 'US')}`;
  }

  getShopeeSellerOAuthStartUrl(region: string): string {
    return `/api/v1/integration/shopee-seller/oauth/start?region=${encodeURIComponent(region || 'VN')}`;
  }

  getLazadaSellerOAuthStartUrl(region: string): string {
    return `/api/v1/integration/lazada-seller/oauth/start?region=${encodeURIComponent(region || 'VN')}`;
  }

  async getMetaConnectionStatus(): Promise<MetaConnectionStatusResponse> {
    try {
      const res = await api.get<MetaConnectionStatusResponse>(`${this.baseUrl}/meta/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectMeta(): Promise<void> {
    await api.delete(`${this.baseUrl}/meta/disconnect`);
  }

  async fetchMetaAdAccounts(): Promise<MetaAdAccountsResponse> {
    try {
      const res = await api.get<MetaAdAccountsResponse>(`${this.baseUrl}/meta/accounts`);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, ad_accounts: [], error: res.error || 'Failed to fetch Meta ad accounts' };
    } catch (error) {
      return { success: false, ad_accounts: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchMetaCampaigns(
    adAccountId: string,
    datePreset?: string,
    startDate?: string,
    endDate?: string
  ): Promise<MetaCampaignsResponse> {
    try {
      const params = new URLSearchParams();
      if (datePreset) params.append('date_preset', datePreset);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await api.get<MetaCampaignsResponse>(`${this.baseUrl}/meta/accounts/${adAccountId}/campaigns${qs}`);
      if (res.success && res.data) return res.data;
      return { success: false, campaigns: [], error: res.error || 'Failed to fetch campaigns' };
    } catch (error) {
      return { success: false, campaigns: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchMetaAdSets(
    adAccountId: string,
    campaignIds: string[]
  ): Promise<MetaAdSetsResponse> {
    try {
      const payload = { campaign_ids: campaignIds };
      const res = await api.post<MetaAdSetsResponse>(`${this.baseUrl}/meta/accounts/${adAccountId}/adsets`, payload);
      if (res.success && res.data) return res.data;
      return { success: false, adsets: [], error: res.error || 'Failed to fetch adsets' };
    } catch (error) {
      return { success: false, adsets: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncMetaAdsData(
    adAccountId: string,
    projectId?: string,
    datePreset?: string,
    startDate?: string,
    endDate?: string,
    accountName?: string,
    adsetIds?: string[],
    campaignIds?: string[],
  ): Promise<GA4SyncResponse> {
    try {
      const payload: MetaAdsSyncRequest = {
        ad_account_id: adAccountId,
        ...(projectId && { project_id: projectId }),
        ...(datePreset && { date_preset: datePreset }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(accountName && { account_name: accountName }),
        ...(adsetIds && adsetIds.length > 0 && { adset_ids: adsetIds }),
        ...(campaignIds && campaignIds.length > 0 && { campaign_ids: campaignIds }),
      };
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/meta/sync`, payload);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to sync Meta Ads data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  getTikTokOAuthStartUrl(): string {
    return '/api/v1/integration/tiktok/oauth/start';
  }

  async getTikTokConnectionStatus(): Promise<TikTokConnectionStatusResponse> {
    try {
      const res = await api.get<TikTokConnectionStatusResponse>(`${this.baseUrl}/tiktok/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectTikTok(): Promise<void> {
    await api.delete(`${this.baseUrl}/tiktok/disconnect`);
  }

  async fetchTikTokAdAccounts(): Promise<TikTokAdAccountsResponse> {
    try {
      const res = await api.get<TikTokAdAccountsResponse>(`${this.baseUrl}/tiktok/accounts`);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, ad_accounts: [], error: res.error || 'Failed to fetch TikTok ad accounts' };
    } catch (error) {
      return { success: false, ad_accounts: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncTikTokAdsData(
    adAccountId: string,
    projectId?: string,
    datePreset?: string,
    startDate?: string,
    endDate?: string,
    accountName?: string,
  ): Promise<GA4SyncResponse> {
    try {
      const payload: TikTokAdsSyncRequest = {
        ad_account_id: adAccountId,
        ...(projectId && { project_id: projectId }),
        ...(datePreset && { date_preset: datePreset }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(accountName && { account_name: accountName }),
      };
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/tiktok/sync`, payload);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to sync TikTok Ads data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async connectAppsFlyer(apiToken: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await api.post<{ success: boolean; error?: string }>(`${this.baseUrl}/appsflyer/connect`, { api_token: apiToken });
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to connect AppsFlyer' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getAppsFlyerStatus(): Promise<AppsFlyerConnectionStatusResponse> {
    try {
      const res = await api.get<AppsFlyerConnectionStatusResponse>(`${this.baseUrl}/appsflyer/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async fetchAppsFlyerApps(): Promise<AppsFlyerAppsResponse> {
    try {
      const res = await api.get<AppsFlyerAppsResponse>(`${this.baseUrl}/appsflyer/apps`);
      if (res.success && res.data) return res.data;
      return { success: false, apps: [], error: res.error || 'Failed to fetch AppsFlyer apps' };
    } catch (error) {
      return { success: false, apps: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncAppsFlyer(req: AppsFlyerSyncRequest): Promise<AppsFlyerSyncResponse> {
    try {
      const res = await api.post<AppsFlyerSyncResponse>(`${this.baseUrl}/appsflyer/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync AppsFlyer data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async disconnectAppsFlyer(): Promise<void> {
    await api.delete(`${this.baseUrl}/appsflyer/disconnect`);
  }

  async getStripeStatus(): Promise<StripeConnectionStatusResponse> {
    try {
      const res = await api.get<StripeConnectionStatusResponse>(`${this.baseUrl}/stripe/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async syncStripe(req: StripeSyncRequest): Promise<StripeSyncResponse> {
    try {
      const res = await api.post<StripeSyncResponse>(`${this.baseUrl}/stripe/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Stripe data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async disconnectStripe(): Promise<void> {
    await api.delete(`${this.baseUrl}/stripe/disconnect`);
  }

  async getHubSpotStatus(): Promise<HubSpotConnectionStatusResponse> {
    try {
      const res = await api.get<HubSpotConnectionStatusResponse>(`${this.baseUrl}/hubspot/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectHubSpot(): Promise<void> {
    await api.delete(`${this.baseUrl}/hubspot/disconnect`);
  }

  async fetchHubSpotPipelines(): Promise<HubSpotPipelinesResponse> {
    try {
      const res = await api.get<HubSpotPipelinesResponse>(`${this.baseUrl}/hubspot/pipelines`);
      if (res.success && res.data) return res.data;
      return { success: false, pipelines: [], error: res.error || 'Failed to load HubSpot pipelines' };
    } catch (error) {
      return { success: false, pipelines: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchHubSpotOwners(): Promise<HubSpotOwnersResponse> {
    try {
      const res = await api.get<HubSpotOwnersResponse>(`${this.baseUrl}/hubspot/owners`);
      if (res.success && res.data) return res.data;
      return { success: false, owners: [], error: res.error || 'Failed to load HubSpot owners' };
    } catch (error) {
      return { success: false, owners: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncHubSpot(req: HubSpotSyncRequest): Promise<HubSpotSyncResponse> {
    try {
      const res = await api.post<HubSpotSyncResponse>(`${this.baseUrl}/hubspot/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync HubSpot data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getSalesforceStatus(): Promise<SalesforceConnectionStatusResponse> {
    try {
      const res = await api.get<SalesforceConnectionStatusResponse>(`${this.baseUrl}/salesforce/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectSalesforce(): Promise<void> {
    await api.delete(`${this.baseUrl}/salesforce/disconnect`);
  }

  async fetchSalesforceObjects(): Promise<SalesforceObjectsResponse> {
    try {
      const res = await api.get<SalesforceObjectsResponse>(`${this.baseUrl}/salesforce/objects`);
      if (res.success && res.data) return res.data;
      return { success: false, objects: [], error: res.error || 'Failed to load Salesforce objects' };
    } catch (error) {
      return { success: false, objects: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchSalesforceFields(objectName: string): Promise<SalesforceFieldsResponse> {
    try {
      const res = await api.get<SalesforceFieldsResponse>(
        `${this.baseUrl}/salesforce/fields?object_name=${encodeURIComponent(objectName)}`
      );
      if (res.success && res.data) return res.data;
      return { success: false, fields: [], error: res.error || 'Failed to load Salesforce fields' };
    } catch (error) {
      return { success: false, fields: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchSalesforceOwners(): Promise<SalesforceOwnersResponse> {
    try {
      const res = await api.get<SalesforceOwnersResponse>(`${this.baseUrl}/salesforce/owners`);
      if (res.success && res.data) return res.data;
      return { success: false, owners: [], error: res.error || 'Failed to load Salesforce owners' };
    } catch (error) {
      return { success: false, owners: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncSalesforce(req: SalesforceSyncRequest): Promise<SalesforceSyncResponse> {
    try {
      const res = await api.post<SalesforceSyncResponse>(`${this.baseUrl}/salesforce/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Salesforce data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getPipedriveStatus(): Promise<PipedriveConnectionStatusResponse> {
    try {
      const res = await api.get<PipedriveConnectionStatusResponse>(`${this.baseUrl}/pipedrive/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectPipedrive(): Promise<void> {
    await api.delete(`${this.baseUrl}/pipedrive/disconnect`);
  }

  async fetchPipedrivePipelines(): Promise<PipedrivePipelinesResponse> {
    try {
      const res = await api.get<PipedrivePipelinesResponse>(`${this.baseUrl}/pipedrive/pipelines`);
      if (res.success && res.data) return res.data;
      return { success: false, pipelines: [], error: res.error || 'Failed to load Pipedrive pipelines' };
    } catch (error) {
      return { success: false, pipelines: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchPipedriveUsers(): Promise<PipedriveUsersResponse> {
    try {
      const res = await api.get<PipedriveUsersResponse>(`${this.baseUrl}/pipedrive/users`);
      if (res.success && res.data) return res.data;
      return { success: false, users: [], error: res.error || 'Failed to load Pipedrive users' };
    } catch (error) {
      return { success: false, users: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchPipedriveFields(objectName: string): Promise<PipedriveFieldsResponse> {
    try {
      const res = await api.get<PipedriveFieldsResponse>(
        `${this.baseUrl}/pipedrive/fields?object_name=${encodeURIComponent(objectName)}`
      );
      if (res.success && res.data) return res.data;
      return { success: false, fields: [], error: res.error || 'Failed to load Pipedrive fields' };
    } catch (error) {
      return { success: false, fields: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncPipedrive(req: PipedriveSyncRequest): Promise<PipedriveSyncResponse> {
    try {
      const res = await api.post<PipedriveSyncResponse>(`${this.baseUrl}/pipedrive/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Pipedrive data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getSupabaseStatus(): Promise<SupabaseConnectionStatusResponse> {
    try {
      const res = await api.get<SupabaseConnectionStatusResponse>(`${this.baseUrl}/supabase/status`);
      if (res.success && res.data) return res.data;
      return { connected: false, oauth_connected: false, connection_count: 0 };
    } catch {
      return { connected: false, oauth_connected: false, connection_count: 0 };
    }
  }

  async disconnectSupabase(): Promise<void> {
    await api.delete(`${this.baseUrl}/supabase/disconnect`);
  }

  async fetchSupabaseProjects(): Promise<SupabaseProjectsResponse> {
    try {
      const res = await api.get<SupabaseProjectsResponse>(`${this.baseUrl}/supabase/projects`);
      if (res.success && res.data) return res.data;
      return { success: false, projects: [], error: res.error || 'Failed to load Supabase projects' };
    } catch (error) {
      return { success: false, projects: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchSupabaseConnections(): Promise<SupabaseConnectionsResponse> {
    try {
      const res = await api.get<SupabaseConnectionsResponse>(`${this.baseUrl}/supabase/connections`);
      if (res.success && res.data) return res.data;
      return { success: false, connections: [], error: res.error || 'Failed to load Supabase connections' };
    } catch (error) {
      return { success: false, connections: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async createSupabaseConnection(payload: SupabaseConnectionCreateRequest): Promise<SupabaseConnection> {
    const res = await api.post<SupabaseConnection>(`${this.baseUrl}/supabase/connections`, payload);
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to connect Supabase database');
  }

  async refreshSupabaseSchema(connectionId: string): Promise<SupabaseConnection> {
    const res = await api.post<SupabaseConnection>(
      `${this.baseUrl}/supabase/connections/${encodeURIComponent(connectionId)}/schema/refresh`,
      {}
    );
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to refresh Supabase schema');
  }

  async sampleSupabaseTable(
    connectionId: string,
    payload: { schema_name: string; table_name: string; columns?: string[]; limit?: number }
  ): Promise<SupabaseSampleResponse> {
    try {
      const res = await api.post<SupabaseSampleResponse>(
        `${this.baseUrl}/supabase/connections/${encodeURIComponent(connectionId)}/tables/sample`,
        payload
      );
      if (res.success && res.data) return res.data;
      return { success: false, columns: [], rows: [], generated_sql: '', error: res.error || 'Failed to sample Supabase table' };
    } catch (error) {
      return { success: false, columns: [], rows: [], generated_sql: '', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncSupabase(req: SupabaseSyncRequest): Promise<SupabaseSyncResponse> {
    try {
      const res = await api.post<SupabaseSyncResponse>(`${this.baseUrl}/supabase/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Supabase data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getShopifyStatus(): Promise<ShopifyConnectionStatusResponse> {
    try {
      const res = await api.get<ShopifyConnectionStatusResponse>(`${this.baseUrl}/shopify/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectShopify(): Promise<void> {
    await api.delete(`${this.baseUrl}/shopify/disconnect`);
  }

  async fetchShopifyResources(): Promise<ShopifyResourcesResponse> {
    try {
      const res = await api.get<ShopifyResourcesResponse>(`${this.baseUrl}/shopify/resources`);
      if (res.success && res.data) return res.data;
      return { success: false, resources: [], error: res.error || 'Failed to load Shopify resources' };
    } catch (error) {
      return { success: false, resources: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncShopify(req: ShopifySyncRequest): Promise<ShopifySyncResponse> {
    try {
      const res = await api.post<ShopifySyncResponse>(`${this.baseUrl}/shopify/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Shopify data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getKlaviyoStatus(): Promise<KlaviyoConnectionStatusResponse> {
    try {
      const res = await api.get<KlaviyoConnectionStatusResponse>(`${this.baseUrl}/klaviyo/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectKlaviyo(): Promise<void> {
    await api.delete(`${this.baseUrl}/klaviyo/disconnect`);
  }

  async fetchKlaviyoResources(): Promise<KlaviyoResourcesResponse> {
    try {
      const res = await api.get<KlaviyoResourcesResponse>(`${this.baseUrl}/klaviyo/resources`);
      if (res.success && res.data) return res.data;
      return {
        success: false,
        reports: [],
        metrics: [],
        campaigns: [],
        flows: [],
        lists: [],
        error: res.error || 'Failed to load Klaviyo resources',
      };
    } catch (error) {
      return {
        success: false,
        reports: [],
        metrics: [],
        campaigns: [],
        flows: [],
        lists: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncKlaviyo(req: KlaviyoSyncRequest): Promise<KlaviyoSyncResponse> {
    try {
      const res = await api.post<KlaviyoSyncResponse>(`${this.baseUrl}/klaviyo/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Klaviyo data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getQuickBooksStatus(): Promise<QuickBooksConnectionStatusResponse> {
    try {
      const res = await api.get<QuickBooksConnectionStatusResponse>(`${this.baseUrl}/quickbooks/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectQuickBooks(): Promise<void> {
    await api.delete(`${this.baseUrl}/quickbooks/disconnect`);
  }

  async fetchQuickBooksResources(): Promise<QuickBooksResourcesResponse> {
    try {
      const res = await api.get<QuickBooksResourcesResponse>(`${this.baseUrl}/quickbooks/resources`);
      if (res.success && res.data) return res.data;
      return {
        success: false,
        reports: [],
        realms: [],
        error: res.error || 'Failed to load QuickBooks resources',
      };
    } catch (error) {
      return {
        success: false,
        reports: [],
        realms: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncQuickBooks(req: QuickBooksSyncRequest): Promise<QuickBooksSyncResponse> {
    try {
      const res = await api.post<QuickBooksSyncResponse>(`${this.baseUrl}/quickbooks/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync QuickBooks data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getAmazonSellerStatus(): Promise<AmazonSellerConnectionStatusResponse> {
    try {
      const res = await api.get<AmazonSellerConnectionStatusResponse>(`${this.baseUrl}/amazon-seller/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectAmazonSeller(): Promise<void> {
    await api.delete(`${this.baseUrl}/amazon-seller/disconnect`);
  }

  async fetchAmazonSellerResources(): Promise<AmazonSellerResourcesResponse> {
    try {
      const res = await api.get<AmazonSellerResourcesResponse>(`${this.baseUrl}/amazon-seller/resources`);
      if (res.success && res.data) return res.data;
      return {
        success: false,
        reports: [],
        marketplaces: [],
        error: res.error || 'Failed to load Amazon Seller resources',
      };
    } catch (error) {
      return {
        success: false,
        reports: [],
        marketplaces: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncAmazonSeller(req: AmazonSellerSyncRequest): Promise<AmazonSellerSyncResponse> {
    try {
      const res = await api.post<AmazonSellerSyncResponse>(`${this.baseUrl}/amazon-seller/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Amazon Seller data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getTikTokShopSellerStatus(): Promise<TikTokShopSellerConnectionStatusResponse> {
    try {
      const res = await api.get<TikTokShopSellerConnectionStatusResponse>(`${this.baseUrl}/tiktok-shop-seller/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectTikTokShopSeller(): Promise<void> {
    await api.delete(`${this.baseUrl}/tiktok-shop-seller/disconnect`);
  }

  async fetchTikTokShopSellerResources(): Promise<TikTokShopSellerResourcesResponse> {
    try {
      const res = await api.get<TikTokShopSellerResourcesResponse>(`${this.baseUrl}/tiktok-shop-seller/resources`);
      if (res.success && res.data) return res.data;
      return {
        success: false,
        reports: [],
        shops: [],
        error: res.error || 'Failed to load TikTok Shop resources',
      };
    } catch (error) {
      return {
        success: false,
        reports: [],
        shops: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncTikTokShopSeller(req: TikTokShopSellerSyncRequest): Promise<TikTokShopSellerSyncResponse> {
    try {
      const res = await api.post<TikTokShopSellerSyncResponse>(`${this.baseUrl}/tiktok-shop-seller/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync TikTok Shop data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getShopeeSellerStatus(): Promise<ShopeeSellerConnectionStatusResponse> {
    try {
      const res = await api.get<ShopeeSellerConnectionStatusResponse>(`${this.baseUrl}/shopee-seller/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectShopeeSeller(): Promise<void> {
    await api.delete(`${this.baseUrl}/shopee-seller/disconnect`);
  }

  async fetchShopeeSellerResources(): Promise<ShopeeSellerResourcesResponse> {
    try {
      const res = await api.get<ShopeeSellerResourcesResponse>(`${this.baseUrl}/shopee-seller/resources`);
      if (res.success && res.data) return res.data;
      return {
        success: false,
        reports: [],
        shops: [],
        error: res.error || 'Failed to load Shopee Seller resources',
      };
    } catch (error) {
      return {
        success: false,
        reports: [],
        shops: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncShopeeSeller(req: ShopeeSellerSyncRequest): Promise<ShopeeSellerSyncResponse> {
    try {
      const res = await api.post<ShopeeSellerSyncResponse>(`${this.baseUrl}/shopee-seller/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Shopee Seller data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getLazadaSellerStatus(): Promise<LazadaSellerConnectionStatusResponse> {
    try {
      const res = await api.get<LazadaSellerConnectionStatusResponse>(`${this.baseUrl}/lazada-seller/status`);
      if (res.success && res.data) return res.data;
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async disconnectLazadaSeller(): Promise<void> {
    await api.delete(`${this.baseUrl}/lazada-seller/disconnect`);
  }

  async fetchLazadaSellerResources(): Promise<LazadaSellerResourcesResponse> {
    try {
      const res = await api.get<LazadaSellerResourcesResponse>(`${this.baseUrl}/lazada-seller/resources`);
      if (res.success && res.data) return res.data;
      return {
        success: false,
        reports: [],
        sellers: [],
        error: res.error || 'Failed to load Lazada Seller resources',
      };
    } catch (error) {
      return {
        success: false,
        reports: [],
        sellers: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncLazadaSeller(req: LazadaSellerSyncRequest): Promise<LazadaSellerSyncResponse> {
    try {
      const res = await api.post<LazadaSellerSyncResponse>(`${this.baseUrl}/lazada-seller/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Lazada Seller data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchGoogleAdsAccounts(): Promise<GoogleAdsAccountsResponse> {
    try {
      const res = await api.get<GoogleAdsAccountsResponse>(`${this.baseUrl}/google-ads/accounts`);
      if (res.success && res.data) return res.data;
      return { success: false, ad_accounts: [], error: res.error || 'Failed to fetch Google Ads accounts' };
    } catch (error) {
      return { success: false, ad_accounts: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncGoogleAdsData(req: GoogleAdsSyncRequest): Promise<GA4SyncResponse> {
    try {
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/google-ads/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Google Ads data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async fetchFirebaseProjects(): Promise<FirebaseProjectsResponse> {
    try {
      const res = await api.get<FirebaseProjectsResponse>(`${this.baseUrl}/firebase/projects`);
      if (res.success && res.data) return res.data;
      return { success: false, projects: [], error: res.error || 'Failed to fetch Firebase projects' };
    } catch (error) {
      return { success: false, projects: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncFirebaseData(req: FirebaseSyncRequest): Promise<GA4SyncResponse> {
    try {
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/firebase/sync`, req);
      if (res.success && res.data) return res.data;
      return { success: false, error: res.error || 'Failed to sync Firebase data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

export interface MetaConnectionStatusResponse {
  connected: boolean;
  expires_at?: string;
  reason?: string;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
  source_type: 'personal' | 'business';
  business_id?: string;
  business_name?: string;
}

export interface MetaAdAccountsResponse {
  success: boolean;
  ad_accounts: MetaAdAccount[];
  has_business_management?: boolean;
  error?: string;
}

export interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
}

export interface MetaCampaignsResponse {
  success: boolean;
  campaigns: MetaCampaign[];
  error?: string;
}

export interface MetaAdSet {
  id: string;
  name: string;
  status?: string;
  campaign_id?: string;
}

export interface MetaAdSetsResponse {
  success: boolean;
  adsets: MetaAdSet[];
  error?: string;
}

export interface MetaAdsSyncRequest {
  ad_account_id: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  account_name?: string;
  adset_ids?: string[];
  campaign_ids?: string[];
}

export interface TikTokConnectionStatusResponse {
  connected: boolean;
  expires_at?: string;
  reason?: string;
}

export interface TikTokAdAccount {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
  source_type: 'personal' | 'business';
}

export interface TikTokAdAccountsResponse {
  success: boolean;
  ad_accounts: TikTokAdAccount[];
  error?: string;
}

export interface TikTokAdsSyncRequest {
  ad_account_id: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  account_name?: string;
}

export interface AppsFlyerApp {
  app_id: string;
  app_name: string;
  platform: string;
}

export interface AppsFlyerConnectionStatusResponse {
  connected: boolean;
}

export interface AppsFlyerAppsResponse {
  success: boolean;
  apps: AppsFlyerApp[];
  error?: string;
}

export interface AppsFlyerSyncRequest {
  app_id: string;
  app_name: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
}

export interface AppsFlyerSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  error?: string;
}

export interface StripeConnectionStatusResponse {
  connected: boolean;
}

export interface StripeSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
}

export interface StripeSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  error?: string;
}

export interface HubSpotConnectionStatusResponse {
  connected: boolean;
  portal_id?: string;
  portal_domain?: string;
  account_name?: string;
}

export interface HubSpotPipelineStage {
  id: string;
  label: string;
  probability?: string | number | null;
}

export interface HubSpotPipeline {
  id: string;
  label: string;
  stages: HubSpotPipelineStage[];
}

export interface HubSpotOwner {
  id: string;
  name: string;
  email?: string;
}

export interface HubSpotPipelinesResponse {
  success: boolean;
  pipelines: HubSpotPipeline[];
  error?: string;
}

export interface HubSpotOwnersResponse {
  success: boolean;
  owners: HubSpotOwner[];
  error?: string;
}

export interface HubSpotSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  pipeline_id?: string;
  owner_id?: string;
  row_limit?: number;
  include_associations?: boolean;
}

export interface HubSpotSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  error?: string;
}

export interface SalesforceConnectionStatusResponse {
  connected: boolean;
  org_id?: string;
  instance_url?: string;
  instance_domain?: string;
  username?: string;
  account_name?: string;
}

export interface SalesforceObject {
  name: string;
  label: string;
  label_plural?: string;
  queryable?: boolean;
  custom?: boolean;
}

export interface SalesforceField {
  name: string;
  label: string;
  type: string;
  filterable?: boolean;
  sortable?: boolean;
  nillable?: boolean;
  custom?: boolean;
}

export interface SalesforceOwner {
  id: string;
  name: string;
  email?: string;
}

export interface SalesforceObjectsResponse {
  success: boolean;
  objects: SalesforceObject[];
  error?: string;
}

export interface SalesforceFieldsResponse {
  success: boolean;
  fields: SalesforceField[];
  error?: string;
}

export interface SalesforceOwnersResponse {
  success: boolean;
  owners: SalesforceOwner[];
  error?: string;
}

export interface SalesforceSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  object_name?: string;
  owner_id?: string;
  row_limit?: number;
}

export interface SalesforceSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  error?: string;
}

export interface PipedriveConnectionStatusResponse {
  connected: boolean;
  company_id?: string;
  company_domain?: string;
  company_name?: string;
  user_email?: string;
  account_name?: string;
}

export interface PipedrivePipelineStage {
  id: string;
  label: string;
  probability?: string | number | null;
}

export interface PipedrivePipeline {
  id: string;
  label: string;
  stages: PipedrivePipelineStage[];
}

export interface PipedriveUser {
  id: string;
  name: string;
  email?: string;
  active?: boolean;
}

export interface PipedriveField {
  key: string;
  name: string;
  field_type: string;
  custom?: boolean;
  options?: unknown[];
}

export interface PipedrivePipelinesResponse {
  success: boolean;
  pipelines: PipedrivePipeline[];
  error?: string;
}

export interface PipedriveUsersResponse {
  success: boolean;
  users: PipedriveUser[];
  error?: string;
}

export interface PipedriveFieldsResponse {
  success: boolean;
  fields: PipedriveField[];
  error?: string;
}

export interface PipedriveSyncRequest {
  report_type: string;
  project_id?: string;
  date_preset?: string;
  start_date?: string;
  end_date?: string;
  pipeline_id?: string;
  owner_id?: string;
  row_limit?: number;
}

export interface PipedriveSyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  entity_id?: string;
  truncated?: boolean;
  error?: string;
}

export interface GoogleAdsAccount {
  id: string;
  name: string;
  account_status: string;
  currency: string;
  timezone_name: string;
  source_type: string;
}

export interface GoogleAdsAccountsResponse {
  success: boolean;
  ad_accounts: GoogleAdsAccount[];
  error?: string;
}

export interface GoogleAdsSyncRequest {
  ad_account_id: string;
  project_id?: string;
  start_date?: string;
  end_date?: string;
  account_name?: string;
}

export interface FirebaseProject {
  id: string;
  name: string;
  source_type: string;
}

export interface FirebaseProjectsResponse {
  success: boolean;
  projects: FirebaseProject[];
  error?: string;
}

export interface FirebaseSyncRequest {
  firebase_project_id: string;
  app_name: string;
  project_id?: string;
  start_date?: string;
  end_date?: string;
}

export const integrationService = new IntegrationService();
