import { create } from 'zustand';
import { Message } from '@/types/message';

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
  
  // Complex actions
  sendMessage: (content: string) => void;
  clearInput: () => void;
  resetChat: () => void;
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hi! I'm Vibe, your analytics assistant. Upload your data and let's create a stunning dashboard with motion in minutes! What would you like to visualize today?",
    timestamp: new Date()
  }
];

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  inputValue: "",
  isTyping: false,
  messages: initialMessages,
  uploadedFile: null,
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
  
  resetChat: () => set({
    inputValue: "",
    isTyping: false,
    messages: initialMessages,
    uploadedFile: null,
    dropdownOpen: false,
    selectedDataSource: "",
    isListening: false,
    transcript: "",
    detectedLanguage: null,
  }),
}));
