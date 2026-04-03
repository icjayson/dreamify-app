import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CornerRightUp, Upload, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign, ChevronDown, ChevronUp, ChevronRight, Link, Mic, MicOff, FileText, LayoutTemplate, Square, X, Check, CheckCircle, FileStack, AlertCircle, ChevronsUpDown, ChevronsDownUp, Copy, PieChart, AreaChart, Hash, Table2, Pencil, CircleDashed, Circle, ListTodo, Zap } from "lucide-react";
import { CONNECTORS, type ConnectorItem } from "@/constants/connectors";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBarSidebar from '@/components/ui/recording-bar-sidebar';
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { fileService, type UploadResponse, type AssetRecord } from "@/services/fileService";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { useChatStore, type UploadedFile } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import TemplateModal from "@/components/homepage-section/TemplateModal";
import FilePreviewChip from "../components/chat/FilePreviewChip";
import ChartPreviewChip from "../components/chat/ChartPreviewChip";
import type { ChartChipData } from "../components/chat/ChartPreviewChip";
import ProjectContextPicker from "../components/chat/ProjectContextPicker";
import CreditIcon from "./CreditIcon";
import ModelSelector from "./ModelSelector";
import { CreditExhaustedCard } from "./CreditExhaustedCard";
import type { DashboardComponent } from "@/types/dashboard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getFilesFromClipboardData } from "@/lib/clipboardFiles";


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

// Deep Thinking Tasks component — supports both live (during processing) and static (from saved data) modes
interface DeepThinkingTasksProps {
  prompt?: string;
  isActive: boolean;
  currentStep?: string | null;
  savedTasks?: Array<{ id: string; text: string }>;
  inline?: boolean;
}

