import { upload } from "@vercel/blob/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { fileService } from "./fileService";

vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

const uploadIntent = (kind: "local_proxy" | "vercel_client_upload") => ({
  id: "intent_1",
  intent_id: "intent_1",
  client_request_id: "request_12345678",
  project_id: "project_1",
  pathname: "uploads/user/intent_1/demo.csv",
  filename: "demo.csv",
  content_type: "text/csv",
  expected_size_bytes: 8,
  max_size_bytes: 8,
  asset_type: "dataset",
  status: "pending",
  upload: {
    kind,
    method: kind === "local_proxy" ? "PUT" : "POST",
    url: kind === "local_proxy" ? "/api/v1/uploads/intent_1/content" : "/api/blob/upload",
    pathname: "uploads/user/intent_1/demo.csv",
    headers: { "Content-Type": "text/csv" },
  },
});

const finalizedAsset = {
  id: "asset_1",
  project_id: "project_1",
  filename: "demo.csv",
  asset_type: "dataset",
  content_type: "text/csv",
  size_bytes: 8,
  status: "ready",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("file upload transport", () => {
  it("uploads directly to the FastAPI filesystem target during local development", async () => {
    const file = new File(["a,b\n1,2\n"], "demo.csv", { type: "text/csv" });
    const post = vi.spyOn(api, "post")
      .mockResolvedValueOnce({ success: true, data: uploadIntent("local_proxy") })
      .mockResolvedValueOnce({ success: true, data: finalizedAsset });
    const put = vi.spyOn(api, "put").mockResolvedValue({
      success: true,
      data: { id: "intent_1", status: "uploaded" },
    });

    const result = await fileService.uploadFile(file, { projectId: "project_1" });

    expect(result.success).toBe(true);
    expect(put).toHaveBeenCalledWith(
      "/api/v1/uploads/intent_1/content",
      undefined,
      { body: file, headers: { "Content-Type": "text/csv" } },
    );
    expect(upload).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("keeps hosted file bodies on the browser-to-Blob path", async () => {
    const file = new File(["a,b\n1,2\n"], "demo.csv", { type: "text/csv" });
    vi.spyOn(api, "post")
      .mockResolvedValueOnce({ success: true, data: uploadIntent("vercel_client_upload") })
      .mockResolvedValueOnce({ success: true, data: finalizedAsset });
    const put = vi.spyOn(api, "put");
    vi.spyOn(api, "getAuthToken").mockResolvedValue(null);

    const result = await fileService.uploadFile(file, { projectId: "project_1" });

    expect(result.success).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
  });
});
