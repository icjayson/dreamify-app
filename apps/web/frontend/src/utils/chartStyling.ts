/**
 * Chart Styling Utilities - Theme application and color management
 * Color Component Prefix System with opacity cascade
 */

import { ChartStyling } from '@/types/dashboard';

// Available preset themes
export const CHART_PRESET_THEMES = {
  OCEAN: 'ocean',
  FOREST: 'forest',
  SUNSET: 'sunset',
  MIDNIGHT: 'midnight',
  SAKURA: 'sakura',
  MONOCHROME: 'monochrome'
} as const;

export type ChartPresetTheme = typeof CHART_PRESET_THEMES[keyof typeof CHART_PRESET_THEMES];

// Theme color set interface
export interface ThemeColorSet {
  'highlight-color': string;
  'bg-dashboard-color': string;
  'bg-card-color': string;
  'border-card-color': string;
  'title-color': string;
  'description-color': string;
  'element-color': string;
}

// Chart theme color definitions (matching CSS)
export const CHART_THEME_COLORS: Record<ChartPresetTheme, ThemeColorSet> = {
  [CHART_PRESET_THEMES.OCEAN]: {
    'highlight-color': '#3b82f6',
    'bg-dashboard-color': '#0f172a',
    'bg-card-color': '#a5a5a5',
    'border-card-color': '#ffffff',
    'title-color': '#000000',
    'description-color': '#4e4e4e',
    'element-color': '#2b2e32'
  },
  [CHART_PRESET_THEMES.FOREST]: {
    'highlight-color': '#10b981',
    'bg-dashboard-color': '#064e3b',
    'bg-card-color': '#065f46',
    'border-card-color': '#047857',
    'title-color': '#f0fdf4',
    'description-color': '#d1fae5',
    'element-color': '#6ee7b7'
  },
  [CHART_PRESET_THEMES.SUNSET]: {
    'highlight-color': '#f59e0b',
    'bg-dashboard-color': '#431407',
    'bg-card-color': '#7c2d12',
    'border-card-color': '#9a3412',
    'title-color': '#fffbeb',
    'description-color': '#fef3c7',
    'element-color': '#fbbf24'
  },
  [CHART_PRESET_THEMES.MIDNIGHT]: {
    'highlight-color': '#8b5cf6',
    'bg-dashboard-color': '#0c0a09',
    'bg-card-color': '#1c1917',
    'border-card-color': '#292524',
    'title-color': '#fafaf9',
    'description-color': '#d6d3d1',
    'element-color': '#78716c'
  },
  [CHART_PRESET_THEMES.SAKURA]: {
    'highlight-color': '#ec4899',
    'bg-dashboard-color': '#4a044e',
    'bg-card-color': '#701a75',
    'border-card-color': '#86198f',
    'title-color': '#fdf4ff',
    'description-color': '#f5d0fe',
    'element-color': '#e879f9'
  },
  [CHART_PRESET_THEMES.MONOCHROME]: {
    'highlight-color': '#ffffff',
    'bg-dashboard-color': '#1a1a1a',
    'bg-card-color': '#2a2a2a',
    'border-card-color': '#404040',
    'title-color': '#ffffff',
    'description-color': '#a0a0a0',
    'element-color': '#6b7280'
  }
};

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
 * Get monochrome color palette from CSS variables
 * Reads CSS variables from the document root or a specific element
 * Falls back to minimal inline values if CSS variables are not available
 * @param element - Optional element to read CSS variables from (defaults to document.documentElement)
 * @returns Array of 10 color strings
 */
