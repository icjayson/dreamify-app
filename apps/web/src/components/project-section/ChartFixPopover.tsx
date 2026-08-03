import { useState } from "react";
import { Wand2, ArrowUp } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QuickEditChips } from "@/components/chat/QuickEditChips";
import {
  type ChartChipData,
  type QuickEditAction,
  type SelectChartContextDetail,
} from "@/types/chartEdit";

const SELECT_CHART_CONTEXT_EVENT = "dreamify:select-chart-context";

interface ChartFixPopoverProps {
  chartChip: ChartChipData;
}

function dispatchChartContext(detail: SelectChartContextDetail) {
  window.dispatchEvent(new CustomEvent(SELECT_CHART_CONTEXT_EVENT, { detail }));
}

export const ChartFixPopover = ({ chartChip }: ChartFixPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const handlePick = (intent: QuickEditAction, promptSeed: string) => {
    dispatchChartContext({ ...chartChip, intent, promptSeed });
    setOpen(false);
  };

  const handleSubmit = () => {
    const promptSeed = draft.trim();
    if (!promptSeed) return;
    dispatchChartContext({ ...chartChip, promptSeed });
    setDraft("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Edit this chart"
          data-edit-control="chart-fix"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-sm outline-none transition-colors focus-visible:ring-2"
          style={{
            backgroundColor: "var(--dashboard-control-bg)",
            borderColor: "var(--dashboard-card-border)",
            color: "var(--dashboard-title)",
          }}
        >
          <Wand2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={12}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-72 space-y-3"
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold leading-none text-foreground">Edit this chart</p>
          <p className="truncate text-xs text-muted-foreground" title={chartChip.title}>
            {chartChip.title}
          </p>
        </div>
        <QuickEditChips onPick={handlePick} />
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Describe a change…"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!draft.trim()}
            aria-label="Send edit"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-600 text-white transition-colors hover:bg-purple-700 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
