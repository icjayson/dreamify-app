import { Zap, Eye, Brain, ArrowRight, Sparkles } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const ValuePropsSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const valueProps = [
    {
      icon: Zap,
      title: "Speed Revolution",
      description: "Transform raw CSV/data into animated dashboard in under 5 minutes. Pre-built analytics functions eliminate manual calculations.",
      features: ["5-minute creation", "Pre-built functions", "Instant results", "No manual work"]
    },
    {
      icon: Eye,
      title: "Superior Visual Experience", 
      description: "Motion-first design with smooth transitions, professional aesthetics, and interactive elements. Your data never looked this good.",
      features: ["Motion-rich design", "Professional aesthetics", "Interactive elements", "Cinematic quality"]
    },
    {
      icon: Brain,
      title: "AI-Powered Intelligence",
      description: "Natural language interaction. Just describe what you want to see - AI analyzes patterns and provides contextual insights.",
      features: ["Natural conversation", "Pattern analysis", "Contextual insights", "Smart suggestions"]
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
          <Sparkles className="w-8 h-8 text-primary animate-pulse" />
          <Sparkles className="w-6 h-6 text-secondary animate-pulse" style={{ animationDelay: '0.5s' }} />
          <Sparkles className="w-10 h-10 text-accent animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
      </div>
    
      <div className="relative z-10 container mx-auto px-6">
        <div className={`text-center mb-16 ${isVisible ? 'animate-fade-in' : 'opacity-0'}`}>
          <h2 className="text-4xl md:text-6xl font-bold mb-6">
            Core <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary">Value Propositions</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            That make Dreamable the superior choice for data visualization
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {valueProps.map((prop, index) => (
            <div 
              key={index}
              className={`glass-panel rounded-3xl p-8 group hover:scale-105 transition-transform duration-200 ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`}
              style={{ animationDelay: `${0.2 + index * 0.2}s` }}
            >
              {/* Icon */}
              <div className="mb-8">
                <div className="relative">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-6 transition-transform duration-300 ${
                    isVisible ? 'group-hover:scale-110 animate-zoom-in' : 'opacity-0'
                  }`} style={{ animationDelay: `${0.4 + index * 0.2}s` }}>
                    <prop.icon className="w-8 h-8 text-white" />
                  </div>
                  {/* Glow effect */}
                  <div className="absolute inset-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent opacity-20 blur-xl group-hover:opacity-40 transition-opacity duration-300"></div>
                </div>
              </div>

              {/* Content */}
              <div className="space-y-6">
                <h3 className="text-2xl font-bold text-foreground mb-4">{prop.title}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {prop.description}
                </p>

                {/* Features List */}
                <ul className="space-y-3">
                  {prop.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center text-sm text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent mr-3"></div>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Learn More Link */}
                <div className="pt-4">
                  <a 
                    href="#" 
                    className="inline-flex items-center text-sm font-medium hover:text-accent transition-colors group/link"
                  >
                    Learn more
                    <ArrowRight className="w-4 h-4 ml-2 group-hover/link:translate-x-1 transition-transform" />
                  </a>
                </div>
              </div>


              {/* Hover effect overlay */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none "></div>
            </div>
          ))}
        </div>

        {/* Bottom highlight */}
        <div className={`text-center mt-8 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`} style={{ animationDelay: '0.8s' }}>
          <div className="inline-flex items-center glass-panel rounded-full hover:shadow-[0_0_10px_hsl(261_83%_58%_/_0.6),_5px_5px_20px_0_hsl(261_83%_58%_/_0.4),_0_0_0_1px_hsl(261_83%_58%_/_0.2)] px-8 py-2">
            <Brain className="w-6 h-6 text-accent mr-3 animate-pulse-glow" />
            <span className="text-muted-foreground font-medium">Powered by advanced AI technology</span>
          </div>
        </div>
      </div>
    </section>
  );
};