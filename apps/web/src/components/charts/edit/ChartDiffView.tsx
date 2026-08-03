/**
 * ChartDiffView — Phase 7 before/after diff for a single chart.
 *
 * Renders two ChartRenderer instances side-by-side (Before / After) plus a
 * field-level change list from diffChartConfigs. Accepts either a full
 * DashboardComponent or a bare chart config for each side. Responsive: the two
 * charts stack on narrow widths.
 */
import { useMemo } from 'react';
import ChartRenderer from '@/components/charts/ChartRenderer';
import { diffChartConfigs, type EditDiffEntry } from '@/utils/chartChangeDiff';
import type { DashboardComponent } from '@/types/dashboard';

type ChartConfigLike = Record<string, unknown>;
type DiffSide = DashboardComponent | ChartConfigLike;

interface ChartDiffViewProps {
  before: DiffSide;
  after: DiffSide;
  /** Pre-computed diff; when omitted it is derived from the two configs. */
  diff?: EditDiffEntry[];
}

function isComponent(side: DiffSide): side is DashboardComponent {
  return typeof side === 'object' && side != null && 'component_config' in side;
}

/** Pull the chart config out of either a component or a bare config. */
function toConfig(side: DiffSide): ChartConfigLike {
  return isComponent(side)
    ? (side.component_config as ChartConfigLike)
    : (side as ChartConfigLike);
}

/** Wrap a bare config into a minimal DashboardComponent so ChartRenderer can draw it. */
function toComponent(side: DiffSide): DashboardComponent {
  if (isComponent(side)) return side;
  const config = side as ChartConfigLike;
  const type = (config.type === 'metric' || config.type === 'table')
    ? (config.type as DashboardComponent['type'])
    : 'chart';
  return {
    id: String(config.id ?? 'diff-chart'),
    type,
    position: { x: 0, y: 0, width: 1, height: 1 },
    component_config: config as DashboardComponent['component_config'],
  };
}

const KIND_LABEL: Record<EditDiffEntry['kind'], string> = {
  type: 'Type',
  series: 'Series',
  style: 'Style',
  filter: 'Filter',
  other: 'Other',
};

export const ChartDiffView = ({ before, after, diff }: ChartDiffViewProps) => {
  const entries = useMemo(
    () => diff ?? diffChartConfigs(toConfig(before), toConfig(after)),
    [diff, before, after],
  );
  const beforeComponent = useMemo(() => toComponent(before), [before]);
  const afterComponent = useMemo(() => toComponent(after), [after]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Before
          </div>
          <div className="h-64">
            <ChartRenderer component={beforeComponent} />
          </div>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            After
          </div>
          <div className="h-64">
            <ChartRenderer component={afterComponent} />
          </div>
        </div>
      </div>

      {entries.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {entries.map((entry, index) => (
            <li key={`${entry.field}-${index}`} className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {KIND_LABEL[entry.kind]}
              </span>
              <span className="font-medium">{entry.field}</span>
              {entry.before != null && (
                <span className="text-muted-foreground line-through">{entry.before}</span>
              )}
              {entry.before != null && entry.after != null && (
                <span className="text-muted-foreground">→</span>
              )}
              {entry.after != null && <span className="text-foreground">{entry.after}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No field-level changes detected.</p>
      )}
    </div>
  );
};
