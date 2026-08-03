import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "./api";
import { publicProjectService } from "./publicProjectService";

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publicProjectService", () => {
  it("loads public preview metadata from the project-scoped endpoint", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: {
        id: "project-1",
        name: "KPI",
        latest_conversation_id: "conversation-1",
        latest_dashboard_id: "dashboard-1",
        is_preview_public: true,
      },
    });

    await expect(publicProjectService.getPublicProject("project-1")).resolves.toMatchObject({
      success: true,
      project: { id: "project-1", is_preview_public: true },
    });
    expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/public/project/project-1");
  });

  it("maps typed private-preview denial without parsing error text", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: false,
      status: 403,
      error: "This signed-in user is not allowed",
      errorInfo: {
        status: 403,
        code: "PREVIEW_ACCESS_DENIED",
        message: "This signed-in user is not allowed",
      },
    });

    await expect(publicProjectService.getPublicProject("project-1")).resolves.toEqual({
      success: false,
      error: "Project preview is private or you do not have access",
    });
  });

  it("loads only latest saved dashboard JSON through the public contract", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: {
        dashboard_id: "dashboard-1",
        dashboard_data: { components: [] },
        current_version: 3,
      },
    });

    await expect(
      publicProjectService.getPublicDashboardData("project-1"),
    ).resolves.toMatchObject({ dashboard_id: "dashboard-1", current_version: 3 });
    expect(mockedApi.get).toHaveBeenCalledWith(
      "/api/v1/public/project/project-1/dashboard",
    );
  });
});
