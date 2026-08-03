// File Preview Service

import { localDemoAuthHeaders } from './authHeaders';

export interface FilePreviewData {
  success: boolean;
  filename: string;
  columns: string[];
  rows: string[][];
  total_rows: number;
  displayed_rows: number;
  sourceType?: string;
}

export async function getFilePreview(
  assetId: string,
  token?: string,
  options?: { limit?: number; offset?: number }
): Promise<FilePreviewData> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const params = new URLSearchParams();
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.offset != null) params.set('offset', String(options.offset));
  const qs = params.toString();
  const path = `/api/v1/files/preview/${assetId}${qs ? `?${qs}` : ''}`;
  const url = `${baseUrl}${path}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Also try to add Authorization header if token is available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else Object.assign(headers, localDemoAuthHeaders());

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData?.error?.message || errorData?.detail;
    if (typeof message === 'string' && message) throw new Error(message);
    if (response.status === 404) throw new Error('File not found');
    if (response.status === 401 || response.status === 403) throw new Error('Unauthorized');
    throw new Error(`Failed to load preview: ${response.statusText}`);
  }

  // Guard against HTML responses (e.g. SPA fallback serving index.html)
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Server returned an unexpected response. Please check the API configuration.');
  }

  const payload = await response.json();
  return {
    ...payload,
    sourceType: payload.source_type,
  };
}
