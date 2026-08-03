import { describe, expect, it, vi } from "vitest";

import { CONNECTORS } from "@/constants/connectors";

import {
  FALLBACK_CAPABILITIES,
  connectorCapability,
  featureCapability,
  normalizeCapabilities,
  scheduleCertifiedConnectorOpen,
} from "./useCapabilities";

describe("capability policy", () => {
  it("fails every external connector closed in the offline preview", () => {
    expect(connectorCapability(FALLBACK_CAPABILITIES, "ga4").enabled).toBe(false);
    expect(connectorCapability(FALLBACK_CAPABILITIES, "stripe").enabled).toBe(false);
    expect(connectorCapability(FALLBACK_CAPABILITIES, "slack").enabled).toBe(false);
    expect(connectorCapability(FALLBACK_CAPABILITIES, "file_upload").enabled).toBe(true);
  });

  it("does not let legacy active flags override the capability contract", () => {
    const legacyActiveConnectors = CONNECTORS.filter(
      (connector) => connector.isActive && connector.connectorKey,
    );

    expect(legacyActiveConnectors.length).toBeGreaterThan(0);
    for (const connector of legacyActiveConnectors) {
      expect(connectorCapability(FALLBACK_CAPABILITIES, connector.connectorKey).enabled).toBe(false);
    }
  });

  it("uses a server-certified per-connector capability", () => {
    const capabilities = normalizeCapabilities({
      connectors: {
        ga4: { enabled: true, connected: true },
      },
    });

    expect(connectorCapability(capabilities, "ga4")).toEqual({
      enabled: true,
      connected: true,
    });
    expect(connectorCapability(capabilities, "stripe").enabled).toBe(false);
  });

  it("maps the legacy aggregate connector flag without enabling named connectors", () => {
    const capabilities = normalizeCapabilities({
      features: { connectors: { enabled: true, reason: null } },
    });

    expect(capabilities.connectors.external.enabled).toBe(true);
    expect(connectorCapability(capabilities, "ga4").enabled).toBe(false);
  });

  it("keeps scheduling fail-closed unless the server explicitly enables it", () => {
    expect(featureCapability(FALLBACK_CAPABILITIES, "scheduling").enabled).toBe(false);

    const capabilities = normalizeCapabilities({
      features: { scheduling: { enabled: true, reason: null } },
    });

    expect(featureCapability(capabilities, "scheduling").enabled).toBe(true);
    expect(featureCapability(capabilities, "unknown").enabled).toBe(false);
  });

  it("preserves the authenticated tenant's effective BYOK provider", () => {
    const capabilities = normalizeCapabilities({
      model: {
        mode: "byok",
        active_provider: "openai",
        providers: ["demo", "openai"],
      },
    });

    expect(capabilities.model).toEqual({
      mode: "byok",
      active_provider: "openai",
      providers: ["demo", "openai"],
    });
  });

  it("does not schedule or open a connector modal from a disabled redirect", () => {
    const openModal = vi.fn();
    const schedule = vi.fn();

    const result = scheduleCertifiedConnectorOpen(
      FALLBACK_CAPABILITIES,
      "google-sheets",
      openModal,
      schedule,
    );

    expect(result.availability.enabled).toBe(false);
    expect(result.scheduled).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
    expect(openModal).not.toHaveBeenCalled();
  });

  it("normalizes a certified connector redirect and schedules one modal open", () => {
    const openModal = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());
    const capabilities = normalizeCapabilities({
      connectors: { google_sheets: { enabled: true, connected: true } },
    });

    const result = scheduleCertifiedConnectorOpen(
      capabilities,
      "google-sheets",
      openModal,
      schedule,
    );

    expect(result.scheduled).toBe(true);
    expect(schedule).toHaveBeenCalledOnce();
    expect(openModal).toHaveBeenCalledWith(true);
  });
});
