import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Circle, Code2, Loader2 } from "lucide-react";

import type { ActivityItem } from "@/types/chartEdit";
import { PythonCodeBlock } from "@/components/charts/edit/PythonCodeBlock";

interface ThinkingEventTimelineProps {
  steps: ActivityItem[];
}

const StepStatusIcon = ({ status }: { status?: string }) => {
  if (status === "active") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  }
  if (status === "pending") {
    return <Circle className="h-3 w-3 text-muted-foreground/50" />;
  }
  return <Check className="h-3.5 w-3.5 text-primary" />;
};

const GENERIC_CALCULATION_EXPLANATION =
  "Ran a calculation and saved the result used in the dashboard.";

function sentenceCase(text: string): string {
  const cleaned = text.trim().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isGenericFallback(explanation: string): boolean {
  return explanation.trim() === GENERIC_CALCULATION_EXPLANATION;
}

function fallbackExplanationForTitle(title?: string, phase?: string): string | null {
  const cleanedTitle = sentenceCase(title ?? "");
  const lowerTitle = cleanedTitle.toLowerCase();

  if (!cleanedTitle || /^step \d+: analysis$/i.test(cleanedTitle)) {
    return null;
  }
  if (lowerTitle.includes("robust read")) {
    return "Loaded the data carefully and retried with safer read settings.";
  }
  if (lowerTitle.includes("bom") && lowerTitle.includes("column")) {
    return "Cleaned hidden characters from column names so the data matches correctly.";
  }
  if (lowerTitle.includes("computed values")) {
    return "Pulled the exact computed values into the dashboard.";
  }
  if (lowerTitle.includes("join")) {
    return "Matched related records so the data can be compared correctly.";
  }
  if (/(total|sum|aggregate|daily|weekly|monthly)/i.test(cleanedTitle)) {
    return `${cleanedTitle.replace(/\.$/, "")} for the dashboard.`;
  }
  if (phase === "execution") {
    return `${cleanedTitle.replace(/\.$/, "")} for this calculation.`;
  }
  return cleanedTitle.endsWith(".") ? cleanedTitle : `${cleanedTitle}.`;
}

function fallbackExplanationForPhase(phase?: string): string {
  if (phase === "execution") {
    return GENERIC_CALCULATION_EXPLANATION;
  }
  if (phase === "synthesis" || phase === "final") {
    return "Combined the checked results into the final answer.";
  }
  if (phase === "routing") {
    return "Chose the next step for this request.";
  }
  if (phase === "tool") {
    return "Used an available tool to inspect the data.";
  }
  if (phase === "validation") {
    return "Checked the results before showing them.";
  }
  if (phase === "error") {
    return "Recorded an issue that interrupted this step.";
  }
  return "Checked the available data and prepared the next step.";
}

function plainEnglishForStep(step: ActivityItem): string {
  const explanation = step.explanation?.trim();
  if (explanation && !isGenericFallback(explanation)) {
    return explanation;
  }
  return fallbackExplanationForTitle(step.title, step.phase) || fallbackExplanationForPhase(step.phase);
}

const StepRow = ({ step, isLast }: { step: ActivityItem; isLast: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  const hasCode = !!(step.python && step.python.trim());
  const headline = plainEnglishForStep(step);
  const technicalTitle = step.title?.trim();
  const phaseLabel = step.phase === "execution" ? "calculation" : step.phase;

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
      <div className="relative flex flex-col items-center pt-0.5">
        <StepStatusIcon status={step.status} />
        {!isLast && <span className="mt-1 w-px flex-1 bg-primary/15" />}
      </div>

      <div className="min-w-0 pb-4">
        {phaseLabel && (
          <div className="mb-1 text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
            {phaseLabel}
          </div>
        )}
        <p className="text-sm leading-5 text-foreground">{headline}</p>
        {technicalTitle && technicalTitle !== headline && (
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Technical step: {technicalTitle}
          </p>
        )}

        {hasCode && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              aria-label={expanded ? "Hide technical details" : "Show technical details"}
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>{expanded ? "Hide details" : "Details"}</span>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {expanded && (
              <div className="mt-2">
                <PythonCodeBlock python={step.python!} output={step.output} />
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

/**
 * Source-agnostic step timeline for the Activity panel. Each row shows a status
 * icon, a plain-English explanation, and — only on steps that ran code — a
 * collapsible technical details block with Python and output.
 */
export const ThinkingEventTimeline = ({ steps }: ThinkingEventTimelineProps) => {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No calculation steps were recorded for this run.
      </p>
    );
  }

  return (
    <ol className="m-0 list-none p-0">
      {steps.map((step, index) => (
        <StepRow
          key={`${step.key}:${index}`}
          step={step}
          isLast={index === steps.length - 1}
        />
      ))}
    </ol>
  );
};
