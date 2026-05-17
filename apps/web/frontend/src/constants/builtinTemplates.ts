/**
 * Built-in visual themes and analysis focuses for Dreamify.
 *
 * Visual themes control dashboard color/style. Analysis focuses are optional
 * domain guidance for Morpheus. The legacy BUILTIN_TEMPLATES export remains as
 * a read-only compatibility view for older UI and saved dashboard mappings.
 */
import { DashboardConfiguration, ChartType, LayoutType } from '@/types/dashboard';
import type { ChartPresetTheme } from '@/utils/chartStyling';

export type TemplateCategory = 'SaaS' | 'E-commerce' | 'Finance' | 'Marketing' | 'Operations' | 'Product' | 'HR' | 'Executive';

export interface MetricHint {
  name: string;
  description: string;
  format: 'currency' | 'percentage' | 'number' | 'ratio';
}

export interface ChartHint {
  chart_type: string;
  purpose: string;
  required: boolean;
}

export type LayoutShape = 'executive' | 'analytical' | 'operational';

export interface ContentSpec {
  prompt_prefix: string;
  required_metrics: MetricHint[];
  required_charts: ChartHint[];
  layout_shape: LayoutShape;
  output_constraints: string[];
}

export interface VisualTheme {
  id: ChartPresetTheme;
  name: string;
  description: string;
}

export type AnalysisFocusId =
  | 'auto'
  | 'saas_growth'
  | 'ecommerce_sales'
  | 'finance_overview'
  | 'marketing_funnel'
  | 'ops_performance'
  | 'product_analytics'
  | 'hr_workforce'
  | 'executive_summary';

export interface AnalysisFocus {
  id: AnalysisFocusId;
  name: string;
  short_name: string;
  category: TemplateCategory | 'Auto';
  description: string;
  suggested_theme: ChartPresetTheme;
  content_spec: ContentSpec;
}

export interface ThemeSelection {
  id: ChartPresetTheme;
  title: string;
  description: string;
  category: 'Theme';
  suggestedTheme: ChartPresetTheme;
  analysisFocusId?: Exclude<AnalysisFocusId, 'auto'>;
  analysisFocusName?: string;
}

export interface DreamifyTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  suggested_theme: ChartPresetTheme;
  content_spec: ContentSpec;
  sample_config: DashboardConfiguration;
}

const EMPTY_CONTENT_SPEC: ContentSpec = {
  prompt_prefix: '',
  required_metrics: [],
  required_charts: [],
  layout_shape: 'analytical',
  output_constraints: [],
};

export const VISUAL_THEMES: VisualTheme[] = [
  {
    id: 'default',
    name: 'Classic Navy',
    description: 'Light dashboard with navy highlights and balanced contrast.',
  },
  {
    id: 'carbon',
    name: 'Carbon Blue',
    description: 'Very dark dashboard with crisp blue accents.',
  },
  {
    id: 'slate',
    name: 'Slate Blue',
    description: 'Dark blue-gray palette for dense technical dashboards.',
  },
  {
    id: 'chalk',
    name: 'Chalk Ink',
    description: 'Clean white report style with dark ink typography.',
  },
  {
    id: 'warm',
    name: 'Warm Amber',
    description: 'Warm editorial palette with amber/rust highlights.',
  },
  {
    id: 'ash',
    name: 'Ash Mono',
    description: 'Neutral gray, minimal presentation with quiet contrast.',
  },
  {
    id: 'sage',
    name: 'Sage Green',
    description: 'Calm dark green palette with muted sage accents.',
  },
  {
    id: 'ink',
    name: 'Ink Gold',
    description: 'Near-black premium palette with amber and gold data colors.',
  },
  {
    id: 'aurora',
    name: 'Aurora Violet',
    description: 'Deep indigo dashboard with violet, cyan, and green accents.',
  },
  {
    id: 'glacier',
    name: 'Glacier Cyan',
    description: 'Icy light dashboard with crisp cyan-blue chart colors.',
  },
  {
    id: 'coral',
    name: 'Coral Graphite',
    description: 'Graphite dark dashboard with coral highlights and mixed accents.',
  },
  {
    id: 'orchid',
    name: 'Orchid Plum',
    description: 'Dark plum dashboard with orchid pink and violet data colors.',
  },
  {
    id: 'mint',
    name: 'Mint Paper',
    description: 'Soft mint report style with emerald analytical accents.',
  },
  {
    id: 'crimson',
    name: 'Crimson Slate',
    description: 'Dark slate dashboard with crimson highlights for urgent signals.',
  },
  {
    id: 'cobalt',
    name: 'Cobalt Lime',
    description: 'Deep cobalt dashboard with electric lime and cyan accents.',
  },
  {
    id: 'sandstone',
    name: 'Sandstone Clay',
    description: 'Warm light dashboard with terracotta and clay-toned accents.',
  },
];

