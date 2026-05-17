"""
Built-in analysis focus specs for dashboard generation.
Visual themes are handled separately; this file only contains domain guidance.
"""

from typing import Any, Dict, List, Optional


BUILTIN_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "default": {
        "id": "default",
        "name": "Default",
        "prompt_prefix": "",
        "required_metric_keywords": [],
        "required_chart_types": [],
        "layout_shape": "analytical",
    },
    "saas_growth": {
        "id": "saas_growth",
        "name": "SaaS Growth",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: SaaS Growth]\n"
            "Domain context: This is a SaaS business dashboard. Focus on subscription economics and growth metrics.\n\n"
            "REQUIRED METRICS (must appear as metric components):\n"
            "- Monthly Recurring Revenue (MRR) with month-over-month change\n"
            "- Churn Rate (%) with trend\n"
            "- Customer Acquisition Cost (CAC)\n"
            "- Customer Lifetime Value (LTV)\n"
            "- Annual Recurring Revenue (ARR) = MRR x 12\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Line chart: MRR or revenue trend over time\n"
            "- Bar chart: new vs churned customers per period\n\n"
            "LAYOUT: Prefer 4 metrics across the top, then charts below.\n"
            "OUTPUT CONSTRAINT: Every metric must have a sparkline. Avoid pie charts for subscription metrics.\n"
        ),
        "required_metric_keywords": ["mrr", "churn", "cac", "ltv", "arr", "monthly recurring", "lifetime value"],
        "required_chart_types": ["line", "bar"],
        "layout_shape": "analytical",
    },
    "ecommerce_sales": {
        "id": "ecommerce_sales",
        "name": "E-commerce Sales",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: E-commerce Sales]\n"
            "Domain context: This is an e-commerce business dashboard. Focus on transaction volume, conversion, and basket metrics.\n\n"
            "REQUIRED METRICS (must appear as metric components):\n"
            "- Gross Merchandise Value (GMV) or Total Revenue\n"
            "- Conversion Rate (%)\n"
            "- Average Order Value (AOV)\n"
            "- Cart Abandonment Rate (%)\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Line chart: GMV or revenue trend over time\n"
            "- Bar chart: top products or categories by revenue\n\n"
            "LAYOUT: Analytical layout with metrics row on top.\n"
            "OUTPUT CONSTRAINT: Include a top products table if product data is available.\n"
        ),
        "required_metric_keywords": ["gmv", "revenue", "conversion", "aov", "order value", "abandonment"],
        "required_chart_types": ["line", "bar"],
        "layout_shape": "analytical",
    },
    "finance_overview": {
        "id": "finance_overview",
        "name": "Finance Overview",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: Finance Overview]\n"
            "Domain context: This is a financial reporting dashboard. Focus on P&L, margins, and cash metrics.\n\n"
            "REQUIRED METRICS (must appear as metric components):\n"
            "- Total Revenue for the period\n"
            "- Total Expenses for the period\n"
            "- Net Margin (%)\n"
            "- Cash Position or Net Cash Flow\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Bar chart: Revenue vs expenses comparison by period\n"
            "- Line chart: Net margin trend over time\n\n"
            "LAYOUT: Executive layout.\n"
            "OUTPUT CONSTRAINT: Include period-over-period comparisons. Show budget vs actual if budget column exists.\n"
        ),
        "required_metric_keywords": ["revenue", "expense", "margin", "cash", "profit"],
        "required_chart_types": ["bar", "line"],
        "layout_shape": "executive",
    },
    "marketing_funnel": {
        "id": "marketing_funnel",
        "name": "Marketing Funnel",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: Marketing Funnel]\n"
            "Domain context: This is a marketing performance dashboard. Focus on funnel metrics, campaign effectiveness, and acquisition cost.\n\n"
            "REQUIRED METRICS (must appear as metric components):\n"
            "- Total Impressions or Reach\n"
            "- Click-Through Rate (CTR) (%)\n"
            "- Customer Acquisition Cost (CAC)\n"
            "- Campaign ROI or ROAS\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Funnel or bar chart: funnel stages\n"
            "- Bar chart: campaign performance comparison\n\n"
            "LAYOUT: Analytical layout.\n"
            "OUTPUT CONSTRAINT: Compare channels or campaigns side by side where possible.\n"
        ),
        "required_metric_keywords": ["impression", "ctr", "click", "cac", "roi", "roas", "conversion"],
        "required_chart_types": ["bar"],
        "layout_shape": "analytical",
    },
    "ops_performance": {
        "id": "ops_performance",
        "name": "Operations Performance",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: Operations Performance]\n"
            "Domain context: This is an operations dashboard. Focus on throughput, reliability, SLA compliance, and resource utilization.\n\n"
            "REQUIRED METRICS (must appear as metric components):\n"
            "- Throughput (volume processed per period)\n"
            "- Error Rate (%)\n"
            "- SLA Compliance (%)\n"
            "- Capacity Utilization (%)\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Line chart: throughput trend over time\n"
            "- Line chart: error rate or SLA compliance trend\n\n"
            "LAYOUT: Operational layout.\n"
            "OUTPUT CONSTRAINT: Use time series for all operational metrics.\n"
        ),
        "required_metric_keywords": ["throughput", "error", "sla", "capacity", "utilization", "compliance"],
        "required_chart_types": ["line"],
        "layout_shape": "operational",
    },
    "product_analytics": {
        "id": "product_analytics",
        "name": "Product Analytics",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: Product Analytics]\n"
            "Domain context: This is a product analytics dashboard. Focus on user engagement, retention, and feature adoption.\n\n"
            "REQUIRED METRICS (must appear as metric components):\n"
            "- Daily Active Users (DAU)\n"
            "- Monthly Active Users (MAU)\n"
            "- DAU/MAU Ratio (stickiness)\n"
            "- Feature Adoption Rate (%)\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Line chart: DAU or MAU trend over time\n"
            "- Bar chart: feature adoption or retention\n\n"
            "LAYOUT: Analytical layout.\n"
            "OUTPUT CONSTRAINT: Show retention cohort if cohort data available.\n"
        ),
        "required_metric_keywords": ["dau", "mau", "active user", "retention", "stickiness", "adoption"],
        "required_chart_types": ["line", "bar"],
        "layout_shape": "analytical",
    },
    "hr_workforce": {
        "id": "hr_workforce",
        "name": "HR & Workforce",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: HR & Workforce]\n"
            "Domain context: This is an HR analytics dashboard. Focus on workforce size, attrition, hiring velocity, and tenure.\n\n"
            "REQUIRED METRICS (must appear as metric components):\n"
            "- Total Headcount\n"
            "- Attrition Rate (%)\n"
            "- Time-to-Hire (average days)\n"
            "- Average Tenure (years)\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Bar chart: headcount by department or location\n"
            "- Line chart: attrition or hiring trend over time\n\n"
            "LAYOUT: Executive layout.\n"
            "OUTPUT CONSTRAINT: Show department breakdown if available. Compare hiring vs attrition.\n"
        ),
        "required_metric_keywords": ["headcount", "attrition", "hire", "tenure", "employee"],
        "required_chart_types": ["bar", "line"],
        "layout_shape": "executive",
    },
    "executive_summary": {
        "id": "executive_summary",
        "name": "Executive Summary",
        "prompt_prefix": (
            "[ANALYSIS FOCUS: Executive Summary]\n"
            "Domain context: This is an executive summary dashboard. Identify the 5 most important KPIs from the data.\n\n"
            "REQUIRED METRICS: Identify and include the top 3-5 most important KPIs from the provided data.\n\n"
            "REQUIRED CHARTS (must appear):\n"
            "- Line chart: primary KPI trend over time\n"
            "- Bar chart: secondary dimension breakdown\n\n"
            "LAYOUT: Executive layout - maximum 5 metrics, 2-3 charts.\n"
            "OUTPUT CONSTRAINT: Every metric must have a sparkline. Prioritize clarity over comprehensiveness.\n"
        ),
        "required_metric_keywords": [],
        "required_chart_types": ["line"],
        "layout_shape": "executive",
    },
}


def get_template(template_id: str) -> Optional[Dict[str, Any]]:
    """Get a built-in template by ID. Returns None if not found."""
    return BUILTIN_TEMPLATES.get(template_id)


def build_template_constraint_block(template: Dict[str, Any]) -> str:
    """Build the prompt prefix block to prepend when a template is active."""
    return f"\n{template['prompt_prefix']}\n{'=' * 80}\n"
