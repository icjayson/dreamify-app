import { api } from './api';

export interface ConversationChatRequest {
  conversation_id?: string;
  project_id: string;
  asset_id: string;
  user_node_contents: Array<{
    type: string;
    data: Record<string, any>;
  }>;
}

export interface ConversationChatResponse {
  conversation_id: string;
  project_id: string;
  asset_id: string;
  workflow_status: Record<string, any>;
}

export interface ConversationResponse {
  conversation: Record<string, any>;
}

export interface WorkflowStatusResponse {
  conversation_id: string;
  node_id: string;
  status: string;
  metadata: Record<string, any>;
  updated_at?: string;
}

export interface DashboardDataResponse {
  dashboard_id: string;
  dashboard_data: Record<string, any>;
}

class ConversationService {
  private chatUrl = '/api/v1/conversation/chat';

  async sendChatMessage(request: ConversationChatRequest): Promise<ConversationChatResponse> {
    const response = await api.post<ConversationChatResponse>(this.chatUrl, request);
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to send chat message');
  }

  async loadConversation(conversationId: string, projectId: string): Promise<ConversationResponse> {
    const response = await api.get<ConversationResponse>(
      `/api/v1/conversation/${conversationId}?project_id=${projectId}`
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to load conversation');
  }

  async getWorkflowStatus(conversationId: string, projectId: string): Promise<WorkflowStatusResponse> {
    const response = await api.get<WorkflowStatusResponse>(
      `/api/v1/morpheus/workflow-status/${conversationId}?project_id=${projectId}`
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get workflow status');
  }

  async getDashboardData(conversationId: string, projectId: string): Promise<DashboardDataResponse | null> {
    try {
      const conversationResponse = await this.loadConversation(conversationId, projectId);
      const conversation = conversationResponse.conversation;
      
      // Get the latest dashboard from conversation
      const dashboards = conversation.dashboards || [];
      if (dashboards.length === 0) {
        return null;
      }
      
      // Get the most recent dashboard
      const latestDashboard = dashboards[dashboards.length - 1];
      const dashboardId = latestDashboard.dashboard_id;
      const s3Uri = latestDashboard.s3_uri;
      
      if (!dashboardId || !s3Uri) {
        return null;
      }
      
      // Load dashboard from S3 via backend endpoint
      const response = await api.get<DashboardDataResponse>(
        `/api/v1/conversation/${conversationId}/dashboard?project_id=${projectId}`
      );
      if (response.success && response.data) {
        return response.data;
      }
      return null;
    } catch (error) {
      console.error('Failed to get dashboard data:', error);
      return null;
    }
  }
}

export const conversationService = new ConversationService();

