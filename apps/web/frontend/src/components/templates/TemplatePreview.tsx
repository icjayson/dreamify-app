import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DreamifyTemplate } from '@/constants/builtinTemplates';
import { VisualCustomizer, VisualSelection } from './VisualCustomizer';
import { applyVisualSpec, CHART_PRESET_THEMES } from '@/utils/chartStyling';
import DashboardPreview from '@/components/project-section/DashboardPreview';

interface TemplatePreviewProps {
  template: DreamifyTemplate | null;
  onClose: () => void;
  onSelect: (template: DreamifyTemplate, visual: VisualSelection) => void;
}

export const TemplatePreview: React.FC<TemplatePreviewProps> = ({ template, onClose, onSelect }) => {
  const [visual, setVisual] = useState<VisualSelection>({
    theme: CHART_PRESET_THEMES.CARBON,
    chartStyle: 'rounded',
    density: 'comfortable'
  });

  if (!template) return null;

  const styledConfig = applyVisualSpec(template.sample_config, visual);
  const isLightTheme = visual.theme === 'chalk' || visual.theme === 'warm';

  return (
    <Dialog open={!!template} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-base">{template.name}</DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">{template.description}</p>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-auto p-4 bg-muted/30">
            <DashboardPreview
              staticConfig={styledConfig}
              className="w-full"
              showCardActionsMenu={false}
              isDarkMode={!isLightTheme}
            />
          </div>

          <div className="w-64 shrink-0 border-l overflow-y-auto p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">Customize Visual</p>
            <VisualCustomizer value={visual} onChange={setVisual} />

            <div className="mt-6 space-y-2">
              <p className="text-xs font-medium">Tracks</p>
              <ul className="space-y-1">
                {template.content_spec.required_metrics.map((m) => (
                  <li key={m.name} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" />
                    {m.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t flex justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => { onSelect(template, visual); onClose(); }}>Use This Template</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
