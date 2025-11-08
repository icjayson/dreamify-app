import { useRef, useEffect, useState } from "react";
import LoadingPanel from "@/chat/LoadingPanel";
import { Button } from "@/components/ui/button";
import { CornerRightUp, Upload, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign, ChevronDown, ChevronUp, ChevronRight, Link, Mic, MicOff, FileText, LayoutTemplate } from "lucide-react";
import { CONNECTORS } from "@/constants/connectors";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBarSidebar from '@/components/ui/recording-bar-sidebar';
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { fileService, type UploadResponse } from "@/services/fileService";
import { useToast } from "@/hooks/use-toast";
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import TemplateModal from "@/components/homepage-section/TemplateModal";

// Rolling multiline log for loading animation
const RollingText = () => {
  const actions = [
    "Thinking...",
    "Analyzing data...",
    "Reading CSV...",
    "Detecting patterns...",
    "Calculating metrics...",
    "Processing insights...",
    "Designing charts...",
    "Optimizing layout...",
    "Adding animations...",
    "Structuring components...",
    "Applying themes...",
    "Testing responsiveness...",
    "Building dashboard...",
    "Finalizing...",
    "Almost ready..."
  ];
  const [lines, setLines] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLines((prev) => {
        const next = [...prev, actions[idx]];
        // keep last 8 lines
        return next.slice(-8);
      });
      setIdx((p) => (p + 1) % actions.length);
    }, 2400);
    return () => clearInterval(interval);
  }, [actions, idx]);

  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <div key={`${i}-${line}`} className={`text-sm ${i === lines.length - 1 ? 'active-breathing' : ''} animate-fade-in-300`}>
          {line}
        </div>
      ))}
    </div>
  );
};

interface ChatInterfaceProps {
  onProcessedDataChange?: (data: any) => void;
  onSwitchToDashboard?: () => void;
}

