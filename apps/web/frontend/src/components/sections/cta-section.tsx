import { HeroButton } from "@/components/ui/hero-button";
import { Sparkles, Calendar, ArrowRight } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const CTASection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });

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
          <div className={`flex justify-center mb-8 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`}>
            <div className="flex space-x-4">
              <Sparkles className="w-8 h-8 text-primary animate-pulse" />
              <Sparkles className="w-6 h-6 text-secondary animate-pulse" style={{ animationDelay: '0.5s' }} />
              <Sparkles className="w-10 h-10 text-accent animate-pulse" style={{ animationDelay: '1s' }} />
            </div>
          </div>

          {/* Main headline */}
          <h2 className={`text-5xl md:text-7xl font-bold mb-8 leading-tight ${isVisible ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
            Ready to <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary">transform</span>
            <br />your data storytelling?
          </h2>

          <p className={`text-2xl text-muted-foreground max-w-3xl mx-auto mb-12 leading-relaxed ${isVisible ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.4s' }}>
            Start creating <span className="text-accent font-semibold">stunning, animated dashboards</span> in minutes. 
            Join thousands of professionals who've already discovered the Dreamable difference.
          </p>

          {/* Key benefits */}
          <div className={`grid md:grid-cols-3 gap-8 max-w-4xl mx-auto mb-16 ${isVisible ? 'animate-zoom-in' : 'opacity-0'}`} style={{ animationDelay: '0.6s' }}>
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-white">5</span>
              </div>
              <div className="text-foreground font-semibold">Minutes to Results</div>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <div className="text-foreground font-semibold">AI-Powered Magic</div>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center mx-auto mb-4">
                <span className="text-xl font-bold text-white">0</span>
              </div>
              <div className="text-foreground font-semibold">Technical Setup</div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className={`flex flex-col sm:flex-row gap-6 justify-center mb-12 ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`} style={{ animationDelay: '0.8s' }}>
            <HeroButton variant="primary" size="lg" className="group text-lg px-12 py-5">
              Get Started Free
              <Sparkles className="ml-3 w-6 h-6 group-hover:animate-spin transition-transform" />
            </HeroButton>
            <HeroButton variant="secondary" size="lg" className="group text-lg px-12 py-5">
              <Calendar className="mr-3 w-6 h-6 group-hover:scale-110 transition-transform" />
              Book a Demo
            </HeroButton>
          </div>

          {/* Trust indicators */}
          <div className={`glass-panel rounded-2xl p-8 max-w-3xl mx-auto hover:scale-105 transition-transform duration-200 ${isVisible ? 'animate-slide-in-right' : 'opacity-0'}`} style={{ animationDelay: '1s' }}>
            <div className="flex flex-col md:flex-row items-center justify-center space-y-4 md:space-y-0 md:space-x-8">
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-green-500 mr-3 animate-pulse"></div>
                <span className="text-muted-foreground">No credit card required</span>
              </div>
              <div className="hidden md:block w-px h-6 bg-border"></div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-blue-500 mr-3 animate-pulse"></div>
                <span className="text-muted-foreground">14-day free trial</span>
              </div>
              <div className="hidden md:block w-px h-6 bg-border"></div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-accent mr-3 animate-pulse"></div>
                <span className="text-muted-foreground">Cancel anytime</span>
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