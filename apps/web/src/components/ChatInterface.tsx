import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, Upload, Bot, User, Sparkles, BarChart3, FileText } from "lucide-react";

import { Message } from "@/types/message";

interface ChatInterfaceProps {
  messages: Message[];
  onMessagesChange: (messages: Message[]) => void;
}

const ChatInterface = ({ messages, onMessagesChange }: ChatInterfaceProps) => {
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date()
    };

    onMessagesChange([...messages, userMessage]);
    setInputValue("");
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const responses = [
        "I'll help you create a beautiful dashboard! Let me analyze your request and suggest some stunning visualizations with smooth animations.",
        "Perfect! I can see you want to visualize sales data. I'll create an interactive revenue chart with motion effects. Would you like to add any specific filters or time ranges?",
        "Great choice! I'm generating a funnel visualization with cascade animations. This will show your conversion rates beautifully. Should I include growth indicators?",
        "Excellent! I've added smooth transitions to your chart. The data flows naturally now. Would you like me to enhance the color scheme or add more interactive elements?"
      ];

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: responses[Math.floor(Math.random() * responses.length)],
        timestamp: new Date()
      };

      onMessagesChange([...messages, userMessage, aiMessage]);
      setIsTyping(false);
    }, 1500);
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

  const suggestedPrompts = [
    { text: "Create a revenue chart with animations", icon: BarChart3 },
    { text: "Show me funnel conversion rates", icon: Sparkles },
    { text: "Upload my sales data", icon: FileText }
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-enter flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[80%] flex gap-3 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                message.role === "user" 
                  ? "bg-primary/20" 
                  : "bg-accent/20"
              }`}>
                {message.role === "user" ? (
                  <User className="w-4 h-4 text-primary" />
                ) : (
                  <Bot className="w-4 h-4 text-accent" />
                )}
              </div>
              
              <Card className={`p-4 glass-panel ${
                message.role === "user" 
                  ? "bg-primary/10 border-primary/20" 
                  : "bg-accent/10 border-accent/20"
              }`}>
                <p className="text-sm leading-relaxed">{message.content}</p>
                <span className="text-xs text-muted-foreground mt-2 block">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </Card>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start chat-enter">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-accent" />
              </div>
              <Card className="p-4 glass-panel bg-accent/10 border-accent/20">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-accent rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm text-accent">AI is thinking...</span>
                </div>
              </Card>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompts */}
      {messages.length <= 1 && (
        <div className="px-6 pb-4">
          <p className="text-sm text-muted-foreground mb-3">Try these to get started:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedPrompts.map((prompt, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors p-2"
                onClick={() => setInputValue(prompt.text)}
              >
                <prompt.icon className="w-3 h-3 mr-1" />
                {prompt.text}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-6 border-t border-border/50 glass-panel">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Describe the dashboard you want to create..."
              className="pr-20 h-12 bg-background/50 border-border/50 focus:border-primary"
            />
            <Button
              onClick={handleFileUpload}
              variant="ghost"
              size="sm"
              className="absolute right-12 top-1/2 -translate-y-1/2 h-8 w-8 p-0 hover:bg-primary/20"
            >
              <Upload className="w-4 h-4" />
            </Button>
          </div>
          
          <Button
            onClick={handleSend}
            className="btn-primary-gradient h-12 px-6"
            disabled={!inputValue.trim() || isTyping}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.xlsx"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              const fileName = e.target.files[0].name;
              setInputValue(`Upload file: ${fileName}`);
            }
          }}
        />
      </div>
    </div>
  );
};

export default ChatInterface;