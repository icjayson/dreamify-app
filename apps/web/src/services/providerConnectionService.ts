import { api } from "@/services/api";

export type ModelProvider = "openai" | "gemini";

export interface ProviderConnection {
  provider: ModelProvider;
  model: string;
  status: "verified";
  is_active: boolean;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderConnectionStatus {
  model_mode: "demo" | "byok";
  active_provider: ModelProvider | null;
  byok_configurable: boolean;
  available_providers: ModelProvider[];
  connections: ProviderConnection[];
}

function responseValue<T>(
  response: Awaited<ReturnType<typeof api.get<T>>>,
  fallback: string,
): T {
  if (response.success && response.data) return response.data;
  throw new Error(response.errorInfo?.message ?? fallback);
}

export const providerConnectionService = {
  async list(): Promise<ProviderConnectionStatus> {
    return responseValue(
      await api.get<ProviderConnectionStatus>("/api/v1/provider-connections"),
      "Model provider settings are unavailable",
    );
  },

  async configure(
    provider: ModelProvider,
    apiKey: string,
    model: string,
  ): Promise<ProviderConnection> {
    return responseValue(
      await api.put<ProviderConnection>(`/api/v1/provider-connections/${provider}`, {
        api_key: apiKey,
        model,
        activate: true,
      }),
      "The model provider could not be configured",
    );
  },

  async activate(provider: ModelProvider): Promise<ProviderConnection> {
    return responseValue(
      await api.post<ProviderConnection>(
        `/api/v1/provider-connections/${provider}/activate`,
      ),
      "The model provider could not be activated",
    );
  },

  async verify(provider: ModelProvider): Promise<ProviderConnection> {
    return responseValue(
      await api.post<ProviderConnection>(
        `/api/v1/provider-connections/${provider}/verify`,
      ),
      "The model provider could not be verified",
    );
  },

  async remove(provider: ModelProvider): Promise<void> {
    const response = await api.delete<void>(
      `/api/v1/provider-connections/${provider}`,
    );
    if (!response.success) {
      throw new Error(
        response.errorInfo?.message ?? "The model provider could not be removed",
      );
    }
  },
};
