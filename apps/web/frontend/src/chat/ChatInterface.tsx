import { useRef, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CornerRightUp, Upload, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign, ChevronDown, ChevronUp, ChevronRight, Link, Mic, MicOff, FileText, LayoutTemplate, Square, X, CheckCircle, FileStack, AlertCircle } from "lucide-react";
import { CONNECTORS, type ConnectorItem } from "@/constants/connectors";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBarSidebar from '@/components/ui/recording-bar-sidebar';
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { fileService, type UploadResponse, type AssetRecord } from "@/services/fileService";
import { useToast } from "@/hooks/use-toast";
import { useChatStore, type UploadedFile } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import TemplateModal from "@/components/homepage-section/TemplateModal";
import FilePreviewChip from "../components/chat/FilePreviewChip";
import ProjectContextPicker from "../components/chat/ProjectContextPicker";

// Friendly AI persona step mapping for Fluid Morph loading
const STEP_FRIENDLY_MAP: Record<string, string> = {
  // Initialization
  'start': "Waking up...",
  'load_conversation': "Reading conversation context...",
  'download_asset': "Analyzing file structure...",

  // Intelligence
  'run_workflow': "Booting up data engine...",
  'routing': "Understanding your goal...",
  'reasoning': "Planning the best visualization...",

  // Action
  'execution': "Crunching the numbers...",
  'synthesis': "Designing your dashboard...",
  'validation': "Double-checking results...",

  // Completion/Edge cases
  'finish': "Finalizing...",
  'error': "I ran into a hiccup.",
};

