import { Pencil, RotateCcw, Check, Eye } from 'lucide-react';
import { useEditMode } from '@/hooks/useEditMode';

interface EditModeToolbarProps {
  className?: string;
  onSave?: () => void;
  isSaving?: boolean;
}

const EditModeToolbar: React.FC<EditModeToolbarProps> = ({ className = '', onSave, isSaving = false }) => {
  const editMode = useEditMode((s) => s.editMode);
  const setEditMode = useEditMode((s) => s.setEditMode);
  const resetAllEdits = useEditMode((s) => s.resetAllEdits);
  const isDirty = useEditMode((s) => s.isDirty);

  const handleEditToggle = () => {
    if (editMode && isDirty) {
      if (window.confirm('Exit without saving? Your unsaved changes will be lost.')) {
        resetAllEdits();
        setEditMode(false);
      }
      // else: stay in edit mode
    } else {
      setEditMode(!editMode);
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`} data-export-exclude>
      {isDirty && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Discard all edits and restore the generated dashboard?')) {
              resetAllEdits();
            }
          }}
          className="button-outline h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 text-muted-foreground hover:text-foreground dark:text-white/70 dark:hover:text-white"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      )}
      {isDirty && (
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="button-outline h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 text-muted-foreground hover:text-foreground dark:text-white/70 dark:hover:text-white disabled:opacity-50"
          title="Save dashboard edits"
        >
          <Check className="w-3.5 h-3.5" />
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      )}
      <button
        type="button"
        onClick={handleEditToggle}
        title={editMode ? 'Exit edit mode' : 'Enter edit mode'}
        className={`button-outline h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 dark:hover:text-white ${
          editMode
            ? 'text-foreground border-foreground/40 dark:text-white'
            : 'text-muted-foreground hover:text-foreground dark:text-white/70'
        }`}
      >
        {editMode ? (
          <>
            <Eye className="w-3.5 h-3.5" />
            View
          </>
        ) : (
          <>
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </>
        )}
      </button>
    </div>
  );
};

export default EditModeToolbar;
