import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TelegramCodeResponse } from "@/api/chatIntegrationApi";
import { toast } from "@/components/ui/use-toast";

interface TelegramConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCode: TelegramCodeResponse | null;
  isConnected: boolean;
}

export function TelegramConnectModal({
  open,
  onOpenChange,
  pendingCode,
  isConnected,
}: TelegramConnectModalProps) {
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (pendingCode?.expires_in) {
      setTimeLeft(pendingCode.expires_in);
    }
  }, [pendingCode]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  useEffect(() => {
    if (isConnected && open) {
      toast({
        title: "Connected!",
        description: "Your Telegram account is now linked to Dreamify.",
      });
      onOpenChange(false);
    }
  }, [isConnected, open, onOpenChange]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleCopy = async () => {
    if (!pendingCode?.code) return;
    await navigator.clipboard.writeText(pendingCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!pendingCode) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-[#2AABEE]" />
            Connect Telegram
          </DialogTitle>
          <DialogDescription>
            Follow the steps below to link your account.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Step 1: Your Connection Code
            </label>
            <div className="relative flex items-center">
              <div className="w-full bg-muted/50 dark:bg-white/5 border border-border rounded-lg py-4 px-4 text-center font-mono text-2xl font-bold tracking-[0.2em] text-foreground">
                {pendingCode.code}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                onClick={handleCopy}
              >
                {copied ? (
                  <span className="text-[10px] font-medium text-emerald-500">
                    Done
                  </span>
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Step 2: Start the Bot
            </label>
            <p className="text-sm text-foreground/80">
              Open the bot and send: <br />
              <code className="bg-muted px-1.5 py-0.5 rounded text-primary">
                /start {pendingCode.code}
              </code>
            </p>
            <Button
              className="w-full bg-[#2AABEE] hover:bg-[#2AABEE]/90 text-white"
              asChild
            >
              <a
                href={pendingCode.deeplink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in Telegram
              </a>
            </Button>
          </div>

          <div className="pt-4 border-t border-border flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Waiting for connection...
            </div>
            <p className="text-xs text-muted-foreground">
              Code expires in {formatTime(timeLeft)}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
