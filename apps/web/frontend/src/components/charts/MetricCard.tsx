import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import type { ChartStyleVariant } from "@/utils/chartStyling";
import EditableText from "@/components/charts/edit/EditableText";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string | number;
  trend?: "up" | "down" | "stable";
  data?: Array<{label: string, value: number}>;
  dataKey?: string;
  metadata?: Record<string, any>;
  styling?: {
    tile?: { borderColor?: string; borderWidth?: number; borderRadius?: number; background?: string };
    accentColor?: string;
    trendUpColor?: string;
    trendDownColor?: string;
    text?: string;
    chartStyle?: ChartStyleVariant;
  };
  timeComparison?: {
    period?: 'mom' | 'yoy' | 'wow' | string;
    current_value?: number | null;
    previous_value?: number | null;
    percentage_change?: number | null;
  };
  className?: string;
  style?: React.CSSProperties;
}

const MetricCard = ({ 
  title, 
  value, 
  change, 
  trend, 
  data,
  dataKey = 'value',
  metadata,
  styling,
  timeComparison,
  className = "",
  style = {}
}: MetricCardProps) => {
  // Use CSS variables for all colors with semantic tokens as fallback
  const valueColor = 'var(--highlight-color)';
  const trendUp = styling?.trendUpColor || 'hsl(142 76% 36%)';
  const trendDown = styling?.trendDownColor || 'hsl(0 84% 60%)';
  const textColor = 'var(--title-color)';
  const mutedColor = 'var(--description-color)';
  // Derive display change and direction
  const pct = typeof timeComparison?.percentage_change === 'number' ? timeComparison!.percentage_change : null;
  const hasPct = pct !== null && isFinite(pct as number);
  let direction: 'up' | 'down' | 'stable' | undefined = trend;
  if (!direction && hasPct) direction = (pct as number) > 0 ? 'up' : (pct as number) < 0 ? 'down' : 'stable';
  const displayChange = (change !== undefined && change !== null && String(change).trim() !== '')
    ? String(change)
    : (hasPct ? `${(pct as number) > 0 ? '+' : ''}${Math.abs(pct as number).toFixed(2)}%` : null);
  const periodLabel = timeComparison?.period ? (timeComparison.period.toLowerCase() === 'mom' ? 'MoM' : timeComparison.period.toUpperCase()) : undefined;

  // Determine sparkline color based on trend
  const sparklineColor = direction === 'up' ? trendUp : direction === 'down' ? trendDown : textColor;
  const trendColor = direction === 'up' ? trendUp : direction === 'down' ? trendDown : textColor;
  const gradientId = `metric-gradient-${String(title).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${direction || 'stable'}`;

  // Transform data for sparkline (if provided)
  const sparklineData = data?.map((item) => ({
    label: item.label,
    [dataKey]: typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0
  }));

  return (
    <div className={`animate-fade-in h-full min-h-0 ${className}`} style={{ ...style }}>
      <div className="flex h-full min-h-0 flex-col justify-between gap-3">
        <div className="flex min-h-0 flex-1 items-stretch gap-3">
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <EditableText
              as="h3"
              value={title}
              path="title"
              className="line-clamp-2 break-words text-sm font-semibold leading-5 tracking-normal"
              style={{ color: textColor }}
              placeholder="Metric title"
            />
            <div className="min-w-0">
              <EditableText
                as="p"
                value={value}
                path="value"
                className="truncate text-2xl font-bold leading-none md:text-[1.7rem]"
                style={{ color: valueColor }}
                placeholder="0"
              />
            </div>
          </div>

          {sparklineData && sparklineData.length > 0 && (
            <div className="relative min-h-[4.75rem] w-[46%] min-w-[7rem] flex-shrink-0 overflow-hidden rounded-md">
              <svg width="0" height="0" style={{ position: 'absolute' }}>
                <defs>
                  <linearGradient id={`${gradientId}-fill`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={sparklineColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
              </svg>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparklineData} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
                  <Area
                    type="monotone"
                    dataKey={dataKey}
                    stroke={sparklineColor}
                    fill={`url(#${gradientId}-fill)`}
                    strokeWidth={2.25}
                    fillOpacity={1}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {(displayChange && direction) && (
          <div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4">
            <span className="inline-flex min-w-0 items-center gap-1 text-xs font-semibold tabular-nums" style={{ color: trendColor }}>
              {direction === 'up' && (
                <ArrowUpRight className="h-3 w-3 flex-shrink-0" aria-label="trend up" />
              )}
              {direction === 'down' && (
                <ArrowDownRight className="h-3 w-3 flex-shrink-0" aria-label="trend down" />
              )}
              {direction === 'stable' && (
                <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: textColor }} />
              )}
              <EditableText
                as="span"
                value={displayChange}
                path="change"
                className="truncate"
              />
            </span>
            <span className="truncate text-[11px] font-medium uppercase tracking-normal" style={{ color: mutedColor }}>
              {periodLabel || 'trend'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
