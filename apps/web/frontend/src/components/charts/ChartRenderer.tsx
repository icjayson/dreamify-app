/**
 * ChartRenderer - Component for rendering charts based on configuration
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import {
  ChartType,
  ChartConfiguration,
  MetricConfiguration,
  TableConfiguration,
  DashboardComponent
} from '@/types/dashboard';
import { createChart, validateChartConfig } from './ChartFactory';
import ErrorBoundary from '@/components/charts/ErrorBoundary';
import { getChartStylingClasses, convertLLMStylingToChartStyling } from '@/utils/chartStyling';

interface ChartRendererProps {
  component: DashboardComponent;
  className?: string;
  style?: React.CSSProperties;
  onError?: (error: Error, component: DashboardComponent) => void;
}

interface ChartRendererState {
  loading: boolean;
  error: string | null;
  expandedInsight: boolean;
}

type RenderableChartConfiguration = ChartConfiguration & {
  insight?: string;
  styling?: ChartConfiguration['styling'] & {
    theme?: string;
  };
};

/** How many ms to wait before checking if the chart rendered any visible content */
const HEALTH_CHECK_DELAY_MS = 600;
/** How many auto-retries before giving up and showing a manual button */
const MAX_AUTO_RETRIES = 3;

const ChartRenderer: React.FC<ChartRendererProps> = ({
  component,
  className = '',
  style = {},
  onError,
}) => {
  const [state, setState] = useState<ChartRendererState>({
    loading: false,
    error: null,
    expandedInsight: false,
  });

  // Health-check state: mountKey increments to force re-mount on retry
  const [mountKey, setMountKey] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [isBlank, setIsBlank] = useState(false);
  const chartContentRef = useRef<HTMLDivElement>(null);
  const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHealthCheck = useCallback(() => {
    if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
    healthTimerRef.current = setTimeout(() => {
      const el = chartContentRef.current;
      if (!el) return;
      // Consider the chart blank if it has no SVG, canvas, or meaningful text children
      const hasSvg = el.querySelector('svg') !== null;
      const hasCanvas = el.querySelector('canvas') !== null;
      const hasText = (el.textContent?.trim().length ?? 0) > 0;
      if (!hasSvg && !hasCanvas && !hasText) {
        // Container is empty — browser extension likely suppressed the output
        if (retryCount < MAX_AUTO_RETRIES) {
          setRetryCount(r => r + 1);
          setMountKey(k => k + 1); // remount the chart
        } else {
          setIsBlank(true); // show manual retry button
        }
      } else {
        setIsBlank(false);
      }
    }, HEALTH_CHECK_DELAY_MS);
  }, [retryCount]);

  // Run health check after every mount/remount
  useEffect(() => {
    scheduleHealthCheck();
    return () => {
      if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
    };
  }, [mountKey, scheduleHealthCheck]);

  const handleManualRetry = () => {
    setRetryCount(0);
    setIsBlank(false);
    setMountKey(k => k + 1);
  };

  // Validate component configuration
  const validation = useMemo(() => {
    if (!component.component_config) {
      return { isValid: false, errors: ['Component configuration is missing'] };
    }

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
      return { isValid: false, errors: ['Unsupported component type'] };
    }

    return validateChartConfig(chartType, config as ChartConfiguration | MetricConfiguration | TableConfiguration);
  }, [component]);

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
        <p>No data available for this chart</p>
      </div>
    </div>
  );

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
  const chartConfig = config as RenderableChartConfiguration;

  // Convert Morpheus styling to ChartStyling format if needed
  let stylingClasses = '';
  if (chartConfig.styling) {
    const morpheusStyling = chartConfig.styling;
    if (morpheusStyling.presetTheme) {
      stylingClasses = getChartStylingClasses(morpheusStyling);
    } else if (morpheusStyling.theme) {
      const converted = convertLLMStylingToChartStyling(morpheusStyling);
      stylingClasses = getChartStylingClasses(converted);
    }
  }

  // Get insight from config
  const insight = chartConfig.insight || '';

  const containerStyle: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    color: 'var(--title-color)',
    ...style
  };
  const paddingClass = component.type === 'metric' ? 'px-4 py-3.5' : 'px-4 py-4 md:px-5 md:py-5';

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
      <div className={`${paddingClass} rounded-[inherit] animate-fade-in bg-transparent ${stylingClasses} ${className}`} style={containerStyle}>
        <div ref={chartContentRef} className="chart-content w-full overflow-hidden flex-1 min-h-0">
          {/* key forces a full remount on each retry, clearing any partial extension-blocked state */}
          <React.Fragment key={mountKey}>
            {chartElement}
          </React.Fragment>
        </div>

        {/* Manual retry button — shown after auto-retries are exhausted and chart is still blank */}
        {isBlank && (
          <div className="flex items-center justify-center py-6">
            <button
              type="button"
              onClick={handleManualRetry}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Reload chart
            </button>
          </div>
        )}

        {insight && (
          <div
            className="relative z-10 mt-3 flex-shrink-0 border-t pt-3"
            data-export-exclude
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ borderColor: 'var(--border-card-color)' }}
          >
            <button
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              onClick={(e) => {
                e.stopPropagation();
                setState(prev => ({ ...prev, expandedInsight: !prev.expandedInsight }));
              }}
              className="w-full flex items-center justify-start gap-2 text-xs font-medium hover:opacity-80 transition-opacity"
              style={{ color: 'var(--description-color)' }}
            >
              <span>Insight</span>
              {state.expandedInsight ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            {state.expandedInsight && (
              <div className="mt-2" onMouseDown={(e) => e.stopPropagation()}>
                <p className="text-sm leading-5" style={{ color: 'var(--title-color)' }}>
                  {insight}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default ChartRenderer;
