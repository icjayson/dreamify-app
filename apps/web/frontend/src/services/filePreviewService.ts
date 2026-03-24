// File Preview Service

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
  options?: { limit?: number }
): Promise<FilePreviewData> {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (options?.limit != null) params.set('limit', String(options.limit));
  const qs = params.toString();
  const path = `/api/v1/files/preview/${assetId}${qs ? `?${qs}` : ''}`;
  const url = `${baseUrl}${path}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Also try to add Authorization header if token is available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('File not found');
    }
    if (response.status === 403) {
      throw new Error('Unauthorized');
    }
    if (response.status === 400) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Invalid file format');
    }
    throw new Error(`Failed to load preview: ${response.statusText}`);
  }

  // Guard against HTML responses (e.g. SPA fallback serving index.html)
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Server returned an unexpected response. Please check the API configuration.');
  }

  return await response.json();
}

