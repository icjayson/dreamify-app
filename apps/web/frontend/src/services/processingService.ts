import { api } from './api';

export interface ProcessingResponse {
  success: boolean;
  data?: {
    success: boolean;
    status: 'not_processed' | 'processing' | 'completed' | 'error';
    fileID: string;
    message?: string;
    error?: string;
    [key: string]: any;
  };
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
  styling_recommendations?: {
    preset_theme: string;
    color_palette: string[];
    animation_enabled: boolean;
    grid_visible: boolean;
    legend_position: string;
    data_context?: string;
    audience?: string;
    reasoning?: {
      context: string;
      audience: string;
      theme: string;
    };
  };
}

class ProcessingService {
  private baseUrl = '/api/v1/analyze';

  /**
   * Start processing analysis for a file
   */
  async runProcessing(fileID: string): Promise<ProcessingResponse> {
    try {
      console.log('ProcessingService: Calling /run endpoint for fileID:', fileID);
      const response = await api.post<ProcessingResponse>(
        `${this.baseUrl}/run`,
        { fileID }
      );
      console.log('ProcessingService: /run response:', response);

      if (response.success && response.data) {
        // The response.data contains the ProcessingResponse
        const processingResponse = response.data;
        console.log('ProcessingService: Parsed processing response:', processingResponse);
        
        // Ensure required fields are present
        if (processingResponse.data?.fileID && processingResponse.success) {
          return processingResponse;
        } else {
          console.error('ProcessingService: Invalid response structure:', processingResponse);
          return {
            success: false,
            data: {
              success: false,
              status: 'error',
              fileID,
              error: 'Invalid response structure from server'
            }
          };
        }
      } else {
        console.error('ProcessingService: /run failed:', response);
        return {
          success: false,
          data: { 
            success: false,
            status: 'error',
            fileID,
            error: response.error || 'Failed to start processing'
          }
        };
      }
    } catch (error) {
      console.error('ProcessingService: /run exception:', error);
      return {
        success: false,
        data: {
          success: false,
          status: 'error',
          fileID,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
  }

  /**
   * Get processing status and results
   */
  async getProcessed(fileID: string): Promise<ProcessingResponse> {
    try {
      console.log('ProcessingService: Calling /status endpoint for fileID:', fileID);
      const response = await api.post<ProcessingResponse>(
        `${this.baseUrl}/status`,
        { fileID }
      );
      console.log('ProcessingService: /status response:', response);

      if (response.success && response.data) {
        // The response.data contains the ProcessingResponse
        const processingResponse = response.data;
        console.log('ProcessingService: Parsed status response:', processingResponse);
        
        // Ensure required fields are present
        if (processingResponse.data?.fileID && processingResponse.success) {
          return processingResponse;
        } else {
          console.error('ProcessingService: Invalid status response structure:', processingResponse);
          return {
            success: false,
            data: {
              success: false,
              status: 'error',
              fileID,
              error: 'Invalid response structure from server'
            }
          };
        }
      } else {
        console.error('ProcessingService: /status failed:', response);
        return {
          success: false,
          data: {
            success: false,
            status: 'error',
            fileID,
            error: response.error || 'Failed to get processing status'
          }
        };
      }
    } catch (error) {
      console.error('ProcessingService: /status exception:', error);
      return {
        success: false,
        data: {
          success: false,
          status: 'error',
          fileID,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        }
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
      try {
        const status = await this.getProcessed(fileID);
        
        if (onStatusUpdate) {
          onStatusUpdate(status);
        }
        
        // Check if processing is complete or failed
        if (status.success && status.data?.status === 'completed' || status.data?.status === 'error') {
          return status;
        }
        
        // Validate that we have a valid status response
        if (!status.data?.success && status.data?.error) {
          console.warn(`Processing error for fileID ${fileID}:`, status.data.error);
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        attempts++;
      } catch (error) {
        console.error(`Error during polling attempt ${attempts + 1} for fileID ${fileID}:`, error);
        
        // If we get multiple consecutive errors, fail early
        if (attempts >= 3) {
          return {
            success: false,
            data: {
              success: false,
              status: 'error',
              fileID,
              error: `Polling failed after ${attempts + 1} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          };
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        attempts++;
      }
    }
    
    return {
      success: false,
      data: {
        success: false,
        status: 'error',
        fileID,
        error: 'Processing timeout - maximum attempts reached'
      }
    };
  }
}

// Export singleton instance
export const processingService = new ProcessingService();
