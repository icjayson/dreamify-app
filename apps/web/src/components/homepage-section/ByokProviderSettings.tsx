import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  providerConnectionService,
  type ModelProvider,
  type ProviderConnectionStatus,
} from "@/services/providerConnectionService";

const PROVIDERS: Array<{
  id: ModelProvider;
  label: string;
  defaultModel: string;
}> = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5.6" },
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-3.6-flash" },
];

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Provider settings could not be updated";
}

export function ByokProviderSettings() {
  const [status, setStatus] = useState<ProviderConnectionStatus | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<ModelProvider, string>>({ openai: "", gemini: "" });
  const [models, setModels] = useState<Record<ModelProvider, string>>({
    openai: PROVIDERS[0].defaultModel,
    gemini: PROVIDERS[1].defaultModel,
  });
  const [busyProvider, setBusyProvider] = useState<ModelProvider | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await providerConnectionService.list();
      setStatus(next);
      setModels((current) => ({
        ...current,
        ...Object.fromEntries(next.connections.map((item) => [item.provider, item.model])),
      }));
    } catch (failure) {
      setError(messageFrom(failure));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connections = useMemo(
    () => new Map(status?.connections.map((item) => [item.provider, item]) ?? []),
    [status],
  );

  const configure = async (provider: ModelProvider) => {
    setBusyProvider(provider);
    setError(null);
    setNotice(null);
    try {
      await providerConnectionService.configure(provider, apiKeys[provider], models[provider]);
      setApiKeys((current) => ({ ...current, [provider]: "" }));
      setNotice(`${provider === "openai" ? "OpenAI" : "Gemini"} verified and activated.`);
      await refresh();
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      setBusyProvider(null);
    }
  };

  const activate = async (provider: ModelProvider) => {
    setBusyProvider(provider);
    setError(null);
    try {
      await providerConnectionService.activate(provider);
      await refresh();
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      setBusyProvider(null);
    }
  };

  const remove = async (provider: ModelProvider) => {
    if (!window.confirm("Remove this model credential? Active runs must finish first.")) return;
    setBusyProvider(provider);
    setError(null);
    try {
      await providerConnectionService.remove(provider);
      await refresh();
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-medium text-foreground dark:text-white">
            {status?.model_mode === "byok" ? "BYOK model active" : "Deterministic demo model active"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground dark:text-white/50">
            Keys are encrypted by the API and are never returned to this browser after saving.
          </p>
        </div>
      </div>

      {status && !status.byok_configurable && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          BYOK is unavailable until the deployment owner configures the server encryption keyring.
        </p>
      )}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const connection = connections.get(provider.id);
          const busy = busyProvider === provider.id;
          return (
            <div key={provider.id} className="rounded-xl border border-border/60 p-4 dark:border-white/10">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground dark:text-white">{provider.label}</span>
                </div>
                {connection?.is_active && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Active
                  </span>
                )}
              </div>
              <label className="mb-1 block text-xs text-muted-foreground">Model</label>
              <input
                value={models[provider.id]}
                onChange={(event) => setModels((current) => ({ ...current, [provider.id]: event.target.value }))}
                className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-white"
                autoComplete="off"
                spellCheck={false}
              />
              <label className="mb-1 block text-xs text-muted-foreground">
                {connection ? "Replace API key" : "API key"}
              </label>
              <input
                type="password"
                value={apiKeys[provider.id]}
                onChange={(event) => setApiKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                placeholder={connection ? "Enter a new key to replace" : "Enter provider API key"}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-white"
                autoComplete="new-password"
                spellCheck={false}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !apiKeys[provider.id] || !status?.byok_configurable}
                  onClick={() => void configure(provider.id)}
                  className="button-gradient h-8 px-3 text-xs"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : connection ? "Replace & verify" : "Verify & use"}
                </Button>
                {connection && !connection.is_active && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void activate(provider.id)} className="h-8 text-xs">
                    Use this provider
                  </Button>
                )}
                {connection && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(provider.id)} className="h-8 px-2 text-red-500 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Remove {provider.label}</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