export const ANALYSIS_FOCUSES: AnalysisFocus[] = [
  {
    id: 'auto',
    name: 'Auto',
    short_name: 'Auto',
    category: 'Auto',
    description: 'Let Dreamify infer the best analysis from the prompt and data.',
    suggested_theme: 'default',
    content_spec: EMPTY_CONTENT_SPEC,
  },
  {
    id: 'saas_growth',
    name: 'SaaS Growth',
    short_name: 'SaaS',
    category: 'SaaS',
    description: 'Subscription economics: MRR, churn, CAC, LTV, and ARR.',
    suggested_theme: 'carbon',
    content_spec: {
      prompt_prefix: '[FOCUS: SaaS Growth] This is a SaaS business dashboard. Focus on subscription economics and growth metrics.',
      required_metrics: [
        { name: 'Monthly Recurring Revenue (MRR)', description: 'Total monthly recurring subscription revenue', format: 'currency' },
        { name: 'Churn Rate', description: 'Monthly customer/revenue churn percentage', format: 'percentage' },
        { name: 'Customer Acquisition Cost (CAC)', description: 'Average cost to acquire one customer', format: 'currency' },
        { name: 'Customer Lifetime Value (LTV)', description: 'Average revenue per customer over their lifetime', format: 'currency' },
        { name: 'Annual Recurring Revenue (ARR)', description: 'MRR x 12', format: 'currency' },
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'MRR or revenue trend over time', required: true },
        { chart_type: 'bar', purpose: 'New vs churned customers per period', required: true },
      ],
      layout_shape: 'analytical',
      output_constraints: ['Every metric must have a sparkline', 'Prefer 4 metrics across the top', 'Avoid pie charts for subscription metrics'],
    },
  },
  {
    id: 'ecommerce_sales',
    name: 'E-commerce Sales',
    short_name: 'E-commerce',
    category: 'E-commerce',
    description: 'GMV, conversion rates, AOV, and cart abandonment.',
    suggested_theme: 'slate',
    content_spec: {
      prompt_prefix: '[FOCUS: E-commerce Sales] This is an e-commerce dashboard. Focus on transaction volume, conversion, and basket metrics.',
      required_metrics: [
        { name: 'Gross Merchandise Value (GMV)', description: 'Total transaction value', format: 'currency' },
        { name: 'Conversion Rate', description: 'Orders / sessions percentage', format: 'percentage' },
        { name: 'Average Order Value (AOV)', description: 'GMV / number of orders', format: 'currency' },
        { name: 'Cart Abandonment Rate', description: 'Percentage of carts not completed', format: 'percentage' },
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'GMV or revenue trend', required: true },
        { chart_type: 'bar', purpose: 'Top products or categories by revenue', required: true },
      ],
      layout_shape: 'analytical',
      output_constraints: ['Include a top products table if product data is available'],
    },
  },
  {
    id: 'finance_overview',
    name: 'Finance Overview',
    short_name: 'Finance',
    category: 'Finance',
    description: 'Revenue, expenses, net margins, and cash position.',
    suggested_theme: 'chalk',
    content_spec: {
      prompt_prefix: '[FOCUS: Finance Overview] This is a financial reporting dashboard. Focus on P&L, margins, and cash metrics.',
      required_metrics: [
        { name: 'Total Revenue', description: 'Total income for the period', format: 'currency' },
        { name: 'Total Expenses', description: 'Total costs for the period', format: 'currency' },
        { name: 'Net Margin', description: 'Net profit / revenue percentage', format: 'percentage' },
        { name: 'Cash Position', description: 'Current cash balance or cash flow', format: 'currency' },
      ],
      required_charts: [
        { chart_type: 'bar', purpose: 'Revenue vs expenses comparison by period', required: true },
        { chart_type: 'line', purpose: 'Net margin trend over time', required: true },
      ],
      layout_shape: 'executive',
      output_constraints: ['Include period-over-period comparisons', 'Show budget vs actual if budget column exists'],
    },
  },
  {
    id: 'marketing_funnel',
    name: 'Marketing Funnel',
    short_name: 'Marketing',
    category: 'Marketing',
    description: 'Impressions, CTR, CAC, campaign ROI, and channel performance.',
    suggested_theme: 'sage',
    content_spec: {
      prompt_prefix: '[FOCUS: Marketing Funnel] This is a marketing performance dashboard. Focus on funnel metrics, campaign effectiveness, and acquisition cost.',
      required_metrics: [
        { name: 'Total Impressions', description: 'Total ad or content impressions', format: 'number' },
        { name: 'Click-Through Rate (CTR)', description: 'Clicks / impressions', format: 'percentage' },
        { name: 'Customer Acquisition Cost (CAC)', description: 'Marketing spend / new customers', format: 'currency' },
        { name: 'Campaign ROI', description: 'Return on marketing investment', format: 'percentage' },
      ],
      required_charts: [
        { chart_type: 'funnel', purpose: 'Marketing funnel stages', required: true },
        { chart_type: 'bar', purpose: 'Campaign performance comparison', required: true },
      ],
      layout_shape: 'analytical',
      output_constraints: ['Compare channels or campaigns side by side'],
    },
  },
  {
    id: 'ops_performance',
    name: 'Operations Performance',
    short_name: 'Operations',
    category: 'Operations',
    description: 'Throughput, errors, SLA compliance, and utilization.',
    suggested_theme: 'ash',
    content_spec: {
      prompt_prefix: '[FOCUS: Operations Performance] This is an operations dashboard. Focus on throughput, reliability, SLA compliance, and resource utilization.',
      required_metrics: [
        { name: 'Throughput', description: 'Volume processed per period', format: 'number' },
        { name: 'Error Rate', description: 'Errors / total operations percentage', format: 'percentage' },
        { name: 'SLA Compliance', description: 'Percentage of SLAs met', format: 'percentage' },
        { name: 'Capacity Utilization', description: 'Used / available capacity', format: 'percentage' },
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'Throughput trend over time', required: true },
        { chart_type: 'line', purpose: 'Error rate or SLA compliance trend', required: true },
      ],
      layout_shape: 'operational',
      output_constraints: ['Use time series for all operational metrics'],
    },
  },
  {
    id: 'product_analytics',
    name: 'Product Analytics',
    short_name: 'Product',
    category: 'Product',
    description: 'DAU/MAU, adoption, retention, and product engagement.',
    suggested_theme: 'ink',
    content_spec: {
      prompt_prefix: '[FOCUS: Product Analytics] This is a product analytics dashboard. Focus on user engagement, retention, and feature adoption.',
      required_metrics: [
        { name: 'Daily Active Users (DAU)', description: 'Unique users active per day', format: 'number' },
        { name: 'Monthly Active Users (MAU)', description: 'Unique users active in the month', format: 'number' },
        { name: 'DAU/MAU Ratio', description: 'Stickiness ratio', format: 'ratio' },
        { name: 'Feature Adoption Rate', description: 'Percentage of users using key features', format: 'percentage' },
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'DAU or MAU trend over time', required: true },
        { chart_type: 'bar', purpose: 'Feature adoption or retention', required: true },
      ],
      layout_shape: 'analytical',
      output_constraints: ['Show retention curve if cohort data available'],
    },
  },
  {
    id: 'hr_workforce',
    name: 'HR & Workforce',
    short_name: 'HR',
    category: 'HR',
    description: 'Headcount, attrition, time-to-hire, and tenure.',
    suggested_theme: 'warm',
    content_spec: {
      prompt_prefix: '[FOCUS: HR & Workforce] This is an HR analytics dashboard. Focus on workforce size, attrition, hiring velocity, and tenure.',
      required_metrics: [
        { name: 'Total Headcount', description: 'Current number of employees', format: 'number' },
        { name: 'Attrition Rate', description: 'Employees left / average headcount', format: 'percentage' },
        { name: 'Time-to-Hire', description: 'Average days from job open to offer accepted', format: 'number' },
        { name: 'Average Tenure', description: 'Average employee tenure in years', format: 'number' },
      ],
      required_charts: [
        { chart_type: 'bar', purpose: 'Headcount by department or location', required: true },
        { chart_type: 'line', purpose: 'Attrition or hiring trend over time', required: true },
      ],
      layout_shape: 'executive',
      output_constraints: ['Show department breakdown if available', 'Compare hiring vs attrition'],
    },
  },
  {
    id: 'executive_summary',
    name: 'Executive Summary',
    short_name: 'Executive',
    category: 'Executive',
    description: 'Top KPIs and trends in a single executive overview.',
    suggested_theme: 'carbon',
    content_spec: {
      prompt_prefix: '[FOCUS: Executive Summary] This is an executive summary. Identify the 5 most important KPIs from the data and show their trends. Keep it minimal and high-impact.',
      required_metrics: [
        { name: 'Top KPI 1', description: 'Most important metric derived from the data', format: 'currency' },
        { name: 'Top KPI 2', description: 'Second most important metric', format: 'number' },
        { name: 'Top KPI 3', description: 'Third most important metric', format: 'percentage' },
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'Primary KPI trend over time', required: true },
        { chart_type: 'bar', purpose: 'Secondary dimension breakdown', required: true },
      ],
      layout_shape: 'executive',
      output_constraints: ['Maximum 5 metrics, 2-3 charts', 'Every metric must have a sparkline', 'Prioritize clarity over comprehensiveness'],
    },
  },
];

