import { useState } from "react";
import { MessageSquare, Sparkles, BarChart3, TrendingUp, Upload, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ChatInterface from "@/components/ChatInterface";
import AmazonDashboard from "@/components/Amazon_Dashboard";
import HomePage from "@/components/HomePage";
import { Message } from "@/types/message";
import { useChatStore } from "@/stores/useChatStore";
import { useFileStore } from "@/stores/useFileStore";

const Index = () => {
  const [isStarted, setIsStarted] = useState(false);
  const [processedData, setProcessedData] = useState<any>(null);
  
  // Zustand stores
  const { messages } = useChatStore();
  const { uploadState } = useFileStore();

  const handleGetStarted = () => {
    setIsStarted(true);
  };

  if (isStarted) {
    return (
      <div className="min-h-screen bg-background">
        <style dangerouslySetInnerHTML={{
          __html: `
            header {
              display: none !important;
            }
          `
        }} />
        <div className="flex h-screen">
          {/* Chat Sidebar */}
          <div className="w-80 border-r border-border/50 flex flex-col bg-card/50">
            <ChatInterface 
              onProcessedDataChange={setProcessedData}
            />
          </div>

          {/* Main Dashboard */}
          <div className="flex-1 overflow-hidden">
            <AmazonDashboard processedData={processedData} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      <HomePage 
        onGetStarted={handleGetStarted}
        onProcessedDataChange={setProcessedData}
      />
    </div>
  );
};

export default Index;