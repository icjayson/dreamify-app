/**
 * ChartFactory - Factory for creating dynamic chart components
 */

import React from 'react';
import { ChartType, ChartConfiguration, MetricConfiguration, TableConfiguration } from '@/types/dashboard';

// Import chart components
import RevenueChart from '@/components/dashboard/RevenueChart';
import ProjectionsChart from '@/components/dashboard/ProjectionsChart';
import MetricCard from '@/components/dashboard/MetricCard';
import TopProductsTable from '@/components/dashboard/TopProductsTable';
import GeographicChart from '@/components/dashboard/GeographicChart';
import ActivityFeed from '@/components/dashboard/ActivityFeed';

// Import Recharts components
import RechartsLineChart from '@/components/charts/RechartsLineChart';
import RechartsBarChart from '@/components/charts/RechartsBarChart';
import RechartsPieChart from '@/components/charts/RechartsPieChart';
import RechartsAreaChart from '@/components/charts/RechartsAreaChart';
import RechartsScatterChart from '@/components/charts/RechartsScatterChart';
import RechartsComposedChart from '@/components/charts/RechartsComposedChart';

// Chart component registry
const CHART_COMPONENTS = {
  [ChartType.LINE]: RechartsLineChart,
  [ChartType.BAR]: RechartsBarChart,
  [ChartType.PIE]: RechartsPieChart,
  [ChartType.AREA]: RechartsAreaChart,
  [ChartType.SCATTER]: RechartsScatterChart,
  [ChartType.COMPOSED]: RechartsComposedChart,
  [ChartType.METRIC]: MetricCard,
  [ChartType.TABLE]: TopProductsTable,
  [ChartType.GEOGRAPHIC]: GeographicChart,
  [ChartType.ACTIVITY_FEED]: ActivityFeed,
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
          trend: metricConfig.trend
        };

      case ChartType.TABLE:
        const tableConfig = config as TableConfiguration;
        return {
          title: tableConfig.title,
          description: tableConfig.description,
          columns: tableConfig.columns,
          data: tableConfig.data,
          pagination: tableConfig.pagination
        };

      case ChartType.LINE:
      case ChartType.BAR:
      case ChartType.PIE:
      case ChartType.AREA:
      case ChartType.SCATTER:
      case ChartType.COMPOSED:
      case ChartType.DONUT:
      case ChartType.GEOGRAPHIC:
        const chartConfig = config as ChartConfiguration;
        return {
          title: chartConfig.title,
          description: chartConfig.description,
          datasets: chartConfig.datasets,
          config: chartConfig.config,
          layout: chartConfig.layout,
          styling: chartConfig.styling
        };

      case ChartType.ACTIVITY_FEED:
        return {
          // ActivityFeed uses hardcoded data for now
          // This will be updated when ActivityFeed is refactored
        };

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
        if (!metricConfig.value) {
          errors.push('Metric value is required');
        }
        if (!metricConfig.change) {
          errors.push('Metric change is required');
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
      case ChartType.DONUT:
      case ChartType.GEOGRAPHIC:
        const chartConfig = config as ChartConfiguration;
        if (!chartConfig.datasets || chartConfig.datasets.length === 0) {
          errors.push('Chart datasets are required');
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