const DeepThinkingTasks = ({ prompt, isActive, currentStep, savedTasks, inline }: DeepThinkingTasksProps) => {
  const [isExpanded, setIsExpanded] = useState(!savedTasks);

  // Parse tasks from /run prompt (live mode only)
  const promptTasks = useMemo(() => {
    if (savedTasks) return [];
    if (!prompt) return [];
    let textToParse = prompt.trim();
    if (!textToParse.startsWith('/run')) return [];

    textToParse = textToParse.substring(4).trim();
    const lines = textToParse.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    return lines.map(line => line.replace(/^([-\*o]|\d+\.)\s*/, '').trim());
  }, [prompt, savedTasks]);

  const [workflowTasks, setWorkflowTasks] = useState<{ id: string, text: string }[]>([]);
  const prevStepRef = useRef<string | null>(null);

  useEffect(() => {
    if (savedTasks) return;
    if (!isActive) {
      if (workflowTasks.length > 0) {
        setIsExpanded(false);
      }
      return;
    }

    setIsExpanded(true);

    if (workflowTasks.length === 0) {
      setWorkflowTasks([{ id: 'start', text: mapStepToDisplayText('start') }]);
    }

    if (currentStep && currentStep !== prevStepRef.current) {
      const displayText = mapStepToDisplayText(currentStep);
      setWorkflowTasks(prev => {
        if (prev.find(t => t.text === displayText) || currentStep === 'start') return prev;
        return [...prev, { id: currentStep, text: displayText }];
      });
      prevStepRef.current = currentStep;
    }
  }, [currentStep, isActive, workflowTasks.length, savedTasks]);

  const displayTasks = savedTasks
    ? savedTasks
    : promptTasks.length > 0
      ? promptTasks.map((t, i) => ({ id: `prompt-${i}`, text: t }))
      : workflowTasks;
  const isUsingWorkflow = !savedTasks && promptTasks.length === 0;

  if (displayTasks.length === 0) {
    return null;
  }

  const isLiveMode = !inline;

  const wrapperClass = inline
    ? "w-full mt-3 bg-[#1E1E1E] border border-white/10 rounded-xl overflow-hidden shadow-sm"
    : "w-full max-w-[85%] mt-3 ml-[38px] bg-[#1E1E1E] border border-white/10 rounded-xl overflow-hidden shadow-sm";

  const headerClass = isLiveMode
    ? "grid grid-cols-[1fr_auto] items-center px-4 py-2 bg-[#18181B] border-b border-white/5 cursor-pointer hover:bg-white/[0.02] transition-colors"
    : "flex items-center justify-between px-4 py-2 bg-[#18181B] border-b border-white/5 cursor-pointer hover:bg-white/[0.02] transition-colors";

  return (
    <div className={wrapperClass}>
      {/* Header */}
      <div
        className={headerClass}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 text-[10px] sm:text-xs tracking-wider text-white/50">
          <ListTodo className="w-5 h-5" />
          <span>Thinking Process <span className="text-white/20 mx-1">|</span> {isActive ? 'Executing' : 'Executed'}</span>
        </div>
        <div className={`flex items-center gap-2 ${isLiveMode ? 'flex-shrink-0' : ''}`}>
          <div className={`text-[10px] sm:text-xs text-white/40 ${isLiveMode ? 'whitespace-nowrap text-right' : ''}`}>
            Total: {displayTasks.length} {displayTasks.length === 1 ? 'Task' : 'Tasks'}
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-white/30 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Body */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3.5 border-t border-white/5">
              <div className="text-xs font-medium text-white/80 mb-3.5">
                {isUsingWorkflow ? "Processing Steps" : `${displayTasks.length} Tasks Remaining`}
              </div>

              <div className="flex flex-col gap-3">
                {displayTasks.map((task, idx) => {
                  const isTaskActive = isUsingWorkflow ? (isActive && idx === displayTasks.length - 1) : (isActive && idx === 0);
                  const isCompleted = savedTasks ? true : isUsingWorkflow ? (idx < displayTasks.length - 1 || !isActive) : !isActive;

                  return (
                    <div key={task.id} className={`flex items-start gap-3 text-sm ${isTaskActive ? 'text-white' : 'text-white/50'}`}>
                      <div className="mt-[2px] flex-shrink-0">
                        {isCompleted ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : isTaskActive ? (
                          <CircleDashed className="w-4 h-4 text-white/80 animate-[spin_3s_linear_infinite]" />
                        ) : (
                          <Circle className="w-4 h-4 text-white/20" />
                        )}
                      </div>
                      <span className="leading-snug break-words flex-1">{task.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
  sourceType?: string;
  asset: AssetRecord;
}>> => {
  try {
    const response = await fileService.listFiles();
    if (response.success && response.files) {
      // Filter by projectId
      return response.files
        .filter(file => file.asset?.project_id === projectId)
        .map(file => {
          let derivedSourceType: string | undefined;
          if (file.asset?.asset_type.toLowerCase().includes('integration_ga4') || file.asset?.asset_type.toLowerCase().includes('ga4')) {
            derivedSourceType = 'GA4';
          } else if (file.asset?.asset_type.toLowerCase().includes('integration_gsheets') || file.asset?.asset_type.toLowerCase().includes('google sheets')) {
            derivedSourceType = 'Google Sheets';
          }

          return {
            id: file.fileID,
            name: file.filename,
            ext: file.ext.toUpperCase(),
            projectId: file.asset?.project_id || projectId,
            sourceType: derivedSourceType,
            asset: file.asset!,
          };
        });
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
  dashboardComponents?: DashboardComponent[];
}

const ChatInterface = ({ projectId, onProcessedDataChange, onSwitchToDashboard, dashboardComponents }: ChatInterfaceProps) => {

  // Model selector state
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const { creditsRemaining, creditUsage, subscription, refreshSubscription, upgradeToPro } = useSubscription();
  const tierLimit = 1000; // All users have Pro access (1000 credits/month)

  // Template state
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());

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
  // Track @mentioned charts for chart editing
  const [mentionedCharts, setMentionedCharts] = useState<ChartChipData[]>([]);

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
    stopGeneration,
    setGoogleSheetsModalOpen,
    setGA4ModalOpen,
    isDashboardOpen,
    selectedModel,
    setSelectedModel,
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

  const stagedFiles = uploadedFiles.filter(f => f.status !== 'processed' && f.status !== 'error');
  const isSendingRef = useRef<boolean>(false);
  const { toast } = useToast();

  // Derive available charts from active dashboard components
  const availableCharts = useMemo(() => {
    if (!dashboardComponents) return [];
    return dashboardComponents
      .filter(c => c.type === 'chart' || c.type === 'metric' || c.type === 'table')
      .map(c => ({
        id: (c.component_config as any).id || c.id,
        componentId: c.id,
        title: (c.component_config as any).title || 'Untitled',
        type: (c.component_config as any).type || c.type,
      }));
  }, [dashboardComponents]);

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

  const addChartToContext = useCallback((chart: ChartChipData): boolean => {
    const normalized: ChartChipData = {
      ...chart,
      id: String(chart.id),
      componentId: String(chart.componentId),
    };
    let added = false;
    setMentionedCharts((prev) => {
      if (prev.some((c) => String(c.componentId) === normalized.componentId)) {
        return prev;
      }
      added = true;
      return [...prev, normalized];
    });
    if (!added) {
      toast({
        title: "Chart already referenced",
        description: `${chart.title} is already in context.`,
      });
    } else {
      toast({
        title: "Chart referenced",
        description: `${chart.title} added to context`,
      });
    }
    setIsContextPickerOpen(false);
    setMentionQuery("");
    return added;
  }, [toast]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const chart = (ev as CustomEvent<ChartChipData>).detail;
      if (!chart?.componentId) return;
      addChartToContext(chart);
      requestAnimationFrame(() => {
        document.querySelector("[data-chat-root]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        (document.querySelector("textarea[data-chat-input]") as HTMLTextAreaElement | null)?.focus();
      });
    };
    window.addEventListener("dreamify:select-chart-context", handler as EventListener);
    return () => window.removeEventListener("dreamify:select-chart-context", handler as EventListener);
  }, [addChartToContext]);

  // Eagerly fetch project assets so the "all assets" badge can display the file count
  useEffect(() => {
    if (projectId) {
      fetchProjectAssets(projectId).then(setProjectAssets);
    }
  }, [projectId]);

  // Auto-refresh project assets when uploadedFiles changes (e.g. after GA4/Sheets sync)
  useEffect(() => {
    if (projectId && stagedFiles.length > 0) {
      fetchProjectAssets(projectId).then(setProjectAssets);
    }
  }, [stagedFiles.length, projectId]);

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

      // Close model dropdown if clicked outside
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(target)) {
        setModelDropdownOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

  const handleSend = async (csvSummaryOverride?: string) => {
    if (!inputValue.trim()) return;
    if (isSendingRef.current) return;
    if (uploadedFiles.some(f => f.status === 'uploading')) {
      toast({ title: "Upload in progress", description: "Please wait for the file to finish uploading.", variant: "destructive" });
      return;
    }
    const hasValidUploadedFiles = uploadedFiles.some(f => ['uploaded', 'processed', 'accepted'].includes(f.status));
    if (projectAssets.length === 0 && !hasValidUploadedFiles) {
      toast({ title: "Upload required", description: "Upload at least one file before asking a question.", variant: "destructive" });
      return;
    }
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

      // Build chart mentions with full config for backend context
      const chartsWithConfig = mentionedCharts.map(chart => ({
        ...chart,
        config: dashboardComponents?.find(c => String(c.id) === String(chart.componentId))?.component_config,
      }));
      const hasChartMentions = chartsWithConfig.length > 0;

      // Compute attachment badge info from active files only
      // When only charts are mentioned (no files), skip the fallback "all assets" attachment
      let activeFileAttachment: any = undefined;
      if (activeFiles.length > 0) {
        let displayName = activeFiles[0].filename;
        if (activeFiles.length > 1) {
          displayName = `${activeFiles.length} files`;
        }
        activeFileAttachment = {
          kind: 'csv',
          name: displayName,
          sourceType: activeFiles.length === 1 ? activeFiles[0].sourceType : (activeFiles.length > 1 ? 'Multiple' : undefined),
          accountName: activeFiles.length === 1 ? activeFiles[0].accountName : undefined,
          propertyName: activeFiles.length === 1 ? activeFiles[0].propertyName : undefined
        };
      } else if (projectAssets.length > 0 && finalMentionedIds.length === 0 && !hasChartMentions) {
        // No explicit files selected and no chart mentions — treat as "all assets" and show badge with count
        activeFileAttachment = { kind: 'csv', name: projectAssets.length === 1 ? projectAssets[0].name : `${projectAssets.length} files` };
      }

      try {
        await processFileWithMessage(messageContent, onProcessedDataChange, projectId, finalMentionedIds, activeFileAttachment, hasChartMentions ? chartsWithConfig : undefined, selectedModel, refreshSubscription);
      } catch (err: unknown) {
        const errObj = err as Record<string, unknown>;
        const detail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        const isInsufficientCredits =
          errObj?.status === 402 ||
          (detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
          (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
        if (isInsufficientCredits) {
          refreshSubscription();
          toast({
            title: "Out of credits",
            description: "You've used all your monthly credits. They reset next month.",
            variant: "destructive",
          });
          return;
        }
        throw err;
      }
      setMentionedAssetIds([]);
      setMentionedCharts([]);
      refreshSubscription();
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleRetry = async () => {
    if (isSendingRef.current) return;
    if (creditUsage?.can_use_credits === false) return;
    isSendingRef.current = true;
    try {
      const activeFiles = uploadedFiles.filter(f => f.status !== 'processed');
      let finalMentionedIds = [...mentionedAssetIds];
      activeFiles.forEach(file => {
        if (file.fileID && !finalMentionedIds.includes(file.fileID)) {
          finalMentionedIds.push(file.fileID);
        }
      });
      let activeFileAttachment: any = undefined;
      if (activeFiles.length > 0) {
        let displayName = activeFiles[0].filename;
        if (activeFiles.length === 1 && activeFiles[0].sourceType) {
          displayName = `${activeFiles[0].sourceType} Data`;
        } else if (activeFiles.length > 1) {
          displayName = `${activeFiles.length} files`;
        }
        activeFileAttachment = {
          kind: 'csv',
          name: displayName,
          sourceType: activeFiles.length === 1 ? activeFiles[0].sourceType : (activeFiles.length > 1 ? 'Multiple' : undefined),
          accountName: activeFiles.length === 1 ? activeFiles[0].accountName : undefined,
          propertyName: activeFiles.length === 1 ? activeFiles[0].propertyName : undefined
        };
      } else if (projectAssets.length > 0 && finalMentionedIds.length === 0) {
        activeFileAttachment = { kind: 'csv', name: projectAssets.length === 1 ? projectAssets[0].name : `${projectAssets.length} files` };
      }

      await processFileWithMessage("Continue", onProcessedDataChange, projectId, finalMentionedIds, activeFileAttachment, undefined, undefined, refreshSubscription);
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
      // Derive sourceType from asset_type or filename pattern
      let sourceType: string | undefined;
      const assetType = assetData?.asset_type || '';
      if (assetType === 'integration_ga4' || assetType === 'GA4') sourceType = 'GA4';
      else if (assetType === 'integration_gsheets' || assetType === 'Google Sheets') sourceType = 'Google Sheets';

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
        sourceType,
        // Since it's from project assets, we might not have account/property name in metadata,
        // but sourceType alone will fix "CSV" label showing as "GA4 Data".
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

  const handleChartSelect = (chart: ChartChipData) => {
    const added = addChartToContext(chart);
    if (added && pickerTriggerMode === "mention") {
      const textBeforeCursor = inputValue.slice(0, mentionCursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");
      if (lastAtIndex !== -1) {
        const textAfterMention = inputValue.slice(mentionCursorPos);
        const newText = inputValue.slice(0, lastAtIndex) + textAfterMention;
        setInputValue(newText);
      }
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

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = getFilesFromClipboardData(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
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

  const processFileUpload = async (file: File) => {
    const validationError = validateClientFile(file);
    if (validationError) {
      toast({ title: "Upload error", description: validationError, variant: "destructive" });
      return;
    }
    try {
      // Create new file object for upload
      // Detect sourceType based on filename pattern
      let sourceType: string | undefined;
      if (file.name.startsWith('google_analytics')) sourceType = 'GA4';
      else if (file.name.startsWith('google_sheet')) sourceType = 'Google Sheets';

      const newFile = {
        fileID: 'pending',
        filename: file.name,
        size: file.size,
        ext: (file.name.split('.').pop() || '').toLowerCase(),
        status: 'uploading' as const,
        sourceType
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
        columnCount: res.columnCount,
        sourceType
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
    if (connector.name === 'GA4') {
      setDropdownOpen(false);
      setTimeout(() => setGA4ModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Google Sheets') {
      setDropdownOpen(false);
      setTimeout(() => setGoogleSheetsModalOpen(true), 0);
      return;
    }
    if (connector.isActive) {
      handleDataSourceSelect(connector.name);
    } else {
      toast({
        title: `${connector.name}`,
        description: "Integration is coming soon!",
      });
    }
    setDropdownOpen(false);
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
        fetchProjectAssets(projectId).then(setProjectAssets);
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
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-4 chat-scrollbar-hide">
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

                  <div className={`min-w-0 max-w-full rounded-xl text-sm whitespace-pre-wrap break-words overflow-hidden ${bubbleBgClass}`}>
                    {/* Attachment badge (file) — hide full badge when chart mentions are present (compact version shown below instead) */}
                    {message.attachment && !message.chartMentions?.length && (
                      <div className="mb-2">
                        {(() => {
                          const sType = message.attachment.sourceType || '';
                          const isMultiple = sType === 'Multiple';
                          const isGA4 = !isMultiple && (sType.includes('GA4') || sType.includes('Google Analytics') || sType.includes('integration_ga4') || sType.toLowerCase().includes('google_analytics'));
                          const isSheets = !isMultiple && (sType.includes('Google Sheets') || sType.includes('gsheets') || sType.includes('integration_gsheets') || sType.toLowerCase().includes('google_sheet'));

                          const displayName = isMultiple ? "Multiple Data Sources" : isGA4 ? "Google Analytics 4" : isSheets ? "Google Sheets" : "Attached Data";
                          const logoBg = isMultiple ? "bg-indigo-500/10" : isGA4 ? "bg-orange-500/10" : isSheets ? "bg-green-500/10" : "bg-white/10";

                          const connector = isMultiple ? undefined : CONNECTORS.find(c => {
                            if (isGA4 && c.name === 'GA4') return true;
                            if (isSheets && c.name === 'Google Sheets') return true;
                            return false;
                          });
                          const icon = connector?.icon;

                          let secondaryText = "";
                          if (isMultiple) {
                            secondaryText = message.attachment.name;
                          } else {
                            secondaryText = (message.attachment.name).replace(/\.[^/.]+$/, "");
                          }
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    const matchedAsset = projectAssets.find(a => a.name === message.attachment?.name);
                                    if (matchedAsset) {
                                      window.open(`/preview/${matchedAsset.id}`, '_blank');
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      const matchedAsset = projectAssets.find(a => a.name === message.attachment?.name);
                                      if (matchedAsset) {
                                        window.open(`/preview/${matchedAsset.id}`, '_blank');
                                      }
                                    }
                                  }}
                                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white/90 backdrop-blur-md transition-all hover:bg-white/10 max-w-full outline-none"
                                >
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md p-2 ${logoBg}`}>
                                    {icon ? (
                                      <img src={icon} className="h-full w-full object-contain" alt="" />
                                    ) : (
                                      <Database className="h-5 w-5 text-emerald-400" />
                                    )}
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className="truncate text-sm font-medium text-white">
                                      {displayName}
                                    </span>
                                    {secondaryText && (
                                      <span className="mt-0.5 truncate text-xs text-gray-400">
                                        {secondaryText}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                sideOffset={8}
                                className="z-[300] max-w-[min(90vw,260px)] !bg-black/90 !text-white text-xs shadow-lg break-words"
                              >
                                {message.attachment.name}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    )}
                    {/* Chart mention badges — shown when user referenced charts via @chart */}
                    {message.chartMentions && message.chartMentions.length > 0 && (
                      <div className="mb-2 flex flex-col gap-1.5">
                        {/* Chart mention badges */}
                        {message.chartMentions.map((chart, idx) => {
                          const chartTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
                            bar: BarChart3, line: TrendingUp, pie: PieChart, donut: PieChart,
                            area: AreaChart, metric: Hash, table: Table2, composed: BarChart3,
                          };
                          const ChartIcon = chartTypeIcons[chart.type] || BarChart3;
                          const typeLabel = chart.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          // Determine if this edit is completed by checking if an assistant message follows
                          const msgIndex = messages.findIndex(m => m.id === message.id);
                          const nextMsg = msgIndex >= 0 ? messages[msgIndex + 1] : undefined;
                          const isEditDone = nextMsg?.role === 'assistant';
                          return (
                            <Tooltip key={`${chart.componentId}-${idx}`}>
                              <TooltipTrigger asChild>
                                <div
                                  className={`flex max-w-full cursor-default items-center gap-3 rounded-lg border px-3 py-2.5 text-white/90 backdrop-blur-md outline-none transition-all ${isEditDone ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-purple-500/20 bg-purple-500/[0.06]'}`}
                                >
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${isEditDone ? 'bg-emerald-500/10' : 'bg-purple-500/10'}`}>
                                    <ChartIcon className={`h-5 w-5 ${isEditDone ? 'text-emerald-400' : 'text-purple-400'}`} />
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className={`flex items-center gap-1.5 text-xs font-medium ${isEditDone ? 'text-emerald-300' : 'text-purple-300'}`}>
                                      {isEditDone ? (
                                        <><Check className="h-3 w-3" /> Edited {typeLabel} Chart</>
                                      ) : (
                                        <><Pencil className="h-3 w-3" /> Editing {typeLabel} Chart</>
                                      )}
                                    </span>
                                    <span className="mt-0.5 truncate text-sm text-white">
                                      {chart.title}
                                    </span>
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                sideOffset={8}
                                className="z-[300] max-w-[min(90vw,260px)] !bg-black/90 !text-white text-xs shadow-lg break-words"
                              >
                                {chart.title}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
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
                    {message.content && !message.isError && (() => {
                      const lineCount = message.content.split('\n').length;
                      const isLong = lineCount > 10 || message.content.length > 600;
                      const isExpanded = expandedMessageIds.has(message.id);
                      return (
                        <div className="relative">
                          <div
                            className={`leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere] transition-all duration-300 ${isLong && !isExpanded ? 'max-h-[15em] overflow-hidden' : ''}`}
                            dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }}
                          />
                          {isLong && !isExpanded && (
                            <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${message.role === 'assistant' ? 'from-[#18181A] via-[#18181A]/80' : 'from-black/100'} to-transparent pointer-events-none`} />
                          )}
                        </div>
                      );
                    })()}
                    {message.isError && (
                      message.isInsufficientCredits ? (
                        <CreditExhaustedCard
                          tier={subscription?.tier ?? "standard"}
                          creditsLimit={tierLimit}
                          onUpgrade={upgradeToPro}
                        />
                      ) : (
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
                      )
                    )}
                    {/* Render saved todo tasks (between text and dashboard card) */}
                    {message.role === 'assistant' && message.todoTasks && message.todoTasks.length > 0 && (
                      <DeepThinkingTasks
                        savedTasks={message.todoTasks}
                        isActive={false}
                        inline
                      />
                    )}
                    {/* Render dashboard card if present */}
                    {message.role === 'assistant' && message.dashboardCard && (() => {
                      const sourceLabel = (() => {
                        const source = message.dashboardCard.sourceFileName || '';
                        if (source.toLowerCase().includes('google_analytics') || source.toLowerCase().includes('ga4')) return 'GA4 Data';
                        if (source.toLowerCase().includes('google_sheet') || source.toLowerCase().includes('gsheet')) return 'Google Sheets Data';
                        return source.replace(/\.[^/.]+$/, "");
                      })();

                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label="Open dashboard"
                              onClick={() => { onSwitchToDashboard && onSwitchToDashboard(message.dashboardCard?.dashboardId); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onSwitchToDashboard && onSwitchToDashboard(message.dashboardCard?.dashboardId); } }}
                              className={`group relative flex w-full max-w-full cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4 shadow-sm outline-none transition-all select-none hover:border-white/20 hover:bg-white/[0.06] ${message.content ? 'mt-3' : ''}`}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                                <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/25 via-blue-500/15 to-indigo-500/20 transition-all duration-300 group-hover:from-primary/35 group-hover:via-blue-500/25 group-hover:to-indigo-500/30">
                                  <svg viewBox="0 0 40 40" className="h-full w-full" aria-hidden="true">
                                    <path d="M5 14 L11 10 L17 16 L23 8 L29 12 L35 6" stroke="hsl(142 76% 56%)" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                                    <rect x="5" y="24" width="4.5" height="12" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.5" />
                                    <rect x="11.5" y="20" width="4.5" height="16" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.7" />
                                    <rect x="18" y="26" width="4.5" height="10" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.45" />
                                    <rect x="24.5" y="22" width="4.5" height="14" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.85" />
                                    <rect x="31" y="28" width="4.5" height="8" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.55" />
                                    <circle cx="23" cy="8" r="1.8" fill="hsl(142 76% 56%)" opacity="0.8" />
                                  </svg>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-md truncate font-medium text-white">
                                    {message.dashboardCard.dashboardTitle || "Dashboard"}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap gap-x-2 truncate text-sm text-white/50">
                                    <span className="truncate">Source: {sourceLabel}</span>
                                  </div>
                                </div>
                              </div>
                              {!isDashboardOpen && (
                                <button type="button" className="button-gradient ml-4 flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium text-white transition-all">
                                  Open
                                </button>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            sideOffset={8}
                            className="z-[300] max-w-[min(90vw,300px)] bg-black/90 text-xs text-white shadow-lg break-words"
                          >
                            {message.dashboardCard.dashboardTitle || "Dashboard"}{sourceLabel ? ` — ${sourceLabel}` : ''}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-muted-foreground">
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="flex items-center gap-1">
                        {message.content && (() => {
                          const lineCount = message.content.split('\n').length;
                          const isLong = lineCount > 10 || message.content.length > 600;
                          const isExpanded = expandedMessageIds.has(message.id);
                          if (!isLong) return null;
                          return (
                            <button
                              onClick={() => {
                                setExpandedMessageIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(message.id)) {
                                    next.delete(message.id);
                                  } else {
                                    next.add(message.id);
                                  }
                                  return next;
                                });
                              }}
                              className="flex items-center gap-1 rounded-md text-white/40 hover:text-white transition-colors"
                              title={isExpanded ? 'Collapse' : 'Expand'}
                              type="button"
                            >
                              <span className="text-xs">{isExpanded ? 'Show less' : 'Show more'}</span>
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          );
                        })()}
                        {message.content && !message.isError && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(message.content);
                              toast({ title: "Copied", description: "Message copied to clipboard" });
                            }}
                            className="px-2 rounded-md text-white/40 hover:text-white transition-colors"
                            title="Copy message"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Live Deep Thinking Tasks under the user message during active processing */}
              {message.role === 'user' && isProcessing && index === messages.length - 1 && (
                <div className="flex justify-start">
                  <DeepThinkingTasks
                    prompt={message.content}
                    isActive={true}
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
            onPasteCapture={handlePaste}
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
                charts={isDashboardOpen ? availableCharts : []}
                onSelect={handleAssetSelect}
                onChartSelect={handleChartSelect}
                onPreview={(fileId) => window.open(`/preview/${fileId}`, '_blank')}
                query={mentionQuery}
                className={`project-context-picker-container ${pickerTriggerMode === 'button' ? 'bottom-full left-0 mb-2' : ''}`}
              />
            )}

            {/* Active File & Chart Correlations */}
            {(stagedFiles.length > 0 || mentionedCharts.length > 0) && (
              <div className="mb-3 flex flex-row gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {mentionedCharts.map(chart => (
                  <ChartPreviewChip
                    key={`chart-${chart.componentId}`}
                    chart={chart}
                    onRemove={() => setMentionedCharts(prev => prev.filter(c => c.componentId !== chart.componentId))}
                  />
                ))}
                {stagedFiles.map((file, i) => (
                  <FilePreviewChip
                    key={file.fileID || i}
                    file={file}
                    onRemove={() => removeUploadedFile(file.fileID)}
                  />
                ))}
              </div>
            )}

            {/* Textarea Row */}
            <div className="relative mb-3">
              {/* Expand/Collapse button */}
              {inputValue.length > 100 && (
                <button
                  onClick={() => setIsInputExpanded(!isInputExpanded)}
                  className="absolute top-0 right-0 p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all z-10"
                  title={isInputExpanded ? 'Collapse input' : 'Expand input'}
                  type="button"
                >
                  {isInputExpanded ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
                </button>
              )}
              <TextareaAutosize
                minRows={2}
                maxRows={isInputExpanded ? 20 : 6}
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
                className={`w-full bg-transparent border-none outline-none resize-none text-sm placeholder:text-muted-foreground/60 chat-scrollbar-hide ${inputValue.length > 100 ? 'pr-6' : ''}`}
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

            {/* Credit exhausted banner */}
            {creditUsage?.can_use_credits === false && (
              <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/5">
                <div className="flex items-center gap-2 min-w-0">
                  <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs text-amber-300/80 truncate">Monthly credits used · Resets next month</span>
                </div>
                {subscription?.tier === "pro" ? (
                  <a
                    href="mailto:dreamify.dev@gmail.com?subject=More%20Credits%20Request"
                    className="shrink-0 inline-flex items-center justify-center h-7 px-3 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20 hover:bg-amber-500/25 transition-colors"
                  >
                    Contact us
                  </a>
                ) : (
                  <button
                    onClick={upgradeToPro}
                    className="shrink-0 inline-flex items-center justify-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold bg-primary text-white hover:opacity-90 transition-opacity"
                  >
                    <Zap className="w-3 h-3" />
                    Upgrade to Pro
                  </button>
                )}
              </div>
            )}

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
                    <div className="absolute bottom-full left-0 mb-1 w-56 bg-background/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg z-10">
                      <div className="py-1">
                        {CONNECTORS.map((connector) => (
                          <button
                            key={connector.name}
                            onClick={() => handleIntegrationClick(connector)}
                            className="w-full px-3 py-2 text-left text-sm flex items-center hover:bg-white/10 rounded-md transition-colors duration-200 cursor-pointer"
                          >
                            <img src={connector.icon} alt={connector.name} className="w-4 h-4 object-cover" />
                            {connector.name && <span className="pl-2">{connector.name}</span>}
                            {!connector.isActive && <span className="text-xs text-white/30 pl-1">(SOON)</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side - Model Selector + Send Button */}
              <div className="flex items-center gap-2">
                {/* Model Dropdown */}
                {/* Model Selector Component */}
                <ModelSelector
                  selectedModel={selectedModel}
                  onSelect={(model) => {
                    setSelectedModel(model);
                    setModelDropdownOpen(false);
                  }}
                  creditsRemaining={creditsRemaining}
                  creditsMonthlyLimit={tierLimit}
                  isOpen={modelDropdownOpen}
                  onToggle={() => setModelDropdownOpen(prev => !prev)}
                  anchor="right"
                  placement="top"
                  variant="compact"
                />

                {/* Send / Stop Button */}
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
                    disabled={!inputValue.trim() || isTyping || uploadedFiles.some(f => f.status === 'uploading')}
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