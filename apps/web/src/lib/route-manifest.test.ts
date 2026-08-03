import { describe, expect, it } from "vitest";

import {
  STATIC_ROUTE_PATHS,
  isKnownRoute,
  isNoIndexRoute,
  isPrivateRoute,
  redirectForRoute,
} from "./route-manifest";

describe("Next route manifest", () => {
  it("accepts every static legacy route", () => {
    for (const route of STATIC_ROUTE_PATHS) expect(isKnownRoute(route), route).toBe(true);
  });

  it.each([
    "zalo-upload/token",
    "workspace/connectors/ga4/property-1",
    "preview/asset-1",
    "admin/conversation/conversation-1",
    "admin/users/user-1",
    "admin/cms/post-1",
    "product/data-connectors/ga4",
    "product/workspace-agents/slack",
    "vs/tableau",
    "blog/example-post",
    "customers/example-customer",
  ])("accepts dynamic route %s", (route) => {
    expect(isKnownRoute(route)).toBe(true);
  });

  it.each([
    ["product", "/product/data-connectors"],
    ["admin", "/admin/analytics"],
    ["success", "/pricing"],
    ["cancel", "/pricing"],
    ["integrations/ga4", "/product/data-connectors"],
    ["workspaces/slack", "/product/workspace-agents"],
  ])("preserves legacy redirect %s", (route, expected) => {
    expect(redirectForRoute(route)).toBe(expected);
  });

  it("rejects unknown and over-deep routes", () => {
    expect(isKnownRoute("definitely-missing")).toBe(false);
    expect(isKnownRoute("blog/post/extra")).toBe(false);
    expect(redirectForRoute("integrations/ga4/extra")).toBeUndefined();
  });

  it("marks authenticated and operator surfaces noindex", () => {
    expect(isPrivateRoute("workspace")).toBe(true);
    expect(isPrivateRoute("admin/users/user-1")).toBe(true);
    expect(isPrivateRoute("preview/asset-1")).toBe(true);
    expect(isPrivateRoute("blog/example-post")).toBe(false);
    expect(isNoIndexRoute("login")).toBe(true);
    expect(isNoIndexRoute("signup")).toBe(true);
  });

  it("also noindexes retained but unavailable marketing surfaces", () => {
    expect(isNoIndexRoute("finance")).toBe(true);
    expect(isNoIndexRoute("vs/power-bi")).toBe(true);
    expect(isNoIndexRoute("customers/example")).toBe(true);
    expect(isNoIndexRoute("product/workspace-agents/slack")).toBe(true);
    expect(isNoIndexRoute("product/data-connectors/ga4")).toBe(true);
    expect(isNoIndexRoute("product/data-connectors")).toBe(false);
    expect(isNoIndexRoute("blog/example-post")).toBe(false);
  });
});
