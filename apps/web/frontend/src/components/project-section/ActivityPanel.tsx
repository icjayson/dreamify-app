import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Calculator, Loader2, X } from "lucide-react";

import { useChatStore } from "@/chat/useChatStore";
import { ThinkingEventTimeline } from "@/components/project-section/ThinkingEventTimeline";
import { buildActivityTimeline } from "@/utils/analysisSteps";
import { conversationService } from "@/services/conversationService";
import type { ThinkingEvent } from "@/types/message";

type RestoreStatus = "idle" | "loading" | "loaded" | "error";

interface ActivityPanelProps {
  variant?: "rail" | "embedded";
  onClose?: () => void;
}

function formatThoughtFor(totalMs: number): string {
  if (totalMs < 1000) return `${totalMs}ms`;
  const seconds = totalMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/**
 * Activity timeline surface. Renders the full thinking trace
 * (`buildActivityTimeline`) for every flow — generation, edit, Q&A — with a
 * collapsible Python+output block on steps that ran code. It streams live as
 * `thinkingEvents` arrive and, on reload (no live events but a conversation +
 * persisted steps exist), restores the trace once via `getWorkflowEvents`.
 * Carries `data-export-exclude` so it never lands in dashboard exports.
 */
export const ActivityPanel = ({ variant = "rail", onClose }: ActivityPanelProps = {}) => {
  const setActivityOpen = useChatStore((s) => s.setActivityOpen);
  const analysisSteps = useChatStore((s) => s.analysisSteps);
  const thinkingEvents = useChatStore((s) => s.thinkingEvents);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const currentProjectId = useChatStore((s) => s.currentProjectId);

  const [restoredEvents, setRestoredEvents] = useState<ThinkingEvent[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(() =>
    currentConversationId && currentProjectId ? "loading" : "idle",
  );
  // Guards the one-shot restore against refetch loops (keyed by conversation).
  const restoredForRef = useRef<string | null>(null);
  const restoreKey = currentConversationId && currentProjectId
    ? `${currentProjectId}:${currentConversationId}`
    : null;

  // Live events always win; restored events only fill the gap after a reload.
  const liveEvents = thinkingEvents.length > 0 ? thinkingEvents : restoredEvents;

  useEffect(() => {
    if (!restoreKey || !currentConversationId || !currentProjectId) {
      restoredForRef.current = null;
      setRestoredEvents([]);
      setRestoreStatus("idle");
      return;
    }
    if (restoredForRef.current === restoreKey) return;

    restoredForRef.current = restoreKey;
    setRestoredEvents([]);
    setRestoreStatus("loading");
    let cancelled = false;
    conversationService
      .getWorkflowEvents(currentConversationId, currentProjectId)
      .then((response) => {
        if (!cancelled) {
          setRestoredEvents(response.events);
          setRestoreStatus("loaded");
        }
      })
      .catch(() => {
        if (!cancelled) setRestoreStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [currentConversationId, currentProjectId, restoreKey]);

  const steps = useMemo(
    () => buildActivityTimeline(liveEvents, analysisSteps),
    [liveEvents, analysisSteps],
  );

  const totalDurationMs = useMemo(
    () => steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0),
    [steps],
  );
  const hasContext = !!restoreKey;
  const hasPersistedSteps = (analysisSteps?.length ?? 0) > 0;
  const isRestoring =
    hasContext &&
    restoreStatus === "loading" &&
    thinkingEvents.length === 0 &&
    restoredEvents.length === 0 &&
    !hasPersistedSteps;
  const isEmbedded = variant === "embedded";
  const closeActivity = () => {
    if (onClose) {
      onClose();
      return;
    }
    setActivityOpen(false);
  };
  const stepSummary = steps.length > 0
    ? `${steps.length} step${steps.length === 1 ? "" : "s"}${
        totalDurationMs > 0 ? ` · ${formatThoughtFor(totalDurationMs)}` : ""
      }`
    : "";

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-background ${
        isEmbedded ? "border-0" : "border-l border-border"
      }`}
      data-export-exclude
    >
      <div className={`shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background/60 backdrop-blur-sm ${
        isEmbedded ? "h-12" : "h-10"
      }`}>
        {isEmbedded ? (
          <button
            onClick={closeActivity}
            className="button-outline flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Back to chat"
            title="Back to chat"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        ) : null}
        <span className="text-sm font-medium text-foreground/80 truncate min-w-0 flex-1">
          Activity
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {stepSummary}
        </span>
        {!isEmbedded && (
          <button
            onClick={closeActivity}
            className="button-outline h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close activity"
            title="Close activity"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        <div className="mb-4 border-b border-border/70 pb-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Calculator className="h-4 w-4 text-primary" />
            <span>How the numbers were calculated</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Each step starts with a Plain English summary. Open Details only when you need the code and raw output.
          </p>
          {restoreStatus === "loading" && steps.length > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Restoring full timeline...
            </p>
          )}
        </div>

        {isRestoring ? (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Restoring activity...</span>
          </div>
        ) : steps.length === 0 ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              {!hasContext
                ? "Open a dashboard to inspect its calculation activity."
                : restoreStatus === "error"
                  ? "Activity could not be restored for this dashboard."
                  : "No calculation activity was recorded for this dashboard yet."}
            </p>
            {hasContext && restoreStatus === "error" && (
              <p className="text-xs">
                Close and reopen Activity to retry the timeline restore.
              </p>
            )}
          </div>
        ) : (
          <ThinkingEventTimeline steps={steps} />
        )}
      </div>
    </div>
  );
};
