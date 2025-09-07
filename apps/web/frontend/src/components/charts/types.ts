/**
 * Chart component types and interfaces
 */

import { ChartType, ChartConfiguration, MetricConfiguration, TableConfiguration } from '@/types/dashboard';

// Base chart component props
export interface BaseChartProps {
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}

// Metric card props
export interface MetricCardProps extends BaseChartProps {
  title: string;
  value: string | number;
  change: string;
  trend: 'up' | 'down' | 'stable';
  metadata?: Record<string, any>;
}

// Table component props
export interface TableProps extends BaseChartProps {
  title: string;
  description?: string;
  columns: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'currency' | 'percentage' | 'date';
    width?: string;
    align?: 'left' | 'center' | 'right';
  }>;
  data: Record<string, any>[];
  pagination?: Record<string, any>;
  metadata?: Record<string, any>;
}

// Chart component props
export interface ChartProps extends BaseChartProps {
  title: string;
  description?: string;
  datasets: Array<{
    label: string;
    data: Array<{
      label: string;
      value: number | string;
      metadata?: Record<string, any>;
    }>;
    color?: string;
    metadata?: Record<string, any>;
  }>;
  config?: Record<string, any>;
  layout?: Record<string, any>;
  metadata?: Record<string, any>;
}

// Chart configuration validation
export interface ChartValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Chart factory props
export interface ChartFactoryProps {
  type: ChartType;
  config: ChartConfiguration | MetricConfiguration | TableConfiguration;
  className?: string;
  style?: React.CSSProperties;
}

// Chart renderer props
export interface ChartRendererProps {
  component: {
    id: string;
    type: 'chart' | 'metric' | 'table' | 'custom';
    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    component_config: ChartConfiguration | MetricConfiguration | TableConfiguration | Record<string, any>;
    metadata?: Record<string, any>;
  };
  className?: string;
  style?: React.CSSProperties;
  onError?: (error: Error, component: any) => void;
  onRefresh?: (componentId: string) => Promise<void>;
  showRefreshButton?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

// Error boundary props
export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

// Chart registry entry
export interface ChartRegistryEntry {
  type: ChartType;
  component: React.ComponentType<any>;
  defaultConfig?: Record<string, any>;
  supportedFeatures?: string[];
}

// Chart configuration helpers
export interface ChartConfigHelpers {
  getDefaultConfig: (type: ChartType) => Record<string, any>;
  validateConfig: (type: ChartType, config: any) => ChartValidationResult;
  transformData: (type: ChartType, data: any) => any;
  getColorScheme: (type: ChartType) => string[];
}

// Dashboard component position
export interface ComponentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Dashboard component
export interface DashboardComponent {
  id: string;
  type: 'chart' | 'metric' | 'table' | 'custom';
  position: ComponentPosition;
  component_config: ChartConfiguration | MetricConfiguration | TableConfiguration | Record<string, any>;
  metadata?: Record<string, any>;
}

// Chart data point
export interface ChartDataPoint {
  label: string;
  value: number | string;
  metadata?: Record<string, any>;
}

// Chart dataset
export interface ChartDataset {
  label: string;
  data: ChartDataPoint[];
  color?: string;
  metadata?: Record<string, any>;
}

// Chart animation configuration
export interface ChartAnimationConfig {
  enabled: boolean;
  duration: number;
  easing: string;
  delay?: number;
}

// Chart responsive configuration
export interface ChartResponsiveConfig {
  enabled: boolean;
  breakpoints: Record<string, Record<string, any>>;
  maintainAspectRatio: boolean;
}

// Chart theme configuration
export interface ChartThemeConfig {
  colors: string[];
  background: string;
  text: string;
  grid: string;
  border: string;
}

// Chart interaction configuration
export interface ChartInteractionConfig {
  hover: boolean;
  click: boolean;
  zoom: boolean;
  pan: boolean;
  tooltip: boolean;
}

// Complete chart configuration
export interface CompleteChartConfig {
  animation: ChartAnimationConfig;
  responsive: ChartResponsiveConfig;
  theme: ChartThemeConfig;
  interaction: ChartInteractionConfig;
  layout: Record<string, any>;
  plugins: Record<string, any>;
}

// Chart factory methods
export interface ChartFactoryMethods {
  createChart: (props: ChartFactoryProps) => React.ReactElement | null;
  registerChart: (type: ChartType, component: React.ComponentType<any>) => void;
  unregisterChart: (type: ChartType) => void;
  isChartTypeSupported: (type: ChartType) => boolean;
  getAvailableChartTypes: () => ChartType[];
  validateConfig: (type: ChartType, config: any) => ChartValidationResult;
}

// Chart renderer state
export interface ChartRendererState {
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  retryCount: number;
}

// Chart refresh options
export interface ChartRefreshOptions {
  force: boolean;
  silent: boolean;
  timeout: number;
}

// Chart error information
export interface ChartError {
  message: string;
  code?: string;
  component?: string;
  timestamp: Date;
  retryable: boolean;
}

// Chart performance metrics
export interface ChartPerformanceMetrics {
  renderTime: number;
  dataProcessingTime: number;
  memoryUsage: number;
  errorRate: number;
}

// Chart configuration schema
export interface ChartConfigSchema {
  type: ChartType;
  required: string[];
  optional: string[];
  validation: Record<string, any>;
  defaults: Record<string, any>;
}
