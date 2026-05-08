import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartType, type ChartConfiguration, type ChartDataset } from "@/types/dashboard";
import type { Message } from "@/types/message";
import ChartRenderer from "@/components/charts/ChartRenderer";

interface ChatInlineChartProps {
  artifact: NonNullable<Message["visualArtifacts"]>[number];
  variant?: "inline" | "modal";
  compact?: boolean;
}

type ChartRow = Record<string, string | number>;
type TooltipEntry = {
  name?: string;
  dataKey?: string;
  value?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
};
type TooltipProps = {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
};

const FALLBACK_COLORS = [
  "var(--chat-chart-1)",
  "var(--chat-chart-2)",
  "var(--chat-chart-3)",
  "var(--chat-chart-4)",
  "var(--chat-chart-5)",
  "var(--chat-chart-6)",
  "var(--chat-chart-7)",
  "var(--chat-chart-8)",
];

const NAMED_DARK_COLORS = new Set(["black"]);

const SUPPORTED_TYPES = new Set<string>([
  ChartType.BAR,
  ChartType.LINE,
  ChartType.AREA,
  ChartType.PIE,
  ChartType.DONUT,
]);

const toNumber = (value: string | number) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/[,\s$€£¥%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatValue = (value: string | number | undefined) => {
  if (value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString();
  const numeric = toNumber(value);
  return String(value).trim() !== "" && Number.isFinite(numeric)
    ? numeric.toLocaleString()
    : String(value);
};

const truncateLabel = (label: string | number, maxLength = 14) => {
  const text = String(label);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const isNearBlack = (color?: string) => {
  if (!color) return false;
  const value = color.trim().toLowerCase();
  if (NAMED_DARK_COLORS.has(value)) return true;
  if (value === "var(--highlight-color)") return true;

  const shortHex = value.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("").map((char) => parseInt(char + char, 16));
    return r <= 24 && g <= 24 && b <= 24;
  }

  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const r = parseInt(hex[1].slice(0, 2), 16);
    const g = parseInt(hex[1].slice(2, 4), 16);
    const b = parseInt(hex[1].slice(4, 6), 16);
    return r <= 24 && g <= 24 && b <= 24;
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").slice(0, 3).map((part) => Number(part.trim()));
    return [r, g, b].every((channel) => Number.isFinite(channel) && channel <= 24);
  }

  return false;
};

const sanitizeColor = (color: string | undefined, index: number) =>
  color && !isNearBlack(color) ? color : FALLBACK_COLORS[index % FALLBACK_COLORS.length];

const getPalette = (config: ChartConfiguration) => {
  const palette = (config.styling as { colorPalette?: string[] } | undefined)?.colorPalette;
  if (!Array.isArray(palette) || palette.length === 0) return FALLBACK_COLORS;
  return palette.map((color, index) => sanitizeColor(color, index));
};

const getDatasets = (config: ChartConfiguration): ChartDataset[] =>
  Array.isArray(config.datasets) ? config.datasets : [];

const useCartesianData = (datasets: ChartDataset[]) => {
  return useMemo(() => {
    const labels = new Set<string>();
    datasets.forEach((dataset) => {
      dataset.data?.forEach((point) => labels.add(String(point.label)));
    });

    return Array.from(labels).map((label) => {
      const row: ChartRow = { label };
      datasets.forEach((dataset) => {
        const point = dataset.data?.find((item) => String(item.label) === label);
        row[dataset.label] = point ? toNumber(point.value) : 0;
      });
      return row;
    });
  }, [datasets]);
};

const CompactTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg dark:border-white/10 dark:bg-[#151515] dark:text-white">
      <div className="mb-1 max-w-[220px] truncate font-medium">{label}</div>
      <div className="space-y-0.5">
        {payload.map((entry, index) => (
          <div key={`${entry.dataKey || entry.name || index}`} className="flex items-center justify-between gap-4">
            <span className="max-w-[150px] truncate" style={{ color: entry.color }}>
              {entry.name || entry.dataKey}
            </span>
            <span className="font-medium">{formatValue(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const CompactPieLegend = (props: {
  data: Array<{ name: string; value: number }>;
  palette: string[];
  variant: "inline" | "modal";
}) => {
  const { data, palette, variant } = props;
  const maxVisible = variant === "modal" ? 14 : 10;
  const visibleData = data.slice(0, maxVisible);
  const hiddenCount = Math.max(0, data.length - visibleData.length);

  return (
    <div className="min-w-0 shrink-0 py-1 text-xs text-muted-foreground">
      <div className="max-h-[240px] min-w-[120px] space-y-1 overflow-y-auto pr-1">
        {visibleData.map((entry, index) => (
          <div key={`${entry.name}-${index}`} className="flex min-w-0 items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: palette[index % palette.length] }}
            />
            <span className="min-w-0 flex-1 truncate" title={entry.name}>
              {entry.name}
            </span>
          </div>
        ))}
        {hiddenCount > 0 && (
          <div className="pt-0.5 text-[10px] text-muted-foreground/70">
            +{hiddenCount} more
          </div>
        )}
      </div>
    </div>
  );
};

const ChartLegend = (props: { datasetCount: number }) =>
  props.datasetCount > 1 ? (
    <Legend
      wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
      iconSize={8}
      verticalAlign="bottom"
    />
  ) : null;

export function ChatInlineChart({ artifact, variant = "inline", compact = false }: ChatInlineChartProps) {
  const config = artifact.component.component_config as ChartConfiguration;
  const chartType = String(config.type || "").toLowerCase();
  const datasets = getDatasets(config);
  const rows = useCartesianData(datasets);
  const palette = getPalette(config);
  const heightClass = variant === "modal" ? "h-full" : compact ? "h-[184px]" : "h-[272px]";
  const labelCount = rows.length;
  const xInterval = labelCount > 12 ? Math.ceil(labelCount / 10) - 1 : 0;
  const hasLongLabels = rows.some((row) => String(row.label).length > 12);
  const bottomMargin = hasLongLabels ? 34 : 14;
  const commonAxisProps = {
    tick: { fill: "var(--element-color)", fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: "var(--element-color)", opacity: 0.45 },
  };

  if (!SUPPORTED_TYPES.has(chartType)) {
    return <ChartRenderer component={artifact.component} />;
  }

  if (!datasets.length) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-background/60 text-sm text-muted-foreground dark:border-white/10 dark:bg-black/20">
        No chart data available
      </div>
    );
  }

  const cartesianMargin = { top: 8, right: 12, left: 0, bottom: bottomMargin };

  if (chartType === ChartType.PIE || chartType === ChartType.DONUT) {
    const pieData = (datasets[0]?.data || []).map((point) => ({
      name: String(point.label),
      value: toNumber(point.value),
    }));
    const showLegend = pieData.length > 1;
    const showLabels = pieData.length <= 5 && !showLegend;
    const pieHeight = variant === "modal" ? "100%" : compact ? 184 : 256;

    return (
      <div className={`flex min-h-0 items-center gap-3 rounded-lg bg-background/70 p-2 dark:bg-black/20 ${heightClass}`}>
        <div className="min-h-0 min-w-0 flex-1">
          <ResponsiveContainer width="100%" height={pieHeight}>
            <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={variant === "modal" ? "72%" : "68%"}
                innerRadius={chartType === ChartType.DONUT ? "42%" : 0}
                label={showLabels ? ({ name }) => truncateLabel(String(name), 12) : false}
                labelLine={showLabels}
                isAnimationActive={false}
              >
                {pieData.map((entry, index) => (
                  <Cell key={entry.name} fill={palette[index % palette.length]} />
                ))}
              </Pie>
              <Tooltip content={<CompactTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {showLegend && (
          <CompactPieLegend data={pieData} palette={palette} variant={variant} />
        )}
      </div>
    );
  }

  const renderSeries = () =>
    datasets.map((dataset, index) => {
      const color = dataset.color
        ? sanitizeColor(dataset.color, index)
        : palette[index % palette.length];
      if (chartType === ChartType.LINE) {
        return (
          <Line
            key={dataset.label}
            type="monotone"
            dataKey={dataset.label}
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        );
      }
      if (chartType === ChartType.AREA) {
        return (
          <Area
            key={dataset.label}
            type="monotone"
            dataKey={dataset.label}
            stroke={color}
            fill={color}
            fillOpacity={0.25}
            isAnimationActive={false}
          />
        );
      }
      return (
        <Bar
          key={dataset.label}
          dataKey={dataset.label}
          fill={color}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      );
    });

  const chartProps = {
    data: rows,
    margin: cartesianMargin,
  };

  const chartBody = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--element-color)" opacity={0.35} />
      <XAxis
        dataKey="label"
        interval={xInterval}
        tickFormatter={(value) => truncateLabel(value, 13)}
        angle={hasLongLabels ? -24 : 0}
        textAnchor={hasLongLabels ? "end" : "middle"}
        height={hasLongLabels ? 46 : 28}
        {...commonAxisProps}
      />
      <YAxis
        width={52}
        tickFormatter={(value) => truncateLabel(formatValue(value), 9)}
        {...commonAxisProps}
      />
      <Tooltip content={<CompactTooltip />} />
      <ChartLegend datasetCount={datasets.length} />
      {renderSeries()}
    </>
  );

  return (
    <div className={`min-h-0 rounded-lg bg-background/70 p-2 dark:bg-black/20 ${heightClass}`}>
      <ResponsiveContainer width="100%" height="100%">
        {chartType === ChartType.LINE ? (
          <LineChart {...chartProps}>{chartBody}</LineChart>
        ) : chartType === ChartType.AREA ? (
          <AreaChart {...chartProps}>{chartBody}</AreaChart>
        ) : (
          <BarChart {...chartProps}>{chartBody}</BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
