import { API_CONFIG, API_ENDPOINTS, HTTP_METHODS, CONTENT_TYPES } from '@/api/config';
import type { UploadResponse } from '@/types/analytics';

import { localDemoAuthHeaders } from './authHeaders';

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorInfo?: ApiError;
  status?: number;
  message?: string;
}

// API Error Types
export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyErrorValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (value === undefined || value === null) return undefined;

  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== '{}' ? serialized : undefined;
  } catch {
    return String(value);
  }
}

function parseApiErrorText(status: number, bodyText: string): ApiError {
  const fallbackMessage = `HTTP error! status: ${status}`;
  if (!bodyText.trim()) return { message: fallbackMessage, status };

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { message: bodyText, status };
  }

  if (!isRecord(body)) {
    return { message: stringifyErrorValue(body) ?? fallbackMessage, status };
  }

  const typedError = body.error;
  if (isRecord(typedError)) {
    const code = typeof typedError.code === 'string' ? typedError.code : undefined;
    const message = stringifyErrorValue(typedError.message) ?? fallbackMessage;
    const details = isRecord(typedError.details) ? typedError.details : undefined;
    return { message, status, code, details };
  }

  const legacyMessage = stringifyErrorValue(body.detail)
    ?? stringifyErrorValue(body.error)
    ?? stringifyErrorValue(body.message)
    ?? fallbackMessage;
  return { message: legacyMessage, status };
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    return parseApiErrorText(response.status, await response.text());
  } catch {
    return { message: `HTTP error! status: ${response.status}`, status: response.status };
  }
}

function failureResponse<T>(errorInfo: ApiError): ApiResponse<T> {
  return {
    success: false,
    error: errorInfo.message,
    errorInfo,
    status: errorInfo.status,
  };
}

async function parseSuccessResponse<T>(response: Response): Promise<ApiResponse<T>> {
  if (response.status === 204 || response.status === 205) {
    return { success: true, status: response.status };
  }

  const bodyText = await response.text();
  if (!bodyText.trim()) return { success: true, status: response.status };

  return {
    success: true,
    data: JSON.parse(bodyText) as T,
    status: response.status,
  };
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

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAuthToken();
    if (token) return { Authorization: `Bearer ${token}` };
    return localDemoAuthHeaders();
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
      config.headers = {
        ...(config.headers as Record<string, string>),
        ...(await this.getAuthHeaders()),
      };
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
        return failureResponse<T>(await parseErrorResponse(response));
      }

      return await parseSuccessResponse<T>(response);
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
        Object.assign(headers, await this.getAuthHeaders());
      } catch {
        // Authentication is optional in the deterministic local preview.
      }

      const response = await fetch(url, {
        method: HTTP_METHODS.POST,
        body: formData,
        headers,
        ...(options || {}),
      });

      if (!response.ok) {
        return failureResponse<T>(await parseErrorResponse(response));
      }

      return await parseSuccessResponse<T>(response);
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
    let demoUserHeader: string | undefined;
    try {
      const authHeaders = await this.getAuthHeaders();
      authHeader = authHeaders.Authorization;
      demoUserHeader = authHeaders['X-Demo-User'];
    } catch {
      // Authentication is optional in the deterministic local preview.
    }

    return new Promise<ApiResponse<T>>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (authHeader) xhr.setRequestHeader('Authorization', authHeader);
      if (demoUserHeader) xhr.setRequestHeader('X-Demo-User', demoUserHeader);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (xhr.status === 204 || xhr.status === 205 || !xhr.responseText.trim()) {
            resolve({ success: true, status: xhr.status });
            return;
          }

          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ success: true, data, status: xhr.status });
          } catch {
            resolve({ success: false, error: 'Invalid JSON response' });
          }
        } else {
          resolve(failureResponse<T>(parseApiErrorText(xhr.status, xhr.responseText)));
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
