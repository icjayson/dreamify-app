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

  /** Exposes the configured base URL for callers that build raw requests (e.g. SSE streaming). */
  public getBaseUrl(): string {
    return this.baseURL;
  }

  /** Resolves the current auth token, or null if unavailable. Used by raw fetch callers (e.g. SSE). */
  public async getAuthToken(): Promise<string | null> {
    if (!this.authTokenProvider) return null;
    try {
      return await this.authTokenProvider();
    } catch (_) {
      return null;
    }
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

    // Enforce timeout using AbortController
    const timeoutController = new AbortController();
    const existingSignal = config.signal as AbortSignal | undefined;
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeout);

    // Merge with any existing abort signal (e.g. from user-initiated cancellation)
    const mergedSignal = existingSignal
      ? AbortSignal.any([existingSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await fetch(url, { ...config, signal: mergedSignal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData && errorData.detail) {
            errorMessage = typeof errorData.detail === 'string' 
              ? errorData.detail 
              : JSON.stringify(errorData.detail);
          }
        } catch (_) {
          // Fallback to reading text if JSON parse fails
          try {
            const errorText = await response.text();
            if (errorText) errorMessage = errorText;
          } catch (__) {}
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      clearTimeout(timeoutId);
      if (timeoutController.signal.aborted && !(existingSignal?.aborted)) {
        return { success: false, error: `Request timed out after ${this.timeout}ms` };
      }
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

  // PATCH request
  async patch<T>(endpoint: string, data?: any, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
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

  // POST with FormData (multipart — browser sets Content-Type + boundary)
  async postFormData<T>(endpoint: string, formData: FormData, options?: RequestInit): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    try {
      const headers: Record<string, string> = {};
      try {
        if (this.authTokenProvider) {
          const token = await this.authTokenProvider();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
      } catch (_) { }

      const response = await fetch(url, {
        method: HTTP_METHODS.POST,
        body: formData,
        headers,
        ...(options || {}),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData?.detail) {
            errorMessage = typeof errorData.detail === 'string'
              ? errorData.detail
              : JSON.stringify(errorData.detail);
          }
        } catch (_) {
          try { const t = await response.text(); if (t) errorMessage = t; } catch (__) {}
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return { success: false, error: errorMessage };
    }
  }

  // File upload
  async uploadFile<T>(
    endpoint: string,
    file: File,
    options?: RequestInit,
    extraFields?: Record<string, string>,
    onProgress?: (percent: number) => void
  ): Promise<ApiResponse<T>> {
    const formData = new FormData();
    formData.append('file', file);
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        formData.append(key, value);
      }
    }

    const url = `${this.baseURL}${endpoint}`;

    let authHeader: string | undefined;
    try {
      if (this.authTokenProvider) {
        const token = await this.authTokenProvider();
        if (token) authHeader = `Bearer ${token}`;
      }
    } catch (_) { }

    return new Promise<ApiResponse<T>>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (authHeader) xhr.setRequestHeader('Authorization', authHeader);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ success: true, data });
          } catch {
            resolve({ success: false, error: 'Invalid JSON response' });
          }
        } else {
          let errorMessage = `HTTP error! status: ${xhr.status}`;
          try {
            const errorData = JSON.parse(xhr.responseText);
            if (errorData?.detail) {
              errorMessage = typeof errorData.detail === 'string'
                ? errorData.detail
                : JSON.stringify(errorData.detail);
            }
          } catch { }
          resolve({ success: false, error: errorMessage });
        }
      };

      xhr.onerror = () => resolve({ success: false, error: 'Network error' });
      xhr.ontimeout = () => resolve({ success: false, error: 'Request timed out' });
      xhr.send(formData);
    });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export convenience methods
export const api = {
  get: <T>(endpoint: string, options?: RequestInit) => apiClient.get<T>(endpoint, options),
  post: <T>(endpoint: string, data?: any, options?: RequestInit) => apiClient.post<T>(endpoint, data, options),
  put: <T>(endpoint: string, data?: any, options?: RequestInit) => apiClient.put<T>(endpoint, data, options),
  patch: <T>(endpoint: string, data?: any, options?: RequestInit) => apiClient.patch<T>(endpoint, data, options),
  delete: <T>(endpoint: string, options?: RequestInit) => apiClient.delete<T>(endpoint, options),
  getBaseUrl: () => apiClient.getBaseUrl(),
  getAuthToken: () => apiClient.getAuthToken(),
  postFormData: <T>(endpoint: string, formData: FormData, options?: RequestInit) =>
    apiClient.postFormData<T>(endpoint, formData, options),
  uploadFile: <T>(endpoint: string, file: File, options?: RequestInit, extraFields?: Record<string, string>, onProgress?: (percent: number) => void) =>
    apiClient.uploadFile<T>(endpoint, file, options, extraFields, onProgress),
  uploadAnalyticsFile: (file: File, options?: RequestInit) =>
    apiClient.uploadFile<UploadResponse>('/api/v1/analytics/data', file, options),
};
