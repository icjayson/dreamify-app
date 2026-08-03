import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  VISUAL_THEMES,
  createThemeSelection,
  resolveAnalysisFocus,
  resolveVisualTheme,
} from './builtinTemplates';
import {
  CHART_THEME_COLORS,
  convertLLMStylingToChartStyling,
  getDashboardBackgroundStyle,
  isLightBackground,
} from '../utils/chartStyling';

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const normalized = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((index) => {
      const channel = parseInt(normalized.slice(index, index + 2), 16) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('theme and focus registry', () => {
  const legacyCssThemeAliases = ['ocean', 'forest', 'sunset', 'midnight', 'sakura', 'monochrome', 'light'];

  it('maps legacy use-case templates to visual themes', () => {
    expect(resolveVisualTheme('hr_workforce')?.id).toBe('warm');
    expect(resolveVisualTheme('finance_overview')?.id).toBe('chalk');
    expect(resolveVisualTheme('marketing_funnel')?.id).toBe('sage');
  });

  it('keeps direct theme IDs stable', () => {
    expect(resolveVisualTheme('carbon')?.name).toBe('Carbon Blue');
    expect(resolveVisualTheme('default')?.name).toBe('Classic Navy');
    expect(resolveVisualTheme('aurora')?.name).toBe('Aurora Violet');
    expect(resolveVisualTheme('glacier')?.name).toBe('Glacier Cyan');
  });

  it('keeps the expanded theme list ordered and selectable', () => {
    expect(VISUAL_THEMES).toHaveLength(16);
    expect(VISUAL_THEMES.slice(0, 8).map((theme) => theme.id)).toEqual([
      'default',
      'carbon',
      'slate',
      'chalk',
      'warm',
      'ash',
      'sage',
      'ink',
    ]);
    expect(createThemeSelection('cobalt')).toMatchObject({
      id: 'cobalt',
      title: 'Cobalt Lime',
      suggestedTheme: 'cobalt',
    });
  });

  it('classifies new light and dark dashboard themes for contrast handling', () => {
    expect(isLightBackground('glacier')).toBe(true);
    expect(isLightBackground('mint')).toBe(true);
    expect(isLightBackground('sandstone')).toBe(true);
    expect(isLightBackground('aurora')).toBe(false);
    expect(isLightBackground('cobalt')).toBe(false);
  });

  it('defines renderable color tokens and CSS classes for every visual theme', () => {
    const css = readFileSync(new URL('../styles/chart-presets.css', import.meta.url), 'utf-8');

    for (const theme of VISUAL_THEMES) {
      const colors = CHART_THEME_COLORS[theme.id];
      expect(colors).toBeDefined();
      expect(css).toContain(`.chart-theme-${theme.id}`);
      expect(contrastRatio(colors['title-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['description-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['element-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors['highlight-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors['title-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['description-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['element-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors['highlight-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps dashboard backgrounds owned by the selected visual theme', () => {
    const mismatchedLightBackground = '#f0f2f5';

    for (const theme of VISUAL_THEMES) {
      const styling = convertLLMStylingToChartStyling({
        theme: theme.id,
        dashboardBackground: mismatchedLightBackground,
      });

      expect(styling.dashboardBackground).toBe(CHART_THEME_COLORS[theme.id]['bg-dashboard-color']);
      expect(getDashboardBackgroundStyle(styling).backgroundColor).toBe(CHART_THEME_COLORS[theme.id]['bg-dashboard-color']);
    }
  });

  it('keeps legacy CSS theme aliases readable for stored dashboards', () => {
    const css = readFileSync(new URL('../styles/chart-presets.css', import.meta.url), 'utf-8');

    const extractColors = (themeId: string): Record<string, string> => {
      const match = css.match(new RegExp(`\\.chart-theme-${themeId}\\s*\\{([\\s\\S]*?)\\n\\}`));
      expect(match).toBeTruthy();
      return Object.fromEntries(
        [...(match?.[1] ?? '').matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((tokenMatch) => [
          tokenMatch[1],
          tokenMatch[2],
        ])
      );
    };

    const requiredColorTokens = [
      'title-color',
      'description-color',
      'element-color',
      'highlight-color',
      'bg-card-color',
      'bg-dashboard-color',
    ];

    for (const themeId of legacyCssThemeAliases) {
      const colors = extractColors(themeId);
      for (const token of requiredColorTokens) {
        expect(colors[token], `${themeId} defines ${token}`).toBeDefined();
      }
      expect(contrastRatio(colors['title-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['description-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['element-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors['highlight-color'], colors['bg-card-color'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors['title-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['description-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['element-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors['highlight-color'], colors['bg-dashboard-color'])).toBeGreaterThanOrEqual(3);
    }
  });

  it('creates a theme selection with optional analysis focus', () => {
    expect(createThemeSelection('warm', 'hr_workforce')).toMatchObject({
      id: 'warm',
      title: 'Warm Amber',
      suggestedTheme: 'warm',
      analysisFocusId: 'hr_workforce',
      analysisFocusName: 'HR',
    });
  });

  it('resolves legacy focus IDs separately from themes', () => {
    expect(resolveAnalysisFocus('finance_overview')?.short_name).toBe('Finance');
    expect(resolveAnalysisFocus('default')).toBeNull();
  });
});
