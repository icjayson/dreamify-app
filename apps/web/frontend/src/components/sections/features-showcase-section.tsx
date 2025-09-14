import { MessageCircle, Sparkles, Download, Play, ArrowRight } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const FeaturesShowcaseSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const features = [
    {
      icon: MessageCircle,
      title: "Chat-First Dashboard Creation",
      description: "Simply describe what you want to see. Our AI understands natural language and transforms your requests into beautiful visualizations.",
      mockup: {
        type: "chat",
        messages: [
          { user: "Show me sales trends by region", isUser: true },
          { user: "Creating animated bar chart with regional breakdown...", isUser: false }
        ]
      },
      alignment: "left"
    },
    {
      icon: Sparkles,
      title: "Superior Motion & Interactions",
      description: "Every chart comes alive with smooth animations, hover effects, and interactive elements that engage your audience like never before.",
      mockup: {
        type: "chart",
        title: "Revenue Growth",
        animated: true
      },
      alignment: "right"
    },
    {
      icon: Download,
      title: "Professional Export Options",
      description: "Export as interactive HTML, high-resolution PDF, or share instantly with a link. Your dashboards look professional everywhere.",
      mockup: {
        type: "export",
        formats: ["HTML", "PDF", "PNG", "Share Link"]
      },
      alignment: "left"
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      {/* Background with animated elements */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-background"></div>
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-40 left-20 w-2 h-2 bg-primary rounded-full animate-ping"></div>
        <div className="absolute top-60 right-32 w-1 h-1 bg-secondary rounded-full animate-ping" style={{ animationDelay: '1s' }}></div>
        <div className="absolute bottom-40 left-1/3 w-1.5 h-1.5 bg-accent rounded-full animate-ping" style={{ animationDelay: '2s' }}></div>
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
        <div className={`text-center mb-20 ${isVisible ? 'animate-fade-in' : 'opacity-0'}`}>
          <h2 className="text-4xl md:text-6xl font-bold mb-6">
            Core <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary">Features</span>
          </h2>
          <p className="text-xl text-muted-foreground mx-auto">
            Discover the three revolutionary capabilities that make Dreamable the future of data visualization
          </p>
        </div>

        <div className="space-y-32">
          {features.map((feature, index) => (
            <div 
              key={index}
              className={`grid md:grid-cols-2 gap-16 items-center ${
                feature.alignment === 'right' ? 'md:grid-flow-col-dense' : ''
              } ${
                isVisible ? (index % 2 === 0 ? 'animate-slide-in-left' : 'animate-slide-in-right') : 'opacity-0'
              }`}
              style={{ animationDelay: `${0.3 + index * 0.2}s` }}
            >
              {/* Content */}
              <div className={`space-y-8 ${feature.alignment === 'right' ? 'md:col-start-2' : ''}`}>
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                    <feature.icon className="w-8 h-8 text-white" />
                  </div>
                  <div className="w-full h-px bg-gradient-to-r from-primary to-transparent"></div>
                </div>
                
                <h3 className="text-3xl font-bold text-foreground">{feature.title}</h3>
                <p className="text-xl text-foreground-muted leading-relaxed">{feature.description}</p>
                
                <button className="inline-flex items-center text-accent hover:text-accent-bright font-medium group">
                  Explore this feature
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>

              {/* Mockup */}
              <div className={`${feature.alignment === 'right' ? 'md:col-start-1 md:row-start-1' : ''} ${
                isVisible ? 'animate-zoom-in' : 'opacity-0'
              }`} style={{ animationDelay: `${0.5 + index * 0.2}s` }}>
                <div className="glass-panel rounded-3xl p-8 hover:scale-105 transition-transform duration-200">
                  {feature.mockup.type === 'chat' && (
                    <div className="space-y-4">
                      <div className="flex items-center space-x-3 mb-6">
                        <div className="w-3 h-3 rounded-full bg-red-500"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      </div>
                      
                      {feature.mockup.messages.map((message, msgIndex) => (
                        <div 
                          key={msgIndex}
                          className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-xs px-4 py-3 rounded-2xl ${
                            message.isUser 
                              ? 'btn-primary-gradient text-white' 
                              : 'glass-panel border border-border/30 text-muted-foreground'
                          }`}>
                            {message.user}
                          </div>
                        </div>
                      ))}
                      
                      <div className="flex justify-start">
                        <div className="flex space-x-1 px-4 py-3 glass-panel rounded-2xl hover:scale-105 transition-transform duration-200">
                          <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-secondary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                          <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {feature.mockup.type === 'chart' && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-semibold text-foreground">{feature.mockup.title}</h4>
                        <Play className="w-5 h-5 text-accent animate-pulse" />
                      </div>
                      
                      <div className="grid grid-cols-4 gap-2 h-32">
                        {[...Array(4)].map((_, i) => (
                          <div key={i} className="flex flex-col justify-end">
                            <div 
                              className={`bg-gradient-to-t from-primary to-accent rounded-t-lg transition-all duration-1000 ease-out ${
                                feature.mockup.animated ? 'animate-grow' : ''
                              }`}
                              style={{ 
                                height: `${60 + Math.random() * 40}%`,
                                animationDelay: `${i * 0.2}s`
                              }}
                            ></div>
                          </div>
                        ))}
                      </div>
                      
                      <div className="text-center text-sm text-muted-foreground">
                        Interactive • Animated • Beautiful
                      </div>
                    </div>
                  )}

                  {feature.mockup.type === 'export' && (
                    <div className="space-y-6">
                      <div className="text-center">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-secondary to-accent flex items-center justify-center mx-auto mb-4">
                          <Download className="w-8 h-8 text-white" />
                        </div>
                        <h4 className="text-lg font-semibold text-foreground mb-2">Export Options</h4>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        {feature.mockup.formats.map((format, formatIndex) => (
                          <button 
                            key={formatIndex}
                            className="p-3 glass-panel rounded-xl text-sm font-medium text-muted-foreground hover:text-accent hover:bg-primary/10 hover:scale-105 transition-all duration-200"
                          >
                            {format}
                          </button>
                        ))}
                      </div>
                      
                      <div className="text-center pt-4">
                        <div className="inline-flex items-center text-sm text-green-400">
                          <div className="w-2 h-2 rounded-full bg-green-400 mr-2 animate-pulse"></div>
                          Ready to download
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};