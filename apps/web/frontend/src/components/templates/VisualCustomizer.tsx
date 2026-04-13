import React from 'react';
import { CHART_PRESET_THEMES, ChartPresetTheme, CHART_STYLE_VARIANTS, ChartStyleVariant, CHART_THEME_COLORS } from '@/utils/chartStyling';
import { Label } from '@/components/ui/label';

export interface VisualSelection {
  theme: ChartPresetTheme;
  chartStyle: ChartStyleVariant;
  density: 'compact' | 'comfortable' | 'spacious';
}

interface VisualCustomizerProps {
  value: VisualSelection;
  onChange: (value: VisualSelection) => void;
}

const THEME_LABELS: Record<ChartPresetTheme, string> = {
  carbon: 'Carbon',
  slate: 'Slate',
  chalk: 'Chalk',
  warm: 'Warm',
  ash: 'Ash',
  sage: 'Sage',
  ink: 'Ink'
};

const STYLE_LABELS: Record<ChartStyleVariant, { label: string; description: string }> = {
  rounded: { label: 'Rounded', description: 'Soft corners, subtle shadows' },
  sharp: { label: 'Sharp', description: 'Flat edges, technical feel' },
  minimal: { label: 'Minimal', description: 'No borders, Tufte-style' }
};

export const VisualCustomizer: React.FC<VisualCustomizerProps> = ({ value, onChange }) => {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Color Theme</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.values(CHART_PRESET_THEMES) as ChartPresetTheme[]).map((themeId) => {
            const colors = CHART_THEME_COLORS[themeId];
            const isSelected = value.theme === themeId;
            return (
              <button
                key={themeId}
                onClick={() => onChange({ ...value, theme: themeId })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border hover:border-primary/40 text-muted-foreground'
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full shrink-0 ring-1 ring-border"
                  style={{
                    backgroundColor: colors['bg-dashboard-color'],
                    boxShadow: `inset 0 0 0 2px ${colors['highlight-color']}`
                  }}
                />
                {THEME_LABELS[themeId]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Chart Style</Label>
        <div className="flex flex-col gap-2">
          {(Object.values(CHART_STYLE_VARIANTS) as ChartStyleVariant[]).map((styleId) => {
            const info = STYLE_LABELS[styleId];
            const isSelected = value.chartStyle === styleId;
            return (
              <button
                key={styleId}
                onClick={() => onChange({ ...value, chartStyle: styleId })}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div className={`w-3 h-3 rounded-full mt-0.5 border-2 shrink-0 ${isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                <div>
                  <div className={`text-xs font-medium ${isSelected ? 'text-primary' : 'text-foreground'}`}>{info.label}</div>
                  <div className="text-xs text-muted-foreground">{info.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Density</Label>
        <div className="flex gap-2">
          {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
            <button
              key={d}
              onClick={() => onChange({ ...value, density: d })}
              className={`flex-1 py-2 text-xs rounded-lg border transition-all capitalize ${
                value.density === d
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border hover:border-primary/40 text-muted-foreground'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
