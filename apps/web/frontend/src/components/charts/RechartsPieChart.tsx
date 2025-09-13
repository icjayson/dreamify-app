/**
 * Recharts Pie Chart Component - Responsive pie chart with theme integration
 */

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { ChartConfiguration } from '@/types/dashboard';
import { useChartTheme } from '@/hooks/useChartTheme';
import { assignDatasetColors } from '@/utils/chartStyling';

interface RechartsPieChartProps {
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

const RechartsPieChart: React.FC<RechartsPieChartProps> = ({
  title = "Pie Chart",
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

  // Transform data for Recharts format (use first dataset for pie chart)
  const transformedData = React.useMemo(() => {
    if (datasets.length === 0) return [];

    const firstDataset = datasets[0];
    return firstDataset.data.map(point => ({
      name: point.label,
      value: typeof point.value === 'number' ? point.value : parseFloat(point.value.toString()) || 0
    }));
  }, [datasets]);

  // Assign colors to datasets
  const coloredDatasets = React.useMemo(() => {
    return assignColors(datasets);
  }, [datasets, assignColors]);

  // Get colors for pie slices
  const colors = React.useMemo(() => {
    return coloredDatasets[0]?.color ? 
      transformedData.map((_, index) => {
        const colorPalette = styling?.colorPalette || ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
        return colorPalette[index % colorPalette.length];
      }) : 
      ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  }, [coloredDatasets, transformedData, styling?.colorPalette]);

  // Get styling classes
  const stylingClasses = getStylingClasses();

  // Custom tooltip component
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="chart-tooltip">
          <p className="font-medium">{data.name}</p>
          <p style={{ color: data.payload.fill }}>
            Value: {data.value}
          </p>
          <p style={{ color: data.payload.fill }}>
            Percentage: {data.percent ? (data.percent * 100).toFixed(1) : 0}%
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
        <PieChart>
          <Pie
            data={transformedData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
            animationDuration={styling?.animationEnabled ? 1000 : 0}
          >
            {transformedData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          {styling?.legendPosition !== 'none' && (
            <Legend 
              className="chart-legend"
              wrapperStyle={{ color: 'hsl(var(--chart-legend-text))' }}
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsPieChart;
