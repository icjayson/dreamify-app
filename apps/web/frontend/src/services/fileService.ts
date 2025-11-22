import { api } from './api';

export interface AssetRecord {
  asset_id: string;
  file_id: string;
  project_id: string;
  filename: string;
  extension: string;
  type: string;
  status: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  processed_json_s3_key?: string;
  created_at?: string;
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
    };
  }

  async uploadFile(file: File, options?: { projectId?: string; assetType?: string }): Promise<UploadResponse> {
    const extraFields: Record<string, string> = {
      asset_type: options?.assetType || 'raw',
    };
    if (options?.projectId) {
      extraFields.project_id = options.projectId;
    }

    const res = await api.uploadFile<AssetRecord>(`${this.baseUrl}/upload`, file, undefined, extraFields);
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
