import { Card } from "@/components/ui/card";

interface GeographicChartProps {
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
  className?: string;
  style?: React.CSSProperties;
}

const GeographicChart = ({ 
  title = "Revenue by Location",
  description = "Geographic distribution",
  datasets = [],
  config = {},
  layout = {},
  className = "",
  style = {}
}: GeographicChartProps) => {
  // Use provided datasets or fallback to default data
  const locations = datasets.length > 0 ? 
    datasets[0]?.data.map(item => ({
      city: item.label,
      percentage: typeof item.value === 'number' ? item.value : 72,
      amount: `$${(typeof item.value === 'number' ? item.value * 4.17 : 300.56).toFixed(2)}`
    })) :
    [
      { city: "New York", percentage: 72, amount: "$300.56" },
      { city: "San Francisco", percentage: 39, amount: "$135.18" },
      { city: "Sydney", percentage: 25, amount: "$48.96" },
      { city: "Singapore", percentage: 61, amount: "$101.45" }
    ];

  const salesData = [
    { type: "Direct", percentage: 38.6, color: "bg-primary" },
    { type: "Affiliate", percentage: 45.2, color: "bg-accent" },
    { type: "Sponsored", percentage: 16.2, color: "bg-muted" }
  ];

  return (
    <Card className={`glass-panel p-6 animate-fade-in ${className}`} style={style}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Location List */}
      <div className="space-y-3 mb-6">
        {locations.map((location, index) => (
          <div key={location.city} className="animate-slide-up" style={{ animationDelay: `${index * 100}ms` }}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium">{location.city}</span>
              <span className="text-muted-foreground">{location.amount}</span>
            </div>
            <div className="w-full bg-border/30 rounded-full h-2 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${location.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Total Sales Breakdown */}
      <div>
        <h4 className="text-sm font-semibold mb-3">Total Sales</h4>
        
        {/* Pie Chart Visual */}
        <div className="relative w-24 h-24 mx-auto mb-4">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {salesData.map((item, index) => {
              const prevPercentage = salesData.slice(0, index).reduce((sum, s) => sum + s.percentage, 0);
              const circumference = 2 * Math.PI * 40;
              const strokeDasharray = circumference;
              const strokeDashoffset = circumference - (item.percentage / 100) * circumference;
              
              return (
                <circle
                  key={index}
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={`hsl(var(--${index === 0 ? 'primary' : index === 1 ? 'accent' : 'muted'}))`}
                  strokeWidth="8"
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  transform={`rotate(${(prevPercentage / 100) * 360} 50 50)`}
                  className="transition-all duration-1000 ease-out"
                />
              );
            })}
          </svg>
          
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-semibold">38.6%</span>
          </div>
        </div>

        {/* Legend */}
        <div className="space-y-2">
          {salesData.map((item, index) => (
            <div key={item.type} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${item.color}`}></div>
                <span className="text-muted-foreground">{item.type}</span>
              </div>
              <span className="font-medium">{item.percentage}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

export default GeographicChart;