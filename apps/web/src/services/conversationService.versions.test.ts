import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { api } from "./api";
import { conversationService } from "./conversationService";

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("conversationService version history (Phase 7)", () => {
  it("getDashboardVersions returns the parsed version list", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: {
        dashboard_id: "dash_1",
        current_version: 3,
        versions: [
          { version: 3, created_at: "2026-05-31T00:00:00Z", source: "edit", edit_summary: "tweak" },
          { version: 2, created_at: "2026-05-30T00:00:00Z", source: "generation" },
        ],
      },
    });

    const result = await conversationService.getDashboardVersions("conv_1", "dash_1", "proj_1");

    expect(result.current_version).toBe(3);
    expect(result.versions).toHaveLength(2);
    expect(mockedApi.get).toHaveBeenCalledWith(
      "/api/v1/conversation/conv_1/dashboard/dash_1/versions?project_id=proj_1",
    );
  });

  it("getDashboardVersions throws on backend error", async () => {
    mockedApi.get.mockResolvedValueOnce({ success: false, error: "404 not found" });
    await expect(
      conversationService.getDashboardVersions("conv_1", "dash_1", "proj_1"),
    ).rejects.toThrow("404 not found");
  });

  it("getDashboardVersion fetches a single snapshot by version", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: { dashboard_id: "dash_1", dashboard_data: { components: [] } },
    });

    const snapshot = await conversationService.getDashboardVersion("conv_1", "dash_1", "proj_1", 2);

    expect(snapshot.dashboard_id).toBe("dash_1");
    expect(mockedApi.get).toHaveBeenCalledWith(
      "/api/v1/conversation/conv_1/dashboard/dash_1/versions/2?project_id=proj_1",
    );
  });

  it("revertDashboard posts the target version and returns the new head", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: { dashboard_id: "dash_1", current_version: 3, versions: [] },
    });
    mockedApi.post.mockResolvedValueOnce({
      success: true,
      data: { success: true, dashboard_id: "dash_1", new_version: 4, reverted_to: 2 },
    });

    const result = await conversationService.revertDashboard("conv_1", "dash_1", "proj_1", 2);

    expect(result.new_version).toBe(4);
    expect(result.reverted_to).toBe(2);
    expect(mockedApi.post).toHaveBeenCalledWith(
      "/api/v1/conversation/conv_1/dashboard/dash_1/revert",
      { project_id: "proj_1", target_version: 2, expected_version: 3 },
    );
  });

  it("saveDashboardData resolves and sends the current version when omitted", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: { dashboard_id: "dash_1", current_version: 5, versions: [] },
    });
    mockedApi.put.mockResolvedValueOnce({ success: true, data: { success: true } });

    await conversationService.saveDashboardData("conv_1", "dash_1", "proj_1", { foo: 1 });

    expect(mockedApi.put).toHaveBeenCalledWith(
      "/api/v1/conversation/conv_1/dashboard/dash_1/data",
      { project_id: "proj_1", dashboard_data: { foo: 1 }, expected_version: 5 },
    );
  });

  it("saveDashboardData forwards edit_summary and expected_version when provided", async () => {
    mockedApi.put.mockResolvedValueOnce({ success: true, data: { success: true } });

    await conversationService.saveDashboardData(
      "conv_1",
      "dash_1",
      "proj_1",
      { foo: 1 },
      { editSummary: "manual edit", expectedVersion: 7 },
    );

    expect(mockedApi.put).toHaveBeenCalledWith(
      "/api/v1/conversation/conv_1/dashboard/dash_1/data",
      { project_id: "proj_1", dashboard_data: { foo: 1 }, edit_summary: "manual edit", expected_version: 7 },
    );
  });

  it("saveDashboardData flags a 409 version conflict", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: { dashboard_id: "dash_1", current_version: 4, versions: [] },
    });
    mockedApi.put.mockResolvedValueOnce({
      success: false,
      status: 409,
      error: "Dashboard was updated",
    });

    const result = await conversationService.saveDashboardData("conv_1", "dash_1", "proj_1", { foo: 1 });

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it("treats a typed 404 workflow response as an initializing run", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: false,
      status: 404,
      error: "Workflow run not found",
    });

    await expect(
      conversationService.getWorkflowStatus("conv_1", "proj_1"),
    ).resolves.toMatchObject({
      conversation_id: "conv_1",
      status: "starting",
    });
  });

  it("treats missing pre-dispatch workflow events as an empty trace", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: false,
      status: 404,
      error: "Workflow run not found",
    });

    await expect(
      conversationService.getWorkflowEvents("conv_1", "proj_1"),
    ).resolves.toEqual({
      conversation_id: "conv_1",
      status: null,
      events: [],
    });
  });
});
