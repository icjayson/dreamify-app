import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";

interface ProjectionsChartProps {
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

const ProjectionsChart = ({ 
  title = "Projections vs Actuals",
  description = "30M projected target",
  datasets = [],
  config = {},
  layout = {},
  className = "",
  style = {}
}: ProjectionsChartProps) => {
  const [animationStep, setAnimationStep] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationStep(1);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Use provided datasets or fallback to default data
  const data = datasets.length > 0 ? 
    datasets.map(dataset => ({
      month: dataset.data[0]?.label || "Jan",
      actual: typeof dataset.data[0]?.value === 'number' ? dataset.data[0].value : 20,
      projected: typeof dataset.data[1]?.value === 'number' ? dataset.data[1].value : 30
    })) :
    [
      { month: "Jan", actual: 20, projected: 30 },
      { month: "Feb", actual: 25, projected: 30 },
      { month: "Mar", actual: 30, projected: 30 },
      { month: "Apr", actual: 28, projected: 30 },
      { month: "May", actual: 32, projected: 30 },
      { month: "Jun", actual: 35, projected: 30 }
    ];

  return (
    <Card className={`glass-panel p-6 animate-fade-in ${className}`} style={style}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Bar Chart */}
      <div className="h-64 flex items-end justify-between gap-2">
        {data.map((item, index) => (
          <div key={item.month} className="flex flex-col items-center flex-1">
            <div className="relative w-full flex gap-1 items-end h-48">
              {/* Actual Bar */}
              <div className="flex-1 bg-border/30 rounded-t-sm overflow-hidden">
                <div 
                  className="bg-gradient-to-t from-primary to-primary/70 rounded-t-sm transition-all duration-1000 ease-out"
                  style={{ 
                    height: animationStep ? `${(item.actual / 35) * 100}%` : '0%',
                    transitionDelay: `${index * 100}ms`
                  }}
                />
              </div>
              
              {/* Projected Bar */}
              <div className="flex-1 bg-border/30 rounded-t-sm overflow-hidden">
                <div 
                  className="bg-gradient-to-t from-muted to-muted/70 rounded-t-sm transition-all duration-1000 ease-out"
                  style={{ 
                    height: animationStep ? `${(item.projected / 35) * 100}%` : '0%',
                    transitionDelay: `${index * 100 + 50}ms`
                  }}
                />
              </div>
            </div>
            
            <span className="text-xs text-muted-foreground mt-2">{item.month}</span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-primary"></div>
          <span className="text-muted-foreground">Actuals</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-muted"></div>
          <span className="text-muted-foreground">Projections</span>
        </div>
      </div>
    </Card>
  );
};

export default ProjectionsChart;