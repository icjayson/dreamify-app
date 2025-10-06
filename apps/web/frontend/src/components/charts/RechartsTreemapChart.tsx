/**
 * Recharts Treemap Chart Component - Responsive treemap with theme integration
 */

import React from 'react';
import { Treemap, Tooltip, ResponsiveContainer } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

interface RechartsTreemapChartProps {
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

const RechartsTreemapChart: React.FC<RechartsTreemapChartProps> = ({
  title = "Treemap",
  description,
  datasets = [],
  config = {},
  layout = {},
  styling,
  className = "",
  style = {}
}) => {
  const { getStylingClasses } = useChartTheme({ initialStyling: styling });

  const treemapData = React.useMemo(() => {
    if (datasets.length === 0) return [] as any[];
    const first = datasets[0];
    const children = first.data.map((point, index) => ({
      name: point.label,
      size: typeof point.value === 'number' ? point.value : parseFloat(point.value.toString()) || 0,
      index
    }));
    return [{ name: title, children }];
  }, [datasets, title]);

  const palette = React.useMemo(() => {
    return styling?.colorPalette || ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  }, [styling?.colorPalette]);

  const stylingClasses = getStylingClasses();

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      const color = palette[(d.index || 0) % palette.length];
      return (
        <div className="chart-tooltip">
          <p className="font-medium">{d.name}</p>
          <p style={{ color }}>Value: {d.size}</p>
        </div>
      );
    }
    return null;
  };

  const colorFn = (node: any) => palette[(node.index || 0) % palette.length];

  return (
    <div className={`chart-container ${stylingClasses} ${className}`} style={style}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <Treemap
          data={treemapData}
          dataKey="size"
          stroke="#fff"
          fill="#8884d8"
          isAnimationActive={!!styling?.animationEnabled}
          content={(props: any) => {
            const { x, y, width, height, index, name } = props;
            const fill = colorFn(props);
            return (
              <g>
                <rect x={x} y={y} width={width} height={height} style={{ fill, stroke: '#fff' }} />
                {width > 60 && height > 14 && (
                  <text x={x + 4} y={y + 14} fill="#fff" fontSize={12} pointerEvents="none">
                    {name}
                  </text>
                )}
              </g>
            );
          }}
        />
      </ResponsiveContainer>
      <Tooltip content={<CustomTooltip />} />
    </div>
  );
};

export default RechartsTreemapChart;