const ChatInterface = ({ onProcessedDataChange, onSwitchToDashboard }: ChatInterfaceProps) => {
  // Template state
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  // Zustand stores
  const {
    inputValue,
    isTyping,
    isProcessing,
    messages,
    uploadedFile,
    dropdownOpen,
    selectedDataSource,
    isListening,
    detectedLanguage,
    selectedTemplate,
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
    setSelectedTemplate,
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

  // (removed store token listener)

  // Also listen to a global event to open the file picker directly
  useEffect(() => {
    const handler = () => {
      fileInputRef.current?.click();
    };
    window.addEventListener('nyx:open-file-picker', handler as EventListener);
    return () => window.removeEventListener('nyx:open-file-picker', handler as EventListener);
  }, []);

  // Connectors array for data source dropdown
  // Shared connectors list imported above

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

    // Delegate adding the user message to the store's process flow to avoid duplicates
    clearInput();
    await processFileWithMessage(inputValue.trim(), onProcessedDataChange);
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

  const suggestedPrompts = [
    { text: "Act as a Data Analyst: challenge assumptions and list caveats.", icon: Database },
    { text: "Act as a Growth PM: prioritize the top 3 actions from this data.", icon: TrendingUp },
    { text: "Act as a Sales Ops lead: translate insights into pipeline plays.", icon: BarChart3 },
    { text: "Build a comprehensive dashboard from connected data", icon: Users },
    { text: "Analyze profit margins by product", icon: DollarSign },
    { text: "Add geographic revenue distribution", icon: Sparkles }
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-muted">

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-4">
        {messages.map((message, index) => (
          <>
            <div
              key={message.id}
              className={`chat-enter flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[90%] flex gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                  message.role === "user" 
                    ? "bg-black" 
                    : "bg-transparent"
                }`}>
                  {message.role === "user" ? (
                    <User className="w-3 h-3 text-white" />
                  ) : (
                    <img src="/logo-watermark.png" alt="Morpheus" className="h-3 w-auto object-contain" />
                  )}
                </div>
                
                <div className={`rounded-xl text-sm whitespace-pre-wrap break-words ${
                  message.role === "user" 
                    ? "bg-black p-3" 
                    : "bg-transparent p-0"
                }`}>
                  {message.attachment && message.attachment.kind === "csv" && (
                    <div className="mb-2">
                      <span
                        className="inline-flex flex-col items-start gap-0.5 px-4 py-1 rounded-lg border border-white/20 bg-white/10 text-[11px] text-white/90 w-full"
                        title={message.attachment.name}
                        aria-label="Attached CSV file"
                      >
                        <span className="inline-flex items-center gap-1 text-white/70">
                          <FileText className="w-3 h-3 text-white/80" />
                          Attached file
                        </span>
                        <span className="truncate w-full">{message.attachment.name}</span>
                      </span>
                    </div>
                  )}
                  {message.template && (
                    <div className="mb-2">
                      <span
                        className="inline-flex flex-col items-start gap-0.5 px-4 py-1 rounded-lg border border-white/20 bg-white/10 text-[11px] text-white/90 w-full"
                        title={message.template.title}
                        aria-label="Selected template"
                      >
                        <span className="inline-flex items-center gap-1 text-white/70">
                          <LayoutTemplate className="w-3 h-3 text-white/80" />
                          Template
                        </span>
                        <span className="truncate w-full">{message.template.title}</span>
                      </span>
                    </div>
                  )}
                  {message.role === 'assistant' && message.dashboardCard ? (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Open dashboard"
                      onClick={() => { onSwitchToDashboard && onSwitchToDashboard(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onSwitchToDashboard && onSwitchToDashboard(); } }}
                      className="group w-full rounded-xl border border-white/20 bg-white/5 p-3 hover:bg-white/10 transition-colors cursor-pointer select-none flex items-center justify-between"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">Dashboard</div>
                        <div className="text-xs text-white/70 mt-0.5 truncate">Source: {message.dashboardCard.sourceFileName}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/60 flex-shrink-0 ml-2 group-hover:translate-x-1 transition-transform duration-200" />
                    </div>
                  ) : (
                    <div
                      className="leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere]"
                      dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }}
                    />
                  )}
                  <span className="text-xs text-muted-foreground mt-1 block">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
            {/* Inline Loading Panel under the last user message that started analysis */}
            {message.role === 'user'
              && index === messages.length - 1
              && uploadedFile
              && (isProcessing || uploadedFile.status === 'processing') && (
                <div className={`flex justify-start mt-1`}>
                  <div className={`ml-8`}>
                    <LoadingPanel
                      isActive={true}
                      stopSignal={uploadedFile.status === 'processed' || (!isProcessing && !isTyping)}
                      mode={'dashboard'}
                    />
                  </div>
                </div>
            )}
          </>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompts */}
      {messages.length <= 1 && (
        <div className="mt-auto">
          <p className="text-xs mx-2 text-muted-foreground mb-2">Quick starts:</p>
          <div className="flex flex-wrap w-full items-start gap-2 mx-2 pr-3">
            {suggestedPrompts.slice(0, 4).map((prompt, index) => (
              <button
                key={index}
                onClick={() => setInputValue(prompt.text)}
                className="inline-flex self-start px-2 py-1 text-xs text-white/30 border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-200 text-left whitespace-normal break-words leading-snug overflow-hidden box-border max-w-full"
              >
                <span className="block min-w-0 break-words">{prompt.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Area: File chip + Input */}
      <div className="mt-auto">
        {uploadedFile && (
          <div className="mx-2 mt-4 mb-2">
            <div className="bg-black rounded-xl py-2 px-4">
              <div className="flex items-center justify-between gap-2">
                {/* Left side - File info */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* File Icon */}
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-lg border border-white/20 bg-white/10 flex items-center justify-center">
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
                    onClick={async () => {
                      try {
                        const { useAuth } = await import('@clerk/clerk-react');
                        const token = await useAuth().getToken();
                        const url = token
                          ? `/api/v1/files/preview/${uploadedFile.fileID}?token=${encodeURIComponent(token)}`
                          : `/api/v1/files/preview/${uploadedFile.fileID}`;
                        window.open(url, '_blank');
                      } catch {
                        window.open(`/api/v1/files/preview/${uploadedFile.fileID}`, '_blank');
                      }
                    }}
                    disabled={uploadedFile.status === 'uploading' || uploadedFile.status === 'processing'}
                    className="text-xs bg-[#292929] text-white p-2 disabled:opacity-50 whitespace-nowrap"
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
        <div className="m-2">
        {/* Main Chat Input with Hero Section Styling */}
        <div className="w-full min-h-[60px] text-sm p-4 pb-2 bg-[#292929] rounded-xl resize-none transition-all duration-300">
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
          
          {/* Template Tag Row */}
          {selectedTemplate && (
            <div className="flex justify-start mb-1">
              <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-muted border border-border text-white">
                <div className="w-3 h-3 grid grid-cols-2 gap-0.5">
                  <div className="w-1 h-1 bg-white rounded-sm"></div>
                  <div className="w-1 h-1 bg-white rounded-sm"></div>
                  <div className="w-1 h-1 bg-white rounded-sm"></div>
                  <div className="w-1 h-1 bg-white rounded-sm"></div>
                </div>
                <span className="text-xs font-medium">{selectedTemplate.title}</span>
                <button
                  onClick={handleTemplateRemove}
                  className="w-3 h-3 flex items-center justify-center hover:bg-muted-foreground/20 rounded-sm transition-colors"
                  aria-label="Remove template"
                >
                  <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>
          )}
          
          {/* Buttons Row */}
          <div className="flex items-center justify-between">
            {/* Left side - File Upload and Data Connector Buttons */}
            <div className="flex items-center gap-2">
              {/* Upload Button - Icon only */}
              <button
                onClick={handleFileUpload}
                className="p-2 flex items-center justify-center border border-white/30 rounded-md"
              >
                <Upload className="w-4 h-4" />
              </button>

              {/* Template Button */}
              <button
                onClick={handleCloneTemplateClick}
                className="p-2 flex items-center justify-center border border-white/30 rounded-md"
                aria-label="Choose template"
              >
                <LayoutTemplate className="w-4 h-4" />
              </button>

              {/* Data Connector Dropup */}
              <div className="relative data-source-dropdown">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className={`p-2 flex items-center justify-center gap-1 rounded-md transition-all duration-200 ${
                    selectedDataSource 
                      ? `${getDataSourceColors(selectedDataSource).bg} ${getDataSourceColors(selectedDataSource).border} ${getDataSourceColors(selectedDataSource).text} ${getDataSourceColors(selectedDataSource).hover} border`
                      : 'border border-white/30'
                  }`}
                  aria-expanded={dropdownOpen}
                  aria-haspopup="true"
                  aria-label="Connect data source"
                >
                  <Link className="w-4 h-4" />
                  <ChevronUp className={`w-3 h-3 transition-transform duration-200 ${
                    selectedDataSource ? 'text-white' : 'text-white/60'
                  } ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {dropdownOpen && (
                  <div className="absolute bottom-full left-0 mb-1 w-48 bg-background/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg z-10">
                    <div className="py-1">
                      {CONNECTORS.map((connector) => (
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
              try {
                // Persist original file for CSV export if it's CSV
                if ((file.name.split('.').pop() || '').toLowerCase() === 'csv') {
                  // store in chat store for export
                  // lazy import to avoid circulars
                  const { useChatStore } = await import('@/chat/useChatStore');
                  useChatStore.getState().setOriginalFile({ blob: file, name: file.name });
                } else {
                  const { useChatStore } = await import('@/chat/useChatStore');
                  useChatStore.getState().setOriginalFile(null);
                }
              } catch (_err) {}
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

      {/* Template Modal */}
      <TemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onTemplateSelect={handleTemplateSelect}
      />
    </div>
  );
};

export default ChatInterface;