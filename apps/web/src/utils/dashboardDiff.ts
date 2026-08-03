/**
 * Compares two dashboard configurations and returns IDs of components that changed.
 * Used for highlighting updated components after an edit via chat.
 */
export function diffDashboardComponents(
  oldData: any,
  newData: any
): Set<string> {
  const changedIds = new Set<string>();
  if (!oldData || !newData) return changedIds;

  const oldComponents = extractComponents(oldData);
  const newComponents = extractComponents(newData);

  const oldMap = new Map(oldComponents.map(c => [c.id || c.title, c]));
  const newMap = new Map(newComponents.map(c => [c.id || c.title, c]));

  // Find added or modified components
  for (const [key, newComp] of newMap) {
    const oldComp = oldMap.get(key);
    if (!oldComp) {
      // New component added
      changedIds.add(key);
    } else if (!shallowEqual(oldComp, newComp)) {
      // Component modified
      changedIds.add(key);
    }
  }

  // Find removed components (mark remaining old ones)
  for (const [key] of oldMap) {
    if (!newMap.has(key)) {
      changedIds.add(key);
    }
  }

  return changedIds;
}

/**
 * Extracts a flat list of component descriptors from raw Morpheus dashboard data.
 */
function extractComponents(data: any): Array<{ id: string; title: string; type: string; dataHash: string }> {
  const components: Array<{ id: string; title: string; type: string; dataHash: string }> = [];

  if (Array.isArray(data.metrics)) {
    data.metrics.forEach((m: any, idx: number) => {
      components.push({
        id: m.id || `metric_${idx + 1}`,
        title: m.title || m.name || '',
        type: 'metric',
        dataHash: simpleHash(JSON.stringify({ value: m.value, change: m.change, trend: m.trend })),
      });
    });
  }

  if (Array.isArray(data.charts)) {
    data.charts.forEach((c: any, idx: number) => {
      components.push({
        id: c.id || `chart_${idx + 1}`,
        title: c.title || '',
        type: c.chart_type || 'chart',
        dataHash: simpleHash(JSON.stringify({ datasets: c.datasets, data: c.data, config: c.config })),
      });
    });
  }

  if (Array.isArray(data.tables)) {
    data.tables.forEach((t: any, idx: number) => {
      components.push({
        id: t.id || `table_${idx + 1}`,
        title: t.title || '',
        type: 'table',
        dataHash: simpleHash(JSON.stringify({ columns: t.columns, data: t.data, rows: t.rows })),
      });
    });
  }

  return components;
}

function shallowEqual(a: any, b: any): boolean {
  return a.type === b.type && a.title === b.title && a.dataHash === b.dataHash;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}
