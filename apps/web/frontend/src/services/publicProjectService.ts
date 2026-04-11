// Public Project Service - for accessing projects with optional authentication
// Uses api.get to automatically attach Bearer token when available
import { api } from './api';

export interface PublicProjectRecord {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  latest_conversation_id?: string | null;
  latest_dashboard_id?: string | null;
  dashboard_title?: string | null;
  is_preview_public?: boolean;
}

export interface PublicProjectResponse {
  success: boolean;
  project?: PublicProjectRecord;
  error?: string;
}

export interface PublicDashboardDataResponse {
  dashboard_id: string | null;
  dashboard_data: Record<string, any> | null;
}

class PublicProjectService {
  private baseUrl = '/api/v1/public';

  async getPublicProject(projectId: string): Promise<PublicProjectResponse> {
    try {
      const res = await api.get<PublicProjectRecord>(`${this.baseUrl}/project/${projectId}`);

      if (res.success && res.data) {
        return { success: true, project: res.data };
      }

      // Map common error messages
      const errorMsg = res.error || 'Failed to load project';
      if (errorMsg.includes('404')) {
        return { success: false, error: 'Project not found' };
      }
      if (errorMsg.includes('403')) {
        return { success: false, error: 'Project preview is not public' };
      }
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load project';
      return { success: false, error: errorMessage };
    }
  }

  async getPublicDashboardData(conversationId: string, projectId: string): Promise<PublicDashboardDataResponse | null> {
    try {
      const res = await api.get<PublicDashboardDataResponse>(
        `${this.baseUrl}/conversation/${conversationId}/dashboard?project_id=${encodeURIComponent(projectId)}`
      );

      if (res.success && res.data) {
        return res.data;
      }

      return null;
    } catch (error) {
      console.error('Failed to get public dashboard data:', error);
      return null;
    }
  }
}

export const publicProjectService = new PublicProjectService();
