import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string | number;
  trend?: "up" | "down" | "stable";
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
  metadata,
  styling,
  timeComparison,
  className = "",
  style = {}
}: MetricCardProps) => {
  const borderColor = styling?.tile?.borderColor || 'hsl(220 14% 90%)';
  const borderWidth = styling?.tile?.borderWidth ?? 1;
  const borderRadius = styling?.tile?.borderRadius ?? 12;
  const background = styling?.tile?.background || 'hsl(0 0% 100%)';
  const valueColor = styling?.accentColor;
  const trendUp = styling?.trendUpColor || 'hsl(142 76% 36%)';
  const trendDown = styling?.trendDownColor || 'hsl(0 84% 60%)';
  const textColor = styling?.text;
  // Derive display change and direction
  const pct = typeof timeComparison?.percentage_change === 'number' ? timeComparison!.percentage_change : null;
  const hasPct = pct !== null && isFinite(pct as number);
  let direction: 'up' | 'down' | 'stable' | undefined = trend as any;
  if (!direction && hasPct) direction = (pct as number) > 0 ? 'up' : (pct as number) < 0 ? 'down' : 'stable';
  const displayChange = (change !== undefined && change !== null && String(change).trim() !== '')
    ? String(change)
    : (hasPct ? `${(pct as number) > 0 ? '+' : ''}${Math.abs(pct as number).toFixed(2)}%` : null);
  const periodLabel = timeComparison?.period ? (timeComparison.period.toLowerCase() === 'mom' ? 'MoM' : timeComparison.period.toUpperCase()) : undefined;

  return (
    <div className={`p-4 rounded-md hover:scale-105 transition-all duration-300 animate-fade-in ${className}`}
      style={{ border: `${borderWidth}px solid ${borderColor}`, borderRadius, backgroundColor: background, ...style }}>
      <div className="space-y-2">
        <p className="text-sm" style={{ color: textColor || 'inherit' }}>{title}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold" style={{ color: valueColor || 'inherit' }}>{value}</p>
            {(displayChange && direction) && (
              <div className="flex items-center gap-2 mt-1">
                {direction === 'up' && (
                  <TrendingUp className="w-3 h-3" aria-label="trend up" style={{ color: trendUp }} />
                )}
                {direction === 'down' && (
                  <TrendingDown className="w-3 h-3" aria-label="trend down" style={{ color: trendDown }} />
                )}
                {direction === 'stable' && (
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: textColor || 'hsl(220 9% 46%)' }} />
                )}
                <span className="text-xs font-medium" style={{ color: direction === 'up' ? trendUp : direction === 'down' ? trendDown : (textColor || 'inherit') }}>
                  {displayChange}
                </span>
                {periodLabel && (
                  <span className="text-[10px] opacity-75" style={{ color: textColor || 'inherit' }}>{periodLabel}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MetricCard;


