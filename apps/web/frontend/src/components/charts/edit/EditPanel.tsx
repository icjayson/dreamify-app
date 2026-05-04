/**
 * EditPanel — right-side drawer with Style / Data / Structure tabs.
 *
 * Opens automatically when edit mode is on and a component is selected.
 */
import { useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEditMode } from '@/hooks/useEditMode';
import type { DashboardComponent } from '@/types/dashboard';
import StylePanel from './StylePanel';
import DataPanel from './DataPanel';
import StructurePanel from './StructurePanel';

interface EditPanelProps {
  components: DashboardComponent[];
}

const EditPanel: React.FC<EditPanelProps> = ({ components }) => {
  const editMode = useEditMode((s) => s.editMode);
  const selectedComponentId = useEditMode((s) => s.selectedComponentId);
  const setSelectedComponent = useEditMode((s) => s.setSelectedComponent);
  const applyFieldEdit = useEditMode((s) => s.applyFieldEdit);

  const selected = useMemo(
    () => components.find((c) => String(c.id) === String(selectedComponentId)) || null,
    [components, selectedComponentId]
  );

  const open = !!(editMode && selected);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) setSelectedComponent(null); }}>
      <SheetContent
        side="right"
        className="w-[380px] sm:max-w-[420px] overflow-y-auto"
        onPointerDownOutside={(e) => {
          // Allow clicks on the dashboard cards to switch selection without closing
          const target = e.target as HTMLElement;
          if (target.closest('[data-chart-id]')) e.preventDefault();
        }}
        data-export-exclude
      >
        <SheetHeader>
          <SheetTitle className="text-base">
            Edit: {(selected?.component_config as any)?.title || 'Component'}
          </SheetTitle>
        </SheetHeader>
        {selected && (
          <Tabs defaultValue="style" className="mt-4">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="style">Style</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
              <TabsTrigger value="structure">Structure</TabsTrigger>
            </TabsList>
            <TabsContent value="style" className="mt-4">
              <StylePanel component={selected} onApplyEdit={applyFieldEdit} />
            </TabsContent>
            <TabsContent value="data" className="mt-4">
              <DataPanel component={selected} onApplyEdit={applyFieldEdit} />
            </TabsContent>
            <TabsContent value="structure" className="mt-4">
              <StructurePanel component={selected} onApplyEdit={applyFieldEdit} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default EditPanel;
