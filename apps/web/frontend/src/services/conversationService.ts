import { api } from './api';

export interface ConversationChatRequest {
  conversation_id?: string;
  project_id: string;
  asset_id?: string;  // Optional if conversation_id is provided
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
  dashboard_id: string | null;
  dashboard_data: Record<string, any> | null;
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

  async getWorkflowStatus(conversationId: string, projectId: string, abortSignal?: AbortSignal): Promise<WorkflowStatusResponse> {
    const response = await api.get<WorkflowStatusResponse>(
      `/api/v1/morpheus/workflow-status/${conversationId}?project_id=${projectId}`,
      abortSignal ? { signal: abortSignal } : undefined
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get workflow status');
  }

  async getDashboardData(conversationId: string, projectId: string): Promise<DashboardDataResponse | null> {
    try {
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

  async stopWorkflow(conversationId: string, projectId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const response = await api.post<{ success: boolean; message: string; conversation_id: string }>(
        `/api/v1/conversation/${conversationId}/stop?project_id=${projectId}`
      );
      if (response.success && response.data) {
        return { success: true, message: response.data.message };
      }
      return { success: false, error: response.error || 'Failed to stop workflow' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return { success: false, error: errorMessage };
    }
  }
}

export const conversationService = new ConversationService();

