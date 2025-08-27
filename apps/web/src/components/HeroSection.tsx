import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, Play, Database } from "lucide-react";

interface HeroSectionProps {
  onGetStarted: () => void;
}

const HeroSection = ({ onGetStarted }: HeroSectionProps) => {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/10 rounded-full blur-3xl animate-float"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 w-48 h-48 bg-primary/5 rounded-full blur-2xl animate-float" style={{ animationDelay: '4s' }}></div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto text-center">
        <Badge variant="secondary" className="mb-6 bg-primary/10 text-primary border-primary/20 animate-fade-in">
          <Sparkles className="w-3 h-3 mr-1" />
          AI-Powered Analytics Platform
        </Badge>
        
        <h1 className="text-5xl md:text-7xl font-bold mb-6 animate-slide-up">
          Create{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary animate-pulse-glow">
            Superior
          </span>
          <br />
          Dashboards with{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-primary">
            Motion
          </span>
        </h1>
        
        <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto animate-fade-in" style={{ animationDelay: '0.2s' }}>
          Transform raw data into stunning, interactive visualizations in minutes through 
          natural conversation with AI. No technical skills required.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12 animate-scale-in" style={{ animationDelay: '0.4s' }}>
          <Button 
            onClick={onGetStarted}
            size="lg" 
            className="btn-primary-gradient text-lg px-8 py-6 group"
          >
            <Database className="w-5 h-5 mr-2 group-hover:rotate-12 transition-transform" />
            Start Building Now
            <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
          </Button>
          
          <Button 
            variant="outline" 
            size="lg" 
            className="text-lg px-8 py-6 border-border/50 hover:bg-primary/10 group"
          >
            <Play className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" />
            Watch Demo
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.6s' }}>
          <div className="text-center">
            <div className="text-3xl font-bold text-primary mb-1">5 min</div>
            <div className="text-sm text-muted-foreground">Average creation time</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-accent mb-1">60fps</div>
            <div className="text-sm text-muted-foreground">Smooth animations</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-primary mb-1">AI</div>
            <div className="text-sm text-muted-foreground">Powered insights</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;