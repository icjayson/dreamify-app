/**
 * Dashboard layout constants and configurations
 */

import { LayoutType } from '@/types/dashboard';

// Available layout types
export const AVAILABLE_LAYOUT_TYPES: LayoutType[] = [
  LayoutType.GRID,
  LayoutType.FLEX,
  LayoutType.CUSTOM
];

// Layout type display names
export const LAYOUT_TYPE_DISPLAY_NAMES: Record<LayoutType, string> = {
  [LayoutType.GRID]: 'Grid Layout',
  [LayoutType.FLEX]: 'Flexible Layout',
  [LayoutType.CUSTOM]: 'Custom Layout'
};

// Layout type descriptions
export const LAYOUT_TYPE_DESCRIPTIONS: Record<LayoutType, string> = {
  [LayoutType.GRID]: 'Organize components in a structured grid system',
  [LayoutType.FLEX]: 'Arrange components with flexible positioning',
  [LayoutType.CUSTOM]: 'Define custom positioning for each component'
};

// Default grid configurations
export const DEFAULT_GRID_CONFIGS = {
  [LayoutType.GRID]: {
    grid_columns: 12,
    breakpoints: {
      sm: 6,
      md: 8,
      lg: 12,
      xl: 12
    },
    spacing: 'normal',
    gap: 24
  },
  [LayoutType.FLEX]: {
    direction: 'row',
    wrap: 'wrap',
    justify: 'flex-start',
    align: 'stretch',
    gap: 24
  },
  [LayoutType.CUSTOM]: {
    positioning: 'absolute',
    units: 'px',
    snapToGrid: true,
    gridSize: 8
  }
};

// Responsive breakpoints
export const RESPONSIVE_BREAKPOINTS = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536
};

// Component size presets
export const COMPONENT_SIZE_PRESETS = {
  small: { width: 3, height: 2 },
  medium: { width: 6, height: 4 },
  large: { width: 9, height: 6 },
  xlarge: { width: 12, height: 8 },
  full: { width: 12, height: 10 }
};

// Layout templates
export const LAYOUT_TEMPLATES = {
  'single-column': {
    type: LayoutType.GRID,
    grid_columns: 12,
    components: [
      { position: { x: 0, y: 0, width: 12, height: 4 } },
      { position: { x: 0, y: 4, width: 12, height: 4 } },
      { position: { x: 0, y: 8, width: 12, height: 4 } }
    ]
  },
  'two-column': {
    type: LayoutType.GRID,
    grid_columns: 12,
    components: [
      { position: { x: 0, y: 0, width: 6, height: 4 } },
      { position: { x: 6, y: 0, width: 6, height: 4 } },
      { position: { x: 0, y: 4, width: 6, height: 4 } },
      { position: { x: 6, y: 4, width: 6, height: 4 } }
    ]
  },
  'three-column': {
    type: LayoutType.GRID,
    grid_columns: 12,
    components: [
      { position: { x: 0, y: 0, width: 4, height: 4 } },
      { position: { x: 4, y: 0, width: 4, height: 4 } },
      { position: { x: 8, y: 0, width: 4, height: 4 } },
      { position: { x: 0, y: 4, width: 4, height: 4 } },
      { position: { x: 4, y: 4, width: 4, height: 4 } },
      { position: { x: 8, y: 4, width: 4, height: 4 } }
    ]
  },
  'dashboard': {
    type: LayoutType.GRID,
    grid_columns: 12,
    components: [
      // Metrics row
      { position: { x: 0, y: 0, width: 3, height: 2 } },
      { position: { x: 3, y: 0, width: 3, height: 2 } },
      { position: { x: 6, y: 0, width: 3, height: 2 } },
      { position: { x: 9, y: 0, width: 3, height: 2 } },
      // Main charts row
      { position: { x: 0, y: 2, width: 8, height: 4 } },
      { position: { x: 8, y: 2, width: 4, height: 4 } },
      // Bottom row
      { position: { x: 0, y: 6, width: 4, height: 4 } },
      { position: { x: 4, y: 6, width: 4, height: 4 } },
      { position: { x: 8, y: 6, width: 4, height: 4 } }
    ]
  },
  'analytics': {
    type: LayoutType.GRID,
    grid_columns: 12,
    components: [
      // Header metrics
      { position: { x: 0, y: 0, width: 2, height: 2 } },
      { position: { x: 2, y: 0, width: 2, height: 2 } },
      { position: { x: 4, y: 0, width: 2, height: 2 } },
      { position: { x: 6, y: 0, width: 2, height: 2 } },
      { position: { x: 8, y: 0, width: 2, height: 2 } },
      { position: { x: 10, y: 0, width: 2, height: 2 } },
      // Main visualization
      { position: { x: 0, y: 2, width: 8, height: 6 } },
      // Side panels
      { position: { x: 8, y: 2, width: 4, height: 3 } },
      { position: { x: 8, y: 5, width: 4, height: 3 } }
    ]
  }
};

// Spacing options
export const SPACING_OPTIONS = {
  tight: 8,
  normal: 16,
  relaxed: 24,
  loose: 32
};

// Animation configurations
export const LAYOUT_ANIMATIONS = {
  fadeIn: {
    duration: 300,
    easing: 'ease-out',
    delay: 0
  },
  slideUp: {
    duration: 400,
    easing: 'ease-out',
    delay: 100
  },
  scaleIn: {
    duration: 200,
    easing: 'ease-out',
    delay: 0
  }
};

// Grid system configurations
export const GRID_SYSTEMS = {
  '12-column': {
    columns: 12,
    gutter: 24,
    margin: 16
  },
  '16-column': {
    columns: 16,
    gutter: 24,
    margin: 16
  },
  '24-column': {
    columns: 24,
    gutter: 16,
    margin: 12
  }
};

// Component positioning helpers
export const POSITIONING_HELPERS = {
  // Get grid position from pixel coordinates
  pixelToGrid: (pixelX: number, pixelY: number, gridSize: number) => ({
    x: Math.floor(pixelX / gridSize),
    y: Math.floor(pixelY / gridSize)
  }),

  // Get pixel position from grid coordinates
  gridToPixel: (gridX: number, gridY: number, gridSize: number) => ({
    x: gridX * gridSize,
    y: gridY * gridSize
  }),

  // Snap to grid
  snapToGrid: (value: number, gridSize: number) => Math.round(value / gridSize) * gridSize,

  // Validate position
  validatePosition: (position: { x: number; y: number; width: number; height: number }, gridColumns: number) => {
    return {
      x: Math.max(0, Math.min(position.x, gridColumns - 1)),
      y: Math.max(0, position.y),
      width: Math.max(1, Math.min(position.width, gridColumns - position.x)),
      height: Math.max(1, position.height)
    };
  }
};

// Layout validation rules
export const LAYOUT_VALIDATION_RULES = {
  maxComponents: 50,
  minComponentSize: { width: 1, height: 1 },
  maxComponentSize: { width: 12, height: 20 },
  maxGridColumns: 24,
  minGridColumns: 1
};
