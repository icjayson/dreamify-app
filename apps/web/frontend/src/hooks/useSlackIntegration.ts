import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { chatIntegrationApi, type SlackStatusResponse } from "@/api/chatIntegrationApi";

export const useSlackIntegration = () => {
  const { isSignedIn } = useAuth();
  const [workspace, setWorkspace] = useState<SlackStatusResponse>({ connected: false });
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setWorkspace({ connected: false });
      return;
    }
    try {
      setIsLoading(true);
      const status = await chatIntegrationApi.getSlackStatus();
      setWorkspace(status);
    } catch (err) {
      console.error("Failed to fetch Slack status:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn]);

  const connect = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      const url = await chatIntegrationApi.getSlackAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Slack connection");
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!workspace.platform_workspace_id) return;
    try {
      setIsDisconnecting(true);
      setError(null);
      await chatIntegrationApi.disconnectSlack(workspace.platform_workspace_id);
      setWorkspace({ connected: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Slack");
    } finally {
      setIsDisconnecting(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { workspace, isLoading, isConnecting, isDisconnecting, error, connect, disconnect, refresh };
};