function getMonochromePaletteFromCSS(element?: HTMLElement): string[] {
  const targetElement = element || document.documentElement;
  const computedStyle = window.getComputedStyle(targetElement);
  
  const colors: string[] = [];
  for (let i = 0; i < 10; i++) {
    const cssVar = `--monochrome-color-${i}`;
    const color = computedStyle.getPropertyValue(cssVar).trim();
    
    if (color) {
      colors.push(color);
    } else {
      // CSS variable not found - this should not happen in normal operation
      // Return minimal inline fallback for critical error handling
      console.error(`CSS variable ${cssVar} not found. Using minimal fallback.`);
      return [
        "#ffffff", "#38BDF8", "#FBBF24", "#2DD4BF", "#F472B6",
        "#A78BFA", "#94A3B8", "#E2E8F0", "#FB923C", "#4ADE80"
      ];
    }
  }
  
  return colors;
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
    console.warn(`Invalid color: ${baseColor}, using fallback`);
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
  const bgColor = CHART_THEME_COLORS[theme]?.['bg-dashboard-color'] || CHART_THEME_COLORS[CHART_PRESET_THEMES.MONOCHROME]['bg-dashboard-color'];
  
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
 * Get color palette for a theme using opacity cascade
 */
export function getColorPalette(
  theme: ChartPresetTheme,
  datasetCount: number = 5
): string[] {
  // Special handling for MONOCHROME theme: use solid colors instead of opacity cascade
  if (theme === CHART_PRESET_THEMES.MONOCHROME) {
    // Try to read from CSS variables first, fallback to minimal inline array
    let palette: string[];
    try {
      // Check if we're in a browser environment
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        palette = getMonochromePaletteFromCSS();
      } else {
        // Client-side only app - this should never happen
        // Minimal inline fallback for edge cases
        console.warn('Browser environment not available. Using minimal fallback.');
        palette = [
          "#ffffff", "#38BDF8", "#FBBF24", "#2DD4BF", "#F472B6",
          "#A78BFA", "#94A3B8", "#E2E8F0", "#FB923C", "#4ADE80"
        ];
      }
    } catch (error) {
      // Critical error fallback - minimal inline array
      console.error('Failed to read monochrome palette from CSS variables, using minimal fallback:', error);
      palette = [
        "#ffffff", "#38BDF8", "#FBBF24", "#2DD4BF", "#F472B6",
        "#A78BFA", "#94A3B8", "#E2E8F0", "#FB923C", "#4ADE80"
      ];
    }
    
    return Array.from({ length: datasetCount }, (_, i) => 
      palette[i % palette.length]
    );
  }
  
  const themeColors = CHART_THEME_COLORS[theme];
  if (!themeColors) {
    return generateOpacityCascade(CHART_THEME_COLORS[CHART_PRESET_THEMES.MONOCHROME]['highlight-color'], datasetCount);
  }
  
  return generateOpacityCascade(themeColors['highlight-color'], datasetCount);
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
  // Map old theme names to new ones for backward compatibility
  // Note: 'ocean' is mapped to MONOCHROME to migrate existing dashboards to the monochrome default
  const themeMap: Record<string, ChartPresetTheme> = {
    'corporate': CHART_PRESET_THEMES.MONOCHROME,
    'vibrant': CHART_PRESET_THEMES.SAKURA,
    'minimal': CHART_PRESET_THEMES.MIDNIGHT,
    'dark': CHART_PRESET_THEMES.MIDNIGHT,
    'colorful': CHART_PRESET_THEMES.FOREST,
    'ocean': CHART_PRESET_THEMES.MONOCHROME,
    'forest': CHART_PRESET_THEMES.FOREST,
    'sunset': CHART_PRESET_THEMES.SUNSET,
    'midnight': CHART_PRESET_THEMES.MIDNIGHT,
    'sakura': CHART_PRESET_THEMES.SAKURA,
    'monochrome': CHART_PRESET_THEMES.MONOCHROME
  };
  
  const theme = themeMap[llmStyling.theme?.toLowerCase() || ''] || CHART_PRESET_THEMES.MONOCHROME;
  const themeColors = CHART_THEME_COLORS[theme];
  
  // Special handling for MONOCHROME theme: use solid colors instead of opacity cascade
  const colorPalette = theme === CHART_PRESET_THEMES.MONOCHROME
    ? getColorPalette(CHART_PRESET_THEMES.MONOCHROME, 10)
    : generateOpacityCascade(themeColors['highlight-color'], 10);
  
  return {
    presetTheme: theme,
    colorPalette: colorPalette,
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
export function getDefaultChartStyling(theme: ChartPresetTheme = CHART_PRESET_THEMES.MONOCHROME): ChartStyling {
  const themeColors = CHART_THEME_COLORS[theme];
  
  // Special handling for MONOCHROME theme: use solid colors instead of opacity cascade
  const colorPalette = theme === CHART_PRESET_THEMES.MONOCHROME
    ? getColorPalette(CHART_PRESET_THEMES.MONOCHROME, 10)
    : generateOpacityCascade(themeColors['highlight-color'], 10);
  
  return {
    presetTheme: theme,
    colorPalette: colorPalette,
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
