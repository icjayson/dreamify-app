import { ExternalLink, Loader2, CheckCircle2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSlackIntegration } from "@/hooks/useSlackIntegration";
import { SlackLogo } from "./ChatPlatformLogos";

export function SlackIntegrationCard() {
  const { workspace, isLoading, isConnecting, isDisconnecting, connect, disconnect } =
    useSlackIntegration();

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        {/* Left: logo + text */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#4A154B]">
            <SlackLogo />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm text-foreground">Slack</h3>
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
                Bring Dreamify into your Slack workspace
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
            className="text-xs text-muted-foreground"
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
            onClick={connect}
            disabled={isConnecting}
            className="text-xs whitespace-nowrap"
          >
            {isConnecting ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <ExternalLink className="w-3 h-3 mr-1" />
            )}
            Add to Slack
          </Button>
        )}
      </div>
    </Card>
  );
}
