/**
 * Chart types and configuration constants
 */

import { ChartType } from '@/types/dashboard';

// Available chart types
export const AVAILABLE_CHART_TYPES: ChartType[] = [
  ChartType.LINE,
  ChartType.BAR,
  ChartType.PIE,
  ChartType.AREA,
  ChartType.SCATTER,
  ChartType.DONUT,
  ChartType.METRIC,
  ChartType.TABLE,
  ChartType.GEOGRAPHIC,
  ChartType.ACTIVITY_FEED
];

// Chart type display names
export const CHART_TYPE_DISPLAY_NAMES: Record<ChartType, string> = {
  [ChartType.LINE]: 'Line Chart',
  [ChartType.BAR]: 'Bar Chart',
  [ChartType.PIE]: 'Pie Chart',
  [ChartType.AREA]: 'Area Chart',
  [ChartType.SCATTER]: 'Scatter Plot',
  [ChartType.DONUT]: 'Donut Chart',
  [ChartType.METRIC]: 'Metric Card',
  [ChartType.TABLE]: 'Data Table',
  [ChartType.GEOGRAPHIC]: 'Geographic Chart',
  [ChartType.ACTIVITY_FEED]: 'Activity Feed'
};

// Chart type descriptions
export const CHART_TYPE_DESCRIPTIONS: Record<ChartType, string> = {
  [ChartType.LINE]: 'Display trends over time with connected data points',
  [ChartType.BAR]: 'Compare values across different categories',
  [ChartType.PIE]: 'Show proportional data as slices of a circle',
  [ChartType.AREA]: 'Display trends with filled areas under the line',
  [ChartType.SCATTER]: 'Show relationships between two variables',
  [ChartType.DONUT]: 'Show proportional data with a hollow center',
  [ChartType.METRIC]: 'Display key performance indicators with trends',
  [ChartType.TABLE]: 'Present structured data in rows and columns',
  [ChartType.GEOGRAPHIC]: 'Visualize location-based data and distributions',
  [ChartType.ACTIVITY_FEED]: 'Show chronological list of events and activities'
};

// Chart type categories
export const CHART_TYPE_CATEGORIES: Record<string, ChartType[]> = {
  'Time Series': [ChartType.LINE, ChartType.AREA],
  'Comparison': [ChartType.BAR, ChartType.PIE, ChartType.DONUT],
  'Distribution': [ChartType.SCATTER, ChartType.GEOGRAPHIC],
  'Metrics': [ChartType.METRIC],
  'Data Display': [ChartType.TABLE, ChartType.ACTIVITY_FEED]
};

// Chart type validation rules
export const CHART_TYPE_VALIDATION_RULES: Record<ChartType, {
  minDataPoints: number;
  maxDataPoints: number;
  requiredFields: string[];
  optionalFields: string[];
}> = {
  [ChartType.LINE]: {
    minDataPoints: 2,
    maxDataPoints: 1000,
    requiredFields: ['label', 'value'],
    optionalFields: ['metadata']
  },
  [ChartType.BAR]: {
    minDataPoints: 1,
    maxDataPoints: 100,
    requiredFields: ['label', 'value'],
    optionalFields: ['metadata']
  },
  [ChartType.PIE]: {
    minDataPoints: 1,
    maxDataPoints: 20,
    requiredFields: ['label', 'value'],
    optionalFields: ['metadata']
  },
  [ChartType.AREA]: {
    minDataPoints: 2,
    maxDataPoints: 1000,
    requiredFields: ['label', 'value'],
    optionalFields: ['metadata']
  },
  [ChartType.SCATTER]: {
    minDataPoints: 2,
    maxDataPoints: 1000,
    requiredFields: ['label', 'value'],
    optionalFields: ['metadata']
  },
  [ChartType.DONUT]: {
    minDataPoints: 1,
    maxDataPoints: 20,
    requiredFields: ['label', 'value'],
    optionalFields: ['metadata']
  },
  [ChartType.METRIC]: {
    minDataPoints: 1,
    maxDataPoints: 1,
    requiredFields: ['title', 'value', 'change', 'trend'],
    optionalFields: ['metadata']
  },
  [ChartType.TABLE]: {
    minDataPoints: 1,
    maxDataPoints: 10000,
    requiredFields: ['columns', 'data'],
    optionalFields: ['pagination', 'metadata']
  },
  [ChartType.GEOGRAPHIC]: {
    minDataPoints: 1,
    maxDataPoints: 100,
    requiredFields: ['label', 'value'],
    optionalFields: ['metadata']
  },
  [ChartType.ACTIVITY_FEED]: {
    minDataPoints: 1,
    maxDataPoints: 100,
    requiredFields: ['type', 'message', 'time'],
    optionalFields: ['color', 'metadata']
  }
};

