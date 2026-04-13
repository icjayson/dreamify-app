/**
 * Built-in domain templates for Dreamify.
 * Content (domain) and visual (theme/style) are fully decoupled.
 */
import { DashboardConfiguration, ChartType, LayoutType } from '@/types/dashboard';

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

export interface DreamifyTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  suggested_theme: string;
  content_spec: ContentSpec;
  sample_config: DashboardConfiguration;
}

const makeSampleMetric = (id: string, title: string, value: string, change: string, trend: 'up' | 'down', theme: string, x: number) => ({
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
      { label: 'May', value: 70 }, { label: 'Jun', value: 85 }
    ],
    styling: { presetTheme: theme, colorPalette: [], animationEnabled: true, gridVisible: true, legendPosition: 'top' as const }
  }
});

const makeSampleConfig = (id: string, title: string, theme: string): DashboardConfiguration => ({
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
            { label: 'May', value: 71000 }, { label: 'Jun', value: 89000 }
          ]
        }],
        styling: { presetTheme: theme, colorPalette: [], animationEnabled: true, gridVisible: true, legendPosition: 'top' as const }
      }
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
            { label: 'Cat C', value: 190 }, { label: 'Cat D', value: 150 }
          ]
        }],
        styling: { presetTheme: theme, colorPalette: [], animationEnabled: true, gridVisible: true, legendPosition: 'top' as const }
      }
    }
  ]
});

