/**
 * Recharts Radar Chart Component - Responsive radar chart with theme integration
 */

import React from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { ChartConfiguration } from '@/types/dashboard';
import { useChartTheme } from '@/hooks/useChartTheme';

interface RechartsRadarChartProps {
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

const RechartsRadarChart: React.FC<RechartsRadarChartProps> = ({
  title = "Radar Chart",
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

    const allLabels = new Set<string>();
    datasets.forEach(dataset => {
      dataset.data.forEach(point => {
        allLabels.add(point.label);
      });
    });

    return Array.from(allLabels).map(label => {
      const dataPoint: Record<string, any> = { label };
      datasets.forEach(dataset => {
        const point = dataset.data.find(p => p.label === label);
        const raw = point ? point.value : 0;
        dataPoint[dataset.label] = typeof raw === 'number' ? raw : parseFloat(raw.toString()) || 0;
      });
      return dataPoint;
    });
  }, [datasets]);

  const coloredDatasets = React.useMemo(() => {
    return assignColors(datasets);
  }, [datasets, assignColors]);

  const stylingClasses = getStylingClasses();

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
    <div className={`chart-container ${stylingClasses} ${className}`} style={{ height: '85%', ...style }}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--title-color)' }}>{title}</h3>
        {description && (
          <p className="text-sm" style={{ color: 'var(--description-color)' }}>{description}</p>
        )}
      </div>

      <ResponsiveContainer width="100%">
        <RadarChart data={transformedData} outerRadius={90}>
          <PolarGrid className="chart-grid" />
          <PolarAngleAxis dataKey="label" className="chart-axis" tick={{ fill: 'var(--element-color)' }} />
          <PolarRadiusAxis className="chart-axis" tick={{ fill: 'var(--element-color)' }} />
          <Tooltip content={<CustomTooltip />} />
          {styling?.legendPosition !== 'none' && (
            <Legend 
              className="chart-legend"
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
            />
          )}
          {coloredDatasets.map(dataset => (
            <Radar
              key={dataset.label}
              name={dataset.label}
              dataKey={dataset.label}
              stroke={dataset.color}
              fill={dataset.color}
              fillOpacity={0.4}
              animationDuration={styling?.animationEnabled ? 1000 : 0}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsRadarChart;


