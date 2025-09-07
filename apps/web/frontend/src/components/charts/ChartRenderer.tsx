/**
 * ChartRenderer - Component for rendering charts based on configuration
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { 
  ChartType, 
  ChartConfiguration, 
  MetricConfiguration, 
  TableConfiguration,
  DashboardComponent 
} from '@/types/dashboard';
import { createChart, validateChartConfig } from './ChartFactory';
import ErrorBoundary from '@/components/charts/ErrorBoundary';

interface ChartRendererProps {
  component: DashboardComponent;
  className?: string;
  style?: React.CSSProperties;
  onError?: (error: Error, component: DashboardComponent) => void;
  onRefresh?: (componentId: string) => Promise<void>;
  showRefreshButton?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface ChartRendererState {
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  retryCount: number;
}

const ChartRenderer: React.FC<ChartRendererProps> = ({
  component,
  className = '',
  style = {},
  onError,
  onRefresh,
  showRefreshButton = true,
  autoRefresh = false,
  refreshInterval = 30000 // 30 seconds
}) => {
  const [state, setState] = useState<ChartRendererState>({
    loading: false,
    error: null,
    lastUpdated: null,
    retryCount: 0
  });

  // Validate component configuration
  const validation = useMemo(() => {
    if (!component.component_config) {
      return { isValid: false, errors: ['Component configuration is missing'] };
    }

    const config = component.component_config;
    let chartType: ChartType;

    // Determine chart type from component type and config
    if (component.type === 'metric') {
      chartType = ChartType.METRIC;
    } else if (component.type === 'table') {
      chartType = ChartType.TABLE;
    } else if (component.type === 'chart') {
      const chartConfig = config as ChartConfiguration;
      chartType = chartConfig.type;
    } else {
      return { isValid: false, errors: ['Unsupported component type'] };
    }

    return validateChartConfig(chartType, config as ChartConfiguration | MetricConfiguration | TableConfiguration);
  }, [component]);

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return;

    const interval = setInterval(() => {
      handleRefresh();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, onRefresh]);

  // Handle refresh
  const handleRefresh = async () => {
    if (!onRefresh) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      await onRefresh(component.id);
      setState(prev => ({
        ...prev,
        loading: false,
        lastUpdated: new Date(),
        retryCount: 0
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Refresh failed';
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
        retryCount: prev.retryCount + 1
      }));

      if (onError) {
        onError(error instanceof Error ? error : new Error(errorMessage), component);
      }
    }
  };

  // Handle retry
  const handleRetry = () => {
    setState(prev => ({ ...prev, error: null, retryCount: prev.retryCount + 1 }));
  };

  // Render loading state
  const renderLoadingState = () => (
    <Card className={`glass-panel p-6 ${className}`} style={style}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          {showRefreshButton && (
            <Skeleton className="h-8 w-8 rounded" />
          )}
        </div>
        <Skeleton className="h-4 w-48" />
        <div className="space-y-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </Card>
  );

  // Render error state
  const renderErrorState = () => (
    <Card className={`glass-panel p-6 ${className}`} style={style}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-destructive">
            {component.component_config?.title || 'Chart Error'}
          </h3>
          <div className="flex items-center gap-2">
            {showRefreshButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={state.loading}
              >
                {state.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
            >
              Retry
            </Button>
          </div>
        </div>
        
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {state.error || 'An error occurred while rendering the chart'}
          </AlertDescription>
        </Alert>

        {validation.errors.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Configuration Errors:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {validation.errors.map((error, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="w-1 h-1 bg-destructive rounded-full" />
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.retryCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Retry attempt: {state.retryCount}
          </p>
        )}
      </div>
    </Card>
  );

  // Render empty state
  const renderEmptyState = () => (
    <Card className={`glass-panel p-6 ${className}`} style={style}>
      <div className="text-center space-y-4">
        <h3 className="text-lg font-semibold">
          {component.component_config?.title || 'Empty Chart'}
        </h3>
        <p className="text-muted-foreground">
          No data available for this chart
        </p>
        {showRefreshButton && onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={state.loading}
          >
            {state.loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        )}
      </div>
    </Card>
  );

  // Render chart header
  const renderChartHeader = () => {
    const config = component.component_config;
    if (!config) return null;

    return (
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">
            {config.title}
          </h3>
          {'description' in config && config.description && (
            <p className="text-sm text-muted-foreground">
              {config.description}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {state.lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated: {state.lastUpdated.toLocaleTimeString()}
            </span>
          )}
          
          {showRefreshButton && onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={state.loading}
            >
              {state.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Main render logic
  if (state.loading && !state.lastUpdated) {
    return renderLoadingState();
  }

  if (state.error || !validation.isValid) {
    return renderErrorState();
  }

  if (!component.component_config) {
    return renderEmptyState();
  }

  // Determine chart type and create chart
  const config = component.component_config;
  let chartType: ChartType;

  if (component.type === 'metric') {
    chartType = ChartType.METRIC;
  } else if (component.type === 'table') {
    chartType = ChartType.TABLE;
  } else if (component.type === 'chart') {
    const chartConfig = config as ChartConfiguration;
    chartType = chartConfig.type;
  } else {
    return renderErrorState();
  }

  // Create chart component
  const chartElement = createChart({
    type: chartType,
    config: config as ChartConfiguration | MetricConfiguration | TableConfiguration,
    className: 'w-full h-full'
  });

  if (!chartElement) {
    return renderErrorState();
  }

  return (
    <ErrorBoundary
      fallback={renderErrorState}
      onError={(error) => {
        setState(prev => ({ ...prev, error: error.message }));
        if (onError) {
          onError(error, component);
        }
      }}
    >
      <Card className={`glass-panel p-6 animate-fade-in ${className}`} style={style}>
        {renderChartHeader()}
        <div className="chart-content">
          {chartElement}
        </div>
      </Card>
    </ErrorBoundary>
  );
};

export default ChartRenderer;