const mapStepToDisplayText = (step: string): string => {
  return STEP_FRIENDLY_MAP[step] || "Processing...";
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

// Fluid Morph single-line loading indicator
interface RollingTextProps {
  isActive: boolean;
  stopSignal: boolean;
  successText?: string;
  currentStep?: string | null;
}

const RollingText = ({ isActive, stopSignal, currentStep = null }: RollingTextProps) => {
  const [currentText, setCurrentText] = useState<string>("");
  const prevStepRef = useRef<string | null>(null);

  // Update current text when step changes
  useEffect(() => {
    if (!isActive) return;

    if (currentStep && currentStep !== prevStepRef.current) {
      const displayText = mapStepToDisplayText(currentStep);
      setCurrentText(displayText);
      prevStepRef.current = currentStep;
    }
  }, [currentStep, isActive]);

  // Don't render if never started or no text
  if (!currentText) return null;

  return (
    <AnimatePresence>
      {!stopSignal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-2.5 ml-8 mt-2"
        >
          {/* Sparkles Icon */}
          <Sparkles className="w-4 h-4 text-blue-400 animate-pulse flex-shrink-0 leading-none" />

          {/* Animated Text */}
          <div className="relative flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.span
                key={currentText}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{
                  duration: 0.3,
                  ease: [0.4, 0.0, 0.2, 1]
                }}
                className="text-sm truncate bg-clip-text text-transparent bg-gradient-to-r from-gray-200 via-white to-gray-200 block max-w-full leading-normal"
              >
                {currentText}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Fetch project assets for @mention feature
const fetchProjectAssets = async (projectId: string): Promise<Array<{
  id: string;
  name: string;
  ext: string;
  projectId: string;
  asset: AssetRecord;
}>> => {
  try {
    const response = await fileService.listFiles();
    if (response.success && response.files) {
      // Filter by projectId
      return response.files
        .filter(file => file.asset?.project_id === projectId)
        .map(file => ({
          id: file.fileID,
          name: file.filename,
          ext: file.ext.toUpperCase(),
          projectId: file.asset?.project_id || projectId,
          asset: file.asset!,
        }));
    }
    return [];
  } catch (error) {
    console.error('Failed to fetch project assets:', error);
    return [];
  }
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

  // @Mention state
  // @Mention / Context Picker state
  const [isContextPickerOpen, setIsContextPickerOpen] = useState(false);
  const [pickerTriggerMode, setPickerTriggerMode] = useState<'mention' | 'button'>('mention');
  const [mentionQuery, setMentionQuery] = useState('');
  const [projectAssets, setProjectAssets] = useState<Array<{
    id: string;
    name: string;
    ext: string;
    projectId: string;
    asset: AssetRecord;
  }>>([]);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  // Track @mentioned asset IDs for selective processing
  const [mentionedAssetIds, setMentionedAssetIds] = useState<string[]>([]);

  // Zustand stores
  const {
    inputValue,
    isTyping,
    isProcessing,
    messages,
    uploadedFiles,
    addFiles,
    removeFile,
    clearFiles,
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

  // Eagerly fetch project assets so the "all assets" badge can display the file count
  useEffect(() => {
    if (projectId) {
      fetchProjectAssets(projectId).then(setProjectAssets);
    }
  }, [projectId]);

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

      // Close context picker if clicked outside
      if (isContextPickerOpen && !target.closest('.project-context-picker-container') && !target.closest('.project-context-trigger')) {
        setIsContextPickerOpen(false);
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

      // Compute active files (exclude restored/processed files) for mentions and attachment
      const activeFiles = uploadedFiles.filter(f => f.status !== 'processed');

      let finalMentionedIds = [...mentionedAssetIds];
      activeFiles.forEach(file => {
        if (file.fileID && !finalMentionedIds.includes(file.fileID)) {
          finalMentionedIds.push(file.fileID);
        }
      });

      // Compute attachment badge info from active files only
      let activeFileAttachment: { kind: 'csv' | 'file'; name: string } | undefined;
      if (activeFiles.length > 0) {
        activeFileAttachment = { kind: 'csv', name: activeFiles.length === 1 ? activeFiles[0].filename : `${activeFiles.length} files` };
      } else if (projectAssets.length > 0 && finalMentionedIds.length === 0) {
        // No explicit files selected — treat as "all assets" and show badge with count
        activeFileAttachment = { kind: 'csv', name: projectAssets.length === 1 ? projectAssets[0].name : `${projectAssets.length} files` };
      }

      await processFileWithMessage(messageContent, onProcessedDataChange, projectId, finalMentionedIds, activeFileAttachment);
      clearFiles();
      setMentionedAssetIds([]);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleRetry = async () => {
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    try {
      const activeFiles = uploadedFiles.filter(f => f.status !== 'processed');
      let finalMentionedIds = [...mentionedAssetIds];
      activeFiles.forEach(file => {
        if (file.fileID && !finalMentionedIds.includes(file.fileID)) {
          finalMentionedIds.push(file.fileID);
        }
      });
      let activeFileAttachment: { kind: 'csv' | 'file'; name: string } | undefined;
      if (activeFiles.length > 0) {
        activeFileAttachment = { kind: 'csv', name: activeFiles.length === 1 ? activeFiles[0].filename : `${activeFiles.length} files` };
      } else if (projectAssets.length > 0 && finalMentionedIds.length === 0) {
        activeFileAttachment = { kind: 'csv', name: projectAssets.length === 1 ? projectAssets[0].name : `${projectAssets.length} files` };
      }

      await processFileWithMessage("Continue", onProcessedDataChange, projectId, finalMentionedIds, activeFileAttachment);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleAssetSelect = async (selectedAsset: {
    id: string;
    name: string;
    ext: string;
    projectId: string;
    asset: AssetRecord;
  }) => {
    try {
      // We already have full asset data from fetchProjectAssets
      // No need to fetch again - use existing data
      const assetData = selectedAsset.asset;

      // Convert to UploadedFile format
      // Status is 'uploaded' because file exists in project and is ready for processing
      // isFromMention: true indicates this file was selected from @mention dropdown (already exists in conversation)
      const newFile = {
        fileID: assetData.asset_id,
        filename: assetData.filename,
        size: assetData.size_bytes,
        ext: assetData.extension.toLowerCase(),
        status: 'uploaded' as const,
        projectId: assetData.project_id,
        rowCount: assetData.row_count,
        columnCount: assetData.column_count,
        isFromMention: true,
      };

      if (uploadedFiles.length >= 5) {
        toast({
          title: "Maximum files reached",
          description: "You can only add up to 5 files at a time.",
          variant: "destructive"
        });
        setIsContextPickerOpen(false);
        return;
      }
      if (uploadedFiles.some(f => f.fileID === assetData.asset_id)) {
        toast({
          title: "File already added",
          description: `${selectedAsset.name} is already in your file list.`,
        });
        setIsContextPickerOpen(false);
        return;
      }

      addFiles([newFile]);

      // Track this asset as @mentioned for selective processing
      setMentionedAssetIds(prev =>
        prev.includes(assetData.asset_id) ? prev : [...prev, assetData.asset_id]
      );

      // Remove @mention text from input ONLY if we are in mention mode
      if (pickerTriggerMode === 'mention') {
        const textBeforeCursor = inputValue.slice(0, mentionCursorPos);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        if (lastAtIndex !== -1) {
          const textAfterMention = inputValue.slice(mentionCursorPos);
          const newText = inputValue.slice(0, lastAtIndex) + textAfterMention;
          setInputValue(newText);
        }
      }

      // Hide dropdown
      setIsContextPickerOpen(false);
      setMentionQuery('');

      toast({
        title: "File added to context",
        description: `${selectedAsset.name} is now available for analysis`,
      });
    } catch (error) {
      console.error('Failed to add asset:', error);
      toast({
        title: "Failed to add file",
        description: "Could not load the selected file",
        variant: "destructive",
      });
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

      if (uploadedFiles.length >= 5) {
        toast({
          title: "Maximum files reached",
          description: "You can only upload up to 5 files at a time.",
          variant: "destructive"
        });
        return;
      }
      addFiles([newFile]);

      const res: UploadResponse = await fileService.uploadFile(file, { projectId: projectId ?? undefined });
      if (!res.success || !res.fileID || res.asset?.status !== 'uploaded') {
        removeFile('pending');
        addFiles([{ ...newFile, status: 'error' }]);
        toast({
          title: "Upload failed",
          description: res.error || `Unexpected upload status: ${res.asset?.status ?? 'unknown'}`,
          variant: "destructive"
        });
        return;
      }

      const fallbackFilename = res.filename ?? file.name;
      const fallbackSize = res.size ?? file.size;
      const fallbackExt = res.ext || (file.name.split('.').pop() || '').toLowerCase();

      removeFile('pending');
      addFiles([{
        fileID: res.fileID,
        filename: fallbackFilename,
        size: fallbackSize,
        ext: fallbackExt,
        status: 'uploaded',
        projectId: res.asset?.project_id,
        rowCount: res.rowCount,
        columnCount: res.columnCount
      }]);
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
      } catch (_err) { }
      toast({ title: "File uploaded", description: `${res.filename} uploaded successfully. You can now ask questions about your data.` });
    } catch (_e) {
      removeFile('pending');
      addFiles([{
        fileID: 'error',
        filename: file.name,
        size: file.size,
        ext: (file.name.split('.').pop() || '').toLowerCase(),
        status: 'error'
      }]);
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
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    if (uploadedFiles.length + files.length > 5) {
      toast({
        title: "Too many files",
        description: `Maximum 5 files allowed. You can add ${5 - uploadedFiles.length} more file(s).`,
        variant: "destructive"
      });
      return;
    }
    for (const file of files) {
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
    const file = uploadedFiles.find(f => f.fileID === fileID);
    if (file && !file.isFromMention) {
      try {
        await fileService.deleteFile(fileID);
      } catch (_e) {
        // best-effort; ignore
      }
    }
    removeFile(fileID);
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
    { text: "Visualize key trends over time in an interactive dashboard.", icon: Database },
    { text: "Spot anomalies and outliers directly in your dashboard.", icon: TrendingUp },
    { text: "Generate a dashboard of my most important metrics.", icon: BarChart3 },
    { text: "Build a comprehensive dashboard from all my connected data.", icon: Users },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-muted">

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-4">
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
                <div className={`max-w-[90%] min-w-0 flex gap-2 ${bubbleLayoutClass}`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${avatarClass}`}>
                    {isUser ? (
                      <User className="w-3 h-3 text-white" />
                    ) : isSystem ? (
                      <span className="text-[9px] font-semibold tracking-wide uppercase text-white/70">
                        SYS
                      </span>
                    ) : (
                      <img src="/logo-watermark.png" alt="Dreamify" className="h-3 w-auto object-contain" />
                    )}
                  </div>

                  <div className={`min-w-0 max-w-full rounded-xl text-sm whitespace-pre-wrap break-words ${bubbleBgClass}`}>
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
                    {message.content && !message.isError && (
                      <div
                        className="leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere]"
                        dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }}
                      />
                    )}
                    {message.isError && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-red-500">
                          <AlertCircle className="w-4 h-4" />
                          <span
                            title="llm are not perfect"
                            className="text-sm cursor-help focus:outline-none"
                          >
                            {message.content}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRetry}
                          className="self-start h-7 px-3 text-xs bg-transparent border-red-500/30 text-red-500 hover:bg-red-500/10"
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                    {/* Render dashboard card if present */}
                    {message.role === 'assistant' && message.dashboardCard && (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="Open dashboard"
                        onClick={() => { onSwitchToDashboard && onSwitchToDashboard(message.dashboardCard?.dashboardId); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onSwitchToDashboard && onSwitchToDashboard(message.dashboardCard?.dashboardId); } }}
                        className={`group w-full max-w-full rounded-xl border border-white/20 bg-white/5 p-3 hover:bg-white/10 transition-colors cursor-pointer select-none flex items-center justify-between ${message.content ? 'mt-2' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate" title={message.dashboardCard.dashboardTitle || "Dashboard"}>
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
                && isProcessing && (
                  <div className="flex justify-start">
                    <RollingText
                      isActive={isProcessing}
                      stopSignal={!isProcessing && !isTyping}
                      successText=""
                      currentStep={currentWorkflowStep}
                    />
                  </div>
                )}
            </div>
          )
        })}

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

      {/* Bottom Area: Input */}
      <div className="mt-auto">
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

            {/* Context Picker */}
            {isContextPickerOpen && (
              <ProjectContextPicker
                files={
                  pickerTriggerMode === 'mention'
                    ? projectAssets.filter(asset => asset.name.toLowerCase().includes(mentionQuery.toLowerCase()))
                    : projectAssets
                }
                onSelect={handleAssetSelect}
                onPreview={(fileId) => window.open(`/preview/${fileId}`, '_blank')}
                className={`project-context-picker-container ${pickerTriggerMode === 'button' ? 'bottom-full left-0 mb-2' : ''}`}
              />
            )}

            {/* File Context Chips - horizontal scroll when files are attached */}
            {/* Filter out 'processed' files — they're restored from previous conversations and shouldn't show as input chips */}
            {uploadedFiles.filter(f => f.status !== 'processed').length > 0 && (
              <div className="mb-3 flex flex-row gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {uploadedFiles.filter(f => f.status !== 'processed').map((file) => (
                  <div key={file.fileID} className="flex-shrink-0">
                    <FilePreviewChip
                      file={file}
                      onRemove={() => removeUploadedFile(file.fileID)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Textarea Row */}
            <div className="relative mb-3">
              <TextareaAutosize
                minRows={2}
                maxRows={6}
                value={inputValue}
                onChange={(e) => {
                  const value = e.target.value;
                  setInputValue(value);

                  // Detect @ mention
                  const cursorPos = e.target.selectionStart || 0;
                  const textBeforeCursor = value.slice(0, cursorPos);
                  const lastAtIndex = textBeforeCursor.lastIndexOf('@');

                  if (lastAtIndex !== -1 && lastAtIndex === cursorPos - 1) {
                    // User just typed @
                    setIsContextPickerOpen(true);
                    setPickerTriggerMode('mention');
                    setMentionQuery('');
                    setMentionCursorPos(cursorPos);

                    // Fetch assets if not already loaded
                    if (projectId && projectAssets.length === 0) {
                      fetchProjectAssets(projectId).then(setProjectAssets);
                    }
                  } else if (lastAtIndex !== -1 && cursorPos > lastAtIndex) {
                    // User is typing after @
                    const query = textBeforeCursor.slice(lastAtIndex + 1);
                    if (!/\s/.test(query)) {
                      // No space means still in mention mode
                      setMentionQuery(query);
                      setIsContextPickerOpen(true);
                      setPickerTriggerMode('mention');
                    } else {
                      setIsContextPickerOpen(false);
                    }
                  } else {
                    // Only close if we are in mention mode (don't close button mode on typing)
                    if (pickerTriggerMode === 'mention') {
                      setIsContextPickerOpen(false);
                    }
                  }
                }}
                placeholder={isListening ? 'Listening...' : "Use @ to select the data file to analyze"}
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
                  className="p-2 flex items-center justify-center border border-white/30 rounded-md text-gray-400 hover:text-white transition-colors"
                  title="Upload file"
                >
                  <Upload className="w-4 h-4" />
                </button>

                {/* Project Context Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Toggle picker
                    if (isContextPickerOpen && pickerTriggerMode === 'button') {
                      setIsContextPickerOpen(false);
                    } else {
                      setIsContextPickerOpen(true);
                      setPickerTriggerMode('button');
                      // Ensure assets are loaded
                      if (projectId && projectAssets.length === 0) {
                        fetchProjectAssets(projectId).then(setProjectAssets);
                      }
                    }
                  }}
                  className={`project-context-trigger p-2 flex items-center justify-center border border-white/30 rounded-md text-gray-400 hover:text-white transition-colors ${isContextPickerOpen && pickerTriggerMode === 'button' ? 'bg-white/10 text-white' : ''
                    }`}
                  title="Project Context"
                >
                  <FileStack className="w-4 h-4" />
                </button>

                {/* Template Button */}
                <button
                  onClick={handleCloneTemplateClick}
                  className="p-2 flex items-center justify-center border border-white/30 rounded-md text-gray-400 hover:text-white transition-colors"
                  title="Choose template"
                  aria-label="Choose template"
                >
                  <LayoutTemplate className="w-4 h-4" />
                </button>

                {/* Data Connector Dropup */}
                <div className="relative data-source-dropdown">
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className={`p-2 flex items-center justify-center gap-1 rounded-md transition-all duration-200 ${selectedDataSource
                      ? `${getDataSourceColors(selectedDataSource).bg} ${getDataSourceColors(selectedDataSource).border} ${getDataSourceColors(selectedDataSource).text} ${getDataSourceColors(selectedDataSource).hover} border`
                      : 'border border-white/30 text-gray-400 hover:text-white'
                      }`}
                    aria-expanded={dropdownOpen}
                    aria-haspopup="true"
                    aria-label="Connect data source"
                  >
                    <Link className="w-4 h-4" />
                    <ChevronUp className={`w-3 h-3 transition-transform duration-200 ${selectedDataSource ? 'text-white' : 'text-white/60'
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
                {(isProcessing || uploadedFiles.some(f => f.status === 'processing')) ? (
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
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            if (uploadedFiles.length + files.length > 5) {
              toast({
                title: "Too many files",
                description: "Maximum 5 files allowed. Please remove some files first.",
                variant: "destructive"
              });
              e.target.value = '';
              return;
            }
            for (const file of files) {
              await processFileUpload(file);
            }
            e.target.value = '';
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