import { useState } from "react";
import { MessageSquare, Sparkles, BarChart3, TrendingUp, Upload, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ChatInterface from "@/components/ChatInterface";
import DashboardPreview from "@/components/DashboardPreview";
import HomePage from "@/components/HomePage";
import { Message } from "@/types/message";

const Index = () => {
  const [isStarted, setIsStarted] = useState(false);
  const [processedData, setProcessedData] = useState<any>(null);
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
            <ChatInterface 
              messages={messages} 
              onMessagesChange={setMessages}
              onProcessedDataChange={setProcessedData}
            />
          </div>

          {/* Main Dashboard */}
          <div className="flex-1 overflow-hidden">
            <DashboardPreview processedData={processedData} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      <HomePage onGetStarted={handleGetStarted} />
    </div>
  );
};

export default Index;