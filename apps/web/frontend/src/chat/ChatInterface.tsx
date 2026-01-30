import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CornerRightUp, Upload, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign, ChevronDown, ChevronUp, ChevronRight, Link, Mic, MicOff, FileText, LayoutTemplate, Square, X, CheckCircle } from "lucide-react";
import { CONNECTORS, type ConnectorItem } from "@/constants/connectors";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBarSidebar from '@/components/ui/recording-bar-sidebar';
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { fileService, type UploadResponse } from "@/services/fileService";
import { useToast } from "@/hooks/use-toast";
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import TemplateModal from "@/components/homepage-section/TemplateModal";

// Helper function to map workflow-status step values to display text
const mapStepToDisplayText = (step: string): string => {
  const stepMap: Record<string, string> = {
    "load_conversation": "Loading conversation...",
    "download_asset": "Downloading file...",
    "run_workflow": "Running workflow...",
  };
  return stepMap[step] || "Processing...";
};

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
};

// Helper function to format file status for display
const formatAssetStatus = (status: string | null | undefined): string => {
  if (!status) return "Ready to analyze";
  
  // Map status values to display text
  const statusMap: Record<string, string> = {
    "uploading": "Uploading",
    "uploaded": "Ready to analyze",
    "processing": "Processing",
    "processed": "Processed",
    "error": "Error",
    "accepted": "Processing",
  };
  
  return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
};

// Rolling multiline log for loading animation
interface RollingTextProps {
  isActive: boolean;
  stopSignal: boolean;
  successText?: string;
  currentStep?: string | null;
}

