import { Check, X, Sparkles, Zap, Brain } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const ProblemSolutionSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const comparison = [
    {
      category: "Time to Create",
      traditional: "Hours/Days",
      basicBI: "30+ minutes", 
      dreamify: "5 minutes",
      highlight: true,
      dreamifyIcon: true
    },
    {
      category: "Technical Setup",
      traditional: "Complex configuration",
      basicBI: "Some setup required",
      dreamify: "Zero setup",
      highlight: true,
      dreamifyIcon: true
    },
    {
      category: "Visual Quality",
      traditional: "Static, boring",
      basicBI: "Basic charts",
      dreamify: "Motion-rich cinematic",
      highlight: true,
      dreamifyIcon: true
    },
    {
      category: "Collaboration",
      traditional: "Manual refinement",
      basicBI: "Template suggestions",
      dreamify: "Real-time AI collaboration",
      highlight: false,
      dreamifyIcon: true
    },
    {
      category: "User Experience",
      traditional: "Technical complexity",
      basicBI: "Limited customization",
      dreamify: "Natural conversation",
      highlight: true,
      dreamifyIcon: true
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-background"></div>
      
      {/* Animated elements */}
      <div className={`flex justify-center mb-4 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`}>
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
          <div className="flex justify-center mb-4">
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
            <span className="text-white">Stop struggling with</span>
            <div className="gradient-panel rounded-xl px-6 py-3">
              <span className="text-white font-bold text-3xl md:text-5xl">outdated tools</span>
            </div>
          </h2>
          
          <p className="text-md text-white/60 max-w-3xl mx-auto">
            Compare Dreamify with traditional dashboard solutions and basic BI tools
          </p>
        </div>

        {/* Comparison Table */}
        <div className={`max-w-5xl mx-auto ${isVisible ? 'animate-zoom-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
          <div className="glass-panel rounded-3xl overflow-hidden transition-transform duration-200">
            {/* Headers */}
            <div className="grid grid-cols-4 border-b border-slate-700/50">
              <div className="p-4">
                <h3 className="font-semibold text-white text-md">Feature</h3>
              </div>
              <div className="p-4 text-center">
                <div className="space-y-2">
                  <h3 className="font-semibold text-white text-md">Traditional Dashboards</h3>
                  <div className="inline-flex items-center px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30">
                    <X className="w-3 h-3 text-red-400 mr-1" />
                    <span className="text-xs text-red-400 font-medium">Outdated</span>
                  </div>
                </div>
              </div>
              <div className="p-4 text-center">
                <div className="space-y-2">
                  <h3 className="font-semibold text-white text-md">Basic BI Tools</h3>
                  <div className="inline-flex items-center px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/30">
                    <span className="text-xs text-yellow-400 font-medium">✓ Limited</span>
                  </div>
                </div>
              </div>
              <div className="p-4 text-center">
                <div className="space-y-2">
                  <h3 className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-blue-500 text-md">Dreamify</h3>
                  <div className="inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r from-primary/20 to-blue-500/20 border border-primary">
                    <Sparkles className="w-3 h-3 text-blue-500 mr-1" />
                    <span className="text-xs text-blue-500 font-medium">Superior</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Rows */}
            {comparison.map((row, index) => (
              <div 
                key={index}
                className={`grid grid-cols-4 border-b border-slate-700/30 last:border-b-0 hover:bg-slate-800/30 transition-all duration-300 group ${
                  isVisible ? 'animate-slide-in-left' : 'opacity-0'
                }`}
                style={{ animationDelay: `${0.4 + index * 0.1}s` }}
              >
                <div className="py-3 px-4">
                  <span className="font-medium text-white text-md">{row.category}</span>
                </div>
                <div className="p-3 text-center">
                  <span className="text-sm text-slate-300 group-hover:text-red-400 transition-colors">{row.traditional}</span>
                </div>
                <div className="p-3 text-center">
                  <span className="text-sm text-slate-300 group-hover:text-yellow-400 transition-colors">{row.basicBI}</span>
                </div>
                <div className="p-3 text-center">
                  <div className="flex items-center justify-center space-x-2">
                    <span className="text-sm text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-blue-500 font-medium group-hover:from-blue-500 group-hover:to-blue-300 transition-all">
                      {row.dreamify}
                    </span>
                    {row.dreamifyIcon && (
                      <Sparkles className="w-4 h-4 text-blue-500 group-hover:text-blue-300 group-hover:scale-110 transition-all" />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom highlight */}
        <div className={`text-center mt-8 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`} style={{ animationDelay: '0.8s' }}>
            <div className="inline-flex items-center glass-panel rounded-full px-8 py-2 hover:shadow-[0_0_10px_hsl(var(--primary)_/_0.6),_5px_5px_20px_0_hsl(var(--primary)_/_0.4),_0_0_0_1px_hsl(var(--primary)_/_0.2)] transition-all duration-300">
              <Sparkles className="w-5 h-5 text-blue-400 mr-2 animate-pulse" />
              <span className="text-sm text-slate-300">The choice is clear - experience the Dreamify difference</span>
            </div>
        </div>
      </div>
    </section>
  );
};