/**
 * EditableText — DOM-text inline editor used by chart titles, descriptions,
 * MetricCard fields, and Table headers/cells.
 *
 * - Read-only when not in edit mode (no DOM-level affordance).
 * - In edit mode, becomes contentEditable on click. Commits on blur or Enter.
 * - The path string identifies which config field this maps to (deep dot-path).
 */
import { useEffect, useRef, type JSX } from 'react';
import { setAtPath } from '@/utils/deepMerge';
import { useEditContext } from './EditContext';

interface EditableTextProps {
  /** Current value to display. */
  value: string | number | null | undefined;
  /** Dot-path inside component_config (e.g. "title", "axisConfig.x_axis.label", "columns.0.label"). */
  path: string;
  /** Optional formatter for display only — the underlying stored value is whatever the user types. */
  format?: (v: any) => string;
  /** Optional parse — convert raw input to stored value type (e.g. Number for numeric fields). Default: identity. */
  parse?: (raw: string) => any;
  /** Renders the surrounding tag (default span). */
  as?: keyof JSX.IntrinsicElements;
  /** Allow multi-line editing (Enter inserts newline). Default false. */
  multiline?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Force-disable editing even inside edit mode (e.g. computed values). */
  readOnly?: boolean;
  /** Optional placeholder when value is empty. */
  placeholder?: string;
  /**
   * Optional commit override. When provided, replaces the default
   * `ctx.applyEdit(setAtPath({}, path, parsed))` behavior. Used by Table
   * cells to emit full-array patches (`applyEdit({ data: [...] })`) instead
   * of nested-path patches that deepMerge would corrupt.
   */
  onCommit?: (parsed: unknown) => void;
}

const splitPath = (path: string): (string | number)[] =>
  path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));

const EditableText: React.FC<EditableTextProps> = ({
  value,
  path,
  format,
  parse,
  as: Tag = 'span',
  multiline = false,
  className,
  style,
  readOnly = false,
  placeholder,
  onCommit,
}) => {
  const ctx = useEditContext();
  const ref = useRef<HTMLElement | null>(null);
  const display = format ? format(value) : (value === null || value === undefined ? '' : String(value));
  const editable = !!ctx?.editMode && !readOnly;

  // Hooks MUST run on every render to satisfy Rules of Hooks. The early
  // return below is conditional on `editable`+`display`, which can flip
  // between renders (e.g. view→edit on an empty table cell). Putting the
  // effect after the return caused React to throw "Rendered more hooks
  // than during the previous render." The internal `if (!el) return`
  // handles the null-DOM case when the component is currently returning
  // null.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el) {
      el.textContent = display;
    }
  }, [display]);

  // When not in edit mode and value is empty, render nothing — preserves
  // existing layout (e.g. description hidden when missing).
  if (!editable && !display) return null;

  const commit = () => {
    if (!ctx) return;
    const raw = ref.current?.textContent ?? '';
    const stored = parse ? parse(raw) : raw;
    // No-op: blur without any actual change must not emit a patch — otherwise
    // every time the user clicks a cell and clicks away (e.g. to hit Save),
    // a redundant write fires that can corrupt array fields via deepMerge.
    // Compare against the canonical display so format-only diffs don't trip us.
    const incomingDisplay = stored === null || stored === undefined ? '' : String(stored);
    const currentDisplay = value === null || value === undefined ? '' : String(value);
    if (incomingDisplay === currentDisplay) return;
    if (onCommit) {
      onCommit(stored);
      return;
    }
    const next = setAtPath({}, splitPath(path), stored);
    ctx.applyEdit(next);
  };

  const TagComp = Tag as any;
  return (
    <TagComp
      ref={(el: HTMLElement | null) => { ref.current = el; }}
      contentEditable={editable}
      suppressContentEditableWarning
      data-edit-control={editable ? 'inline-text' : undefined}
      data-placeholder={!display && placeholder ? placeholder : undefined}
      role={editable ? 'textbox' : undefined}
      spellCheck={editable}
      className={`${editable ? 'editable-text-edit' : ''} ${className || ''}`}
      style={{
        outline: 'none',
        ...(editable
          ? {
              borderRadius: 4,
              padding: '0 2px',
              boxShadow: 'inset 0 0 0 1px rgba(96,165,250,0.4)',
              cursor: 'text',
            }
          : {}),
        ...style,
      }}
      onClick={editable ? (e: React.MouseEvent) => e.stopPropagation() : undefined}
      onMouseDown={editable ? (e: React.MouseEvent) => e.stopPropagation() : undefined}
      onBlur={editable ? commit : undefined}
      onKeyDown={editable ? (e: React.KeyboardEvent<HTMLElement>) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        } else if (e.key === 'Escape') {
          // Restore display value
          if (ref.current) ref.current.textContent = display;
          (e.currentTarget as HTMLElement).blur();
        }
      } : undefined}
    >
      {display}
    </TagComp>
  );
};

export default EditableText;
