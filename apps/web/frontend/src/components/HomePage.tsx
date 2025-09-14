import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Upload, Database, CornerRightUp, Plus, Mic, MicOff, ChevronDown, FileText} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useToast } from "@/hooks/use-toast";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBar from './ui/recording-bar';
import { useChatStore } from "@/stores/useChatStore";
import { useFileStore } from "@/stores/useFileStore";
import { fileService, type UploadResponse } from "@/services/fileService";
import { Message } from "@/types/message";
import { ProblemSolutionSection } from './sections/problem-solution-section';
import { ValuePropsSection } from './sections/value-props-section';
import { TargetAudienceSection } from './sections/target-audience-section';
import { HowItWorksSection } from './sections/how-it-works-section';
import { FeaturesShowcaseSection } from './sections/features-showcase-section';
import { SocialProofSection } from './sections/social-proof-section';
import { CTASection } from './sections/cta-section';
import { FooterSection } from './sections/footer-section';
import MovingDot from './MovingDot';
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import ScrollStack from '../../../src/ui/lightswind/scroll-stack';


interface HomePageProps {
  onGetStarted: () => void;
  onProcessedDataChange?: (data: any) => void;
}

const HomePage = ({ onGetStarted, onProcessedDataChange }: HomePageProps) => {
  // Zustand stores
  const {
    inputValue,
    selectedDataSource,
    dropdownOpen,
    isListening,
    detectedLanguage,
    uploadedFile,
    isProcessing,
    setInputValue,
    setSelectedDataSource,
    setDropdownOpen,
    setUploadedFile,
    setIsListening,
    setDetectedLanguage,
    sendMessage,
    addMessage,
    processFileWithMessage
  } = useChatStore();
  
  const {
    uploadState,
    uploadFile,
    validateClientFile,
    removeFile
  } = useFileStore();
  
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [lottieData, setLottieData] = useState(null);
  
  // Toast hook
  const { toast } = useToast();
  
  // File upload integration
  const { uploadState: legacyUploadState, uploadCSVFile, uploadExcelFile } = useFileUpload();
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

  const scrollStackCards = [
    {
      title: "Real-time Analytics",
      subtitle: "Monitor your data with live updates and interactive dashboards",
      badge: "Live Data"
    },
    {
      title: "AI-Powered Insights",
      subtitle: "Get intelligent recommendations and automated analysis",
      badge: "AI Driven"
    },
    {
      title: "Custom fdkfjdlkfdlkfjkld",
      subtitle: "Create stunning charts and graphs tailored to your needs",
      badge: "Custom"
    },
    {
      title: "Custom Visualizations",
      subtitle: "Create stunning charts and graphs tailored to your needs",
      badge: "Custom"
    },
    {
      title: "Custom Visualizations",
      subtitle: "Create stunning charts and graphs tailored to your needs",
      badge: "Custom"
    }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Load Lottie animation data
    fetch('/bg-test-5.json')
      .then(response => response.json())
      .then(data => setLottieData(data))
      .catch(error => console.error('Error loading Lottie animation:', error));
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

  const handleChatSubmit = async () => {
    if (!inputValue.trim()) return;
    
    // Create user message with file attachment immediately
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
      attachment: uploadedFile ? { 
        kind: "csv", 
        name: uploadedFile.filename 
      } : undefined,
    };
    
    // Add message to store synchronously before switching views
    addMessage(userMessage);
    
    // Switch to ChatInterface immediately so user sees their message
    onGetStarted();
    
    // Continue with file processing in background
    await processFileWithMessage(inputValue.trim(), onProcessedDataChange);
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
    if (!file) return;
    
    const validationError = validateClientFile(file);
    if (validationError) {
      toast({ title: "Upload error", description: validationError, variant: "destructive" });
      return;
    }
    
    try {
      // Create new file object for upload
      const newFile = { 
        fileID: 'pending', 
        filename: file.name, 
        size: file.size, 
        ext: (file.name.split('.').pop() || '').toLowerCase(), 
        status: 'uploading' as const 
      };
      
      // Replace behavior: if an uploaded file exists, we'll delete it after new upload succeeds
      setUploadedFile(newFile);

      const res: UploadResponse = await fileService.uploadFile(file);
      if (!res.success || !res.fileID || !res.ext || res.size === undefined || !res.filename) {
        setUploadedFile({ ...newFile, status: 'error' });
        toast({ title: "Upload failed", description: res.error || 'Upload failed', variant: "destructive" });
        return;
      }

      // Delete previous file if different
      if (uploadedFile && uploadedFile.fileID && uploadedFile.fileID !== 'pending') {
        void fileService.deleteFile(uploadedFile.fileID);
      }

      setUploadedFile({ fileID: res.fileID, filename: res.filename, size: res.size, ext: res.ext, status: 'uploaded' });
      toast({ title: "File uploaded", description: `${res.filename} uploaded successfully. You can now ask questions about your data.` });
    } catch (_e) {
      setUploadedFile({ 
        fileID: 'error', 
        filename: file.name, 
        size: file.size, 
        ext: (file.name.split('.').pop() || '').toLowerCase(), 
        status: 'error' 
      });
      toast({ title: "Upload error", description: "Failed to upload file. Please try again.", variant: "destructive" });
    }
    
    // Reset input
    event.target.value = '';
  };

  const handleExcelFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const validationError = validateClientFile(file);
    if (validationError) {
      toast({ title: "Upload error", description: validationError, variant: "destructive" });
      return;
    }
    
    try {
      // Create new file object for upload
      const newFile = { 
        fileID: 'pending', 
        filename: file.name, 
        size: file.size, 
        ext: (file.name.split('.').pop() || '').toLowerCase(), 
        status: 'uploading' as const 
      };
      
      // Replace behavior: if an uploaded file exists, we'll delete it after new upload succeeds
      setUploadedFile(newFile);

      const res: UploadResponse = await fileService.uploadFile(file);
      if (!res.success || !res.fileID || !res.ext || res.size === undefined || !res.filename) {
        setUploadedFile({ ...newFile, status: 'error' });
        toast({ title: "Upload failed", description: res.error || 'Upload failed', variant: "destructive" });
        return;
      }

      // Delete previous file if different
      if (uploadedFile && uploadedFile.fileID && uploadedFile.fileID !== 'pending') {
        void fileService.deleteFile(uploadedFile.fileID);
      }

      setUploadedFile({ fileID: res.fileID, filename: res.filename, size: res.size, ext: res.ext, status: 'uploaded' });
      toast({ title: "File uploaded", description: `${res.filename} uploaded successfully. You can now ask questions about your data.` });
    } catch (_e) {
      setUploadedFile({ 
        fileID: 'error', 
        filename: file.name, 
        size: file.size, 
        ext: (file.name.split('.').pop() || '').toLowerCase(), 
        status: 'error' 
      });
      toast({ title: "Upload error", description: "Failed to upload file. Please try again.", variant: "destructive" });
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
    transcript,
    error: speechError,
    isSupported: speechSupported,
    selectedLanguage,
    isListening: speechIsListening,
    detectedLanguage: speechDetectedLanguage,
    startListening,
    stopListening,
    resetTranscript,
    abortRecording,
    completeRecording
  } = useSpeechRecognition({
    onResult: (result) => {
      setInputValue(inputValue + (inputValue ? ' ' : '') + result);
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

  // Sync speech recognition state with chat store
  useEffect(() => {
    setIsListening(speechIsListening);
  }, [speechIsListening, setIsListening]);

  useEffect(() => {
    setDetectedLanguage(speechDetectedLanguage);
  }, [speechDetectedLanguage, setDetectedLanguage]);

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

  const removeUploadedFile = async (fileID: string) => {
    await removeFile(fileID);
    setUploadedFile(null);
  };

  return (
    <>
      <section className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden pt-20">
      {/* WaveBackground Component */}
      <WaveBackground 
        backdropBlurAmount="md" 
        className="absolute inset-0 z-0"
      />
      
      {/* Overlay for better text readability */}
      <div className="absolute inset-0 bg-black/60 z-1"></div>

      <div className="relative z-10 max-w-6xl mx-auto text-center">
        
        <h1 className="text-5xl md:text-7xl font-bold mb-6 animate-slide-up flex items-center justify-center gap-4 flex-wrap">
          <span className="text-white">Build</span>
          <span className="pr-3 text-transparent bg-clip-text bg-gradient-to-r from-accent via-white to-accent italic">
            Fancy Dashboard
          </span>
          <span className="text-white">in minutes with</span>
          <div className="gradient-panel rounded-xl px-6 py-3 flex items-center gap-3">
            <img 
              src="/dreamable-logo.png" 
              alt="Dreamable Logo" 
              className="w-6 h-6 rounded-lg object-contain"
            />
            <span className="text-white font-bold text-2xl md:text-4xl">Dreamable</span>
          </div>
        </h1>
        
        <p className="text-lg md:text-xl text-white/60 mb-8 max-w-3xl mx-auto animate-fade-in" style={{ animationDelay: '0s' }}>
          Transform raw data into stunningly and interactively visualised dashboards in minutes through 
          natural conversation with AI Agent. No technical skills required.
        </p>

        {/* Chat-First Interface */}
        <div className="max-w-4xl mx-auto mb-12 animate-fade-in" style={{ animationDelay: '0s' }}>
          {/* Main Chat Input */}
          <div className="w-full min-h-[80px] text-lg p-6 glass-panel border border-border/30 rounded-3xl resize-none transition-all duration-300">

            {/* File Chip Area */}
            {uploadedFile && (
              <div className="mt-0 mb-4 flex justify-start">
                <div className="w-[50%]">
                  <div className="glass-panel rounded-xl border border-border/30 py-2 px-4">
                    <div className="flex items-center justify-between gap-3">
                      {/* Left side - File info */}
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        {/* File Icon */}
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 icon-panel rounded-full flex items-center justify-center shadow-[0_5px_5px_rgba(255,255,255),0_10px_10px_hsl(var(--primary)),0_20px_20px_hsl(var(--secondary))]">
                            <FileText className="w-4 h-4 text-white" />
                          </div>
                        </div>
                        
                        {/* File details */}
                        <div className="min-w-0">
                          <div className="text-white font-medium text-sm truncate pb-1">
                            {uploadedFile.filename}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{(uploadedFile.size/1024/1024).toFixed(1)}MB</span>
                            <span>•</span>
                            <div className="flex items-center gap-1">
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                uploadedFile.status === 'uploading' ? 'bg-yellow-500' :
                                uploadedFile.status === 'processing' ? 'bg-blue-500' :
                                uploadedFile.status === 'processed' ? 'bg-green-500' :
                                uploadedFile.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                              }`}></div>
                              <span className="capitalize">
                                {uploadedFile.status === 'uploading' ? 'Uploading' :
                                 uploadedFile.status === 'processing' ? 'Processing' :
                                 uploadedFile.status === 'processed' ? 'Processed' :
                                 uploadedFile.status === 'error' ? 'Error' : 'Ready'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Right side - Actions */}
                      <div className="flex flex-col items-end gap-0 flex-shrink-0">
                        <Button
                          onClick={() => window.open(`/api/v1/files/preview/${uploadedFile.fileID}`, '_blank')}
                          disabled={uploadedFile.status === 'uploading' || uploadedFile.status === 'processing'}
                          className="button-gradient px-4 py-0 text-xs disabled:opacity-50 whitespace-nowrap"
                        >
                          Preview
                        </Button>
                        <button
                          onClick={() => removeUploadedFile(uploadedFile.fileID)}
                          className="text-[10px] text-muted-foreground hover:text-white underline transition-colors whitespace-nowrap"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

           {/* Textarea Row */}
            <div className="relative mb-4">
              <TextareaAutosize
                minRows={3}
                maxRows={10}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
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
                  className="w-8 h-8 rounded-md button-outline flex items-center justify-center group"
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
                  className="px-3 py-1.5 text-sm button-outline rounded-md disabled:opacity-50 flex items-center gap-2"
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
                  className="px-3 py-1.5 text-sm button-outline rounded-md disabled:opacity-50 flex items-center gap-2"
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
                    className="button-gradient rounded-md transition-all duration-200 px-4 py-1.5 text-sm flex items-center gap-2 h-auto"
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
                  className={`button-gradient p-3 ${
                    isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : ''
                  }`}
                  aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                  disabled={!speechSupported}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button
                  onClick={handleChatSubmit}
                  disabled={!inputValue.trim() || isProcessing}
                  className="button-gradient p-3 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span className="text-sm">Processing...</span>
                    </div>
                  ) : (
                    <CornerRightUp className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Quick Start Prompts */}
          <div className="flex justify-center gap-2 mt-6 flex-wrap animate-fade-in" style={{ animationDelay: '0s' }}>
            {["Monthly Revenue Trends", "Customer Funnel Analysis", "SaaS Metrics Dashboard", "E-commerce Analytics"].map((prompt) => (
              <button
                key={prompt}
                onClick={() => setInputValue(prompt)}
                className="px-4 py-2 text-sm bg-primary/10 text-primary border border-primary/20 rounded-full hover:bg-primary/20 transition-all duration-200"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* Scroll Stack Section */}
    <ScrollStack 
      cards={scrollStackCards}
      backgroundColor="#1f2937"
      cardHeight="80vh"
      animationDuration="0.8s"
      sectionHeightMultiplier={5}
    />
      
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