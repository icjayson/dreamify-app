import { create } from 'zustand';
import { Message } from '@/types/message';
import { conversationNodesToMessages } from '@/chat/conversationToMessages';
import { processingService } from '@/services/processingService';
import { ConversationChatRequest } from '@/services/conversationService';

// Theme detection function (keyword-based only)
const detectThemeChange = (message: string): 'light' | 'dark' | null => {
  const lowerMessage = message.toLowerCase();
  const themeKeywords = ['dark', 'theme', 'modify', 'change', 'switch'];
  const hasThemeKeywords = themeKeywords.some(keyword => lowerMessage.includes(keyword));
  if (!hasThemeKeywords) return null;
  if (lowerMessage.includes('dark')) return 'dark';
  return 'dark';
};

// Helper function for AI response generation - simplified without Ollama
const generateAIResponse = async (
  userPrompt: string,
  processedData: any,
  messagesSnapshot: Message[],
  updateMessages: (updater: (prev: Message[]) => Message[]) => void,
  uploadedFileName?: string
) => {
  console.log('generateAIResponse called with:', { userPrompt, hasProcessedData: !!processedData, messageCount: messagesSnapshot.length });

  // Check if there's already an assistant message for this specific user prompt to avoid duplicates
  const lastMessage = messagesSnapshot[messagesSnapshot.length - 1];
  const hasRecentAssistantMessage = lastMessage && lastMessage.role === 'assistant' && lastMessage.content.trim() !== '';
  if (hasRecentAssistantMessage) {
    console.log('Last message is already an assistant message, skipping AI response generation');
    return;
  }

  console.log('Proceeding with AI response generation...');

  // Always return success message
  const getContextualResponse = (input: string): string => {
    return "";
  };

  try {
    const response = getContextualResponse(userPrompt);

    // Add success message
    const aiMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: response,
      timestamp: new Date(),
    };

    updateMessages((prev) => [...prev, aiMessage]);
  } catch (_error) {
    const aiMessage: Message = {
      id: (Date.now() + 3).toString(),
      role: "assistant",
      content: "I'm here to help you create beautiful dashboards! Please let me know what you'd like to visualize.",
      timestamp: new Date(),
    };
    updateMessages((prev) => [...prev, aiMessage]);
  }
};

export interface UploadedFile {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error' | 'accepted';
  projectId?: string;
  conversationId?: string;
  processedData?: any;
  rowCount?: number;
  columnCount?: number;
  /** True if file was selected from @mention dropdown (already exists in conversation) */
  isFromMention?: boolean;
}

interface ChatState {
  // Input state
  inputValue: string;
  isTyping: boolean;

  // Messages state
  messages: Message[];

  // File state
  uploadedFiles: UploadedFile[];
  currentConversationId: string | null;

  // Processing state
  isProcessing: boolean;
  currentWorkflowStep: string | null;

  // UI state
  dropdownOpen: boolean;
  selectedDataSource: string;

  // Speech recognition state
  isListening: boolean;
  transcript: string;
  detectedLanguage: string | null;

  // Theme state
  dashboardTheme: 'light' | 'dark';
  isThemeChanging: boolean;
  hasShownInitialDashboard: boolean;
  isInitialLoading: boolean;

  // Dashboard selection state
  selectedDashboardId: string | null;

  // Original file for exports
  originalFileBlob?: Blob | null;
  originalFileName?: string | null;

  // Template state
  selectedTemplate: { id: string; title: string; description: string; image: string; category: string } | null;

  // Abort controller for stopping generation
  abortController: AbortController | null;

