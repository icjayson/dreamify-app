import { Sparkles, Calendar, ArrowRight, Clock, Award, Users } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

interface CTASectionProps {
  onGetStarted?: () => void;
}

export const CTASection = ({ onGetStarted }: CTASectionProps) => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const stats = [
    {
      icon: Clock,
      value: "5 min",
      label: "Average creation time",
      description: "From data upload to stunning dashboard"
    },
    {
      icon: Award,
      value: "Superior",
      label: "Visual quality",
      description: "Motion-rich, professional aesthetics"
    },
    {
      icon: Users,
      value: "Zero",
      label: "Technical setup",
      description: "No coding or configuration needed"
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      {/* Background with enhanced gradients */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background"></div>
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-20 left-20 w-96 h-96 rounded-full bg-primary/20 blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-20 w-80 h-80 rounded-full bg-secondary/20 blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-accent/20 blur-3xl animate-pulse" style={{ animationDelay: '4s' }}></div>
      </div>

      <div className="relative z-10 container mx-auto px-6">
        <div className="max-w-5xl mx-auto text-center">
          {/* Animated elements */}
          <div className={`flex justify-center mb-4 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`}>
            <div className="flex space-x-4">
              <Sparkles className="w-5 h-5 text-primary animate-pulse" />
              <Sparkles className="w-4 h-4 text-secondary animate-pulse" style={{ animationDelay: '0.5s' }} />
              <Sparkles className="w-6 h-6 text-accent animate-pulse" style={{ animationDelay: '1s' }} />
            </div>
          </div>

          {/* Header with icon */}
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 rounded-lg flex items-center justify-center">
              <img 
                src="/logo-watermark.png" 
                alt="Dreamify Logo" 
                className="w-full h-full object-contain hover:animate-spin transition-all duration-300"
              />
            </div>
          </div>
          
          {/* Main headline */}
          <h2 className={`text-3xl md:text-5xl font-bold mb-4 flex items-center justify-center gap-4 flex-wrap ${isVisible ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
            <span className="text-white">Ready to</span>
            <div className="gradient-panel rounded-xl px-6 py-3">
              <span className="text-white font-bold text-3xl md:text-5xl">transform</span>
            </div>
          </h2>
          
          <h2 className={`text-3xl md:text-5xl font-bold mb-4 flex items-center justify-center gap-4 flex-wrap ${isVisible ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
            <span className="text-white">your data storytelling?</span>
          </h2>

          <p className={`text-md text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed ${isVisible ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.4s' }}>
            Start creating <span className="text-accent font-semibold">stunning, animated dashboards</span> in minutes. 
            Join thousands of professionals who've already discovered the Dreamify difference.
          </p>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-12">
          {stats.map((stat, index) => (
            <div 
              key={index}
              className={`text-center glass-panel rounded-3xl p-6 group hover:scale-105 transition-transform duration-200 ${isVisible ? 'animate-zoom-in' : 'opacity-0'}`}
              style={{ animationDelay: `${index * 0.2}s` }}
            >
              {/* Icon */}
              <div className="mb-6">
                <div className="relative">
                  <div className="w-16 h-16 icon-panel rounded-full flex items-center justify-center mb-6 transition-transform duration-300 shadow-[0_5px_5px_rgba(255,255,255),0_10px_10px_hsl(var(--primary)),0_20px_20px_hsl(var(--secondary))] mx-auto mb-6">
                    <stat.icon className="w-8 h-8 text-white" />
                  </div>
                  {/* Glow effect */}
                  <div className="absolute inset-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent opacity-20 blur-xl group-hover:opacity-80 transition-opacity duration-300 mx-auto"></div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">{stat.value}</div>
                <div className="text-lg font-semibold text-foreground">{stat.label}</div>
                <div className="text-sm text-muted-foreground">{stat.description}</div>
              </div>
            </div>
          ))}
        </div>

          {/* CTA Buttons */}
          <div className={`flex flex-col sm:flex-row gap-8 justify-center mb-12 ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`} style={{ animationDelay: '0.8s' }}>
            <button 
              onClick={onGetStarted}
              className="button-gradient group text-lg px-8 py-4 rounded-2xl flex items-center justify-center"
            >
              Join the waitlist
              <Sparkles className="ml-3 w-6 h-6 group-hover:animate-spin transition-transform" />
            </button>
            <button className="button-outline group text-lg px-8 py-4 rounded-2xl flex items-center justify-center">
              <Calendar className="mr-3 w-6 h-6 group-hover:scale-110 transition-transform" />
              Book a Demo
            </button>
          </div>

          {/* Trust indicators */}
          <div className={`glass-panel rounded-2xl py-2 max-w-2xl mx-auto hover:scale-105 transition-transform hover:shadow-[0_0_10px_hsl(var(--primary)_/_0.6),_5px_5px_20px_0_hsl(var(--primary)_/_0.4),_0_0_0_1px_hsl(var(--primary)_/_0.2)] duration-200 ${isVisible ? 'animate-slide-in-right' : 'opacity-0'}`} style={{ animationDelay: '1s' }}>
            <div className="flex flex-col md:flex-row items-center justify-center space-y-4 md:space-y-0 md:space-x-8">
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-green-500 mr-3 animate-pulse"></div>
                <span className="text-sm text-muted-foreground">No credit card required</span>
              </div>
              <div className="hidden md:block w-px h-4 bg-border"></div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-blue-500 mr-3 animate-pulse"></div>
                <span className="text-sm text-muted-foreground">14-day free trial</span>
              </div>
              <div className="hidden md:block w-px h-4 bg-border"></div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-accent mr-3 animate-pulse"></div>
                <span className="text-sm text-muted-foreground">Cancel anytime</span>
              </div>
            </div>
          </div>

          {/* Final motivator */}
          <div className={`mt-12 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`} style={{ animationDelay: '1.2s' }}>
            <p className="text-foreground-muted text-lg">
              Join <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent font-semibold">10,000+ professionals</span> who've already made the switch
              <ArrowRight className="inline w-5 h-5 ml-2 text-accent" />
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};