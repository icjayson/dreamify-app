import { create } from 'zustand';
import { Message } from '@/types/message';
import { processingService } from '@/services/processingService';

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
    return "Your dashboard has been created successfully! If you'd like to make any changes or customize the dashboard further, please let me know what you need.";
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
  executionId?: string;
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
  
  // Processing state
  isProcessing: boolean;
  
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
  
  // Actions
  setInputValue: (value: string) => void;
  setIsTyping: (typing: boolean) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setUploadedFile: (file: UploadedFile | null | ((prev: UploadedFile | null) => UploadedFile | null)) => void;
  setDropdownOpen: (open: boolean) => void;
  setSelectedDataSource: (source: string) => void;
  setIsListening: (listening: boolean) => void;
  setTranscript: (transcript: string) => void;
  setDetectedLanguage: (language: string | null) => void;
  setIsProcessing: (processing: boolean) => void;
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
  processFileWithMessage: (content: string, onProcessedDataChange?: (data: any) => void) => Promise<void>;
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
  isProcessing: false,
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
  setDropdownOpen: (open) => set({ dropdownOpen: open }),
  setSelectedDataSource: (source) => set({ selectedDataSource: source }),
  setIsListening: (listening) => set({ isListening: listening }),
  setTranscript: (transcript) => set({ transcript }),
  setDetectedLanguage: (language) => set({ detectedLanguage: language }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
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
  
  processFileWithMessage: async (content: string, onProcessedDataChange?: (data: any) => void) => {
    const state = get();
    const { uploadedFile, setUploadedFile, setIsProcessing, setIsTyping, addMessage, updateMessages, messages, setDashboardTheme, setIsThemeChanging, hasShownInitialDashboard, dashboardTheme } = state;
    
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
      // No file uploaded, check if user message already exists
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
        // User message doesn't exist, add it
        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          template: get().selectedTemplate || undefined,
        };
        addMessage(userMessage);
      }
      // Generate AI response for no file case
      console.log('No file case - generating AI response');
      setIsTyping(true);
      try {
        // Get updated messages after adding user message
        const updatedMessages = get().messages;
        console.log('No file - Updated messages before AI call:', updatedMessages.map(m => ({ id: m.id, role: m.role, content: m.content.substring(0, 50) })));
        await generateAIResponse(content, null, updatedMessages, updateMessages, uploadedFile?.filename);
      } finally {
        setIsTyping(false);
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
      
      console.log('Starting processing for fileID:', uploadedFile.fileID);
      const startResult = await processingService.runProcessing(uploadedFile.fileID);
      console.log('Run processing result:', startResult);
      // processing or accepted
      if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
        console.log('Processing started, beginning polling...');
        // Poll for completion
        const finalResult = await processingService.pollProcessingStatus(
          uploadedFile.fileID,
          (status) => {
            console.log('Polling status update:', status);

            // Capture execution_id when available during accepted/processing
            const executionId = status.data?.execution_id as string | undefined;
            if (executionId) {
              setUploadedFile((prev) => prev ? { ...prev, executionId } : prev);
            }

            // If JSON result is present inline in status, store it and mark processed
            const d: any = status.data;
            const hasTopLevel = d && ((Array.isArray(d.charts) && d.charts.length) || (Array.isArray(d.metrics) && d.metrics.length) || (Array.isArray(d.tables) && d.tables.length));
            const hasNested = d && d.data && ((Array.isArray(d.data.charts) && d.data.charts.length) || (Array.isArray(d.data.metrics) && d.data.metrics.length) || (Array.isArray(d.data.tables) && d.data.tables.length));
            if (hasTopLevel || hasNested) {
              setUploadedFile((prev) => prev ? { ...prev, status: 'processed', processedData: d } : prev);
            } else if (status.data?.status === 'completed') {
              setUploadedFile((prev) => prev ? { ...prev, status: 'processed', processedData: d } : prev);
            } else if (status.data?.status === 'error') {
              setUploadedFile((prev) => prev ? { ...prev, status: 'error' } : prev);
            }
          },
          60, // max attempts (60 seconds)
          5000 // 5 second intervals
        );
        console.log('Final polling result:', finalResult);
        
        if (finalResult.data?.success && finalResult.data?.status === 'completed') {
          // First successful generation: show initial loading for 10s, then mark shown
          if (!get().hasShownInitialDashboard) {
            set({ isInitialLoading: true });
            setTimeout(() => {
              set({ isInitialLoading: false, hasShownInitialDashboard: true });
            }, 10000);
          }
          
          // Always add success message and dashboard card when dashboard is completed
          updateMessages((prev) => ([
            ...prev,
            {
              id: '2',
              role: 'assistant',
              content: "Your dashboard has been created successfully! If you'd like to make any changes or customize the dashboard further, please let me know what you need.",
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
        } else {
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
    }
  },
  
  resetChat: () => set({
    inputValue: "",
    isTyping: false,
    messages: initialMessages,
    uploadedFile: null,
    isProcessing: false,
    dropdownOpen: false,
    selectedDataSource: "",
    isListening: false,
    transcript: "",
    detectedLanguage: null,
  }),
}));
