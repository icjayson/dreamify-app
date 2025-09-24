import { Target, Megaphone, BarChart3, FileText, Sparkles, Brain } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const TargetAudienceSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const audiences = [
    {
      icon: Target,
      title: "Non-tech founders & executives",
      benefit: "Make data-driven decisions without learning complex tools"
    },
    {
      icon: Megaphone,
      title: "Marketing teams",
      benefit: "Create compelling visual reports that tell your story"
    },
    {
      icon: BarChart3,
      title: "Data-curious professionals",
      benefit: "Explore insights without technical barriers"
    },
    {
      icon: FileText,
      title: "Small to mid-size teams",
      benefit: "Professional dashboards without enterprise complexity"
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-background"></div>
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-primary rounded-full animate-ping"></div>
        <div className="absolute top-1/2 right-1/3 w-1 h-1 bg-secondary rounded-full animate-ping" style={{ animationDelay: '1s' }}></div>
        <div className="absolute bottom-1/3 left-1/2 w-1.5 h-1.5 bg-accent rounded-full animate-ping" style={{ animationDelay: '2s' }}></div>
      </div>

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
        <div className={`text-center mb-16 ${isVisible ? 'animate-fade-in' : 'opacity-0'}`}>
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
            <span className="text-white">Perfect for</span>
            <div className="gradient-panel rounded-xl px-6 py-3">
              <span className="text-white font-bold text-3xl md:text-5xl">every teams</span>
            </div>
          </h2>
          
          <h2 className="text-3xl md:text-5xl font-bold mb-4 flex items-center justify-center gap-4 flex-wrap">
            <span className="text-white">who want results, not complexity</span>
          </h2>
          
          <p className="text-md text-white/60 max-w-3xl mx-auto">
            Dreamify empowers every type of professional to create stunning dashboards
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-16 max-w-7xl mx-auto">
          {audiences.map((audience, index) => (
            <div 
              key={index}
              className={`text-center group ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`}
              style={{ animationDelay: `${index * 0.3}s` }}
            >
              {/* Icon Container */}
              <div className="relative flex justify-center">
                {/* Background layer below icon-panel */}
                <div className="icon-panel-bg"></div>
                
                
                <div className={`w-16 h-16 icon-panel rounded-full flex items-center justify-center mb-6 transition-transform duration-300 relative z-10 shadow-[0_5px_5px_rgba(255,255,255),0_10px_10px_hsl(var(--primary)),0_20px_20px_hsl(var(--secondary))] ${
                  isVisible ? 'group-hover:scale-110 animate-zoom-in' : 'opacity-0'
                }`} style={{ animationDelay: `${0.4 + index * 0.2}s` }}>
                  <audience.icon className="w-8 h-8 text-white" />
                </div>
                {/* Glow effect */}
                <div className="absolute inset-0 w-16 h-16 icon-panel opacity-20 blur-xl group-hover:opacity-40 transition-opacity duration-300 z-20"></div>
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold text-white mb-4 leading-tight">
                {audience.title}
              </h3>
              <p className="text-sm text-white/60 leading-relaxed">
                {audience.benefit}
              </p>

              {/* Hover effect */}
              <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};