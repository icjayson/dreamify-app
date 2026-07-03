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

const TELEGRAM_QR_IMAGE_PATH = "/integrations/telegram-dreamify-bot-qr.svg";
const TELEGRAM_BOT_URL = "https://t.me/Dreamify_TelegramBot";

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

  if (!pendingCode) return null;

  const startCommand = `/start ${pendingCode.code}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(startCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-[#2AABEE]" />
            Connect Telegram
          </DialogTitle>
          <DialogDescription>
            Scan the QR code or open the bot, then send the start command.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Step 1: Scan the Bot QR
            </label>
            <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
              <img
                src={TELEGRAM_QR_IMAGE_PATH}
                alt="Dreamify Telegram bot QR code"
                className="mx-auto h-56 w-56 object-contain"
              />
            </div>
            <Button
              className="w-full bg-[#2AABEE] hover:bg-[#2AABEE]/90 text-white"
              asChild
            >
              <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
                Open Telegram Bot
              </a>
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              If scanning does not open the bot, search @{pendingCode.bot_username} in Telegram.
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Step 2: Send this Message to the Bot
            </label>
            <div className="relative flex items-center">
              <div className="w-full bg-muted/50 dark:bg-white/5 border border-border rounded-lg py-3 px-4 text-center font-mono text-base text-foreground">
                {startCommand}
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
            <Button
              variant="outline"
              className="w-full"
              asChild
            >
              <a
                href={pendingCode.deeplink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-4 h-4" />
                Open with Start Code
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
