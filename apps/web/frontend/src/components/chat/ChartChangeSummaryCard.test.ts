import { describe, expect, it } from "vitest";

import { buildChangeSummaryChips } from "./ChartChangeSummaryCard.helpers";

describe("buildChangeSummaryChips", () => {
  it("builds chips for chart type, series, and filter changes", () => {
    const chips = buildChangeSummaryChips({
      chart_type_from: "bar",
      chart_type_to: "line",
      series_added: ["Revenue"],
      series_removed: ["Cost"],
      filters_applied: ["Last 30 days"],
      human_summary: "Updated Revenue.",
    });

    expect(chips.map((chip) => chip.label)).toEqual([
      "bar → line",
      "Revenue",
      "Cost",
      "Last 30 days",
    ]);
  });

  it("tolerates partial backend summaries without array fields", () => {
    const chips = buildChangeSummaryChips({
      human_summary: "Recolored the chart.",
    });

    expect(chips).toEqual([]);
  });
});
