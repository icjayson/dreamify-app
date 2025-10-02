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

// Helper function for AI response generation using functional updates
const generateAIResponse = async (
  userPrompt: string,
  processedData: any,
  messagesSnapshot: Message[],
  updateMessages: (updater: (prev: Message[]) => Message[]) => void
) => {
  console.log('generateAIResponse called with:', { userPrompt, hasProcessedData: !!processedData, messageCount: messagesSnapshot.length });
  
  // Check if there's already an assistant message for this specific user prompt to avoid duplicates
  // Only check the very last message to avoid blocking responses after initial message
  const lastMessage = messagesSnapshot[messagesSnapshot.length - 1];
  const hasRecentAssistantMessage = lastMessage && lastMessage.role === 'assistant' && lastMessage.content.trim() !== '';
  if (hasRecentAssistantMessage) {
    console.log('Last message is already an assistant message, skipping AI response generation');
    return;
  }
  
  console.log('Proceeding with AI response generation...');

  // Stream response from local Ollama (proxied via /ollama)
  try {
    const controller = new AbortController();
    const signal = controller.signal;
    
    // Build system messages based on processed data
    const systemMessages = [] as Array<{ role: string; content: string }>;
    if (processedData) {
      systemMessages.push({
        role: "system", 
        content: `You have access to processed data analysis. Use this data to answer the user's question about their uploaded file.\n\nProcessed Data:\n${JSON.stringify(processedData, null, 2)}`
      });
    }
    
    const response = await fetch("/ollama/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:7b",
        stream: true,
        messages: [
          ...systemMessages,
          ...messagesSnapshot.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userPrompt }
        ],
      }),
      signal,
    });

    if (!response.body) {
      throw new Error("No response body from Ollama");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let assistantId = (Date.now() + 1).toString();
    let assistantContent = "";

    // Append placeholder assistant message once using functional update
    updateMessages((prev) => ([
      ...prev,
      {
        id: assistantId,
        role: "assistant" as const,
        content: "",
        timestamp: new Date(),
      },
    ]));

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse server-sent lines (each line is a JSON object)
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.message && event.message.content) {
            assistantContent += event.message.content;
            // Update the assistant placeholder progressively using functional update
            updateMessages((prev) => prev.map((m) => (
              m.id === assistantId
                ? { ...m, content: assistantContent, timestamp: new Date() }
                : m
            )));
          }
          if (event.done) {
            break;
          }
        } catch (_e) {
          // Ignore malformed lines
        }
      }
    }
  } catch (_error) {
    const aiMessage: Message = {
      id: (Date.now() + 2).toString(),
      role: "assistant",
      content: "There was an error contacting the local model. Ensure Ollama is running on 127.0.0.1:11434 and the model qwen2.5-coder:7b is pulled (ollama pull qwen2.5-coder:7b).",
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
  status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error';
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
    content: "Hi! I'm Nyx, your analytics intern. Upload data, visualise motion-rich dashboard in seconds!",
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
        await generateAIResponse(content, null, updatedMessages, updateMessages);
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
      
      if (startResult.data?.success && startResult.data?.status === 'processing') {
        console.log('Processing started, beginning polling...');
        // Poll for completion
        const finalResult = await processingService.pollProcessingStatus(
          uploadedFile.fileID,
          (status) => {
            console.log('Polling status update:', status);

            if (status.data?.status === 'completed') {
              setUploadedFile({ ...uploadedFile, status: 'processed', processedData: status.data });
            } else if (status.data?.status === 'error') {
              setUploadedFile({ ...uploadedFile, status: 'error' });
            }
          },
          60, // max attempts (60 seconds)
          2000 // 2 second intervals
        );
        console.log('Final polling result:', finalResult);
        
        if (finalResult.data?.success && finalResult.data?.status === 'completed') {
          // Call the callback to pass processed data to parent component
          if (onProcessedDataChange) {
            onProcessedDataChange(finalResult.data);
          }
          // First successful generation: show initial loading for 10s, then mark shown
          if (!get().hasShownInitialDashboard) {
            set({ isInitialLoading: true });
            setTimeout(() => {
              set({ isInitialLoading: false, hasShownInitialDashboard: true });
            }, 10000);
          }
          
          // Check if this is the first user prompt with a file (fixed response logic)
          const hasUserPrompt = updatedMessages.some((m) => m.role === 'user');
          const hasFixedReply = updatedMessages.some((m) => m.id === '2');
          
          if (hasUserPrompt && !hasFixedReply) {
            // First user prompt with file - add fixed response
            updateMessages((prev) => ([
              ...prev,
              {
                id: '2',
                role: 'assistant',
                content: "Your dashboard has been created successfully! If you'd like to make any changes or customize the dashboard further, please let me know what you need.",
                timestamp: new Date(),
              }
            ]));
          } else {
            // Subsequent turns - generate AI response
            console.log('Subsequent turn - generating AI response');
            console.log('Updated messages before AI call:', updatedMessages.map(m => ({ id: m.id, role: m.role, content: m.content.substring(0, 50) })));
            await generateAIResponse(content, finalResult.data, updatedMessages, updateMessages);
          }
        } else {
          await generateAIResponse(content, null, updatedMessages, updateMessages);
        }
      } else {
        await generateAIResponse(content, null, updatedMessages, updateMessages);
      }
    } catch (error) {
      console.error('Processing error:', error);
      await generateAIResponse(content, null, updatedMessages, updateMessages);
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
