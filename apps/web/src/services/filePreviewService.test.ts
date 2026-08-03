import { afterEach, describe, expect, it, vi } from "vitest";

import { getFilePreview } from "./filePreviewService";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFilePreview", () => {
  it("keeps bearer tokens out of URLs and maps source_type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          filename: "data.csv",
          columns: ["value"],
          rows: [["1"]],
          total_rows: 1,
          displayed_rows: 1,
          source_type: "csv",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getFilePreview("asset-1", "secret-token", { limit: 50, offset: 10 }),
    ).resolves.toMatchObject({ sourceType: "csv" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/files/preview/asset-1?limit=50&offset=10",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("secret-token");
  });

  it("surfaces typed API preview errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "PREVIEW_FORMAT_UNSUPPORTED",
              message: "Excel preview is unavailable; the file can still be analyzed",
            },
          }),
          { status: 415, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(getFilePreview("asset-1", "token")).rejects.toThrow(
      "Excel preview is unavailable",
    );
  });

  it("uses the explicit local demo identity when Clerk is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          filename: "demo.csv",
          columns: ["value"],
          rows: [["1"]],
          total_rows: 1,
          displayed_rows: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getFilePreview("asset-demo");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/files/preview/asset-demo",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Demo-User": "demo_user" }),
      }),
    );
  });
});
