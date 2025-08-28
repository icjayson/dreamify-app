import { useState } from "react";
import { MessageSquare, Sparkles, BarChart3, TrendingUp, Upload, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ChatInterface from "@/components/ChatInterface";
import DashboardPreview from "@/components/DashboardPreview";
import HeroSection from "@/components/HeroSection";
import { Message } from "@/types/message";

const Index = () => {
  const [isStarted, setIsStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hi! I'm Vibe, your analytics assistant. Upload your data and let's create a stunning dashboard with motion in minutes! What would you like to visualize today?",
      timestamp: new Date()
    }
  ]);

  const handleGetStarted = () => {
    setIsStarted(true);
  };

  if (isStarted) {
    return (
      <div className="min-h-screen bg-background">
        {/* Top Navigation */}
        <header className="h-14 border-b border-border/50 glass-panel flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Vibe Analytics Studio</h1>
              </div>
            </div>
            <Badge variant="secondary" className="bg-accent/20 text-accent border-accent/30">
              <Sparkles className="w-3 h-3 mr-1" />
              AI Powered
            </Badge>
          </div>
          
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="border-border/50">
              Save Dashboard
            </Button>
            <Button variant="outline" size="sm" className="border-border/50">
              Export
            </Button>
          </div>
        </header>

        <div className="flex h-[calc(100vh-3.5rem)]">
          {/* Chat Sidebar */}
          <div className="w-80 border-r border-border/50 flex flex-col bg-card/50">
            <ChatInterface messages={messages} onMessagesChange={setMessages} />
          </div>

          {/* Main Dashboard */}
          <div className="flex-1 overflow-hidden">
            <DashboardPreview />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      <HeroSection onGetStarted={handleGetStarted} />
      
      {/* Features Section */}
      <section className="relative py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 bg-primary/10 text-primary border-primary/20">
              <Sparkles className="w-3 h-3 mr-1" />
              Powered by AI
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Create Superior Dashboards in
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                Minutes, Not Hours
              </span>
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Transform raw data into stunning, interactive visualizations through natural conversation with AI
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="glass-panel p-8 group hover:scale-105 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center mb-6 group-hover:bg-primary/30 transition-colors">
                <MessageSquare className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Chat-First Creation</h3>
              <p className="text-muted-foreground">
                "Create a funnel chart with smooth animations" → Instant beautiful dashboard
              </p>
            </Card>

            <Card className="glass-panel p-8 group hover:scale-105 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center mb-6 group-hover:bg-accent/30 transition-colors">
                <TrendingUp className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Motion-Rich Design</h3>
              <p className="text-muted-foreground">
                Every chart comes alive with cinematic animations and smooth transitions
              </p>
            </Card>

            <Card className="glass-panel p-8 group hover:scale-105 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center mb-6 group-hover:bg-primary/30 transition-colors">
                <BarChart3 className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">AI-Powered Insights</h3>
              <p className="text-muted-foreground">
                Get contextual explanations and recommendations as you explore your data
              </p>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;