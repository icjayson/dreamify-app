import { create } from 'zustand';
import { Message } from '@/types/message';
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
    
    // Add dashboard card
    const dashboardCardMessage: Message = {
      id: (Date.now() + 2).toString(),
      role: "assistant",
      content: "",
      dashboardCard: { sourceFileName: uploadedFileName || "dashboard" },
      timestamp: new Date(),
    };
    
    updateMessages((prev) => [...prev, aiMessage, dashboardCardMessage]);
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

interface UploadedFile {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error' | 'accepted';
  projectId?: string;
  conversationId?: string;
  processedData?: any;
}

interface ChatState {
  // Input state
  inputValue: string;
  isTyping: boolean;
  
  // Messages state
  messages: Message[];
  
  // File state
  uploadedFile: UploadedFile | null;
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
  setUploadedFile: (file: UploadedFile | null | ((prev: UploadedFile | null) => UploadedFile | null)) => void;
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
  setOriginalFile: (file: { blob: Blob; name: string } | null) => void;
  setSelectedTemplate: (template: { id: string; title: string; description: string; image: string; category: string } | null) => void;
  
  // Complex actions
  sendMessage: (content: string) => void;
  clearInput: () => void;
  resetChat: () => void;
  processFileWithMessage: (content: string, onProcessedDataChange?: (data: any) => void, projectId?: string) => Promise<void>;
  stopGeneration: () => Promise<void>;
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
  uploadedFile: null,
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
  setUploadedFile: (file) => set((state) => ({ 
    uploadedFile: typeof file === 'function' ? file(state.uploadedFile) : file 
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
  setOriginalFile: (file) => set({ originalFileBlob: file?.blob ?? null, originalFileName: file?.name ?? null }),
  setSelectedTemplate: (template) => set({ selectedTemplate: template }),
  
  // Complex actions
  sendMessage: (content) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
      attachment: get().uploadedFile ? { 
        kind: "csv", 
        name: get().uploadedFile!.filename 
      } : undefined,
      template: get().selectedTemplate || undefined,
    };
    
    set((state) => ({
      messages: [...state.messages, userMessage],
      inputValue: ""
    }));
  },
  
  clearInput: () => set({ inputValue: "" }),
  
  processFileWithMessage: async (content: string, onProcessedDataChange?: (data: any) => void, projectIdParam?: string) => {
    const state = get();
    const { uploadedFile, setUploadedFile, setIsProcessing, setIsTyping, addMessage, updateMessages, messages, setDashboardTheme, setIsThemeChanging, hasShownInitialDashboard, dashboardTheme, currentConversationId, setCurrentConversationId, setCurrentWorkflowStep } = state;
    
    // Create new AbortController for this processing session
    const abortController = new AbortController();
    set({ abortController });
    
    // Clear current workflow step at start
    setCurrentWorkflowStep(null);
    
    // Text-only message path: allow theme change after initial dashboard shown, only if currently light
    const isTextOnly = !uploadedFile || uploadedFile.status !== 'uploaded';
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
          template: get().selectedTemplate || undefined,
        };
        addMessage(userMessage);
      }
      
      setIsTyping(true);
      setIsProcessing(true);
      
