import { describe, expect, it } from "vitest";
import {
  aggregateMetricSeries,
  extractSparklineData,
  filterDashboardDataByDateRange,
  resolveMetricSparklineData,
  shouldApplyDashboardDateRange,
} from "./dashboardMetricData";

const dates = [
  "2026-05-12",
  "2026-05-13",
  "2026-05-14",
  "2026-05-15",
  "2026-05-16",
  "2026-05-17",
  "2026-05-18",
];

const values = {
  A1: [41, 43, 58, 74, 108, 133, 136],
  A3: [80, 86, 96, 119, 172, 243, 279],
  A30: [220, 233, 247, 277, 339, 424, 491],
  A7: [128, 138, 147, 170, 233, 311, 365],
};

function series(metric: keyof typeof values) {
  return dates.map((date, index) => ({ label: date, value: values[metric][index] }));
}

function aSeriesDashboard() {
  return {
    metrics: [
      { id: "metric_001", title: "A1", value: "136.00", related_chart_id: "chart_001" },
      { id: "metric_002", title: "A3", value: "279.00", related_chart_id: "chart_001" },
      { id: "metric_003", title: "A30", value: "491.00", related_chart_id: "chart_002" },
      { id: "metric_004", title: "A7", value: "365.00", related_chart_id: "chart_001" },
    ],
    charts: [
      {
        id: "chart_001",
        datasets: [
          { label: "A1", data: series("A1") },
          { label: "A3", data: series("A3") },
          { label: "A30", data: series("A30") },
          { label: "A7", data: series("A7") },
        ],
      },
      {
        id: "chart_002",
        datasets: [{ label: "A30", data: series("A30") }],
      },
    ],
  };
}

describe("metric dataset resolution", () => {
  it("resolves A-series metric cards to their own dataset when they share one chart", () => {
    const chart = aSeriesDashboard().charts[0];

    const a1 = extractSparklineData(chart, { title: "A1" });
    const a3 = extractSparklineData(chart, { title: "A3" });
    const a7 = extractSparklineData(chart, { title: "A7" });

    expect(a1?.[a1.length - 1]?.value).toBe(136);
    expect(a3?.[a3.length - 1]?.value).toBe(279);
    expect(a7?.[a7.length - 1]?.value).toBe(365);
  });

  it("prefers a metric's own sparkline data over related chart data", () => {
    const data = resolveMetricSparklineData(
      {
        title: "A3",
        related_chart_id: "chart_001",
        sparkline_data: [
          { label: "2026-05-17", value: 243 },
          { label: "2026-05-18", value: 279 },
        ],
      },
      aSeriesDashboard().charts,
    );

    expect(data).toEqual([
      { label: "2026-05-17", value: 243 },
      { label: "2026-05-18", value: 279 },
    ]);
  });

  it("does not apply date filtering for the full-range preset", () => {
    expect(
      shouldApplyDashboardDateRange("full_range", {
        from: new Date("2026-05-12T00:00:00"),
        to: new Date("2026-05-18T00:00:00"),
      }),
    ).toBe(false);
  });

  it("recalculates plain metric titles from the latest active point, not the sum", () => {
    const filtered = filterDashboardDataByDateRange(aSeriesDashboard(), {
      from: new Date("2026-05-12T00:00:00"),
      to: new Date("2026-05-18T00:00:00"),
    });

    expect(filtered.metrics.map((metric) => metric.value)).toEqual([
      "136.00",
      "279.00",
      "491.00",
      "365.00",
    ]);
  });

  it("keeps total metrics as sums", () => {
    expect(aggregateMetricSeries({ title: "A1 7-Day Total" }, series("A1"))).toBe(593);
    expect(aggregateMetricSeries({ title: "A7 7-Day Total" }, series("A7"))).toBe(1492);
  });
});
