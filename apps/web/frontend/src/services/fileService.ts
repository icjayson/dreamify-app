import { api } from './api';

export interface UploadResponse {
  success: boolean;
  fileID?: string;
  filename?: string;
  size?: number;
  ext?: string;
  error?: string;
}

export interface FileItem {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  created_at: string;
}

export interface FilesListResponse {
  success: boolean;
  files: FileItem[];
  error?: string;
}

export interface DeleteResponse {
  success: boolean;
  error?: string;
}

class FileService {
  private baseUrl = '/api/v1/files';

  async uploadFile(file: File): Promise<UploadResponse> {
    const res = await api.uploadFile<UploadResponse>(`${this.baseUrl}/upload`, file);
    if (res.success && res.data) {
      return res.data as unknown as UploadResponse;
    }
    return { success: false, error: res.error || 'Upload failed' };
  }

  async listFiles(): Promise<FilesListResponse> {
    const res = await api.get<FilesListResponse>(`${this.baseUrl}`);
    if (res.success && res.data) {
      return res.data as FilesListResponse;
    }
    return { success: false, files: [], error: res.error || 'Failed to list files' };
  }

  async deleteFile(fileID: string): Promise<DeleteResponse> {
    const res = await api.delete<DeleteResponse>(`${this.baseUrl}/${fileID}`);
    if (res.success && res.data) {
      return res.data as DeleteResponse;
    }
    return { success: false, error: res.error || 'Failed to delete file' };
  }
}

export const fileService = new FileService();


