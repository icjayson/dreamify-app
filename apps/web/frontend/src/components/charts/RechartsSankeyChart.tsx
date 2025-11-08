/**
 * Recharts Sankey Chart Component - Responsive sankey with theme integration
 */

import React from 'react';
import { Sankey, Tooltip, ResponsiveContainer } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

// Rename to avoid clashing with recharts' internal SankeyData type
interface SankeyGraph {
  nodes: Array<{ name: string; [k: string]: any }>;
  links: Array<{ source: number | string; target: number | string; value: number }>;
}

interface RechartsSankeyChartProps {
  title?: string;
  description?: string;
  datasets?: Array<{
    label: string;
    data: Array<{
      label: string;
      value: number | string;
      metadata?: Record<string, any>;
    }>;
    color?: string;
    metadata?: Record<string, any>;
  }>;
  config?: { data?: SankeyGraph } & Record<string, any>;
  layout?: Record<string, any>;
  styling?: {
    presetTheme: string;
    colorPalette: string[];
    customStyling?: Record<string, any>;
    animationEnabled: boolean;
    gridVisible: boolean;
    legendPosition: 'top' | 'bottom' | 'right' | 'none';
  };
  className?: string;
  style?: React.CSSProperties;
}

const RechartsSankeyChart: React.FC<RechartsSankeyChartProps> = ({
  title = "Sankey",
  description,
  datasets = [],
  config = {},
  layout = {},
  styling,
  className = "",
  style = {}
}) => {
  const { getStylingClasses } = useChartTheme({ initialStyling: styling });

  const palette = React.useMemo(() => {
    return styling?.colorPalette || ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  }, [styling?.colorPalette]);

  // Normalize config.data: allow string references for source/target
  const sankeyData = React.useMemo(() => {
    const data: SankeyGraph | undefined = (config as any)?.data;
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
      return { nodes: [], links: [] } as SankeyGraph;
    }
    const nameToIndex = new Map<string, number>();
    data.nodes.forEach((n, idx) => nameToIndex.set(n.name, idx));
    const normalizedLinks = data.links.map(l => ({
      source: typeof l.source === 'string' ? (nameToIndex.get(l.source) ?? l.source) : l.source,
      target: typeof l.target === 'string' ? (nameToIndex.get(l.target) ?? l.target) : l.target,
      value: l.value
    }));
    return { nodes: data.nodes, links: normalizedLinks } as SankeyGraph;
  }, [config]);

  const stylingClasses = getStylingClasses();

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload || {};
      return (
        <div className="chart-tooltip">
          {'source' in d && 'target' in d ? (
            <>
              <p className="font-medium">Link</p>
              <p>Value: {d.value}</p>
            </>
          ) : (
            <>
              <p className="font-medium">{d.name}</p>
            </>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`chart-container ${stylingClasses} ${className}`} style={{ height: '85%', ...style }}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--title-color)' }}>{title}</h3>
        {description && (
          <p className="text-sm" style={{ color: 'var(--description-color)' }}>{description}</p>
        )}
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          // Cast to any to satisfy Recharts' internal Sankey type without conflicts
          data={sankeyData as any}
          nodePadding={16}
          nodeWidth={12}
          margin={{ left: 20, right: 20, top: 20, bottom: 20 }}
          linkCurvature={0.5}
          iterations={32}
          node={{
            // color accessor via palette based on node index
            stroke: '#fff',
            fill: (n: any) => palette[(n?.index || 0) % palette.length]
          } as any}
          link={{
            stroke: (l: any) => palette[((l?.source?.index ?? 0) as number) % palette.length],
            strokeOpacity: 0.4
          } as any}
        >
          <Tooltip content={<CustomTooltip />} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
};

export default RechartsSankeyChart;


