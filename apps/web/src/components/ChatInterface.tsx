import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, Upload, Bot, User, Sparkles, BarChart3, FileText, Database, TrendingUp, Users, DollarSign } from "lucide-react";

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

    // Enhanced AI responses based on user stories
    setTimeout(() => {
      const responses = getContextualResponse(inputValue.trim());
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant", 
        content: responses,
        timestamp: new Date()
      };

      onMessagesChange([...messages, userMessage, aiMessage]);
      setIsTyping(false);
    }, 1500);
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
              
              <Card className={`p-3 glass-panel text-sm ${
                message.role === "user" 
                  ? "bg-primary/10 border-primary/20" 
                  : "bg-card/80 border-border/50"
              }`}>
                <p className="leading-relaxed">{message.content}</p>
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
            onClick={handleSend}
            className="btn-primary-gradient h-9 px-3"
            disabled={!inputValue.trim() || isTyping}
          >
            <Send className="w-3 h-3" />
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
              setInputValue(`I want to upload and analyze: ${fileName}`);
            }
          }}
        />
      </div>
    </div>
  );
};

export default ChatInterface;