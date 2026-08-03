import { BarChart3, Palette, Filter } from "lucide-react";

import { QUICK_EDIT_ACTIONS, type QuickEditAction } from "@/types/chartEdit";

interface QuickEditChipsProps {
  onPick: (action: QuickEditAction, promptSeed: string) => void;
}

const QUICK_EDIT_ICONS: Record<QuickEditAction, React.ComponentType<{ className?: string }>> = {
  change_type: BarChart3,
  recolor: Palette,
  filter_range: Filter,
};

const CHIP_ORDER: QuickEditAction[] = ["change_type", "recolor", "filter_range"];

export const QuickEditChips = ({ onPick }: QuickEditChipsProps) => {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHIP_ORDER.map((action) => {
        const { label, promptSeed } = QUICK_EDIT_ACTIONS[action];
        const Icon = QUICK_EDIT_ICONS[action];
        return (
          <button
            key={action}
            type="button"
            onClick={() => onPick(action, promptSeed)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/5 px-2 text-[12px] font-medium leading-none text-foreground transition-colors hover:border-purple-500/50 hover:bg-purple-500/10 dark:bg-purple-500/10"
          >
            <Icon className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
            {label}
          </button>
        );
      })}
    </div>
  );
};
