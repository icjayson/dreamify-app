import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface RevenueChartProps {
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

const RevenueChart = ({ 
  title = "Revenue",
  description,
  datasets = [],
  config = {},
  layout = {},
  className = "",
  style = {}
}: RevenueChartProps) => {
  const [animationStep, setAnimationStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationStep((prev) => (prev + 1) % 6);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Use provided datasets or fallback to default data
  const revenueData = datasets.length > 0 ? 
    datasets.map(dataset => ({
      month: dataset.data[0]?.label || "Jan",
      current: typeof dataset.data[0]?.value === 'number' ? dataset.data[0].value : 58211,
      previous: typeof dataset.data[1]?.value === 'number' ? dataset.data[1].value : 45000
    })) :
    [
      { month: "Jan", current: 58211, previous: 45000 },
      { month: "Feb", current: 62000, previous: 48000 },
      { month: "Mar", current: 59000, previous: 52000 },
      { month: "Apr", current: 71000, previous: 55000 },
      { month: "May", current: 68000, previous: 58000 },
      { month: "Jun", current: 88768, previous: 62000 }
    ];

  const maxValue = Math.max(...revenueData.map(d => d.current));

  return (
    <Card className={`glass-panel p-6 animate-fade-in ${className}`} style={style}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold mb-1">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mb-2">{description}</p>
          )}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary"></div>
              <span className="text-muted-foreground">Current Week: $58,211</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-muted"></div>
              <span className="text-muted-foreground">Previous Week: $68,768</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart Area */}
      <div className="h-64 relative">
        {/* Grid Lines */}
        <div className="absolute inset-0 flex flex-col justify-between">
          {[30, 20, 10, 0].map(value => (
            <div key={value} className="flex items-center">
              <span className="text-xs text-muted-foreground w-8">{value}M</span>
              <div className="flex-1 h-px bg-border/30 ml-2"></div>
            </div>
          ))}
        </div>

        {/* Chart Lines */}
        <div className="absolute inset-0 ml-10">
          <svg className="w-full h-full" viewBox="0 0 400 200">
            {/* Previous Period Line */}
            <path
              d={`M 0 ${200 - (revenueData[0].previous / maxValue) * 160} ${revenueData.map((d, i) => 
                `L ${(i * 66.67)} ${200 - (d.previous / maxValue) * 160}`
              ).join(' ')}`}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="2"
              strokeDasharray="5,5"
              className="opacity-60"
            />
            
            {/* Current Period Line */}
            <path
              d={`M 0 ${200 - (revenueData[0].current / maxValue) * 160} ${revenueData.map((d, i) => 
                `L ${(i * 66.67)} ${200 - (d.current / maxValue) * 160}`
              ).join(' ')}`}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              className="animate-scale-in"
              style={{
                strokeDasharray: "1000",
                strokeDashoffset: animationStep < 3 ? "1000" : "0",
                transition: "stroke-dashoffset 2s ease-out"
              }}
            />

            {/* Data Points */}
            {revenueData.map((d, i) => (
              <g key={i}>
                <circle
                  cx={i * 66.67}
                  cy={200 - (d.current / maxValue) * 160}
                  r="4"
                  fill="hsl(var(--primary))"
                  className={`${i <= animationStep ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}
                />
                {i === animationStep && (
                  <circle
                    cx={i * 66.67}
                    cy={200 - (d.current / maxValue) * 160}
                    r="8"
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2"
                    className="animate-ping"
                  />
                )}
              </g>
            ))}
          </svg>

          {/* Month Labels */}
          <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-muted-foreground">
            {revenueData.map((d, i) => (
              <span key={i} className={`${i <= animationStep ? 'opacity-100' : 'opacity-50'} transition-opacity`}>
                {d.month}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default RevenueChart;