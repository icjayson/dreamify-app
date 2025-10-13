import { api } from './api';

export interface ResultResponse {
  success: boolean;
  data?: any;
  error?: string;
}

class ResultService {
  private baseUrl = '/api/v1/analyze';

  async getResultByExecutionId(executionId: string): Promise<ResultResponse> {
    try {
      const response = await api.get<ResultResponse>(`${this.baseUrl}/result?execution_id=${encodeURIComponent(executionId)}`);
      if (response.success) {
        return response.data as unknown as ResultResponse;
      }
      return { success: false, error: response.error || 'Unknown error' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

export const resultService = new ResultService();


