import { api } from './api';
import { AssetRecord } from './fileService';

export interface GA4Property {
  property_id: string;
  display_name: string;
}

export interface GA4Account {
  account_id: string;
  account_name: string;
  properties: GA4Property[];
}

export interface GA4PropertiesResponse {
  success: boolean;
  accounts: GA4Account[];
  error?: string;
}

export interface GA4SyncRequest {
  property_id: string;
  project_id?: string;
  start_date?: string;
  end_date?: string;
  account_name?: string;
  property_name?: string;
}

export interface GA4SyncResponse {
  success: boolean;
  message?: string;
  asset?: AssetRecord;
  row_count?: number;
  column_count?: number;
  error?: string;
}

class IntegrationService {
  private baseUrl = '/api/v1/integration';

  async fetchGoogleAnalyticsProperties(): Promise<GA4PropertiesResponse> {
    try {
      const res = await api.get<GA4PropertiesResponse>(`${this.baseUrl}/google/properties`);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, accounts: [], error: res.error || 'Failed to fetch GA4 properties' };
    } catch (error) {
      return { success: false, accounts: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getGoogleOAuthToken(): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const res = await api.get<{ success: boolean; token?: string; error?: string }>(`${this.baseUrl}/google/token`);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to fetch Google token' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncGoogleSheetData(fileId: string, projectId?: string): Promise<GA4SyncResponse> {
    try {
      const payload: { file_id: string; project_id?: string } = {
        file_id: fileId
      };
      if (projectId) {
        payload.project_id = projectId;
      }
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/google-sheets/sync`, payload);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to sync Google Sheet data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async syncGoogleAnalyticsData(
    propertyId: string,
    projectId?: string,
    startDate?: string,
    endDate?: string,
    accountName?: string,
    propertyName?: string
  ): Promise<GA4SyncResponse> {
    try {
      const payload: GA4SyncRequest = {
        property_id: propertyId,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(accountName && { account_name: accountName }),
        ...(propertyName && { property_name: propertyName }),
      };
      const res = await api.post<GA4SyncResponse>(`${this.baseUrl}/google/sync`, payload);
      if (res.success && res.data) {
        return res.data;
      }
      return { success: false, error: res.error || 'Failed to sync GA4 data' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

export const integrationService = new IntegrationService();
