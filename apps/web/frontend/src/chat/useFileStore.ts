import { create } from 'zustand';
import { fileService, type UploadResponse } from '@/services/fileService';
import { processingService, type ProcessingResponse } from '@/services/processingService';

interface FileUploadState {
  isUploading: boolean;
  uploadError: string | null;
  uploadSuccess: boolean;
  processedData: any;
}

interface UploadedFile {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error' | 'accepted';
  processedData?: any;
}

interface FileState {
  // File upload state
  uploadState: FileUploadState;
  
  // CSV attachment state
  attachedCsvName: string | null;
  attachedCsvSummary: string | null;
  attachedCsvRaw: string | null;
  
  // Actions
  setUploadState: (state: Partial<FileUploadState>) => void;
  setAttachedCsvName: (name: string | null) => void;
  setAttachedCsvSummary: (summary: string | null) => void;
  setAttachedCsvRaw: (raw: string | null) => void;
  
  // File operations
  uploadFile: (file: File) => Promise<void>;
  removeFile: (fileID: string) => Promise<void>;
  processFile: (fileID: string) => Promise<void>;
  clearAttachment: () => void;
  
  // CSV parsing
  parseCsvToSummary: (file: File) => Promise<string>;
  readCsvRawPreview: (file: File) => Promise<string>;
  
  // Validation
  validateClientFile: (file: File) => string | null;
  
  // Reset
  resetFileState: () => void;
}

const initialUploadState: FileUploadState = {
  isUploading: false,
  uploadError: null,
  uploadSuccess: false,
  processedData: null,
};

export const useFileStore = create<FileState>((set, get) => ({
  // Initial state
  uploadState: initialUploadState,
  attachedCsvName: null,
  attachedCsvSummary: null,
  attachedCsvRaw: null,
  
  // Basic setters
  setUploadState: (newState) => set((state) => ({
    uploadState: { ...state.uploadState, ...newState }
  })),
  setAttachedCsvName: (name) => set({ attachedCsvName: name }),
  setAttachedCsvSummary: (summary) => set({ attachedCsvSummary: summary }),
  setAttachedCsvRaw: (raw) => set({ attachedCsvRaw: raw }),
  
  // File operations
  uploadFile: async (file: File) => {
    const validationError = get().validateClientFile(file);
    if (validationError) {
      set((state) => ({
        uploadState: {
          ...state.uploadState,
          uploadError: validationError,
          isUploading: false
        }
      }));
      return;
    }
    
    set((state) => ({
      uploadState: {
        ...state.uploadState,
        isUploading: true,
        uploadError: null,
        uploadSuccess: false
      }
    }));
    
    try {
      const res: UploadResponse = await fileService.uploadFile(file);
      if (!res.success || !res.fileID || !res.ext || res.size === undefined || !res.filename) {
        set((state) => ({
          uploadState: {
            ...state.uploadState,
            isUploading: false,
            uploadError: res.error || 'Upload failed'
          }
        }));
        return;
      }
      
      set((state) => ({
        uploadState: {
          ...state.uploadState,
          isUploading: false,
          uploadSuccess: true,
          processedData: res
        }
      }));
    } catch (error) {
      set((state) => ({
        uploadState: {
          ...state.uploadState,
          isUploading: false,
          uploadError: error instanceof Error ? error.message : 'Upload failed'
        }
      }));
    }
  },
  
  removeFile: async (fileID: string) => {
    try {
      await fileService.deleteFile(fileID);
    } catch (error) {
      // best-effort; ignore
    }
    get().clearAttachment();
  },
  
  processFile: async (fileID: string) => {
    try {
      const assetRes = await fileService.getAsset(fileID);
      if (!assetRes.success || !assetRes.asset) {
        return;
      }
      const projectId = assetRes.asset.project_id;
      const startResult = await processingService.runProcessing(projectId, fileID, 'Analyze this data file');
      if (startResult.success && startResult.data?.status && startResult.data.status !== 'error') {
        const finalResult = await processingService.pollProcessingStatus(
          fileID,
          projectId,
          startResult.data?.conversation_id,
          undefined,
          30,
          1000
        );
        if (finalResult.success && finalResult.data?.status === 'completed') {
          set((state) => ({
            uploadState: {
              ...state.uploadState,
              processedData: finalResult.data?.processed_data || finalResult.data
            }
          }));
        }
      }
    } catch (error) {
      console.error('Processing error:', error);
    }
  },
  
  clearAttachment: () => set({
    attachedCsvName: null,
    attachedCsvSummary: null,
    attachedCsvRaw: null,
  }),
  
  // CSV parsing
  parseCsvToSummary: async (file: File): Promise<string> => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const maxPreviewRows = 20;
    const previewLines = lines.slice(0, maxPreviewRows + 1);
    
    const splitCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let curr = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            curr += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          result.push(curr);
          curr = "";
        } else {
          curr += ch;
        }
      }
      result.push(curr);
      return result.map(s => s.trim());
    };

    const rows = previewLines.map(splitCsvLine);
    const header = rows[0] || [];
    const sampleRows = rows.slice(1);
    const totalRows = lines.length > 0 ? lines.length - 1 : 0;

    const sampleRendered = sampleRows
      .slice(0, maxPreviewRows)
      .map(r => r.join(" | "))
      .join("\n");

    const summary = [
      "[CSV SUMMARY]",
      `File: ${file.name}`,
      `Total rows (excluding header): ${totalRows}`,
      `Columns (${header.length}): ${header.join(", ")}`,
      "Sample (first rows):",
      sampleRendered,
    ].join("\n");

    return summary;
  },
  
  readCsvRawPreview: async (file: File): Promise<string> => {
    const maxChars = 200_000;
    const text = await file.text();
    return text.slice(0, maxChars);
  },
  
  // Validation
  validateClientFile: (file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowed = ["csv","xlsx","xls","json"];
    if (!ext || !allowed.includes(ext)) return "Invalid file type. Supported: CSV, XLSX, XLS, JSON";
    return null;
  },
  
  // Reset
  resetFileState: () => set({
    uploadState: initialUploadState,
    attachedCsvName: null,
    attachedCsvSummary: null,
    attachedCsvRaw: null,
  }),
}));
