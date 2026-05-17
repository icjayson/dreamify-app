import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import {
  CornerRightUp,
  LayoutTemplate,
  Link,
  FileText,
  TrendingUp,
  AlertCircle,
  LayoutDashboard,
} from "lucide-react";
import FileAttachDropdown from "@/components/chat/FileAttachDropdown";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import RecordingBar from "@/components/ui/recording-bar";
import { useChatStore } from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import { fileService, type UploadResponse } from "@/services/fileService";
import { useSubscription } from "@/hooks/useSubscription";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import FilePreviewChip from "@/components/chat/FilePreviewChip";
import { ThemeInlineToken } from "@/components/chat/ThemeInlineToken";
import ModelSelector from "@/chat/ModelSelector";
import TemplateModal from "@/components/homepage-section/TemplateModal";
import type { ThemeSelection } from "@/constants/builtinTemplates";
import { CONNECTORS } from "@/constants/connectors";
import { type ConnectorItem } from "@/constants/connectors";
import { getFilesFromClipboardData } from "@/lib/clipboardFiles";
import { ChevronRight } from "lucide-react";

export default function WorkspaceNewChat() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const userName = user?.firstName || user?.fullName?.split(" ")[0] || "there";
  const { toast } = useToast();
  const { creditsRemaining } = useSubscription();
  const tierLimit = 1000;

  // ── Rolling suffix text (only the part after "Hi {name}, ") ─────────────────
  const rollingSuffixes = [
  "what do we analyse today?",
  "ready to uncover insights?",
  "let's turn data into dashboard",
  "what story does your data tell?",
  ];
  const [suffixIndex, setSuffixIndex] = useState(0);
  const [suffixVisible, setSuffixVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setSuffixVisible(false);
      setTimeout(() => {
        setSuffixIndex((prev) => (prev + 1) % rollingSuffixes.length);
        setSuffixVisible(true);
      }, 350);
    }, 1500);
    return () => clearInterval(interval);
  }, [rollingSuffixes.length]);

  // ── Chat store ──────────────────────────────────────────────────────────────
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
    resetChat,
    selectedModel,
    setSelectedModel,
  } = useChatStore();

  // ── File store ──────────────────────────────────────────────────────────────
  const { uploadState, validateClientFile } = useFileStore();
  const { uploadState: legacyUploadState } = useFileUpload();

  // ── Local state ─────────────────────────────────────────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const placeholders = [
    "Tell me about your data or describe the dashboard you want...",
    "Upload your CSV and I'll suggest visualizations...",
    "Connect Stripe data and create a revenue dashboard...",
    "Show me customer acquisition trends with animated charts...",
  ];

  // ── On mount: reset chat, then restore any files queued from the Files tab ──
  useEffect(() => {
    const pending = useChatStore.getState().pendingFilesForNewChat;
    resetChat();
    useFileStore.getState().resetFileState();
    if (pending.length > 0) {
      useChatStore.getState().addFiles(pending);
      useChatStore.getState().setPendingFilesForNewChat([]);
    }
  }, [resetChat]);

  // ── Rotate placeholder ──────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // ── Auto-open theme modal from query flag ───────────────────────────────────
  useEffect(() => {
    if (searchParams.get("openTemplate") !== "1") return;
    try {
      const storedTheme = sessionStorage.getItem("dreamify:selected_theme");
      if (storedTheme) {
        setSelectedTemplate(JSON.parse(storedTheme) as ThemeSelection);
        sessionStorage.removeItem("dreamify:selected_theme");
      }
    } catch { /* ignore malformed session payloads */ }
    setTemplateModalOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("openTemplate");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  // ── Close dropdowns on outside click ────────────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (dropdownOpen && !target.closest(".data-source-dropdown")) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [dropdownOpen, setDropdownOpen]);

  // ── Document-level drag detection ───────────────────────────────────────────
  useEffect(() => {
    let dragCounter = 0;
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer?.types.includes("Files")) setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) { setIsDragging(false); setDragOver(false); }
    };
    const handleDragEnd = () => {
      dragCounter = 0; setIsDragging(false); setDragOver(false);
    };
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragend", handleDragEnd);
    document.addEventListener("drop", handleDragEnd);
    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragend", handleDragEnd);
      document.removeEventListener("drop", handleDragEnd);
    };
  }, []);

  // ── Speech recognition ───────────────────────────────────────────────────────
  const {
    isListening: speechIsListening,
    detectedLanguage: speechDetectedLanguage,
    startListening,
    stopListening,
    resetTranscript,
    abortRecording,
    completeRecording,
    isSupported: speechSupported,
  } = useSpeechRecognition({
    onResult: (result) => {
      setInputValue(inputValue + (inputValue ? " " : "") + result);
      resetTranscript();
    },
    onError: (error) => {
      toast({ title: "Speech Recognition Error", description: error, variant: "destructive" });
    },
    continuous: true,
  });

  useEffect(() => { setIsListening(speechIsListening); }, [speechIsListening, setIsListening]);
  useEffect(() => { setDetectedLanguage(speechDetectedLanguage); }, [speechDetectedLanguage, setDetectedLanguage]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleChatSubmit = async () => {
    if (!inputValue.trim()) return;
    if (uploadedFiles.some((f) => f.status === "uploading")) {
      toast({ title: "Upload in progress", description: "Please wait for the file to finish uploading.", variant: "destructive" });
      return;
    }
    if (uploadedFiles.length === 0 || !uploadedFiles.some((f) => ["uploaded", "processed", "accepted"].includes(f.status))) {
      toast({ title: "Upload required", description: "Upload at least one file before asking a question.", variant: "destructive" });
      return;
    }
    const firstUploadedFile = uploadedFiles.find((f) => ["uploaded", "processed", "accepted"].includes(f.status));
    if (!firstUploadedFile?.projectId) {
      toast({ title: "Project error", description: "No project context found. Please try uploading again.", variant: "destructive" });
      return;
    }
    useChatStore.getState().setPendingAction({
      type: "process_file",
      content: inputValue.trim(),
      files: uploadedFiles,
      projectId: firstUploadedFile.projectId,
      model: selectedModel,
    });
    navigate(`/workspace/project?projectId=${firstUploadedFile.projectId}`);
  };

  // ── File upload helpers ──────────────────────────────────────────────────────
  const processFileUpload = async (file: File, projectIdOverride?: string): Promise<string | undefined> => {
    if (!isSignedIn) {
      toast({
        title: "Authentication Required",
        description: "Please login to upload files.",
        variant: "destructive",
        action: (
          <ToastAction altText="Login" onClick={() => navigate("/login")} className="button-outline">
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
        ext: (file.name.split(".").pop() || "").toLowerCase(),
        status: "uploading" as const,
        uploadProgress: 0,
      };
      if (uploadedFiles.length >= 5) {
        toast({ title: "Maximum files reached", description: "You can only upload up to 5 files at a time.", variant: "destructive" });
        return undefined;
      }
      addFiles([newFile]);
      const res: UploadResponse = await fileService.uploadFile(file, {
        projectId: projectIdOverride,
        onProgress: (percent) => updateFile(tempId, { uploadProgress: Math.min(percent, 95) }),
      });
      if (!res.success || !res.fileID || !res.ext || res.size === undefined || !res.filename) {
        removeFile(tempId);
        addFiles([{ ...newFile, status: "error", uploadProgress: undefined }]);
        toast({ title: "Upload failed", description: res.error || "Upload failed", variant: "destructive" });
        return undefined;
      }
      removeFile(tempId);
      const uploadedProjectId = res.asset?.project_id || projectIdOverride;
      addFiles([{
        fileID: res.fileID,
        filename: res.filename ?? file.name,
        size: res.size ?? file.size,
        ext: res.ext || (file.name.split(".").pop() || "").toLowerCase(),
        status: "uploaded",
        projectId: uploadedProjectId,
      }]);
      toast({ title: "File uploaded", description: `${res.filename} uploaded successfully. You can now ask questions about your data.` });
      return uploadedProjectId;
    } catch (_e) {
      removeFile(tempId);
      addFiles([{ fileID: "error", filename: file.name, size: file.size, ext: (file.name.split(".").pop() || "").toLowerCase(), status: "error" }]);
      toast({ title: "Upload error", description: "Failed to upload file. Please try again.", variant: "destructive" });
      return undefined;
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const remainingSlots = 5 - uploadedFiles.length;
    if (files.length > remainingSlots) {
      toast({ title: "Too many files", description: `Maximum 5 files allowed. You can add ${remainingSlots} more file(s).`, variant: "destructive" });
      event.target.value = "";
      return;
    }
    let batchProjectId = uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }
    event.target.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    const remainingSlots = 5 - uploadedFiles.length;
    if (files.length > remainingSlots) {
      toast({ title: "Too many files", description: `Maximum 5 files allowed. You can add ${remainingSlots} more file(s).`, variant: "destructive" });
      return;
    }
    let batchProjectId = uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = getFilesFromClipboardData(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const remainingSlots = 5 - uploadedFiles.length;
    if (files.length > remainingSlots) {
      toast({ title: "Too many files", description: `Maximum 5 files allowed. You can add ${remainingSlots} more file(s).`, variant: "destructive" });
      return;
    }
    let batchProjectId = uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }
  };

  const removeUploadedFile = async (fileID: string) => {
    const file = uploadedFiles.find((f) => f.fileID === fileID);
    if (file && !file.isFromMention) {
      try { await fileService.deleteFile(fileID); } catch (_e) { /* best-effort */ }
    }
    removeFile(fileID);
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleAttachClick = () => fileInputRef.current?.click();

  const handleTemplateSelect = (template: ThemeSelection) => {
    setSelectedTemplate(template);
    setInputValue(`Use ${template.title} theme to make `);
  };

  const handleTemplateRemove = () => {
    setSelectedTemplate(null);
    setInputValue("");
  };

  const handleIntegrationClick = (connector: ConnectorItem) => {
    if (connector.name === "GA4") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setGA4ModalOpen(true), 0); return; }
    if (connector.name === "Google Sheets") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setGoogleSheetsModalOpen(true), 0); return; }
    if (connector.name === "Meta Ads") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setMetaAdsModalOpen(true), 0); return; }
    if (connector.name === "TikTok Ads") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setTikTokModalOpen(true), 0); return; }
    if (connector.name === "AppsFlyer") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setAppsFlyerModalOpen(true), 0); return; }
    if (connector.name === "Stripe") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setStripeModalOpen(true), 0); return; }
    if (connector.name === "Google Ads") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setGoogleAdsModalOpen(true), 0); return; }
    if (connector.name === "Firebase") { setDropdownOpen(false); setTimeout(() => useChatStore.getState().setFirebaseModalOpen(true), 0); return; }
    if (connector.isActive) {
      setSelectedDataSource(connector.name);
      setDropdownOpen(false);
    } else {
      toast({ title: connector.name, description: "Integration is coming soon!" });
    }
  };

  const handleRecordingCancel = () => abortRecording();
  const handleRecordingConfirm = () => { completeRecording(); resetTranscript(); };

  // ── Data source colors ───────────────────────────────────────────────────────
  const getDataSourceColors = (sourceName: string) => {
    const colors: Record<string, { bg: string; border: string; text: string; hover: string }> = {
      "Google Sheets": { bg: "bg-green-500", border: "border-green-400", text: "text-white", hover: "hover:bg-green-600" },
      GA4: { bg: "bg-orange-500", border: "border-orange-400", text: "text-white", hover: "hover:bg-orange-600" },
      "Meta Ads": { bg: "bg-blue-600", border: "border-blue-500", text: "text-white", hover: "hover:bg-blue-700" },
      "TikTok Ads": { bg: "bg-zinc-900", border: "border-zinc-800", text: "text-white", hover: "hover:bg-black" },
      Stripe: { bg: "bg-purple-600", border: "border-purple-500", text: "text-white", hover: "hover:bg-purple-700" },
    };
    return colors[sourceName] || { bg: "bg-primary", border: "border-primary", text: "text-white", hover: "hover:bg-primary/90" };
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full py-12 px-4">
      {/* Shared max-width container — heading + chat input share the same bounds */}
      <div className="w-full max-w-sm sm:max-w-md md:max-w-2xl lg:max-w-4xl mx-auto">

        {/* Heading */}
        <div className="mb-8 animate-slide-up">
          {/* Logo watermark */}
          <div className="flex justify-start mb-4">
            <img
              src="/logo-watermark.png"
              alt="Dreamify"
              className="w-16 h-16 object-contain"
            />
          </div>

          {/* Heading text — static prefix + rolling suffix */}
          <h1 className="text-3xl md:text-5xl font-bold font-instrument-serif flex flex-wrap items-baseline justify-start gap-x-0">
            {/* Static part */}
            <span className="px-2 py-1 text-transparent bg-clip-text bg-gradient-to-r dark:from-accent dark:via-white dark:to-accent from-primary via-accent to-primary italic whitespace-nowrap">
              Hi {userName},
            </span>
            {/* Rolling part */}
            <span
              className="px-2 py-1 text-transparent bg-clip-text bg-gradient-to-r dark:from-accent dark:via-white dark:to-accent from-primary via-accent to-primary italic inline-block"
              style={{
                opacity: suffixVisible ? 1 : 0,
                transform: suffixVisible ? "translateY(0)" : "translateY(8px)",
                transition: "opacity 0.35s ease, transform 0.35s ease",
              }}
            >
              {rollingSuffixes[suffixIndex]}
            </span>
          </h1>
        </div>

        {/* Chat Input */}
        <div className="w-full animate-fade-in">
        <div
          className="w-full min-h-[80px] text-md p-3 sm:p-4 glass-panel border border-border rounded-3xl resize-none transition-all duration-300 relative"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); if (e.currentTarget === e.target) setDragOver(false); }}
          onDrop={handleDrop}
          onPasteCapture={handlePaste}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className={`absolute inset-0 rounded-3xl border-2 border-dashed border-foreground dark:border-white flex flex-col items-center justify-center z-10 pointer-events-none ${dragOver ? "bg-foreground/5 dark:bg-white/10" : ""}`}>
              <FileText className="w-10 h-10 text-foreground dark:text-white mb-3" />
              <span className="text-base text-foreground dark:text-white font-medium">Drop file here to upload</span>
            </div>
          )}

          {/* File chips + theme chip */}
          {(uploadedFiles.some(file => file.status !== "processed" && file.status !== "error") || (selectedTemplate && isTemplatePending)) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {selectedTemplate && isTemplatePending && (
                <ThemeInlineToken
                  theme={selectedTemplate}
                  variant="composer"
                  onRemove={handleTemplateRemove}
                  className="animate-in fade-in slide-in-from-left-2 duration-300"
                />
              )}
              {uploadedFiles.map((file) => (
                <div key={file.fileID} className="flex-shrink-0">
                  <FilePreviewChip file={file} onRemove={() => removeUploadedFile(file.fileID)} />
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <div className="relative mb-4">
            <TextareaAutosize
              minRows={3}
              maxRows={10}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={isListening ? "Listening..." : placeholders[placeholderIndex]}
              className="w-full bg-transparent border-none outline-none resize-none text-md text-foreground dark:text-white placeholder:text-muted-foreground/80 dark:placeholder:text-white/60"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSubmit(); }
              }}
              autoFocus
            />
          </div>

          {/* Recording bar */}
          <RecordingBar
            isVisible={isListening}
            detectedLanguage={detectedLanguage}
            onCancel={handleRecordingCancel}
            onConfirm={handleRecordingConfirm}
          />

          {/* Buttons row */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Left buttons */}
            <div className="flex items-center gap-2 flex-wrap">
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

              {/* Theme */}
              <button
                onClick={() => setTemplateModalOpen(true)}
                className="px-3 py-1.5 text-sm button-outline rounded-md flex items-center gap-2"
                aria-label="Choose theme"
              >
                <LayoutTemplate className="w-4 h-4" />
                <span className="hidden sm:inline">Theme</span>
              </button>

              {/* Connect data source */}
              <div className="relative data-source-dropdown">
                <Button
                  onClick={() => {
                    const newState = !dropdownOpen;
                    setDropdownOpen(newState);
                    if (newState) setModelDropdownOpen(false);
                  }}
                  className={`rounded-md transition-all duration-200 px-4 py-1.5 text-sm flex items-center gap-2 h-auto ${
                    selectedDataSource
                      ? `${getDataSourceColors(selectedDataSource).bg} ${getDataSourceColors(selectedDataSource).border} ${getDataSourceColors(selectedDataSource).text} ${getDataSourceColors(selectedDataSource).hover} border`
                      : "button-gradient"
                  }`}
                  aria-expanded={dropdownOpen}
                  aria-haspopup="true"
                  aria-label="Connect data source"
                >
                  <span className="hidden sm:inline">{selectedDataSource || "Connect data source"}</span>
                  <Link className={`w-4 h-4 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
                </Button>

                {dropdownOpen && (
                  <div className="absolute bottom-full left-0 mb-1 bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-2xl z-10 p-2 w-52">
                    <p className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Popular</p>
                    {CONNECTORS.filter((c) => ["GA4", "Google Ads", "Firebase", "Google Sheets"].includes(c.name)).map((con) => (
                      <button
                        key={con.name}
                        onClick={() => handleIntegrationClick(con)}
                        className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-muted rounded-md transition-colors cursor-pointer"
                      >
                        <img src={con.icon} alt={con.name} className="w-4 h-4 object-contain flex-shrink-0" />
                        <span className="text-foreground/90">{con.name}</span>
                      </button>
                    ))}
                    {([
                      { name: "Meta Ads", icon: "/meta.png", category: "Advertising Platform" as const },
                      { name: "TikTok Ads", icon: "/tiktok.png", category: "Advertising Platform" as const },
                    ] as const).map((con) => (
                      <button
                        key={con.name}
                        onClick={() => handleIntegrationClick(con as ConnectorItem)}
                        className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-muted rounded-md transition-colors cursor-pointer"
                      >
                        <img src={con.icon} alt={con.name} className="w-4 h-4 object-contain flex-shrink-0 opacity-50" />
                        <span className="text-muted-foreground">{con.name}</span>
                        <span className="ml-auto text-[9px] text-muted-foreground/60">SOON</span>
                      </button>
                    ))}
                    <div className="border-t border-border mt-1.5 pt-1.5">
                      <button
                        onClick={() => { setDropdownOpen(false); navigate("/workspace?tab=connectors"); }}
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

            {/* Right buttons */}
            <div className="flex items-center gap-2">
              <ModelSelector
                selectedModel={selectedModel}
                onSelect={(model) => { setSelectedModel(model); setModelDropdownOpen(false); }}
                creditsRemaining={creditsRemaining}
                creditsMonthlyLimit={tierLimit}
                isOpen={modelDropdownOpen}
                onToggle={() => {
                  const newState = !modelDropdownOpen;
                  setModelDropdownOpen(newState);
                  if (newState) setDropdownOpen(false);
                }}
                anchor="right"
                placement="bottom"
                variant="classic"
              />

              <Button
                onClick={handleChatSubmit}
                disabled={!inputValue.trim() || isProcessing || uploadedFiles.some((f) => f.status === "uploading")}
                className="button-gradient p-3 disabled:opacity-50"
              >
                {isProcessing ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="text-sm">Processing...</span>
                  </div>
                ) : (
                  <CornerRightUp className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Quick start prompts */}
        <div className="flex flex-col gap-2 mt-4 sm:mt-6 animate-fade-in w-full">
          <p className="text-xs text-muted-foreground/70 dark:text-white/40 text-left ml-1">Quick start prompts:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              { icon: TrendingUp, text: "Visualize key trends over time in an interactive dashboard." },
              { icon: AlertCircle, text: "Spot anomalies and outliers directly in your dashboard." },
              { icon: FileText, text: "Generate a dashboard of my most important metrics." },
              { icon: LayoutDashboard, text: "Build a comprehensive dashboard from all your connected data." },
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
        </div>{/* end chat wrapper */}
      </div>{/* end shared max-width container */}

      {/* Template Modal */}
      <TemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onTemplateSelect={handleTemplateSelect}
        initialSelection={selectedTemplate}
      />
    </div>
  );
}
