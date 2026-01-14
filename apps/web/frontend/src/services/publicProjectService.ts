// Public Project Service - for accessing projects without authentication
import { API_CONFIG } from '@/api/config';

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
  private baseURL = API_CONFIG.BASE_URL;

  async getPublicProject(projectId: string): Promise<PublicProjectResponse> {
    try {
      const url = `${this.baseURL}/api/v1/public/project/${projectId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, error: 'Project not found' };
        }
        if (response.status === 403) {
          return { success: false, error: 'Project preview is not public' };
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, project: data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load project';
      return { success: false, error: errorMessage };
    }
  }

  async getPublicDashboardData(conversationId: string, projectId: string): Promise<PublicDashboardDataResponse | null> {
    try {
      const url = `${this.baseURL}/api/v1/public/conversation/${conversationId}/dashboard?project_id=${encodeURIComponent(projectId)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        if (response.status === 403) {
          return null;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to get public dashboard data:', error);
      return null;
    }
  }
}

export const publicProjectService = new PublicProjectService();

