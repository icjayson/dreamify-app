import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Upload, Database, CornerRightUp, LayoutTemplate, Mic, MicOff, Link, FileText } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { SignedIn, useAuth, useUser } from "@clerk/clerk-react";
import { ChevronRight } from "lucide-react";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useToast } from "@/hooks/use-toast";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBar from '@/components/ui/recording-bar';
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import { fileService, type UploadResponse } from "@/services/fileService";
import { Message } from "@/types/message";
import { FooterSection } from '@/components/homepage-section/footer-section';
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import ProjectsSection from '@/components/homepage-section/ProjectsSection';
import ProjectsSidebar from '@/components/homepage-section/ProjectsSidebar';
import TemplateModal from '@/components/homepage-section/TemplateModal';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

interface HomePageProps {
  onGetStarted: () => void;
  onProcessedDataChange?: (data: any) => void;
}

const HomePage = ({ onGetStarted, onProcessedDataChange }: HomePageProps) => {
  const navigate = useNavigate();
  const { isSignedIn, getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const [user, setUser] = useState<any | null>(null);
  const [token, setToken] = useState<string | null>(null);
  
  useEffect(() => {
    if (isSignedIn && clerkUser) {
      setUser(clerkUser);
      getToken().then((tokenValue) => {
        setToken(tokenValue);
        console.log('User:', clerkUser);
        console.log('Token:', tokenValue);
      }).catch((error) => {
        console.error('Failed to get token:', error);
      });
    } else {
      setUser(null);
      setToken(null);
    }
  }, [isSignedIn, clerkUser, getToken]);
  // Mock recent projects
  const [recentProjects, setRecentProjects] = useState<Array<{ id: string; title: string }>>([
    { id: 'p1', title: 'Marketing Dashboard' },
    { id: 'p2', title: 'Sales Overview' },
    { id: 'p3', title: 'Product Analytics' },
    { id: 'p4', title: 'Finance KPI Board' },
    { id: 'p5', title: 'Operations Metrics' },
  ]);

  const openProject = (_id: string) => {
    navigate('/workspace/project');
  };

  const renameProject = (id: string, newTitle: string) => {
    setRecentProjects((prev) => prev.map((p) => (p.id === id ? { ...p, title: newTitle } : p)));
  };

  const deleteProject = (id: string) => {
    setRecentProjects((prev) => prev.filter((p) => p.id !== id));
  };
  // Zustand stores
  const {
    inputValue,
    selectedDataSource,
    dropdownOpen,
    isListening,
    detectedLanguage,
    uploadedFile,
    isProcessing,
    selectedTemplate,
    setInputValue,
    setSelectedDataSource,
    setDropdownOpen,
    setUploadedFile,
    setIsListening,
    setDetectedLanguage,
    setSelectedTemplate,
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
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  
  // Toast hook
  const { toast } = useToast();
  
  // File upload integration
  const { uploadState: legacyUploadState, uploadCSVFile, uploadExcelFile } = useFileUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Function to get colors for each data source
  const getDataSourceColors = (sourceName: string) => {
    const colors: { [key: string]: { bg: string; border: string; text: string; hover: string } } = {
      "Google Sheets": { bg: "bg-green-500", border: "border-green-400", text: "text-white", hover: "hover:bg-green-600" },
      "GA4": { bg: "bg-orange-500", border: "border-orange-400", text: "text-white", hover: "hover:bg-orange-600" },
      "Meta": { bg: "bg-blue-600", border: "border-blue-500", text: "text-white", hover: "hover:bg-blue-700" },
      "Airtable": { bg: "bg-blue-400", border: "border-blue-300", text: "text-white", hover: "hover:bg-blue-500" },
      "Stripe": { bg: "bg-purple-600", border: "border-purple-500", text: "text-white", hover: "hover:bg-purple-700" },
      "Shopify": { bg: "bg-green-700", border: "border-green-600", text: "text-white", hover: "hover:bg-green-800" },
      "HubSpot": { bg: "bg-orange-600", border: "border-orange-500", text: "text-white", hover: "hover:bg-orange-700" },
      "PostgreSQL": { bg: "bg-blue-700", border: "border-blue-600", text: "text-white", hover: "hover:bg-blue-800" }
    };
    return colors[sourceName] || { bg: "bg-primary", border: "border-primary", text: "text-white", hover: "hover:bg-primary/90" };
  };

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
    // Gate by auth: show waitlist modal if not signed in
    if (!isSignedIn) {
      setWaitlistOpen(true);
      return;
    }
    if (!inputValue.trim()) return;
    if (!uploadedFile || uploadedFile.status !== 'uploaded') {
      toast({ title: "Upload required", description: "Upload a CSV before asking a question.", variant: "destructive" });
      return;
    }
    
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
      template: selectedTemplate || undefined,
    };
    
    // Add message to store synchronously before switching views
    addMessage(userMessage);
    
    // Start processing in background
    void processFileWithMessage(inputValue.trim(), onProcessedDataChange);
    
    // Navigate to project workspace for unified chat + dashboard flow
    navigate('/workspace/project');
  };

  const handleFileUpload = (files: FileList | null) => {
    // Upload alone should not navigate; navigation happens on prompt submit
    if (files && files.length > 0) {
      // no-op here; actual upload handled by input change handlers
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

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleCloneTemplateClick = () => {
    setTemplateModalOpen(true);
  };

  const handleTemplateSelect = (template: { id: string; title: string; description: string; image: string; category: string }) => {
    setSelectedTemplate(template);
    setInputValue(`Use ${template.title} template to make `);
    console.log('Template selected:', template);
  };

  const handleTemplateRemove = () => {
    setSelectedTemplate(null);
    setInputValue('');
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const [projectsOpen, setProjectsOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  useEffect(() => {
    const openProjects = () => setProjectsOpen(true);
    window.addEventListener('open-projects', openProjects as EventListener);
    return () => window.removeEventListener('open-projects', openProjects as EventListener);
  }, []);


  // sidebar show/animation is handled inside ProjectsSidebar component

  const closeProjects = () => {
    setProjectsOpen(false);
    window.dispatchEvent(new Event('close-projects'));
  };

  // Allow page to scroll even when sidebar is open (no body lock)

  return (
    <div className="min-h-screen overflow-y-auto homepage-scrollbar">
      {/* Fixed WaveBackground Component for entire page */}
      <WaveBackground 
        className="fixed inset-0 z-0"
      />
      
      {/* Fixed overlay for better text readability */}
      <div className="fixed inset-0 bg-black/60 z-1"></div>

      <section className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden pt-44">

      <div className="relative z-10 max-w-6xl mx-auto text-center">
        
        {/* New 2-row heading layout */}
        <div className="text-center mb-8 animate-slide-up">
          {/* Row 1: The AI Data Analyst with gradient styling */}
          <h1 className="text-5xl md:text-7xl font-bold mb-6 font-instrument-serif">
            <span className="px-0 py-1 text-transparent bg-clip-text bg-gradient-to-r from-accent via-white to-accent italic">
              The AI Data Analyst
            </span>
          </h1>
          
          {/* Row 2: Logo + Build Fancy Dashboard in minutes */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h2 className="text-xl lg:text-3xl text-white font-inter">
              Build Fancy Dashboard in minutes with
            </h2>
            <div className="button-gradient rounded-xl px-4 py-2 flex items-center gap-3">
              <img 
                src="/logo-full-horizon-white.png" 
                alt="Dreamify Logo" 
                className="w-20 sm:w-24 md:w-28 lg:w-36 h-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>

        {/* Chat-First Interface */}
        <div className="max-w-sm sm:max-w-md md:max-w-2xl lg:max-w-4xl mx-auto mb-12 animate-fade-in" style={{ animationDelay: '0s' }}>
          {/* Main Chat Input */}
          <div className="w-full min-h-[80px] text-md p-3 sm:p-4 glass-panel border border-border/30 rounded-3xl resize-none transition-all duration-300">

            {/* File Chip Area */}
            {uploadedFile && (
              <div className="mt-0 mb-4 flex justify-start">
                <div className="w-full sm:w-3/4 md:w-2/3 lg:w-1/2">
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
                          onClick={async () => {
                            try {
                              const token = await useAuth().getToken();
                              // save token to _token.json filejson
                              const url = token 
                                ? `/api/v1/files/preview/${uploadedFile.fileID}?token=${encodeURIComponent(token)}`
                                : `/api/v1/files/preview/${uploadedFile.fileID}`;
                              window.open(url, '_blank');
                            } catch {
                              window.open(`/api/v1/files/preview/${uploadedFile.fileID}`, '_blank');
                            }
                          }}
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
            
            {/* Template Tag Row - Mobile Only */}
            {selectedTemplate && (
              <div className="flex justify-start mb-3 lg:hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted border border-border text-white">
                  <div className="w-4 h-4 grid grid-cols-2 gap-0.5">
                    <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                    <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                    <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                    <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                  </div>
                  <span className="text-sm font-medium">{selectedTemplate.title}</span>
                  <button
                    onClick={handleTemplateRemove}
                    className="w-4 h-4 flex items-center justify-center hover:bg-muted-foreground/20 rounded-sm transition-colors"
                    aria-label="Remove template"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {/* Buttons Row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {/* Left side buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Hidden file input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                  aria-label="Select file"
                />

                {/* Attach Button */}
                <button
                  onClick={handleAttachClick}
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
                  aria-label="Attach file"
                >
                  <Upload className="w-4 h-4" />
                  <span className="hidden sm:inline">{uploadState.isUploading ? 'Uploading...' : 'Attach'}</span>
                </button>

                {/* Clone Template Button */}
                <button
                  onClick={handleCloneTemplateClick}
                  className="px-3 py-1.5 text-sm button-outline rounded-md flex items-center gap-2"
                  onMouseEnter={(e) => {
                    e.currentTarget.classList.add('btn-primary-hover');
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.classList.remove('btn-primary-hover');
                  }}
                  aria-label="Clone template"
                >
                  <LayoutTemplate className="w-4 h-4" />
                  <span className="hidden sm:inline">Template</span>
                </button>

                {/* Connect Data Source Dropdown */}
                <div className="relative data-source-dropdown">
                  <Button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className={`rounded-md transition-all duration-200 px-4 py-1.5 text-sm flex items-center gap-2 h-auto ${
                      selectedDataSource 
                        ? `${getDataSourceColors(selectedDataSource).bg} ${getDataSourceColors(selectedDataSource).border} ${getDataSourceColors(selectedDataSource).text} ${getDataSourceColors(selectedDataSource).hover} border`
                        : 'button-gradient'
                    }`}
                    aria-expanded={dropdownOpen}
                    aria-haspopup="true"
                    aria-label="Connect data source"
                  >
                    <span className="hidden sm:inline">{selectedDataSource || "Connect data source"}</span>
                    <Link className={`w-4 h-4 transition-transform duration-200 ${
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

                {/* Selected Template Tag - Desktop Only */}
                {selectedTemplate && (
                  <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted border border-border text-white">
                    <div className="w-4 h-4 grid grid-cols-2 gap-0.5">
                      <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                      <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                      <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                      <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>
                    </div>
                    <span className="text-sm font-medium">{selectedTemplate.title}</span>
                    <button
                      onClick={handleTemplateRemove}
                      className="w-4 h-4 flex items-center justify-center hover:bg-muted-foreground/20 rounded-sm transition-colors"
                      aria-label="Remove template"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                )}
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
          <div className="flex flex-col gap-2 mt-4 sm:mt-6 animate-fade-in w-full" style={{ animationDelay: '0s' }}>
            <p className="text-xs text-white/40 text-left ml-1">Quick start prompts:</p>
            <div className="flex flex-wrap gap-2">
            {["Act as a Data Analyst: challenge assumptions and list caveats.", "Act as a Growth PM: prioritize the top 3 actions from this data.", "Act as a Sales Ops lead: translate insights into pipeline plays.", "Build a comprehensive dashboard from the connected data source"].map((prompt) => (
              <button
                key={prompt}
                onClick={() => setInputValue(prompt)}
                className="px-4 py-2 text-xs bg-primary/20 text-white/40 border border-primary/50 rounded-full hover:bg-primary/40 hover:text-white/80 transition-all duration-200"
              >
                {prompt}
              </button>
            ))}
            </div>
          </div>
        </div>
      </div>
      {/* Sentinel marks the end of the hero section for header trigger */}
      <div id="hero-sentinel" aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-px pointer-events-none" />
    </section>

    {/* Removed floating button here; header provides the button when signed in */}

    {/* Projects sidebar */}
    <ProjectsSidebar
      open={projectsOpen}
      onClose={closeProjects}
      onNewProject={() => navigate('/workspace/project')}

    />
    <TemplateModal
      open={templateModalOpen}
      onClose={() => setTemplateModalOpen(false)}
      onTemplateSelect={handleTemplateSelect}
    />
    <FooterSection />
    {/* Waitlist modal for signed-out users */}
    <Dialog open={waitlistOpen} onOpenChange={setWaitlistOpen}>
      <DialogContent className="bg-muted border border-border rounded-xl sm:rounded-2xl p-5 sm:p-6 w-full max-w-[92vw] sm:max-w-xl">
        <DialogTitle className="text-2xl md:text-3xl font-semibold text-white">Join the waitlist to get early access</DialogTitle>
        <DialogDescription className="text-white/70 mt-1 text-sm md:text-base">
          Be among the first to try Dreamify when it's ready.
        </DialogDescription>
        <div className="mt-6 flex items-center gap-4">
          <img src="/logo-watermark.png" alt="Dreamify" className="w-16 h-16 rounded-lg object-contain bg-transparent" />
          <div className="ml-auto">
            <Button
              onClick={() => { setWaitlistOpen(false); navigate('/waitlist'); }}
              className="button-gradient px-5 py-2 rounded-xl"
            >
              Go to waitlist
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

  </div>
);
};

export default HomePage;