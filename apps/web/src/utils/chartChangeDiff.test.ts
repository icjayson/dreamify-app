import { describe, expect, it } from "vitest";
import { diffChartConfigs } from "./chartChangeDiff";

describe("diffChartConfigs", () => {
  it("returns no entries when configs are equivalent", () => {
    const config = { chart_type: "bar", datasets: [{ label: "Revenue" }] };
    expect(diffChartConfigs(config, config)).toEqual([]);
  });

  it("detects a chart type change reading chart_type or type", () => {
    const entries = diffChartConfigs({ chart_type: "bar" }, { type: "line" });
    expect(entries).toContainEqual({
      field: "Chart type",
      before: "bar",
      after: "line",
      kind: "type",
    });
  });

  it("detects added and removed dataset series", () => {
    const before = { datasets: [{ label: "Revenue" }] };
    const after = { datasets: [{ label: "Revenue" }, { label: "Cost" }] };
    const entries = diffChartConfigs(before, after);
    expect(entries).toContainEqual({ field: "Series", after: "Cost", kind: "series" });
    expect(entries.some((e) => e.kind === "series" && e.before === "Revenue")).toBe(false);
  });

  it("detects theme/style changes from styling.theme or presetTheme", () => {
    const entries = diffChartConfigs(
      { styling: { theme: "default" } },
      { styling: { presetTheme: "midnight" } },
    );
    expect(entries).toContainEqual({
      field: "Theme",
      before: "default",
      after: "midnight",
      kind: "style",
    });
  });

  it("detects applied filters from an object map", () => {
    const entries = diffChartConfigs({}, { filters: { region: "EU" } });
    expect(entries).toContainEqual({ field: "Filter", after: "region: EU", kind: "filter" });
  });

  it("treats null/undefined configs as empty without throwing", () => {
    expect(diffChartConfigs(null, undefined)).toEqual([]);
  });
});