      try {
        // Use projectId from parameter (required)
        const projectId = projectIdParam;
        
        if (!projectId) {
          throw new Error('Project context missing. Please ensure you are in a project workspace.');
        }
        
        // Call processing service with null assetId (with or without conversationId)
        const startResult = await processingService.runProcessing(
          projectId,
          null,  // No asset_id for Q&A without file
          content,
          currentConversationId || undefined,  // Use existing conversation if available
          undefined  // No attachment contents
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
                const nodes = conversation.nodes || [];
                
                // Filter to only user and assistant nodes
                const filteredNodes = nodes.filter((node: any) => 
                  node.role === 'user' || node.role === 'assistant'
                );
                
                // Find the latest assistant node with text content
                let responseText = "";
                for (let i = filteredNodes.length - 1; i >= 0; i--) {
                  const node = filteredNodes[i];
                  if (node.role === 'assistant') {
                    const contents = node.contents || [];
                    for (const content of contents) {
                      if (content.type === 'text' && content.data?.text) {
                        const text = content.data.text.trim();
                        // Skip empty texts and JSON blocks
                        if (text && !text.startsWith('{') && !text.startsWith('[')) {
                          responseText = text;
                          break;
                        }
                      }
                    }
                    if (responseText) {
                      break;
                    }
                  }
                }
                
                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                  },
                  {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: "",
                    dashboardCard: { sourceFileName: uploadedFile?.filename || "dashboard" },
                    timestamp: new Date(),
                  }
                ]));
              } catch (error) {
                console.error('Failed to load conversation for dashboard response:', error);
                // No fallback message
                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: "",
                    dashboardCard: { sourceFileName: uploadedFile?.filename || "dashboard" },
                    timestamp: new Date(),
                  }
                ]));
              }
            } else {
              // Q&A text response - load conversation to get the latest assistant message
              try {
                const { conversationService } = await import('@/services/conversationService');
                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
                const conversation = conversationResponse.conversation;
                const nodes = conversation.nodes || [];
                
                // Filter to only user and assistant nodes (exclude system and tool)
                const filteredNodes = nodes.filter((node: any) => 
                  node.role === 'user' || node.role === 'assistant'
                );
                
                // Find the latest assistant node with text content
                let responseText = "I've processed your question.";
                for (let i = filteredNodes.length - 1; i >= 0; i--) {
                  const node = filteredNodes[i];
                  if (node.role === 'assistant') {
                    const contents = node.contents || [];
                    for (const content of contents) {
                      if (content.type === 'text' && content.data?.text) {
                        responseText = content.data.text;
                        break;
                      }
                    }
                    if (responseText !== "I've processed your question.") {
                      break;
                    }
                  }
                }
                
                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                  }
                ]));
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
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
      // User message doesn't exist, add it
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        attachment: { kind: "csv", name: uploadedFile.filename },
        template: get().selectedTemplate || undefined,
      };
      addMessage(userMessage);
    }
    
    // Get updated messages after adding user message
    const updatedMessages = get().messages;
    setIsTyping(true);
    setIsProcessing(true);

    try {
      // Start processing with user prompt
      setUploadedFile({ ...uploadedFile, status: 'processing' });
      // Prioritize projectIdParam when provided, fallback to uploadedFile.projectId
      const projectId = projectIdParam || uploadedFile.projectId;
      if (!projectId) {
        throw new Error('Project context missing for uploaded file');
      }
      
      console.log('Starting processing for fileID:', uploadedFile.fileID);
      // Fetch full asset data if not already available
      let assetData: any = null;
      if (uploadedFile.fileID) {
        try {
          const { fileService } = await import('@/services/fileService');
          const assetResponse = await fileService.getAsset(uploadedFile.fileID);
          if (assetResponse.success && assetResponse.asset) {
            assetData = assetResponse.asset;
          }
        } catch (error) {
          console.warn('Failed to fetch asset data:', error);
        }
      }
      
      const assetContents = uploadedFile && assetData ? [
        {
          type: 'asset',
          data: {
            asset_id: assetData.asset_id,
            file_id: assetData.file_id,
            s3_bucket: assetData.s3_bucket,
            s3_key: assetData.s3_key,
            extension: assetData.extension,
            filename: assetData.filename,
          }
        }
      ] as ConversationChatRequest['user_node_contents'] : undefined;

      const startResult = await processingService.runProcessing(
        projectId,
        uploadedFile.fileID,
        content,
        uploadedFile.conversationId || currentConversationId || undefined,
        assetContents
      );
      console.log('Run processing result:', startResult);
      // processing or accepted
      if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
        const conversationId = startResult.data?.conversation_id;
        if (conversationId) {
          setUploadedFile((prev) => prev ? { ...prev, conversationId } : prev);
          setCurrentConversationId(conversationId);
        }
        console.log('Processing started, beginning polling...');
        // Poll for completion
        const finalResult = await processingService.pollProcessingStatus(
          uploadedFile.fileID,
          projectId,
          conversationId,
          (status) => {
            // Update status based on workflow status
            const workflowStatus = status.data?.workflow_status?.status;
            if (workflowStatus === 'processing') {
              setUploadedFile((prev) => prev ? { ...prev, status: 'processing' } : prev);
            } else if (workflowStatus === 'error' || workflowStatus === 'stopped') {
              setUploadedFile((prev) => prev ? { ...prev, status: workflowStatus === 'stopped' ? 'processed' : 'error' } : prev);
            }
            if (workflowStatus === 'stopped') {
              setIsProcessing(false);
              setIsTyping(false);
            }
            // Track current workflow step
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
        
        if (finalResult.data?.success && finalResult.data?.status === 'completed' && finalResult.data?.dashboard_data) {
          setUploadedFile((prev) => prev ? { ...prev, status: 'processed', processedData: finalResult.data?.dashboard_data } : prev);
          // First successful generation: show initial loading for 10s, then mark shown
          if (!get().hasShownInitialDashboard) {
            set({ isInitialLoading: true });
            setTimeout(() => {
              set({ isInitialLoading: false, hasShownInitialDashboard: true });
            }, 10000);
          }
          
          // Load conversation to get LLM's actual response text
          try {
            const { conversationService } = await import('@/services/conversationService');
            const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
            const conversation = conversationResponse.conversation;
            const nodes = conversation.nodes || [];
            
            // Filter to only user and assistant nodes (exclude system and tool)
            const filteredNodes = nodes.filter((node: any) => 
              node.role === 'user' || node.role === 'assistant'
            );
            
            // Find the latest assistant node with text content
            let responseText = "";
            for (let i = filteredNodes.length - 1; i >= 0; i--) {
              const node = filteredNodes[i];
              if (node.role === 'assistant') {
                const contents = node.contents || [];
                for (const content of contents) {
                  if (content.type === 'text' && content.data?.text) {
                    const text = content.data.text.trim();
                    // Skip empty texts and JSON blocks
                    if (text && !text.startsWith('{') && !text.startsWith('[')) {
                      responseText = text;
                      break;
                    }
                  }
                }
                if (responseText) {
                  break;
                }
              }
            }
            
            updateMessages((prev) => ([
              ...prev,
              {
                id: '2',
                role: 'assistant',
                content: responseText,
                timestamp: new Date(),
              },
              {
                id: (Date.now() + 3).toString(),
                role: 'assistant',
                content: "",
                dashboardCard: { sourceFileName: uploadedFile.filename },
                timestamp: new Date(),
              }
            ]));
          } catch (error) {
            console.error('Failed to load conversation for dashboard response:', error);
            // No fallback message
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 3).toString(),
                role: 'assistant',
                content: "",
                dashboardCard: { sourceFileName: uploadedFile.filename },
                timestamp: new Date(),
              }
            ]));
          }
          
          if (conversationId) {
            setCurrentConversationId(conversationId);
          }
        } else {
          if (finalResult.data?.status === 'error') {
            setUploadedFile((prev) => prev ? { ...prev, status: 'error' } : prev);
          }
          await generateAIResponse(content, null, updatedMessages, updateMessages, uploadedFile?.filename);
        }
      } else {
        await generateAIResponse(content, null, updatedMessages, updateMessages, uploadedFile?.filename);
      }
    } catch (error) {
      console.error('Processing error:', error);
      await generateAIResponse(content, null, updatedMessages, updateMessages, uploadedFile?.filename);
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
    
    // Call stop API if we have a conversation ID
    if (currentConversationId) {
      try {
        // Get projectId from uploadedFile or state
        const projectId = state.uploadedFile?.projectId;
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
    uploadedFile: null,
    currentConversationId: null,
    isProcessing: false,
    currentWorkflowStep: null,
    dropdownOpen: false,
    selectedDataSource: "",
    isListening: false,
    transcript: "",
    detectedLanguage: null,
  }),
}));
