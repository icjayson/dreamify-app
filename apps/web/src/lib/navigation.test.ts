import { describe, expect, it } from "vitest";

import { matchRoutePattern } from "./navigation";

describe("matchRoutePattern", () => {
  it("matches an exact route and normalizes trailing slashes", () => {
    expect(matchRoutePattern("/workspace/project", "/workspace/project/")).toEqual({});
    expect(matchRoutePattern("/workspace", "/workspace/project")).toBeNull();
  });

  it("extracts and decodes dynamic parameters", () => {
    expect(matchRoutePattern("/admin/users/:userId", "/admin/users/alice%40example.com")).toEqual({
      userId: "alice@example.com",
    });
  });

  it("uses the catch-all only after specific routes are considered", () => {
    expect(matchRoutePattern("*", "/unknown/path")).toEqual({});
  });
});
