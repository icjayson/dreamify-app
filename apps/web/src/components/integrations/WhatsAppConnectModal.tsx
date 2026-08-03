import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { WhatsAppLogo } from "./ChatPlatformLogos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveChatApiAssetUrl, type WhatsAppCodeResponse } from "@/api/chatIntegrationApi";
import { toast } from "@/components/ui/use-toast";

interface WhatsAppConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCode: WhatsAppCodeResponse | null;
  isConnected: boolean;
}

export function WhatsAppConnectModal({
  open,
  onOpenChange,
  pendingCode,
  isConnected,
}: WhatsAppConnectModalProps) {
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
        description: "Your WhatsApp account is now linked to Dreamify.",
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
            <div className="w-5 h-5 rounded-sm overflow-hidden flex items-center justify-center bg-[#25D366]">
              <WhatsAppLogo />
            </div>
            Connect WhatsApp
          </DialogTitle>
          <DialogDescription>
            Open the chat with the Dreamify bot and send the start command — on
            mobile, scan the QR; on desktop, tap the button below.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Step 1: Open the Bot in WhatsApp
            </label>
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-lg border border-border w-52 h-52 flex items-center justify-center">
                {qrFailed ? (
                  <p className="px-3 text-center text-xs leading-relaxed text-slate-600">
                    QR code could not load. Use the button below or send the start command manually.
                  </p>
                ) : (
                  <img
                    src={qrUrl}
                    alt="WhatsApp bot QR code"
                    className="w-full h-full object-contain"
                    onError={() => setQrFailed(true)}
                  />
                )}
              </div>
            </div>
            <div className="flex justify-center">
              <a href={pendingCode.deeplink} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="text-xs">
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Open in WhatsApp
                </Button>
              </a>
            </div>
            {pendingCode.phone_number && (
              <p className="text-xs text-muted-foreground text-center">
                Or message{" "}
                <code className="bg-muted px-1.5 py-0.5 rounded">
                  +{pendingCode.phone_number}
                </code>{" "}
                on WhatsApp
              </p>
            )}
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
            <p className="text-xs text-muted-foreground">
              Tapping the QR or button pre-fills this message — just press send.
            </p>
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
