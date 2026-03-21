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
  /** Integration source type if the file came from an API sync */
  sourceType?: string;
  /** GA4 account display name */
  accountName?: string;
  /** GA4 property display name */
  propertyName?: string;
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
  currentProjectId: string | null;

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

  // Integration states
  isGoogleSheetsModalOpen: boolean;
  isGA4ModalOpen: boolean;
  googleSheetsFileId: string | null;
  googleSheetsFileName: string | null;

  // Pending action state for cross-page navigation
  pendingAction: PendingAction | null;

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
  setCurrentProjectId: (id: string | null) => void;
  setPendingAction: (action: PendingAction | null) => void;

  // Integration setters
  setGoogleSheetsModalOpen: (open: boolean) => void;
  setGA4ModalOpen: (open: boolean) => void;
  setGoogleSheetsFileId: (id: string | null) => void;
  setGoogleSheetsFileName: (name: string | null) => void;

  // Complex actions
  sendMessage: (content: string) => void;
  clearInput: () => void;
  resetChat: () => void;
  processFileWithMessage: (content: string, onProcessedDataChange?: (data: any) => void, projectId?: string, mentionedAssetIds?: string[], activeFileAttachment?: { kind: 'csv' | 'file'; name: string; sourceType?: string; accountName?: string; propertyName?: string }) => Promise<void>;
  stopGeneration: () => Promise<void>;
  selectDashboard: (dashboardId: string, projectId: string) => Promise<any>;

  // Sync actions
  syncGoogleSheets: (projectId?: string) => Promise<void>;
  syncGA4: (propertyId: string, projectId?: string, startDate?: string, endDate?: string, accountName?: string, propertyName?: string) => Promise<void>;
}

