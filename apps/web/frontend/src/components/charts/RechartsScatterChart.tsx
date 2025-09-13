/**
 * Recharts Scatter Chart Component - Responsive scatter chart with theme integration
 */

import React from 'react';
import {
  ScatterChart,
  Scatter,
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

interface RechartsScatterChartProps {
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

const RechartsScatterChart: React.FC<RechartsScatterChartProps> = ({
  title = "Scatter Chart",
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

    // For scatter chart, we need x and y values
    // We'll use the first dataset for x values and subsequent datasets for y values
    const result: Record<string, any>[] = [];
    
    if (datasets.length >= 2) {
      const xDataset = datasets[0];
      const yDataset = datasets[1];
      
      xDataset.data.forEach((xPoint, index) => {
        const yPoint = yDataset.data[index];
        if (yPoint) {
          result.push({
            x: typeof xPoint.value === 'number' ? xPoint.value : parseFloat(xPoint.value.toString()) || 0,
            y: typeof yPoint.value === 'number' ? yPoint.value : parseFloat(yPoint.value.toString()) || 0,
            label: xPoint.label
          });
        }
      });
    } else if (datasets.length === 1) {
      // Single dataset - use index as x, value as y
      datasets[0].data.forEach((point, index) => {
        result.push({
          x: index,
          y: typeof point.value === 'number' ? point.value : parseFloat(point.value.toString()) || 0,
          label: point.label
        });
      });
    }
    
    return result;
  }, [datasets]);

  // Assign colors to datasets
  const coloredDatasets = React.useMemo(() => {
    return assignColors(datasets);
  }, [datasets, assignColors]);

  // Get styling classes
  const stylingClasses = getStylingClasses();

  // Custom tooltip component
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="chart-tooltip">
          <p className="font-medium">{data.label}</p>
          <p style={{ color: payload[0].color }}>
            X: {data.x}
          </p>
          <p style={{ color: payload[0].color }}>
            Y: {data.y}
          </p>
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
        <ScatterChart
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
            type="number"
            dataKey="x"
            name="X"
            className="chart-axis"
            tick={{ fill: 'hsl(var(--chart-axis-text))' }}
          />
          <YAxis 
            type="number"
            dataKey="y"
            name="Y"
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
          <Scatter
            dataKey="y"
            fill={coloredDatasets[0]?.color || '#2563eb'}
            animationDuration={styling?.animationEnabled ? 1000 : 0}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsScatterChart;
