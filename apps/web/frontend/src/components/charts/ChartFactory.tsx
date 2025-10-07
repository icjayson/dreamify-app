/**
 * ChartFactory - Factory for creating dynamic chart components
 */

import React from 'react';
import { ChartType, ChartConfiguration, MetricConfiguration, TableConfiguration } from '@/types/dashboard';

// Import chart components
import MetricCard from '@/components/charts/MetricCard';
import Table from '@/components/charts/Table';

// Import Recharts components
import RechartsLineChart from '@/components/charts/RechartsLineChart';
import RechartsBarChart from '@/components/charts/RechartsBarChart';
import RechartsPieChart from '@/components/charts/RechartsPieChart';
import RechartsAreaChart from '@/components/charts/RechartsAreaChart';
import RechartsScatterChart from '@/components/charts/RechartsScatterChart';
import RechartsComposedChart from '@/components/charts/RechartsComposedChart';
import RechartsRadarChart from '@/components/charts/RechartsRadarChart';
import RechartsRadialBarChart from '@/components/charts/RechartsRadialBarChart';
import RechartsFunnelChart from '@/components/charts/RechartsFunnelChart';
import RechartsTreemapChart from '@/components/charts/RechartsTreemapChart';
import RechartsSankeyChart from '@/components/charts/RechartsSankeyChart';

// Chart component registry
const CHART_COMPONENTS = {
  [ChartType.LINE]: RechartsLineChart,
  [ChartType.BAR]: RechartsBarChart,
  [ChartType.PIE]: RechartsPieChart,
  [ChartType.AREA]: RechartsAreaChart,
  [ChartType.SCATTER]: RechartsScatterChart,
  [ChartType.COMPOSED]: RechartsComposedChart,
  [ChartType.RADAR]: RechartsRadarChart,
  [ChartType.RADIAL_BAR]: RechartsRadialBarChart,
  [ChartType.FUNNEL]: RechartsFunnelChart,
  [ChartType.TREEMAP]: RechartsTreemapChart,
  [ChartType.SANKEY]: RechartsSankeyChart,
  [ChartType.METRIC]: MetricCard,
  [ChartType.TABLE]: Table,
  // Removed: Geographic, Activity Feed, Revenue, Projections
  // Fallback components for unsupported types
  [ChartType.DONUT]: RechartsPieChart, // Using RechartsPieChart as fallback for donut charts
};

// Chart configuration interfaces
interface ChartFactoryProps {
  type: ChartType;
  config: ChartConfiguration | MetricConfiguration | TableConfiguration;
  className?: string;
  style?: React.CSSProperties;
}

interface ChartRegistry {
  [key: string]: React.ComponentType<any>;
}

class ChartFactory {
  private static instance: ChartFactory;
  private chartRegistry: ChartRegistry = { ...CHART_COMPONENTS };

  private constructor() {}

  public static getInstance(): ChartFactory {
    if (!ChartFactory.instance) {
      ChartFactory.instance = new ChartFactory();
    }
    return ChartFactory.instance;
  }

  /**
   * Register a new chart component
   */
  public registerChart(type: ChartType, component: React.ComponentType<any>): void {
    this.chartRegistry[type] = component;
  }

  /**
   * Unregister a chart component
   */
  public unregisterChart(type: ChartType): void {
    delete this.chartRegistry[type];
  }

  /**
   * Get available chart types
   */
  public getAvailableChartTypes(): ChartType[] {
    return Object.keys(this.chartRegistry) as ChartType[];
  }

  /**
   * Check if a chart type is supported
   */
  public isChartTypeSupported(type: ChartType): boolean {
    return type in this.chartRegistry;
  }

  /**
   * Create a chart component
   */
  public createChart(props: ChartFactoryProps): React.ReactElement | null {
    const { type, config, className, style } = props;

    // Check if chart type is supported
    if (!this.isChartTypeSupported(type)) {
      console.error(`Unsupported chart type: ${type}`);
      return this.createFallbackChart(type, config, className, style);
    }

    // Get the chart component
    const ChartComponent = this.chartRegistry[type];

    if (!ChartComponent) {
      console.error(`Chart component not found for type: ${type}`);
      return this.createFallbackChart(type, config, className, style);
    }

    try {
      // Transform config to component props
      const componentProps = this.transformConfigToProps(type, config);
      
      return React.createElement(ChartComponent, {
        ...componentProps,
        className,
        style,
        key: `chart-${config.id || type}`
      });
    } catch (error) {
      console.error(`Error creating chart component for type ${type}:`, error);
      return this.createFallbackChart(type, config, className, style);
    }
  }