export interface PendingAction {
  type: 'process_file';
  content: string;
  files: UploadedFile[];
  projectId: string;
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hi! I'm Dreamify, your analytics intern. Upload data, visualise motion-rich dashboard in seconds!",
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
  currentProjectId: null,
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
  pendingAction: null,
  isGoogleSheetsModalOpen: false,
  isGA4ModalOpen: false,
  googleSheetsFileId: null,
  googleSheetsFileName: null,

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
  setPendingAction: (action) => set({ pendingAction: action }),
  setGoogleSheetsModalOpen: (open) => set({ isGoogleSheetsModalOpen: open }),
  setGA4ModalOpen: (open) => set({ isGA4ModalOpen: open }),
  setGoogleSheetsFileId: (id) => {
    console.log('Store: setting googleSheetsFileId:', id);
    set({ googleSheetsFileId: id });
  },
  setGoogleSheetsFileName: (name) => {
    console.log('Store: setting googleSheetsFileName:', name);
    set({ googleSheetsFileName: name });
  },
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  // Sync actions implementation
  syncGoogleSheets: async (projectId) => {
    const { googleSheetsFileId, googleSheetsFileName, addFiles, setGoogleSheetsFileId, setGoogleSheetsFileName, setGoogleSheetsModalOpen } = get();
    if (!googleSheetsFileId) return;

    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleSheetData(googleSheetsFileId, projectId);

      if (response.success && response.asset) {
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'Google Sheets',
          accountName: 'Google Sheets',
          propertyName: googleSheetsFileName || response.asset.filename,
          rowCount: response.asset.row_count,
          columnCount: response.asset.column_count,
        };

        addFiles([newFile]);
        setGoogleSheetsFileId(null);
        setGoogleSheetsFileName(null);
        setGoogleSheetsModalOpen(false);
      } else {
        throw new Error(response.error || 'Failed to sync Google Sheets');
      }
    } catch (err) {
      console.error('Sync Google Sheets error:', err);
      throw err;
    }
  },

  syncGA4: async (propertyId, projectId, startDate, endDate, accountName, propertyName) => {
    const { addFiles, setGA4ModalOpen } = get();
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleAnalyticsData(
        propertyId,
        projectId,
        startDate || '30daysAgo',
        endDate || 'today',
        accountName || 'GA4',
        propertyName || 'GA4',
      );

      if (response.success && response.asset) {
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'GA4',
          accountName: accountName || (response.asset as any).accountName || 'GA4',
          propertyName: propertyName || (response.asset as any).propertyName || response.asset.filename,
        };
        addFiles([newFile]);
        setGA4ModalOpen(false);
      } else {
        throw new Error(response.error || 'Failed to sync GA4');
      }
    } catch (err) {
      console.error('Sync GA4 error:', err);
      throw err;
    }
  },

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
          : `${get().uploadedFiles.length} files`,
        sourceType: get().uploadedFiles[0].sourceType,
        accountName: get().uploadedFiles[0].accountName,
        propertyName: get().uploadedFiles[0].propertyName,
      } : undefined,
      template: get().selectedTemplate || undefined,
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      inputValue: ""
    }));
  },

  clearInput: () => set({ inputValue: "" }),

  processFileWithMessage: async (content: string, onProcessedDataChange?: (data: any) => void, projectIdParam?: string, mentionedAssetIds?: string[], activeFileAttachment?: { kind: 'csv' | 'file'; name: string; sourceType?: string; accountName?: string; propertyName?: string }) => {
    const state = get();
    const { uploadedFiles, updateFile, setIsProcessing, setIsTyping, addMessage, updateMessages, messages, setDashboardTheme, setIsThemeChanging, hasShownInitialDashboard, dashboardTheme, currentConversationId, setCurrentConversationId, setCurrentWorkflowStep } = state;

    // Create new AbortController for this processing session
    const abortController = new AbortController();
    set({ abortController, currentProjectId: projectIdParam || null });

    // Clear current workflow step at start
    setCurrentWorkflowStep(null);

    // Text-only message path: allow theme change after initial dashboard shown, only if currently light
    // @mentioned files should use Q&A path (they're already in conversation)
    const hasUploadedFiles = uploadedFiles.some(f => f.status === 'uploaded' && !f.isFromMention);

    // Clear uploaded files immediately so they disappear from the input chips area 
    // once the message start process is initiated.
    get().clearFiles();

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
        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          attachment: activeFileAttachment || (uploadedFiles.length > 0 ? {
            kind: "csv",
            name: uploadedFiles.length === 1 ? uploadedFiles[0].filename : `${uploadedFiles.length} files`,
            sourceType: uploadedFiles.length === 1 ? uploadedFiles[0].sourceType : 'Multiple',
            accountName: uploadedFiles.length === 1 ? uploadedFiles[0].accountName : undefined,
            propertyName: uploadedFiles.length === 1 ? uploadedFiles[0].propertyName : undefined,
          } : undefined),
          template: get().selectedTemplate || undefined,
        };
        addMessage(userMessage);
      }

      setIsTyping(true);
      setIsProcessing(true);

      // Update file status to processing to show loading indicator in chip
      // Skip files already 'processed' from previous conversation (restored on reload)
      uploadedFiles.filter(f => f.status !== 'processed').forEach(f => updateFile(f.fileID, { status: 'processing' }));

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
                  sourceType: assetData?.asset_type || '',
                }
              });
            }
          } catch (error) {
            console.warn('Failed to fetch asset data for QnA:', error);
          }
        }

        // Add @mentioned files as 'mention' content entries so badge persists in conversation JSON
        // Uses 'mention' type so backend doesn't treat them as new assets to process
        if (mentionedAssetIds && mentionedAssetIds.length > 0) {
          for (const mentionedId of mentionedAssetIds) {
            if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
            const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
            if (mentionedFile) {
              assetContentsList.push({
                type: 'mention',
                data: {
                  asset_id: mentionedId,
                  filename: mentionedFile.filename,
                  kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                  sourceType: mentionedFile?.sourceType || '',
                }
              });
            }
          }
        }

        if (assetContentsList.length === 0 && activeFileAttachment) {
          assetContentsList.push({
            type: 'mention',
            data: {
              asset_id: 'all-assets', // Dummy ID for persistence
              filename: activeFileAttachment.name,
              kind: activeFileAttachment.kind,
            }
          });
        }

        if (assetContentsList.length > 0) {
          assetContents = assetContentsList;
        }

        // Exclude restored files (already processed from previous conversation)
        const allFileIds = uploadedFiles.filter(f => !(f.status === 'processed' && f.conversationId)).map(f => f.fileID).filter(Boolean);
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
            360,
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

                  // Signal completion to UI for automatic rendering (unconditional)
                  if (onProcessedDataChange) {
                    onProcessedDataChange(finalResult.data.dashboard_data);
                  }
                }

                const firstFile = get().uploadedFiles[0];
                const restoredMessages = conversationNodesToMessages(conversation, {
                  sourceFileName: firstFile?.filename || 'dashboard',
                  lastUserMessageAttachment: firstFile ? {
                    kind: 'csv',
                    name: firstFile.filename,
                    mime: 'text/csv',
                    sourceType: firstFile.sourceType,
                    accountName: firstFile.accountName,
                    propertyName: firstFile.propertyName
                  } : undefined
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
                content: 'error while generating dashboard',
                timestamp: new Date(),
                isError: true,
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
              content: 'error while generating dashboard',
              timestamp: new Date(),
              isError: true,
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
            content: 'error while generating dashboard',
            timestamp: new Date(),
            isError: true,
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
        attachment: activeFileAttachment || (uploadedFiles.length > 0 ? {
          kind: "csv",
          name: uploadedFiles.length === 1 ? firstUploadedFile.filename : `${uploadedFiles.length} files`,
          sourceType: uploadedFiles.length === 1 ? firstUploadedFile.sourceType : 'Multiple',
          accountName: uploadedFiles.length === 1 ? firstUploadedFile.accountName : undefined,
          propertyName: uploadedFiles.length === 1 ? firstUploadedFile.propertyName : undefined,
        } : undefined),
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
                sourceType: assetData?.asset_type || '',
              }
            });
          }
        } catch (error) {
          console.warn('Failed to fetch asset data:', error);
        }
      }

      // Add @mentioned files as 'mention' content entries so badge persists in conversation JSON
      if (mentionedAssetIds && mentionedAssetIds.length > 0) {
        for (const mentionedId of mentionedAssetIds) {
          if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
          const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
          if (mentionedFile) {
            assetContentsList.push({
              type: 'mention',
              data: {
                asset_id: mentionedId,
                filename: mentionedFile.filename,
                kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                sourceType: mentionedFile?.sourceType || '',
              }
            });
          }
        }
      }

      if (assetContentsList.length === 0 && activeFileAttachment) {
        assetContentsList.push({
          type: 'mention',
          data: {
            asset_id: 'all-assets', // Dummy ID for persistence
            filename: activeFileAttachment.name,
            kind: activeFileAttachment.kind,
          }
        });
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
          360, // max attempts (30 minutes)
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
                // Signal completion to UI for automatic rendering
                if (onProcessedDataChange) {
                  onProcessedDataChange(finalResult.data.dashboard_data);
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
          // Explicitly handle error status from polling
          if (finalResult.data?.status === 'error' || !finalResult.success) {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your request.';
            get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));

            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          } else {
            // Timeout or unknown state — show explicit error to user
            const timeoutMsg = finalResult.data?.error || 'Processing timed out. Please try again.';
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          }
        }
      } else {
        // startResult failed — show error to user
        const startErrorMsg = startResult.data?.error || 'Failed to start processing.';
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'error while generating dashboard',
            timestamp: new Date(),
            isError: true,
          }
        ]));
      }
    } catch (error) {
      console.error('Processing error:', error);
      get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
      const errorMsg = error instanceof Error ? error.message : 'An unexpected error occurred.';
      updateMessages((prev) => ([
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'error while generating dashboard',
          timestamp: new Date(),
          isError: true,
        }
      ]));
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
        const projectId = state.currentProjectId || state.uploadedFiles[0]?.projectId;
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
    // We explicitly DO NOT clear integration modal states here
    // to preserve them across navigation/reloads during picking.
  }),

  selectDashboard: async (dashboardId: string, projectId: string): Promise<any> => {
    const { currentConversationId, updateFile } = get();
    if (!currentConversationId) return null;

    try {
      const { conversationService } = await import('@/services/conversationService');
      const response = await conversationService.getDashboardData(
        currentConversationId,
        projectId,
        dashboardId
      );

      if (response?.dashboard_data) {
        set({ selectedDashboardId: dashboardId });
        // Update file only if one exists in store
        const files = get().uploadedFiles;
        if (files.length > 0) {
          updateFile(files[0].fileID, { processedData: response.dashboard_data });
        }
        return response.dashboard_data;
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
    return null;
  },
}));
