import { api } from './api';
import { EXPLICIT_PROMPT_THEME_SOURCE, type AssetSelectionMode, type ThinkingEvent } from '@/types/message';

export interface ConversationNodeContent {
  type: string;
  data: Record<string, unknown>;
}

export interface ConversationChatRequest {
  conversation_id?: string;
  project_id: string;
  asset_id?: string;  // Optional if conversation_id is provided
  user_node_contents: ConversationNodeContent[];
  // Metadata for user node - used for selective asset processing
  user_node_metadata?: {
    asset_selection: AssetSelectionMode;
    selected_asset_ids?: string[];
    selected_chart_ids?: string[];
    clarification_id?: string;
    theme_source?: typeof EXPLICIT_PROMPT_THEME_SOURCE;
  };
  model?: 'pro' | 'fast';
  theme_id?: string;
  analysis_focus_id?: string;
  /** Legacy compatibility only. New callers should use theme_id and analysis_focus_id. */
  template_id?: string;
}

export interface ConversationChatResponse {
  conversation_id: string;
  project_id: string;
  asset_id?: string;
  project_name?: string;
  project_name_source?: string;
  workflow_status: Record<string, unknown>;
}

export interface ConversationResponse {
  conversation: Record<string, unknown>;
}

export interface WorkflowStatusResponse {
  conversation_id: string;
  node_id: string;
  status: string;
  metadata: Record<string, unknown>;
  updated_at?: string;
}

export interface WorkflowEventsResponse {
  conversation_id: string;
  status: WorkflowStatusResponse | null;
  events: ThinkingEvent[];
}

export interface ClarificationDismissResponse {
  success: boolean;
  message: string;
  conversation_id: string;
  clarification_id: string;
}

export interface DashboardDataResponse {
  dashboard_id: string | null;
  dashboard_data: Record<string, unknown> | null;
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
      `/api/v1/conversation/workflow-status/${conversationId}?project_id=${projectId}`,
      abortSignal ? { signal: abortSignal } : undefined
    );
    if (response.success && response.data) {
      return response.data;
    }

    // If the workflow node hasn't been created yet by Morpheus, the backend returns 404.
    // We treat this gracefully as a 'starting' state instead of throwing an error.
    if (response.error && response.error.includes('404')) {
      return {
        conversation_id: conversationId,
        node_id: 'workflow',
        status: 'starting',
        metadata: { step: 'initializing' }
      };
    }

    throw new Error(response.error || 'Failed to get workflow status');
  }

  async getWorkflowEvents(conversationId: string, projectId: string, abortSignal?: AbortSignal): Promise<WorkflowEventsResponse> {
    const response = await api.get<WorkflowEventsResponse>(
      `/api/v1/conversation/workflow-events/${conversationId}?project_id=${encodeURIComponent(projectId)}`,
      abortSignal ? { signal: abortSignal } : undefined
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get workflow events');
  }

  async dismissClarification(
    conversationId: string,
    projectId: string,
    clarificationId: string,
  ): Promise<ClarificationDismissResponse> {
    const response = await api.post<ClarificationDismissResponse>(
      `/api/v1/conversation/${conversationId}/clarification/${clarificationId}/dismiss?project_id=${encodeURIComponent(projectId)}`
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to dismiss clarification');
  }

  async getDashboardData(conversationId: string, projectId: string, dashboardId?: string): Promise<DashboardDataResponse | null> {
    try {
      const url = dashboardId
        ? `/api/v1/conversation/${conversationId}/dashboard?project_id=${projectId}&dashboard_id=${dashboardId}`
        : `/api/v1/conversation/${conversationId}/dashboard?project_id=${projectId}`;
      const response = await api.get<DashboardDataResponse>(url);
      if (response.success && response.data) {
        return response.data;
      }
      return null;
    } catch (error) {
      console.error('Failed to get dashboard data:', error);
      return null;
    }
  }

  async updateDashboardTemplate(
    conversationId: string,
    dashboardId: string,
    projectId: string,
    templateId: string | null,
  ): Promise<void> {
    try {
      await api.put(
        `/api/v1/conversation/${conversationId}/dashboard/${dashboardId}/template`,
        { project_id: projectId, template_id: templateId },
      );
    } catch (error) {
      console.error('Failed to update dashboard template:', error);
    }
  }

  async updateDashboardTheme(
    conversationId: string,
    dashboardId: string,
    projectId: string,
    themeId: string | null,
  ): Promise<void> {
    try {
      await api.put(
        `/api/v1/conversation/${conversationId}/dashboard/${dashboardId}/theme`,
        { project_id: projectId, theme_id: themeId },
      );
    } catch (error) {
      console.error('Failed to update dashboard theme:', error);
    }
  }

  async saveDashboardData(
    conversationId: string,
    dashboardId: string,
    projectId: string,
    dashboardData: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await api.put<{ success: boolean }>(
        `/api/v1/conversation/${conversationId}/dashboard/${dashboardId}/data`,
        { project_id: projectId, dashboard_data: dashboardData },
      );
      if (response.success && response.data) return { success: true };
      return { success: false, error: response.error || 'Failed to save dashboard' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
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
