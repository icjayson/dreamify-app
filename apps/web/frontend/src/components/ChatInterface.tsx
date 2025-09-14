import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CornerRightUp, Upload, Bot, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign, ChevronDown, ChevronUp, Link, Mic, MicOff, FileText } from "lucide-react";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBarSidebar from './ui/recording-bar-sidebar';
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

import { Message } from "@/types/message";
import { fileService, type UploadResponse } from "@/services/fileService";
import { useToast } from "@/hooks/use-toast";
import { useChatStore } from "@/stores/useChatStore";
import { useFileStore } from "@/stores/useFileStore";

interface ChatInterfaceProps {
  onProcessedDataChange?: (data: any) => void;
}

const ChatInterface = ({ onProcessedDataChange }: ChatInterfaceProps) => {
  // Zustand stores
  const {
    inputValue,
    isTyping,
    messages,
    uploadedFile,
    dropdownOpen,
    selectedDataSource,
    isListening,
    detectedLanguage,
    setInputValue,
    setIsTyping,
    setMessages,
    addMessage,
    setUploadedFile,
    setDropdownOpen,
    setSelectedDataSource,
    setIsListening,
    setTranscript,
    setDetectedLanguage,
    sendMessage,
    clearInput,
    processFileWithMessage
  } = useChatStore();
  
  const {
    attachedCsvName,
    attachedCsvSummary,
    attachedCsvRaw,
    uploadState,
    setAttachedCsvName,
    setAttachedCsvSummary,
    setAttachedCsvRaw,
    uploadFile,
    removeFile,
    parseCsvToSummary,
    readCsvRawPreview,
    clearAttachment,
    validateClientFile
  } = useFileStore();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Speech recognition hook
  const {
    isSupported: speechSupported,
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

  // Connectors array for data source dropdown
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

  const escapeHtml = (unsafe: string): string =>
    unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const parseMessageToHtml = (raw: string): string => {
    let html = escapeHtml(raw);
    // <https://example.com>
    html = html.replace(/&lt;(https?:\/\/[^\s>]+)&gt;/g, (_m, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline">${url}</a>`;
    });
    // [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline">${text}</a>`;
    });
    // **bold**
    html = html.replace(/\*\*([^*]+)\*\*/g, (_m, text) => `<strong>${text}</strong>`);
    // Autolink bare URLs
    html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/_a>)/g, (_m, lead, url) => {
      return `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline">${url}</a>`;
    });
    return html;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  const handleSend = async (csvSummaryOverride?: string) => {
    if (!inputValue.trim()) return;

    clearInput();
    await processFileWithMessage(inputValue.trim(), onProcessedDataChange);
  };


  const getContextualResponse = (input: string): string => {
    const lowerInput = input.toLowerCase();
    
    // Data upload responses
    if (lowerInput.includes('upload') || lowerInput.includes('data') || lowerInput.includes('csv')) {
      return "Great! I can help you upload your data. Please drag your CSV, Excel, or JSON file here, or click the upload button. I support files up to 100MB and can automatically detect your data structure.";
    }
    
    // Revenue/MRR requests
    if (lowerInput.includes('revenue') || lowerInput.includes('mrr') || lowerInput.includes('sales')) {
      return "Perfect! I'll create a stunning revenue dashboard with animated line charts showing your growth trends. I can include MRR growth rates, cohort analysis, and forecasting. Should I also add conversion funnels?";
    }
    
    // Dashboard creation
    if (lowerInput.includes('dashboard') || lowerInput.includes('chart') || lowerInput.includes('visualiz')) {
      return "I'll build your interactive dashboard with smooth animations! I can create line charts, bar charts, funnels, and geographic visualizations. What specific metrics would you like to focus on first?";
    }
    
    // Animation/motion requests
    if (lowerInput.includes('animation') || lowerInput.includes('motion') || lowerInput.includes('smooth')) {
      return "Excellent! I'll add cinematic animations with staggered entrance effects, hover interactions, and smooth transitions. Your dashboard will have that premium feel with 60fps performance.";
    }
    
    // General responses
    const generalResponses = [
      "I can see you want to visualize your data beautifully! Let me create an interactive dashboard with motion effects. What type of data are you working with?",
      "Perfect! I'll help you build a stunning analytics dashboard. I can handle revenue metrics, user engagement, conversion funnels, and more. What's your primary use case?",
      "Great question! I specialize in creating motion-rich dashboards that tell compelling data stories. Should I start with your key performance indicators?",
      "I'll transform your raw data into beautiful, animated visualizations. Do you have existing data to upload, or should I create a demo with sample metrics?"
    ];
    
    return generalResponses[Math.floor(Math.random() * generalResponses.length)];
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleDataSourceSelect = (source: string) => {
    setSelectedDataSource(source);
    setDropdownOpen(false);
    console.log('Data source selected:', source);
  };

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
    resetTranscript();
  };


  const removeUploadedFile = async (fileID: string) => {
    await removeFile(fileID);
    setUploadedFile(null);
  };



  const suggestedPrompts = [
    { text: "Upload my sales data and create dashboard", icon: Database },
    { text: "Show revenue trends with smooth animations", icon: TrendingUp },
    { text: "Create conversion funnel visualization", icon: BarChart3 },
    { text: "Build customer growth dashboard", icon: Users },
    { text: "Analyze profit margins by product", icon: DollarSign },
    { text: "Add geographic revenue distribution", icon: Sparkles }
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-5 h-5 text-accent" />
          <span className="font-medium">AI Assistant</span>
          <Badge variant="outline" className="ml-auto text-xs">Online</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Describe your dashboard vision and I'll build it with beautiful animations
        </p>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-enter flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[85%] flex gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                message.role === "user" 
                  ? "bg-primary/20" 
                  : "bg-accent/20"
              }`}>
                {message.role === "user" ? (
                  <User className="w-3 h-3 text-primary" />
                ) : (
                  <Bot className="w-3 h-3 text-accent" />
                )}
              </div>
              
              <div className={`p-3 glass-panel rounded-2xl text-sm whitespace-pre-wrap break-words ${
                message.role === "user" 
                  ? "bg-primary/10 border-primary/20" 
                  : "bg-card/80 border-border/50"
              }`}>
                {message.attachment && message.attachment.kind === "csv" && (
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Attached CSV: {message.attachment.name}
                  </div>
                )}
                <div
                  className="leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere]"
                  dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }}
                />
                <span className="text-xs text-muted-foreground mt-1 block">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start chat-enter">
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-md bg-accent/20 flex items-center justify-center">
                <Bot className="w-3 h-3 text-accent" />
              </div>
              <Card className="p-3 glass-panel bg-card/80 border-border/50">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm text-accent">AI is analyzing...</span>
                </div>
              </Card>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompts */}
      {messages.length <= 1 && (
        <div className="mx-2">
          <p className="text-xs text-muted-foreground mb-2">Quick starts:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedPrompts.slice(0, 3).map((prompt, index) => (
              <button
                key={index}
                onClick={() => setInputValue(prompt.text)}
                className="px-2 py-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-full hover:bg-primary/20 transition-all duration-200 flex items-center gap-1"
              >
                <prompt.icon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{prompt.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* File Chip Area */}
      {uploadedFile && (
        <div className="mx-2 mt-4 mb-2">
          <div className="glass-panel rounded-xl border border-border/30 py-2 px-4">
            <div className="flex items-center justify-between gap-2">
              {/* Left side - File info */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* File Icon */}
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-background/50 border border-border/30 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                </div>
                
                {/* File details */}
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium text-xs truncate">
                    {uploadedFile.filename}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>{(uploadedFile.size/1024/1024).toFixed(1)}MB</span>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        uploadedFile.status === 'uploading' ? 'bg-yellow-500' :
                        uploadedFile.status === 'processing' ? 'bg-blue-500' :
                        uploadedFile.status === 'processed' ? 'bg-green-500' :
                        uploadedFile.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                      }`}></div>
                      <span className="capitalize truncate">
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
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <Button
                  onClick={() => window.open(`/api/v1/files/preview/${uploadedFile.fileID}`, '_blank')}
                  disabled={uploadedFile.status === 'uploading' || uploadedFile.status === 'processing'}
                  className="button-gradient px-2 py-0 text-xs disabled:opacity-50 whitespace-nowrap"
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
      )}

      {/* Input Area */}
      <div className="m-2 bg-card/30">
        {/* Main Chat Input with Hero Section Styling */}
        <div className="w-full min-h-[60px] text-sm p-4 glass-panel rounded-2xl resize-none transition-all duration-300">
          {/* Textarea Row */}
          <div className="relative mb-3">
            <TextareaAutosize
              minRows={2}
              maxRows={6}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={isListening ? 'Listening...' : "Describe your dashboard..."}
              className="w-full bg-transparent border-none outline-none resize-none text-sm placeholder:text-muted-foreground/60"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </div>
          
          {/* Recording Bar - Positioned between textarea and buttons */}
          <RecordingBarSidebar 
            isVisible={isListening}
            detectedLanguage={detectedLanguage}
            onCancel={handleRecordingCancel}
            onConfirm={handleRecordingConfirm}
          />
          
          {/* Buttons Row */}
          <div className="flex items-center justify-between">
            {/* Left side - File Upload and Data Connector Buttons */}
            <div className="flex items-center gap-2">
              {/* Upload Button - Icon only */}
              <button
                onClick={handleFileUpload}
                className="button-outline p-2 flex items-center justify-center"
              >
                <Upload className="w-4 h-4" />
              </button>

              {/* Data Connector Dropup */}
              <div className="relative data-source-dropdown">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="button-outline p-2 flex items-center justify-center gap-1"
                  aria-expanded={dropdownOpen}
                  aria-haspopup="true"
                  aria-label="Connect data source"
                >
                  <Link className="w-4 h-4" />
                  <ChevronUp className={`w-3 h-3 text-white/60 ${
                    dropdownOpen ? 'rotate-180' : ''
                  }`} />
                </button>
                
                {dropdownOpen && (
                  <div className="absolute bottom-full left-0 mb-1 w-48 bg-background/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg z-10">
                    <div className="py-1">
                      {connectors.map((connector) => (
                        <button
                          key={connector.name}
                          onClick={() => handleDataSourceSelect(connector.name)}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2"
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
            
            {/* Right side - Mic and Send Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleMicClick}
                className={`p-2 flex items-center justify-center ${
                  isListening ? 'text-red-500 animate-pulse' : 'text-white hover:text-primary'
                }`}
                aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                disabled={!speechSupported}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <Button
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || isTyping}
                className="button-gradient p-3 disabled:opacity-50"
              >
                <CornerRightUp className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.xlsx,.xls"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
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
          }}
        />
      </div>
    </div>
  );
};

export default ChatInterface;