/**
 * Recharts Stacked Bar / Stacked Column Chart Component
 *
 * Handles two chart types:
 *  - stacked_column (ChartType.STACKED_COLUMN): vertical bars, categories on X-axis (default)
 *  - stacked_bar    (ChartType.STACKED_BAR):    horizontal bars, categories on Y-axis
 *
 * Stacking is achieved via `stackId="stack"` shared by all <Bar> elements.
 * Optional `config.normalized` (boolean) pre-processes data to 100% scale.
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
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';
import EditableText from '@/components/charts/edit/EditableText';
import { useEditableAxes } from '@/components/charts/edit/useEditableAxes';

interface StackedBarDataPoint {
  label: string;
  value: number | string;
  metadata?: Record<string, any>;
}

interface StackedBarDataset {
  label: string;
  data: StackedBarDataPoint[];
  color?: string;
  metadata?: Record<string, any>;
}

interface RechartsStackedBarChartProps {
  title?: string;
  description?: string;
  datasets?: StackedBarDataset[];
  /**
   * orientation:
   *  'vertical'   → stacked COLUMN chart (default) — tall bars, X-axis is categories
   *  'horizontal' → stacked BAR chart — wide bars, Y-axis is categories
   * Can also be specified via config.orientation.
   */
  orientation?: 'vertical' | 'horizontal';
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pivot the datasets (multiple series) into the flat-map format that Recharts
 * expects: [{ label: "Jan", "Revenue": 100, "Expenses": 80 }, …]
 */
function pivotDatasets(datasets: StackedBarDataset[]): Record<string, any>[] {
  if (datasets.length === 0) return [];

  const allLabels = new Set<string>();
  datasets.forEach(ds => {
    if (Array.isArray(ds.data)) {
      ds.data.forEach(pt => allLabels.add(pt.label));
    }
  });

  return Array.from(allLabels).map(label => {
    const row: Record<string, any> = { label };
    datasets.forEach(ds => {
      if (Array.isArray(ds.data)) {
        const pt = ds.data.find(p => p.label === label);
        row[ds.label] = pt ? Number(pt.value) || 0 : 0;
      } else {
        row[ds.label] = 0;
      }
    });
    return row;
  });
}

/**
 * Normalize each row so all series sum to 100 (for percentage-stack mode).
 */
