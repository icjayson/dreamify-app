/**
 * Chart Theme Hook - React hook for managing chart theme state
 * Integrates with CSS presets and existing component patterns
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChartStyling } from '@/types/dashboard';
import {
  applyChartStyling,
  getColorPalette,
  assignDatasetColors,
  getChartStylingClasses,
  convertLLMStylingToChartStyling,
  validateChartStyling,
  getDefaultChartStyling,
  mergeChartStyling,
  CHART_PRESET_THEMES,
  ChartPresetTheme
} from '@/utils/chartStyling';

interface UseChartThemeOptions {
  initialStyling?: Partial<ChartStyling>;
  containerRef?: React.RefObject<HTMLElement>;
  onThemeChange?: (styling: ChartStyling) => void;
}

interface UseChartThemeReturn {
  styling: ChartStyling;
  setStyling: (styling: Partial<ChartStyling>) => void;
  setPresetTheme: (theme: ChartPresetTheme) => void;
  applyTheme: () => void;
  getColorPalette: (datasetCount?: number) => string[];
  assignColors: (datasets: Array<{ label: string; data: any[]; color?: string }>) => Array<{ label: string; data: any[]; color: string }>;
  getStylingClasses: () => string;
  isValid: boolean;
  errors: string[];
}

export function useChartTheme(options: UseChartThemeOptions = {}): UseChartThemeReturn {
  const {
    initialStyling = {},
    containerRef,
    onThemeChange
  } = options;

  // Initialize styling with defaults and custom values
  const [styling, setStylingState] = useState<ChartStyling>(() => {
    const defaultStyling = getDefaultChartStyling();
    return mergeChartStyling(initialStyling, defaultStyling);
  });

  // Validation state
  const [validation, setValidation] = useState(() => validateChartStyling(styling));

  // Update validation when styling changes
  useEffect(() => {
    const newValidation = validateChartStyling(styling);
    setValidation(newValidation);
  }, [styling]);

  // Apply styling to container when it changes
  useEffect(() => {
    if (containerRef?.current) {
      applyChartStyling(containerRef.current, styling);
    }
  }, [styling, containerRef]);

  // Notify parent of theme changes
  useEffect(() => {
    if (onThemeChange) {
      onThemeChange(styling);
    }
  }, [styling, onThemeChange]);

  // Set styling with validation
  const setStyling = useCallback((newStyling: Partial<ChartStyling>) => {
    setStylingState(prev => mergeChartStyling(newStyling, prev));
  }, []);

  // Set preset theme
  const setPresetTheme = useCallback((theme: ChartPresetTheme) => {
    setStylingState(prev => ({
      ...prev,
      presetTheme: theme,
      colorPalette: getColorPalette(theme, prev.colorPalette.length)
    }));
  }, []);

  // Apply theme to container
  const applyTheme = useCallback(() => {
    if (containerRef?.current) {
      applyChartStyling(containerRef.current, styling);
    }
  }, [styling, containerRef]);

  // Get color palette for current theme
  const getColorPaletteForTheme = useCallback((datasetCount: number = 5) => {
    return getColorPalette(styling.presetTheme as ChartPresetTheme, datasetCount);
  }, [styling.presetTheme]);

  // Assign colors to datasets
  const assignColors = useCallback((datasets: Array<{ label: string; data: any[]; color?: string }>) => {
    return assignDatasetColors(datasets, styling);
  }, [styling]);

  // Get styling classes
  const getStylingClasses = useCallback(() => {
    return getChartStylingClasses(styling);
  }, [styling]);

  return {
    styling,
    setStyling,
    setPresetTheme,
    applyTheme,
    getColorPalette: getColorPaletteForTheme,
    assignColors,
    getStylingClasses,
    isValid: validation.isValid,
    errors: validation.errors
  };
}

// Hook for managing multiple chart themes
export function useChartThemeManager() {
  const [themes, setThemes] = useState<Map<string, ChartStyling>>(new Map());

  const setTheme = useCallback((chartId: string, styling: ChartStyling) => {
    setThemes(prev => new Map(prev.set(chartId, styling)));
  }, []);

  const getTheme = useCallback((chartId: string) => {
    return themes.get(chartId) || getDefaultChartStyling();
  }, [themes]);

  const removeTheme = useCallback((chartId: string) => {
    setThemes(prev => {
      const newMap = new Map(prev);
      newMap.delete(chartId);
      return newMap;
    });
  }, []);

  const clearThemes = useCallback(() => {
    setThemes(new Map());
  }, []);

  return {
    themes,
    setTheme,
    getTheme,
    removeTheme,
    clearThemes
  };
}

// Hook for theme switching with smooth transitions
export function useChartThemeTransition(
  initialTheme: ChartPresetTheme = CHART_PRESET_THEMES.CORPORATE,
  transitionDuration: number = 300
) {
  const [currentTheme, setCurrentTheme] = useState<ChartPresetTheme>(initialTheme);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [targetTheme, setTargetTheme] = useState<ChartPresetTheme | null>(null);

  const switchTheme = useCallback((newTheme: ChartPresetTheme) => {
    if (newTheme === currentTheme || isTransitioning) {
      return;
    }

    setTargetTheme(newTheme);
    setIsTransitioning(true);

    // Apply transition
    setTimeout(() => {
      setCurrentTheme(newTheme);
      setTargetTheme(null);
      setIsTransitioning(false);
    }, transitionDuration);
  }, [currentTheme, isTransitioning, transitionDuration]);

  return {
    currentTheme,
    targetTheme,
    isTransitioning,
    switchTheme
  };
}

// Hook for responsive theme switching
export function useResponsiveChartTheme() {
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const checkScreenSize = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
      setIsTablet(width >= 768 && width < 1024);
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);

    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  const getResponsiveTheme = useCallback((baseTheme: ChartPresetTheme): ChartPresetTheme => {
    if (isMobile) {
      // Use minimal theme for mobile for better readability
      return CHART_PRESET_THEMES.MINIMAL;
    }
    
    if (isTablet) {
      // Use corporate theme for tablet
      return CHART_PRESET_THEMES.CORPORATE;
    }
    
    return baseTheme;
  }, [isMobile, isTablet]);

  return {
    isMobile,
    isTablet,
    getResponsiveTheme
  };
}
