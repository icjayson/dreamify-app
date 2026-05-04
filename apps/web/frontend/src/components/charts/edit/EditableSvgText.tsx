/**
 * EditableSvgText — Recharts custom tick/label renderer that emits an
 * SVG <text> element tagged with metadata so the dashboard-level
 * InlineSvgTextEditor can locate and edit it.
 *
 * Recharts calls these renderers with positional props that vary across
 * chart types (XAxis tick, Bar label, Pie label, etc). Two factories below
 * cover the common cases.
 */
import React from 'react';

interface CommonProps {
  x?: number;
  y?: number;
  payload?: { value: any };
  textAnchor?: string;
  fill?: string;
  className?: string;
  width?: number;
  height?: number;
  dy?: number;
}

interface FactoryArgs {
  componentId: string;
  /** Dot-path inside component_config that this text element edits. */
  path: string;
  /** Static fallback text used when the rendered value can't be inferred from props (e.g. axis title labels). */
  staticText?: string;
}

/**
 * Returns a render function suitable for Recharts <XAxis tick={...}> /
 * <YAxis tick={...}>. Emits a clickable SVG <text> with edit metadata.
 *
 * Note: editing axis-tick values would mutate the data. Tick text is bound
 * to `axisConfig.<axis>.label` instead — clicking opens the axis-label
 * editor (single shared label, not per-tick).
 */
export const makeAxisTitleTick = ({ componentId, path }: FactoryArgs) => {
  const Comp: React.FC<CommonProps> = (props) => {
    const { x = 0, y = 0, payload, textAnchor = 'middle', fill } = props;
    return (
      <text
        x={x}
        y={y}
        dy={16}
        textAnchor={textAnchor}
        fill={fill || 'var(--element-color)'}
        data-editable-svg-text="1"
        data-edit-component-id={componentId}
        data-edit-path={path}
        style={{ cursor: 'pointer' }}
      >
        {payload?.value ?? ''}
      </text>
    );
  };
  Comp.displayName = 'EditableAxisTick';
  return Comp;
};

/**
 * Returns a static label renderer for axis titles. Recharts <XAxis label> /
 * <YAxis label> accept either a string or a render function.
 */
export const makeAxisLabel = ({ componentId, path, staticText }: FactoryArgs) => {
  const Comp: React.FC<any> = (props) => {
    const { viewBox } = props;
    if (!viewBox) return null;
    const isY = viewBox.height > viewBox.width;
    const cx = viewBox.x + (viewBox.width || 0) / 2;
    const cy = viewBox.y + (viewBox.height || 0) / 2;
    const transform = isY ? `rotate(-90 ${viewBox.x + 12} ${cy})` : undefined;
    const x = isY ? viewBox.x + 12 : cx;
    const y = isY ? cy : viewBox.y + (viewBox.height || 0) - 4;
    return (
      <text
        x={x}
        y={y}
        textAnchor="middle"
        fill="var(--element-color)"
        transform={transform}
        data-editable-svg-text="1"
        data-edit-component-id={componentId}
        data-edit-path={path}
        style={{ cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
      >
        {staticText || 'Add label'}
      </text>
    );
  };
  Comp.displayName = 'EditableAxisLabel';
  return Comp;
};
