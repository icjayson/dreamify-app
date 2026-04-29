import { CheckCircle2, ExternalLink, Loader2, Unlink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTelegramIntegration } from "@/hooks/useTelegramIntegration";
import { TelegramConnectModal } from "./TelegramConnectModal";

export function TelegramIntegrationCard() {
  const {
    workspace,
    pendingCode,
    isLoading,
    isConnecting,
    isDisconnecting,
    connect,
    disconnect,
  } = useTelegramIntegration();
  const [modalOpen, setModalOpen] = useState(false);

  const handleConnect = async () => {
    await connect();
    setModalOpen(true);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        {/* Left: logo + text */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#2AABEE]">
            <TelegramLogo />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm text-foreground">Telegram</h3>
              {workspace.connected && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Connected
                </span>
              )}
            </div>
            {isLoading ? (
              <span className="text-xs text-muted-foreground">Checking…</span>
            ) : workspace.connected ? (
              <span className="text-xs text-muted-foreground">{workspace.workspace_name}</span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Use Dreamify in Telegram chats and groups
              </span>
            )}
          </div>
        </div>

        {/* Right: action */}
        {isLoading ? null : workspace.connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={disconnect}
            disabled={isDisconnecting}
            className="text-xs text-muted-foreground flex-shrink-0"
          >
            {isDisconnecting ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Unlink className="w-3 h-3 mr-1" />
            )}
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting}
            className="text-xs whitespace-nowrap flex-shrink-0"
          >
            {isConnecting ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <ExternalLink className="w-3 h-3 mr-1" />
            )}
            Connect Telegram
          </Button>
        )}
      </div>

      <TelegramConnectModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        pendingCode={pendingCode}
        isConnected={workspace.connected}
      />
    </Card>
  );
}

function TelegramLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.944 0A12 12 0 1 0 23.888 12 12 12 0 0 0 11.944 0zm5.95 7.674l-2.014 9.49c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.877.73z" />
    </svg>
  );
}
