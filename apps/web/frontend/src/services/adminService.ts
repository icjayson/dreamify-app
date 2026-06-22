import { API_ENDPOINTS } from '@/api/config';
import type { DashboardConfiguration } from '@/types/dashboard';
import type { FilePreviewData } from './filePreviewService';

export interface ConversationListItem {
  conversation_id: string;
  project_id: string;
  user_id: string;
  user_name?: string;
  user_avatar?: string;
  title: string;
  created_at: string;
  updated_at: string;
  s3_bucket?: string;
  s3_key?: string;
  chat_mode?: string;
  model?: string;
  theme_id?: string;
  analysis_focus_id?: string;
  template_id?: string;
  total_tokens?: number;
}

export interface ConversationListResponse {
  conversations: ConversationListItem[];
  total: number;
  last_key?: string;
}

export interface ConversationDetailResponse {
  conversation: Record<string, unknown>;
}

export interface NodeListResponse {
  nodes: Array<Record<string, unknown>>;
}

export interface AdminMetricsResponse {
  total_users: number;
  total_conversations: number;
  total_messages: number;
  avg_msgs_per_user: number;
  success_rate: number;
  total_tokens: number;
  mode_distribution: Record<string, number>;
  model_distribution: Record<string, number>;
}

export interface TimeSeriesDataPoint {
  date: string;
  messages: number;
  conversations: number;
  active_users: number;
  tokens: number;
  modes: Record<string, number>;
  models: Record<string, number>;
  tokens_by_model: Record<string, number>;
}

export interface AdminUserListItem {
  uid: string;
  mail?: string | null;
  name: string;
  has_dashboard: boolean;
  workspace_platform: string;
  workspace_platforms: string[];
  has_workspace: boolean;
  has_connector: boolean;
  dashboard_count: number;
  project_count: number;
  file_upload_count: number;
  connector_count: number;
  connected_connectors: string[];
  connector_entity_count: number;
  workspace_count: number;
  connected_workspaces: string[];
  token_burned: number;
  signup_date?: string | null;
  latest_signin_date?: string | null;
}

export interface AdminUserProjectItem {
  project_id: string;
  name: string;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  latest_conversation_id?: string | null;
  latest_dashboard_id?: string | null;
  dashboard_title?: string | null;
  dashboard_preview_key?: string | null;
  source_type?: string | null;
}

