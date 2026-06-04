import { describe, expect, it } from "vitest";
import { areChartRendererPropsEqual } from "./ChartRenderer";

// Minimal DashboardComponent-shaped fixtures for the memo comparator.
const makeComponent = (chartType: string, dataLen: number) =>
  ({
    id: "chart_1",
    type: "chart",
    position: { x: 0, y: 0, width: 12, height: 12 },
    component_config: {
      id: "chart_1",
      type: chartType,
      title: "Revenue",
      datasets: [
        {
          label: "A",
          data: Array.from({ length: dataLen }, (_, i) => ({ label: `L${i}`, value: i })),
        },
      ],
    },
  }) as any;

const noop = () => {};

describe("areChartRendererPropsEqual (card re-render gate)", () => {
  it("returns true for a different object reference with identical content (no re-render)", () => {
    const a = makeComponent("bar", 5);
    const b = makeComponent("bar", 5); // distinct object, same content
    expect(a).not.toBe(b);
    expect(
      areChartRendererPropsEqual({ component: a, onError: noop }, { component: b, onError: noop }),
    ).toBe(true);
  });

  it("returns false when the chart type changed (edited card re-renders)", () => {
    const before = makeComponent("bar", 5);
    const after = makeComponent("line", 5);
    expect(
      areChartRendererPropsEqual(
        { component: before, onError: noop },
        { component: after, onError: noop },
      ),
    ).toBe(false);
  });

  it("returns false when the data changed (e.g. top 5 -> top 10)", () => {
    const before = makeComponent("bar", 5);
    const after = makeComponent("bar", 10);
    expect(
      areChartRendererPropsEqual(
        { component: before, onError: noop },
        { component: after, onError: noop },
      ),
    ).toBe(false);
  });

  it("returns false when onError identity changes", () => {
    const c = makeComponent("bar", 5);
    expect(
      areChartRendererPropsEqual(
        { component: c, onError: () => {} },
        { component: c, onError: () => {} },
      ),
    ).toBe(false);
  });

  it("returns false when className changes", () => {
    const c = makeComponent("bar", 5);
    expect(
      areChartRendererPropsEqual(
        { component: c, onError: noop, className: "a" },
        { component: c, onError: noop, className: "b" },
      ),
    ).toBe(false);
  });
});
