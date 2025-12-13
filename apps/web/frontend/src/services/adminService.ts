import { api } from './api';
import { API_ENDPOINTS } from '@/api/config';

export interface ConversationListItem {
  conversation_id: string;
  project_id: string;
  user_id: string;
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

class AdminService {
  private getBasicAuthHeader(username: string, password: string): string {
    const credentials = btoa(`${username}:${password}`);
    return `Basic ${credentials}`;
  }

  private async requestWithAuth<T>(
    endpoint: string,
    options: RequestInit = {},
    username: string,
    password: string
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    const authHeader = this.getBasicAuthHeader(username, password);
    
    const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
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
    username: string,
    password: string,
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
      { method: 'GET' },
      username,
      password
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to list conversations');
  }

  async getConversation(
    username: string,
    password: string,
    conversationId: string,
    projectId: string
  ): Promise<ConversationDetailResponse> {
    const endpoint = `${API_ENDPOINTS.ADMIN_CONVERSATION}/${conversationId}?project_id=${projectId}`;
    const response = await this.requestWithAuth<ConversationDetailResponse>(
      endpoint,
      { method: 'GET' },
      username,
      password
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get conversation');
  }

  async getConversationNodes(
    username: string,
    password: string,
    conversationId: string,
    projectId: string
  ): Promise<NodeListResponse> {
    const endpoint = `${API_ENDPOINTS.ADMIN_CONVERSATION_NODES}/${conversationId}/nodes?project_id=${projectId}`;
    const response = await this.requestWithAuth<NodeListResponse>(
      endpoint,
      { method: 'GET' },
      username,
      password
    );

    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error || 'Failed to get conversation nodes');
  }
}

export const adminService = new AdminService();

