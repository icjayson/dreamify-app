import { useCallback, useEffect, useState } from "react";

import { CONNECTORS } from "@/constants/connectors";
import { api } from "@/services/api";

export interface ConnectorCapability {
  enabled: boolean;
  connected?: boolean;
  reason?: string | null;
}

export interface DreamifyCapabilities {
  profile: "hobby_demo" | string;
  billing: { enabled: boolean; label: string };
  model: {
    mode: "demo" | "byok" | string;
    active_provider: "demo" | "openai" | "gemini" | string;
    providers: string[];
  };
  connectors: Record<string, ConnectorCapability>;
  features: Record<string, ConnectorCapability>;
  limits: {
    max_file_bytes: number;
    max_files_per_run: number;
    max_total_run_bytes: number;
    max_rows_per_file: number;
    max_columns_per_file: number;
    max_dashboard_bytes: number;
    max_database_bytes: number;
    data_runs_per_user_per_day: number;
    text_runs_per_user_per_day: number;
  };
}

const unavailableConnectors = Object.fromEntries(
  CONNECTORS.flatMap((connector) => connector.connectorKey
    ? [[connector.connectorKey, {
      enabled: false,
      connected: false,
      reason: "This connector has not been certified for the Hobby demo",
    }] as const]
    : []),
);

export const FALLBACK_CAPABILITIES: DreamifyCapabilities = {
  profile: "hobby_demo",
  billing: { enabled: false, label: "Free Preview" },
  model: { mode: "demo", active_provider: "demo", providers: ["demo"] },
  connectors: {
    ...unavailableConnectors,
    file_upload: { enabled: true, connected: true },
  },
  features: {
    billing: { enabled: false, reason: "Billing is disabled for the Hobby demo" },
    connectors: { enabled: false, reason: "External connectors require certification" },
    scheduling: { enabled: false, reason: "Scheduling is disabled for the Hobby demo" },
  },
  limits: {
    max_file_bytes: 10 * 1024 * 1024,
    max_files_per_run: 3,
    max_total_run_bytes: 25 * 1024 * 1024,
    max_rows_per_file: 100_000,
    max_columns_per_file: 200,
    max_dashboard_bytes: 1024 * 1024,
    max_database_bytes: 350 * 1024 * 1024,
    data_runs_per_user_per_day: 5,
    text_runs_per_user_per_day: 20,
  },
};

interface ApiCapabilities extends Omit<Partial<DreamifyCapabilities>, "limits"> {
  features?: Record<string, ConnectorCapability>;
  limits?: Partial<DreamifyCapabilities["limits"]> & { max_upload_bytes?: number };
}

export function normalizeCapabilities(input: ApiCapabilities): DreamifyCapabilities {
  const billingFeature = input.features?.billing;
  const connectorsFeature = input.features?.connectors;
  return {
    ...FALLBACK_CAPABILITIES,
    ...input,
    profile: input.profile ?? "hobby_demo",
    billing: {
      ...FALLBACK_CAPABILITIES.billing,
      ...input.billing,
      ...(billingFeature ? { enabled: billingFeature.enabled } : {}),
    },
    model: { ...FALLBACK_CAPABILITIES.model, ...input.model },
    connectors: {
      ...FALLBACK_CAPABILITIES.connectors,
      ...input.connectors,
      ...(connectorsFeature ? { external: connectorsFeature } : {}),
    },
    features: {
      ...FALLBACK_CAPABILITIES.features,
      ...input.features,
    },
    limits: {
      ...FALLBACK_CAPABILITIES.limits,
      ...input.limits,
      ...(input.limits?.max_upload_bytes ? { max_file_bytes: input.limits.max_upload_bytes } : {}),
    },
  };
}

export function featureCapability(
  capabilities: DreamifyCapabilities,
  feature: string,
): ConnectorCapability {
  return capabilities.features[feature]
    ?? { enabled: false, connected: false, reason: "Feature unavailable" };
}

export function connectorCapability(
  capabilities: DreamifyCapabilities,
  connectorKey?: string,
): ConnectorCapability {
  if (!connectorKey) {
    return { enabled: false, connected: false, reason: "No connector implementation is available" };
  }
  return capabilities.connectors[connectorKey]
    ?? capabilities.connectors.external
    ?? { enabled: false, connected: false, reason: "Connector unavailable" };
}

interface ConnectorOpenResult {
  availability: ConnectorCapability;
  scheduled: boolean;
}

export function scheduleCertifiedConnectorOpen(
  capabilities: DreamifyCapabilities,
  connectorParam: string,
  openModal: ((open: boolean) => void) | undefined,
  schedule: (callback: () => void) => void = (callback) => {
    setTimeout(callback, 500);
  },
): ConnectorOpenResult {
  const connectorKey = connectorParam.replace(/-/g, "_");
  const availability = connectorCapability(capabilities, connectorKey);
  if (!openModal || !availability.enabled) {
    return { availability, scheduled: false };
  }

  schedule(() => openModal(true));
  return { availability, scheduled: true };
}

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState(FALLBACK_CAPABILITIES);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<unknown>("/api/v1/capabilities", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.success || !response.data) return;
      setCapabilities(normalizeCapabilities(response.data as ApiCapabilities));
    } catch {
      // A frontend-only preview remains usable with the locked Hobby defaults.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { capabilities, isLoading, refresh };
}
