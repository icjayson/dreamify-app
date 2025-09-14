import { Upload, MessageCircle, Sparkles, Share, ArrowRight } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const HowItWorksSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const steps = [
    {
      number: 1,
      icon: Upload,
      title: "Upload your data",
      description: "Drag & drop your CSV files or connect to your data sources. We handle the rest.",
      animation: "animate-bounce"
    },
    {
      number: 2,
      icon: MessageCircle,
      title: "Chat with AI",
      description: "Tell us what you want to see in natural language. 'Show me sales trends by region'",
      animation: "animate-pulse"
    },
    {
      number: 3,
      icon: Sparkles,
      title: "Watch magic happen",
      description: "AI analyzes your data and creates beautiful animated dashboards in real-time.",
      animation: "animate-spin"
    },
    {
      number: 4,
      icon: Share,
      title: "Export & share",
      description: "Download as interactive HTML, PDF, or share with your team instantly.",
      animation: "animate-ping"
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background to-background"></div>
      
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
            How <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary">It Works</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Four simple steps to transform your data into stunning visualizations
          </p>
        </div>

        {/* Timeline */}
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 relative">
            {/* Connection Line - Hidden on mobile */}
            <div className="hidden md:block absolute top-24 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-secondary to-accent opacity-30"></div>
            
            {steps.map((step, index) => (
              <div 
                key={index}
                className={`relative text-center ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`}
                style={{ animationDelay: `${index * 0.2}s` }}
              >
                {/* Step Number */}
                <div className="relative mb-8">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4 relative z-10">
                    <span className="text-2xl font-bold text-white">{step.number}</span>
                  </div>
                  
                  {/* Icon with animation */}
                  <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                    <div className="w-12 h-12 rounded-full glass-panel flex items-center justify-center hover:scale-110 transition-transform duration-200">
                      <step.icon className={`w-6 h-6 text-accent ${step.animation}`} />
                    </div>
                  </div>

                  {/* Glow effect */}
                  <div className="absolute inset-0 w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent opacity-20 blur-xl mx-auto animate-pulse"></div>
                </div>

                {/* Content */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold text-foreground">{step.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{step.description}</p>
                </div>

                {/* Arrow for non-last items */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-24 -right-4 z-20">
                    <ArrowRight className="w-8 h-8 text-accent opacity-60" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Demo mockup */}
        <div className={`mt-20 text-center ${isVisible ? 'animate-zoom-in' : 'opacity-0'}`} style={{ animationDelay: '1s' }}>
          <div className="rounded-3xl p-8 max-w-4xl mx-auto">
            <div className="flex items-center justify-center mb-6">
              <div className="flex space-x-3">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
            </div>
            
            <div className="text-left space-y-4">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 rounded-full bg-primary flex-shrink-0 flex items-center justify-center">
                  <span className="text-xs text-white font-bold">U</span>
                </div>
                <div className="glass-panel rounded-2xl px-4 py-3 max-w-md hover:scale-105 transition-transform duration-200">
                  <p className="text-foreground">"Show me sales performance by region with animated bars"</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4 justify-end">
                <div className="glass-panel rounded-2xl px-4 py-3 max-w-md hover:scale-105 transition-transform duration-200">
                  <p className="text-muted-foreground">✨ Creating your animated dashboard...</p>
                  <div className="flex space-x-1 mt-2">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-secondary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex-shrink-0 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};