import { api } from './api';

export interface ProcessingResponse {
  success: boolean;
  fileID: string;
  status: 'not_processed' | 'processing' | 'completed' | 'error';
  data?: any;
  message?: string;
  error?: string;
}

export interface ProcessedData {
  fileID: string;
  status: string;
  processed_at: string;
  source_file: string;
  file_size: number;
  file_type: string;
  metrics: Array<{
    id: string;
    title: string;
    value: string;
    change: string;
    trend: string;
  }>;
  charts: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    datasets: any[];
    config: any;
  }>;
  tables: Array<{
    id: string;
    title: string;
    description: string;
    columns: any[];
    data: any[];
  }>;
  insights: string[];
  data_quality: {
    total_records: number;
    completeness: number;
    accuracy: number;
    consistency: number;
    duplicates: number;
  };
}

class ProcessingService {
  private baseUrl = '/api/v1/analyze';

  /**
   * Start processing analysis for a file
   */
  async runProcessing(fileID: string): Promise<ProcessingResponse> {
    try {
      const response = await api.post<ProcessingResponse>(
        `${this.baseUrl}/run`,
        { fileID }
      );

      if (response.success && response.data) {
        return response.data as ProcessingResponse;
      } else {
        return {
          success: false,
          fileID,
          status: 'error',
          error: response.error || 'Failed to start processing'
        };
      }
    } catch (error) {
      return {
        success: false,
        fileID,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get processing status and results
   */
  async getProcessed(fileID: string): Promise<ProcessingResponse> {
    try {
      const response = await api.post<ProcessingResponse>(
        `${this.baseUrl}/status`,
        { fileID }
      );

      if (response.success && response.data) {
        return response.data as ProcessingResponse;
      } else {
        return {
          success: false,
          fileID,
          status: 'error',
          error: response.error || 'Failed to get processing status'
        };
      }
    } catch (error) {
      return {
        success: false,
        fileID,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Poll processing status until completion
   */
  async pollProcessingStatus(
    fileID: string,
    onStatusUpdate?: (status: ProcessingResponse) => void,
    maxAttempts: number = 30,
    intervalMs: number = 5000
  ): Promise<ProcessingResponse> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const status = await this.getProcessed(fileID);
      
      if (onStatusUpdate) {
        onStatusUpdate(status);
      }
      
      if (status.status === 'completed' || status.status === 'error') {
        return status;
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    }
    
    return {
      success: false,
      fileID,
      status: 'error',
      error: 'Processing timeout - maximum attempts reached'
    };
  }
}

// Export singleton instance
export const processingService = new ProcessingService();
