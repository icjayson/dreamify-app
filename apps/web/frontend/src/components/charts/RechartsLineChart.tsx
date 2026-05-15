/**
 * Recharts Line Chart Component - Responsive line chart with theme integration
 */

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { ChartConfiguration } from '@/types/dashboard';
import { useChartTheme } from '@/hooks/useChartTheme';
import EditableText from '@/components/charts/edit/EditableText';
import { useEditableAxes } from '@/components/charts/edit/useEditableAxes';
import { assignDatasetColors } from '@/utils/chartStyling';

interface RechartsLineChartProps {
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

const RechartsLineChart: React.FC<RechartsLineChartProps & { axisConfig?: any }> = ({
  title = "Line Chart",
  description,
  datasets = [],
  config = {},
  layout = {},
  styling,
  className = "",
  style = {},
  axisConfig
}) => {
  const { xAxisProps, yAxisProps } = useEditableAxes({ x: axisConfig?.x_axis?.label, y: axisConfig?.y_axis?.label });
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
      <div className="mb-3" style={{ flexShrink: 0 }}>
        <EditableText as="h3" value={title} path="title" className="text-base font-semibold leading-6" style={{ color: 'var(--title-color)' }} placeholder="Chart title" />
        <EditableText as="p" value={description} path="description" className="mt-0.5 text-sm leading-5" style={{ color: 'var(--description-color)' }} placeholder="Add description" />
      </div>

      <ResponsiveContainer width="100%" height="100%" style={{ flex: 1 }}>
        <LineChart
          data={transformedData}
          margin={{
            top: 8,
            right: 14,
            left: 2,
            bottom: 6,
          }}
        >
          {styling?.gridVisible !== false && (
            <CartesianGrid
              strokeDasharray="4 6"
              vertical={false}
              stroke="var(--border-card-color)"
              strokeOpacity={0.58}
              className="chart-grid"
            />
          )}
          <XAxis
            dataKey="label"
            className="chart-axis"
            tick={{ fill: 'var(--element-color)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
           {...xAxisProps}/>
          <YAxis
            className="chart-axis"
            tick={{ fill: 'var(--element-color)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
           {...yAxisProps}/>
          <Tooltip content={<CustomTooltip />} />
          {styling?.legendPosition !== 'none' && (
            <Legend
              className="chart-legend"
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
              wrapperStyle={{ color: 'var(--description-color)', fontSize: 11, paddingTop: 8 }}
            />
          )}
          {coloredDatasets.map((dataset, index) => (
            <Line
              key={dataset.label}
              type="monotone"
              dataKey={dataset.label}
              stroke={dataset.color}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={styling?.animationEnabled !== false}
              animationDuration={styling?.animationEnabled !== false ? 1000 : 0}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsLineChart;
