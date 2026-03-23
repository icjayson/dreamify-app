import { BarChart3, TrendingUp, PieChart, AreaChart, ScatterChart, Hash, Table2, Radar, GitBranch, X } from "lucide-react";

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
        <div className="group relative flex items-center gap-2.5 px-3 py-2 bg-[#1e1e1e] border border-purple-500/20 rounded-full overflow-hidden transition-all hover:border-purple-500/40">
            {/* Chart Type Icon */}
            <IconComponent className="w-4 h-4 text-purple-400 flex-shrink-0" />

            {/* Chart Info */}
            <div className="flex items-center gap-1.5 text-xs">
                <span className="text-purple-300 font-semibold flex-shrink-0">
                    {typeLabel}
                </span>
                <span className="text-white/30 font-light mr-0.5">&bull;</span>
                <span
                    className="text-gray-400 truncate max-w-[150px]"
                    title={chart.title}
                >
                    {chart.title}
                </span>
            </div>

            {/* Remove Button */}
            <button
                onClick={onRemove}
                className="ml-1 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
                aria-label="Remove chart reference"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    );
};

export default ChartPreviewChip;
