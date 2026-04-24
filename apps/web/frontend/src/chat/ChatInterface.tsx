import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CornerRightUp, Upload, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign, ChevronDown, ChevronUp, ChevronRight, Link, Mic, MicOff, FileText, LayoutTemplate, Square, X, Check, CheckCircle, FileStack, AlertCircle, ChevronsUpDown, ChevronsDownUp, Copy, PieChart, AreaChart, Hash, Table2, Pencil, CircleDashed, Circle, ListTodo, Zap } from "lucide-react";
import { CONNECTORS, CONNECTOR_CATEGORIES, type ConnectorItem } from "@/constants/connectors";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBarSidebar from '@/components/ui/recording-bar-sidebar';
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { fileService, type UploadResponse, type AssetRecord } from "@/services/fileService";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { useChatStore, type UploadedFile, isNonAnalyzableUpload } from "@/chat/useChatStore";
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
import { useTheme } from "@/hooks/useTheme";


// Creative phrase variants per backend step — each key maps to a real Morpheus workflow step
const STEP_VARIANTS: Record<string, string[]> = {
  'start': [
    "Waking up my brain...",
    "Coming online now...",
    "Stretching my neurons...",
    "Just getting started...",
    "Firing up the engines...",
    "Rising and shining...",
  ],
  'load_conversation': [
    "Reading our conversation...",
    "Catching up on context...",
    "Refreshing my memory...",
    "Picking up where we left off...",
    "Getting back up to speed...",
    "Reviewing the backstory...",
  ],
  'download_asset': [
    "Taking a look at your data...",
    "Reading through the file...",
    "Getting familiar with the dataset...",
    "Scanning what you've shared...",
    "Absorbing your spreadsheet...",
    "Digging into the file...",
  ],
  'run_workflow': [
    "Spinning up the pipeline...",
    "Getting the gears turning...",
    "Kicking off the workflow...",
    "Putting the wheels in motion...",
    "Launching the data engine...",
    "Starting the machinery...",
  ],
  'routing': [
    "Understanding what you need...",
    "Getting a feel for the goal...",
    "Figuring out the best path...",
    "Tuning in to your request...",
    "Mapping out the mission...",
    "Locking in on the objective...",
  ],
  'reasoning': [
    "Thinking this through...",
    "Planning the best approach...",
    "Brainstorming the right angle...",
    "Working out the strategy...",
    "Deliberating on the best move...",
    "Picking the smartest path...",
  ],
  'execution': [
    "Crunching the numbers...",
    "Running the analysis...",
    "Doing the heavy lifting...",
    "Putting the data to work...",
    "Getting into the details...",
    "Letting the math do its thing...",
  ],
  'synthesis': [
    "Designing your dashboard...",
    "Assembling the visuals...",
    "Crafting the charts...",
    "Building the layout...",
    "Putting it all together...",
    "Weaving the pieces together...",
  ],
  'validation': [
    "Double-checking the results...",
    "Making sure everything adds up...",
    "Giving it a final once-over...",
    "Confirming all looks good...",
    "Reviewing for accuracy...",
    "Verifying before handing over...",
  ],
  'finish': [
    "Wrapping things up...",
    "Putting on the finishing touches...",
    "Almost ready for you...",
    "Last few steps now...",
    "Polishing before delivery...",
    "Nearly there...",
  ],
  'error': [
    "Hit a small snag.",
    "Ran into a hiccup.",
    "Something went sideways.",
  ],
};

const STEP_LABELS_STORAGE_PREFIX = 'dreamify_step_labels_';
const stepVariantCache = new Map<string, string>();

