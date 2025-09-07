import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  change: string;
  trend: "up" | "down" | "stable";
  metadata?: Record<string, any>;
  className?: string;
  style?: React.CSSProperties;
}

const MetricCard = ({ 
  title, 
  value, 
  change, 
  trend, 
  metadata,
  className = "",
  style = {}
}: MetricCardProps) => {
  return (
    <Card className={`glass-panel p-4 hover:scale-105 transition-all duration-300 animate-fade-in ${className}`} style={style}>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <div className="flex items-center gap-1 mt-1">
              {trend === "up" ? (
                <TrendingUp className="w-3 h-3 text-success" />
              ) : trend === "down" ? (
                <TrendingDown className="w-3 h-3 text-destructive" />
              ) : (
                <div className="w-3 h-3 rounded-full bg-muted" />
              )}
              <span className={`text-xs ${
                trend === "up" ? "text-success" : 
                trend === "down" ? "text-destructive" : 
                "text-muted-foreground"
              }`}>
                {change}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default MetricCard;