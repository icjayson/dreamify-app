/**
 * Recharts Bar Chart Component - Responsive bar chart with theme integration
 */

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { ChartConfiguration } from '@/types/dashboard';
import { useChartTheme } from '@/hooks/useChartTheme';
import { assignDatasetColors } from '@/utils/chartStyling';
import EditableText from '@/components/charts/edit/EditableText';
import { useEditableAxes } from '@/components/charts/edit/useEditableAxes';

interface RechartsBarChartProps {
  title?: string;
  description?: string;
  datasets?: Array<{
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
  styling?: {
    presetTheme: string;
    colorPalette: string[];
    customStyling?: Record<string, any>;
    animationEnabled: boolean;
    gridVisible: boolean;
    legendPosition: 'top' | 'bottom' | 'right' | 'none';
  };
  className?: string;
  style?: React.CSSProperties;
}

const RechartsBarChart: React.FC<RechartsBarChartProps & { axisConfig?: any }> = ({
  title = "Bar Chart",
  description,
  datasets = [],
  config = {},
  layout = {},
  styling,
  axisConfig,
  className = "",
  style = {}
}) => {
  const { xAxisProps, yAxisProps } = useEditableAxes({
    x: axisConfig?.x_axis?.label,
    y: axisConfig?.y_axis?.label,
  });
  const { assignColors, getStylingClasses } = useChartTheme({
    initialStyling: styling
  });

  // Transform data for Recharts format
  const transformedData = React.useMemo(() => {
    if (datasets.length === 0) return [];

    // Get all unique labels from all datasets
    const allLabels = new Set<string>();
    datasets.forEach(dataset => {
      if (Array.isArray(dataset.data)) {
        dataset.data.forEach(point => {
          allLabels.add(point.label);
        });
      }
    });

    // Create data points for each label
    return Array.from(allLabels).map(label => {
      const dataPoint: Record<string, any> = { label };

      datasets.forEach(dataset => {
        if (Array.isArray(dataset.data)) {
          const point = dataset.data.find(p => p.label === label);
          dataPoint[dataset.label] = point ? point.value : 0;
        } else {
          dataPoint[dataset.label] = 0;
        }
      });

      return dataPoint;
    });
  }, [datasets]);

  // Assign colors to datasets
  const coloredDatasets = React.useMemo(() => {
    return assignColors(datasets);
  }, [datasets, assignColors]);

  // Get styling classes
  const stylingClasses = getStylingClasses();

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="chart-tooltip">
          <p className="font-medium">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.dataKey}: {entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`chart-container ${stylingClasses} ${className}`} style={{ height: '100%', display: 'flex', flexDirection: 'column', ...style }}>
      <div className="mb-4" style={{ flexShrink: 0 }}>
        <EditableText
          as="h3"
          value={title}
          path="title"
          className="text-lg font-semibold mb-1"
          style={{ color: 'var(--title-color)' }}
          placeholder="Chart title"
        />
        <EditableText
          as="p"
          value={description}
          path="description"
          className="text-sm"
          style={{ color: 'var(--description-color)' }}
          placeholder="Add description"
        />
      </div>

      <ResponsiveContainer width="100%" height="100%" style={{ flex: 1 }}>
        <BarChart
          data={transformedData}
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 20,
          }}
        >
          {styling?.gridVisible !== false && (
            <CartesianGrid
              strokeDasharray="3 3"
              className="chart-grid"
            />
          )}
          <XAxis
            dataKey="label"
            className="chart-axis"
            tick={{ fill: 'var(--element-color)' }}
            {...xAxisProps}
          />
          <YAxis
            className="chart-axis"
            tick={{ fill: 'var(--element-color)' }}
            {...yAxisProps}
          />
          <Tooltip content={<CustomTooltip />} />
          {styling?.legendPosition !== 'none' && (
            <Legend
              className="chart-legend"
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
            />
          )}
          {coloredDatasets.map((dataset, index) => (
            <Bar
              key={dataset.label}
              dataKey={dataset.label}
              fill={dataset.color}
              radius={[4, 4, 0, 0]}
              isAnimationActive={styling?.animationEnabled !== false}
              animationDuration={styling?.animationEnabled !== false ? 1000 : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsBarChart;
