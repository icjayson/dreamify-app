/**
 * Chart configuration helpers
 */

import { ChartType } from '@/types/dashboard';

export class ChartConfigHelpers {
  /**
   * Get default configuration for chart type
   */
  static getDefaultConfig(type: ChartType): Record<string, any> {
    const configs = {
      [ChartType.LINE]: {
        animation: true,
        showGrid: true,
        showLegend: true,
        showTooltip: true,
        responsive: true,
        maintainAspectRatio: false
      },
      [ChartType.BAR]: {
        animation: true,
        showLegend: true,
        showTooltip: true,
        responsive: true,
        maintainAspectRatio: false
      },
      [ChartType.PIE]: {
        animation: true,
        showLegend: true,
        showTooltip: true,
        responsive: true,
        maintainAspectRatio: true
      },
      [ChartType.AREA]: {
        animation: true,
        showGrid: true,
        showLegend: true,
        showTooltip: true,
        responsive: true,
        maintainAspectRatio: false
      },
      [ChartType.SCATTER]: {
        animation: true,
        showGrid: true,
        showLegend: true,
        showTooltip: true,
        responsive: true,
        maintainAspectRatio: false
      },
      [ChartType.DONUT]: {
        animation: true,
        showLegend: true,
        showTooltip: true,
        responsive: true,
        maintainAspectRatio: true
      },
      [ChartType.METRIC]: {
        animation: true,
        showTrend: true,
        responsive: true
      },
      [ChartType.TABLE]: {
        showHeader: true,
        showPagination: false,
        responsive: true,
        sortable: true
      },
      [ChartType.GEOGRAPHIC]: {
        animation: true,
        showProgressBars: true,
        showPieChart: true,
        responsive: true
      },
      [ChartType.ACTIVITY_FEED]: {
        animation: true,
        showTimestamps: true,
        responsive: true
      }
    };

    return configs[type] || {};
  }

  /**
   * Get color scheme for chart type
   */
  static getColorScheme(type: ChartType): string[] {
    const schemes = {
      [ChartType.LINE]: [
        'hsl(var(--primary))',
        'hsl(var(--secondary))',
        'hsl(var(--accent))',
        'hsl(var(--muted-foreground))'
      ],
      [ChartType.BAR]: [
        'hsl(var(--primary))',
        'hsl(var(--secondary))',
        'hsl(var(--accent))',
        'hsl(var(--muted-foreground))'
      ],
      [ChartType.PIE]: [
        'hsl(var(--primary))',
        'hsl(var(--secondary))',
        'hsl(var(--accent))',
        'hsl(var(--muted-foreground))',
        'hsl(var(--destructive))',
        'hsl(var(--success))'
      ],
      [ChartType.AREA]: [
        'hsl(var(--primary))',
        'hsl(var(--secondary))',
        'hsl(var(--accent))',
        'hsl(var(--muted-foreground))'
      ],
      [ChartType.SCATTER]: [
        'hsl(var(--primary))',
        'hsl(var(--secondary))',
        'hsl(var(--accent))',
        'hsl(var(--muted-foreground))'
      ],
      [ChartType.DONUT]: [
        'hsl(var(--primary))',
        'hsl(var(--secondary))',
        'hsl(var(--accent))',
        'hsl(var(--muted-foreground))',
        'hsl(var(--destructive))',
        'hsl(var(--success))'
      ],
      [ChartType.METRIC]: [
        'hsl(var(--primary))',
        'hsl(var(--success))',
        'hsl(var(--destructive))',
        'hsl(var(--muted-foreground))'
      ],
      [ChartType.TABLE]: [
        'hsl(var(--primary))',
        'hsl(var(--muted-foreground))'
      ],
      [ChartType.GEOGRAPHIC]: [
        'hsl(var(--primary))',
        'hsl(var(--secondary))',
        'hsl(var(--accent))',
        'hsl(var(--muted-foreground))'
      ],
      [ChartType.ACTIVITY_FEED]: [
        'hsl(var(--primary))',
        'hsl(var(--success))',
        'hsl(var(--destructive))',
        'hsl(var(--accent))'
      ]
    };

    return schemes[type] || ['hsl(var(--primary))'];
  }

  /**
   * Calculate responsive sizing
   */
  static calculateResponsiveSizing(
    containerWidth: number,
    containerHeight: number,
    aspectRatio?: number
  ): { width: number; height: number } {
    const minWidth = 200;
    const minHeight = 150;
    const maxWidth = containerWidth;
    const maxHeight = containerHeight;

    let width = Math.max(minWidth, Math.min(maxWidth, containerWidth));
    let height = Math.max(minHeight, Math.min(maxHeight, containerHeight));

    if (aspectRatio) {
      if (width / height > aspectRatio) {
        width = height * aspectRatio;
      } else {
        height = width / aspectRatio;
      }
    }

    return { width, height };
  }

