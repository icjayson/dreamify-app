/**
 * Chart Styling Utilities - Theme application and color management
 * Color Component Prefix System with opacity cascade
 */

import { ChartStyling, DashboardConfiguration } from '@/types/dashboard';

// Available preset themes
export const CHART_PRESET_THEMES = {
  DEFAULT: 'default',
  CARBON: 'carbon',
  SLATE: 'slate',
  CHALK: 'chalk',
  WARM: 'warm',
  ASH: 'ash',
  SAGE: 'sage',
  INK: 'ink'
} as const;

export type ChartPresetTheme = typeof CHART_PRESET_THEMES[keyof typeof CHART_PRESET_THEMES];

/** Themes whose backgrounds are light-colored — require dark text/labels for contrast. */
export const LIGHT_BACKGROUND_THEMES = new Set<string>(['default', 'chalk', 'warm']);

/** True when the given theme has a light dashboard/card background. */
export function isLightBackground(theme: string | undefined): boolean {
  return LIGHT_BACKGROUND_THEMES.has(theme ?? '');
}

// Theme color set interface
export interface ThemeColorSet {
  'highlight-color': string;
  'bg-dashboard-color': string;
  'bg-card-color': string;
  'border-card-color': string;
  'title-color': string;
  'description-color': string;
  'element-color': string;
  'data-colors': string[];
}

