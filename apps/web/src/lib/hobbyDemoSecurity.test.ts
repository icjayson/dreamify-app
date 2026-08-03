import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string): string {
  return readFileSync(join(sourceRoot, relativePath), "utf8");
}

describe("hobby_demo trust-boundary guards", () => {
  it("keeps the billing compatibility facade free of billing and credit calls", () => {
    const subscription = source("hooks/useSubscription.ts");

    expect(subscription).not.toMatch(/fetch\s*\(/);
    expect(subscription).not.toMatch(/api\.(?:get|post|put|patch|delete)\s*\(/);
    expect(subscription).not.toMatch(/\/(?:checkout|billing|credits?)(?:\/|["'`])/);
  });

  it("never puts bearer credentials in connector URLs", () => {
    const chatDirectory = join(sourceRoot, "components/chat");
    const connectorSources = readdirSync(chatDirectory)
      .filter((name) => name.endsWith("IntegrationModal.tsx"))
      .map((name) => readFileSync(join(chatDirectory, name), "utf8"))
      .join("\n");

    expect(connectorSources).not.toMatch(/encodeURIComponent\s*\(\s*token\s*\)/);
    expect(connectorSources).not.toMatch(/[?&](?:access_)?token=/i);
  });

  it("does not send account metadata to third-party IP lookup services", () => {
    const settings = source("components/homepage-section/AccountSettings.tsx");

    expect(settings).not.toMatch(/api\.ipify\.org|ipapi\.co|ipwho\.is/i);
  });
});
