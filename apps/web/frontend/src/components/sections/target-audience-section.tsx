import { User, Users, TrendingUp, Building,Sparkles } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const TargetAudienceSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const audiences = [
    {
      icon: User,
      title: "Non-technical founders & executives",
      benefit: "Make data-driven decisions without learning complex tools",
      color: "text-primary"
    },
    {
      icon: TrendingUp,
      title: "Marketing teams",
      benefit: "Create compelling visual reports that tell your story",
      color: "text-accent"
    },
    {
      icon: Users,
      title: "Data-curious professionals",
      benefit: "Explore insights without technical barriers",
      color: "text-primary"
    },
    {
      icon: Building,
      title: "Small to mid-size teams",
      benefit: "Professional dashboards without enterprise complexity",
      color: "text-accent"
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
            Perfect for <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary">teams who want</span>
            <br />results, not complexity
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Dreamable empowers every type of professional to create stunning dashboards
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
          {audiences.map((audience, index) => (
            <div 
              key={index}
              className={`text-center group ${isVisible ? 'animate-slide-in-left' : 'opacity-0'}`}
              style={{ animationDelay: `${index * 0.3}s` }}
            >
              {/* Icon Container */}
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-3xl glass-panel flex items-center justify-center mx-auto group-hover:scale-110 transition-all duration-300 hover:scale-105">
                  <audience.icon className={`w-10 h-10 ${audience.color} group-hover:scale-110 transition-transform duration-300`} />
                </div>
                {/* Glow effect */}
                <div className={`absolute inset-0 w-20 h-20 rounded-3xl mx-auto opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-300 ${audience.color.replace('text-', 'bg-')}`}></div>
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold text-foreground mb-4 leading-tight">
                {audience.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {audience.benefit}
              </p>

              {/* Hover effect */}
              <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"></div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto mt-20">
          {[{stat: "10,000+", label: "Professionals served"}, {stat: "95%", label: "Satisfaction rate"}, {stat: "5 min", label: "Average creation time"}].map((item, index) => (
            <div key={index} className={`text-center glass-panel rounded-2xl p-4 hover:scale-105 transition-transform duration-200 ${isVisible ? 'animate-bounce-in' : 'opacity-0'}`} style={{ animationDelay: `${0.6 + index * 0.1}s` }}>
              <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent mb-2">{item.stat}</div>
              <div className="text-muted-foreground">{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};