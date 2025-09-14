import { Star, Users, Clock, Award, Sparkles } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const SocialProofSection = () => {
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
      description: "No coding, configuration, or training needed"
    }
  ];

  const testimonials = [
    {
      quote: "Dreamable transformed our quarterly reviews. What used to take our team 3 days now takes 15 minutes, and looks infinitely better.",
      author: "Sarah Chen",
      role: "Marketing Director",
      company: "TechFlow Inc"
    },
    {
      quote: "The AI understands exactly what I want to visualize. It's like having a data analyst and designer rolled into one.",
      author: "Marcus Rodriguez", 
      role: "Founder",
      company: "GrowthLab"
    },
    {
      quote: "Our investors are impressed by the professional quality of our data presentations. Dreamable gives us that competitive edge.",
      author: "Emily Watson",
      role: "CEO",
      company: "StartupVision"
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-r from-background to-background"></div>
      
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
            Join <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary">innovative teams</span>
            <br />building better dashboards
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Trusted by forward-thinking professionals who demand results
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-20">
          {stats.map((stat, index) => (
            <div 
              key={index}
              className={`text-center glass-panel rounded-3xl p-8 group hover:scale-105 transition-transform duration-200 ${isVisible ? 'animate-zoom-in' : 'opacity-0'}`}
              style={{ animationDelay: `${index * 0.2}s` }}
            >
              {/* Icon */}
              <div className="mb-8">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-6">
                    <stat.icon className="w-8 h-8 text-white" />
                  </div>
                  {/* Glow effect */}
                  <div className="absolute inset-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent opacity-20 blur-xl group-hover:opacity-80 transition-opacity duration-300 mx-auto"></div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">{stat.value}</div>
                <div className="text-xl font-semibold text-foreground">{stat.label}</div>
                <div className="text-muted-foreground">{stat.description}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="grid md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <div 
              key={index}
              className={`glass-panel rounded-3xl p-8 hover:scale-105 transition-transform duration-200 ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`}
              style={{ animationDelay: `${0.6 + index * 0.2}s` }}
            >
              {/* Stars */}
              <div className="flex space-x-1 mb-6">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 text-accent fill-current" />
                ))}
              </div>

              {/* Quote */}
              <blockquote className="text-muted-foreground leading-relaxed mb-6">
                "{testimonial.quote}"
              </blockquote>

              {/* Author */}
              <div className="border-t border-border pt-6">
                <div className="font-semibold text-foreground">{testimonial.author}</div>
                <div className="text-muted-foreground text-sm">{testimonial.role}</div>
                <div className="text-accent text-sm font-medium">{testimonial.company}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust indicators */}
        <div className={`text-center mt-16 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`} style={{ animationDelay: '1.2s' }}>
          <div className="inline-flex items-center glass-panel rounded-full hover:shadow-[0_0_10px_hsl(261_83%_58%_/_0.6),_5px_5px_20px_0_hsl(261_83%_58%_/_0.4),_0_0_0_1px_hsl(261_83%_58%_/_0.2)] px-8 py-2">
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></div>
                <span className="text-sm text-muted-foreground">SOC 2 Compliant</span>
              </div>
              <div className="w-px h-4 bg-border"></div>
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-blue-500 mr-2 animate-pulse"></div>
                <span className="text-sm text-muted-foreground">GDPR Ready</span>
              </div>
              <div className="w-px h-4 bg-border"></div>
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-accent mr-2 animate-pulse"></div>
                <span className="text-sm text-muted-foreground">Enterprise Grade</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};