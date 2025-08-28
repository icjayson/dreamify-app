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

  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        ...options.headers,
      },
    };

    const config = { ...defaultOptions, ...options };

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
  async uploadFile<T>(endpoint: string, file: File, options?: RequestInit): Promise<ApiResponse<T>> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${this.baseURL}${endpoint}`;
    
    try {
      const { headers, ...restOptions } = options || {};
      const response = await fetch(url, {
        method: HTTP_METHODS.POST,
        body: formData,
        // Don't set Content-Type header for FormData - let browser handle it
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
  uploadFile: <T>(endpoint: string, file: File, options?: RequestInit) => apiClient.uploadFile<T>(endpoint, file, options),
  uploadAnalyticsFile: (file: File, options?: RequestInit) => apiClient.uploadFile<UploadResponse>('/api/v1/analytics/data', file, options),
};
