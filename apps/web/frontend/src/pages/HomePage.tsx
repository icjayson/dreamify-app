import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Database, CornerRightUp, LayoutTemplate, Mic, MicOff, Link, FileText, LogIn, TrendingUp, AlertCircle, LayoutDashboard } from "lucide-react";
import FileAttachDropdown from "@/components/chat/FileAttachDropdown";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { SignedIn, useAuth, useUser } from "@clerk/clerk-react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useToast } from "@/hooks/use-toast";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBar from '@/components/ui/recording-bar';
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import { fileService, type UploadResponse } from "@/services/fileService";
import { useProjects } from "@/hooks/useProjects";
import { useSubscription } from "@/hooks/useSubscription";
import { Message } from "@/types/message";
import { FooterSection } from '@/components/homepage-section/footer-section';
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import VideoBackground from '@/components/homepage-section/VideoBackground';
import ProjectsSection from '@/components/homepage-section/ProjectsSection';
import ProjectsSidebar from '@/components/homepage-section/ProjectsSidebar';
import TemplateModal from '@/components/homepage-section/TemplateModal';
import type { ThemeSelection } from '@/constants/builtinTemplates';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ToastAction } from "@/components/ui/toast";
import { CONNECTORS, CONNECTOR_CATEGORIES, type ConnectorItem } from '@/constants/connectors';
import FilePreviewChip from '@/components/chat/FilePreviewChip';
import { ThemeInlineToken } from '@/components/chat/ThemeInlineToken';
import ModelSelector from '@/chat/ModelSelector';
import { getFilesFromClipboardData } from "@/lib/clipboardFiles";
import ReactGA from 'react-ga4';
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";
import { MissionSection } from "@/components/homepage-section/mission";
import { ProblemSection } from "@/components/homepage-section/problem";
import { FeaturesSection } from "@/components/homepage-section/features";
import { CTAContainerSection } from "@/components/homepage-section/cta";
import { useTheme } from "@/hooks/useTheme";

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

  // Toast hook
  const { toast } = useToast();



  // Clear chat state on mount to ensure a clean slate
  useEffect(() => {
    useChatStore.getState().resetChat();
    useFileStore.getState().resetFileState();
  }, []);

  const {
    projects,
    isLoading: projectsLoading,
    createNewProject,
    renameProject,
    deleteProject,
    openProject
  } = useProjects();
  const { creditsRemaining, creditUsage, subscription } = useSubscription();
  const tierLimit = 1000; // All users have Pro access (1000 credits/month)
  // Zustand stores
  const {
    inputValue,
    selectedDataSource,
    dropdownOpen,
    isListening,
    detectedLanguage,
    uploadedFiles,
    addFiles,
    removeFile,
    updateFile,
    isProcessing,
    selectedTemplate,
    isTemplatePending,
    setInputValue,
    setSelectedDataSource,
    setDropdownOpen,
    setIsListening,
    setDetectedLanguage,
    setSelectedTemplate,
    sendMessage,
    addMessage,
    processFileWithMessage,
    resetChat,
    selectedModel,
    setSelectedModel,
  } = useChatStore();

  const { resolvedTheme } = useTheme();
  const logoFullHorizon = resolvedTheme === 'dark' ? "/logo-full-horizon-white.png" : "/logo-full-horizon-dark.png";

  const {
    uploadState,
    uploadFile,
    validateClientFile
  } = useFileStore();

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lottieData, setLottieData] = useState(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  // Typewriter rotating words for subheading
  const rotatingWords = [
    { text: 'businesses', gradient: 'linear-gradient(90deg, #FF4D4D, #FF9A3C)', cursorColor: '#FF4D4D' },
    { text: 'brands', gradient: 'linear-gradient(90deg, #2563EB, #7C3AED)', cursorColor: '#2563EB' },
    { text: 'campaigns', gradient: 'linear-gradient(90deg, #DA22FF, #9733EE)', cursorColor: '#DA22FF' },
    { text: 'products', gradient: 'linear-gradient(90deg, #11998E, #38EF7D)', cursorColor: '#11998E' },
  ];
  const [rotatingIndex, setRotatingIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTypingIn, setIsTypingIn] = useState(true);

  useEffect(() => {
    const currentWord = rotatingWords[rotatingIndex].text;
    let timeout: ReturnType<typeof setTimeout>;

    if (isTypingIn) {
      if (displayedText.length < currentWord.length) {
        timeout = setTimeout(() => {
          setDisplayedText(currentWord.slice(0, displayedText.length + 1));
        }, 80);
      } else {
        // Pause at full word before typing out
        timeout = setTimeout(() => {
          setIsTypingIn(false);
        }, 1800);
      }
    } else {
      if (displayedText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayedText(displayedText.slice(0, -1));
        }, 50);
      } else {
        // Move to next word
        setRotatingIndex((prev) => (prev + 1) % rotatingWords.length);
        setIsTypingIn(true);
      }
    }

    return () => clearTimeout(timeout);
  }, [displayedText, isTypingIn, rotatingIndex]);

  // Model selector state
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // File upload integration
  const { uploadState: legacyUploadState, uploadCSVFile, uploadExcelFile } = useFileUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const placeholders = [
    "Tell me about your data or describe the dashboard you want...",
    "Upload your CSV and I'll suggest visualizations...",
    "Connect Stripe data and create a revenue dashboard...",
    "Show me customer acquisition trends with animated charts..."
  ];

  // Function to get colors for each data source
  const getDataSourceColors = (sourceName: string) => {
    const colors: { [key: string]: { bg: string; border: string; text: string; hover: string } } = {
      "Google Sheets": { bg: "bg-green-500", border: "border-green-400", text: "text-white", hover: "hover:bg-green-600" },
      "GA4": { bg: "bg-orange-500", border: "border-orange-400", text: "text-white", hover: "hover:bg-orange-600" },
      "Meta Ads": { bg: "bg-blue-600", border: "border-blue-500", text: "text-white", hover: "hover:bg-blue-700" },
      "TikTok Ads": { bg: "bg-zinc-900", border: "border-zinc-800", text: "text-white", hover: "hover:bg-black" },
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
    // Reset chat state when landing on home to ensure isolation between sessions.
    // This prevents files from previous projects from persisting.
    resetChat();
  }, [resetChat]);

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

    if (uploadedFiles.some(f => f.status === 'uploading')) {
      toast({ title: "Upload in progress", description: "Please wait for the file to finish uploading.", variant: "destructive" });
      return;
    }
    if (uploadedFiles.length === 0 || !uploadedFiles.some(f => ['uploaded', 'processed', 'accepted'].includes(f.status))) {
      toast({ title: "Upload required", description: "Upload at least one file before asking a question.", variant: "destructive" });
      return;
    }

    const firstUploadedFile = uploadedFiles.find(f => ['uploaded', 'processed', 'accepted'].includes(f.status));

    if (!firstUploadedFile?.projectId) {
      toast({
        title: "Project error",
        description: "No project context found. Please try uploading again.",
        variant: "destructive"
      });
      return;
    }

    const pendingTemplateSelection = selectedTemplate && isTemplatePending ? selectedTemplate : null;

    // Set pending action for ProjectPage to execute
    useChatStore.getState().setPendingAction({
      type: 'process_file',
      content: inputValue.trim(),
      files: uploadedFiles,
      projectId: firstUploadedFile.projectId,
      model: selectedModel,
      templateSelection: pendingTemplateSelection,
    });

    navigate(`/workspace/project?projectId=${firstUploadedFile.projectId}`);
  };

  const handleFileUpload = (files: FileList | null) => {
    // Upload alone should not navigate; navigation happens on prompt submit
    if (files && files.length > 0) {
      // no-op here; actual upload handled by input change handlers
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

    const remainingSlots = 5 - uploadedFiles.length;
    if (files.length > remainingSlots) {
      toast({
        title: "Too many files",
        description: `Maximum 5 files allowed. You can add ${remainingSlots} more file(s).`,
        variant: "destructive"
      });
      return;
    }

    let batchProjectId = uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }
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

  const handleTemplateSelect = (template: ThemeSelection) => {
    setSelectedTemplate(template);
    setInputValue(`Use ${template.title} theme to make `);
    console.log('Theme selected:', template);
  };

  const handleTemplateRemove = () => {
    setSelectedTemplate(null);
    setInputValue('');
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = getFilesFromClipboardData(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const remainingSlots = 5 - uploadedFiles.length;
    if (files.length > remainingSlots) {
      toast({
        title: "Too many files",
        description: `Maximum 5 files allowed. You can add ${remainingSlots} more file(s).`,
        variant: "destructive"
      });
      return;
    }
    let batchProjectId = uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }
  };

  const processFileUpload = async (file: File, projectIdOverride?: string): Promise<string | undefined> => {
    if (!isSignedIn) {
      toast({
        title: "Authentication Required",
        description: "Please login to upload files.",
        variant: "destructive",
        action: (
          <ToastAction altText="Login" onClick={() => navigate('/login')} className="button-outline">
            Login
          </ToastAction>
        ),
      });
      return undefined;
    }

    const validationError = validateClientFile(file);
    if (validationError) {
      toast({ title: "Upload error", description: validationError, variant: "destructive" });
      return undefined;
    }

    const tempId = `pending-${Date.now()}-${Math.random()}`;
    try {
      const newFile = {
        fileID: tempId,
        filename: file.name,
        size: file.size,
        ext: (file.name.split('.').pop() || '').toLowerCase(),
        status: 'uploading' as const,
        uploadProgress: 0,
      };

      if (uploadedFiles.length >= 5) {
        toast({
          title: "Maximum files reached",
          description: "You can only upload up to 5 files at a time.",
          variant: "destructive"
        });
        return undefined;
      }
      addFiles([newFile]);

      const res: UploadResponse = await fileService.uploadFile(file, {
        projectId: projectIdOverride,
        onProgress: (percent) => updateFile(tempId, { uploadProgress: Math.min(percent, 95) }),
      });
      if (!res.success || !res.fileID || !res.ext || res.size === undefined || !res.filename) {
        removeFile(tempId);
        addFiles([{ ...newFile, status: 'error', uploadProgress: undefined }]);
        toast({ title: "Upload failed", description: res.error || 'Upload failed', variant: "destructive" });
        return undefined;
      }

      const fallbackFilename = res.filename ?? file.name;
      const fallbackSize = res.size ?? file.size;
      const fallbackExt = res.ext || (file.name.split('.').pop() || '').toLowerCase();
      const uploadedProjectId = res.asset?.project_id || projectIdOverride;

      removeFile(tempId);
      addFiles([{
        fileID: res.fileID,
        filename: fallbackFilename,
        size: fallbackSize,
        ext: fallbackExt,
        status: 'uploaded',
        projectId: uploadedProjectId
      }]);
      ReactGA.event({
        category: "File",
        action: "Upload Success",
        label: fallbackFilename
      });
      toast({ title: "File uploaded", description: `${res.filename} uploaded successfully. You can now ask questions about your data.` });
      return uploadedProjectId;
    } catch (_e) {
      removeFile(tempId);
      addFiles([{
        fileID: 'error',
        filename: file.name,
        size: file.size,
        ext: (file.name.split('.').pop() || '').toLowerCase(),
        status: 'error'
      }]);
      toast({ title: "Upload error", description: "Failed to upload file. Please try again.", variant: "destructive" });
      return undefined;
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = 5 - uploadedFiles.length;
    if (files.length > remainingSlots) {
      toast({
        title: "Too many files",
        description: `Maximum 5 files allowed. You can add ${remainingSlots} more file(s).`,
        variant: "destructive"
      });
      event.target.value = '';
      return;
    }

    let batchProjectId = uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }

    // Reset input
    event.target.value = '';
  };

  const handleDataSourceSelect = (source: string) => {
    setSelectedDataSource(source);
    setDropdownOpen(false);
    console.log('Data source selected:', source);
  };

  const handleIntegrationClick = (connector: ConnectorItem) => {
    if (!isSignedIn) {
      setWaitlistOpen(true);
      return;
    }

    if (connector.name === 'GA4') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setGA4ModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Google Sheets') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setGoogleSheetsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Meta Ads') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setMetaAdsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'TikTok Ads') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setTikTokModalOpen(true), 0);
      return;
    }
    if (connector.name === 'AppsFlyer') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setAppsFlyerModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Stripe') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setStripeModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Google Ads') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setGoogleAdsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Firebase') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setFirebaseModalOpen(true), 0);
      return;
    }
    if (connector.name === 'PostgreSQL') {
      setDropdownOpen(false);
      setTimeout(() => useChatStore.getState().setWarehouseModalOpen(true), 0);
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

  const [projectsOpen, setProjectsOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  useEffect(() => {
    const openProjects = () => setProjectsOpen(true);
    window.addEventListener('open-projects', openProjects as EventListener);
    return () => window.removeEventListener('open-projects', openProjects as EventListener);
  }, []);

  // Refresh projects list when sidebar opens
  useEffect(() => {
    if (projectsOpen && isSignedIn) {
      console.log('Sidebar opened - refreshing projects...');
      // Projects are auto-refreshed by the hook
    }
  }, [projectsOpen, isSignedIn]);

  // sidebar show/animation is handled inside ProjectsSidebar component

  const closeProjects = () => {
    setProjectsOpen(false);
    window.dispatchEvent(new Event('close-projects'));
  };

  // Allow page to scroll even when sidebar is open (no body lock)
  const guestCtaText = "Log in";
  const handleGuestCtaClick = () => {
    navigate("/login");
  };

  return (
    <div className="min-h-screen overflow-y-auto homepage-scrollbar">
      {/* Fixed background: Video for light, Wave for dark */}
      {resolvedTheme === 'dark' ? (
        <WaveBackground className="fixed inset-0 z-0" />
      ) : (
        <VideoBackground className="fixed inset-0 z-0" />
      )}

      {/* Fixed overlay for better text readability */}
      <div className={`fixed inset-0 z-[1] ${resolvedTheme === 'dark' ? 'bg-black/60' : 'bg-white/20'}`}></div>

      <section className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden pt-44">

        <div className="relative z-10 max-w-6xl mx-auto text-center">

          {/* New 2-row heading layout */}
          <div className="text-center mb-8 animate-slide-up">
            {/* Row 1: The AI Data Visualization with gradient styling */}
            <h1 className="text-5xl md:text-7xl font-bold mb-6 font-instrument-serif">
              <span className="px-2 py-1 text-transparent bg-clip-text bg-gradient-to-r dark:from-accent dark:via-white dark:to-accent from-primary via-accent to-primary italic">
                AI-native Data Visualization
              </span>
            </h1>

            {/* Row 2: Logo + Build Fancy Dashboard in minutes */}
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <h2 className="text-xl lg:text-3xl text-foreground dark:text-white font-inter">
                Create unified dashboards for your{' '}
                <span
                  className="inline-flex items-center rounded-lg px-3 py-1 button-outline"
                >
                  <span
                    className="text-transparent bg-clip-text font-bold font-instrument-serif italic"
                    style={{ backgroundImage: rotatingWords[rotatingIndex].gradient }}
                  >
                    {displayedText || '\u00A0'}
                  </span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '2px',
                      height: '0.75em',
                      backgroundColor: rotatingWords[rotatingIndex].cursorColor,
                      marginLeft: '1px',
                      verticalAlign: 'middle',
                      animation: 'blink-cursor 0.7s step-end infinite',
                    }}
                  />
                </span>
                {' '}in 1 min
              </h2>
            </div>
          </div>

          {/* Chat-First Interface */}
          <div className="max-w-sm sm:max-w-md md:max-w-2xl lg:max-w-4xl mx-auto mb-12 animate-fade-in" style={{ animationDelay: '0s' }}>
            {/* Main Chat Input */}
            <div
              className="w-full min-h-[80px] text-md p-3 sm:p-4 glass-panel border border-border rounded-3xl resize-none transition-all duration-300 relative"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPasteCapture={handlePaste}
            >
              {/* Drag Overlay */}
              {isDragging && (
                <div className={`absolute inset-0 rounded-3xl border-2 border-dashed border-foreground dark:border-white flex flex-col items-center justify-center z-10 pointer-events-none ${dragOver ? 'bg-foreground/5 dark:bg-white/10' : ''}`}>
                  <FileText className="w-10 h-10 text-foreground dark:text-white mb-3" />
                  <span className="text-base text-foreground dark:text-white font-medium">Drop file here to upload</span>
                </div>
              )}

              {/* Selection Chips Area - vertical scroll for files and themes */}
              {(uploadedFiles.some(file => file.status !== 'processed' && file.status !== 'error') || (selectedTemplate && isTemplatePending)) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {/* Theme Selection Pill */}
                  {selectedTemplate && isTemplatePending && (
                    <ThemeInlineToken
                      theme={selectedTemplate}
                      variant="composer"
                      onRemove={handleTemplateRemove}
                      className="animate-in fade-in slide-in-from-left-2 duration-300"
                    />
                  )}

                  {/* File Chips */}
                  {uploadedFiles.map((file) => (
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
              <div className="relative mb-4">
                <TextareaAutosize
                  minRows={3}
                  maxRows={10}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={isListening ? 'Listening...' : placeholders[placeholderIndex]}
                  className="w-full bg-transparent border-none outline-none resize-none text-md text-foreground dark:text-white placeholder:text-muted-foreground/80 dark:placeholder:text-white/60"
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {/* Left side buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Hidden file input */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".csv,.xlsx,.xls"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    aria-label="Select file"
                  />

                  {/* File attach dropdown */}
                  <FileAttachDropdown
                    onUpload={handleAttachClick}
                    disabled={uploadState.isUploading}
                    cloneToProject
                  />

                  <button
                    onClick={handleCloneTemplateClick}
                    className="px-3 py-1.5 text-sm button-outline rounded-md flex items-center gap-2"
                    onMouseEnter={(e) => {
                      e.currentTarget.classList.add('btn-primary-hover');
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.classList.remove('btn-primary-hover');
                    }}
                    aria-label="Choose theme"
                  >
                    <LayoutTemplate className="w-4 h-4" />
                    <span className="hidden sm:inline">Theme</span>
                  </button>

                  {/* Connect Data Source Dropdown */}
                  <div className="relative data-source-dropdown">
                    <Button
                      onClick={() => {
                        const newState = !dropdownOpen;
                        setDropdownOpen(newState);
                        if (newState) {
                          setModelDropdownOpen(false);
                        }
                      }}
                      className={`rounded-md transition-all duration-200 px-4 py-1.5 text-sm flex items-center gap-2 h-auto ${selectedDataSource
                        ? `${getDataSourceColors(selectedDataSource).bg} ${getDataSourceColors(selectedDataSource).border} ${getDataSourceColors(selectedDataSource).text} ${getDataSourceColors(selectedDataSource).hover} border`
                        : 'button-gradient'
                        }`}
                      aria-expanded={dropdownOpen}
                      aria-haspopup="true"
                      aria-label="Connect data source"
                    >
                      <span className="hidden sm:inline">{selectedDataSource || "Connect data source"}</span>
                      <Link className={`w-4 h-4 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''
                        }`} />
                    </Button>

                    {dropdownOpen && (
                      <div className="absolute bottom-full left-0 mb-1 bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-2xl z-10 p-2 w-52">
                        <p className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Popular</p>

                        {/* Active connectors */}
                        {CONNECTORS.filter(c => ['GA4', 'Google Ads', 'Firebase', 'Google Sheets'].includes(c.name)).map(con => (
                          <button
                            key={con.name}
                            onClick={() => handleIntegrationClick(con)}
                            className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-muted rounded-md transition-colors cursor-pointer"
                          >
                            <img src={con.icon} alt={con.name} className="w-4 h-4 object-contain flex-shrink-0" />
                            <span className="text-foreground/90">{con.name}</span>
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
                            className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-muted rounded-md transition-colors cursor-pointer"
                          >
                            <img src={con.icon} alt={con.name} className="w-4 h-4 object-contain flex-shrink-0 opacity-50" />
                            <span className="text-muted-foreground">{con.name}</span>
                            <span className="ml-auto text-[9px] text-muted-foreground/60">SOON</span>
                          </button>
                        ))}

                        <div className="border-t border-border mt-1.5 pt-1.5">
                          <button
                            onClick={() => { setDropdownOpen(false); navigate('/workspace?tab=connectors'); }}
                            className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md hover:bg-muted transition-colors"
                          >
                            Browse all connectors
                            <ChevronRight className="w-3 h-3 ml-auto" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                </div>

                {/* Right side buttons */}
                <div className="flex items-center gap-2">
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
                      }
                    }}
                    anchor="right"
                    placement="bottom"
                    variant="classic"
                  />

                  <Button
                    onClick={handleChatSubmit}
                    disabled={!inputValue.trim() || isProcessing || uploadedFiles.some(f => f.status === 'uploading')}
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
              <p className="text-xs text-muted-foreground/70 dark:text-white/40 text-left ml-1">Quick start prompts:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  { icon: TrendingUp, text: "Visualize key trends over time in an interactive dashboard." },
                  { icon: AlertCircle, text: "Spot anomalies and outliers directly in your dashboard." },
                  { icon: FileText, text: "Generate a dashboard of my most important metrics." },
                  { icon: LayoutDashboard, text: "Build a comprehensive dashboard from all your connected data." }
                ].map((item, index) => (
                  <button
                    key={index}
                    onClick={() => setInputValue(item.text)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-background/80 dark:bg-white/5 border border-border/60 dark:border-white/10 hover:bg-background dark:hover:bg-white/10 hover:border-border dark:hover:border-white/20 transition-all cursor-pointer group text-left"
                  >
                    <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20 text-primary group-hover:bg-primary/20 dark:group-hover:bg-primary/30 transition-colors">
                      <item.icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs sm:text-sm text-foreground/80 dark:text-white/70 group-hover:text-foreground dark:group-hover:text-white transition-colors line-clamp-2">
                      {item.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* Sentinel marks the end of the hero section for header trigger */}
        <div id="hero-sentinel" aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-px pointer-events-none" />
      </section>

      {!isSignedIn && (
        <main className="relative z-10">
          <div className="relative z-10">
            <MissionSection
              ctaText={guestCtaText}
              ctaLink="/login"
              className="min-h-[50vh]"
            />
          </div>
          <div className="relative z-10">
            <ProblemSection />
          </div>
          <div className="relative z-10">
            <FeaturesSection />
          </div>
          <div className="relative z-10">
            <CTAContainerSection ctaText={guestCtaText} onCtaClick={handleGuestCtaClick} />
          </div>
        </main>
      )}

      {/* Removed floating button here; header provides the button when signed in */}

      {/* Projects sidebar */}
      <ProjectsSidebar
        open={projectsOpen}
        onClose={closeProjects}
        isLoading={projectsLoading}
        onNewProject={() => navigate('/workspace?tab=new-chat')}
        recents={projects}
        onOpenProject={openProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
      />
      <TemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onTemplateSelect={handleTemplateSelect}
        initialSelection={selectedTemplate}
      />
      <FeedbackFloatingButton />
      <FooterSection />
      {/* Waitlist modal for signed-out users */}
      {/* <Dialog open={waitlistOpen} onOpenChange={setWaitlistOpen}>
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
      </Dialog> */}

      {/* Login modal for signed-out users */}
      <Dialog open={waitlistOpen} onOpenChange={setWaitlistOpen}>
        <DialogContent className="bg-muted border border-border rounded-xl sm:rounded-2xl p-5 sm:p-6 w-full max-w-[92vw] sm:max-w-xl">
          <DialogTitle className="text-2xl md:text-3xl font-semibold text-white">Login to Dreamify</DialogTitle>
          <DialogDescription className="text-white/70 mt-1 text-sm md:text-base">
            Please login to access all features and start building your dashboards.
          </DialogDescription>
          <div className="mt-6 flex items-center gap-4">
            <img src="/logo-watermark.png" alt="Dreamify" className="w-16 h-16 rounded-lg object-contain bg-transparent" />
            <div className="ml-auto">
              <Button
                onClick={() => { setWaitlistOpen(false); navigate('/login'); }}
                className="button-gradient px-5 py-2 rounded-xl flex items-center gap-2"
              >
                Login
                <LogIn className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default HomePage;
