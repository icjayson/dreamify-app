import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CornerRightUp, Upload, Bot, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign } from "lucide-react";

import { Message } from "@/types/message";
import { fileService, type UploadResponse } from "@/services/fileService";
import { processingService, type ProcessingResponse } from "@/services/processingService";
import { useToast } from "@/hooks/use-toast";

interface ChatInterfaceProps {
  messages: Message[];
  onMessagesChange: (messages: Message[]) => void;
  onProcessedDataChange?: (data: any) => void;
}

const ChatInterface = ({ messages, onMessagesChange, onProcessedDataChange }: ChatInterfaceProps) => {
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [attachedCsvName, setAttachedCsvName] = useState<string | null>(null);
  const [attachedCsvSummary, setAttachedCsvSummary] = useState<string | null>(null);
  const [attachedCsvRaw, setAttachedCsvRaw] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{
    fileID: string;
    filename: string;
    size: number;
    ext: string;
    status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error';
    processedData?: any;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const escapeHtml = (unsafe: string): string =>
    unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const parseMessageToHtml = (raw: string): string => {
    let html = escapeHtml(raw);
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

  const handleSend = async (csvSummaryOverride?: string) => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
      attachment: uploadedFile ? { kind: "csv", name: uploadedFile.filename } : undefined,
    };

    onMessagesChange([...messages, userMessage]);
    setInputValue("");
    setIsTyping(true);

    // If there's an uploaded file, process it with the user's prompt
    if (uploadedFile && uploadedFile.status === 'uploaded') {
      try {
        // Start processing with user prompt
        setUploadedFile(prev => prev ? { ...prev, status: 'processing' } : prev);
        
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
                setUploadedFile(prev => prev ? { ...prev, status: 'processed', processedData: status.data } : prev);
              } else if (status.data?.status === 'error') {
                setUploadedFile(prev => prev ? { ...prev, status: 'error' } : prev);
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
            await generateAIResponse(userMessage.content, finalResult.data);
          } else {
            await generateAIResponse(userMessage.content, null);
          }
        } else {
          await generateAIResponse(userMessage.content, null);
        }
      } catch (error) {
        await generateAIResponse(userMessage.content, null);
      }
    } else {
      // No file uploaded, generate normal AI response
      await generateAIResponse(userMessage.content, null);
    }
  };

  const generateAIResponse = async (userPrompt: string, processedData: any) => {
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
      const baseMessages = [...messages, { id: Date.now().toString(), role: "user" as const, content: userPrompt, timestamp: new Date() }];
      // Add placeholder assistant message once
      onMessagesChange([
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
              onMessagesChange([
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
      onMessagesChange([...messages, { id: Date.now().toString(), role: "user", content: userPrompt, timestamp: new Date() }, aiMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const getContextualResponse = (input: string): string => {
    const lowerInput = input.toLowerCase();
    
    // Data upload responses
    if (lowerInput.includes('upload') || lowerInput.includes('data') || lowerInput.includes('csv')) {
      return "Great! I can help you upload your data. Please drag your CSV, Excel, or JSON file here, or click the upload button. I support files up to 100MB and can automatically detect your data structure.";
    }
    
    // Revenue/MRR requests
    if (lowerInput.includes('revenue') || lowerInput.includes('mrr') || lowerInput.includes('sales')) {
      return "Perfect! I'll create a stunning revenue dashboard with animated line charts showing your growth trends. I can include MRR growth rates, cohort analysis, and forecasting. Should I also add conversion funnels?";
    }
    
    // Dashboard creation
    if (lowerInput.includes('dashboard') || lowerInput.includes('chart') || lowerInput.includes('visualiz')) {
      return "I'll build your interactive dashboard with smooth animations! I can create line charts, bar charts, funnels, and geographic visualizations. What specific metrics would you like to focus on first?";
    }
    
    // Animation/motion requests
    if (lowerInput.includes('animation') || lowerInput.includes('motion') || lowerInput.includes('smooth')) {
      return "Excellent! I'll add cinematic animations with staggered entrance effects, hover interactions, and smooth transitions. Your dashboard will have that premium feel with 60fps performance.";
    }
    
    // General responses
    const generalResponses = [
      "I can see you want to visualize your data beautifully! Let me create an interactive dashboard with motion effects. What type of data are you working with?",
      "Perfect! I'll help you build a stunning analytics dashboard. I can handle revenue metrics, user engagement, conversion funnels, and more. What's your primary use case?",
      "Great question! I specialize in creating motion-rich dashboards that tell compelling data stories. Should I start with your key performance indicators?",
      "I'll transform your raw data into beautiful, animated visualizations. Do you have existing data to upload, or should I create a demo with sample metrics?"
    ];
    
    return generalResponses[Math.floor(Math.random() * generalResponses.length)];
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

  const validateClientFile = (file: File): string | null => {
    const sizeLimit = 50 * 1024 * 1024;
    if (file.size > sizeLimit) return "File too large. Maximum size: 50MB";
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowed = ["csv","xlsx","xls","json"];
    if (!ext || !allowed.includes(ext)) return "Invalid file type. Supported: CSV, XLSX, XLS, JSON";
    return null;
  };

  const removeUploadedFile = async (fileID: string) => {
    try {
      await fileService.deleteFile(fileID);
    } catch (_e) {
      // best-effort; ignore
    }
    setUploadedFile(null);
  };

  const parseCsvToSummary = async (file: File): Promise<string> => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const maxPreviewRows = 20;
    const previewLines = lines.slice(0, maxPreviewRows + 1);
    const splitCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let curr = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            curr += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          result.push(curr);
          curr = "";
        } else {
          curr += ch;
        }
      }
      result.push(curr);
      return result.map(s => s.trim());
    };

    const rows = previewLines.map(splitCsvLine);
    const header = rows[0] || [];
    const sampleRows = rows.slice(1);
    const totalRows = lines.length > 0 ? lines.length - 1 : 0;

    const sampleRendered = sampleRows
      .slice(0, maxPreviewRows)
      .map(r => r.join(" | "))
      .join("\n");

    const summary = [
      "[CSV SUMMARY]",
      `File: ${file.name}`,
      `Total rows (excluding header): ${totalRows}`,
      `Columns (${header.length}): ${header.join(", ")}`,
      "Sample (first rows):",
      sampleRendered,
    ].join("\n");

    return summary;
  };

  const readCsvRawPreview = async (file: File): Promise<string> => {
    const maxChars = 200_000;
    const text = await file.text();
    return text.slice(0, maxChars);
  };

  const clearAttachment = () => {
    setAttachedCsvName(null);
    setAttachedCsvSummary(null);
    setAttachedCsvRaw(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const suggestedPrompts = [
    { text: "Upload my sales data and create MRR dashboard", icon: Database },
    { text: "Show revenue trends with smooth animations", icon: TrendingUp },
    { text: "Create conversion funnel visualization", icon: BarChart3 },
    { text: "Build customer growth dashboard", icon: Users },
    { text: "Analyze profit margins by product", icon: DollarSign },
    { text: "Add geographic revenue distribution", icon: Sparkles }
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-5 h-5 text-accent" />
          <span className="font-medium">AI Assistant</span>
          <Badge variant="outline" className="ml-auto text-xs">Online</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Describe your dashboard vision and I'll build it with beautiful animations
        </p>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-enter flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[85%] flex gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                message.role === "user" 
                  ? "bg-primary/20" 
                  : "bg-accent/20"
              }`}>
                {message.role === "user" ? (
                  <User className="w-3 h-3 text-primary" />
                ) : (
                  <Bot className="w-3 h-3 text-accent" />
                )}
              </div>
              
              <Card className={`p-3 glass-panel text-sm whitespace-pre-wrap break-words ${
                message.role === "user" 
                  ? "bg-primary/10 border-primary/20" 
                  : "bg-card/80 border-border/50"
              }`}>
                {message.attachment && message.attachment.kind === "csv" && (
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Attached CSV: {message.attachment.name}
                  </div>
                )}
                <div
                  className="leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere]"
                  dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }}
                />
                <span className="text-xs text-muted-foreground mt-1 block">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </Card>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start chat-enter">
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-md bg-accent/20 flex items-center justify-center">
                <Bot className="w-3 h-3 text-accent" />
              </div>
              <Card className="p-3 glass-panel bg-card/80 border-border/50">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm text-accent">AI is analyzing...</span>
                </div>
              </Card>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompts */}
      {messages.length <= 1 && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground mb-2">Quick starts:</p>
          <div className="grid grid-cols-1 gap-1">
            {suggestedPrompts.slice(0, 3).map((prompt, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors p-2 justify-start h-auto text-xs"
                onClick={() => setInputValue(prompt.text)}
              >
                <prompt.icon className="w-3 h-3 mr-1 flex-shrink-0" />
                <span className="text-left">{prompt.text}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* File Chip Area */}
      {uploadedFile && (
        <div className="px-4 pb-2">
          <Card className="p-2 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{uploadedFile.ext.toUpperCase()}</Badge>
              <span className="font-medium">{uploadedFile.filename}</span>
              <span className="text-muted-foreground">{(uploadedFile.size/1024/1024).toFixed(2)} MB</span>
              {uploadedFile.status === 'uploading' && <span className="text-muted-foreground">Uploading…</span>}
              {uploadedFile.status === 'processing' && <span className="text-blue-500">Processing…</span>}
              {uploadedFile.status === 'processed' && <span className="text-green-500">Processed</span>}
              {uploadedFile.status === 'error' && <span className="text-red-500">Error</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/v1/files/preview/${uploadedFile.fileID}`, '_blank')}
                disabled={uploadedFile.status === 'uploading' || uploadedFile.status === 'processing'}
              >
                Preview
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeUploadedFile(uploadedFile.fileID)}
              >
                Remove
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-border/50 bg-card/30">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Describe your dashboard..."
              className="pr-10 h-9 bg-background/50 border-border/50 focus:border-primary text-sm"
            />
            <Button
              onClick={handleFileUpload}
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-primary/20"
            >
              <Upload className="w-3 h-3" />
            </Button>
          </div>
          
          <Button
            onClick={() => handleSend()}
            className="btn-primary-gradient h-9 px-3"
            disabled={!inputValue.trim() || isTyping}
          >
            <CornerRightUp className="w-3 h-3" />
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.xlsx,.xls"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const validationError = validateClientFile(file);
            if (validationError) {
              toast({ title: "Upload error", description: validationError, variant: "destructive" });
              return;
            }
            try {
              // Replace behavior: if an uploaded file exists, we'll delete it after new upload succeeds
              setUploadedFile({ fileID: 'pending', filename: file.name, size: file.size, ext: (file.name.split('.').pop() || '').toLowerCase(), status: 'uploading' });

              const res: UploadResponse = await fileService.uploadFile(file);
              if (!res.success || !res.fileID || !res.ext || res.size === undefined || !res.filename) {
                setUploadedFile(prev => prev ? { ...prev, status: 'error' } : prev);
                toast({ title: "Upload failed", description: res.error || 'Upload failed', variant: "destructive" });
                return;
              }

              // Delete previous file if different
              if (uploadedFile && uploadedFile.fileID && uploadedFile.fileID !== 'pending') {
                void fileService.deleteFile(uploadedFile.fileID);
              }

              setUploadedFile({ fileID: res.fileID, filename: res.filename, size: res.size, ext: res.ext, status: 'uploaded' });
              toast({ title: "File uploaded", description: `${res.filename} uploaded successfully. You can now ask questions about your data.` });
            } catch (_e) {
              setUploadedFile(prev => prev ? { ...prev, status: 'error' } : prev);
              toast({ title: "Upload error", description: "Failed to upload file. Please try again.", variant: "destructive" });
            }
          }}
        />
      </div>
    </div>
  );
};

export default ChatInterface;