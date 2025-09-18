import { create } from 'zustand';
import { Message } from '@/types/message';
import { processingService } from '@/services/processingService';

// Helper function for AI response generation
const generateAIResponse = async (userPrompt: string, processedData: any, messages: Message[], setMessages: (messages: Message[]) => void) => {
  // Stream response from local Ollama (proxied via /ollama)
  try {
    const controller = new AbortController();
    const signal = controller.signal;
    
    // Build system messages based on processed data
    const systemMessages = [];
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
          ...messages.map((m) => ({ role: m.role, content: m.content })),
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

    // Establish a stable base array to avoid jittery re-renders
    const baseMessages = [...messages];
    // Add placeholder assistant message once
    setMessages([
      ...baseMessages,
      {
        id: assistantId,
        role: "assistant" as const,
        content: "",
        timestamp: new Date(),
      },
    ]);

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
            // Update the last assistant message progressively based on the stable base
            setMessages([
              ...baseMessages,
              {
                id: assistantId,
                role: "assistant" as const,
                content: assistantContent,
                timestamp: new Date(),
              },
            ]);
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
    setMessages([...messages, aiMessage]);
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
    const { uploadedFile, setUploadedFile, setIsProcessing, setIsTyping, addMessage, setMessages, messages } = state;
    
    if (!uploadedFile || uploadedFile.status !== 'uploaded') {
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
          // Generate AI response based on processed data and user prompt
          await generateAIResponse(content, finalResult.data, messages, setMessages);
        } else {
          await generateAIResponse(content, null, messages, setMessages);
        }
      } else {
        await generateAIResponse(content, null, messages, setMessages);
      }
    } catch (error) {
      console.error('Processing error:', error);
      await generateAIResponse(content, null, messages, setMessages);
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