const mapStepToDisplayText = (step: string): string => {
  const conversationId = useChatStore.getState().currentConversationId;
  const cacheKey = conversationId ? `${conversationId}:${step}` : step;

  // 1. In-memory cache (fast path)
  if (stepVariantCache.has(cacheKey)) return stepVariantCache.get(cacheKey)!;

  // 2. sessionStorage — survives F5 refresh, keyed by conversationId
  if (conversationId) {
    try {
      const stored = sessionStorage.getItem(STEP_LABELS_STORAGE_PREFIX + conversationId);
      if (stored) {
        const parsed: Record<string, string> = JSON.parse(stored);
        if (parsed[step]) {
          stepVariantCache.set(cacheKey, parsed[step]);
          return parsed[step];
        }
      }
    } catch { /* sessionStorage unavailable */ }
  }

  // 3. Pick randomly and persist to both caches
  const variants = STEP_VARIANTS[step];
  const pick = variants
    ? variants[Math.floor(Math.random() * variants.length)]
    : "Processing...";
  stepVariantCache.set(cacheKey, pick);

  if (conversationId) {
    try {
      const stored = sessionStorage.getItem(STEP_LABELS_STORAGE_PREFIX + conversationId);
      const existing: Record<string, string> = stored ? JSON.parse(stored) : {};
      existing[step] = pick;
      sessionStorage.setItem(STEP_LABELS_STORAGE_PREFIX + conversationId, JSON.stringify(existing));
    } catch { /* sessionStorage unavailable */ }
  }

  return pick;
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
  initialSteps?: Array<{ id: string; text: string }>;
  inline?: boolean;
}

