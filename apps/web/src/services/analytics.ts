import { api } from './api';
import { API_ENDPOINTS } from '@/api/config';

// Analytics Data Types
export interface AnalyticsData {
  summary: AnalyticsSummary;
  charts: ChartData[];
  metrics: MetricData[];
}

export interface AnalyticsSummary {
  totalRecords: number;
  totalRevenue: number;
  averageOrderValue: number;
  topProduct: string;
  topCategory: string;
}

export interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'area';
  title: string;
  data: any[];
  config?: any;
}

export interface MetricData {
  label: string;
  value: number;
  change: number;
  trend: 'up' | 'down' | 'stable';
}

export interface FileUploadResponse {
  success: boolean;
  message: string;
  data?: {
    filename: string;
    records: number;
    columns: string[];
  };
}

// Analytics Service Class
class AnalyticsService {
  // Upload file for analysis
  async uploadFile(file: File): Promise<FileUploadResponse> {
    const response = await api.uploadFile<FileUploadResponse>(
      API_ENDPOINTS.UPLOAD_FILE,
      file
    );
    return response.data || { success: false, message: 'Upload failed' };
  }

  // Get analytics summary
  async getAnalyticsSummary(): Promise<AnalyticsSummary> {
    const response = await api.get<AnalyticsSummary>(API_ENDPOINTS.ANALYTICS_SUMMARY);
    return response.data || {
      totalRecords: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
      topProduct: '',
      topCategory: '',
    };
  }

  // Get chart data
  async getChartData(): Promise<ChartData[]> {
    const response = await api.get<ChartData[]>(API_ENDPOINTS.ANALYTICS_CHARTS);
    return response.data || [];
  }

  // Get full analytics data
  async getAnalyticsData(): Promise<AnalyticsData> {
    const [summaryResponse, chartsResponse] = await Promise.all([
      this.getAnalyticsSummary(),
      this.getChartData(),
    ]);

    return {
      summary: summaryResponse,
      charts: chartsResponse,
      metrics: this.generateMetrics(summaryResponse),
    };
  }

  // Generate metrics from summary data
  private generateMetrics(summary: AnalyticsSummary): MetricData[] {
    return [
      {
        label: 'Total Records',
        value: summary.totalRecords,
        change: 12.5,
        trend: 'up',
      },
      {
        label: 'Total Revenue',
        value: summary.totalRevenue,
        change: 8.2,
        trend: 'up',
      },
      {
        label: 'Average Order Value',
        value: summary.averageOrderValue,
        change: -2.1,
        trend: 'down',
      },
    ];
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    const response = await api.get<{ status: string }>(API_ENDPOINTS.HEALTH);
    return response.success && response.data?.status === 'healthy';
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();