export const LEGACY_TEMPLATE_THEME_MAP: Record<string, ChartPresetTheme> = {
  default: 'default',
  saas_growth: 'carbon',
  ecommerce_sales: 'slate',
  finance_overview: 'chalk',
  marketing_funnel: 'sage',
  ops_performance: 'ash',
  product_analytics: 'ink',
  hr_workforce: 'warm',
  executive_summary: 'carbon',
};

export const LEGACY_TEMPLATE_FOCUS_MAP: Record<string, Exclude<AnalysisFocusId, 'auto'> | null> = {
  default: null,
  saas_growth: 'saas_growth',
  ecommerce_sales: 'ecommerce_sales',
  finance_overview: 'finance_overview',
  marketing_funnel: 'marketing_funnel',
  ops_performance: 'ops_performance',
  product_analytics: 'product_analytics',
  hr_workforce: 'hr_workforce',
  executive_summary: 'executive_summary',
};

const makeSampleMetric = (id: string, title: string, value: string, change: string, trend: 'up' | 'down', theme: ChartPresetTheme, x: number) => ({
  id,
  type: 'metric' as const,
  position: { x, y: 0, width: 3, height: 2 },
  component_config: {
    id,
    title,
    value,
    change,
    trend,
    data: [
      { label: 'Jan', value: 40 }, { label: 'Feb', value: 55 },
      { label: 'Mar', value: 48 }, { label: 'Apr', value: 62 },
      { label: 'May', value: 70 }, { label: 'Jun', value: 85 },
    ],
    styling: { presetTheme: theme, colorPalette: [], animationEnabled: true, gridVisible: true, legendPosition: 'top' as const },
  },
});

