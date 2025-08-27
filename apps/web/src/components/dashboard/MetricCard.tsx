import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down";
}

const MetricCard = ({ title, value, change, trend }: MetricCardProps) => {
  return (
    <Card className="glass-panel p-4 hover:scale-105 transition-all duration-300 animate-fade-in">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <div className="flex items-center gap-1 mt-1">
              {trend === "up" ? (
                <TrendingUp className="w-3 h-3 text-success" />
              ) : (
                <TrendingDown className="w-3 h-3 text-destructive" />
              )}
              <span className={`text-xs ${trend === "up" ? "text-success" : "text-destructive"}`}>
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