export interface AdminUserDashboardItem {
  dashboard_id: string;
  project_id: string;
  conversation_id?: string | null;
  title?: string | null;
  status?: string | null;
  s3_bucket?: string | null;
  s3_key?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AdminUserFileItem {
  asset_id: string;
  file_id?: string | null;
  project_id?: string | null;
  filename: string;
  extension: string;
  asset_type: string;
  status: string;
  size_bytes: number;
  created_at?: string | null;
  row_count?: number | null;
  column_count?: number | null;
}

export interface AdminUserEntityItem {
  provider: string;
  display_name: string;
  id: string;
  name: string;
  type?: string | null;
  raw: Record<string, unknown>;
}

export interface AdminUserConnectorItem {
  provider: string;
  display_name: string;
  connected: boolean;
  entity_count: number;
  created_at?: string | null;
  updated_at?: string | null;
  selected_entities: AdminUserEntityItem[];
  raw: Record<string, unknown>;
}

export interface AdminUserWorkspaceItem {
  platform_workspace_id: string;
  platform: string;
  workspace_name: string;
  project_id?: string | null;
  language?: string | null;
  created_at?: string | null;
  raw: Record<string, unknown>;
}

export interface AdminUserConversationItem {
  conversation_id: string;
  project_id: string;
  title: string;
  created_at?: string | null;
  updated_at?: string | null;
  total_tokens: number;
  chat_mode?: string | null;
  model?: string | null;
}

export interface AdminUserListResponse {
  users: AdminUserListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminUserDetailResponse {
  user: AdminUserListItem;
  projects: AdminUserProjectItem[];
  dashboards: AdminUserDashboardItem[];
  files: AdminUserFileItem[];
  connectors: AdminUserConnectorItem[];
  entities: AdminUserEntityItem[];
  workspaces: AdminUserWorkspaceItem[];
  conversations: AdminUserConversationItem[];
}

class AdminService {
  private async requestWithAuth<T>(
    endpoint: string,
    token: string,
    options: RequestInit = {},
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    const response = await fetch(`${import.meta.env.VITE_API_URL || ''}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers as Record<string, string> || {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: errorText || `HTTP error! status: ${response.status}`
      };
    }

    const data = await response.json();
    return { success: true, data };
  }

  async listConversations(
    token: string,
    projectId?: string,
    page: number = 1,
    pageSize: number = 20
  ): Promise<ConversationListResponse> {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId);
    params.append('page', page.toString());
    params.append('page_size', pageSize.toString());

    const endpoint = `${API_ENDPOINTS.ADMIN_CONVERSATIONS}?${params.toString()}`;
    const response = await this.requestWithAuth<ConversationListResponse>(
      endpoint,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to list conversations');
  }

  async getConversation(
    token: string,
    conversationId: string,
    projectId: string
  ): Promise<ConversationDetailResponse> {
    const endpoint = `${API_ENDPOINTS.ADMIN_CONVERSATION}/${conversationId}?project_id=${projectId}`;
    const response = await this.requestWithAuth<ConversationDetailResponse>(
      endpoint,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get conversation');
  }

  async getConversationNodes(
    token: string,
    conversationId: string,
    projectId: string
  ): Promise<NodeListResponse> {
    const endpoint = `${API_ENDPOINTS.ADMIN_CONVERSATION_NODES}/${conversationId}/nodes?project_id=${projectId}`;
    const response = await this.requestWithAuth<NodeListResponse>(
      endpoint,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get conversation nodes');
  }

  async getConversationDashboard(
    token: string,
    conversationId: string,
    projectId: string,
    dashboardId: string
  ): Promise<DashboardConfiguration | null> {
    const endpoint = `/api/v1/admin/conversations/${conversationId}/dashboard?project_id=${projectId}&dashboard_id=${dashboardId}`;
    const response = await this.requestWithAuth<{ dashboard_id: string; dashboard_data: DashboardConfiguration }>(
      endpoint,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data && response.data.dashboard_data) {
      return response.data.dashboard_data;
    }
    return null;
  }

  async getMetrics(
    token: string,
  ): Promise<AdminMetricsResponse> {
    const endpoint = API_ENDPOINTS.ADMIN_METRICS;
    const response = await this.requestWithAuth<AdminMetricsResponse>(
      endpoint,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get admin metrics');
  }

  async getMetricsTimeSeries(
    token: string,
    days: number = 30
  ): Promise<TimeSeriesDataPoint[]> {
    const endpoint = `${API_ENDPOINTS.ADMIN_TIMESERIES}?days=${days}`;
    const response = await this.requestWithAuth<TimeSeriesDataPoint[]>(
      endpoint,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get time-series metrics');
  }

  async listUsers(
    token: string,
    options: {
      page?: number;
      pageSize?: number;
      query?: string;
      hasDashboard?: boolean;
      hasWorkspace?: boolean;
      hasConnector?: boolean;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
    } = {},
  ): Promise<AdminUserListResponse> {
    const params = new URLSearchParams();
    params.append('page', String(options.page ?? 1));
    params.append('page_size', String(options.pageSize ?? 50));
    if (options.query) params.append('query', options.query);
    if (options.hasDashboard !== undefined) params.append('has_dashboard', String(options.hasDashboard));
    if (options.hasWorkspace !== undefined) params.append('has_workspace', String(options.hasWorkspace));
    if (options.hasConnector !== undefined) params.append('has_connector', String(options.hasConnector));
    if (options.sortBy) params.append('sort_by', options.sortBy);
    if (options.sortDir) params.append('sort_dir', options.sortDir);

    const response = await this.requestWithAuth<AdminUserListResponse>(
      `${API_ENDPOINTS.ADMIN_USERS}?${params.toString()}`,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to list admin users');
  }

  async getUserDetail(
    token: string,
    userId: string,
  ): Promise<AdminUserDetailResponse> {
    const response = await this.requestWithAuth<AdminUserDetailResponse>(
      `${API_ENDPOINTS.ADMIN_USERS}/${encodeURIComponent(userId)}`,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to load admin user detail');
  }

  async getFilePreview(
    token: string,
    conversationId: string,
    projectId: string,
    assetId: string
  ): Promise<FilePreviewData> {
    const endpoint = `/api/v1/admin/conversations/${conversationId}/assets/${assetId}/preview?project_id=${projectId}`;
    const response = await this.requestWithAuth<FilePreviewData>(
      endpoint,
      token,
      { method: 'GET' },
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get file preview');
  }
}

export const adminService = new AdminService();