const makeSampleConfig = (id: string, title: string, theme: ChartPresetTheme): DashboardConfiguration => ({
  id,
  title,
  description: `Sample ${title} dashboard`,
  layout: { type: LayoutType.GRID, grid_columns: 12 },
  components: [
    makeSampleMetric('m1', 'Primary KPI', '$1.2M', '+12%', 'up', theme, 0),
    makeSampleMetric('m2', 'Secondary KPI', '84.2%', '+3.1%', 'up', theme, 3),
    makeSampleMetric('m3', 'Tertiary KPI', '2,847', '-5%', 'down', theme, 6),
    makeSampleMetric('m4', 'Growth Rate', '$340', '+8%', 'up', theme, 9),
    {
      id: 'c1',
      type: 'chart',
      position: { x: 0, y: 2, width: 8, height: 5 },
      component_config: {
        id: 'c1',
        type: ChartType.LINE,
        title: 'Trend Over Time',
        datasets: [{
          label: 'Series A',
          data: [
            { label: 'Jan', value: 42000 }, { label: 'Feb', value: 51000 },
            { label: 'Mar', value: 47000 }, { label: 'Apr', value: 63000 },
            { label: 'May', value: 71000 }, { label: 'Jun', value: 89000 },
          ],
        }],
        styling: { presetTheme: theme, colorPalette: [], animationEnabled: true, gridVisible: true, legendPosition: 'top' as const },
      },
    },
    {
      id: 'c2',
      type: 'chart',
      position: { x: 8, y: 2, width: 4, height: 5 },
      component_config: {
        id: 'c2',
        type: ChartType.BAR,
        title: 'Category Breakdown',
        datasets: [{
          label: 'Value',
          data: [
            { label: 'Cat A', value: 340 }, { label: 'Cat B', value: 280 },
            { label: 'Cat C', value: 190 }, { label: 'Cat D', value: 150 },
          ],
        }],
        styling: { presetTheme: theme, colorPalette: [], animationEnabled: true, gridVisible: true, legendPosition: 'top' as const },
      },
    },
  ],
});

