import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";

const ProjectionsChart = () => {
  const [animationStep, setAnimationStep] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationStep(1);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const data = [
    { month: "Jan", actual: 20, projected: 30 },
    { month: "Feb", actual: 25, projected: 30 },
    { month: "Mar", actual: 30, projected: 30 },
    { month: "Apr", actual: 28, projected: 30 },
    { month: "May", actual: 32, projected: 30 },
    { month: "Jun", actual: 35, projected: 30 }
  ];

  return (
    <Card className="glass-panel p-6 animate-fade-in">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-1">Projections vs Actuals</h3>
        <p className="text-sm text-muted-foreground">30M projected target</p>
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