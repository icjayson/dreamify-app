import { api } from './api';

export interface AssetRecord {
  asset_id: string;
  file_id: string;
  project_id: string;
  filename: string;
  extension: string;
  status: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  processed_json_s3_key?: string;
  created_at?: string;
  row_count?: number;
  column_count?: number;
  asset_type?: string;
  checksum_sha256?: string;
}

export interface UploadResponse {
  success: boolean;
  fileID?: string;
  filename?: string;
  size?: number;
  ext?: string;
  projectId?: string;
  asset?: AssetRecord;
  error?: string;
  rowCount?: number;
  columnCount?: number;
}

export interface FilesListResponse {
  success: boolean;
  files: FileItem[];
  error?: string;
}

export interface FileItem {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  created_at: string;
  checksum_sha256?: string;
  asset?: AssetRecord;
}

export interface DeleteResponse {
  success: boolean;
  error?: string;
}

class FileService {
  private baseUrl = '/api/v1/user/asset';

  private mapAssetToUploadResponse(asset: AssetRecord): UploadResponse {
    return {
      success: true,
      fileID: asset.asset_id,
      filename: asset.filename,
      size: asset.size_bytes,
      ext: asset.extension,
      projectId: asset.project_id,
      asset,
      rowCount: asset.row_count,
      columnCount: asset.column_count,
    };
  }

  async uploadFile(file: File, options?: { projectId?: string; assetType?: string; onProgress?: (percent: number) => void }): Promise<UploadResponse> {
    const extraFields: Record<string, string> = {
      asset_type: options?.assetType || 'raw',
    };
    if (options?.projectId) {
      extraFields.project_id = options.projectId;
    }

    const res = await api.uploadFile<AssetRecord>(`${this.baseUrl}/upload`, file, undefined, extraFields, options?.onProgress);
    if (res.success && res.data) {
      const asset = res.data as AssetRecord;
      return this.mapAssetToUploadResponse(asset);
    }
    return { success: false, error: res.error || 'Upload failed' };
  }

  async listFiles(): Promise<FilesListResponse> {
    const res = await api.get<{ assets: AssetRecord[] }>(`${this.baseUrl}/list`);
    if (res.success && res.data) {
      const files = (res.data.assets || []).map<FileItem>((asset) => ({
        fileID: asset.asset_id,
        filename: asset.filename,
        size: asset.size_bytes,
        ext: asset.extension,
        created_at: asset.created_at || '',
        checksum_sha256: asset.checksum_sha256,
        asset,
      }));
      return { success: true, files };
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

  async getFilePreview(fileID: string, limit = 100): Promise<{
    success: boolean;
    filename?: string;
    columns?: string[];
    rows?: any[][];
    total_rows?: number;
    displayed_rows?: number;
    source_type?: string;
    error?: string;
  }> {
    const res = await api.get<{
      success: boolean;
      filename: string;
      columns: string[];
      rows: any[][];
      total_rows: number;
      displayed_rows: number;
      source_type?: string;
    }>(`/api/v1/files/preview/${fileID}?limit=${limit}`);
    if (res.success && res.data) return res.data;
    return { success: false, error: res.error || 'Failed to load preview' };
  }

  async getDownloadUrl(fileID: string): Promise<{ url?: string; filename?: string; error?: string }> {
    const res = await api.get<{ success: boolean; url: string; filename: string }>(
      `${this.baseUrl}/${fileID}/download-url`
    );
    if (res.success && res.data) {
      return { url: res.data.url, filename: res.data.filename };
    }
    return { error: res.error || 'Failed to get download URL' };
  }

  async getAsset(fileID: string): Promise<UploadResponse> {
    const res = await api.get<AssetRecord>(`${this.baseUrl}/${fileID}`);
    if (res.success && res.data) {
      const asset = res.data as AssetRecord;
      return this.mapAssetToUploadResponse(asset);
    }
    return { success: false, error: res.error || 'Failed to fetch asset' };
  }

  async getProcessedData(fileID: string): Promise<any> {
    const res = await api.get<{ success: boolean; data: any }>(`${this.baseUrl}/${fileID}/processed`);
    if (res.success && res.data) {
      return res.data.data;
    }
    throw new Error(res.error || 'Processed data unavailable');
  }
}

export const fileService = new FileService();
