import { api } from "@/services/api";

export interface SlackStatusResponse {
  connected: boolean;
  workspace_name?: string;
  platform_workspace_id?: string;
  project_id?: string;
}

export const chatIntegrationApi = {
  async getSlackStatus(): Promise<SlackStatusResponse> {
    const res = await api.get<SlackStatusResponse>("/api/v1/chat/slack/me");
    if (res.success && res.data) return res.data;
    return { connected: false };
  },

  async getSlackAuthUrl(): Promise<string> {
    const res = await api.post<{ url: string }>("/api/v1/chat/slack/auth-url");
    if (res.success && res.data?.url) return res.data.url;
    throw new Error(res.error || "Failed to get Slack auth URL");
  },

  async disconnectSlack(platformWorkspaceId: string): Promise<void> {
    await api.delete(`/api/v1/chat/workspaces/${encodeURIComponent(platformWorkspaceId)}`);
  },
};