  /**
   * Get animation configuration
   */
  static getAnimationConfig(type: ChartType): {
    enabled: boolean;
    duration: number;
    easing: string;
    delay?: number;
  } {
    const animations = {
      [ChartType.LINE]: {
        enabled: true,
        duration: 1000,
        easing: 'ease-out',
        delay: 0
      },
      [ChartType.BAR]: {
        enabled: true,
        duration: 800,
        easing: 'ease-out',
        delay: 100
      },
      [ChartType.PIE]: {
        enabled: true,
        duration: 1200,
        easing: 'ease-out',
        delay: 0
      },
      [ChartType.AREA]: {
        enabled: true,
        duration: 1000,
        easing: 'ease-out',
        delay: 0
      },
      [ChartType.SCATTER]: {
        enabled: true,
        duration: 800,
        easing: 'ease-out',
        delay: 0
      },
      [ChartType.DONUT]: {
        enabled: true,
        duration: 1200,
        easing: 'ease-out',
        delay: 0
      },
      [ChartType.METRIC]: {
        enabled: true,
        duration: 600,
        easing: 'ease-out',
        delay: 0
      },
      [ChartType.TABLE]: {
        enabled: true,
        duration: 400,
        easing: 'ease-out',
        delay: 50
      },
      [ChartType.GEOGRAPHIC]: {
        enabled: true,
        duration: 1000,
        easing: 'ease-out',
        delay: 0
      },
      [ChartType.ACTIVITY_FEED]: {
        enabled: true,
        duration: 500,
        easing: 'ease-out',
        delay: 100
      }
    };

    return animations[type] || {
      enabled: true,
      duration: 800,
      easing: 'ease-out',
      delay: 0
    };
  }

  /**
   * Get layout configuration
   */
  static getLayoutConfig(type: ChartType): Record<string, any> {
    const layouts = {
      [ChartType.LINE]: {
        padding: { top: 20, right: 20, bottom: 40, left: 40 },
        margin: { top: 10, right: 10, bottom: 10, left: 10 }
      },
      [ChartType.BAR]: {
        padding: { top: 20, right: 20, bottom: 40, left: 40 },
        margin: { top: 10, right: 10, bottom: 10, left: 10 }
      },
      [ChartType.PIE]: {
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        margin: { top: 10, right: 10, bottom: 10, left: 10 }
      },
      [ChartType.AREA]: {
        padding: { top: 20, right: 20, bottom: 40, left: 40 },
        margin: { top: 10, right: 10, bottom: 10, left: 10 }
      },
      [ChartType.SCATTER]: {
        padding: { top: 20, right: 20, bottom: 40, left: 40 },
        margin: { top: 10, right: 10, bottom: 10, left: 10 }
      },
      [ChartType.DONUT]: {
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        margin: { top: 10, right: 10, bottom: 10, left: 10 }
      },
      [ChartType.METRIC]: {
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      [ChartType.TABLE]: {
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      [ChartType.GEOGRAPHIC]: {
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      [ChartType.ACTIVITY_FEED]: {
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      }
    };

    return layouts[type] || {
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
      margin: { top: 10, right: 10, bottom: 10, left: 10 }
    };
  }

  /**
   * Merge configurations
   */
  static mergeConfigs(
    defaultConfig: Record<string, any>,
    userConfig: Record<string, any>
  ): Record<string, any> {
    return {
      ...defaultConfig,
      ...userConfig,
      // Deep merge nested objects
      ...Object.keys(userConfig).reduce((acc, key) => {
        if (
          typeof userConfig[key] === 'object' &&
          userConfig[key] !== null &&
          !Array.isArray(userConfig[key]) &&
          typeof defaultConfig[key] === 'object' &&
          defaultConfig[key] !== null
        ) {
          acc[key] = {
            ...defaultConfig[key],
            ...userConfig[key]
          };
        }
        return acc;
      }, {} as Record<string, any>)
    };
  }

  /**
   * Validate configuration
   */
  static validateConfig(
    type: ChartType,
    config: Record<string, any>
  ): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!config || typeof config !== 'object') {
      errors.push('Configuration must be an object');
      return { isValid: false, errors, warnings };
    }

    // Type-specific validation
    switch (type) {
      case ChartType.LINE:
      case ChartType.BAR:
      case ChartType.AREA:
      case ChartType.SCATTER:
        if (config.animation !== undefined && typeof config.animation !== 'boolean') {
          warnings.push('Animation should be a boolean value');
        }
        break;

      case ChartType.PIE:
      case ChartType.DONUT:
        if (config.maintainAspectRatio !== undefined && typeof config.maintainAspectRatio !== 'boolean') {
          warnings.push('maintainAspectRatio should be a boolean value');
        }
        break;

      case ChartType.METRIC:
        if (config.showTrend !== undefined && typeof config.showTrend !== 'boolean') {
          warnings.push('showTrend should be a boolean value');
        }
        break;

      case ChartType.TABLE:
        if (config.showPagination !== undefined && typeof config.showPagination !== 'boolean') {
          warnings.push('showPagination should be a boolean value');
        }
        break;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}
