import { api } from './api';

export interface AllowedUser {
  user_id?: string;  // undefined for email-only (pending) invites
  email?: string;
  name?: string;
  image_url?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  latest_conversation_id?: string | null;
  latest_dashboard_id?: string | null;
  dashboard_title?: string | null;
  name_source?: string | null;
  dashboard_preview_key?: string | null;
  is_preview_public?: boolean;
  allowed?: AllowedUser[];
  source_type?: string | null;
}

export interface ProjectResponse {
  success: boolean;
  project?: ProjectRecord;
  error?: string;
}

export interface ProjectListResponse {
  success: boolean;
  projects: ProjectRecord[];
  error?: string;
}

const getErrorMessage = (error: unknown, fallback: string) => (
  error instanceof Error ? error.message : fallback
);

class ProjectService {
  private baseUrl = '/api/v1/user/project';

  async createProject(name: string, description?: string): Promise<ProjectResponse> {
    const res = await api.post<ProjectRecord>(`${this.baseUrl}/create`, {
      name,
      description,
    });
    if (res.success && res.data) {
      return { success: true, project: res.data };
    }
    return { success: false, error: res.error || 'Failed to create project' };
  }

  async listProjects(): Promise<ProjectListResponse> {
    const res = await api.get<{ projects: ProjectRecord[] }>(`${this.baseUrl}/list`);
    if (res.success && res.data) {
      return { success: true, projects: res.data.projects || [] };
    }
    return { success: false, projects: [], error: res.error || 'Failed to list projects' };
  }

  async listRecentProjects(limit = 10): Promise<ProjectListResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await api.get<{ projects: ProjectRecord[] }>(`${this.baseUrl}/recent?${params.toString()}`);
    if (res.success && res.data) {
      return { success: true, projects: res.data.projects || [] };
    }
    return { success: false, projects: [], error: res.error || 'Failed to list recent projects' };
  }

  async getProject(projectId: string): Promise<ProjectResponse> {
    const res = await api.get<ProjectRecord>(`${this.baseUrl}/detail/${projectId}`);
    if (res.success && res.data) {
      return { success: true, project: res.data };
    }
    return { success: false, error: res.error || 'Failed to load project' };
  }

  async updateProject(projectId: string, name?: string, description?: string, is_preview_public?: boolean, allowed?: AllowedUser[]): Promise<ProjectResponse> {
    const res = await api.put<ProjectRecord>(`${this.baseUrl}/${projectId}`, {
      name,
      description,
      is_preview_public,
      allowed,
    });
    if (res.success && res.data) {
      return { success: true, project: res.data };
    }
    return { success: false, error: res.error || 'Failed to update project' };
  }

  async deleteProject(projectId: string): Promise<{ success: boolean; error?: string }> {
    const res = await api.delete<{ success: boolean }>(`${this.baseUrl}/${projectId}`);
    if (res.success && res.data) {
      return { success: true };
    }
    return { success: false, error: res.error || 'Failed to delete project' };
  }

  async uploadDashboardPreview(
    projectId: string,
    dashboardId: string,
    previewBlob: Blob,
  ): Promise<{ success: boolean; s3_key?: string; error?: string }> {
    try {
      const formData = new FormData();
      formData.append('dashboard_id', dashboardId);
      formData.append('file', previewBlob, 'dashboard_preview.webp');

      const res = await api.postFormData<{ success: boolean; s3_key?: string }>(
        `${this.baseUrl}/${projectId}/dashboard-preview`,
        formData,
      );
      if (res.success && res.data) {
        return { success: true, s3_key: res.data.s3_key };
      }
      return { success: false, error: res.error || 'Failed to upload dashboard preview' };
    } catch (e: unknown) {
      return { success: false, error: getErrorMessage(e, 'Upload failed') };
    }
  }

  async getDashboardPreviewUrl(
    projectId: string,
  ): Promise<{ url?: string; error?: string }> {
    try {
      const res = await api.get<{ url: string; expires_in: number }>(
        `${this.baseUrl}/${projectId}/dashboard-preview-url`,
      );
      if (res.success && res.data?.url) {
        return { url: res.data.url };
      }
      return { error: 'No preview URL available' };
    } catch (e: unknown) {
      return { error: getErrorMessage(e, 'Failed to get preview URL') };
    }
  }
}

export const projectService = new ProjectService();
