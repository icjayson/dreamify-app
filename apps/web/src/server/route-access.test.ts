import { describe, expect, it } from "vitest";

import { isProtectedApplicationPath } from "./route-access";

describe("server route access", () => {
  it.each([
    "/workspace",
    "/workspace/project",
    "/preview/asset-id",
    "/admin/analytics",
    "/templates",
    "/feedback",
    "/sso-callback",
    "/zalo-upload/token",
  ])("protects %s", (pathname) => {
    expect(isProtectedApplicationPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/blog",
    "/pricing",
    "/workspace/project/preview",
    "/product/data-connectors",
  ])(
    "keeps %s public",
    (pathname) => {
      expect(isProtectedApplicationPath(pathname)).toBe(false);
    },
  );
});
