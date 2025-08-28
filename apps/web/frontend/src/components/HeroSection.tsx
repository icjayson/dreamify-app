import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Upload, Database, Send } from "lucide-react";
import { useState, useEffect } from "react";

interface HeroSectionProps {
  onGetStarted: () => void;
}

const HeroSection = ({ onGetStarted }: HeroSectionProps) => {
  const [chatInput, setChatInput] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const placeholders = [
    "Tell me about your data or describe the dashboard you want...",
    "Upload your CSV and I'll suggest visualizations...",
    "Connect Stripe data and create a revenue dashboard...",
    "Show me customer acquisition trends with animated charts..."
  ];

  const connectors = [
    { name: "Google Sheets", icon: "📊" },
    { name: "Airtable", icon: "🗃️" },
    { name: "Stripe", icon: "💳" },
    { name: "Shopify", icon: "🛍️" },
    { name: "HubSpot", icon: "📈" },
    { name: "PostgreSQL", icon: "🐘" }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleChatSubmit = () => {
    if (chatInput.trim()) {
      onGetStarted();
    }
  };

  const handleFileUpload = (files: FileList | null) => {
    if (files && files.length > 0) {
      // Process file upload
      onGetStarted();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

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
          Build{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary animate-pulse-glow">
            Interactive
          </span>
          <br />
          Dashboards in{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-primary">
            Minutes
          </span>
        </h1>
        
        <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto animate-fade-in" style={{ animationDelay: '0.2s' }}>
          Transform raw data into stunning, interactive visualizations in minutes through 
          natural conversation with AI. No technical skills required.
        </p>

        {/* Chat-First Interface */}
        <div className="max-w-4xl mx-auto mb-12 animate-scale-in" style={{ animationDelay: '0.4s' }}>
          {/* Main Chat Input */}
          <div className="relative mb-6">
            <div className="relative">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={placeholders[placeholderIndex]}
                className="w-full min-h-[80px] text-lg p-6 glass-panel border-border/30 focus:border-primary/50 focus:glow-primary resize-none transition-all duration-300"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit();
                  }
                }}
                autoFocus
              />
              <Button
                onClick={handleChatSubmit}
                disabled={!chatInput.trim()}
                className="absolute right-3 bottom-3 btn-primary-gradient p-3 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Quick Upload Zone */}
          <div
            className={`relative mb-6 transition-all duration-300 ${
              dragOver ? 'border-primary/70 bg-primary/5' : 'border-border/30'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <label className="block">
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.json"
                onChange={(e) => handleFileUpload(e.target.files)}
                className="hidden"
                multiple
              />
              <div className="glass-panel border-2 border-dashed border-border/30 rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all duration-300">
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Drop CSV/Excel files here or <span className="text-primary">browse</span>
                </p>
              </div>
            </label>
          </div>

          {/* Data Connectors */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">Or connect your data source</p>
            <div className="flex justify-center gap-3 flex-wrap">
              {connectors.map((connector, index) => (
                <button
                  key={connector.name}
                  className="glass-panel p-3 rounded-lg hover:bg-primary/10 hover:scale-105 transition-all duration-200 group"
                  style={{ animationDelay: `${0.6 + index * 0.1}s` }}
                  title={connector.name}
                >
                  <span className="text-2xl block group-hover:scale-110 transition-transform">
                    {connector.icon}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Start Prompts */}
          <div className="flex justify-center gap-2 mt-6 flex-wrap animate-fade-in" style={{ animationDelay: '0.8s' }}>
            {["Monthly Revenue Trends", "Customer Funnel Analysis", "SaaS Metrics Dashboard", "E-commerce Analytics"].map((prompt) => (
              <button
                key={prompt}
                onClick={() => setChatInput(prompt)}
                className="px-4 py-2 text-sm bg-primary/10 text-primary border border-primary/20 rounded-full hover:bg-primary/20 transition-all duration-200"
              >
                {prompt}
              </button>
            ))}
          </div>
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