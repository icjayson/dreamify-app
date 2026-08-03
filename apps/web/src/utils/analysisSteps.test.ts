import { describe, expect, it } from "vitest";

import { buildActivityTimeline } from "./analysisSteps";
import type { AnalysisStep } from "@/types/chartEdit";
import type { ThinkingEvent } from "@/types/message";

function makeEvent(overrides: Partial<ThinkingEvent>): ThinkingEvent {
  return {
    id: overrides.id ?? "evt",
    run_id: overrides.run_id ?? "run",
    sequence: overrides.sequence ?? 0,
    phase: overrides.phase ?? "analysis",
    status: overrides.status ?? "completed",
    title: overrides.title ?? "step",
    summary: overrides.summary,
    started_at: overrides.started_at,
    metadata: overrides.metadata,
    duration_ms: overrides.duration_ms,
  };
}

describe("buildActivityTimeline", () => {
  it("returns an empty array when both sources are empty", () => {
    expect(buildActivityTimeline(null, null)).toEqual([]);
    expect(buildActivityTimeline(undefined, undefined)).toEqual([]);
    expect(buildActivityTimeline([], [])).toEqual([]);
  });

  it("merges live thinking events across meaningful phases and enriches execution items by step_index", () => {
    const events: ThinkingEvent[] = [
      makeEvent({
        id: "e0",
        sequence: 0,
        phase: "routing",
        title: "Pick approach",
        summary: "Decided to aggregate by month",
      }),
      makeEvent({
        id: "e1",
        sequence: 1,
        phase: "execution",
        title: "Run code",
        summary: "live summary",
        status: "completed",
        duration_ms: 800,
        metadata: { python: "live_code", output: "live_out", step_index: 0 },
      }),
      makeEvent({
        id: "e2",
        sequence: 2,
        phase: "validation",
        title: "Check results",
        summary: "Validated totals",
      }),
    ];
    const analysisSteps: AnalysisStep[] = [
      {
        index: 0,
        title: "Compute totals",
        python: "df.groupby('month').sum()",
        output: "12 rows",
        explanation: "Summed revenue by month",
      },
    ];

    const result = buildActivityTimeline(events, analysisSteps);

    expect(result.map((item) => item.phase)).toEqual([
      "routing",
      "execution",
      "validation",
    ]);
    // Reasoning rows are preserved (no python).
    expect(result[0]).toMatchObject({ title: "Pick approach", explanation: "Decided to aggregate by month" });
    expect(result[0].python).toBeUndefined();
    // Execution row enriched from the fuller analysisSteps record.
    expect(result[1]).toMatchObject({
      title: "Run code",
      python: "df.groupby('month').sum()",
      output: "12 rows",
      explanation: "Summed revenue by month",
      durationMs: 800,
    });
  });

  it("shows reasoning-only steps for a no-code flow (Q&A)", () => {
    const events: ThinkingEvent[] = [
      makeEvent({ id: "a", sequence: 0, phase: "context", title: "Read question", summary: "Parsed the ask" }),
      makeEvent({ id: "b", sequence: 1, phase: "synthesis", title: "Answer", summary: "Wrote the reply" }),
    ];

    const result = buildActivityTimeline(events, null);

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.python === undefined)).toBe(true);
    expect(result.map((item) => item.title)).toEqual(["Read question", "Answer"]);
  });

  it("synthesizes items from persisted analysisSteps when there are no live events", () => {
    const analysisSteps: AnalysisStep[] = [
      { index: 1, title: "Second", python: "y = 2", explanation: "second step" },
      { index: 0, title: "First", python: "x = 1", explanation: "first step" },
    ];

    const result = buildActivityTimeline([], analysisSteps);

    expect(result.map((item) => item.title)).toEqual(["First", "Second"]);
    expect(result[0]).toMatchObject({
      title: "First",
      python: "x = 1",
      explanation: "first step",
      phase: "execution",
    });
  });

  it("falls back to positional order when execution events lack step_index", () => {
    const events: ThinkingEvent[] = [
      makeEvent({ id: "x0", sequence: 0, phase: "execution", title: "first exec", metadata: {} }),
      makeEvent({ id: "x1", sequence: 1, phase: "execution", title: "second exec", metadata: {} }),
    ];
    const analysisSteps: AnalysisStep[] = [
      { index: 0, title: "s0", python: "code0", explanation: "exp0" },
      { index: 1, title: "s1", python: "code1", explanation: "exp1" },
    ];

    const result = buildActivityTimeline(events, analysisSteps);

    expect(result[0]).toMatchObject({ python: "code0", explanation: "exp0" });
    expect(result[1]).toMatchObject({ python: "code1", explanation: "exp1" });
  });

  it("honors explicit step_index instead of execution event position", () => {
    const events: ThinkingEvent[] = [
      makeEvent({
        id: "x0",
        sequence: 0,
        phase: "execution",
        title: "second emitted first",
        metadata: { python: "live0", output: "live0", step_index: 1 },
      }),
      makeEvent({
        id: "x1",
        sequence: 1,
        phase: "execution",
        title: "first emitted second",
        metadata: { python: "live1", output: "live1", step_index: 0 },
      }),
    ];
    const analysisSteps: AnalysisStep[] = [
      { index: 0, title: "first", python: "code0", explanation: "exp0" },
      { index: 1, title: "second", python: "code1", explanation: "exp1" },
    ];

    const result = buildActivityTimeline(events, analysisSteps);

    expect(result[0]).toMatchObject({ python: "code1", explanation: "exp1", stepIndex: 1 });
    expect(result[1]).toMatchObject({ python: "code0", explanation: "exp0", stepIndex: 0 });
  });

  it("accepts string step_index values from serialized metadata", () => {
    const events: ThinkingEvent[] = [
      makeEvent({
        id: "x0",
        sequence: 0,
        phase: "execution",
        title: "string index",
        metadata: { step_index: "1" },
      }),
    ];
    const analysisSteps: AnalysisStep[] = [
      { index: 0, title: "first", python: "code0", explanation: "exp0" },
      { index: 1, title: "second", python: "code1", explanation: "exp1" },
    ];

    const result = buildActivityTimeline(events, analysisSteps);

    expect(result[0]).toMatchObject({ python: "code1", explanation: "exp1", stepIndex: 1 });
  });

  it("filters out non-meaningful phases like queued", () => {
    const events: ThinkingEvent[] = [
      makeEvent({ id: "q", sequence: 0, phase: "queued", title: "Queued" }),
      makeEvent({ id: "r", sequence: 1, phase: "routing", title: "Routing" }),
    ];

    const result = buildActivityTimeline(events, null);

    expect(result.map((item) => item.title)).toEqual(["Routing"]);
  });
});
