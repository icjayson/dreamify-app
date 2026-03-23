import { FileText, Eye, BarChart3, TrendingUp, PieChart, AreaChart, ScatterChart, Hash, Table2, Radar, GitBranch } from "lucide-react";
import { type AssetRecord } from "@/services/fileService";

export interface ChartPickerItem {
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

const getChartIcon = (type: string) => {
    return CHART_TYPE_ICONS[type] || BarChart3;
};

const formatChartType = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

interface ProjectContextPickerProps {
    files: Array<{
        id: string;
        name: string;
        ext: string;
        projectId: string;
        sourceType?: string;
        asset: AssetRecord;
    }>;
    charts?: ChartPickerItem[];
    onSelect: (file: {
        id: string;
        name: string;
        ext: string;
        projectId: string;
        sourceType?: string;
        asset: AssetRecord;
    }) => void;
    onChartSelect?: (chart: ChartPickerItem) => void;
    onPreview?: (fileId: string) => void;
    query?: string;
    className?: string;
    emptyMessage?: string;
}

const ProjectContextPicker = ({
    files,
    charts = [],
    onSelect,
    onChartSelect,
    onPreview,
    query = "",
    className = "",
    emptyMessage = "No files found in this project"
}: ProjectContextPickerProps) => {
    const lowerQuery = query.toLowerCase();
    const isChartQuery = lowerQuery.startsWith("chart");
    const chartFilterQuery = isChartQuery ? lowerQuery.slice(5).trim() : lowerQuery;

    // Filter charts by query
    const filteredCharts = charts.filter(chart =>
        !chartFilterQuery || chart.title.toLowerCase().includes(chartFilterQuery) || chart.type.toLowerCase().includes(chartFilterQuery)
    );

    // Filter files — hide if user explicitly typed "@chart"
    const filteredFiles = isChartQuery ? [] : files;

    const hasCharts = filteredCharts.length > 0;
    const hasFiles = filteredFiles.length > 0;
    const hasNothing = !hasCharts && !hasFiles;

    return (
        <div className={`absolute bottom-full left-0 mb-2 w-full max-w-md bg-[#1e1e1e] border border-white/20 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto ${className}`}>
            <div className="p-2">
                {/* Charts Section */}
                {hasCharts && (
                    <>
                        <p className="text-xs text-white/50 px-2 py-1 flex items-center gap-1.5">
                            <BarChart3 className="w-3 h-3" />
                            Charts
                        </p>
                        {filteredCharts.map(chart => {
                            const IconComponent = getChartIcon(chart.type);
                            return (
                                <button
                                    key={`chart-${chart.componentId}`}
                                    onClick={() => onChartSelect?.(chart)}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
                                >
                                    <IconComponent className="w-4 h-4 text-purple-400 flex-shrink-0" />
                                    <span className="text-sm text-white truncate flex-1">
                                        {chart.title}
                                    </span>
                                    <span className="text-[10px] text-purple-400/70 bg-purple-400/10 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                                        {formatChartType(chart.type)}
                                    </span>
                                </button>
                            );
                        })}
                    </>
                )}

                {/* Divider between sections */}
                {hasCharts && hasFiles && (
                    <div className="border-t border-white/10 my-1" />
                )}

                {/* Datasets Section */}
                {hasFiles && (
                    <>
                        <p className="text-xs text-white/50 px-2 py-1 flex items-center gap-1.5">
                            <FileText className="w-3 h-3" />
                            Datasets
                        </p>
                        {filteredFiles.map(asset => (
                            <button
                                key={asset.id}
                                onClick={() => onSelect(asset)}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
                            >
                                {asset.sourceType === 'GA4' ? (
                                    <img src="/GA4.png" alt="GA4 Logo" className="flex-shrink-0 w-4 h-4 object-contain" />
                                ) : (
                                    <FileText className="w-4 h-4 text-white/70 flex-shrink-0" />
                                )}
                                <span className="text-sm text-white truncate flex-1">
                                    {asset.sourceType ? `${asset.sourceType} Data` : asset.name}
                                </span>
                                {asset.sourceType ? (
                                    <div className="flex-shrink-0 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                        <span className="text-xs text-green-500/90 font-medium tracking-wide">Connected</span>
                                    </div>
                                ) : (
                                    <span className="text-xs text-white/50">{asset.ext}</span>
                                )}
                                {onPreview && (
                                    <div
                                        role="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onPreview(asset.id);
                                        }}
                                        className="p-1 hover:bg-white/20 rounded-md transition-colors text-white/50 hover:text-white"
                                        title="Preview dataset"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </div>
                                )}
                            </button>
                        ))}
                    </>
                )}

                {/* Empty state */}
                {hasNothing && (
                    <p className="text-xs text-white/40 px-3 py-2">
                        {isChartQuery ? "No charts available. Generate a dashboard first." : emptyMessage}
                    </p>
                )}
            </div>
        </div>
    );
};

export default ProjectContextPicker;
