/**
 * useDashboard - Custom hook for dashboard data management
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  DashboardConfiguration, 
  DashboardGenerationRequest, 
  DashboardRefreshRequest,
  DashboardState,
  DashboardHook 
} from '@/types/dashboard';
import { dashboardService } from '@/services/dashboardService';

export const useDashboard = (initialDashboardId?: string): DashboardHook => {
  const [dashboardState, setDashboardState] = useState<DashboardState>({
    configuration: null,
    loading: false,
    error: null,
    lastUpdated: null
  });

  // Generate dashboard configuration
  const generateDashboard = useCallback(async (request: DashboardGenerationRequest) => {
    setDashboardState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await dashboardService.generateDashboard(request);
      
      if (response.success && response.dashboard_config) {
        setDashboardState({
          configuration: response.dashboard_config,
          loading: false,
          error: null,
          lastUpdated: new Date().toISOString()
        });
      } else {
        setDashboardState(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to generate dashboard'
        }));
      }
    } catch (error) {
      setDashboardState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }));
    }
  }, []);

  // Refresh dashboard data
  const refreshDashboard = useCallback(async (request: DashboardRefreshRequest) => {
    setDashboardState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await dashboardService.refreshDashboard(request);
      
      if (response.success && response.dashboard_config) {
        setDashboardState(prev => ({
          ...prev,
          configuration: response.dashboard_config,
          loading: false,
          error: null,
          lastUpdated: new Date().toISOString()
        }));
      } else {
        setDashboardState(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to refresh dashboard'
        }));
      }
    } catch (error) {
      setDashboardState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }));
    }
  }, []);

  // Update individual component
  const updateComponent = useCallback((componentId: string, config: any) => {
    setDashboardState(prev => {
      if (!prev.configuration) return prev;

      const updatedComponents = prev.configuration.components.map(component => 
        component.id === componentId 
          ? { ...component, component_config: { ...component.component_config, ...config } }
          : component
      );

      return {
        ...prev,
        configuration: {
          ...prev.configuration,
          components: updatedComponents
        }
      };
    });
  }, []);

  // Reset dashboard state
  const resetDashboard = useCallback(() => {
    setDashboardState({
      configuration: null,
      loading: false,
      error: null,
      lastUpdated: null
    });
  }, []);

  // Load initial dashboard if ID provided
  useEffect(() => {
    if (initialDashboardId) {
      refreshDashboard({ 
        dashboard_id: initialDashboardId, 
        force_refresh: false 
      });
    }
  }, [initialDashboardId, refreshDashboard]);

  return {
    dashboardState,
    generateDashboard,
    refreshDashboard,
    updateComponent,
    resetDashboard
  };
};