export const BUILTIN_TEMPLATES: DreamifyTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    category: 'Executive',
    description: 'Clean monochrome dashboard — works with any data. Used when no template is selected.',
    suggested_theme: 'default',
    content_spec: {
      prompt_prefix: '',
      required_metrics: [],
      required_charts: [],
      layout_shape: 'analytical',
      output_constraints: []
    },
    sample_config: makeSampleConfig('default_sample', 'Dashboard', 'default')
  },
  {
    id: 'saas_growth',
    name: 'SaaS Growth',
    category: 'SaaS',
    description: 'Track subscription economics: MRR, churn, CAC, and LTV for SaaS businesses.',
    suggested_theme: 'carbon',
    content_spec: {
      prompt_prefix: '[TEMPLATE: SaaS Growth] This is a SaaS business dashboard. Focus on subscription economics and growth metrics.',
      required_metrics: [
        { name: 'Monthly Recurring Revenue (MRR)', description: 'Total monthly recurring subscription revenue', format: 'currency' },
        { name: 'Churn Rate', description: 'Monthly customer/revenue churn percentage', format: 'percentage' },
        { name: 'Customer Acquisition Cost (CAC)', description: 'Average cost to acquire one customer', format: 'currency' },
        { name: 'Customer Lifetime Value (LTV)', description: 'Average revenue per customer over their lifetime', format: 'currency' },
        { name: 'Annual Recurring Revenue (ARR)', description: 'MRR × 12', format: 'currency' }
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'MRR or revenue trend over time', required: true },
        { chart_type: 'bar', purpose: 'New vs churned customers per period', required: true }
      ],
      layout_shape: 'analytical',
      output_constraints: ['Every metric must have a sparkline', 'Prefer 4 metrics across the top', 'Avoid pie charts for subscription metrics']
    },
    sample_config: makeSampleConfig('saas_growth_sample', 'SaaS Growth Dashboard', 'carbon')
  },
  {
    id: 'ecommerce_sales',
    name: 'E-commerce Sales',
    category: 'E-commerce',
    description: 'Monitor GMV, conversion rates, AOV, and cart abandonment for online stores.',
    suggested_theme: 'slate',
    content_spec: {
      prompt_prefix: '[TEMPLATE: E-commerce Sales] This is an e-commerce dashboard. Focus on transaction volume, conversion, and basket metrics.',
      required_metrics: [
        { name: 'Gross Merchandise Value (GMV)', description: 'Total transaction value', format: 'currency' },
        { name: 'Conversion Rate', description: 'Orders / sessions percentage', format: 'percentage' },
        { name: 'Average Order Value (AOV)', description: 'GMV / number of orders', format: 'currency' },
        { name: 'Cart Abandonment Rate', description: 'Percentage of carts not completed', format: 'percentage' }
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'GMV or revenue trend', required: true },
        { chart_type: 'bar', purpose: 'Top products or categories by revenue', required: true }
      ],
      layout_shape: 'analytical',
      output_constraints: ['Include a top products table if product data is available']
    },
    sample_config: makeSampleConfig('ecommerce_sales_sample', 'E-commerce Sales Dashboard', 'slate')
  },
  {
    id: 'finance_overview',
    name: 'Finance Overview',
    category: 'Finance',
    description: 'Revenue, expenses, net margins, and cash position for financial reporting.',
    suggested_theme: 'chalk',
    content_spec: {
      prompt_prefix: '[TEMPLATE: Finance Overview] This is a financial reporting dashboard. Focus on P&L, margins, and cash metrics.',
      required_metrics: [
        { name: 'Total Revenue', description: 'Total income for the period', format: 'currency' },
        { name: 'Total Expenses', description: 'Total costs for the period', format: 'currency' },
        { name: 'Net Margin', description: 'Net profit / revenue percentage', format: 'percentage' },
        { name: 'Cash Position', description: 'Current cash balance or cash flow', format: 'currency' }
      ],
      required_charts: [
        { chart_type: 'bar', purpose: 'Revenue vs expenses comparison by period', required: true },
        { chart_type: 'line', purpose: 'Net margin trend over time', required: true }
      ],
      layout_shape: 'executive',
      output_constraints: ['Include period-over-period comparisons', 'Show budget vs actual if budget column exists']
    },
    sample_config: makeSampleConfig('finance_overview_sample', 'Finance Overview Dashboard', 'chalk')
  },
  {
    id: 'marketing_funnel',
    name: 'Marketing Funnel',
    category: 'Marketing',
    description: 'Impressions, CTR, CAC, pipeline value, and campaign ROI.',
    suggested_theme: 'sage',
    content_spec: {
      prompt_prefix: '[TEMPLATE: Marketing Funnel] This is a marketing performance dashboard. Focus on funnel metrics, campaign effectiveness, and acquisition cost.',
      required_metrics: [
        { name: 'Total Impressions', description: 'Total ad or content impressions', format: 'number' },
        { name: 'Click-Through Rate (CTR)', description: 'Clicks / impressions', format: 'percentage' },
        { name: 'Customer Acquisition Cost (CAC)', description: 'Marketing spend / new customers', format: 'currency' },
        { name: 'Campaign ROI', description: 'Return on marketing investment', format: 'percentage' }
      ],
      required_charts: [
        { chart_type: 'funnel', purpose: 'Marketing funnel stages', required: true },
        { chart_type: 'bar', purpose: 'Campaign performance comparison', required: true }
      ],
      layout_shape: 'analytical',
      output_constraints: ['Compare channels or campaigns side by side']
    },
    sample_config: makeSampleConfig('marketing_funnel_sample', 'Marketing Funnel Dashboard', 'sage')
  },
  {
    id: 'ops_performance',
    name: 'Operations Performance',
    category: 'Operations',
    description: 'Throughput, error rates, SLA compliance, and capacity utilization.',
    suggested_theme: 'ash',
    content_spec: {
      prompt_prefix: '[TEMPLATE: Operations Performance] This is an operations dashboard. Focus on throughput, reliability, SLA compliance, and resource utilization.',
      required_metrics: [
        { name: 'Throughput', description: 'Volume processed per period', format: 'number' },
        { name: 'Error Rate', description: 'Errors / total operations percentage', format: 'percentage' },
        { name: 'SLA Compliance', description: 'Percentage of SLAs met', format: 'percentage' },
        { name: 'Capacity Utilization', description: 'Used / available capacity', format: 'percentage' }
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'Throughput trend over time', required: true },
        { chart_type: 'line', purpose: 'Error rate or SLA compliance trend', required: true }
      ],
      layout_shape: 'operational',
      output_constraints: ['Use time series for all operational metrics']
    },
    sample_config: makeSampleConfig('ops_performance_sample', 'Operations Dashboard', 'ash')
  },
  {
    id: 'product_analytics',
    name: 'Product Analytics',
    category: 'Product',
    description: 'DAU/MAU, feature adoption, retention curves, and NPS.',
    suggested_theme: 'ink',
    content_spec: {
      prompt_prefix: '[TEMPLATE: Product Analytics] This is a product analytics dashboard. Focus on user engagement, retention, and feature adoption.',
      required_metrics: [
        { name: 'Daily Active Users (DAU)', description: 'Unique users active per day', format: 'number' },
        { name: 'Monthly Active Users (MAU)', description: 'Unique users active in the month', format: 'number' },
        { name: 'DAU/MAU Ratio', description: 'Stickiness ratio', format: 'ratio' },
        { name: 'Feature Adoption Rate', description: 'Percentage of users using key features', format: 'percentage' }
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'DAU or MAU trend over time', required: true },
        { chart_type: 'bar', purpose: 'Feature adoption or retention', required: true }
      ],
      layout_shape: 'analytical',
      output_constraints: ['Show retention curve if cohort data available']
    },
    sample_config: makeSampleConfig('product_analytics_sample', 'Product Analytics Dashboard', 'ink')
  },
  {
    id: 'hr_workforce',
    name: 'HR & Workforce',
    category: 'HR',
    description: 'Headcount, attrition rate, time-to-hire, and tenure distribution.',
    suggested_theme: 'warm',
    content_spec: {
      prompt_prefix: '[TEMPLATE: HR & Workforce] This is an HR analytics dashboard. Focus on workforce size, attrition, hiring velocity, and tenure.',
      required_metrics: [
        { name: 'Total Headcount', description: 'Current number of employees', format: 'number' },
        { name: 'Attrition Rate', description: 'Employees left / average headcount', format: 'percentage' },
        { name: 'Time-to-Hire', description: 'Average days from job open to offer accepted', format: 'number' },
        { name: 'Average Tenure', description: 'Average employee tenure in years', format: 'number' }
      ],
      required_charts: [
        { chart_type: 'bar', purpose: 'Headcount by department or location', required: true },
        { chart_type: 'line', purpose: 'Attrition or hiring trend over time', required: true }
      ],
      layout_shape: 'executive',
      output_constraints: ['Show department breakdown if available', 'Compare hiring vs attrition']
    },
    sample_config: makeSampleConfig('hr_workforce_sample', 'HR & Workforce Dashboard', 'warm')
  },
  {
    id: 'executive_summary',
    name: 'Executive Summary',
    category: 'Executive',
    description: 'Top 5 KPIs with trends — a single-screen executive overview derived from your data.',
    suggested_theme: 'carbon',
    content_spec: {
      prompt_prefix: '[TEMPLATE: Executive Summary] This is an executive summary. Identify the 5 most important KPIs from the data and show their trends. Keep it minimal and high-impact.',
      required_metrics: [
        { name: 'Top KPI 1', description: 'Most important metric derived from the data', format: 'currency' },
        { name: 'Top KPI 2', description: 'Second most important metric', format: 'number' },
        { name: 'Top KPI 3', description: 'Third most important metric', format: 'percentage' }
      ],
      required_charts: [
        { chart_type: 'line', purpose: 'Primary KPI trend over time', required: true },
        { chart_type: 'bar', purpose: 'Secondary dimension breakdown', required: true }
      ],
      layout_shape: 'executive',
      output_constraints: ['Maximum 5 metrics, 2-3 charts', 'Every metric must have a sparkline', 'Prioritize clarity over comprehensiveness']
    },
    sample_config: makeSampleConfig('executive_summary_sample', 'Executive Summary Dashboard', 'carbon')
  }
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['SaaS', 'E-commerce', 'Finance', 'Marketing', 'Operations', 'Product', 'HR', 'Executive'];