  // Actions
  setInputValue: (value: string) => void;
  setIsTyping: (typing: boolean) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  addFiles: (files: UploadedFile[]) => void;
  removeFile: (fileId: string) => void;
  clearFiles: () => void;
  updateFile: (fileId: string, updates: Partial<UploadedFile>) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDropdownOpen: (open: boolean) => void;
  setSelectedDataSource: (source: string) => void;
  setIsListening: (listening: boolean) => void;
  setTranscript: (transcript: string) => void;
  setDetectedLanguage: (language: string | null) => void;
  setIsProcessing: (processing: boolean) => void;
  setCurrentWorkflowStep: (step: string | null) => void;
  updateMessages: (updater: (prev: Message[]) => Message[]) => void;
  setDashboardTheme: (theme: 'light' | 'dark') => void;
  setIsThemeChanging: (changing: boolean) => void;
  setHasShownInitialDashboard: (flag: boolean) => void;
  setIsInitialLoading: (flag: boolean) => void;
  setSelectedDashboardId: (dashboardId: string | null) => void;
  setOriginalFile: (file: { blob: Blob; name: string } | null) => void;
  setSelectedTemplate: (template: { id: string; title: string; description: string; image: string; category: string } | null) => void;

  // Complex actions
  sendMessage: (content: string) => void;
  clearInput: () => void;
  resetChat: () => void;
  processFileWithMessage: (content: string, onProcessedDataChange?: (data: any) => void, projectId?: string, mentionedAssetIds?: string[]) => Promise<void>;
  stopGeneration: () => Promise<void>;
  selectDashboard: (dashboardId: string, projectId: string) => Promise<void>;
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hi! I'm Morpheus, your analytics intern. Upload data, visualise motion-rich dashboard in seconds!",
    timestamp: new Date()
  }
];

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  inputValue: "",
  isTyping: false,
  messages: initialMessages,
  uploadedFiles: [],
  currentConversationId: null,
  isProcessing: false,
  currentWorkflowStep: null,
  dropdownOpen: false,
  selectedDataSource: "",
  isListening: false,
  transcript: "",
  detectedLanguage: null,
  dashboardTheme: 'light',
  isThemeChanging: false,
  hasShownInitialDashboard: false,
  isInitialLoading: false,
  selectedDashboardId: null,
  originalFileBlob: null,
  originalFileName: null,
  selectedTemplate: null,
  abortController: null,

  // Basic setters
  setInputValue: (value) => set({ inputValue: value }),
  setIsTyping: (typing) => set({ isTyping: typing }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  addFiles: (files) => set((state) => {
    const currentLength = state.uploadedFiles.length;
    const newLength = currentLength + files.length;
    if (newLength > 5) {
      console.warn('Maximum 5 files allowed');
      return state;
    }
    const existingIds = new Set(state.uploadedFiles.map(f => f.fileID));
    const uniqueFiles = files.filter(f => !existingIds.has(f.fileID));
    return {
      uploadedFiles: [...state.uploadedFiles, ...uniqueFiles]
    };
  }),
  removeFile: (fileId) => set((state) => ({
    uploadedFiles: state.uploadedFiles.filter(f => f.fileID !== fileId)
  })),
  clearFiles: () => set({ uploadedFiles: [] }),
  updateFile: (fileId, updates) => set((state) => ({
    uploadedFiles: state.uploadedFiles.map(f => f.fileID === fileId ? { ...f, ...updates } : f)
  })),
  setCurrentConversationId: (conversationId) => set({ currentConversationId: conversationId }),
  setDropdownOpen: (open) => set({ dropdownOpen: open }),
  setSelectedDataSource: (source) => set({ selectedDataSource: source }),
  setIsListening: (listening) => set({ isListening: listening }),
  setTranscript: (transcript) => set({ transcript }),
  setDetectedLanguage: (language) => set({ detectedLanguage: language }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setCurrentWorkflowStep: (step) => set({ currentWorkflowStep: step }),
  updateMessages: (updater) => set((state) => ({ messages: updater(state.messages) })),
  setDashboardTheme: (theme) => set({ dashboardTheme: theme }),
  setIsThemeChanging: (changing) => set({ isThemeChanging: changing }),
  setHasShownInitialDashboard: (flag) => set({ hasShownInitialDashboard: flag }),
  setIsInitialLoading: (flag) => set({ isInitialLoading: flag }),
  setSelectedDashboardId: (dashboardId) => set({ selectedDashboardId: dashboardId }),
  setOriginalFile: (file) => set({ originalFileBlob: file?.blob ?? null, originalFileName: file?.name ?? null }),
  setSelectedTemplate: (template) => set({ selectedTemplate: template }),

  // Complex actions
  sendMessage: (content) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
      attachment: get().uploadedFiles.length > 0 ? {
        kind: "csv",
        name: get().uploadedFiles.length === 1
          ? get().uploadedFiles[0].filename
          : `${get().uploadedFiles.length} files`
      } : undefined,
      template: get().selectedTemplate || undefined,
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      inputValue: ""
    }));
  },

  clearInput: () => set({ inputValue: "" }),

  processFileWithMessage: async (content: string, onProcessedDataChange?: (data: any) => void, projectIdParam?: string, mentionedAssetIds?: string[]) => {
    const state = get();
    const { uploadedFiles, updateFile, setIsProcessing, setIsTyping, addMessage, updateMessages, messages, setDashboardTheme, setIsThemeChanging, hasShownInitialDashboard, dashboardTheme, currentConversationId, setCurrentConversationId, setCurrentWorkflowStep } = state;

    // Create new AbortController for this processing session
    const abortController = new AbortController();
    set({ abortController });

    // Clear current workflow step at start
    setCurrentWorkflowStep(null);

    // Text-only message path: allow theme change after initial dashboard shown, only if currently light
    // @mentioned files should use Q&A path (they're already in conversation)
    const hasUploadedFiles = uploadedFiles.some(f => f.status === 'uploaded' && !f.isFromMention);
    const isTextOnly = !hasUploadedFiles;
    const detectedTheme = detectThemeChange(content);
    if (isTextOnly && hasShownInitialDashboard && dashboardTheme === 'light' && detectedTheme) {
      console.log('Theme change detected:', detectedTheme);
      setIsThemeChanging(true);

      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        template: get().selectedTemplate || undefined,
      };
      addMessage(userMessage);

      // Add loading message
      const loadingMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Changing dashboard theme...",
        timestamp: new Date(),
      };
      addMessage(loadingMessage);

      // Wait 10 seconds for loading effect
      setTimeout(() => {
        setDashboardTheme(detectedTheme);
        setIsThemeChanging(false);

        // Add completion message
        const completionMessage: Message = {
          id: (Date.now() + 2).toString(),
          role: "assistant",
          content: `Dashboard theme has been changed to ${detectedTheme} mode!`,
          timestamp: new Date(),
        };
        addMessage(completionMessage);
      }, 10000);

      return;
    }

    if (isTextOnly) {
      // No file uploaded - process Q&A (with or without existing conversation)
      console.log('No file - processing Q&A', { hasConversation: !!currentConversationId, projectId: projectIdParam });

      // Check if we have projectId (required for API call)
      if (!projectIdParam) {
        console.log('No projectId - cannot process Q&A');
        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          template: get().selectedTemplate || undefined,
        };
        addMessage(userMessage);

        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Project context is required. Please ensure you are in a project workspace.",
          timestamp: new Date(),
        };
        addMessage(errorMessage);
        return;
      }

      // Process Q&A (with or without existing conversation)
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
        // Determine if we should attach file context visually (show chip)
        // Show chip if:
        // 1. Fresh upload (no conversationId yet)
        // 2. Explicitly @mentioned (isFromMention = true)
        // Don't show if just a follow-up prompt on existing file
        const hasFileContext = uploadedFiles.length > 0 && uploadedFiles.some(f => (f.fileID && !f.conversationId) || f.isFromMention);
        const firstFile = uploadedFiles[0];

        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          attachment: hasFileContext ? { kind: "csv", name: uploadedFiles.length === 1 ? firstFile.filename : `${uploadedFiles.length} files` } : undefined,
          template: get().selectedTemplate || undefined,
        };
        addMessage(userMessage);
      }

      setIsTyping(true);
      setIsProcessing(true);
      
      // Update file status to processing to show loading indicator in chip
      uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'processing' }));

      try {
        // Use projectId from parameter (required)
        const projectId = projectIdParam;

        if (!projectId) {
          throw new Error('Project context missing. Please ensure you are in a project workspace.');
        }

        // Only attach asset content if this is a NEW file upload, not an @mention of existing file
        const freshUploads = uploadedFiles.filter(f =>
          f.fileID && !f.isFromMention && !f.conversationId && f.status === 'uploaded'
        );

        let assetContents: ConversationChatRequest['user_node_contents'] = undefined;
        let assetId: string | null = freshUploads[0]?.fileID ?? null;

        const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
        for (const file of freshUploads) {
          try {
            const { fileService } = await import('@/services/fileService');
            const assetResponse = await fileService.getAsset(file.fileID);
            if (assetResponse.success && assetResponse.asset) {
              const assetData = assetResponse.asset;
              assetContentsList.push({
                type: 'asset',
                data: {
                  asset_id: assetData.asset_id,
                  file_id: assetData.file_id,
                  s3_bucket: assetData.s3_bucket,
                  s3_key: assetData.s3_key,
                  extension: assetData.extension,
                  filename: assetData.filename,
                }
              });
            }
          } catch (error) {
            console.warn('Failed to fetch asset data for QnA:', error);
          }
        }
        if (assetContentsList.length > 0) {
          assetContents = assetContentsList;
        }

        const allFileIds = uploadedFiles.map(f => f.fileID).filter(Boolean);
        const userNodeMetadata = mentionedAssetIds && mentionedAssetIds.length > 0
          ? { asset_selection: 'explicit' as const, selected_asset_ids: mentionedAssetIds }
          : allFileIds.length > 0
            ? { asset_selection: 'explicit' as const, selected_asset_ids: allFileIds }
            : { asset_selection: 'all' as const };

        // Call processing service with file attachment if available
        const startResult = await processingService.runProcessing(
          projectId,
          assetId,
          content,
          currentConversationId || undefined,  // Use existing conversation if available
          assetContents,
          userNodeMetadata
        );

        console.log('Q&A processing result:', startResult);

        if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
          const conversationId = startResult.data?.conversation_id || currentConversationId;
          if (conversationId) {
            setCurrentConversationId(conversationId);
          }

          // Poll for completion
          const finalResult = await processingService.pollProcessingStatus(
            '',  // No assetId for Q&A
            projectId,
            conversationId,
            (status) => {
              // Update status based on workflow status
              const workflowStatus = status.data?.workflow_status?.status;

              // For QnA: DON'T update uploadedFile status to 'processing'
              // This prevents ProjectPage from showing "Generating Dashboard"
              // Keep status as 'uploaded' until QnA completes
              if (workflowStatus === 'error') {
                uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
              }

              if (workflowStatus === 'error' || workflowStatus === 'stopped') {
                setIsProcessing(false);
              }
              if (workflowStatus === 'stopped') {
                setIsTyping(false);
              }
              // Track current workflow step
              const step = status.data?.workflow_status?.metadata?.step;
              if (step) {
                setCurrentWorkflowStep(step);
              }
            },
            60,
            5000,
            abortController.signal
          );

          console.log('Q&A final result:', finalResult);

          if (finalResult.data?.success && finalResult.data?.status === 'completed') {
            // Q&A response - check if it's a message or dashboard
            if (finalResult.data?.dashboard_data) {
              // Dashboard response - load conversation to get LLM's actual response text
              try {
                const { conversationService } = await import('@/services/conversationService');
                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
                const conversation = conversationResponse.conversation;

                // Extract dashboard_id from conversation
                const dashboards = conversation.dashboards || [];
                const latestDashboard = dashboards[dashboards.length - 1];
                const dashboardId = latestDashboard?.dashboard_id || "";

                // Set the latest dashboard as selected and update processedData
                if (dashboardId) {
                  set({ selectedDashboardId: dashboardId });
                  // Update processedData with the new dashboard data (first file for display)
                  const firstFile = get().uploadedFiles[0];
                  if (firstFile) {
                    updateFile(firstFile.fileID, { status: 'processed', processedData: finalResult.data.dashboard_data });
                  }
                }

                const firstFile = get().uploadedFiles[0];
                const restoredMessages = conversationNodesToMessages(conversation, {
                  sourceFileName: firstFile?.filename || 'dashboard',
                });
                if (restoredMessages.length) {
                  get().setMessages(restoredMessages);
                }
              } catch (error) {
                console.error('Failed to load conversation for dashboard response:', error);
                // No fallback message
                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: "",
                    dashboardCard: {
                      sourceFileName: get().uploadedFiles[0]?.filename || "dashboard",
                      dashboardId: ""
                    },
                    timestamp: new Date(),
                  }
                ]));
              }
            } else {
              // Q&A text response - load conversation and show all nodes in workflow order
              try {
                const { conversationService } = await import('@/services/conversationService');
                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
                const conversation = conversationResponse.conversation;
                const restoredMessages = conversationNodesToMessages(conversation);
                if (restoredMessages.length) {
                  get().setMessages(restoredMessages);
                }
                // Update file status to processed to hide chip
                get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'processed' }));
              } catch (error) {
                console.error('Failed to load conversation for Q&A response:', error);
                // Fallback to workflow status metadata
                const workflowStatus = finalResult.data?.workflow_status;
                const responseText = workflowStatus?.metadata?.content ||
                  workflowStatus?.message ||
                  "I've processed your question.";

                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                  }
                ]));
              }
            }
          } else if (finalResult.data?.status === 'error') {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your question.';
            uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Sorry, I encountered an error: ${errorMsg}`,
                timestamp: new Date(),
              }
            ]));
          }
        } else {
          const errorMsg = startResult.data?.error || 'Failed to start processing.';
          updateMessages((prev) => ([
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `Sorry, I couldn't process your question: ${errorMsg}`,
              timestamp: new Date(),
            }
          ]));
        }
      } catch (error) {
        console.error('Q&A processing error:', error);
        uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            timestamp: new Date(),
          }
        ]));
      } finally {
        setIsTyping(false);
        setIsProcessing(false);
      }
      return;
    }

    // Check if user message with this content already exists
    const firstUploadedFile = uploadedFiles[0];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
      // User message doesn't exist, add it
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        attachment: uploadedFiles.length > 0 ? { kind: "csv", name: uploadedFiles.length === 1 ? firstUploadedFile.filename : `${uploadedFiles.length} files` } : undefined,
        template: get().selectedTemplate || undefined,
      };
      addMessage(userMessage);
    }

    // Get updated messages after adding user message
    const updatedMessages = get().messages;
    setIsTyping(true);
    setIsProcessing(true);

    try {
      // Start processing with user prompt - set all files to processing
      set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: 'processing' as const })) }));
      const projectId = projectIdParam || firstUploadedFile.projectId;
      if (!projectId) {
        throw new Error('Project context missing for uploaded file');
      }

      console.log('Starting processing for fileIDs:', uploadedFiles.map(f => f.fileID));
      const freshUploadsForProcessing = uploadedFiles.filter(f =>
        f.fileID && !f.isFromMention && !f.conversationId
      );
      const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
      for (const file of freshUploadsForProcessing) {
        try {
          const { fileService } = await import('@/services/fileService');
          const assetResponse = await fileService.getAsset(file.fileID);
          if (assetResponse.success && assetResponse.asset) {
            const assetData = assetResponse.asset;
            assetContentsList.push({
              type: 'asset',
              data: {
                asset_id: assetData.asset_id,
                file_id: assetData.file_id,
                s3_bucket: assetData.s3_bucket,
                s3_key: assetData.s3_key,
                extension: assetData.extension,
                filename: assetData.filename,
              }
            });
          }
        } catch (error) {
          console.warn('Failed to fetch asset data:', error);
        }
      }
      const assetContents = assetContentsList.length > 0 ? assetContentsList : undefined;
      const allFileIdsForMeta = get().uploadedFiles.map(f => f.fileID).filter(Boolean);
      const userNodeMetadata = mentionedAssetIds && mentionedAssetIds.length > 0
        ? { asset_selection: 'explicit' as const, selected_asset_ids: mentionedAssetIds }
        : allFileIdsForMeta.length > 0
          ? { asset_selection: 'explicit' as const, selected_asset_ids: allFileIdsForMeta }
          : { asset_selection: 'all' as const };

      const startResult = await processingService.runProcessing(
        projectId,
        firstUploadedFile.fileID,
        content,
        firstUploadedFile.conversationId || currentConversationId || undefined,
        assetContents,
        userNodeMetadata
      );
      console.log('Run processing result:', startResult);
      // processing or accepted
      if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
        const conversationId = startResult.data?.conversation_id;
        if (conversationId) {
          set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, conversationId })), currentConversationId: conversationId }));
          setCurrentConversationId(conversationId);
        }
        console.log('Processing started, beginning polling...');
        const finalResult = await processingService.pollProcessingStatus(
          firstUploadedFile.fileID,
          projectId,
          conversationId,
          (status) => {
            const workflowStatus = status.data?.workflow_status?.status;
            if (workflowStatus === 'processing') {
              set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: 'processing' as const })) }));
            } else if (workflowStatus === 'error' || workflowStatus === 'stopped') {
              const newStatus = workflowStatus === 'stopped' ? 'processed' : 'error';
              set((s) => ({
                uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: newStatus }))
              }));
            }
            if (workflowStatus === 'stopped') {
              setIsProcessing(false);
              setIsTyping(false);
            }
            const step = status.data?.workflow_status?.metadata?.step;
            if (step) {
              setCurrentWorkflowStep(step);
            }
          },
          60, // max attempts (60 seconds)
          5000, // 5 second intervals
          abortController.signal
        );
        console.log('Final polling result:', finalResult);

        if (finalResult.data?.success && finalResult.data?.status === 'completed') {
          if (finalResult.data?.dashboard_data) {
            const files = get().uploadedFiles;
            if (files.length > 0) {
              updateFile(files[0].fileID, { status: 'processed', processedData: finalResult.data?.dashboard_data });
            }
            // First successful generation: show initial loading for 10s, then mark shown
            if (!get().hasShownInitialDashboard) {
              set({ isInitialLoading: true });
              setTimeout(() => {
                set({ isInitialLoading: false, hasShownInitialDashboard: true });
              }, 10000);
            }

            // Load conversation to get LLM's actual response text and dashboard_id
            try {
              const { conversationService } = await import('@/services/conversationService');
              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
              const conversation = conversationResponse.conversation;

              // Extract dashboard_id from conversation
              const dashboards = conversation.dashboards || [];
              const latestDashboard = dashboards[dashboards.length - 1];
              const dashboardId = latestDashboard?.dashboard_id || "";

              // Set the latest dashboard as selected and update processedData
              if (dashboardId) {
                set({ selectedDashboardId: dashboardId });
                const files = get().uploadedFiles;
                if (files.length > 0) {
                  updateFile(files[0].fileID, { processedData: finalResult.data.dashboard_data });
                }
              }

              const currentFiles = get().uploadedFiles;
              const restoredMessages = conversationNodesToMessages(conversation, {
                sourceFileName: currentFiles[0]?.filename ?? 'dashboard',
              });
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);
              }

              // DON'T clear uploadedFile - ProjectPage needs it to determine dashboard display
              // The FilePreviewChip will be hidden based on processing status
              // setUploadedFile(null); // REMOVED - causes dashboard to disappear in ProjectPage
            } catch (error) {
              console.error('Failed to load conversation for dashboard response:', error);
              // No fallback message
              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 3).toString(),
                  role: 'assistant',
                  content: "",
                  dashboardCard: {
                    sourceFileName: get().uploadedFiles[0]?.filename ?? "dashboard",
                    dashboardId: ""
                  },
                  timestamp: new Date(),
                }
              ]));

              // DON'T clear uploadedFile - see comment above
              // setUploadedFile(null); // REMOVED
            }

            if (conversationId) {
              setCurrentConversationId(conversationId);
            }
          } else {
            // Q&A text response (with @mentioned file) - load conversation and show response
            console.log('Q&A response detected (no dashboard_data) - loading conversation');
            try {
              const { conversationService } = await import('@/services/conversationService');
              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
              const conversation = conversationResponse.conversation;
              const restoredMessages = conversationNodesToMessages(conversation);
              console.log('Q&A conversation loaded, restored', restoredMessages.length, 'messages');
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);
              }
            } catch (error) {
              console.error('Failed to load conversation for Q&A response:', error);
              // Fallback to workflow status metadata
              const workflowStatus = finalResult.data?.workflow_status;
              const responseText = workflowStatus?.metadata?.content ||
                workflowStatus?.message ||
                "I've processed your question.";

              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: responseText,
                  timestamp: new Date(),
                }
              ]));
            }
          }
        } else {
          if (finalResult.data?.status === 'error' || !finalResult.success) {
            get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
          }
          await generateAIResponse(content, null, updatedMessages, updateMessages, get().uploadedFiles[0]?.filename);
        }
      } else {
        await generateAIResponse(content, null, updatedMessages, updateMessages, get().uploadedFiles[0]?.filename);
      }
    } catch (error) {
      console.error('Processing error:', error);
      get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
      await generateAIResponse(content, null, updatedMessages, updateMessages, get().uploadedFiles[0]?.filename);
    } finally {
      setIsTyping(false);
      setIsProcessing(false);
      // Clear abort controller when processing completes
      set({ abortController: null });
    }
  },

  stopGeneration: async () => {
    const state = get();
    const { abortController, currentConversationId, setIsProcessing, setIsTyping } = state;

    // Abort the polling if controller exists
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }

    if (currentConversationId) {
      try {
        const projectId = state.uploadedFiles[0]?.projectId;
        if (projectId) {
          const { conversationService } = await import('@/services/conversationService');
          await conversationService.stopWorkflow(currentConversationId, projectId);
        }
      } catch (error) {
        console.error('Failed to stop workflow:', error);
      }
    }

    // Clear abort controller and update state
    set({
      abortController: null,
      isProcessing: false,
      isTyping: false,
    });
  },

  resetChat: () => set({
    inputValue: "",
    isTyping: false,
    messages: initialMessages,
    uploadedFiles: [],
    currentConversationId: null,
    isProcessing: false,
    currentWorkflowStep: null,
    dropdownOpen: false,
    selectedDataSource: "",
    isListening: false,
    transcript: "",
    detectedLanguage: null,
    selectedDashboardId: null,
  }),

  selectDashboard: async (dashboardId: string, projectId: string) => {
    const { currentConversationId, updateFile, uploadedFiles } = get();
    if (!currentConversationId) return;

    try {
      const { conversationService } = await import('@/services/conversationService');
      const response = await conversationService.getDashboardData(
        currentConversationId,
        projectId,
        dashboardId
      );

      if (response?.dashboard_data && uploadedFiles.length > 0) {
        set({ selectedDashboardId: dashboardId });
        updateFile(uploadedFiles[0].fileID, { processedData: response.dashboard_data });
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
  },
}));
