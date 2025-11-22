import { API_CONFIG, API_ENDPOINTS, HTTP_METHODS, CONTENT_TYPES } from '@/api/config';
import type { UploadResponse } from '@/types/analytics';

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// API Error Types
export interface ApiError {
  message: string;
  status: number;
  code?: string;
}

// HTTP Client Class
class ApiClient {
  private baseURL: string;
  private timeout: number;
  private authTokenProvider?: () => Promise<string | null>;

  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
  }

  public setAuthTokenProvider(provider: () => Promise<string | null>) {
    this.authTokenProvider = provider;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultOptions: RequestInit = { headers: { 'Content-Type': CONTENT_TYPES.JSON } };

    // Merge provided options
    const config: RequestInit = { ...defaultOptions, ...options };

    // Attach Authorization if available
    try {
      if (this.authTokenProvider) {
        const token = await this.authTokenProvider();
        if (token) {
          config.headers = {
            ...(config.headers as Record<string, string>),
            Authorization: `Bearer ${token}`,
          };
        }
      }
    } catch (_) {
      // ignore token retrieval errors; request proceeds unauthenticated
    }

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return { success: false, error: errorMessage };
    }
  }

  // GET request
  async get<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: HTTP_METHODS.GET,
      ...options,
    });
  }

  // POST request
  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: HTTP_METHODS.POST,
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  // PUT request
  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: HTTP_METHODS.PUT,
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: HTTP_METHODS.DELETE,
      ...options,
    });
  }

  // File upload
  async uploadFile<T>(
    endpoint: string,
    file: File,
    options?: RequestInit,
    extraFields?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const formData = new FormData();
    formData.append('file', file);
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        formData.append(key, value);
      }
    }

    const url = `${this.baseURL}${endpoint}`;
    
    try {
      const restOptions = { ...(options || {}) };
      const headers: Record<string, string> = {};
      // Attach Authorization if available
      try {
        if (this.authTokenProvider) {
          const token = await this.authTokenProvider();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
      } catch (_) {}

      const response = await fetch(url, {
        method: HTTP_METHODS.POST,
        body: formData,
        headers, // let browser set multipart boundary, we only add Authorization
        ...restOptions,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return { success: false, error: errorMessage };
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export convenience methods
export const api = {
  get: <T>(endpoint: string, options?: RequestInit) => apiClient.get<T>(endpoint, options),
  post: <T>(endpoint: string, data?: any, options?: RequestInit) => apiClient.post<T>(endpoint, data, options),
  put: <T>(endpoint: string, data?: any, options?: RequestInit) => apiClient.put<T>(endpoint, data, options),
  delete: <T>(endpoint: string, options?: RequestInit) => apiClient.delete<T>(endpoint, options),
  uploadFile: <T>(endpoint: string, file: File, options?: RequestInit, extraFields?: Record<string, string>) =>
    apiClient.uploadFile<T>(endpoint, file, options, extraFields),
  uploadAnalyticsFile: (file: File, options?: RequestInit) =>
    apiClient.uploadFile<UploadResponse>('/api/v1/analytics/data', file, options),
};
