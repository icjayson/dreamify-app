/**
 * InlineSvgTextEditor — singleton overlay mounted by DashboardPreview.
 *
 * Listens for clicks on any SVG <text> element annotated with
 * data-editable-svg-text, computes its bounding box, and renders a floating
 * HTML <input> at that position. Commits on blur/Enter via the edit store.
 *
 * Why an overlay rather than foreignObject: Recharts owns SVG layout;
 * injecting foreignObject into custom tick/label renderers is brittle across
 * chart types. The overlay is library-agnostic.
 */
import { useEffect, useRef, useState } from 'react';
import { setAtPath } from '@/utils/deepMerge';
import { useEditMode } from '@/hooks/useEditMode';

interface ActiveEdit {
  componentId: string;
  path: string;
  rect: DOMRect;
  initialValue: string;
  fontSize: number;
  fontFamily: string;
  textAnchor: string;
  fill: string;
}

const splitPath = (p: string): (string | number)[] =>
  p.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));

const InlineSvgTextEditor: React.FC = () => {
  const editMode = useEditMode((s) => s.editMode);
  const applyFieldEdit = useEditMode((s) => s.applyFieldEdit);
  const [active, setActive] = useState<ActiveEdit | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Capture-phase listener so chart components can't preventDefault our open
  useEffect(() => {
    if (!editMode) {
      setActive(null);
      return;
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const text = target.closest('[data-editable-svg-text]') as SVGTextElement | null;
      if (!text) return;
      e.stopPropagation();
      e.preventDefault();
      const componentId = text.getAttribute('data-edit-component-id') || '';
      const path = text.getAttribute('data-edit-path') || '';
      if (!componentId || !path) return;
      const rect = text.getBoundingClientRect();
      const cs = window.getComputedStyle(text);
      setActive({
        componentId,
        path,
        rect,
        initialValue: text.textContent || '',
        fontSize: parseFloat(cs.fontSize) || 12,
        fontFamily: cs.fontFamily,
        textAnchor: text.getAttribute('text-anchor') || 'middle',
        fill: cs.fill || 'currentColor',
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [editMode]);

  // Auto-close on resize/scroll (bbox would be stale)
  useEffect(() => {
    if (!active) return;
    const close = () => setActive(null);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [active]);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [active]);

  if (!active) return null;

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed !== active.initialValue) {
      const patch = setAtPath({}, splitPath(active.path), trimmed);
      applyFieldEdit(active.componentId, patch);
    }
    setActive(null);
  };

  const { rect, fontSize, fontFamily, textAnchor } = active;
  const padding = 4;
  const width = Math.max(rect.width + padding * 2, 80);
  // textAnchor middle: rect.x is left of glyph bbox already, but recenter for nicer feel
  const left = textAnchor === 'middle'
    ? rect.left + rect.width / 2 - width / 2
    : textAnchor === 'end'
      ? rect.right - width
      : rect.left - padding;
  const top = rect.top - padding;

  return (
    <div
      data-export-exclude
      style={{
        position: 'fixed',
        left: Math.max(0, left),
        top: Math.max(0, top),
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <input
        ref={inputRef}
        defaultValue={active.initialValue}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit((e.currentTarget as HTMLInputElement).value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setActive(null);
          }
        }}
        style={{
          fontSize,
          fontFamily,
          width,
          padding: `2px ${padding}px`,
          border: '1px solid rgb(96, 165, 250)',
          borderRadius: 4,
          outline: 'none',
          background: 'white',
          color: 'black',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      />
    </div>
  );
};

export default InlineSvgTextEditor;
