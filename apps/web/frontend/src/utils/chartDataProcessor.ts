/**
 * Chart data processing utilities
 */

import { ChartDataPoint, ChartDataset } from '@/types/dashboard';

export class ChartDataProcessor {
  /**
   * Transform raw data to chart data points
   */
  static transformToDataPoints(
    data: any[],
    labelField: string,
    valueField: string
  ): ChartDataPoint[] {
    return data.map(item => ({
      label: String(item[labelField] || ''),
      value: item[valueField] || 0,
      metadata: { ...item }
    }));
  }

  /**
   * Group data by field
   */
  static groupBy(data: any[], field: string): Record<string, any[]> {
    return data.reduce((groups, item) => {
      const key = String(item[field] || 'Unknown');
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    }, {} as Record<string, any[]>);
  }

  /**
   * Aggregate data by field
   */
  static aggregateBy(
    data: any[],
    groupField: string,
    valueField: string,
    operation: 'sum' | 'mean' | 'count' | 'max' | 'min' = 'sum'
  ): ChartDataPoint[] {
    const grouped = this.groupBy(data, groupField);
    
    return Object.entries(grouped).map(([label, items]) => {
      let value: number;
      
      switch (operation) {
        case 'sum':
          value = items.reduce((sum, item) => sum + (Number(item[valueField]) || 0), 0);
          break;
        case 'mean':
          value = items.reduce((sum, item) => sum + (Number(item[valueField]) || 0), 0) / items.length;
          break;
        case 'count':
          value = items.length;
          break;
        case 'max':
          value = Math.max(...items.map(item => Number(item[valueField]) || 0));
          break;
        case 'min':
          value = Math.min(...items.map(item => Number(item[valueField]) || 0));
          break;
        default:
          value = 0;
      }
      
      return {
        label,
        value,
        metadata: { count: items.length, operation }
      };
    });
  }

  /**
   * Format currency values
   */
  static formatCurrency(value: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(value);
  }

  /**
   * Format percentage values
   */
  static formatPercentage(value: number, decimals = 1): string {
    return `${value.toFixed(decimals)}%`;
  }

  /**
   * Format number values
   */
  static formatNumber(value: number, decimals = 0): string {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }

  /**
   * Validate data points
   */
  static validateDataPoints(dataPoints: ChartDataPoint[]): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!dataPoints || dataPoints.length === 0) {
      errors.push('No data points provided');
      return { isValid: false, errors, warnings };
    }

    dataPoints.forEach((point, index) => {
      if (!point.label || point.label.trim() === '') {
        errors.push(`Data point ${index} has empty label`);
      }

      if (typeof point.value !== 'number' && typeof point.value !== 'string') {
        errors.push(`Data point ${index} has invalid value type`);
      }

      if (typeof point.value === 'number' && (isNaN(point.value) || !isFinite(point.value))) {
        warnings.push(`Data point ${index} has invalid numeric value`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Sort data points
   */
  static sortDataPoints(
    dataPoints: ChartDataPoint[],
    sortBy: 'label' | 'value' = 'value',
    order: 'asc' | 'desc' = 'desc'
  ): ChartDataPoint[] {
    return [...dataPoints].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'label') {
        comparison = a.label.localeCompare(b.label);
      } else {
        const aValue = typeof a.value === 'number' ? a.value : parseFloat(String(a.value)) || 0;
        const bValue = typeof b.value === 'number' ? b.value : parseFloat(String(b.value)) || 0;
        comparison = aValue - bValue;
      }
      
      return order === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Filter data points
   */
  static filterDataPoints(
    dataPoints: ChartDataPoint[],
    filterFn: (point: ChartDataPoint) => boolean
  ): ChartDataPoint[] {
    return dataPoints.filter(filterFn);
  }

  /**
   * Limit data points
   */
  static limitDataPoints(dataPoints: ChartDataPoint[], limit: number): ChartDataPoint[] {
    return dataPoints.slice(0, limit);
  }

  /**
   * Calculate statistics for data points
   */
  static calculateStatistics(dataPoints: ChartDataPoint[]): {
    count: number;
    sum: number;
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
  } {
    const numericValues = dataPoints
      .map(point => typeof point.value === 'number' ? point.value : parseFloat(String(point.value)) || 0)
      .filter(value => !isNaN(value));

    if (numericValues.length === 0) {
      return {
        count: 0,
        sum: 0,
        mean: 0,
        median: 0,
        min: 0,
        max: 0,
        stdDev: 0
      };
    }

    const sorted = [...numericValues].sort((a, b) => a - b);
    const sum = numericValues.reduce((acc, val) => acc + val, 0);
    const mean = sum / numericValues.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    
    const variance = numericValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / numericValues.length;
    const stdDev = Math.sqrt(variance);

    return {
      count: numericValues.length,
      sum,
      mean,
      median,
      min: Math.min(...numericValues),
      max: Math.max(...numericValues),
      stdDev
    };
  }
}
