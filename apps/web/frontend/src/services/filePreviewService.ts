// File Preview Service
import { API_CONFIG } from '@/api/config';

export interface FilePreviewData {
  success: boolean;
  filename: string;
  columns: string[];
  rows: string[][];
  total_rows: number;
  displayed_rows: number;
}

export async function getFilePreview(
  assetId: string,
  token?: string
): Promise<FilePreviewData> {
  // Use relative URL so Vite proxy can forward to backend
  const url = token
    ? `/api/v1/files/preview/${assetId}?token=${encodeURIComponent(token)}`
    : `/api/v1/files/preview/${assetId}`;

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

  return await response.json();
}

