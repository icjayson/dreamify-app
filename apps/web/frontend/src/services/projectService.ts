import { api } from './api';

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  latest_conversation_id?: string | null;
  latest_dashboard_id?: string | null;
  dashboard_title?: string | null;
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

  async getProject(projectId: string): Promise<ProjectResponse> {
    const res = await api.get<ProjectRecord>(`${this.baseUrl}/detail/${projectId}`);
    if (res.success && res.data) {
      return { success: true, project: res.data };
    }
    return { success: false, error: res.error || 'Failed to load project' };
  }

  async updateProject(projectId: string, name?: string, description?: string): Promise<ProjectResponse> {
    const res = await api.put<ProjectRecord>(`${this.baseUrl}/${projectId}`, {
      name,
      description,
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
}

export const projectService = new ProjectService();

