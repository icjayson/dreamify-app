/**
 * Analytics types for file upload and processing
 */

export interface UploadResponse {
  success: boolean;
  data?: ProcessedFileData;
  error?: string;
  message?: string;
}

export interface ProcessedFileData {
  filename: string;
  metadata: {
    encoding: string;
    separator: string;
    rows_processed: number;
    columns_processed: number;
    cleaning_applied: string[];
    processing_time: number;
  };
  column_analysis: Record<string, any>;
  data_quality: Record<string, any>;
  visualization_suggestions: Array<{
    type: string;
    title: string;
    columns: string[];
    description: string;
  }>;
  business_insights: Array<{
    type: string;
    value: any;
    description: string;
  }>;
}

export interface FileUploadState {
  isUploading: boolean;
  uploadError: string | null;
  uploadSuccess: boolean;
  processedData: ProcessedFileData | null;
}

export interface FileUploadHook {
  uploadState: FileUploadState;
  uploadCSVFile: (file: File) => Promise<void>;
  uploadExcelFile: (file: File) => Promise<void>;
  resetUploadState: () => void;
}