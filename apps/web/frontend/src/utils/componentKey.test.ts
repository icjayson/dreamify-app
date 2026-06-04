import { describe, expect, it } from "vitest";
import { getComponentKey } from "./componentKey";

const component = (value: Record<string, unknown>) =>
  value as Parameters<typeof getComponentKey>[0];

describe("getComponentKey", () => {
  it("prefers component_config.id because dashboard cards and chart mentions key off that value", () => {
    expect(
      getComponentKey(component({
        id: "component_outer",
        component_config: { id: "chart_config" },
        title: "Revenue",
      }))
    ).toBe("chart_config");
  });

  it("falls back to component.id when config id is missing", () => {
    expect(
      getComponentKey(component({
        id: "component_outer",
        component_config: {},
        title: "Revenue",
      }))
    ).toBe("component_outer");
  });

  it("falls back to title for legacy components without ids", () => {
    expect(
      getComponentKey(component({
        component_config: undefined,
        title: "Revenue",
      }))
    ).toBe("Revenue");
  });
});