export function resolveVisualTheme(themeOrLegacyTemplateId?: string | null): VisualTheme | null {
  if (!themeOrLegacyTemplateId) return null;
  const themeId = LEGACY_TEMPLATE_THEME_MAP[themeOrLegacyTemplateId] ?? themeOrLegacyTemplateId;
  return VISUAL_THEMES.find((theme) => theme.id === themeId) ?? null;
}

export function resolveAnalysisFocus(focusOrLegacyTemplateId?: string | null): AnalysisFocus | null {
  if (!focusOrLegacyTemplateId) return null;
  const focusId = LEGACY_TEMPLATE_FOCUS_MAP[focusOrLegacyTemplateId] ?? focusOrLegacyTemplateId;
  if (!focusId || focusId === 'auto') return null;
  return ANALYSIS_FOCUSES.find((focus) => focus.id === focusId) ?? null;
}

export function createThemeSelection(
  themeId: string | null | undefined,
  analysisFocusId?: string | null,
): ThemeSelection | null {
  const visualTheme = resolveVisualTheme(themeId);
  if (!visualTheme) return null;
  const focus = resolveAnalysisFocus(analysisFocusId ?? null);
  return {
    id: visualTheme.id,
    title: visualTheme.name,
    description: visualTheme.description,
    category: 'Theme',
    suggestedTheme: visualTheme.id,
    ...(focus ? { analysisFocusId: focus.id as Exclude<AnalysisFocusId, 'auto'>, analysisFocusName: focus.short_name } : {}),
  };
}

export const BUILTIN_TEMPLATES: DreamifyTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    category: 'Executive',
    description: 'Clean dashboard that works with any data. Used when no analysis focus is selected.',
    suggested_theme: 'default',
    content_spec: EMPTY_CONTENT_SPEC,
    sample_config: makeSampleConfig('default_sample', 'Dashboard', 'default'),
  },
  ...ANALYSIS_FOCUSES
    .filter((focus): focus is AnalysisFocus & { id: Exclude<AnalysisFocusId, 'auto'>; category: TemplateCategory } => focus.id !== 'auto')
    .map((focus) => ({
      id: focus.id,
      name: focus.name,
      category: focus.category,
      description: focus.description,
      suggested_theme: LEGACY_TEMPLATE_THEME_MAP[focus.id] ?? focus.suggested_theme,
      content_spec: focus.content_spec,
      sample_config: makeSampleConfig(`${focus.id}_sample`, `${focus.name} Dashboard`, LEGACY_TEMPLATE_THEME_MAP[focus.id] ?? focus.suggested_theme),
    })),
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['SaaS', 'E-commerce', 'Finance', 'Marketing', 'Operations', 'Product', 'HR', 'Executive'];
