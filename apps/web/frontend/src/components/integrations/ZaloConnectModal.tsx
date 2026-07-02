import { useEffect, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { ZaloLogo } from "./ChatPlatformLogos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveChatApiAssetUrl, type ZaloCodeResponse } from "@/api/chatIntegrationApi";
import { toast } from "@/components/ui/use-toast";

interface ZaloConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCode: ZaloCodeResponse | null;
  isConnected: boolean;
}

export function ZaloConnectModal({
  open,
  onOpenChange,
  pendingCode,
  isConnected,
}: ZaloConnectModalProps) {
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    if (pendingCode?.expires_in) {
      setTimeLeft(pendingCode.expires_in);
    }
  }, [pendingCode]);

  useEffect(() => {
    setQrFailed(false);
  }, [pendingCode?.qr_url]);

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
        description: "Your Zalo account is now linked to Dreamify.",
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

  const startCommand = `start ${pendingCode.code}`;
  const qrUrl = resolveChatApiAssetUrl(pendingCode.qr_url);

  const handleCopyCommand = async () => {
    if (!startCommand) return;
    await navigator.clipboard.writeText(startCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-sm overflow-hidden flex items-center justify-center bg-[#0068FF]">
              <ZaloLogo />
            </div>
            Connect Zalo
          </DialogTitle>
          <DialogDescription>
            Scan the QR code with the Zalo app, then send the start command to the bot.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Step 1: Open the Bot in Zalo
            </label>
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-lg border border-border w-52 h-52 flex items-center justify-center">
                {qrFailed ? (
                  <p className="px-3 text-center text-xs leading-relaxed text-slate-600">
                    QR code could not load. Search for the bot in Zalo, then send the start command below.
                  </p>
                ) : (
                  <img
                    src={qrUrl}
                    alt="Zalo bot QR code"
                    className="w-full h-full object-contain"
                    onError={() => setQrFailed(true)}
                  />
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Or search <code className="bg-muted px-1.5 py-0.5 rounded">@{pendingCode.bot_username}</code> in Zalo
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
                onClick={handleCopyCommand}
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
