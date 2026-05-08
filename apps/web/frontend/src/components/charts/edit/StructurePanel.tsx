import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Layers } from 'lucide-react';
import {
  type DashboardComponent,
  type ChartConfiguration,
  ChartType,
} from '@/types/dashboard';
import PanelEmptyState from './PanelEmptyState';

interface StructurePanelProps {
  component: DashboardComponent;
  onApplyEdit: (componentId: string, patch: Record<string, any>) => void;
}

/**
 * Within-family chart-type swaps that share data shape ({label, value} per
 * datapoint, multiple datasets). Cross-family swaps (pie ↔ bar, sankey, etc.)
 * are deferred — different shapes would require data remapping.
 */
const COMPATIBLE_TYPES: { value: ChartType; label: string }[] = [
  { value: ChartType.BAR, label: 'Bar' },
  { value: ChartType.LINE, label: 'Line' },
  { value: ChartType.AREA, label: 'Area' },
  { value: ChartType.COMPOSED, label: 'Composed' },
  { value: ChartType.STACKED_BAR, label: 'Stacked bar' },
  { value: ChartType.STACKED_COLUMN, label: 'Stacked column' },
];

const isCompatible = (t: ChartType): boolean =>
  COMPATIBLE_TYPES.some((c) => c.value === t);

const StructurePanel: React.FC<StructurePanelProps> = ({ component, onApplyEdit }) => {
  if (component.type !== 'chart') {
    return (
      <PanelEmptyState
        icon={Layers}
        title="Structure edits are only for charts"
        hint={component.type === 'table'
          ? 'For tables, use the Data tab to add or remove rows.'
          : 'Metrics have no structural options — edit the value directly via the Data tab.'}
      />
    );
  }

  const cfg = component.component_config as ChartConfiguration;
  const datasets = cfg.datasets || [];
  const canSwapType = isCompatible(cfg.type);

  const addDataset = () => {
    const seedData = datasets[0]?.data?.map((p) => ({ label: p.label, value: 0 })) || [{ label: 'A', value: 0 }];
    const next = [
      ...datasets,
      { label: `Series ${datasets.length + 1}`, data: seedData },
    ];
    onApplyEdit(component.id, { datasets: next });
  };

  const removeDataset = (idx: number) => {
    const next = datasets.filter((_, i) => i !== idx);
    onApplyEdit(component.id, { datasets: next });
  };

  const renameDataset = (idx: number, label: string) => {
    const next = datasets.map((d, i) => i === idx ? { ...d, label } : d);
    onApplyEdit(component.id, { datasets: next });
  };

  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <Label className="text-xs uppercase tracking-wide opacity-70">Chart type</Label>
        {canSwapType ? (
          <select
            data-edit-control
            value={cfg.type}
            onChange={(e) => onApplyEdit(component.id, { type: e.currentTarget.value })}
            className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {COMPATIBLE_TYPES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-muted-foreground">
            Type swap not available for {cfg.type} charts (data shape differs).
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide opacity-70">Datasets</Label>
          <button
            type="button"
            data-edit-control
            onClick={addDataset}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input text-xs hover:bg-muted"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        <div className="space-y-1.5">
          {datasets.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                data-edit-control
                defaultValue={d.label}
                onBlur={(e) => renameDataset(i, e.currentTarget.value)}
                className="h-8 text-xs flex-1"
              />
              <button
                type="button"
                data-edit-control
                onClick={() => removeDataset(i)}
                disabled={datasets.length <= 1}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input text-red-500 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Remove ${d.label}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {(cfg.type === ChartType.STACKED_BAR || cfg.type === ChartType.STACKED_COLUMN) && (
        <section className="space-y-2">
          <Label className="text-xs uppercase tracking-wide opacity-70">Stacking</Label>
          <div className="flex items-center justify-between">
            <Label htmlFor="normalized" className="text-sm">Normalized (100%)</Label>
            <Switch
              id="normalized"
              data-edit-control
              checked={!!(cfg.config as any)?.normalized}
              onCheckedChange={(v) => onApplyEdit(component.id, { config: { ...(cfg.config || {}), normalized: v } })}
            />
          </div>
        </section>
      )}
    </div>
  );
};

export default StructurePanel;
