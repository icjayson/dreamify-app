import { useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Palette } from 'lucide-react';
import type { DashboardComponent, ChartConfiguration } from '@/types/dashboard';
import ColorPicker from './ColorPicker';
import PanelEmptyState from './PanelEmptyState';

interface StylePanelProps {
  component: DashboardComponent;
  onApplyEdit: (componentId: string, patch: Record<string, any>) => void;
}

/** Chart styling fields — only meaningful for `chart`-type components. */
const StylePanel: React.FC<StylePanelProps> = ({ component, onApplyEdit }) => {
  const cfg = component.component_config as any;
  const isChart = component.type === 'chart';
  const styling = cfg?.styling || {};
  const datasets = useMemo(
    () => (cfg as ChartConfiguration)?.datasets || [],
    [cfg],
  );

  const palette: string[] = useMemo(
    () => Array.isArray(styling.colorPalette) && styling.colorPalette.length > 0
      ? styling.colorPalette
      : datasets.map((d: any, i: number) => d.color || ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'][i % 5]),
    [styling.colorPalette, datasets]
  );

  const patchStyling = (patch: Record<string, any>) => {
    onApplyEdit(component.id, { styling: { ...styling, ...patch } });
  };
  const patchPaletteAt = (index: number, color: string) => {
    const next = [...palette];
    next[index] = color;
    patchStyling({ colorPalette: next });
  };
  const patchDatasetColor = (index: number, color: string) => {
    // Also update dataset.color so renderers that read per-dataset color pick it up
    const nextDatasets = datasets.map((d: any, i: number) => i === index ? { ...d, color } : d);
    onApplyEdit(component.id, { datasets: nextDatasets });
    patchPaletteAt(index, color);
  };

  if (!isChart) {
    return (
      <PanelEmptyState
        icon={Palette}
        title={component.type === 'metric' ? 'No style options for metrics yet' : 'No style options for tables yet'}
        hint="Use the Data tab to edit values, or the dashboard-level template to change colors."
      />
    );
  }

  return (
    <div className="space-y-5 text-sm">
      {isChart && (
        <>
          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide opacity-70">Colors</Label>
            <div className="space-y-3">
              {datasets.length > 0
                ? datasets.map((d: any, i: number) => (
                    <ColorPicker
                      key={`${d.label}-${i}`}
                      label={d.label || `Series ${i + 1}`}
                      value={d.color || palette[i] || '#3b82f6'}
                      onChange={(c) => patchDatasetColor(i, c)}
                    />
                  ))
                : palette.map((c, i) => (
                    <ColorPicker
                      key={i}
                      label={`Color ${i + 1}`}
                      value={c}
                      onChange={(nc) => patchPaletteAt(i, nc)}
                    />
                  ))}
            </div>
          </section>

          <section className="space-y-3">
            <Label className="text-xs uppercase tracking-wide opacity-70">Layout</Label>

            <div className="flex items-center justify-between">
              <Label htmlFor="legend-pos" className="text-sm">Legend</Label>
              <Select
                value={styling.legendPosition || 'bottom'}
                onValueChange={(v) => patchStyling({ legendPosition: v })}
              >
                <SelectTrigger id="legend-pos" className="w-32 h-8" data-edit-control>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">Top</SelectItem>
                  <SelectItem value="bottom">Bottom</SelectItem>
                  <SelectItem value="none">Hidden</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="grid-vis" className="text-sm">Grid lines</Label>
              <Switch
                id="grid-vis"
                checked={styling.gridVisible !== false}
                onCheckedChange={(v) => patchStyling({ gridVisible: v })}
                data-edit-control
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="anim" className="text-sm">Animations</Label>
              <Switch
                id="anim"
                checked={styling.animationEnabled !== false}
                onCheckedChange={(v) => patchStyling({ animationEnabled: v })}
                data-edit-control
              />
            </div>


          </section>
        </>
      )}


    </div>
  );
};

export default StylePanel;
