import { Zap, Eye, Brain, ArrowRight, Sparkles } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const ValuePropsSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const valueProps = [
    {
      icon: Zap,
      title: "Unified data aggregation",
      description: "Connect any source — local database, biz application and warehouse. AI merges & aggregates, one dashboard, all data.",
      features: ["Local Database", "Business Application", "Warehouse", "SQL Server"]
    },
    {
      icon: Eye,
      title: "Hybrid end-to-end data analytics", 
      description: "AI-driven process — auto data cleaning, metric calculation, instant insights, animated dashboards, zero manual work.",
      features: ["Data Cleaning", "Metric Calculation", "Data Modeling", "Data Analysis"]
    },
    {
      icon: Brain,
      title: "Hybrid end-to-end dashboard visualization",
      description: "Motion-first design with smooth transitions, professional aesthetics, and interactive elements. Your data never looked this good.",
      features: ["Motion-rich design", "Professional aesthetics", "Interactive elements", "Cinematic quality"]
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      {/* Background with animated elements */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background to-background"></div>
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-20 left-20 w-32 h-32 rounded-full bg-primary/20 blur-3xl animate-pulse-glow"></div>
        <div className="absolute bottom-40 right-20 w-40 h-40 rounded-full bg-secondary/20 blur-3xl animate-pulse-glow" style={{ animationDelay: '2s' }}></div>
      </div>
      
      {/* Animated elements */}
      <div className={`flex justify-center mb-8 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`}>
        <div className="flex space-x-4">
          <Sparkles className="w-5 h-5 text-primary animate-pulse" />
          <Sparkles className="w-4 h-4 text-secondary animate-pulse" style={{ animationDelay: '0.5s' }} />
          <Sparkles className="w-6 h-6 text-accent animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
      </div>
    
      <div className="relative z-10 container mx-auto px-6">
        {/* Header with icon */}
        <div className={`text-center mb-8 ${isVisible ? 'animate-fade-in' : 'opacity-0'}`}>
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 rounded-lg flex items-center justify-center">
              <img 
                src="/logo-watermark.png" 
                alt="Dreamify Logo" 
                className="w-full h-full object-contain hover:animate-spin transition-all duration-300"
              />
            </div>
          </div>
          
          {/* Title with gradient panel */}
          <h2 className="text-3xl md:text-5xl font-bold mb-4 flex items-center justify-center gap-4 flex-wrap">
            <span className="text-white">Core</span>
            <div className="gradient-panel rounded-xl px-6 py-3">
              <span className="text-white font-bold text-3xl md:text-5xl">Value Propositions</span>
            </div>
          </h2>
          
          <p className="text-md text-white/60 max-w-3xl mx-auto">
            That make Dreamify the superior choice for data visualization
          </p>
        </div>

          {/* Key benefits */}
          <div className={`grid md:grid-cols-3 gap-8 max-w-7xl mx-auto mb-8 ${isVisible ? 'animate-zoom-in' : 'opacity-0'}`} style={{ animationDelay: '0.6s' }}>
            <div className="text-center">
              <div className="w-16 h-16 icon-panel rounded-full flex items-center justify-center mb-6 transition-transform duration-300 shadow-[0_5px_5px_rgba(255,255,255),0_10px_10px_hsl(var(--primary)),0_20px_20px_hsl(var(--secondary))] mx-auto mb-4">
                <span className="text-2xl font-bold text-white">5</span>
              </div>
              <div className="text-foreground font-semibold">Minutes to Results</div>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 icon-panel rounded-full flex items-center justify-center mb-6 transition-transform duration-300 shadow-[0_5px_5px_rgba(255,255,255),0_10px_10px_hsl(var(--primary)),0_20px_20px_hsl(var(--secondary))] mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <div className="text-foreground font-semibold">AI-Powered Magic</div>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 icon-panel rounded-full flex items-center justify-center mb-6 transition-transform duration-300 shadow-[0_5px_5px_rgba(255,255,255),0_10px_10px_hsl(var(--primary)),0_20px_20px_hsl(var(--secondary))] mx-auto mb-4">
                <span className="text-xl font-bold text-white">0</span>
              </div>
              <div className="text-foreground font-semibold">Technical Setup</div>
            </div>
          </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {valueProps.map((prop, index) => (
            <div 
              key={index}
              className={`glass-panel rounded-3xl p-6 group hover:scale-105 transition-transform duration-200 flex flex-col h-full ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`}
              style={{ animationDelay: `${0.2 + index * 0.2}s` }}
            >
              {/* Icon */}
              <div className="mb-0">
                <div className="relative">
                  <div className={`w-16 h-16 icon-panel rounded-full flex items-center justify-center mb-6 transition-transform duration-300 shadow-[0_5px_5px_rgba(255,255,255),0_10px_10px_hsl(var(--primary)),0_20px_20px_hsl(var(--secondary))] ${
                    isVisible ? 'group-hover:scale-110 animate-zoom-in' : 'opacity-0'
                  }`} style={{ animationDelay: `${0.4 + index * 0.2}s` }}>
                    <prop.icon className="w-8 h-8 text-white" />
                  </div>
                  {/* Glow effect */}
                  <div className="absolute inset-0 w-16 h-16 icon-panel opacity-20 blur-xl group-hover:opacity-40 transition-opacity duration-300"></div>
                </div>
              </div>

              {/* Content */}
              <div className="space-y-4 flex-1 flex flex-col">
                <h3 className="text-xl font-bold text-white mb-0">{prop.title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">
                  {prop.description}
                </p>

                {/* Features List */}
                <ul className="space-y-2 flex-1">
                  {prop.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center text-sm text-white/60">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent mr-3"></div>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Learn More Button */}
                <div className="pt-2 mt-auto flex justify-center">
                  <button className="text-sm inline-flex items-center button-outline px-4 py-2 rounded-lg font-medium group/link">
                    Learn more
                    <ArrowRight className="w-4 h-4 ml-2 group-hover/link:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>

              {/* Hover effect overlay */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none "></div>
            </div>
          ))}
        </div>

        {/* Bottom highlight */}
        <div className={`text-center mt-8 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`} style={{ animationDelay: '0.8s' }}>
          <div className="inline-flex items-center glass-panel rounded-full hover:shadow-[0_0_10px_hsl(var(--primary)_/_0.6),_5px_5px_20px_0_hsl(var(--primary)_/_0.4),_0_0_0_1px_hsl(var(--primary)_/_0.2)] px-8 py-2">
            <Brain className="w-6 h-6 text-blue-400 mr-3 animate-pulse-glow" />
            <span className="text-muted-foreground font-medium">Powered by advanced AI technology</span>
          </div>
        </div>
      </div>
    </section>
  );
};