const DeepThinkingTasks = ({ prompt, isActive, currentStep, savedTasks, initialSteps, inline }: DeepThinkingTasksProps) => {
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
      // Clear variant cache so each new workflow gets a fresh random set of labels
      stepVariantCache.clear();
      if (initialSteps && initialSteps.length > 0) {
        // Resume after reload: seed with all steps that completed before this session
        setWorkflowTasks(initialSteps);
        prevStepRef.current = initialSteps[initialSteps.length - 1].id;
      } else {
        setWorkflowTasks([{ id: 'start', text: mapStepToDisplayText('start') }]);
      }
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
    ? "w-full mt-3 bg-card dark:bg-[#1E1E1E] border border-border dark:border-white/10 rounded-xl overflow-hidden shadow-md dark:shadow-sm"
    : "w-full max-w-[85%] mt-3 ml-[38px] bg-card dark:bg-[#1E1E1E] border border-border dark:border-white/10 rounded-xl overflow-hidden shadow-md dark:shadow-sm";

  const headerClass = isLiveMode
    ? "grid grid-cols-[1fr_auto] items-center px-4 py-2 bg-secondary/50 dark:bg-[#18181B] border-b border-border dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/[0.02] transition-colors"
    : "flex items-center justify-between px-4 py-2 bg-secondary/50 dark:bg-[#18181B] border-b border-border dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/[0.02] transition-colors";

  return (
    <div className={wrapperClass}>
      {/* Header */}
      <div
        className={headerClass}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 text-[10px] sm:text-xs tracking-wider text-muted-foreground dark:text-white/50">
          <ListTodo className="w-5 h-5" />
          <span>Thinking Process <span className="text-muted-foreground/30 dark:text-white/20 mx-1">|</span> {isActive ? 'Executing' : 'Executed'}</span>
        </div>
        <div className={`flex items-center gap-2 ${isLiveMode ? 'flex-shrink-0' : ''}`}>
          <div className={`text-[10px] sm:text-xs text-muted-foreground dark:text-white/40 ${isLiveMode ? 'whitespace-nowrap text-right' : ''}`}>
            Total: {displayTasks.length} {displayTasks.length === 1 ? 'Task' : 'Tasks'}
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 dark:text-white/30 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
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
            <div className="px-4 py-3.5 border-t border-border dark:border-white/5">
              <div className="text-xs font-medium text-muted-foreground dark:text-white/80 mb-3.5">
                {isUsingWorkflow ? "Processing Steps" : `${displayTasks.length} Tasks Remaining`}
              </div>

              <div className="flex flex-col gap-3">
                {displayTasks.map((task, idx) => {
                  const isTaskActive = isUsingWorkflow ? (isActive && idx === displayTasks.length - 1) : (isActive && idx === 0);
                  const isCompleted = savedTasks ? true : isUsingWorkflow ? (idx < displayTasks.length - 1 || !isActive) : !isActive;

                  return (
                    <div key={task.id} className={`flex items-start gap-3 text-sm ${isTaskActive ? 'text-foreground dark:text-white' : 'text-muted-foreground/50 dark:text-white/50'}`}>
                      <div className="mt-[2px] flex-shrink-0">
                        {isCompleted ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : isTaskActive ? (
                          <CircleDashed className="w-4 h-4 text-muted-foreground/60 dark:text-white/80 animate-[spin_3s_linear_infinite]" />
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
                className="text-sm truncate bg-clip-text text-transparent bg-gradient-to-r from-muted-foreground/40 via-foreground to-muted-foreground/40 dark:from-gray-200 dark:via-white dark:to-gray-200 block max-w-full leading-normal"
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
  const { resolvedTheme } = useTheme();
  const logoFavicon = "/logo-favicon.png";

  // Model selector state
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const { creditsRemaining, creditUsage, subscription, refreshSubscription, upgradeToPro } = useSubscription();
  const tierLimit = 1000; // All users have Pro access (1000 credits/month)

  // Template state (controlled via store so project header can also trigger it)
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
    isTemplatePending,
    currentWorkflowStep,
    priorWorkflowSteps,
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
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
    setStripeModalOpen,
    setGoogleAdsModalOpen,
    setFirebaseModalOpen,
    setAllConnectorsModalOpen,
    isTemplateModalOpen,
    setTemplateModalOpen,
    templateModalSource,
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
    // ### / ## / # headings (must be at start of line)
    html = html.replace(/^(#{1,3})\s+(.+)$/gm, (_m, hashes, text) => {
      const level = hashes.length;
      const cls = level === 1
        ? 'text-base font-bold mt-3 mb-1'
        : level === 2
          ? 'text-sm font-bold mt-2 mb-1'
          : 'text-sm font-semibold mt-2 mb-0.5';
      return `<p class="${cls}">${text}</p>`;
    });
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
    if (uploadedFiles.some(f => f.status === 'uploading')) {
      toast({ title: "Upload in progress", description: "Please wait for the file to finish uploading.", variant: "destructive" });
      return;
    }
    const hasValidUploadedFiles = uploadedFiles.some(f => ['uploaded', 'processed', 'accepted'].includes(f.status));
    if (projectAssets.length === 0 && !hasValidUploadedFiles) {
      toast({ title: "Upload required", description: "Upload at least one file before asking a question.", variant: "destructive" });
      return;
    }
    const hasAnalyzableUpload = uploadedFiles.some(
      (f) => ['uploaded', 'processed', 'accepted'].includes(f.status) && !isNonAnalyzableUpload(f),
    );
    const hasOtherContext =
      mentionedAssetIds.length > 0 || mentionedCharts.length > 0 || projectAssets.length > 0;
    if (!hasAnalyzableUpload && !hasOtherContext) {
      toast({
        title: "No data rows to analyze",
        description:
          "This attachment has column headers only. Widen the date range in Meta Ads sync, or upload a file with at least one data row.",
        variant: "destructive",
      });
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
    const hasAnalyzableUpload = uploadedFiles.some(
      (f) => ['uploaded', 'processed', 'accepted'].includes(f.status) && !isNonAnalyzableUpload(f),
    );
    const hasOtherContext =
      mentionedAssetIds.length > 0 || mentionedCharts.length > 0 || projectAssets.length > 0;
    if (!hasAnalyzableUpload && !hasOtherContext) {
      toast({
        title: "No data rows to analyze",
        description:
          "This attachment has column headers only. Widen the date range in Meta Ads sync, or upload a file with at least one data row.",
        variant: "destructive",
      });
      return;
    }
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
      else if (assetType === 'integration_meta_ads') sourceType = 'Meta Ads';

      const newFile: UploadedFile = {
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
        schemaOnly: sourceType === 'Meta Ads' && assetData.row_count === 0,
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
    if (connector.name === 'Meta Ads') {
      setDropdownOpen(false);
      setTimeout(() => setMetaAdsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'TikTok Ads') {
      setDropdownOpen(false);
      setTimeout(() => setTikTokModalOpen(true), 0);
      return;
    }
    if (connector.name === 'AppsFlyer') {
      setDropdownOpen(false);
      setTimeout(() => setAppsFlyerModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Stripe') {
      setDropdownOpen(false);
      setTimeout(() => setStripeModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Google Ads') {
      setDropdownOpen(false);
      setTimeout(() => setGoogleAdsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Firebase') {
      setDropdownOpen(false);
      setTimeout(() => setFirebaseModalOpen(true), 0);
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

  const handleTemplateSelect = (template: { id: string; title: string; description: string; image?: string; category: string; suggestedTheme?: string }) => {
    if (templateModalSource === 'header') {
      // Header entry point: store the template for next generation but don't
      // show the chip or pre-fill the input (no pre-submit flow needed).
      setSelectedTemplate(template, false);
      return;
    }
    // Toolbar entry point: pre-submit flow — show chip + pre-fill input.
    setSelectedTemplate(template);
    setInputValue(`Use ${template.title} template to make `);
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
      "TikTok": { bg: "bg-zinc-900", border: "border-zinc-800", text: "text-white", hover: "hover:bg-black" },
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
            ? "bg-slate-800 dark:bg-black"
            : isSystem
              ? "bg-muted dark:bg-white/10 border border-border dark:border-white/20"
              : "bg-transparent";
          const bubbleBgClass = isUser
            ? "bg-muted dark:bg-black p-3 border border-border dark:border-white/10"
            : isSystem
              ? "bg-muted/50 dark:bg-white/5 p-3 border border-border dark:border-white/10"
              : "bg-transparent p-0";
          const isAssistant = !isUser && !isSystem;
          const messageGap = isAssistant ? "gap-1" : "gap-2";
          const avatarContainerSize = isAssistant ? "w-5 h-5" : "w-6 h-6";
          return (
            <div key={message.id} className="space-y-1">
              <div
                className={`chat-enter flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[90%] min-w-0 flex ${messageGap} ${bubbleLayoutClass}`}>
                  <div className={`${avatarContainerSize} rounded-md flex items-center justify-center flex-shrink-0 ${avatarClass}`}>
                    {isUser ? (
                      <User className="w-3 h-3 text-white" />
                    ) : isSystem ? (
                      <span className="text-[9px] font-semibold tracking-wide uppercase text-muted-foreground dark:text-white/70">
                        SYS
                      </span>
                    ) : (
                      <img src={logoFavicon} alt="Dreamify" className="h-5 w-5 object-contain" />
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
                          const isMeta = !isMultiple && (sType.includes('Meta Ads') || sType.includes('meta_ads'));
                          const isTikTok = !isMultiple && (sType.includes('TikTok') || sType.includes('tiktok') || sType.includes('integration_tiktok'));
                          const isGoogleAds = !isMultiple && sType.includes('Google Ads');
                          const isFirebase = !isMultiple && sType.includes('Firebase');
                          const isAppsFlyer = !isMultiple && (sType.includes('AppsFlyer') || sType.includes('appsflyer'));
                          const isStripe = !isMultiple && sType.includes('Stripe');

                          const displayName = isMultiple ? "Multiple Data Sources"
                            : isGA4 ? "Google Analytics 4"
                              : isSheets ? "Google Sheets"
                                : isMeta ? "Meta Ads"
                                  : isTikTok ? "TikTok Ads"
                                    : isGoogleAds ? "Google Ads"
                                      : isFirebase ? "Firebase"
                                        : isAppsFlyer ? "AppsFlyer"
                                          : isStripe ? "Stripe"
                                            : "Attached Data";

                          const logoBg = isMultiple ? "bg-indigo-500/10"
                            : isGA4 ? "bg-orange-500/10"
                              : isSheets ? "bg-green-500/10"
                                : isMeta ? "bg-blue-500/10"
                                  : isTikTok ? "bg-black/10 dark:bg-black/20"
                                    : isGoogleAds ? "bg-[#4285F4]/10"
                                      : isFirebase ? "bg-[#FFA000]/10"
                                        : isAppsFlyer ? "bg-muted dark:bg-white/5"
                                          : isStripe ? "bg-[#6772E5]/10"
                                            : "bg-muted dark:bg-white/10";

                          const connector = isMultiple ? undefined : CONNECTORS.find(c => {
                            if (isGA4 && c.name === 'GA4') return true;
                            if (isSheets && c.name === 'Google Sheets') return true;
                            if (isMeta && c.name === 'Meta Ads') return true;
                            if (isTikTok && c.name === 'TikTok Ads') return true;
                            if (isGoogleAds && c.name === 'Google Ads') return true;
                            if (isFirebase && c.name === 'Firebase') return true;
                            if (isAppsFlyer && c.name === 'AppsFlyer') return true;
                            if (isStripe && c.name === 'Stripe') return true;
                            return false;
                          });
                          const icon = connector?.icon;

                          let secondaryText = "";
                          if (isMultiple) {
                            secondaryText = message.attachment.name;
                          } else if (isGA4) {
                            secondaryText = message.attachment.propertyName || message.attachment.accountName || message.attachment.name.replace(/\.[^/.]+$/, "");
                          } else if (isSheets) {
                            secondaryText = message.attachment.name.replace(/\.[^/.]+$/, "");
                          } else if (isMeta || isTikTok || isGoogleAds || isFirebase || isAppsFlyer || isStripe) {
                            secondaryText = message.attachment.accountName || message.attachment.name.replace(/\.[^/.]+$/, "");
                          } else {
                            secondaryText = message.attachment.name.replace(/\.[^/.]+$/, "");
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
                                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border dark:border-white/10 bg-card dark:bg-white/5 px-3 py-2.5 text-foreground dark:text-white/90 shadow-sm transition-all hover:bg-muted dark:hover:bg-white/10 max-w-full outline-none"
                                >
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md p-2 ${logoBg}`}>
                                    {icon ? (
                                      <img src={icon} className={`h-full w-full object-contain ${isTikTok ? 'scale-125' : ''}`} alt="" />
                                    ) : (
                                      <Database className="h-5 w-5 text-emerald-400" />
                                    )}
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className="truncate text-sm font-medium text-foreground dark:text-white">
                                      {displayName}
                                    </span>
                                    {secondaryText && (
                                      <span className="mt-0.5 truncate text-xs text-muted-foreground dark:text-gray-400">
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
                                  className={`flex max-w-full cursor-default items-center gap-3 rounded-lg border px-3 py-2.5 text-foreground dark:text-white/90 shadow-sm outline-none transition-all ${isEditDone ? 'border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/[0.06]' : 'border-purple-500/30 bg-purple-500/5 dark:bg-purple-500/[0.06]'}`}
                                >
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${isEditDone ? 'bg-emerald-500/10' : 'bg-purple-500/10'}`}>
                                    <ChartIcon className={`h-5 w-5 ${isEditDone ? 'text-emerald-400' : 'text-purple-400'}`} />
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className={`flex items-center gap-1.5 text-xs font-medium ${isEditDone ? 'text-emerald-600 dark:text-emerald-300' : 'text-purple-600 dark:text-purple-300'}`}>
                                      {isEditDone ? (
                                        <><Check className="h-3 w-3" /> Edited {typeLabel} Chart</>
                                      ) : (
                                        <><Pencil className="h-3 w-3" /> Editing {typeLabel} Chart</>
                                      )}
                                    </span>
                                    <span className="mt-0.5 truncate text-sm text-foreground dark:text-white">
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
                          className="inline-flex flex-col items-start gap-0.5 px-4 py-1 rounded-lg border border-border dark:border-white/20 bg-card dark:bg-white/10 text-[11px] text-foreground dark:text-white/90 w-full shadow-sm"
                          title={message.template.title}
                          aria-label="Selected template"
                        >
                          <span className="inline-flex items-center gap-1 text-muted-foreground dark:text-white/70">
                            <LayoutTemplate className="w-3 h-3 text-muted-foreground dark:text-white/80" />
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
                            className={`text-foreground dark:text-white leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere] transition-all duration-300 ${isLong && !isExpanded ? 'max-h-[15em] overflow-hidden' : ''}`}
                            dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }}
                          />
                          {isLong && !isExpanded && (
                            <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${message.role === 'assistant' ? 'from-background dark:from-[#18181A] via-background/80 dark:via-[#18181A]/80' : 'from-muted dark:from-black/100 via-muted/80 dark:via-black/80'} to-transparent pointer-events-none`} />
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
                        const accountName = message.dashboardCard.accountName;
                        if (accountName) return accountName;
                        const source = (message.dashboardCard.sourceType || message.dashboardCard.sourceFileName || '').toLowerCase();
                        const filename = (message.dashboardCard.sourceFileName || '').toLowerCase();
                        if (source.includes('ga4') || source.includes('google_analytics') || source.includes('google analytics') || filename.includes('ga4') || filename.includes('google_analytics')) return 'GA4 Data';
                        if (source.includes('sheet') || source.includes('google sheets') || filename.includes('google_sheet') || filename.includes('gsheet')) return 'Google Sheets Data';
                        if (source.includes('google ads') || source.includes('google_ads') || filename.includes('google_ads')) return 'Google Ads Data';
                        if (source.includes('firebase') || filename.includes('firebase')) return 'Firebase Data';
                        if (source.includes('tiktok') || filename.includes('tiktok')) return 'TikTok Data';
                        if (source.includes('appsflyer') || filename.includes('appsflyer')) return 'AppsFlyer Data';
                        if (source.includes('stripe') || filename.includes('stripe')) return 'Stripe Data';
                        if (source.includes('meta') || filename.includes('meta_ads')) return 'Meta Ads Data';
                        return message.dashboardCard.sourceFileName.replace(/\.[^/.]+$/, "");
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
                              className={`group relative flex w-full max-w-full cursor-pointer items-center justify-between rounded-xl border border-border dark:border-white/10 bg-white/[0.03] p-4 shadow-sm outline-none transition-all select-none hover:border-border/80 dark:hover:border-white/20 hover:bg-white/[0.06] ${message.content ? 'mt-3' : ''}`}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                                <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/20 via-blue-500/15 to-cyan-500/10 transition-all duration-300 group-hover:from-violet-500/30 group-hover:via-blue-500/25 group-hover:to-cyan-500/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
                                  <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-border/50 dark:ring-white/10 group-hover:ring-border dark:ring-white/15 transition-all duration-300" />
                                  <svg viewBox="0 0 40 40" className="h-full w-full" aria-hidden="true">
                                    <defs>
                                      <linearGradient id="chatBarGrad1" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="hsl(221 83% 70%)" stopOpacity="1" />
                                        <stop offset="100%" stopColor="hsl(260 80% 60%)" stopOpacity="0.6" />
                                      </linearGradient>
                                      <linearGradient id="chatBarGrad2" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="hsl(175 80% 60%)" stopOpacity="0.9" />
                                        <stop offset="100%" stopColor="hsl(221 83% 60%)" stopOpacity="0.5" />
                                      </linearGradient>
                                    </defs>
                                    <path d="M4 15 L10 11 L16 14 L22 7 L28 10 L36 5" stroke="hsl(142 76% 60%)" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
                                    <rect x="4" y="23" width="5" height="13" rx="1.5" fill="url(#chatBarGrad1)" opacity="0.5" />
                                    <rect x="11" y="19" width="5" height="17" rx="1.5" fill="url(#chatBarGrad1)" opacity="0.8" />
                                    <rect x="18" y="25" width="5" height="11" rx="1.5" fill="url(#chatBarGrad2)" opacity="0.55" />
                                    <rect x="25" y="21" width="5" height="15" rx="1.5" fill="url(#chatBarGrad1)" opacity="0.9" />
                                    <rect x="32" y="27" width="5" height="9" rx="1.5" fill="url(#chatBarGrad2)" opacity="0.6" />
                                    <circle cx="22" cy="7" r="2.2" fill="hsl(142 76% 60%)" opacity="0.9" />
                                    <circle cx="22" cy="7" r="3.5" fill="hsl(142 76% 60%)" opacity="0.2" />
                                  </svg>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-md truncate font-medium text-foreground dark:text-white">
                                    {message.dashboardCard.dashboardTitle || "Dashboard"}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap gap-x-2 truncate text-sm text-muted-foreground dark:text-white/50">
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
                              className="flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground dark:text-white/40 dark:hover:text-white transition-colors"
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
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground dark:text-white/40 dark:hover:text-white transition-colors hover:bg-muted dark:hover:bg-white/10"
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
                    initialSteps={priorWorkflowSteps.map(s => ({ id: s, text: mapStepToDisplayText(s) }))}
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
                className="inline-flex self-start px-2 py-1 text-xs text-muted-foreground hover:text-foreground dark:text-white/30 border border-border dark:border-white/10 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200 text-left whitespace-normal break-words leading-snug overflow-hidden box-border max-w-full"
              >
                <span className="block min-w-0 break-words dark:group-hover:text-white/80">{prompt.text}</span>
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
            className="w-full min-h-[60px] text-sm p-4 pb-2 bg-background dark:bg-[#292929] border border-border dark:border-transparent rounded-xl resize-none transition-all duration-300 relative"
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

            {/* Active File, Chart & Template Correlations */}
            {(stagedFiles.length > 0 || mentionedCharts.length > 0 || (selectedTemplate && isTemplatePending)) && (
              <div className="mb-3 flex flex-row gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {/* Template Selection Pill */}
                {selectedTemplate && isTemplatePending && (
                  <div className="flex-shrink-0 animate-in fade-in slide-in-from-left-2 duration-300">
                    <div className="inline-flex max-w-[min(18rem,85vw)] flex-shrink-0 cursor-default items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-2 transition-all hover:border-accent/40 outline-none">
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <LayoutTemplate className="w-4 h-4 text-accent" />
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                        <span className="flex-shrink-0 font-semibold text-accent">
                          Template:
                        </span>
                        <span className="truncate font-medium text-foreground/90 dark:text-white/90">
                          {selectedTemplate.title}
                        </span>
                      </div>
                      <button
                        onClick={handleTemplateRemove}
                        className="group -mr-1 flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10 active:scale-95"
                      >
                        <X className="h-3 w-3 text-muted-foreground dark:text-white/40 transition-colors group-hover:text-foreground dark:group-hover:text-white/60" />
                      </button>
                    </div>
                  </div>
                )}

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
                  className="absolute top-0 right-0 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10 transition-all z-10"
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

                    // Mutual Exclusion
                    setModelDropdownOpen(false);
                    setDropdownOpen(false);

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

                      // Mutual Exclusion
                      setModelDropdownOpen(false);
                      setDropdownOpen(false);
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
                {/*{subscription?.tier === "pro" ? (*/}
                <a
                  href="https://mail.google.com/mail/?view=cm&to=dreamify.dev@gmail.com&su=More%20Credits%20Request"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center justify-center h-7 px-3 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20 hover:bg-amber-500/25 transition-colors"
                >
                  Contact us
                </a>
                {/*) : (
                     <button
                      onClick={upgradeToPro}
                      className="shrink-0 inline-flex items-center justify-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold bg-primary text-white hover:opacity-90 transition-opacity"
                    >
                      <Zap className="w-3 h-3" />
                      Upgrade to Pro
                    </button>*/}
                {/*)}*/}
              </div>
            )}

            {/* Buttons Row */}
            <div className="flex items-center justify-between">
              {/* Left side - File Upload and Data Connector Buttons */}
              <div className="flex items-center gap-2">
                {/* Upload Button - Icon only */}
                <button
                  onClick={handleFileUpload}
                  className="p-2 flex items-center justify-center border border-border/50 dark:border-white/30 rounded-md text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-white transition-colors"
                  title="Upload file"
                >
                  <Upload className="w-4 h-4" />
                </button>

                {/* Project Context Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsContextPickerOpen(prev => !prev);
                    setPickerTriggerMode('button');
                    if (!isContextPickerOpen) {
                      setModelDropdownOpen(false);
                      setDropdownOpen(false);
                      // Ensure assets are loaded
                      if (projectId && projectAssets.length === 0) {
                        fetchProjectAssets(projectId).then(setProjectAssets);
                      }
                    }
                  }}
                  className={`project-context-trigger p-2 flex items-center justify-center border border-border/50 dark:border-white/30 rounded-md text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-white transition-colors ${isContextPickerOpen && pickerTriggerMode === 'button' ? 'bg-muted dark:bg-white/10 text-foreground dark:text-white' : ''
                    }`}
                  title="Project Context"
                >
                  <FileStack className="w-4 h-4" />
                </button>

                {/* Template Button */}
                <button
                  onClick={handleCloneTemplateClick}
                  className="p-2 flex items-center justify-center border border-border/50 dark:border-white/30 rounded-md text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-white transition-colors"
                  title="Choose template"
                  aria-label="Choose template"
                >
                  <LayoutTemplate className="w-4 h-4" />
                </button>

                {/* Data Connector Dropup */}
                <div className="relative data-source-dropdown">
                  <button
                    onClick={() => {
                      const newState = !dropdownOpen;
                      setDropdownOpen(newState);
                      if (newState) {
                        setModelDropdownOpen(false);
                        setIsContextPickerOpen(false);
                      }
                    }}
                    className={`p-2 flex items-center justify-center gap-1 rounded-md transition-all duration-200 ${selectedDataSource
                      ? `${getDataSourceColors(selectedDataSource).bg} ${getDataSourceColors(selectedDataSource).border} ${getDataSourceColors(selectedDataSource).text} ${getDataSourceColors(selectedDataSource).hover} border`
                      : 'border border-border/50 dark:border-white/30 text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-white'
                      }`}
                    aria-expanded={dropdownOpen}
                    aria-haspopup="true"
                    aria-label="Connect data source"
                  >
                    <Link className="w-4 h-4" />
                    <ChevronUp className={`w-3 h-3 transition-transform duration-200 ${selectedDataSource ? 'text-white' : 'text-muted-foreground/60 dark:text-white/60'
                      } ${dropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {dropdownOpen && (
                    <div className="absolute bottom-full left-0 mb-1 bg-background/95 backdrop-blur-sm border border-border/30 rounded-xl shadow-2xl z-10 p-2 w-52">
                      <p className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground dark:text-white/25">Popular</p>

                      {/* Active connectors */}
                      {CONNECTORS.filter(c => ['GA4', 'Google Ads', 'Firebase', 'Google Sheets'].includes(c.name)).map(con => (
                        <button
                          key={con.name}
                          onClick={() => handleIntegrationClick(con)}
                          className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-muted dark:hover:bg-white/10 rounded-md transition-colors cursor-pointer"
                        >
                          <img src={con.icon} alt={con.name} className="w-4 h-4 object-contain flex-shrink-0" />
                          <span className="text-foreground dark:text-white/90">{con.name}</span>
                        </button>
                      ))}

                      {/* SOON connectors — disabled, toast only */}
                      {([
                        { name: 'Meta Ads', icon: '/meta.png', category: 'Advertising Platform' as const },
                        { name: 'TikTok Ads', icon: '/tiktok.png', category: 'Advertising Platform' as const },
                      ] as const).map(con => (
                        <button
                          key={con.name}
                          onClick={() => handleIntegrationClick(con)}
                          className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-muted dark:hover:bg-white/10 rounded-md transition-colors cursor-pointer"
                        >
                          <img src={con.icon} alt={con.name} className="w-4 h-4 object-contain flex-shrink-0 opacity-50" />
                          <span className="text-muted-foreground dark:text-white/50">{con.name}</span>
                          <span className="ml-auto text-[9px] text-white/30">SOON</span>
                        </button>
                      ))}

                      <div className="border-t border-white/10 mt-1.5 pt-1.5">
                        <button
                          onClick={() => { setDropdownOpen(false); setAllConnectorsModalOpen(true); }}
                          className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground dark:text-white/50 dark:hover:text-white flex items-center gap-1.5 rounded-md hover:bg-muted dark:hover:bg-white/10 transition-colors"
                        >
                          Browse all connectors
                          <ChevronRight className="w-3 h-3 ml-auto" />
                        </button>
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
                  onToggle={() => {
                    const newState = !modelDropdownOpen;
                    setModelDropdownOpen(newState);
                    if (newState) {
                      setDropdownOpen(false);
                      setIsContextPickerOpen(false);
                    }
                  }}
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
        open={isTemplateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onTemplateSelect={handleTemplateSelect}
        source={templateModalSource}
      />
    </div>
  );
};

export default ChatInterface;