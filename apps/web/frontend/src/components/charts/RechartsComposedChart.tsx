/**
 * Recharts Composed Chart Component - Responsive composed chart with theme integration
 */

import React from 'react';
import {
  ComposedChart,
  Line,
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

interface RechartsComposedChartProps {
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

const RechartsComposedChart: React.FC<RechartsComposedChartProps> = ({
  title = "Composed Chart",
  description,
  datasets = [],
  config = {},
  layout = {},
  styling,
  className = "",
  style = {}
}) => {
  const { assignColors, getStylingClasses } = useChartTheme({
    initialStyling: styling
  });

  // Transform data for Recharts format
  const transformedData = React.useMemo(() => {
    if (datasets.length === 0) return [];

    // Get all unique labels from all datasets
    const allLabels = new Set<string>();
    datasets.forEach(dataset => {
      dataset.data.forEach(point => {
        allLabels.add(point.label);
      });
    });

    // Create data points for each label
    return Array.from(allLabels).map(label => {
      const dataPoint: Record<string, any> = { label };
      
      datasets.forEach(dataset => {
        const point = dataset.data.find(p => p.label === label);
        dataPoint[dataset.label] = point ? point.value : 0;
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
    <div className={`chart-container ${stylingClasses} ${className}`} style={style}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={transformedData}
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 20,
          }}
        >
          <CartesianGrid 
            strokeDasharray="3 3" 
            className="chart-grid"
            stroke="hsl(var(--chart-grid-color))"
            strokeOpacity="var(--chart-grid-opacity)"
          />
          <XAxis 
            dataKey="label" 
            className="chart-axis"
            tick={{ fill: 'hsl(var(--chart-axis-text))' }}
          />
          <YAxis 
            className="chart-axis"
            tick={{ fill: 'hsl(var(--chart-axis-text))' }}
          />
          <Tooltip content={<CustomTooltip />} />
          {styling?.legendPosition !== 'none' && (
            <Legend 
              className="chart-legend"
              wrapperStyle={{ color: 'hsl(var(--chart-legend-text))' }}
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
            />
          )}
          {coloredDatasets.map((dataset, index) => {
            // Alternate between Bar and Line for visual variety
            if (index % 2 === 0) {
              return (
                <Bar
                  key={dataset.label}
                  dataKey={dataset.label}
                  fill={dataset.color}
                  radius={[4, 4, 0, 0]}
                  animationDuration={styling?.animationEnabled ? 1000 : 0}
                />
              );
            } else {
              return (
                <Line
                  key={dataset.label}
                  type="monotone"
                  dataKey={dataset.label}
                  stroke={dataset.color}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  animationDuration={styling?.animationEnabled ? 1000 : 0}
                />
              );
            }
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsComposedChart;
