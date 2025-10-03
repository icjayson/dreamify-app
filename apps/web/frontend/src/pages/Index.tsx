import { useState } from "react";
import { MessageSquare, Sparkles, BarChart3, TrendingUp, Upload, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ChatInterface from "@/components/ChatInterface";
import AmazonDashboard from "@/components/Amazon_Dashboard";
import AmazonDashboardDark from "@/components/Amazon_Dashboard_Dark";
import DashboardLoading from "@/components/DashboardLoading";
import HomePage from "@/pages/HomePage";
import { useChatStore } from "@/stores/useChatStore";
import { useFileStore } from "@/stores/useFileStore";

const Index = () => {
  const [isStarted, setIsStarted] = useState(false);
  const [processedData, setProcessedData] = useState<any>(null);
  
  // Zustand stores
  const { messages, dashboardTheme, isThemeChanging, isInitialLoading } = useChatStore();
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
            {isInitialLoading ? (
              <DashboardLoading title="Generating Dashboard" description="Please wait while we build your dashboard..." durationSec={10} />
            ) : isThemeChanging ? (
              <DashboardLoading />
            ) : dashboardTheme === 'dark' ? (
              <AmazonDashboardDark processedData={processedData} />
            ) : (
              <AmazonDashboard processedData={processedData} />
            )}
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