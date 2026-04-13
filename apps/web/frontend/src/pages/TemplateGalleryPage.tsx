import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES, DreamifyTemplate, TemplateCategory } from '@/constants/builtinTemplates';
import { TemplateCard } from '@/components/templates/TemplateCard';
import { TemplatePreview } from '@/components/templates/TemplatePreview';
import { VisualSelection } from '@/components/templates/VisualCustomizer';

const TemplateGalleryPage: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'All'>('All');
  const [previewTemplate, setPreviewTemplate] = useState<DreamifyTemplate | null>(null);
  const navigate = useNavigate();

  const filtered = activeCategory === 'All'
    ? BUILTIN_TEMPLATES
    : BUILTIN_TEMPLATES.filter(t => t.category === activeCategory);

  const handleSelect = (template: DreamifyTemplate, visual: VisualSelection) => {
    sessionStorage.setItem('dreamify:selected_template', JSON.stringify({ templateId: template.id, visual }));
    navigate('/workspace');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Templates</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Start with a domain-specific layout. Upload your data and Dreamify will populate it.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {(['All', ...TEMPLATE_CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                activeCategory === cat
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:border-primary/40'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onPreview={setPreviewTemplate}
              onSelect={setPreviewTemplate}
            />
          ))}
        </div>
      </div>

      <TemplatePreview
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        onSelect={(template, visual) => {
          setPreviewTemplate(null);
          handleSelect(template, visual);
        }}
      />
    </div>
  );
};

export default TemplateGalleryPage;
