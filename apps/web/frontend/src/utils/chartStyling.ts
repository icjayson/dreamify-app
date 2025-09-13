/**
 * Chart Styling Utilities - Theme application and color palette management
 * Integrates with CSS presets and existing design system
 */

import { ChartStyling } from '@/types/dashboard';

// Available preset themes
export const CHART_PRESET_THEMES = {
  CORPORATE: 'corporate',
  VIBRANT: 'vibrant',
  MINIMAL: 'minimal',
  DARK: 'dark',
  COLORFUL: 'colorful'
} as const;

export type ChartPresetTheme = typeof CHART_PRESET_THEMES[keyof typeof CHART_PRESET_THEMES];

// Default color palettes for each theme
export const THEME_COLOR_PALETTES: Record<ChartPresetTheme, string[]> = {
  [CHART_PRESET_THEMES.CORPORATE]: [
    'hsl(220 14% 96%)',  // Primary
    'hsl(220 9% 46%)',   // Secondary
    'hsl(142 76% 36%)',  // Success
    'hsl(38 92% 50%)',   // Warning
    'hsl(0 84% 60%)'     // Error
  ],
  [CHART_PRESET_THEMES.VIBRANT]: [
    'hsl(261 83% 58%)',  // Primary
    'hsl(193 100% 50%)', // Secondary
    'hsl(142 76% 36%)',  // Success
    'hsl(38 92% 50%)',   // Warning
    'hsl(0 84% 60%)'     // Error
  ],
  [CHART_PRESET_THEMES.MINIMAL]: [
    'hsl(220 9% 46%)',   // Primary
    'hsl(220 9% 46%)',   // Secondary
    'hsl(220 9% 46%)',   // Success
    'hsl(220 9% 46%)',   // Warning
    'hsl(220 9% 46%)'    // Error
  ],
  [CHART_PRESET_THEMES.DARK]: [
    'hsl(261 83% 70%)',  // Primary
    'hsl(193 100% 60%)', // Secondary
    'hsl(142 76% 50%)',  // Success
    'hsl(38 92% 60%)',   // Warning
    'hsl(0 84% 70%)'     // Error
  ],
  [CHART_PRESET_THEMES.COLORFUL]: [
    'hsl(261 83% 58%)',  // Primary
    'hsl(193 100% 50%)', // Secondary
    'hsl(142 76% 36%)',  // Success
    'hsl(38 92% 50%)',   // Warning
    'hsl(0 84% 60%)'     // Error
  ]
};