const RollingText = ({ isActive, stopSignal, successText = "", currentStep = null }: RollingTextProps) => {
  const [lines, setLines] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [stopped, setStopped] = useState(false);
  const prevStepRef = useRef<string | null>(null);

  // Start when becoming active the first time
  useEffect(() => {
    if (!started && isActive) {
      setStarted(true);
      setStopped(false);
      setLines([]);
      prevStepRef.current = null;
    }
  }, [isActive, started]);

  // Watch for currentStep changes and add new line when step changes
  useEffect(() => {
    if (!started || stopped) return;
    
    if (currentStep && currentStep !== prevStepRef.current) {
      const displayText = mapStepToDisplayText(currentStep);
      setLines((prev) => {
        // Check if last line is different to avoid duplicates
        const lastLine = prev[prev.length - 1];
        if (lastLine !== displayText) {
          // Keep all historical lines (limit to last 20 to prevent memory issues)
          return [...prev, displayText].slice(-20);
        }
        return prev;
      });
      prevStepRef.current = currentStep;
    }
  }, [currentStep, started, stopped]);

  // Stop when stopSignal becomes true
  useEffect(() => {
    if (started && !stopped && stopSignal) {
      setStopped(true);
      setLines((prev) => [...prev, successText].slice(-20));
    }
  }, [stopSignal, started, stopped, successText]);

  // Render nothing until started
  if (!started && lines.length === 0) return null;

  return (
    <div className="space-y-1 text-white">
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1 && !stopped;
        return (
          <div
            key={`${i}-${line}`}
            className={`text-sm animate-fade-in-300 ${isLast ? 'active-breathing text-gradient-sweep caret' : 'text-white/90'}`}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};

interface ChatInterfaceProps {
  projectId?: string;
  onProcessedDataChange?: (data: any) => void;
  onSwitchToDashboard?: (dashboardId?: string) => void;
}

const ChatInterface = ({ projectId, onProcessedDataChange, onSwitchToDashboard }: ChatInterfaceProps) => {
  // Template state
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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
    currentWorkflowStep,
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
    processFileWithMessage,
    stopGeneration
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
  const isSendingRef = useRef<boolean>(false);
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
    if (isSendingRef.current) return;

    isSendingRef.current = true;
    const messageContent = inputValue.trim();
    
    try {
      // Delegate adding the user message to the store's process flow to avoid duplicates
      clearInput();
      // Force clear input again after browser processes spell check
      // This handles cases where browser spell check interferes with input clearing
      setTimeout(() => {
        setInputValue('');
        // Force clear DOM element directly to handle browser spell check interference
        const textarea = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement;
        if (textarea) {
          textarea.value = '';
        }
      }, 10);
      await processFileWithMessage(messageContent, onProcessedDataChange, projectId);
    } finally {
      isSendingRef.current = false;
    }
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

  const processFileUpload = async (file: File) => {
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

      const res: UploadResponse = await fileService.uploadFile(file, { projectId: projectId ?? undefined });
      if (!res.success || !res.fileID || res.asset?.status !== 'uploaded') {
        setUploadedFile({ ...newFile, status: 'error' });
        toast({
          title: "Upload failed",
          description: res.error || `Unexpected upload status: ${res.asset?.status ?? 'unknown'}`,
          variant: "destructive"
        });
        return;
      }

      // Delete previous file if different
      if (uploadedFile && uploadedFile.fileID && uploadedFile.fileID !== 'pending') {
        void fileService.deleteFile(uploadedFile.fileID);
      }

      const fallbackFilename = res.filename ?? file.name;
      const fallbackSize = res.size ?? file.size;
      const fallbackExt = res.ext || (file.name.split('.').pop() || '').toLowerCase();

      setUploadedFile({ 
        fileID: res.fileID, 
        filename: fallbackFilename, 
        size: fallbackSize, 
        ext: fallbackExt, 
        status: 'uploaded',
        projectId: res.asset?.project_id,
        rowCount: res.rowCount,
        columnCount: res.columnCount
      });
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
  };

  // Listen for document-level drag events to detect file dragging
  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      // Only track file drags
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        setIsDragging(false);
        setDragOver(false);
      }
    };

    const handleDragEnd = () => {
      dragCounter = 0;
      setIsDragging(false);
      setDragOver(false);
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('drop', handleDragEnd);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragend', handleDragEnd);
      document.removeEventListener('drop', handleDragEnd);
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFileUpload(file);
    }
  };

  const handleDataSourceSelect = (source: string) => {
    setSelectedDataSource(source);
    setDropdownOpen(false);
    console.log('Data source selected:', source);
  };

  const handleIntegrationClick = (connector: ConnectorItem) => {
    if (connector.isActive) {
      handleDataSourceSelect(connector.name);
    } else {
      toast({
        title: `${connector.name}`,
        description: "Integration is coming soon!",
      });
    }
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
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const isSystem = message.role === "system";
          const bubbleLayoutClass = isUser ? "flex-row-reverse" : "flex-row";
          const avatarClass = isUser
            ? "bg-black"
            : isSystem
              ? "bg-white/10 border border-white/20"
              : "bg-transparent";
          const bubbleBgClass = isUser
            ? "bg-black p-3"
            : isSystem
              ? "bg-white/5 p-3 border border-white/10"
              : "bg-transparent p-0";
          return (
            <div key={message.id} className="space-y-1">
              <div
                className={`chat-enter flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[90%] flex gap-2 ${bubbleLayoutClass}`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${avatarClass}`}>
                    {isUser ? (
                      <User className="w-3 h-3 text-white" />
                    ) : isSystem ? (
                      <span className="text-[9px] font-semibold tracking-wide uppercase text-white/70">
                        SYS
                      </span>
                    ) : (
                      <img src="/logo-watermark.png" alt="Morpheus" className="h-3 w-auto object-contain" />
                    )}
                  </div>
                  
                  <div className={`rounded-xl text-sm whitespace-pre-wrap break-words ${bubbleBgClass}`}>
                    {message.attachment && (
                      <div className="mb-2">
                        <span
                          className="inline-flex flex-col items-start gap-0.5 px-4 py-1 rounded-lg border border-white/20 bg-white/10 text-[11px] text-white/90 w-full"
                          title={message.attachment.name}
                          aria-label="Attached file"
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
                    {/* Render text content if present */}
                    {message.content && (
                      <div
                        className="leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere]"
                        dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }}
                      />
                    )}
                    {/* Render dashboard card if present */}
                    {message.role === 'assistant' && message.dashboardCard && (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="Open dashboard"
                        onClick={() => { onSwitchToDashboard && onSwitchToDashboard(message.dashboardCard?.dashboardId); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onSwitchToDashboard && onSwitchToDashboard(message.dashboardCard?.dashboardId); } }}
                        className={`group w-full rounded-xl border border-white/20 bg-white/5 p-3 hover:bg-white/10 transition-colors cursor-pointer select-none flex items-center justify-between ${message.content ? 'mt-2' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">
                            {message.dashboardCard.dashboardTitle || "Dashboard"}
                          </div>
                          <div className="text-xs text-white/70 mt-0.5 truncate">Source: {message.dashboardCard.sourceFileName}</div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/60 flex-shrink-0 ml-2 group-hover:translate-x-1 transition-transform duration-200" />
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground mt-1 block">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
              {/* Inline Rolling Text under the last user message that started analysis */}
              {message.role === 'user'
                && index === messages.length - 1
                && uploadedFile
                && (isProcessing || uploadedFile.status === 'processing') && (
                  <div className={`flex justify-start mt-1`}>
                    <div className={`ml-8`}>
                      <RollingText
                        isActive={isProcessing || uploadedFile.status === 'processing'}
                        stopSignal={uploadedFile.status === 'processed' || (!isProcessing && !isTyping)}
                        successText=""
                        currentStep={currentWorkflowStep}
                      />
                    </div>
                  </div>
              )}
            </div>
        )})}

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
            <div className="group relative bg-black/95 border border-white/5 rounded-xl p-3">
              {/* X button - top right, visible on hover */}
              <button
                onClick={() => removeUploadedFile(uploadedFile.fileID)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-white/10 rounded"
                aria-label="Remove file"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
              
              {/* File content */}
              <div className="flex items-center gap-3 pr-10">
                {/* File icon - left side */}
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                </div>
                
                {/* File info */}
                <div className="flex-1 min-w-0">
                  {/* Top line - Filename */}
                  <div className="text-white font-semibold text-sm truncate">
                    {uploadedFile.filename}
                  </div>
                  {/* Bottom line - Metadata */}
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {uploadedFile.rowCount?.toLocaleString() || 'N/A'} rows • {uploadedFile.columnCount || 'N/A'} cols • {formatFileSize(uploadedFile.size)}
                  </div>
                </div>
              </div>
              
              {/* Footer section - only when uploaded, processing, or processed */}
              {(uploadedFile.status === 'uploaded' || uploadedFile.status === 'processing' || uploadedFile.status === 'processed') && (
                <div className="border-t border-white/10 mt-2.5 pt-2.5 flex items-center justify-between">
                  {/* Left side - Status indicator */}
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-white" />
                    <span className="text-[10px] text-white">
                      {formatAssetStatus(uploadedFile.status)}
                    </span>
                  </div>
                  {/* Right side - Preview button */}
                  <Button
                    onClick={async () => {
                      try {
                        const { useAuth } = await import('@clerk/clerk-react');
                        const token = await useAuth().getToken();
                        const url = token
                          ? `/preview/${uploadedFile.fileID}?token=${encodeURIComponent(token)}`
                          : `/preview/${uploadedFile.fileID}`;
                        window.open(url, '_blank');
                      } catch {
                        window.open(`/preview/${uploadedFile.fileID}`, '_blank');
                      }
                    }}
                    className="button-gradient px-3 py-1 text-[10px] whitespace-nowrap h-auto"
                  >
                    Preview
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="m-2">
        {/* Main Chat Input with Hero Section Styling */}
        <div 
          className="w-full min-h-[60px] text-sm p-4 pb-2 bg-[#292929] rounded-xl resize-none transition-all duration-300 relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag Overlay */}
          {isDragging && (
            <div className={`absolute inset-0 rounded-xl border-2 border-dashed border-primary/60 flex flex-col items-center justify-center z-10 pointer-events-none ${dragOver ? 'bg-primary/10' : ''}`}>
              <FileText className="w-8 h-8 text-primary mb-2" />
              <span className="text-sm text-primary font-medium">Drop file here to upload</span>
            </div>
          )}
          {/* Textarea Row */}
          <div className="relative mb-3">
            <TextareaAutosize
              minRows={2}
              maxRows={6}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={isListening ? 'Listening...' : "Describe your dashboard..."}
              className="w-full bg-transparent border-none outline-none resize-none text-sm placeholder:text-muted-foreground/60"
              data-chat-input
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
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
          
          {/* Template Tag Row - commented out (not functionable)
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
          */}
          
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

              {/* Template Button - commented out (not functionable)
              <button
                onClick={handleCloneTemplateClick}
                className="p-2 flex items-center justify-center border border-white/30 rounded-md"
                aria-label="Choose template"
              >
                <LayoutTemplate className="w-4 h-4" />
              </button>
              */}

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
                          onClick={() => handleIntegrationClick(connector)}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-primary/10 transition-colors duration-200 cursor-pointer"
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
              {/* Voice button - commented out (not functionable)
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
              */}
              {(isProcessing || uploadedFile?.status === 'processing') ? (
                <Button
                  onClick={() => stopGeneration()}
                  className="button-gradient p-3"
                >
                  <Square className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => handleSend()}
                  disabled={!inputValue.trim() || isTyping}
                  className="button-gradient p-3 disabled:opacity-50"
                >
                  <CornerRightUp className="w-4 h-4" />
                </Button>
              )}
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
            await processFileUpload(file);
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