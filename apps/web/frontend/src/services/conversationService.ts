import { api } from './api';
import { EXPLICIT_PROMPT_THEME_SOURCE, type AssetSelectionMode, type ThinkingEvent } from '@/types/message';
import type { AnalysisStep, ChartChangeSummary, EditDataProvenance } from '@/types/chartEdit';

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
    clarification_ids?: string[];
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
  /**
   * "What changed" summary. Present only after a chart edit; null/absent for
   * normal full-dashboard generation. Backward-compatible: older backends omit it.
   */
  change_summary?: ChartChangeSummary | null;
  /**
   * Edit provenance: the Python the edit ran plus its outputs. Kept for the
   * Activity tab/audit path; older backends may omit it.
   */
  computed_values?: EditDataProvenance | null;
  /**
   * "How this was calculated": ordered analysis steps (plain-language
   * explanation + Python + output). Present whenever the run recorded steps;
   * null/absent for legacy backends. Drives the Activity tab.
   */
  analysis_steps?: AnalysisStep[] | null;
  /** Optional safety-net note when an attempted edit could not replace the chart. */
  edit_note?: string | null;
}

/**
 * One entry in a dashboard's version history (Phase 7). `source` records how the
 * snapshot came to be (e.g. "edit", "generation", "revert"); `edit_summary` is a
 * human-readable "what changed" note when present.
 */
export interface DashboardVersionEntry {
  version: number;
  created_at: string;
  edit_summary?: string | null;
  source: string;
}

export interface DashboardVersionsResponse {
  dashboard_id: string;
  current_version: number;
  versions: DashboardVersionEntry[];
}

export interface DashboardRevertResponse {
  success: boolean;
  dashboard_id: string;
  new_version: number;
  reverted_to: number;
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

  async getDashboardData(conversationId: string, projectId: string, dashboardId?: string, options?: { noCache?: boolean }): Promise<DashboardDataResponse | null> {
    try {
      const base = dashboardId
        ? `/api/v1/conversation/${conversationId}/dashboard?project_id=${projectId}&dashboard_id=${dashboardId}`
        : `/api/v1/conversation/${conversationId}/dashboard?project_id=${projectId}`;
      // Cache-bust on demand (e.g. immediately after an edit) so the browser
      // HTTP cache can never serve the pre-edit dashboard artifact.
      const url = options?.noCache ? `${base}&_t=${Date.now()}` : base;
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
    options?: { editSummary?: string; expectedVersion?: number },
  ): Promise<{ success: boolean; error?: string; conflict?: boolean }> {
    try {
      const body: Record<string, unknown> = { project_id: projectId, dashboard_data: dashboardData };
      // Backward-compatible: only send the new fields when provided. Older
      // callers (layout auto-save) omit them and the backend ignores absence.
      if (options?.editSummary != null) body.edit_summary = options.editSummary;
      if (options?.expectedVersion != null) body.expected_version = options.expectedVersion;
      const response = await api.put<{ success: boolean }>(
        `/api/v1/conversation/${conversationId}/dashboard/${dashboardId}/data`,
        body,
      );
      if (response.success && response.data) return { success: true };
      const conflict = !!response.error && response.error.includes('409');
      return { success: false, error: response.error || 'Failed to save dashboard', conflict };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg, conflict: msg.includes('409') };
    }
  }

  async getDashboardVersions(
    conversationId: string,
    dashboardId: string,
    projectId: string,
  ): Promise<DashboardVersionsResponse> {
    const response = await api.get<DashboardVersionsResponse>(
      `/api/v1/conversation/${conversationId}/dashboard/${dashboardId}/versions?project_id=${encodeURIComponent(projectId)}`,
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to load dashboard versions');
  }

  async getDashboardVersion(
    conversationId: string,
    dashboardId: string,
    projectId: string,
    version: number,
  ): Promise<DashboardDataResponse> {
    const response = await api.get<DashboardDataResponse>(
      `/api/v1/conversation/${conversationId}/dashboard/${dashboardId}/versions/${version}?project_id=${encodeURIComponent(projectId)}`,
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to load dashboard version');
  }

  async revertDashboard(
    conversationId: string,
    dashboardId: string,
    projectId: string,
    targetVersion: number,
  ): Promise<DashboardRevertResponse> {
    const response = await api.post<DashboardRevertResponse>(
      `/api/v1/conversation/${conversationId}/dashboard/${dashboardId}/revert`,
      { project_id: projectId, target_version: targetVersion },
    );
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to revert dashboard');
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
