import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Upload, Database, Send, Plus, Mic, ChevronDown } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";

interface HeroSectionProps {
  onGetStarted: () => void;
}

const HeroSection = ({ onGetStarted }: HeroSectionProps) => {
  const [chatInput, setChatInput] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedDataSource, setSelectedDataSource] = useState("");
  
  // File upload integration
  const { uploadState, uploadCSVFile, uploadExcelFile } = useFileUpload();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('.data-source-dropdown')) {
          setDropdownOpen(false);
        }
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

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

  const handlePlusClick = () => {
    console.log('Plus button clicked');
  };

  const handleCSVClick = () => {
    csvInputRef.current?.click();
  };

  const handleExcelClick = () => {
    excelInputRef.current?.click();
  };

  const handleCSVFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await uploadCSVFile(file);
      if (uploadState.uploadSuccess) {
        onGetStarted();
      }
    }
    // Reset input
    event.target.value = '';
  };

  const handleExcelFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await uploadExcelFile(file);
      if (uploadState.uploadSuccess) {
        onGetStarted();
      }
    }
    // Reset input
    event.target.value = '';
  };

  const handleDataSourceSelect = (source: string) => {
    setSelectedDataSource(source);
    setDropdownOpen(false);
    console.log('Data source selected:', source);
  };

  const handleMicClick = () => {
    console.log('Microphone button clicked');
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
              <div className="absolute right-3 bottom-3 flex gap-2">
                <Button
                  onClick={handleMicClick}
                  className="btn-primary-gradient p-3"
                  aria-label="Voice input"
                >
                  <Mic className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleChatSubmit}
                  disabled={!chatInput.trim()}
                  className="btn-primary-gradient p-3 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {/* Hidden file inputs */}
            <input
              type="file"
              ref={csvInputRef}
              accept=".csv"
              onChange={handleCSVFileSelect}
              className="hidden"
              aria-label="Select CSV file"
            />
            <input
              type="file"
              ref={excelInputRef}
              accept=".xlsx,.xls"
              onChange={handleExcelFileSelect}
              className="hidden"
              aria-label="Select Excel file"
            />
            
            {/* Plus Button */}
            <button
              onClick={handlePlusClick}
              className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center hover:bg-primary/20 transition-all duration-200 group"
              aria-label="Add new item"
            >
              <Plus className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
            </button>

            {/* CSV Button */}
            <button
              onClick={handleCSVClick}
              disabled={uploadState.isUploading}
              className="px-3 py-1.5 text-sm bg-primary/10 border border-primary/20 text-primary rounded-md hover:bg-primary/20 transition-all duration-200 disabled:opacity-50"
            >
              {uploadState.isUploading ? 'Uploading...' : 'CSV'}
            </button>

            {/* Excel Button */}
            <button
              onClick={handleExcelClick}
              disabled={uploadState.isUploading}
              className="px-3 py-1.5 text-sm bg-primary/10 border border-primary/20 text-primary rounded-md hover:bg-primary/20 transition-all duration-200 disabled:opacity-50"
            >
              {uploadState.isUploading ? 'Uploading...' : 'Excel'}
            </button>

            {/* Connect Data Source Dropdown */}
            <div className="relative data-source-dropdown">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="px-4 py-1.5 text-sm bg-primary/10 border border-primary/20 text-primary rounded-md hover:bg-primary/20 transition-all duration-200 flex items-center gap-2"
                aria-expanded={dropdownOpen}
                aria-haspopup="true"
              >
                {selectedDataSource || "Connect your data source"}
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${
                  dropdownOpen ? 'rotate-180' : ''
                }`} />
              </button>
              
              {dropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-background/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg z-10">
                  <div className="py-1">
                    {connectors.map((connector) => (
                      <button
                        key={connector.name}
                        onClick={() => handleDataSourceSelect(connector.name)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-primary/10 transition-colors duration-200 flex items-center gap-2"
                      >
                        <span>{connector.icon}</span>
                        {connector.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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