// Chart type icons (using Lucide React icon names)
export const CHART_TYPE_ICONS: Record<ChartType, string> = {
  [ChartType.LINE]: 'TrendingUp',
  [ChartType.BAR]: 'BarChart3',
  [ChartType.PIE]: 'PieChart',
  [ChartType.AREA]: 'AreaChart',
  [ChartType.SCATTER]: 'Scatter',
  [ChartType.DONUT]: 'Circle',
  [ChartType.METRIC]: 'Gauge',
  [ChartType.TABLE]: 'Table',
  [ChartType.GEOGRAPHIC]: 'Map',
  [ChartType.ACTIVITY_FEED]: 'Activity'
};

// Chart type colors
export const CHART_TYPE_COLORS: Record<ChartType, string> = {
  [ChartType.LINE]: 'hsl(var(--primary))',
  [ChartType.BAR]: 'hsl(var(--secondary))',
  [ChartType.PIE]: 'hsl(var(--accent))',
  [ChartType.AREA]: 'hsl(var(--primary))',
  [ChartType.SCATTER]: 'hsl(var(--secondary))',
  [ChartType.DONUT]: 'hsl(var(--accent))',
  [ChartType.METRIC]: 'hsl(var(--success))',
  [ChartType.TABLE]: 'hsl(var(--muted-foreground))',
  [ChartType.GEOGRAPHIC]: 'hsl(var(--primary))',
  [ChartType.ACTIVITY_FEED]: 'hsl(var(--accent))'
};

// Default chart configurations
export const DEFAULT_CHART_CONFIGS: Record<ChartType, Record<string, any>> = {
  [ChartType.LINE]: {
    animation: true,
    showGrid: true,
    showLegend: true,
    showTooltip: true,
    responsive: true,
    maintainAspectRatio: false,
    tension: 0.4
  },
  [ChartType.BAR]: {
    animation: true,
    showLegend: true,
    showTooltip: true,
    responsive: true,
    maintainAspectRatio: false,
    borderRadius: 4
  },
  [ChartType.PIE]: {
    animation: true,
    showLegend: true,
    showTooltip: true,
    responsive: true,
    maintainAspectRatio: true,
    cutout: 0
  },
  [ChartType.AREA]: {
    animation: true,
    showGrid: true,
    showLegend: true,
    showTooltip: true,
    responsive: true,
    maintainAspectRatio: false,
    fillOpacity: 0.3
  },
  [ChartType.SCATTER]: {
    animation: true,
    showGrid: true,
    showLegend: true,
    showTooltip: true,
    responsive: true,
    maintainAspectRatio: false,
    pointRadius: 4
  },
  [ChartType.DONUT]: {
    animation: true,
    showLegend: true,
    showTooltip: true,
    responsive: true,
    maintainAspectRatio: true,
    cutout: '50%'
  },
  [ChartType.METRIC]: {
    animation: true,
    showTrend: true,
    responsive: true,
    format: 'auto'
  },
  [ChartType.TABLE]: {
    showHeader: true,
    showPagination: false,
    responsive: true,
    sortable: true,
    pageSize: 10
  },
  [ChartType.GEOGRAPHIC]: {
    animation: true,
    showProgressBars: true,
    showPieChart: true,
    responsive: true,
    mapProjection: 'mercator'
  },
  [ChartType.ACTIVITY_FEED]: {
    animation: true,
    showTimestamps: true,
    responsive: true,
    maxItems: 10
  }
};

// Chart type recommendations based on data characteristics
export const CHART_TYPE_RECOMMENDATIONS: Record<string, ChartType[]> = {
  'time_series': [ChartType.LINE, ChartType.AREA],
  'categorical': [ChartType.BAR, ChartType.PIE, ChartType.DONUT],
  'geographic': [ChartType.GEOGRAPHIC],
  'correlation': [ChartType.SCATTER],
  'kpi': [ChartType.METRIC],
  'tabular': [ChartType.TABLE],
  'activity': [ChartType.ACTIVITY_FEED]
};
