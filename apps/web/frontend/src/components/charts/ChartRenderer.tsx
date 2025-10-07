/**
 * ChartRenderer - Component for rendering charts based on configuration
 */

import React, { useState, useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { 
  ChartType, 
  ChartConfiguration, 
  MetricConfiguration, 
  TableConfiguration,
  DashboardComponent,
  ChartStyling
} from '@/types/dashboard';
import { createChart, validateChartConfig } from './ChartFactory';
import ErrorBoundary from '@/components/charts/ErrorBoundary';
import { getChartStylingClasses } from '@/utils/chartStyling';

interface ChartRendererProps {
  component: DashboardComponent;
  className?: string;
  style?: React.CSSProperties;
  onError?: (error: Error, component: DashboardComponent) => void;
}

interface ChartRendererState {
  loading: boolean;
  error: string | null;
  // removed refresh-related state
}

const ChartRenderer: React.FC<ChartRendererProps> = ({
  component,
  className = '',
  style = {},
  onError,
  // refresh removed
}) => {
  const [state, setState] = useState<ChartRendererState>({
    loading: false,
    error: null,
    // no refresh state
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

  // refresh removed

  // Render loading state
  const renderLoadingState = () => (
    <div className={`p-6 ${className}`} style={style}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
        </div>
        <Skeleton className="h-4 w-48" />
        <div className="space-y-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  );

  // Render error state
  const renderErrorState = () => (
    <div className={`p-6 ${className}`} style={style}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-destructive">
            {component.component_config?.title || 'Chart Error'}
          </h3>
          <div className="flex items-center gap-2" />
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
      </div>
    </div>
  );

  // Render empty state
  const renderEmptyState = () => (
    <div className={`p-6 ${className}`} style={style}>
      <div className="text-center space-y-4">
        <h3 className="text-lg font-semibold">
          {component.component_config?.title || 'Empty Chart'}
        </h3>
        <p>
          No data available for this chart
        </p>
      </div>
    </div>
  );

  // Header removed to avoid duplication; each chart/metric/table handles its own title

  // Main render logic
  if (state.loading) {
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

  // Get styling classes for the chart
  const chartConfig = config as ChartConfiguration;
  const stylingClasses = chartConfig.styling ? getChartStylingClasses(chartConfig.styling) : '';

  // Compute tile styles from styling
  const tile = (chartConfig as any)?.styling?.tile || {};
  const containerStyle: React.CSSProperties = {
    border: `${(tile.borderWidth ?? 1)}px solid ${tile.borderColor || 'hsl(220 14% 90%)'}`,
    borderRadius: (tile.borderRadius ?? 12) as number,
    backgroundColor: tile.background || 'hsl(0 0% 100%)',
    ...style
  };

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
      <div className={`p-6 rounded-md animate-fade-in ${stylingClasses} ${className}`} style={containerStyle}>
        <div className="chart-content">
          {chartElement}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default ChartRenderer;
