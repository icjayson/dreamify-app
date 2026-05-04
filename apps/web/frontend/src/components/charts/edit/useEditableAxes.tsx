/**
 * useEditableAxes — returns Recharts XAxis/YAxis label props that emit
 * editable SVG text when the surrounding chart is in edit mode.
 *
 * Each chart wrapper imports this and spreads the result onto its axes.
 */
import { useMemo } from 'react';
import { useEditContext } from './EditContext';
import { makeAxisLabel } from './EditableSvgText';

interface AxisLabels {
  x?: string;
  y?: string;
}

export function useEditableAxes(labels: AxisLabels) {
  const ctx = useEditContext();
  return useMemo(() => {
    if (!ctx?.editMode) {
      return {
        xAxisProps: labels.x ? { label: { value: labels.x, position: 'insideBottom', offset: -8, fill: 'var(--element-color)' } } : {},
        yAxisProps: labels.y ? { label: { value: labels.y, angle: -90, position: 'insideLeft', fill: 'var(--element-color)' } } : {},
      };
    }
    return {
      xAxisProps: {
        label: makeAxisLabel({
          componentId: ctx.componentId,
          path: 'axisConfig.x_axis.label',
          staticText: labels.x || 'Add X label',
        }),
      },
      yAxisProps: {
        label: makeAxisLabel({
          componentId: ctx.componentId,
          path: 'axisConfig.y_axis.label',
          staticText: labels.y || 'Add Y label',
        }),
      },
    };
  }, [ctx?.editMode, ctx?.componentId, labels.x, labels.y]);
}
