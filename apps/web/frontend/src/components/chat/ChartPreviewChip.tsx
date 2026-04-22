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
                <div className="inline-flex max-w-[min(18rem,85vw)] flex-shrink-0 cursor-default items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 dark:bg-purple-500/10 px-3 py-2 transition-all hover:border-purple-500/50 outline-none">
                    <IconComponent className="h-4 w-4 flex-shrink-0 text-purple-600 dark:text-purple-400" />

                    <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                        <span className="flex-shrink-0 font-semibold text-purple-700 dark:text-purple-300">
                            {typeLabel}
                        </span>
                        <span className="flex-shrink-0 font-light text-muted-foreground/30">•</span>
                        <span className="min-w-0 flex-1 truncate text-foreground/80 dark:text-gray-400" title={chart.title}>
                            {chart.title}
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove();
                        }}
                        className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground hover:text-foreground dark:hover:text-white transition-colors"
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