// Chart theme color definitions
export const CHART_THEME_COLORS: Record<ChartPresetTheme, ThemeColorSet> = {
  default: {
    'highlight-color': '#1e3a5f',
    'bg-dashboard-color': '#f0f2f5',
    'bg-card-color': '#ffffff',
    'border-card-color': '#e2e8f0',
    'title-color': '#0f172a',
    'description-color': '#64748b',
    'element-color': '#64748b',
    'data-colors': ['#1e3a5f', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2']
  },
  carbon: {
    'highlight-color': '#3b82f6',
    'bg-dashboard-color': '#0d0d0d',
    'bg-card-color': '#1a1a1a',
    'border-card-color': '#2d2d2d',
    'title-color': '#e5e5e5',
    'description-color': '#a0a0a0',
    'element-color': '#6b7280',
    'data-colors': ['#3b82f6', '#60a5fa', '#93c5fd', '#34d399', '#f59e0b', '#a78bfa']
  },
  slate: {
    'highlight-color': '#60a5fa',
    'bg-dashboard-color': '#0f1923',
    'bg-card-color': '#1e2d3d',
    'border-card-color': '#2d4157',
    'title-color': '#e2e8f0',
    'description-color': '#94a3b8',
    'element-color': '#64748b',
    'data-colors': ['#60a5fa', '#38bdf8', '#34d399', '#a78bfa', '#fb923c', '#fbbf24']
  },
  chalk: {
    'highlight-color': '#1e40af',
    'bg-dashboard-color': '#ffffff',
    'bg-card-color': '#f8f9fa',
    'border-card-color': '#e2e8f0',
    'title-color': '#1a1a2e',
    'description-color': '#475569',
    'element-color': '#64748b',
    'data-colors': ['#1e40af', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2']
  },
  warm: {
    'highlight-color': '#b45309',
    'bg-dashboard-color': '#fafaf8',
    'bg-card-color': '#f5f0eb',
    'border-card-color': '#d4c5b0',
    'title-color': '#1c1005',
    'description-color': '#6b5344',
    'element-color': '#5c4033',
    'data-colors': ['#b45309', '#0d9488', '#7c3aed', '#1d4ed8', '#dc2626', '#047857']
  },
  ash: {
    'highlight-color': '#f0f0f0',
    'bg-dashboard-color': '#2d2d2d',
    'bg-card-color': '#3d3d3d',
    'border-card-color': '#505050',
    'title-color': '#f0f0f0',
    'description-color': '#a0a0a0',
    'element-color': '#707070',
    'data-colors': ['#f0f0f0', '#b0c4de', '#c4b5a0', '#f5c842', '#cc8844', '#8b8b8b']
  },
  sage: {
    'highlight-color': '#6ee7b7',
    'bg-dashboard-color': '#0d1a14',
    'bg-card-color': '#1a2e22',
    'border-card-color': '#243d2e',
    'title-color': '#d1fae5',
    'description-color': '#6ee7b7',
    'element-color': '#4ade80',
    'data-colors': ['#6ee7b7', '#34d399', '#10b981', '#60a5fa', '#a78bfa', '#fbbf24']
  },
  ink: {
    'highlight-color': '#f59e0b',
    'bg-dashboard-color': '#12100e',
    'bg-card-color': '#1c1915',
    'border-card-color': '#2e2a26',
    'title-color': '#fdf4e7',
    'description-color': '#d6b896',
    'element-color': '#8b7355',
    'data-colors': ['#f59e0b', '#fbbf24', '#f97316', '#ef4444', '#a78bfa', '#60a5fa']
  }
};

// ─── Chart Style Variants ────────────────────────────────────────────────────

export const CHART_STYLE_VARIANTS = {
  ROUNDED: 'rounded',
  SHARP: 'sharp',
  MINIMAL: 'minimal'
} as const;

export type ChartStyleVariant = typeof CHART_STYLE_VARIANTS[keyof typeof CHART_STYLE_VARIANTS];

export interface StyleVariantProps {
  containerBorderRadius: number;
  containerBoxShadow: string;
  containerHasBorder: boolean;
  containerHasBackground: boolean;
  barBorderRadius: [number, number, number, number];
  lineStrokeWidth: number;
  lineType: 'monotone' | 'linear';
  lineDot: boolean;
  gridOpacity: number;
  cardBorderRadius: number;
  cardBoxShadow: string;
}

export const CHART_STYLE_CONFIGS: Record<ChartStyleVariant, StyleVariantProps> = {
  rounded: {
    containerBorderRadius: 8,
    containerBoxShadow: '0 1px 3px rgba(15,23,42,0.08)',
    containerHasBorder: false,
    containerHasBackground: true,
    barBorderRadius: [6, 6, 0, 0],
    lineStrokeWidth: 2.5,
    lineType: 'monotone',
    lineDot: true,
    gridOpacity: 0.3,
    cardBorderRadius: 8,
    cardBoxShadow: '0 1px 3px rgba(15,23,42,0.08)'
  },
  sharp: {
    containerBorderRadius: 0,
    containerBoxShadow: 'none',
    containerHasBorder: true,
    containerHasBackground: false,
    barBorderRadius: [0, 0, 0, 0],
    lineStrokeWidth: 1.5,
    lineType: 'linear',
    lineDot: false,
    gridOpacity: 0.4,
    cardBorderRadius: 2,
    cardBoxShadow: 'none'
  },
  minimal: {
    containerBorderRadius: 0,
    containerBoxShadow: 'none',
    containerHasBorder: false,
    containerHasBackground: false,
    barBorderRadius: [3, 3, 0, 0],
    lineStrokeWidth: 1.5,
    lineType: 'monotone',
    lineDot: false,
    gridOpacity: 0.1,
    cardBorderRadius: 0,
    cardBoxShadow: 'none'
  }
};

export function getStyleVariantProps(chartStyle?: ChartStyleVariant): StyleVariantProps {
  return CHART_STYLE_CONFIGS[chartStyle || 'rounded'];
}

/**
 * Convert hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Generate opacity cascade from a base color
 * @param baseColor - Hex color string (e.g., "#3b82f6")
 * @param count - Number of colors to generate
 * @param minOpacity - Minimum opacity (default 0.3 for 30%)
 * @returns Array of rgba color strings with decreasing opacity
 */
export function generateOpacityCascade(
  baseColor: string,
  count: number,
  minOpacity: number = 0.3
): string[] {
  const rgb = hexToRgb(baseColor);
  if (!rgb) {
    return Array(count).fill('rgba(59, 130, 246, 1)');
  }

  const colors: string[] = [];
  const step = (1 - minOpacity) / (count - 1 || 1);

  for (let i = 0; i < count; i++) {
    const opacity = Math.max(minOpacity, 1 - (i * step));
    colors.push(`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity.toFixed(2)})`);
  }

  return colors;
}

/**
 * Resolve color token to CSS variable reference
 * @param token - Color token (e.g., "title-color", "element-color/75")
 * @returns CSS variable reference
 */
export function resolveColorToken(token: string): string {
  if (!token) return 'var(--title-color)';

  // Handle opacity syntax: "element-color/75"
  if (token.includes('/')) {
    const [colorVar, opacityStr] = token.split('/');
    const opacity = parseInt(opacityStr) / 100;
    return `rgba(var(--${colorVar}-rgb), ${opacity})`;
  }

  return `var(--${token})`;
}

/**
 * Get dashboard background style object
 */
export function getDashboardBackgroundStyle(styling: ChartStyling): React.CSSProperties {
  const theme = styling.presetTheme as ChartPresetTheme;
  const bgColor = CHART_THEME_COLORS[theme]?.['bg-dashboard-color'] || CHART_THEME_COLORS[CHART_PRESET_THEMES.DEFAULT]['bg-dashboard-color'];

  return {
    backgroundColor: styling.dashboardBackground || bgColor,
    border: 'none',
    borderRadius: 'inherit'
  };
}

/**
 * Apply chart styling to a container element
 */
export function applyChartStyling(
  container: HTMLElement,
  styling: ChartStyling
): void {
  // Apply theme class
  const themeClass = `chart-theme-${styling.presetTheme}`;
  container.className = container.className
    .split(' ')
    .filter(cls => !cls.startsWith('chart-theme-') && !cls.startsWith('chart-preset-'))
    .concat(themeClass)
    .join(' ');

  // Apply dashboard background
  const theme = styling.presetTheme as ChartPresetTheme;
  const bgColor = CHART_THEME_COLORS[theme]?.['bg-dashboard-color'];
  if (bgColor) {
    container.style.backgroundColor = styling.dashboardBackground || bgColor;
    container.style.border = 'none';
    container.style.borderRadius = 'inherit';
  }

  // Apply custom styling if provided
  if (styling.customStyling) {
    Object.entries(styling.customStyling).forEach(([property, value]) => {
      container.style.setProperty(property, value);
    });
  }
}

/**
 * Get color palette for a theme using data-colors
 */
export function getColorPalette(
  theme: ChartPresetTheme,
  datasetCount: number = 5
): string[] {
  const themeColors = CHART_THEME_COLORS[theme];
  if (!themeColors) {
    return generateOpacityCascade(CHART_THEME_COLORS[CHART_PRESET_THEMES.DEFAULT]['highlight-color'], datasetCount);
  }
  const palette = themeColors['data-colors'];
  return Array.from({ length: datasetCount }, (_, i) => palette[i % palette.length]);
}

/**
 * Assign colors to datasets based on styling configuration using opacity cascade
 */
export function assignDatasetColors(
  datasets: Array<{ label: string; data: any[]; color?: string }>,
  styling: ChartStyling
): Array<{ label: string; data: any[]; color: string }> {
  const colorPalette = getColorPalette(
    styling.presetTheme as ChartPresetTheme,
    datasets.length
  );

  return datasets.map((dataset, index) => ({
    ...dataset,
    color: dataset.color || colorPalette[index] || colorPalette[0]
  }));
}

/**
 * Get CSS class names for chart styling
 */
export function getChartStylingClasses(styling: ChartStyling): string {
  const classes = [`chart-theme-${styling.presetTheme}`];

  if (styling.animationEnabled) {
    classes.push('chart-animate-fade-in');
  }

  return classes.join(' ');
}

/**
 * Convert LLM styling recommendations to ChartStyling object
 */
export function convertLLMStylingToChartStyling(
  llmStyling: {
    theme?: string;
    colorPalette?: string[];
    animation?: string;
    grid?: string;
    legend?: string;
    dashboardBackground?: string;
  }
): ChartStyling {
  const themeMap: Record<string, ChartPresetTheme> = {
    // old names → new equivalents
    'ocean': CHART_PRESET_THEMES.SLATE,
    'forest': CHART_PRESET_THEMES.SAGE,
    'sunset': CHART_PRESET_THEMES.INK,
    'midnight': CHART_PRESET_THEMES.CARBON,
    'sakura': CHART_PRESET_THEMES.WARM,
    'monochrome': CHART_PRESET_THEMES.DEFAULT,
    'default': CHART_PRESET_THEMES.DEFAULT,
    'light': CHART_PRESET_THEMES.CHALK,
    // new names map to themselves
    'carbon': CHART_PRESET_THEMES.CARBON,
    'slate': CHART_PRESET_THEMES.SLATE,
    'chalk': CHART_PRESET_THEMES.CHALK,
    'warm': CHART_PRESET_THEMES.WARM,
    'ash': CHART_PRESET_THEMES.ASH,
    'sage': CHART_PRESET_THEMES.SAGE,
    'ink': CHART_PRESET_THEMES.INK,
    // legacy
    'corporate': CHART_PRESET_THEMES.CHALK,
    'vibrant': CHART_PRESET_THEMES.SLATE,
    'minimal': CHART_PRESET_THEMES.ASH,
    'dark': CHART_PRESET_THEMES.CARBON,
    'colorful': CHART_PRESET_THEMES.SLATE,
  };

  const theme = themeMap[llmStyling.theme?.toLowerCase() || ''] || CHART_PRESET_THEMES.DEFAULT;
  const themeColors = CHART_THEME_COLORS[theme];

  return {
    presetTheme: theme,
    colorPalette: getColorPalette(theme, 10),
    animationEnabled: llmStyling.animation !== 'none',
    gridVisible: llmStyling.grid !== 'hidden',
    legendPosition: (llmStyling.legend as 'top' | 'bottom' | 'right' | 'none') || 'top',
    dashboardBackground: llmStyling.dashboardBackground || themeColors['bg-dashboard-color']
  };
}

/**
 * Validate chart styling configuration
 */
export function validateChartStyling(styling: ChartStyling): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!styling.presetTheme) {
    errors.push('Preset theme is required');
  }

  if (!Object.values(CHART_PRESET_THEMES).includes(styling.presetTheme as ChartPresetTheme)) {
    errors.push(`Invalid preset theme: ${styling.presetTheme}`);
  }

  if (styling.legendPosition && !['top', 'bottom', 'right', 'none'].includes(styling.legendPosition)) {
    errors.push(`Invalid legend position: ${styling.legendPosition}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Get default chart styling for a theme
 */
export function getDefaultChartStyling(theme: ChartPresetTheme = CHART_PRESET_THEMES.DEFAULT): ChartStyling {
  const themeColors = CHART_THEME_COLORS[theme];

  return {
    presetTheme: theme,
    colorPalette: getColorPalette(theme, 10),
    animationEnabled: true,
    gridVisible: true,
    legendPosition: 'top',
    dashboardBackground: themeColors['bg-dashboard-color']
  };
}

/**
 * Merge chart styling with defaults
 */
export function mergeChartStyling(
  customStyling: Partial<ChartStyling>,
  defaultStyling: ChartStyling = getDefaultChartStyling()
): ChartStyling {
  return {
    presetTheme: customStyling.presetTheme || defaultStyling.presetTheme,
    colorPalette: customStyling.colorPalette || defaultStyling.colorPalette,
    customStyling: customStyling.customStyling || defaultStyling.customStyling,
    animationEnabled: customStyling.animationEnabled ?? defaultStyling.animationEnabled,
    gridVisible: customStyling.gridVisible ?? defaultStyling.gridVisible,
    legendPosition: customStyling.legendPosition || defaultStyling.legendPosition,
    dashboardBackground: customStyling.dashboardBackground || defaultStyling.dashboardBackground
  };
}

// ─── Visual Spec ─────────────────────────────────────────────────────────────

export interface VisualSpec {
  theme: ChartPresetTheme;
  chartStyle: ChartStyleVariant;
  density: 'compact' | 'comfortable' | 'spacious';
}

export function applyVisualSpec(
  config: DashboardConfiguration,
  visual: VisualSpec
): DashboardConfiguration {
  const updated = JSON.parse(JSON.stringify(config)) as DashboardConfiguration;
  const themeColors = CHART_THEME_COLORS[visual.theme];

  for (const component of updated.components) {
    // component_config is a union without a shared styling field; any cast is required to write it dynamically
    const cfg = component.component_config as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (cfg) {
      if (!cfg.styling) cfg.styling = {};
      cfg.styling.presetTheme = visual.theme;
      cfg.styling.chartStyle = visual.chartStyle;
      cfg.styling.theme = visual.theme;
      if (themeColors) {
        cfg.styling.colorPalette = getColorPalette(visual.theme, 6);
        cfg.styling.dashboardBackground = themeColors['bg-dashboard-color'];
      }
    }
  }

  return updated;
}
