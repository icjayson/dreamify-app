import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Upload, Database, CornerRightUp, Plus, Mic, MicOff, ChevronDown} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useToast } from "@/hooks/use-toast";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBar from './ui/recording-bar';
import { ProblemSolutionSection } from './sections/problem-solution-section';
import { ValuePropsSection } from './sections/value-props-section';
import { TargetAudienceSection } from './sections/target-audience-section';
import { HowItWorksSection } from './sections/how-it-works-section';
import { FeaturesShowcaseSection } from './sections/features-showcase-section';
import { SocialProofSection } from './sections/social-proof-section';
import { CTASection } from './sections/cta-section';
import { FooterSection } from './sections/footer-section';


interface HomePageProps {
  onGetStarted: () => void;
}

const HomePage = ({ onGetStarted }: HomePageProps) => {
  const [chatInput, setChatInput] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedDataSource, setSelectedDataSource] = useState("");
  
  // Toast hook
  const { toast } = useToast();
  
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
    { name: "Google Sheets", icon: "/google-sheet.png" },
    { name: "GA4", icon: "/GA4.png" },
    { name: "Meta", icon: "/meta.png" },
    { name: "Airtable", icon: "/airtable.png" },
    { name: "Stripe", icon: "/stripe.jpeg" },
    { name: "Shopify", icon: "/shopify.png" },
    { name: "HubSpot", icon: "/hubspot.jpeg" },
    { name: "PostgreSQL", icon: "/PostgreSQL.png" }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      
      if (dropdownOpen && !target.closest('.data-source-dropdown')) {
        setDropdownOpen(false);
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

  // Speech recognition hook
  const {
    isListening,
    transcript,
    error: speechError,
    isSupported: speechSupported,
    selectedLanguage,
    detectedLanguage,
    startListening,
    stopListening,
    resetTranscript,
    abortRecording,
    completeRecording
  } = useSpeechRecognition({
    onResult: (result) => {
      setChatInput(prev => prev + (prev ? ' ' : '') + result);
      resetTranscript();
    },
    onError: (error) => {
      toast({
        title: "Speech Recognition Error",
        description: error,
        variant: "destructive",
      });
    },
    continuous: true
  });

  const handleMicClick = () => {
    if (!speechSupported) {
      toast({
        title: "Not Supported",
        description: "Speech recognition is not supported in your browser",
        variant: "destructive",
      });
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleRecordingCancel = () => {
    abortRecording();
  };

  const handleRecordingConfirm = () => {
    completeRecording();
    // Clear transcript after it's been added to chatInput via onResult
    resetTranscript();
  };

  return (
    <>
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
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary rounded-md px-4 animate-pulse-glow">
            Interactive
          </span>
          <br />
          Dashboards in{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-primary">
            Minutes
          </span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto animate-fade-in" style={{ animationDelay: '0s' }}>
          Transform raw data into stunningly and interactively visualised dashboards in minutes through 
          natural conversation with AI Agent. No technical skills required.
        </p>

        {/* Chat-First Interface */}
        <div className="max-w-4xl mx-auto mb-12 animate-fade-in" style={{ animationDelay: '0s' }}>
          {/* Main Chat Input */}
          <div className="w-full min-h-[80px] text-lg p-6 glass-panel border-border/30 rounded-3xl resize-none transition-all duration-300">
            {/* Textarea Row */}
            <div className="relative mb-4">
              <TextareaAutosize
                minRows={3}
                maxRows={10}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={isListening ? 'Listening...' : placeholders[placeholderIndex]}
                className="w-full bg-transparent border-none outline-none resize-none text-lg placeholder:text-muted-foreground/60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit();
                  }
                }}
                autoFocus
              />
            </div>
            
            {/* Recording Bar - Positioned between textarea and buttons */}
            <RecordingBar 
              isVisible={isListening}
              detectedLanguage={detectedLanguage}
              onCancel={handleRecordingCancel}
              onConfirm={handleRecordingConfirm}
            />
            
            {/* Buttons Row */}
            <div className="flex items-center justify-between">
              {/* Left side buttons */}
              <div className="flex items-center gap-2">
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
                  className="w-8 h-8 rounded-md btn-primary-outline flex items-center justify-center group"
                  onMouseEnter={(e) => {
                    e.currentTarget.classList.add('btn-primary-hover');
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.classList.remove('btn-primary-hover');
                  }}
                  aria-label="Add new item"
                >
                  <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>

                {/* CSV Button */}
                <button
                  onClick={handleCSVClick}
                  disabled={uploadState.isUploading}
                  className="px-3 py-1.5 text-sm btn-primary-outline rounded-md disabled:opacity-50 flex items-center gap-2"
                  onMouseEnter={(e) => {
                    if (!uploadState.isUploading) {
                      e.currentTarget.classList.add('btn-primary-hover');
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.classList.remove('btn-primary-hover');
                  }}
                  aria-label="Upload CSV file"
                >
                  <Upload className="w-4 h-4" />
                  {uploadState.isUploading ? 'Uploading...' : 'CSV'}
                </button>

                {/* Excel Button */}
                <button
                  onClick={handleExcelClick}
                  disabled={uploadState.isUploading}
                  className="px-3 py-1.5 text-sm btn-primary-outline rounded-md disabled:opacity-50 flex items-center gap-2"
                  onMouseEnter={(e) => {
                    if (!uploadState.isUploading) {
                      e.currentTarget.classList.add('btn-primary-hover');
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.classList.remove('btn-primary-hover');
                  }}
                  aria-label="Upload Excel file"
                >
                  <Database className="w-4 h-4" />
                  {uploadState.isUploading ? 'Uploading...' : 'Excel'}
                </button>

                {/* Connect Data Source Dropdown */}
                <div className="relative data-source-dropdown">
                  <Button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="btn-primary-gradient rounded-md transition-all duration-200 px-4 py-1.5 text-sm flex items-center gap-2 h-auto"
                    aria-expanded={dropdownOpen}
                    aria-haspopup="true"
                    aria-label="Connect data source"
                  >
                    {selectedDataSource || "Connect your data source"}
                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${
                      dropdownOpen ? 'rotate-180' : ''
                    }`} />
                  </Button>
                  
                  {dropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-background/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg z-10">
                      <div className="py-1">
                        {connectors.map((connector) => (
                          <button
                            key={connector.name}
                            onClick={() => handleDataSourceSelect(connector.name)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-primary/10 transition-colors duration-200 flex items-center gap-2"
                          >
                            <img src={connector.icon} alt={connector.name} className="w-4 h-4 object-cover" />
                            {connector.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Right side buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={handleMicClick}
                  className={`btn-primary-gradient p-3 ${
                    isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : ''
                  }`}
                  aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                  disabled={!speechSupported}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button
                  onClick={handleChatSubmit}
                  disabled={!chatInput.trim()}
                  className="btn-primary-gradient p-3 disabled:opacity-50"
                >
                  <CornerRightUp className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>



          {/* Quick Start Prompts */}
          <div className="flex justify-center gap-2 mt-6 flex-wrap animate-fade-in" style={{ animationDelay: '0s' }}>
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
      </div>
    </section>
      
    {/* New Homepage Sections */}
    <ProblemSolutionSection />
    <ValuePropsSection />
    <TargetAudienceSection />
    <HowItWorksSection />
    <FeaturesShowcaseSection />
    <SocialProofSection />
    <CTASection />
    <FooterSection />
  </>
);
};

export default HomePage;