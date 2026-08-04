import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONNECTORS } from "@/constants/connectors";
import {
  isKnownRoute,
  redirectForRoute,
} from "@/lib/route-manifest";

interface BaselineRoute {
  pattern: string;
  sample: string;
  kind: "known" | "redirect" | "not_found";
}

interface UiBaseline {
  route_patterns: BaselineRoute[];
  connector_modal_targets: number;
}

const baseline = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../docs/ui-parity-baseline.json"), "utf8"),
) as UiBaseline;

function routeKey(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, "");
}

describe("migration UI baseline", () => {
  it("accounts for all 50 URL patterns", () => {
    expect(baseline.route_patterns).toHaveLength(50);
    expect(new Set(baseline.route_patterns.map((route) => route.pattern)).size).toBe(50);

    for (const route of baseline.route_patterns) {
      const key = routeKey(route.sample);
      if (route.kind === "known") expect(isKnownRoute(key), route.pattern).toBe(true);
      if (route.kind === "redirect") expect(redirectForRoute(key), route.pattern).toBeTruthy();
      if (route.kind === "not_found") expect(isKnownRoute(key), route.pattern).toBe(false);
    }
  });

  it("accounts for all 28 connector modal targets", () => {
    const targets = CONNECTORS.flatMap((connector) =>
      connector.modalTarget ? [connector.modalTarget] : [],
    );
    expect(targets).toHaveLength(baseline.connector_modal_targets);
    expect(new Set(targets).size).toBe(baseline.connector_modal_targets);
  });

  it("keeps dedicated blog routes on the migrated Vite UI shell", () => {
    const blogIndex = readFileSync(resolve(process.cwd(), "app/blog/page.tsx"), "utf8");
    const blogPost = readFileSync(resolve(process.cwd(), "app/blog/[slug]/page.tsx"), "utf8");

    expect(blogIndex).toContain("<LegacyRoute />");
    expect(blogPost).toContain("<LegacyRoute />");
    expect(blogIndex).not.toContain("BlogShell");
    expect(blogPost).not.toContain("BlogShell");
  });

  it("does not load Lightswind's global theme tokens over the legacy design system", () => {
    const rootLayout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");

    expect(rootLayout).not.toContain('import "@/ui/lightswind.css"');
    expect(rootLayout).toContain("family=Outfit");
    expect(rootLayout).toContain("family=Instrument+Serif");
  });
});
