import { api } from './api';
import { upload } from '@vercel/blob/client';

export interface AssetRecord {
  asset_id: string;
  file_id: string;
  project_id: string;
  filename: string;
  extension: string;
  status: string;
  storage_ref?: { provider: 'vercel_blob'; pathname: string };
  size_bytes: number;
  created_at?: string;
  row_count?: number;
  column_count?: number;
  asset_type?: string;
  checksum_sha256?: string;
}

interface UploadIntent {
  id: string;
  intent_id: string;
  client_request_id: string;
  project_id: string;
  pathname: string;
  filename: string;
  content_type: string;
  expected_size_bytes: number;
  max_size_bytes: number;
  asset_type: string;
  status: string;
  asset_id?: string | null;
  upload: {
    kind: 'local_proxy' | 'vercel_client_upload';
    method: 'PUT' | 'POST';
    url: string;
    pathname: string;
    headers: Record<string, string>;
  };
}

interface FreshAsset {
  id: string;
  project_id: string;
  filename: string;
  asset_type: string;
  content_type: string;
  size_bytes: number;
  status: string;
  created_at?: string;
  storage_ref?: { provider: 'vercel_blob'; pathname: string };
}

const contentTypeFor = (file: File) => {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return 'text/csv';
  if (extension === 'json') return 'application/json';
  if (extension === 'xls') return 'application/vnd.ms-excel';
  if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
};

const sha256 = async (file: File) => {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

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

export interface AddAssetsToNewProjectResponse {
  success: boolean;
  project?: {
    id: string;
    name?: string;
  };
  assets: AssetRecord[];
  error?: string;
}

export interface AddAssetsToProjectResponse {
  success: boolean;
  project?: {
    id: string;
    name?: string;
  };
  assets: AssetRecord[];
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

  private normalizeFreshAsset(asset: FreshAsset, intent: UploadIntent): AssetRecord {
    return {
      asset_id: asset.id,
      file_id: asset.id,
      project_id: asset.project_id,
      filename: asset.filename,
      extension: asset.filename.split('.').pop()?.toLowerCase() || '',
      asset_type: asset.asset_type,
      size_bytes: asset.size_bytes,
      status: asset.status,
      created_at: asset.created_at,
      storage_ref: asset.storage_ref ?? { provider: 'vercel_blob', pathname: intent.pathname },
    };
  }

  async uploadFile(file: File, options?: { projectId?: string; assetType?: string; onProgress?: (percent: number) => void }): Promise<UploadResponse> {
    if (!options?.projectId) return { success: false, error: 'Select or create a project before uploading a file.' };
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) return { success: false, error: 'Files must be between 1 byte and 10 MiB.' };

    try {
      const contentType = contentTypeFor(file);
      const clientRequestId = globalThis.crypto?.randomUUID?.() ?? `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const checksumSha256 = await sha256(file);
      const intentResult = await api.post<UploadIntent>('/api/v1/uploads/intents', {
        project_id: options.projectId,
        filename: file.name,
        content_type: contentType,
        size_bytes: file.size,
        asset_type: 'dataset',
        checksum_sha256: checksumSha256,
        client_request_id: clientRequestId,
      });
      if (!intentResult.success || !intentResult.data) return { success: false, error: intentResult.error || 'Could not reserve upload quota.' };

      const intent = intentResult.data;
      if (intent.upload.kind === 'local_proxy') {
        const localUpload = await api.put<{ id: string; status: string }>(
          intent.upload.url,
          undefined,
          { body: file, headers: intent.upload.headers },
        );
        if (!localUpload.success) {
          return { success: false, error: localUpload.error || 'Local upload failed.' };
        }
        options.onProgress?.(95);
      } else {
        const token = await api.getAuthToken();
        const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
        const demoMode = !clerkKey || !/^pk_(test|live)_/.test(clerkKey);
        await upload(intent.pathname, file, {
          access: 'private',
          handleUploadUrl: '/api/blob/upload',
          contentType,
          multipart: false,
          headers: token ? { Authorization: `Bearer ${token}` } : demoMode ? { 'X-Demo-User': 'demo_user' } : {},
          clientPayload: JSON.stringify({
            intent_id: intent.intent_id,
            client_request_id: intent.client_request_id,
            content_type: contentType,
            size_bytes: file.size,
            checksum_sha256: checksumSha256,
          }),
          onUploadProgress: ({ percentage }) => options.onProgress?.(Math.min(Math.round(percentage), 95)),
        });
      }

      const finalized = await api.post<FreshAsset>(`/api/v1/uploads/intents/${intent.intent_id}/finalize`);
      if (!finalized.success || !finalized.data) return { success: false, error: finalized.error || 'Upload completed but asset finalization failed.' };
      options.onProgress?.(100);
      return this.mapAssetToUploadResponse(this.normalizeFreshAsset(finalized.data, intent));
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Upload failed' };
    }
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

  async addAssetsToNewProject(assetIds: string[], projectName?: string): Promise<AddAssetsToNewProjectResponse> {
    const res = await api.post<{
      success: boolean;
      project: { id: string; name?: string };
      assets: AssetRecord[];
    }>(`${this.baseUrl}/add-to-new-project`, {
      asset_ids: assetIds,
      project_name: projectName,
    });
    if (res.success && res.data) {
      return {
        success: true,
        project: res.data.project,
        assets: res.data.assets || [],
      };
    }
    return { success: false, assets: [], error: res.error || 'Failed to add files to a new project' };
  }

  async addAssetsToProject(assetIds: string[], projectId: string): Promise<AddAssetsToProjectResponse> {
    const res = await api.post<{
      success: boolean;
      project: { id: string; name?: string };
      assets: AssetRecord[];
    }>(`${this.baseUrl}/add-to-project`, {
      asset_ids: assetIds,
      project_id: projectId,
    });
    if (res.success && res.data) {
      return {
        success: true,
        project: res.data.project,
        assets: res.data.assets || [],
      };
    }
    return { success: false, assets: [], error: res.error || 'Failed to add files to the project' };
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
