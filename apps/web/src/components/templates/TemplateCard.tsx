import React from 'react';
import { DreamifyTemplate } from '@/constants/builtinTemplates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';

interface TemplateCardProps {
  template: DreamifyTemplate;
  onPreview: (template: DreamifyTemplate) => void;
  onSelect: (template: DreamifyTemplate) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({ template, onPreview, onSelect }) => {
  const metricNames = template.content_spec.required_metrics
    .slice(0, 3)
    .map(m => m.name.split('(')[0].trim())
    .join(', ');

  return (
    <div
      className="group relative bg-card border border-border rounded-xl p-5 flex flex-col gap-3 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
      onClick={() => onPreview(template)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-foreground truncate">{template.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{template.description}</p>
        </div>
        <Badge variant="secondary" className="shrink-0 text-xs">{template.category}</Badge>
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">Tracks: </span>
        {metricNames}
        {template.content_spec.required_metrics.length > 3 && ` +${template.content_spec.required_metrics.length - 3} more`}
      </div>

      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/50">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-xs"
          onClick={(e) => { e.stopPropagation(); onPreview(template); }}
        >
          Preview
        </Button>
        <Button
          size="sm"
          className="flex-1 h-7 text-xs"
          onClick={(e) => { e.stopPropagation(); onSelect(template); }}
        >
          Use <ChevronRight className="w-3 h-3 ml-1" />
        </Button>
      </div>
    </div>
  );
};
