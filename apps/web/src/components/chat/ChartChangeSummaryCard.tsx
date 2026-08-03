import type { ChartChangeSummary } from "@/types/chartEdit";
import {
  buildChangeSummaryChips,
  type ChangeChip,
} from "./ChartChangeSummaryCard.helpers";

interface ChartChangeSummaryCardProps {
  summary: ChartChangeSummary;
}

const CHIP_TONE_CLASSES: Record<ChangeChip["tone"], string> = {
  added: "border-border bg-muted/50 text-muted-foreground",
  removed: "border-border bg-muted/50 text-muted-foreground",
  type: "border-border bg-muted/50 text-muted-foreground",
  filter: "border-border bg-muted/50 text-muted-foreground",
};

export const ChartChangeSummaryCard = ({ summary }: ChartChangeSummaryCardProps) => {
  const chips = buildChangeSummaryChips(summary);

  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <span
            key={chip.key}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-none ${CHIP_TONE_CLASSES[chip.tone]}`}
          >
            <Icon className="h-3 w-3" />
            {chip.label}
          </span>
        );
      })}
    </div>
  );
};
