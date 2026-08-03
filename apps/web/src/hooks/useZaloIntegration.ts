import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/clerk";
import {
  chatIntegrationApi,
  type ZaloCodeResponse,
  type ZaloStatusResponse,
} from "@/api/chatIntegrationApi";

export const useZaloIntegration = () => {
  const { isSignedIn } = useAuth();
  const [workspace, setWorkspace] = useState<ZaloStatusResponse>({ connected: false });
  const [pendingCode, setPendingCode] = useState<ZaloCodeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setWorkspace({ connected: false });
      return;
    }
    try {
      setIsLoading(true);
      const status = await chatIntegrationApi.getZaloStatus();
      setWorkspace(status);
      if (status.connected) {
        setPendingCode(null);
        stopPolling();
      }
    } catch (err) {
      console.error("Failed to fetch Zalo status:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await chatIntegrationApi.getZaloStatus();
        if (status.connected) {
          setWorkspace(status);
          setPendingCode(null);
          stopPolling();
        }
      } catch {
        // ignore transient errors during polling
      }
    }, 3000);
  }, [stopPolling]);

  const connect = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      const codeData = await chatIntegrationApi.generateZaloCode();
      setPendingCode(codeData);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Zalo connection");
    } finally {
      setIsConnecting(false);
    }
  };

  const cancelPending = () => {
    setPendingCode(null);
    stopPolling();
  };

  const disconnect = async () => {
    if (!workspace.platform_workspace_id) return;
    try {
      setIsDisconnecting(true);
      setError(null);
      await chatIntegrationApi.disconnectZalo(workspace.platform_workspace_id);
      setWorkspace({ connected: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Zalo");
    } finally {
      setIsDisconnecting(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clean up polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  return {
    workspace,
    pendingCode,
    isLoading,
    isConnecting,
    isDisconnecting,
    error,
    connect,
    cancelPending,
    disconnect,
    refresh,
  };
};
