import { CheckCircle2, ExternalLink, Loader2, Unlink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useZaloIntegration } from "@/hooks/useZaloIntegration";
import { ZaloLogo } from "./ChatPlatformLogos";
import { ZaloConnectModal } from "./ZaloConnectModal";

export function ZaloIntegrationCard() {
  const {
    workspace,
    pendingCode,
    isLoading,
    isConnecting,
    isDisconnecting,
    connect,
    disconnect,
  } = useZaloIntegration();
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
          <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#0068FF]">
            <ZaloLogo />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm text-foreground">Zalo</h3>
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
                Use Dreamify in Zalo direct messages
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
            Connect Zalo
          </Button>
        )}
      </div>

      <ZaloConnectModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        pendingCode={pendingCode}
        isConnected={workspace.connected}
      />
    </Card>
  );
}
