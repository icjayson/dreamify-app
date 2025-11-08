/**
 * Recharts Radial Bar Chart Component - Responsive radial bar chart with theme integration
 */

import React from 'react';
import {
  RadialBarChart,
  RadialBar,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

interface RechartsRadialBarChartProps {
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

const RechartsRadialBarChart: React.FC<RechartsRadialBarChartProps> = ({
  title = "Radial Bar Chart",
  description,
  datasets = [],
  config = {},
  layout = {},
  styling,
  className = "",
  style = {}
}) => {
  const { getStylingClasses } = useChartTheme({ initialStyling: styling });

  // Transform data - use first dataset, with palette-driven colors
  const transformedData = React.useMemo(() => {
    if (datasets.length === 0) return [];
    const first = datasets[0];
    const palette = styling?.colorPalette || ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    return first.data.map((point, index) => ({
      name: point.label,
      value: typeof point.value === 'number' ? point.value : parseFloat(point.value.toString()) || 0,
      fill: palette[index % palette.length]
    }));
  }, [datasets, styling?.colorPalette]);

  const stylingClasses = getStylingClasses();

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="chart-tooltip">
          <p className="font-medium">{d.name}</p>
          <p style={{ color: d.fill }}>Value: {d.value}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`chart-container ${stylingClasses} ${className}`} style={{ height: '100%', ...style }}>
      <div className="mb-4" style={{ flexShrink: 0 }}>
        <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--title-color)' }}>{title}</h3>
        {description && (
          <p className="text-sm" style={{ color: 'var(--description-color)' }}>{description}</p>
        )}
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={transformedData}
          innerRadius="20%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
        >
          <Tooltip content={<CustomTooltip />} />
          {styling?.legendPosition !== 'none' && (
            <Legend 
              className="chart-legend"
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
            />
          )}
          <RadialBar
            dataKey="value"
            background
            cornerRadius={6}
            animationDuration={styling?.animationEnabled ? 1000 : 0}
          />
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsRadialBarChart;


