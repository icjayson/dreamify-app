import { CheckCircle2, ExternalLink, Loader2, Unlink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useZaloIntegration } from "@/hooks/useZaloIntegration";
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

export function ZaloLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M12.49 10.2722v-.4496h1.3467v6.3218h-.7704a.576.576 0 01-.5763-.5729l-.0006.0005a3.273 3.273 0 01-1.9372.6321c-1.8138 0-3.2844-1.4697-3.2844-3.2823 0-1.8125 1.4706-3.2822 3.2844-3.2822a3.273 3.273 0 011.9372.6321l.0006.0005zM6.9188 7.7896v.205c0 .3823-.051.6944-.2995 1.0605l-.03.0343c-.0542.0615-.1815.206-.2421.2843L2.024 14.8h4.8948v.7682a.5764.5764 0 01-.5767.5761H0v-.3622c0-.4436.1102-.6414.2495-.8476L4.8582 9.23H.1922V7.7896h6.7266zm8.5513 8.3548a.4805.4805 0 01-.4803-.4798v-7.875h1.4416v8.3548H15.47zM20.6934 9.6C22.52 9.6 24 11.0807 24 12.9044c0 1.8252-1.4801 3.306-3.3066 3.306-1.8264 0-3.3066-1.4808-3.3066-3.306 0-1.8237 1.4802-3.3044 3.3066-3.3044zm-10.1412 5.253c1.0675 0 1.9324-.8645 1.9324-1.9312 0-1.065-.865-1.9295-1.9324-1.9295s-1.9324.8644-1.9324 1.9295c0 1.0667.865 1.9312 1.9324 1.9312zm10.1412-.0033c1.0737 0 1.945-.8707 1.945-1.9453 0-1.073-.8713-1.9436-1.945-1.9436-1.0753 0-1.945.8706-1.945 1.9436 0 1.0746.8697 1.9453 1.945 1.9453z" />
    </svg>
  );
}
