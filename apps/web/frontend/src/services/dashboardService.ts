/**
 * Dashboard service for API communication
 */

import { api } from './api';
import {
  DashboardConfiguration,
  DashboardGenerationRequest,
  DashboardGenerationResponse,
  DashboardRefreshRequest,
  DashboardRefreshResponse,
  ChartDataRequest,
  ChartDataResponse
} from '@/types/dashboard';

class DashboardService {
  private baseUrl = '/api/v1/dashboard';

  /**
   * Generate a new dashboard configuration
   */
  async generateDashboard(request: DashboardGenerationRequest): Promise<DashboardGenerationResponse> {
    try {
      const response = await api.post<DashboardGenerationResponse>(
        `${this.baseUrl}/generate`,
        request
      );

      if (response.success && response.data) {
        return response.data;
      } else {
        return {
          success: false,
          error: response.error || 'Failed to generate dashboard'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get dashboard configuration by ID
   */
  async getDashboardConfig(dashboardId: string): Promise<DashboardConfiguration | null> {
    try {
      const response = await api.get<{ dashboard_config: DashboardConfiguration }>(
        `${this.baseUrl}/config/${dashboardId}`
      );

      if (response.success && response.data) {
        return response.data.dashboard_config;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error fetching dashboard config:', error);
      return null;
    }
  }

  /**
   * Refresh dashboard data
   */
  async refreshDashboard(request: DashboardRefreshRequest): Promise<DashboardRefreshResponse> {
    try {
      const response = await api.post<DashboardRefreshResponse>(
        `${this.baseUrl}/refresh`,
        request
      );

      if (response.success && response.data) {
        return response.data;
      } else {
        return {
          success: false,
          error: response.error || 'Failed to refresh dashboard'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get chart data with optional filtering
   */
  async getChartData(request: ChartDataRequest): Promise<ChartDataResponse> {
    try {
      const response = await api.post<ChartDataResponse>(
        `${this.baseUrl}/chart-data`,
        request
      );

      if (response.success && response.data) {
        return response.data;
      } else {
        return {
          success: false,
          error: response.error || 'Failed to get chart data'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * List all available dashboards
   */
  async listDashboards(): Promise<Array<{ id: string; title: string; description?: string; created_at?: string; updated_at?: string; component_count: number }>> {
    try {
      const response = await api.get<{ dashboards: Array<any> }>(
        `${this.baseUrl}/list`
      );

      if (response.success && response.data) {
        return response.data.dashboards;
      } else {
        return [];
      }
    } catch (error) {
      console.error('Error listing dashboards:', error);
      return [];
    }
  }

  /**
   * Delete a dashboard configuration
   */
  async deleteDashboard(dashboardId: string): Promise<boolean> {
    try {
      const response = await api.delete<{ success: boolean }>(
        `${this.baseUrl}/delete/${dashboardId}`
      );

      return response.success && response.data?.success === true;
    } catch (error) {
      console.error('Error deleting dashboard:', error);
      return false;
    }
  }

  /**
   * Cache dashboard configuration locally
   */
  private cacheDashboard(dashboardId: string, config: DashboardConfiguration): void {
    try {
      localStorage.setItem(`dashboard_${dashboardId}`, JSON.stringify({
        config,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn('Failed to cache dashboard:', error);
    }
  }

  /**
   * Get cached dashboard configuration
   */
  private getCachedDashboard(dashboardId: string): DashboardConfiguration | null {
    try {
      const cached = localStorage.getItem(`dashboard_${dashboardId}`);
      if (cached) {
        const { config, timestamp } = JSON.parse(cached);
        // Cache expires after 5 minutes
        if (Date.now() - timestamp < 5 * 60 * 1000) {
          return config;
        }
      }
    } catch (error) {
      console.warn('Failed to get cached dashboard:', error);
    }
    return null;
  }

  /**
   * Get dashboard with caching
   */
  async getDashboardWithCache(dashboardId: string, forceRefresh = false): Promise<DashboardConfiguration | null> {
    // Try cache first if not forcing refresh
    if (!forceRefresh) {
      const cached = this.getCachedDashboard(dashboardId);
      if (cached) {
        return cached;
      }
    }

    // Fetch from API
    const config = await this.getDashboardConfig(dashboardId);
    if (config) {
      this.cacheDashboard(dashboardId, config);
    }
    return config;
  }
}

// Export singleton instance
export const dashboardService = new DashboardService();
