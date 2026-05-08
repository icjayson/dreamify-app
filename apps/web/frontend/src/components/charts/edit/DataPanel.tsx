import { useState } from 'react';
import { Database } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DashboardComponent, ChartConfiguration, MetricConfiguration, TableConfiguration } from '@/types/dashboard';
import PanelEmptyState from './PanelEmptyState';

interface DataPanelProps {
  component: DashboardComponent;
  onApplyEdit: (componentId: string, patch: Record<string, any>) => void;
}

const DataPanel: React.FC<DataPanelProps> = ({ component, onApplyEdit }) => {
  if (component.type === 'metric') {
    return <MetricDataEditor component={component} onApplyEdit={onApplyEdit} />;
  }
  if (component.type === 'table') {
    return <TableDataEditor component={component} onApplyEdit={onApplyEdit} />;
  }
  return <ChartDatasetsEditor component={component} onApplyEdit={onApplyEdit} />;
};

// ──────────────────────────────────────────────────────────────────────────────

const MetricDataEditor: React.FC<DataPanelProps> = ({ component, onApplyEdit }) => {
  const cfg = component.component_config as MetricConfiguration;
  const tc = cfg.timeComparison || {};
  const set = (patch: Record<string, any>) => onApplyEdit(component.id, patch);
  const setTC = (patch: Record<string, any>) => onApplyEdit(component.id, { timeComparison: { ...tc, ...patch } });

  return (
    <div className="space-y-4 text-sm">
      <Field label="Value">
        <Input
          data-edit-control
          defaultValue={String(cfg.value ?? '')}
          onBlur={(e) => set({ value: e.currentTarget.value })}
        />
      </Field>
      <Field label="Change">
        <Input
          data-edit-control
          defaultValue={String(cfg.change ?? '')}
          onBlur={(e) => set({ change: e.currentTarget.value })}
        />
      </Field>
      <Field label="Trend">
        <select
          data-edit-control
          defaultValue={String(cfg.trend ?? 'stable')}
          onChange={(e) => set({ trend: e.currentTarget.value })}
          className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="up">Up</option>
          <option value="down">Down</option>
          <option value="stable">Stable</option>
        </select>
      </Field>
      <hr className="border-border" />
      <div className="text-xs uppercase tracking-wide opacity-70">Time comparison</div>
      <Field label="Period">
        <Input
          data-edit-control
          defaultValue={String(tc.period ?? '')}
          onBlur={(e) => setTC({ period: e.currentTarget.value })}
          placeholder="MoM, YoY, WoW"
        />
      </Field>
      <Field label="% change">
        <Input
          data-edit-control
          type="number"
          defaultValue={tc.percentage_change ?? ''}
          onBlur={(e) => setTC({ percentage_change: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
        />
      </Field>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────

const TableDataEditor: React.FC<DataPanelProps> = ({ component, onApplyEdit }) => {
  const cfg = component.component_config as TableConfiguration;
  const cols = (Array.isArray(cfg.columns) && cfg.columns.length > 0 && typeof cfg.columns[0] !== 'string')
    ? (cfg.columns as any[])
    : [];

  if (cols.length === 0) {
    return (
      <PanelEmptyState
        icon={Database}
        title="Inline editing only"
        hint="Click any cell directly in the table to edit its value."
      />
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Edit cells directly in the table. Use the controls below to add or remove rows.
      </p>
      <button
        type="button"
        data-edit-control
        onClick={() => {
          const empty: Record<string, any> = {};
          cols.forEach((c: any) => { empty[c.key] = ''; });
          onApplyEdit(component.id, { data: [...(cfg.data || []), empty] });
        }}
        className="w-full h-9 rounded-md border border-input text-sm hover:bg-muted"
      >
        + Add row
      </button>
      {(cfg.data || []).length > 0 && (
        <button
          type="button"
          data-edit-control
          onClick={() => onApplyEdit(component.id, { data: (cfg.data || []).slice(0, -1) })}
          className="w-full h-9 rounded-md border border-input text-sm hover:bg-muted"
        >
          − Remove last row
        </button>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────

const ChartDatasetsEditor: React.FC<DataPanelProps> = ({ component, onApplyEdit }) => {
  const cfg = component.component_config as ChartConfiguration;
  const datasets = cfg.datasets || [];
  const [activeIdx, setActiveIdx] = useState(0);

  if (datasets.length === 0) {
    return (
      <PanelEmptyState
        icon={Database}
        title="No datasets to edit"
        hint="Use the Structure tab to add a dataset to this chart."
      />
    );
  }

  const ds = datasets[Math.min(activeIdx, datasets.length - 1)];

  const updateDatapoint = (pointIdx: number, field: 'label' | 'value', raw: string) => {
    const value = field === 'value' ? (Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : raw) : raw;
    const nextDatasets = datasets.map((d, i) => {
      if (i !== activeIdx) return d;
      const nextData = [...(d.data || [])];
      nextData[pointIdx] = { ...nextData[pointIdx], [field]: value };
      return { ...d, data: nextData };
    });
    onApplyEdit(component.id, { datasets: nextDatasets });
  };

  return (
    <div className="space-y-3 text-sm">
      {datasets.length > 1 && (
        <Field label="Dataset">
          <select
            data-edit-control
            value={activeIdx}
            onChange={(e) => setActiveIdx(Number(e.currentTarget.value))}
            className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {datasets.map((d, i) => <option key={i} value={i}>{d.label || `Series ${i + 1}`}</option>)}
          </select>
        </Field>
      )}
      <div className="rounded-md border border-input">
        <div className="grid grid-cols-2 gap-1 p-2 border-b border-input bg-muted/40 text-xs font-medium">
          <span>Label</span>
          <span>Value</span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {(ds.data || []).map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-1 p-1 border-b border-input/50">
              <Input
                data-edit-control
                defaultValue={String(p.label ?? '')}
                onBlur={(e) => updateDatapoint(i, 'label', e.currentTarget.value)}
                className="h-8 text-xs"
              />
              <Input
                data-edit-control
                defaultValue={String(p.value ?? '')}
                onBlur={(e) => updateDatapoint(i, 'value', e.currentTarget.value)}
                className="h-8 text-xs"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <Label className="text-xs opacity-70">{label}</Label>
    {children}
  </div>
);

export default DataPanel;
