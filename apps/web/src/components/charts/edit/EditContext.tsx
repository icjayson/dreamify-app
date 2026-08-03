/**
 * EditContext — per-component edit affordance, scoped to one chart's subtree.
 *
 * The DashboardPreview wraps each rendered component with this provider when
 * edit mode is on. Inside, any editable surface (chart title, axis label,
 * datapoint, table cell) reads `editMode` and calls `applyEdit(patch)` —
 * which scopes the patch to the surrounding componentId automatically.
 */
import React, { createContext, useContext, useMemo } from 'react';

interface EditContextValue {
  editMode: boolean;
  componentId: string;
  applyEdit: (patch: Record<string, any>) => void;
  selectComponent: () => void;
  isSelected: boolean;
}

const EditContext = createContext<EditContextValue | null>(null);

interface ProviderProps {
  editMode: boolean;
  componentId: string;
  isSelected: boolean;
  onApplyEdit: (componentId: string, patch: Record<string, any>) => void;
  onSelectComponent: (componentId: string) => void;
  children: React.ReactNode;
}

export const EditProvider: React.FC<ProviderProps> = ({
  editMode,
  componentId,
  isSelected,
  onApplyEdit,
  onSelectComponent,
  children,
}) => {
  const value = useMemo<EditContextValue>(
    () => ({
      editMode,
      componentId,
      isSelected,
      applyEdit: (patch) => onApplyEdit(componentId, patch),
      selectComponent: () => onSelectComponent(componentId),
    }),
    [editMode, componentId, isSelected, onApplyEdit, onSelectComponent]
  );
  return <EditContext.Provider value={value}>{children}</EditContext.Provider>;
};

/** Returns null when not inside an EditProvider — chart components must guard. */
export const useEditContext = (): EditContextValue | null => useContext(EditContext);
