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
}

export interface ConversationListResponse {
  conversations: ConversationListItem[];
  total: number;
  last_key?: string;
}

export interface ConversationDetailResponse {
  conversation: Record<string, any>;
}

export interface NodeListResponse {
  nodes: Array<Record<string, any>>;
}

export interface AdminMetricsResponse {
  total_users: number;
  total_conversations: number;
  total_messages: number;
  avg_msgs_per_user: number;
  success_rate: number;
}

export interface TimeSeriesDataPoint {
  date: string;
  messages: number;
  conversations: number;
  active_users: number;
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
