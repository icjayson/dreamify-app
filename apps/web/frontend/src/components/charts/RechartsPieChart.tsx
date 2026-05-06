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
import { useChartTheme } from '@/hooks/useChartTheme';
import EditableText from '@/components/charts/edit/EditableText';
import { assignDatasetColors, isLightBackground } from '@/utils/chartStyling';

const LABEL_PERCENT_THRESHOLD = 0.03;
const DENSE_THRESHOLD = 6;
const AGGREGATE_THRESHOLD = 12;
const OTHERS_COLOR = '#94a3b8';

interface RechartsPieChartProps {
  title?: string;
  description?: string;
  datasets?: Array<{
    label: string;
    data: Array<{
      label?: string;
      name?: string;
      value?: number | string;
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
    return firstDataset.data.map(point => {
      const rawValue = point.value;
      const numValue =
        typeof rawValue === 'number'
          ? rawValue
          : rawValue != null
            ? parseFloat(String(rawValue)) || 0
            : 0;
      return {
        name: point.label ?? point.name ?? '',
        value: numValue
      };
    });
  }, [datasets]);

  // Collapse slices below threshold into "Others" when there are too many
  const displayData = React.useMemo(() => {
    if (transformedData.length <= AGGREGATE_THRESHOLD) return transformedData;

    const total = transformedData.reduce((s, d) => s + d.value, 0);
    const visible: typeof transformedData = [];
    let othersValue = 0;

    for (const slice of transformedData) {
      if (total > 0 && slice.value / total >= LABEL_PERCENT_THRESHOLD) {
        visible.push(slice);
      } else {
        othersValue += slice.value;
      }
    }
    if (othersValue > 0) visible.push({ name: 'Others', value: othersValue });
    return visible;
  }, [transformedData]);

  const isDense = displayData.length > DENSE_THRESHOLD;

  // Assign colors to datasets
  const coloredDatasets = React.useMemo(() => {
    return assignColors(datasets);
  }, [datasets, assignColors]);

  // Total for manual % calculation — recharts does NOT include `percent` in tooltipPayload
  const total = React.useMemo(
    () => displayData.reduce((s, d) => s + d.value, 0),
    [displayData]
  );

  // Get colors for pie slices
  const colors = React.useMemo(() => {
    const colorPalette = styling?.colorPalette || ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    return displayData.map((entry, index) => {
      if (entry.name === 'Others') return OTHERS_COLOR;
      return coloredDatasets[0]?.color
        ? colorPalette[index % colorPalette.length]
        : colorPalette[index % colorPalette.length];
    });
  }, [coloredDatasets, displayData, styling?.colorPalette]);

  // Get styling classes
  const stylingClasses = getStylingClasses();
  const labelFillColor = isLightBackground(styling?.presetTheme) ? 'var(--title-color)' : '#fff';

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
            Percentage: {total > 0 ? ((data.value / total) * 100).toFixed(1) : '0'}%
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`chart-container ${stylingClasses} ${className}`} style={{ height: '100%', display: 'flex', flexDirection: 'column', ...style }}>
      <div className="mb-4" style={{ flexShrink: 0 }}>
        <EditableText as="h3" value={title} path="title" className="text-lg font-semibold mb-1" style={{ color: 'var(--title-color)' }} placeholder="Chart title" />
        <EditableText as="p" value={description} path="description" className="text-sm" style={{ color: 'var(--description-color)' }} placeholder="Add description" />
      </div>

      <ResponsiveContainer width="100%" height="100%" style={{ flex: 1 }}>
        <PieChart>
          <Pie
            data={displayData}
            cx="50%"
            cy="50%"
            labelLine={isDense ? false : { stroke: labelFillColor, strokeWidth: 1, opacity: 0.4 }}
            label={isDense ? false : ({ name, percent, cx, cy, midAngle, outerRadius }) => {
              if (percent < LABEL_PERCENT_THRESHOLD) return null;
              const RADIAN = Math.PI / 180;
              const r = outerRadius + 20;
              const x = cx + r * Math.cos(-midAngle * RADIAN);
              const y = cy + r * Math.sin(-midAngle * RADIAN);
              return (
                <text x={x} y={y} fill={labelFillColor} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11}>
                  {`${name} ${(percent * 100).toFixed(0)}%`}
                </text>
              );
            }}
            outerRadius={isDense ? 100 : 80}
            fill="#8884d8"
            dataKey="value"
            isAnimationActive={styling?.animationEnabled !== false}
            animationDuration={styling?.animationEnabled !== false ? 1000 : 0}
          >
            {displayData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          {(styling?.legendPosition !== 'none' || isDense) && (
            <Legend
              className="chart-legend"
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsPieChart;
