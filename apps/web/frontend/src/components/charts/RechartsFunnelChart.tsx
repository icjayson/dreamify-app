/**
 * Recharts Funnel Chart Component - Responsive funnel chart with theme integration
 */

import React from 'react';
import {
  FunnelChart,
  Funnel,
  LabelList,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

interface RechartsFunnelChartProps {
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

const RechartsFunnelChart: React.FC<RechartsFunnelChartProps> = ({
  title = "Funnel Chart",
  description,
  datasets = [],
  config = {},
  layout = {},
  styling,
  className = "",
  style = {}
}) => {
  const { getStylingClasses } = useChartTheme({ initialStyling: styling });

  const transformedData = React.useMemo(() => {
    if (datasets.length === 0) return [];
    const first = datasets[0];
    return first.data.map(point => ({
      name: point.label,
      value: typeof point.value === 'number' ? point.value : parseFloat(point.value.toString()) || 0
    }));
  }, [datasets]);

  const colors = React.useMemo(() => {
    const palette = styling?.colorPalette || ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    return transformedData.map((_, i) => palette[i % palette.length]);
  }, [transformedData, styling?.colorPalette]);

  const stylingClasses = getStylingClasses();

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      const color = colors[payload[0].index || 0];
      return (
        <div className="chart-tooltip">
          <p className="font-medium">{d.name}</p>
          <p style={{ color }}>Value: {d.value}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`chart-container ${stylingClasses} ${className}`} style={{ height: '85%', ...style }}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--title-color)' }}>{title}</h3>
        {description && (
          <p className="text-sm" style={{ color: 'var(--description-color)' }}>{description}</p>
        )}
      </div>

      <ResponsiveContainer width="100%">
        <FunnelChart>
          <Tooltip content={<CustomTooltip />} />
          {styling?.legendPosition !== 'none' && (
            <Legend 
              className="chart-legend"
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
            />
          )}
          <Funnel dataKey="value" data={transformedData} isAnimationActive={!!styling?.animationEnabled}>
            <LabelList position="right" dataKey="name" fill="var(--description-color)" stroke="none" />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsFunnelChart;