// Extended color palettes for datasets with more than 5 items
export const EXTENDED_COLOR_PALETTES: Record<ChartPresetTheme, string[]> = {
  [CHART_PRESET_THEMES.CORPORATE]: [
    'hsl(220 14% 96%)',  // Primary
    'hsl(220 9% 46%)',   // Secondary
    'hsl(142 76% 36%)',  // Success
    'hsl(38 92% 50%)',   // Warning
    'hsl(0 84% 60%)',    // Error
    'hsl(280 100% 70%)', // Purple
    'hsl(200 100% 50%)', // Blue
    'hsl(320 100% 70%)', // Pink
    'hsl(40 100% 60%)',  // Orange
    'hsl(160 100% 50%)'  // Teal
  ],
  [CHART_PRESET_THEMES.VIBRANT]: [
    'hsl(261 83% 58%)',  // Primary
    'hsl(193 100% 50%)', // Secondary
    'hsl(142 76% 36%)',  // Success
    'hsl(38 92% 50%)',   // Warning
    'hsl(0 84% 60%)',    // Error
    'hsl(280 100% 70%)', // Purple
    'hsl(200 100% 50%)', // Blue
    'hsl(320 100% 70%)', // Pink
    'hsl(40 100% 60%)',  // Orange
    'hsl(160 100% 50%)'  // Teal
  ],
  [CHART_PRESET_THEMES.MINIMAL]: [
    'hsl(220 9% 46%)',   // Primary
    'hsl(220 9% 46%)',   // Secondary
    'hsl(220 9% 46%)',   // Success
    'hsl(220 9% 46%)',   // Warning
    'hsl(220 9% 46%)',   // Error
    'hsl(220 9% 46%)',   // Purple
    'hsl(220 9% 46%)',   // Blue
    'hsl(220 9% 46%)',   // Pink
    'hsl(220 9% 46%)',   // Orange
    'hsl(220 9% 46%)'    // Teal
  ],
  [CHART_PRESET_THEMES.DARK]: [
    'hsl(261 83% 70%)',  // Primary
    'hsl(193 100% 60%)', // Secondary
    'hsl(142 76% 50%)',  // Success
    'hsl(38 92% 60%)',   // Warning
    'hsl(0 84% 70%)',    // Error
    'hsl(280 100% 80%)', // Purple
    'hsl(200 100% 60%)', // Blue
    'hsl(320 100% 80%)', // Pink
    'hsl(40 100% 70%)',  // Orange
    'hsl(160 100% 60%)'  // Teal
  ],
  [CHART_PRESET_THEMES.COLORFUL]: [
    'hsl(261 83% 58%)',  // Primary
    'hsl(193 100% 50%)', // Secondary
    'hsl(142 76% 36%)',  // Success
    'hsl(38 92% 50%)',   // Warning
    'hsl(0 84% 60%)',    // Error
    'hsl(280 100% 70%)', // Purple
    'hsl(200 100% 50%)', // Blue
    'hsl(320 100% 70%)', // Pink
    'hsl(40 100% 60%)',  // Orange
    'hsl(160 100% 50%)'  // Teal
  ]
};

/**
 * Apply chart styling to a container element
 */
export function applyChartStyling(
  container: HTMLElement,
  styling: ChartStyling
): void {
  // Apply preset theme class
  const presetClass = `chart-preset-${styling.presetTheme}`;
  container.className = container.className
    .split(' ')
    .filter(cls => !cls.startsWith('chart-preset-'))
    .concat(presetClass)
    .join(' ');

  // Apply custom styling if provided
  if (styling.customStyling) {
    Object.entries(styling.customStyling).forEach(([property, value]) => {
      container.style.setProperty(property, value);
    });
  }
}

/**
 * Get color palette for a theme
 */
export function getColorPalette(
  theme: ChartPresetTheme,
  datasetCount: number = 5
): string[] {
  const basePalette = THEME_COLOR_PALETTES[theme];
  const extendedPalette = EXTENDED_COLOR_PALETTES[theme];
  
  if (datasetCount <= basePalette.length) {
    return basePalette.slice(0, datasetCount);
  }
  
  // For more datasets, use extended palette and cycle through colors
  const colors: string[] = [];
  for (let i = 0; i < datasetCount; i++) {
    colors.push(extendedPalette[i % extendedPalette.length]);
  }
  
  return colors;
}

/**
 * Assign colors to datasets based on styling configuration
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
  const classes = [`chart-preset-${styling.presetTheme}`];
  
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
  }
): ChartStyling {
  return {
    presetTheme: llmStyling.theme || CHART_PRESET_THEMES.CORPORATE,
    colorPalette: llmStyling.colorPalette || THEME_COLOR_PALETTES[CHART_PRESET_THEMES.CORPORATE],
    animationEnabled: llmStyling.animation !== 'none',
    gridVisible: llmStyling.grid !== 'hidden',
    legendPosition: (llmStyling.legend as 'top' | 'bottom' | 'right' | 'none') || 'top'
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
  
  if (!styling.colorPalette || styling.colorPalette.length === 0) {
    errors.push('Color palette is required');
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
export function getDefaultChartStyling(theme: ChartPresetTheme = CHART_PRESET_THEMES.CORPORATE): ChartStyling {
  return {
    presetTheme: theme,
    colorPalette: THEME_COLOR_PALETTES[theme],
    animationEnabled: true,
    gridVisible: true,
    legendPosition: 'top'
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
    legendPosition: customStyling.legendPosition || defaultStyling.legendPosition
  };
}