  /**
   * Transform configuration to component props
   */
  private transformConfigToProps(
    type: ChartType,
    config: ChartConfiguration | MetricConfiguration | TableConfiguration
  ): any {
    switch (type) {
      case ChartType.METRIC:
        const metricConfig = config as MetricConfiguration;
        return {
          title: metricConfig.title,
          value: metricConfig.value,
          change: metricConfig.change,
          trend: metricConfig.trend,
          timeComparison: (metricConfig as any).timeComparison,
          styling: (metricConfig as any).styling
        };

      case ChartType.TABLE:
        const tableConfig = config as TableConfiguration;
        // Normalize columns if provided as string[] to TableColumn[]
        let normalizedColumns: any = tableConfig.columns;
        if (Array.isArray(tableConfig.columns) && tableConfig.columns.length > 0 && typeof tableConfig.columns[0] === 'string') {
          normalizedColumns = (tableConfig.columns as string[]).map((name) => ({
            key: name,
            label: name,
            type: 'string'
          }));
        }
        return {
          title: tableConfig.title,
          description: tableConfig.description,
          columns: normalizedColumns,
          data: tableConfig.data,
          pagination: tableConfig.pagination,
          styling: (tableConfig as any).styling
        };

      case ChartType.LINE:
      case ChartType.BAR:
      case ChartType.PIE:
      case ChartType.AREA:
      case ChartType.SCATTER:
      case ChartType.COMPOSED:
      case ChartType.RADAR:
      case ChartType.RADIAL_BAR:
      case ChartType.FUNNEL:
      case ChartType.TREEMAP:
      case ChartType.SANKEY:
      case ChartType.DONUT:
      case ChartType.GEOGRAPHIC:
        const chartConfig = config as ChartConfiguration;
        return {
          title: chartConfig.title,
          description: chartConfig.description,
          datasets: chartConfig.datasets,
          axisConfig: (chartConfig as any).axisConfig,
          data: (chartConfig as any).data,
          config: chartConfig.config,
          layout: chartConfig.layout,
          styling: chartConfig.styling
        };

      case ChartType.ACTIVITY_FEED:
        return {};

      default:
        return {};
    }
  }

  /**
   * Create fallback chart for unsupported types
   */
  private createFallbackChart(
    type: ChartType,
    config: ChartConfiguration | MetricConfiguration | TableConfiguration,
    className?: string,
    style?: React.CSSProperties
  ): React.ReactElement {
    return React.createElement('div', {
      className: `chart-fallback ${className || ''}`,
      style: {
        padding: '20px',
        textAlign: 'center',
        backgroundColor: 'hsl(var(--muted))',
        borderRadius: '8px',
        ...style
      }
    }, [
      React.createElement('h3', { key: 'title' }, config.title || 'Chart'),
      React.createElement('p', { key: 'error' }, `Chart type "${type}" is not supported`),
      React.createElement('p', { key: 'fallback' }, 'Please contact support for assistance.')
    ]);
  }

  /**
   * Validate chart configuration
   */
  public validateConfig(
    type: ChartType,
    config: ChartConfiguration | MetricConfiguration | TableConfiguration
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic validation
    if (!config.id) {
      errors.push('Configuration ID is required');
    }

    if (!config.title) {
      errors.push('Configuration title is required');
    }

    // Type-specific validation
    switch (type) {
      case ChartType.METRIC:
        const metricConfig = config as MetricConfiguration;
        if (metricConfig.value === undefined || metricConfig.value === null) {
          errors.push('Metric value is required');
        }
        break;

      case ChartType.TABLE:
        const tableConfig = config as TableConfiguration;
        if (!tableConfig.columns || tableConfig.columns.length === 0) {
          errors.push('Table columns are required');
        }
        if (!tableConfig.data || tableConfig.data.length === 0) {
          errors.push('Table data is required');
        }
        break;

      case ChartType.LINE:
      case ChartType.BAR:
      case ChartType.PIE:
      case ChartType.AREA:
      case ChartType.SCATTER:
      case ChartType.COMPOSED:
      case ChartType.RADAR:
      case ChartType.RADIAL_BAR:
      case ChartType.FUNNEL:
      case ChartType.TREEMAP:
      case ChartType.SANKEY:
      case ChartType.DONUT:
      case ChartType.GEOGRAPHIC:
        const chartConfig = config as ChartConfiguration;
        const hasDatasets = Array.isArray(chartConfig.datasets) && chartConfig.datasets.length > 0;
        const hasAxisConfig = !!(chartConfig as any).axisConfig;
        const hasSankeyData = (type === ChartType.SANKEY) && !!(chartConfig as any)?.config?.data && Array.isArray((chartConfig as any).config.data.nodes) && Array.isArray((chartConfig as any).config.data.links);
        if (!hasDatasets && !hasAxisConfig && !hasSankeyData) {
          errors.push(type === ChartType.SANKEY ? 'Sankey chart requires datasets, axisConfig, or config.data {nodes, links}' : 'Chart requires either datasets or axisConfig');
        }
        break;
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export const chartFactory = ChartFactory.getInstance();

// Export the factory class for testing
export { ChartFactory };

// Export the main factory function
export const createChart = (props: ChartFactoryProps): React.ReactElement | null => {
  return chartFactory.createChart(props);
};

// Export utility functions
export const registerChart = (type: ChartType, component: React.ComponentType<any>): void => {
  chartFactory.registerChart(type, component);
};

export const isChartTypeSupported = (type: ChartType): boolean => {
  return chartFactory.isChartTypeSupported(type);
};

export const getAvailableChartTypes = (): ChartType[] => {
  return chartFactory.getAvailableChartTypes();
};

export const validateChartConfig = (
  type: ChartType,
  config: ChartConfiguration | MetricConfiguration | TableConfiguration
): { isValid: boolean; errors: string[] } => {
  return chartFactory.validateConfig(type, config);
};
