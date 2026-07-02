import { api } from "@/services/api";

export interface SlackStatusResponse {
  connected: boolean;
  workspace_name?: string;
  platform_workspace_id?: string;
  project_id?: string;
}

export interface TelegramStatusResponse {
  connected: boolean;
  workspace_name?: string;
  platform_workspace_id?: string;
  project_id?: string;
}

export interface TelegramCodeResponse {
  code: string;
  bot_username: string;
  deeplink: string;
  expires_in: number;
}

export interface ZaloStatusResponse {
  connected: boolean;
  workspace_name?: string;
  platform_workspace_id?: string;
  project_id?: string;
}

export interface ZaloCodeResponse {
  code: string;
  bot_username: string;
  bot_id: string;
  qr_url: string;
  expires_in: number;
}

export interface WhatsAppStatusResponse {
  connected: boolean;
  workspace_name?: string;
  platform_workspace_id?: string;
  project_id?: string;
}

export interface WhatsAppCodeResponse {
  code: string;
  bot_username: string;
  phone_number: string;
  deeplink: string;
  qr_url: string;
  expires_in: number;
}

export function resolveChatApiAssetUrl(path: string, baseUrl = api.getBaseUrl()): string {
  if (!path || /^[a-z][a-z\d+\-.]*:/i.test(path) || path.startsWith("//")) {
    return path;
  }

  if (!baseUrl) {
    return path;
  }

  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
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

  async getTelegramStatus(): Promise<TelegramStatusResponse> {
    const res = await api.get<TelegramStatusResponse>("/api/v1/chat/telegram/me");
    if (res.success && res.data) return res.data;
    return { connected: false };
  },

  async generateTelegramCode(): Promise<TelegramCodeResponse> {
    const res = await api.post<TelegramCodeResponse>("/api/v1/chat/telegram/generate-code");
    if (res.success && res.data) return res.data;
    throw new Error(res.error || "Failed to generate Telegram code");
  },

  async disconnectTelegram(platformWorkspaceId: string): Promise<void> {
    await api.delete(`/api/v1/chat/workspaces/${encodeURIComponent(platformWorkspaceId)}`);
  },

  async getZaloStatus(): Promise<ZaloStatusResponse> {
    const res = await api.get<ZaloStatusResponse>("/api/v1/chat/zalo/me");
    if (res.success && res.data) return res.data;
    return { connected: false };
  },

  async generateZaloCode(): Promise<ZaloCodeResponse> {
    const res = await api.post<ZaloCodeResponse>("/api/v1/chat/zalo/generate-code");
    if (res.success && res.data) return res.data;
    throw new Error(res.error || "Failed to generate Zalo code");
  },

  async disconnectZalo(platformWorkspaceId: string): Promise<void> {
    await api.delete(`/api/v1/chat/workspaces/${encodeURIComponent(platformWorkspaceId)}`);
  },

  async getWhatsAppStatus(): Promise<WhatsAppStatusResponse> {
    const res = await api.get<WhatsAppStatusResponse>("/api/v1/chat/whatsapp/me");
    if (res.success && res.data) return res.data;
    return { connected: false };
  },

  async generateWhatsAppCode(): Promise<WhatsAppCodeResponse> {
    const res = await api.post<WhatsAppCodeResponse>("/api/v1/chat/whatsapp/generate-code");
    if (res.success && res.data) return res.data;
    throw new Error(res.error || "Failed to generate WhatsApp code");
  },

  async disconnectWhatsApp(platformWorkspaceId: string): Promise<void> {
    await api.delete(`/api/v1/chat/workspaces/${encodeURIComponent(platformWorkspaceId)}`);
  },
};
