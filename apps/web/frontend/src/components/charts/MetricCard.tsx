import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

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
  const borderColor = 'var(--border-card-color)';
  const borderWidth = styling?.tile?.borderWidth ?? 1;
  const borderRadius = styling?.tile?.borderRadius ?? 12;
  const background = 'var(--bg-card-color)'; // Always use CSS variable for card background
  const valueColor = 'var(--highlight-color)';
  const trendUp = styling?.trendUpColor || 'hsl(142 76% 36%)';
  const trendDown = styling?.trendDownColor || 'hsl(0 84% 60%)';
  const textColor = 'var(--title-color)';
  // Derive display change and direction
  const pct = typeof timeComparison?.percentage_change === 'number' ? timeComparison!.percentage_change : null;
  const hasPct = pct !== null && isFinite(pct as number);
  let direction: 'up' | 'down' | 'stable' | undefined = trend as any;
  if (!direction && hasPct) direction = (pct as number) > 0 ? 'up' : (pct as number) < 0 ? 'down' : 'stable';
  const displayChange = (change !== undefined && change !== null && String(change).trim() !== '')
    ? String(change)
    : (hasPct ? `${(pct as number) > 0 ? '+' : ''}${Math.abs(pct as number).toFixed(2)}%` : null);
  const periodLabel = timeComparison?.period ? (timeComparison.period.toLowerCase() === 'mom' ? 'MoM' : timeComparison.period.toUpperCase()) : undefined;

  // Determine sparkline color based on trend
  const sparklineColor = direction === 'up' ? trendUp : direction === 'down' ? trendDown : textColor;
  const gradientId = `gradient-${direction || 'stable'}`;

  // Transform data for sparkline (if provided)
  const sparklineData = data?.map((item) => ({
    label: item.label,
    [dataKey]: typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0
  }));

  return (
    <div className={`rounded-md animate-fade-in h-full ${className}`}
      style={{ borderRadius, backgroundColor: background, ...style }}>
      <div className="flex items-stretch h-full">
        {/* Left Side: Text Content */}
        <div className="flex-1 flex flex-col justify-between pr-2 min-w-0">
          <p className="text-sm" style={{ color: textColor }}>{title}</p>
          <div>
            <p className="text-2xl font-bold" style={{ color: valueColor }}>{value}</p>
            {(displayChange && direction) && (
              <div className="flex items-center gap-1.5 mt-1">
                {direction === 'up' && (
                  <ArrowUpRight className="w-3 h-3" aria-label="trend up" style={{ color: trendUp }} />
                )}
                {direction === 'down' && (
                  <ArrowDownRight className="w-3 h-3" aria-label="trend down" style={{ color: trendDown }} />
                )}
                {direction === 'stable' && (
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: textColor }} />
                )}
                <span className="text-xs font-medium" style={{ color: direction === 'up' ? trendUp : direction === 'down' ? trendDown : textColor }}>
                  {displayChange}
                </span>
                {periodLabel && (
                  <span className="text-[10px] opacity-75" style={{ color: textColor }}>{periodLabel}</span>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Right Side: Sparkline */}
        {sparklineData && sparklineData.length > 0 && (
          <div className="w-1/2 flex-shrink-0 h-full">
            <svg width="0" height="0" style={{ position: 'absolute' }}>
              <defs>
                <linearGradient id={`${gradientId}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={sparklineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
            </svg>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Area
                  type="monotone"
                  dataKey={dataKey}
                  stroke={sparklineColor}
                  fill={`url(#${gradientId}-fill)`}
                  strokeWidth={2}
                  fillOpacity={0.6}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;


