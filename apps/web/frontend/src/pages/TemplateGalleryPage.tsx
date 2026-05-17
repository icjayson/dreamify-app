import React from 'react';
import { useNavigate } from 'react-router-dom';
import { VISUAL_THEMES, createThemeSelection } from '@/constants/builtinTemplates';
import TemplateColorPreview from '@/components/templates/TemplateColorPreview';
import { Button } from '@/components/ui/button';

const TemplateGalleryPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSelect = (themeId: string) => {
    const selection = createThemeSelection(themeId);
    if (selection) {
      sessionStorage.setItem('dreamify:selected_theme', JSON.stringify(selection));
    }
    navigate('/workspace?tab=new-chat&openTemplate=1');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Themes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a visual style for your next dashboard. Analysis focus is selected separately when you start a run.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {VISUAL_THEMES.map((theme) => (
            <div
              key={theme.id}
              className="group overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/50 hover:shadow-md"
            >
              <div className="aspect-video overflow-hidden border-b border-border">
                <TemplateColorPreview theme={theme.id} className="h-full w-full" />
              </div>
              <div className="p-4">
                <h3 className="text-sm font-semibold text-foreground">{theme.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{theme.description}</p>
                <Button size="sm" className="mt-4 h-8 w-full text-xs" onClick={() => handleSelect(theme.id)}>
                  Use Theme
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TemplateGalleryPage;
