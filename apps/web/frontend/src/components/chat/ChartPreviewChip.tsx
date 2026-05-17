import { BarChart3, TrendingUp, PieChart, AreaChart, ScatterChart, Hash, Table2, Radar, GitBranch, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ChartChipData {
    id: string;
    componentId: string;
    title: string;
    type: string;
}

const CHART_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    bar: BarChart3,
    line: TrendingUp,
    pie: PieChart,
    donut: PieChart,
    area: AreaChart,
    scatter: ScatterChart,
    metric: Hash,
    table: Table2,
    radar: Radar,
    funnel: GitBranch,
    composed: BarChart3,
    radial_bar: PieChart,
    treemap: BarChart3,
    sankey: GitBranch,
};

interface ChartPreviewChipProps {
    chart: ChartChipData;
    onRemove: () => void;
}

const ChartPreviewChip = ({ chart, onRemove }: ChartPreviewChipProps) => {
    const IconComponent = CHART_TYPE_ICONS[chart.type] || BarChart3;
    const typeLabel = chart.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className="inline-flex h-6 max-w-full flex-shrink-0 cursor-default items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/5 px-1.5 text-[12px] font-medium leading-none text-foreground shadow-sm outline-none transition-all hover:border-purple-500/50 dark:bg-purple-500/10">
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border border-purple-500/20 bg-background/80 dark:bg-black/20">
                        <IconComponent className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                    </span>

                    <span className="flex-shrink-0 font-semibold text-purple-700 dark:text-purple-300">
                        {typeLabel}
                    </span>
                    <span className="flex-shrink-0 font-light text-muted-foreground/30">•</span>
                    <span className="min-w-0 max-w-[9rem] flex-1 truncate text-foreground/80 dark:text-gray-400 sm:max-w-[12rem]" title={chart.title}>
                        {chart.title}
                    </span>

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove();
                        }}
                        className="-mr-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground dark:hover:bg-white/10 dark:hover:text-white"
                        aria-label="Remove chart reference"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            </TooltipTrigger>
            <TooltipContent
                side="top"
                sideOffset={8}
                className="max-w-[260px] bg-popover text-xs text-popover-foreground border border-border shadow-lg break-words"
            >
                {chart.title}
            </TooltipContent>
        </Tooltip>
    );
};

export default ChartPreviewChip;
