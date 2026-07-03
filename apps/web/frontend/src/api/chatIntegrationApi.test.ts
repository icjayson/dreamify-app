import { describe, expect, it } from "vitest";

import { resolveChatApiAssetUrl } from "./chatIntegrationApi";

describe("resolveChatApiAssetUrl", () => {
  it("prefixes relative API asset paths with the API base URL", () => {
    expect(
      resolveChatApiAssetUrl(
        "/api/v1/chat/whatsapp/qr/ABC12345",
        "https://api.dreamify.dev",
      ),
    ).toBe("https://api.dreamify.dev/api/v1/chat/whatsapp/qr/ABC12345");
  });

  it("keeps relative paths same-origin when the API base URL is empty", () => {
    expect(
      resolveChatApiAssetUrl("/api/v1/chat/whatsapp/qr/ABC12345", ""),
    ).toBe("/api/v1/chat/whatsapp/qr/ABC12345");
  });

  it("leaves absolute URLs unchanged", () => {
    expect(
      resolveChatApiAssetUrl(
        "https://cdn.example.com/qr.svg",
        "https://api.dreamify.dev",
      ),
    ).toBe("https://cdn.example.com/qr.svg");
  });
});