function normalizeRows(
  rows: Record<string, any>[],
  seriesKeys: string[],
): Record<string, any>[] {
  return rows.map(row => {
    const total = seriesKeys.reduce((sum, k) => sum + (Number(row[k]) || 0), 0);
    const newRow: Record<string, any> = { label: row.label };
    seriesKeys.forEach(k => {
      newRow[k] = total > 0 ? parseFloat(((Number(row[k]) / total) * 100).toFixed(2)) : 0;
    });
    return newRow;
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

const RechartsStackedBarChart: React.FC<RechartsStackedBarChartProps & { axisConfig?: any }> = ({
  title = 'Stacked Chart',
  description,
  datasets = [],
  orientation: orientationProp,
  config = {},
  layout = {},
  styling,
  className = '',
  style = {},
  axisConfig
}) => {
  const { xAxisProps: editXAxisProps, yAxisProps: editYAxisProps } = useEditableAxes({ x: axisConfig?.x_axis?.label, y: axisConfig?.y_axis?.label });
  const { assignColors, getStylingClasses } = useChartTheme({ initialStyling: styling });

  // Resolve orientation: component prop > config.orientation > default 'vertical'
  const orientation: 'vertical' | 'horizontal' =
    orientationProp ?? (config.orientation as 'vertical' | 'horizontal') ?? 'vertical';

  const isNormalized = Boolean(config.normalized);

  // ── Data transformation ──────────────────────────────────────────────────
  const coloredDatasets = React.useMemo(() => assignColors(datasets), [datasets, assignColors]);

  const transformedData = React.useMemo(() => {
    const pivoted = pivotDatasets(coloredDatasets);
    if (isNormalized) {
      const keys = coloredDatasets.map(ds => ds.label);
      return normalizeRows(pivoted, keys);
    }
    return pivoted;
  }, [coloredDatasets, isNormalized]);

  const stylingClasses = getStylingClasses();

  // ── Custom Tooltip ───────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="chart-tooltip">
        <p className="font-medium mb-1" style={{ color: 'var(--title-color)' }}>
          {label}
        </p>
        {payload.map((entry: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2" style={{ color: 'var(--element-color)' }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: entry.fill,
                flexShrink: 0,
              }}
            />
            <span>
              {entry.dataKey}:{' '}
              <strong>
                {isNormalized
                  ? `${entry.value}%`
                  : typeof entry.value === 'number'
                  ? entry.value.toLocaleString()
                  : entry.value}
              </strong>
            </span>
          </div>
        ))}
        {isNormalized && (
          <p className="mt-1 text-xs" style={{ color: 'var(--description-color)' }}>
            (% of total)
          </p>
        )}
      </div>
    );
  };

  // ── Recharts layout flags ────────────────────────────────────────────────
  //
  // Recharts naming is counter-intuitive:
  //   BarChart layout="horizontal" → vertical columns (categories on X-axis) ← DEFAULT
  //   BarChart layout="vertical"   → horizontal bars  (categories on Y-axis)
  //
  // We flip this to match common UX terminology:
  //   orientation='vertical'   → stacked COLUMN (bars point upward)   → layout="horizontal"
  //   orientation='horizontal' → stacked BAR (bars point rightward)   → layout="vertical"
  const rechartsLayout = orientation === 'horizontal' ? 'vertical' : 'horizontal';

  // ── Bar radius — round only the last (top-most) segment to avoid artifacts
  const lastIndex = coloredDatasets.length - 1;

  return (
    <div
      className={`chart-container ${stylingClasses} ${className}`}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', ...style }}
    >
      {/* Header */}
      <div className="mb-4" style={{ flexShrink: 0 }}>
        <EditableText as="h3" value={title} path="title" className="text-lg font-semibold mb-1" style={{ color: 'var(--title-color)' }} placeholder="Chart title" />
        <EditableText as="p" value={description} path="description" className="text-sm" style={{ color: 'var(--description-color)' }} placeholder="Add description" />
      </div>

      <ResponsiveContainer width="100%" height="100%" style={{ flex: 1 }}>
        <BarChart
          data={transformedData}
          layout={rechartsLayout}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          barCategoryGap="20%"
        >
          {styling?.gridVisible !== false && (
            <CartesianGrid
              strokeDasharray="3 3"
              className="chart-grid"
              horizontal={orientation !== 'horizontal'}
              vertical={orientation === 'horizontal'}
            />
          )}

          {/* XAxis */}
          <XAxis
            {...(orientation === 'horizontal'
              ? { type: 'number' as const, tick: { fill: 'var(--element-color)' }, tickFormatter: isNormalized ? (v: number) => `${v}%` : undefined }
              : { dataKey: 'label', type: 'category' as const, tick: { fill: 'var(--element-color)' } }
            )}
            className="chart-axis"
            {...editXAxisProps}
          />

          {/* YAxis */}
          <YAxis
            {...(orientation === 'horizontal'
              ? { dataKey: 'label', type: 'category' as const, tick: { fill: 'var(--element-color)' }, width: 100 }
              : { type: 'number' as const, tick: { fill: 'var(--element-color)' }, tickFormatter: isNormalized ? (v: number) => `${v}%` : undefined }
            )}
            className="chart-axis"
            {...editYAxisProps}
          />

          <Tooltip content={<CustomTooltip />} />

          {styling?.legendPosition !== 'none' && (
            <Legend
              className="chart-legend"
              verticalAlign={styling?.legendPosition === 'top' ? 'top' : 'bottom'}
            />
          )}

          {coloredDatasets.map((dataset, index) => {
            const isLast = index === lastIndex;
            // Round top corners only on the topmost segment (last in render order)
            const barRadius: [number, number, number, number] =
              orientation === 'horizontal'
                ? isLast ? [0, 4, 4, 0] : [0, 0, 0, 0]  // rightmost segment → round right
                : isLast ? [4, 4, 0, 0] : [0, 0, 0, 0];  // topmost segment → round top

            return (
              <Bar
                key={dataset.label}
                dataKey={dataset.label}
                stackId="stack"
                fill={dataset.color}
                radius={barRadius}
                isAnimationActive={styling?.animationEnabled !== false}
                animationDuration={styling?.animationEnabled !== false ? 800 : 0}
                animationBegin={index * 80}
              />
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsStackedBarChart;
