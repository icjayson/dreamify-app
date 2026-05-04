import { RotateCcw } from 'lucide-react';
import { useEditMode } from '@/hooks/useEditMode';

interface EditedBadgeProps {
  componentId: string;
}

const EditedBadge: React.FC<EditedBadgeProps> = ({ componentId }) => {
  const isEdited = useEditMode((s) => s.isEdited(componentId));
  const editMode = useEditMode((s) => s.editMode);
  const revertComponent = useEditMode((s) => s.revertComponent);

  if (!isEdited) return null;

  return (
    <div
      className="absolute left-2 bottom-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium pointer-events-auto"
      data-export-exclude
      style={{
        backgroundColor: 'var(--highlight-color)',
        color: 'var(--bg-card-color)',
        opacity: 0.85,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span>Edited</span>
      {editMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            revertComponent(componentId);
          }}
          className="ml-1 inline-flex items-center hover:opacity-80"
          aria-label="Revert this component"
          title="Revert to generated"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

export default EditedBadge;
