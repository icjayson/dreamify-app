"""
Node implementations for stateful agentic workflow.

Each node is a pure function that takes AgentState and returns updated AgentState.
Nodes are responsible for specific workflow phases and should not directly
transition to other nodes (that's handled by edges.py).
"""

import os
import csv
import time
import json
import re
import math
import concurrent.futures as _futures
from datetime import datetime
from typing import Callable, Any, Dict, Optional

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage

from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    ActionRequest,
    WorkflowHistoryEntry,
)
from morpheus.workflows.analyze_csv.ask_first import (
    build_workflow_clarifications,
    extract_dashboard_targets,
    latest_clarification_metadata,
)
from morpheus.workflows.analyze_csv.schemas.chart_spec import (
    ChartModificationResult,
    ChartSpec,
    TableModificationResult,
    TableSpec,
)
from morpheus.tools.python_repl.tool import PythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.models.base import get_model_for_agent, get_model_for_quick_agent
from utils.logger import logger
from utils.postprocess import clean_json

# ---------------------------------------------------------------------------
# Chart-modification data-authenticity policy
# ---------------------------------------------------------------------------
# A chart edit is hard-rejected (forcing a retry) only when MORE THAN this
# fraction of its emitted datapoints cannot be traced back to a printed Python
# REPL value. Kept high (0.5) so legitimate restyle edits that reuse a couple
# of pre-existing values are not false-flagged. See
# ``_validate_chart_modification_data`` for the full severity policy.
CHART_MOD_AUTHENTICITY_FAIL_RATIO = 0.5

# Chart edits are smaller and more latency-sensitive than full-dashboard
# generations, so we retry at most once (vs. 2 for the full dashboard) before
# accepting with a warning.
CHART_MOD_AUTHENTICITY_MAX_RETRIES = 1

# ---------------------------------------------------------------------------
# Thread-safe LLM timeout helper
# ---------------------------------------------------------------------------
# signal.SIGALRM only works in the main thread and crashes in FastAPI background
# tasks. concurrent.futures gives us a real timeout for any thread.
_LLM_EXECUTOR = _futures.ThreadPoolExecutor(
    max_workers=8, thread_name_prefix="llm_call"
)


def _llm_invoke(model_fn: Callable, messages, label: str = "LLM"):
    """
    Call model_fn(messages) with a hard timeout that works in background threads.
    Raises TimeoutError if the call exceeds `timeout` seconds.
    """
    logger.info(f"[LLM] {label} — calling model")
    future = _LLM_EXECUTOR.submit(model_fn, messages)
    try:
        result = future.result()
        logger.info(f"[LLM] {label} — completed OK")
        return result
    except _futures.TimeoutError:
        logger.error(f"[Timeout] {label} exceeded 60s — aborting call")
        raise TimeoutError(f"{label} timed out after 60s")


def _update_usage(state: AgentState, response: Any):
    """Update accumulated token usage from LLM response."""
    if hasattr(response, "usage_metadata") and response.usage_metadata:
        tokens = response.usage_metadata.get("total_tokens", 0)
        state.working_memory.total_tokens += tokens
        logger.info(
            f"[Usage] {tokens} tokens (total: {state.working_memory.total_tokens})"
        )


# Import system prompts from original workflow
# These will be refactored into separate prompts module later if needed
QA_SYSTEM_PROMPT = """You are Dreamify AI analytics assistant. Your goal is to answer the user's questions textually based on the provided data and conversation history. Do not generate JSON dashboards.

🚨 CRITICAL TOOL RESTRICTIONS 🚨
=================================
AVAILABLE TOOLS (ONLY THESE TWO):
1. 'Python_REPL' - To execute Python code (use 'query' parameter)
2. 'get_available_chart_types' - To get chart type information

FORBIDDEN TOOL NAMES (DO NOT USE):
- 'run' ❌
- 'execute' ❌
- 'code' ❌
- 'code_interpreter' ❌
- 'python' ❌
- ANY other tool name ❌

CRITICAL TOOL USAGE:
- You DO NOT have a tool named 'run', 'execute', or 'code_interpreter'.
- To execute Python code, you MUST use the tool named 'Python_REPL'.
- Never make up tool names. Only use tools listed above.
- If you receive an error about an unknown tool, STOP and use 'Python_REPL' instead.

IMPORTANT TOOL USAGE GUIDELINES:
- Use the python_repl tool ONLY when the question requires data analysis, calculations, or information from the CSV file
- For general knowledge questions (e.g., "who is X", "what is Y"), answer directly using your knowledge - DO NOT use tools
- For questions about the data file, use python_repl to read and analyze the CSV
- If the question is not related to the data file, answer directly without using tools"""

QA_VISUAL_SYSTEM_PROMPT = """You are Dreamify AI analytics assistant in QA Visual Mode. Your goal is to answer the user's focused data question with concise text AND 1-3 inline chart/table artifacts. Do not create a dashboard.

🚨 CRITICAL TOOL RESTRICTIONS 🚨
=================================
AVAILABLE TOOLS (ONLY THESE TWO):
1. 'Python_REPL' - To execute Python code (use 'query' parameter)
2. 'get_available_chart_types' - To get chart type information

FORBIDDEN TOOL NAMES (DO NOT USE):
- 'run' ❌
- 'execute' ❌
- 'code' ❌
- 'code_interpreter' ❌
- 'python' ❌
- ANY other tool name ❌

CRITICAL WORKFLOW REQUIREMENT:
==============================
You MUST use Python_REPL before answering. Load the data, inspect the relevant columns, compute every value you will mention or render, and print the computed results.

Use QA Visual Mode for compact supporting visuals:
- Trend questions -> one line/area/bar chart
- Comparison questions -> one bar/line/composed chart
- Ranking/top/bottom questions -> one bar chart or table
- Detailed row/list questions -> one table

OUTPUT FORMAT:
==============
Return ONLY a JSON code block with this exact top-level shape:

```json
{
  "answer": "Concise natural language answer grounded in the computed data.",
  "artifacts": [
    {
      "id": "artifact_001",
      "kind": "chart",
      "chart_type": "line",
      "title": "Short chart title",
      "description": "Optional one-line description",
      "datasets": [
        {
          "label": "Series label",
          "data": [
            {"label": "2026-01-01", "value": 123}
          ]
        }
      ],
      "config": {"animation": true, "showGrid": true, "showLegend": true},
      "styling": {
        "theme": "default",
        "title": "title-color",
        "description": "description-color",
        "cartesianGrid": "element-color/75",
        "xAxis": "element-color",
        "yAxis": "element-color",
        "legend": "highlight-color",
        "dataElements": "highlight-color",
        "tile": {
          "background": "bg-card-color",
          "borderColor": "border-card-color",
          "borderWidth": 1,
          "borderRadius": 12
        }
      }
    }
  ]
}
```

For table artifacts, use:
```json
{
  "id": "artifact_001",
  "kind": "table",
  "title": "Short table title",
  "description": "Optional one-line description",
  "columns": [
    {"key": "channel", "label": "Channel", "type": "string"},
    {"key": "value", "label": "Value", "type": "number"}
  ],
  "data": [
    {"channel": "Facebook", "value": 123}
  ],
  "styling": {
    "theme": "default",
    "title": "title-color",
    "description": "description-color",
    "headerBg": "highlight-color/10",
    "headerText": "title-color",
    "rowBg": "transparent",
    "rowAltBg": "highlight-color/5",
    "borderColor": "element-color",
    "tile": {
      "background": "bg-card-color",
      "borderColor": "border-card-color",
      "borderWidth": 1,
      "borderRadius": 12
    }
  }
}
```

CRITICAL OUTPUT RULES:
- Do NOT output a dashboard object.
- Do NOT include metrics cards.
- Use 1-3 artifacts maximum.
- Every number and label must come from Python_REPL output.
- Chart datasets must not be empty.
- Table columns and data must not be empty.
- For chart artifacts, keep titles short, avoid long descriptions, prefer 1-2 datasets, and limit categorical charts to the top 8-12 categories unless the user asks for more.
- For table artifacts, prefer 3-6 important columns and enough rows to answer the question; keep descriptions short because chat renders tables compactly.
- Prefer the smallest useful visual that directly supports the answer."""

DASHBOARD_SYSTEM_PROMPT = """You are Morpheus, an expert data analysis AI assistant in Dashboard Mode. Your task is to generate comprehensive dashboard configurations.

🚨 CRITICAL TOOL RESTRICTIONS 🚨
=================================
AVAILABLE TOOLS (ONLY THESE TWO):
1. 'Python_REPL' - To execute Python code (use 'query' parameter)
2. 'get_available_chart_types' - To get chart type information

FORBIDDEN TOOL NAMES (DO NOT USE):
- 'run' ❌
- 'execute' ❌
- 'code' ❌
- 'code_interpreter' ❌
- 'python' ❌
- ANY other tool name ❌

CRITICAL TOOL USAGE:
- You DO NOT have a tool named 'run', 'execute', or 'code_interpreter'.
- To execute Python code, you MUST use the tool named 'Python_REPL'.
- Never make up tool names. Only use tools listed above.
- If you receive an error about an unknown tool, STOP and use 'Python_REPL' instead.

CRITICAL WORKFLOW REQUIREMENT:
==============================
You MUST use tools BEFORE generating any JSON output. Follow this workflow:

1. ALWAYS start by calling Python_REPL to load and inspect the CSV file
   - Use the file path provided in the user's message
   - Load: df = pd.read_csv(file_path) (for CSV); df = pd.read_excel(file_path) (for Excel/xlsx)
   - Inspect: df.head(), df.info(), df.columns.tolist()
   - Analyze data types, missing values, distributions

2. Use Python_REPL again to compute ALL metrics and datasets
   - Calculate aggregations: SUM, AVG, COUNT, groupby operations
   - Store results in variables and PRINT them
   - Extract all values you will embed in the dashboard JSON

3. Use get_available_chart_types tool to see available chart options

4. ONLY AFTER steps 1-3, generate the dashboard JSON with embedded computed data

ROBUST DATA INGESTION (REQUIRED STEPS):
=======================================
1. Try reading with `encoding='utf-8'` then fallback to `encoding='latin-1'` or `chardet`
2. Use delimiter sniffing (csv.Sniffer or `sep=None`, `engine='python'`) to detect `, ; \t |`
3. Use `on_bad_lines='skip'` for problematic rows
4. For large files (>100k rows), use chunked reading (`chunksize`) or sample-mode (first N rows)
5. Coerce numeric-like strings with currency/thousands cleaning (regex)

CARDINALITY GUIDELINES:
=======================
- Low (≤10): Ideal for color encoding, pie charts
- Medium (11-50): Good for bar charts, filters
- High (>50): Requires top-N filtering or hierarchical grouping

CHART RECOMMENDATIONS:
======================
- Try to prioritize mixed chart types (e.g. line + bar, bar + pie, etc...) to provide comprehensive analysis
- Produce charts sorted by priority (high, medium, low)
- Include evidence: {n_rows, cardinality_x, correlation_xy (nullable), trend_detected (nullable)}
- Consider adding filters: date range, category multi-select, top-N, comparison toggles

DATASET FORMATS BY CHART TYPE:
==============================
For line/area charts (time series):
  {"label": "2022-03-31", "value": 101683.85}

For bar charts (categorical):
  {"label": "Electronics", "value": 25000}

For pie/donut charts:
  {"label": "Category A", "value": 45.5}

NOTE: Do NOT include "color" fields in datasets. Frontend applies theme colors.

TABLE FORMATTING REQUIREMENTS (CRITICAL):
=========================================
- For ALL tables, transform raw CSV column names into natural, human-readable labels
- Examples of transformations:
  - `orderId` → `Order ID`
  - `qty` → `Quantity`
  - `amount` → `Amount`
  - `status` → `Status`
  - `category` → `Category`
  - `date` → `Date`
  - `user_id` → `User ID`
  - `subscription_type` → `Subscription Type`
  - `is_churned` → `Churned`
- Use proper capitalization and spacing
- Make column names descriptive and professional
- NEVER use raw CSV field names in table columns 

COLUMN-LEVEL PROFILING (For Each Column):
=========================================
Identify data types:
- `numeric`: int64, float64 (measures, KPIs)
- `categorical`: object with <1000 unique values (dimensions, filters)
- `temporal`: datetime or parseable date strings (time axis)
- `boolean`: True/False, Yes/No, 0/1 patterns
- `text`: High-cardinality strings (descriptions, IDs)
- `geographic`: Country, State, City, ZIP patterns
- `currency`: $ € £ symbols or decimal patterns

Track for each column:
- n_rows, n_nonnull, missing_rate
- cardinality (unique values count)
- distribution (for numeric: min/max/mean/median; for categorical: top values)

KEY METRICS COMPUTATION:
========================
FIRST: Print df.columns.tolist() and identify WHAT COLUMNS ACTUALLY EXIST.
Metrics and chart titles MUST be derived from actual column names.

For numeric columns, apply keyword heuristics ONLY when the column name matches:
- Column name contains revenue/sales/amount/price → metric title uses that column name, computes SUM
- Column name contains user/dau/mau/nru/aru → metric title references that column
- Column name is ambiguous (e.g. "A1", "A30", "col_7") → use the column name AS-IS or ask
- If time column exists AND a numeric column exists → compute trend/growth for that numeric column

DO NOT invent standard SaaS metrics (Revenue, ARPU, LTV, Churn, Ad Spend, Conversions,
Industries, Countries, Campaign Types) unless the CSV has a column with that exact concept.
"Business relevance" means: what IS in this specific dataset, not what a typical dashboard has.

🚫 CRITICAL DATA EMBEDDING REQUIREMENT 🚫
=========================================
NO SQL QUERIES ALLOWED IN JSON OUTPUT:
- Do NOT output any "query" or "sql" fields in the JSON
- You MUST execute Python code using Python_REPL to calculate ALL values BEFORE generating JSON
- The datasets[].data[] arrays MUST contain actual numbers derived from your Python execution
- NEVER use placeholders, query strings, or SQL statements in the output
- All values in datasets[].data[] must be final computed numbers from Python

⚠️ ANTI-HALLUCINATION RULES (MANDATORY) ⚠️
==========================================
1. NEVER FABRICATE DATA:
   - Every single number in your JSON MUST come from a print() statement in Python REPL
   - If you cannot find a value in your tool outputs, DO NOT include that metric/chart
   - An INCOMPLETE dashboard with REAL data is BETTER than a complete one with FAKE data

2. CITE YOUR SOURCES:
   - Before writing any value, mentally trace it back to a specific print() output
   - If you cannot find the source, the value is fabricated - DO NOT USE IT

3. NO SYNTHETIC EXAMPLES:
   - Do NOT use example values like 1000, 5000, 10000 or other round numbers
   - Do NOT use placeholder dates, names, or categories
   - ONLY use exact values from your Python analysis

4. 🚨 STRING DATA RULES (CRITICAL) 🚨:
   - ALL labels, names, categories MUST come EXACTLY from the CSV file or tool output
   - NEVER invent product names, seller names, category names, or any text labels
   - Before using a string label, print it from the data: print(df['column'].unique())
   - Copy labels EXACTLY as they appear - do not paraphrase or summarize
   - Common fabrications to AVOID:
     * "Product A", "Product B", "Category 1" → USE ACTUAL NAMES FROM DATA
     * "John Smith", "Jane Doe" → USE ACTUAL NAMES FROM DATA
     * "Seller A", "Region X" → USE ACTUAL NAMES FROM DATA
   - If you need top-N items, print and copy the EXACT strings:
     * top_products = df.groupby('product_name')['revenue'].sum().nlargest(10)
     * print(top_products)  # Copy these EXACT names

5. MULTIPLE FILES REQUIREMENT:
   - When given multiple files, you MUST load and analyze ALL files
   - Do NOT generate a dashboard from just one file when multiple are provided
   - Use pd.read_csv() on EACH file path provided

6. DATA VALIDATION:
   - Print all values that will go into the dashboard BEFORE generating JSON
   - Store computed values in variables and reference them
   - Example: total = df['amount'].sum(); print(f"Total: {total}")
   - For string data: print the actual values you will use as labels

✅ CORRECT FORMAT (Use This):
{
  "datasets": [
    {
      "label": "Monthly Revenue",
      "data": [
        {"label": "2022-03-31", "value": 101683.85},
        {"label": "2022-04-30", "value": 28838708.32}
      ]
    }
  ]
}

❌ WRONG FORMAT (DO NOT USE):
{
  "datasets": [
    {
      "label": "Revenue",
      "query": "SELECT month, SUM(amount) FROM data GROUP BY month"  ← FORBIDDEN
    }
  ]
}

LAYOUT RULES (MANDATORY):
=========================
Every component MUST have layout: {x, y, w, h, minW, minH}

Dashboard grid geometry:
- The dashboard grid is exactly 24 columns wide.
- x, y, w, h, minW, and minH MUST be finite integers.
- x >= 0 and y >= 0.
- 1 <= w <= 24 and 1 <= minW <= 24.
- w MUST be >= minW.
- x + w MUST be <= 24. Never place a component past the right edge.
- Components MUST NOT overlap. If a component cannot fit beside another
  component after applying minW, place it on the next row at x=0.
- For charts/tables with minW=12, place at most two on the same row.
- Metrics should usually use four cards at 6 columns each, or three cards at
  8 columns each.

Apply minimum height floors:
- Charts requiring minH=12: line, area, pie, donut, radial_bar, treemap, sankey
- Other charts minH=10: bar, scatter, composed, radar, funnel, geographic
- Tables: minH=10
- Metrics: minH=4

Ensure h >= minH for all components.

COLOR SYSTEM:
=============
Use semantic tokens in ALL styling objects (NOT hex/HSL except trendUp/trendDown):
- title-color: for titles
- description-color: for descriptions
- element-color: for axes, grids, borders
- highlight-color: for data elements and insights
- bg-card-color: for card backgrounds
- border-card-color: for card borders

Available Themes (use default unless a selected visual theme is provided):
- default: Clean monochrome, navy accent
- carbon: Very dark, blue accent
- slate: Dark blue-gray, cool blue accent
- chalk: Pure white/light, dark ink text
- warm: Warm off-white, rust/amber accent
- ash: Mid gray, neutral white accent
- sage: Desaturated dark green, muted sage accent
- ink: Near-black warm tint, amber/gold accent
- aurora: Deep indigo, violet/cyan accent
- glacier: Icy light, cyan-blue accent
- coral: Graphite dark, coral accent
- orchid: Dark plum, orchid pink accent
- mint: Soft mint light, emerald accent
- crimson: Dark slate, crimson accent
- cobalt: Deep cobalt, electric lime accent
- sandstone: Warm sand, terracotta accent

CRITICAL THEME REQUIREMENT:
- Use "default" for the entire dashboard unless a selected visual theme is explicitly provided in workflow context
- EVERY metric, chart, and table styling object MUST include "theme" field
- ALL cards MUST use the SAME theme value
- Example: If the selected workflow theme is "carbon", use {"theme": "carbon", "title": "title-color", ...}


OUTPUT FORMAT:
==============
Generate JSON with this EXACT structure:

```json
{
  "dashboard": {
    "title": "Dashboard Title",
    "description": "Dashboard description"
  },
  "metrics": [
    {
      "id": "metric_001",
      "title": "Total Revenue",
      "value": "$78,592,678.30",
      "change": "12.27%",
      "trend": "up",
      "related_chart_id": "chart_001",
      "sparkline_data": [
        {"label": "2022-03-31", "value": 101683.85},
        {"label": "2022-04-30", "value": 28838708.32}
      ],
      "layout": {"x": 0, "y": 0, "w": 6, "h": 4, "minW": 4, "minH": 4},
      "time_comparison": {
        "period": "mom",
        "current_value": 78592678.30,
        "previous_value": 70000000.00,
        "percentage_change": 12.27
      },
      "styling": {
        "theme": "default",
        "title": "title-color",
        "value": "highlight-color",
        "trendUp": "hsl(142 76% 36%)",
        "trendDown": "hsl(0 84% 60%)",
        "tile": {
          "background": "bg-card-color",
          "borderColor": "border-card-color",
          "borderWidth": 1,
          "borderRadius": 12
        }
      }
    }
  ],
  "charts": [
    {
      "id": "chart_001",
      "chart_type": "line",
      "title": "Monthly Revenue Over Time",
      "description": "Shows the trend of revenue.",
      "layout": {"x": 0, "y": 4, "w": 24, "h": 16, "minW": 12, "minH": 12},
      "datasets": [
        {
          "label": "Monthly Revenue",
          "data": [
            {"label": "2022-03-31", "value": 101683.85},
            {"label": "2022-04-30", "value": 28838708.32},
            {"label": "2022-05-31", "value": 35652884.13}
          ]
        }
      ],
      "config": {"animation": true, "showGrid": true, "showLegend": true},
      "styling": {
        "theme": "default",
        "title": "title-color",
        "description": "description-color",
        "cartesianGrid": "element-color/75",
        "xAxis": "element-color",
        "yAxis": "element-color",
        "legend": "highlight-color",
        "dataElements": "highlight-color",
        "tile": {
          "background": "bg-card-color",
          "borderColor": "border-card-color",
          "borderWidth": 1,
          "borderRadius": 12
        }
      },
      "reasoning": {"insight": "Revenue shows upward trend over time."}
    }
  ],
  "tables": [
    {
      "id": "table_001",
      "title": "Top Products",
      "description": "Best selling items",
      "layout": {"x": 0, "y": 20, "w": 24, "h": 10, "minW": 12, "minH": 10},
      "columns": [
        {"id": "col1", "label": "Product Name", "type": "text"},
        {"id": "col2", "label": "Revenue", "type": "currency"}
      ],
      "data": [
        {"col1": "Product A", "col2": 125000.50},
        {"col1": "Product B", "col2": 98500.25}
      ],
      "styling": {
        "theme": "default",
        "title": "title-color",
        "description": "description-color",
        "headerBackground": "highlight-color/10",
        "headerText": "title-color",
        "rowText": "element-color",
        "tile": {
          "background": "bg-card-color",
          "borderColor": "border-card-color",
          "borderWidth": 1,
          "borderRadius": 12
        }
      }
    }
  ],
  "insights": [
    "Revenue increased by 12.27% compared to last month",
    "Top performing category is Electronics with $25M"
  ],
  "data_quality": {
    "total_records": 128975,
    "completeness": 98.5,
    "duplicates": 12
  },
  "styling_recommendations": {
    "theme": "default",
    "colorPalette": [],
    "dashboardBackground": null
  }
}
```

CRITICAL OUTPUT RULES:
======================
1. Wrap JSON output in ```json code block
2. Include actual computed data in ALL datasets - NEVER empty arrays []
3. NO SQL queries or "query" fields - only embedded data values computed via Python
4. Apply semantic color tokens (not hex/HSL except for trendUp/trendDown)
5. Use the selected workflow theme if provided; otherwise use "default" consistently across all components
6. Transform table column names to human-readable format
7. All datasets[].data[] must contain objects with "label" and "value" keys
8. All numeric values must be actual numbers from your Python computations
9. Include layout (x, y, w, h, minW, minH) for every metric, chart, and table
10. Include styling_recommendations at root level with the chosen theme

TIME COMPARISON RULES:
======================
- "period" must be exactly one of: "dod" (day-over-day), "wow" (week-over-week),
  "mom" (month-over-month), "qoq" (quarter-over-quarter), "yoy" (year-over-year)
- Pick the period that matches what current_value vs previous_value actually compares:
  today vs yesterday → "dod" | this week vs prior week → "wow" | this month vs prior month → "mom"
- "value", "current_value", and "previous_value" MUST represent the same KPI at the same
  aggregation level. If "value" is a period sum, current_value/previous_value must also be
  period sums — NEVER mix a period total with a single-day figure.
- "change" MUST be a percentage string "X.XX%" — never use units like "pp", "pts", or custom suffixes.
  Percentage-point differences are still expressed as "X.XX%".

VALIDATION CHECKLIST (Before Output):
=====================================
✓ metrics[] with: id, title, value, change, trend, layout, styling (with theme)
✓ charts[] with: id, chart_type, title, layout, datasets, config, styling (with theme), reasoning
✓ tables[] with: id, title, layout, columns, data, styling (with theme)
✓ insights[] with at least 3 insight strings
✓ data_quality with: total_records, completeness, duplicates
✓ styling_recommendations with: theme (matches all component styling.theme values)
✓ ALL datasets contain actual computed data - NO empty arrays
✓ ALL table columns use human-readable names
✓ ALL styling objects include "theme" field with SAME value
✓ Layout h >= minH for all components
✓ Layout w >= minW for all components
✓ Layout x + w <= 24 for all components
✓ No dashboard components overlap
✓ time_comparison.period is one of: dod, wow, mom, qoq, yoy
✓ metric value and time_comparison current_value/previous_value use same aggregation level

If ANY field is missing, your response is INCOMPLETE.

REMEMBER:
=========
- You are in Dashboard Mode - ALWAYS output structured JSON as shown above
- You MUST use tools (Python_REPL and get_available_chart_types) BEFORE generating JSON
- Do NOT output JSON until you have inspected actual data and computed all values using tools
- Execute Python to compute ALL values, then embed the final numbers in the JSON
- NO query strings, NO SQL, NO placeholders - only final computed values from Python execution"""

ROUTER_SYSTEM_PROMPT = """You are a routing agent for a data analysis assistant. Your job is to analyze the user's request and conversation context to determine which workflow should handle the request.

CONTEXT VARIABLES:
- has_asset: {has_asset} (boolean) - Whether a data asset is attached to the conversation
- dashboard_count: {dashboard_count} (int) - Number of dashboards already created in this conversation

ROUTING RULES:
1. Route to 'dashboard' if the user:
   - Explicitly asks to create/build/generate a dashboard, report, reusable view, or overview
   - Requests multiple coordinated visuals, metrics, sections, or a broad exploratory dashboard
   - References an existing dashboard/chart for modification

2. Route to 'qa_visual' if the user asks a data-related question where a compact chart or table would help:
   - Trends over time, comparisons, rankings, distributions, outliers, top/bottom lists
   - Uses words like show, plot, chart, table, visualize, trend, compare, top, best, worst
   - Asks a focused analytical question that can be answered with 1-3 inline visuals
   - Tie-breaker: when data exists and the request is not clearly a dashboard, prefer qa_visual over qa

3. Route to 'qa' only if the user:
   - Asks a non-data/general question
   - Needs a clarification because data is missing or insufficient
   - Asks a simple scalar/calculation/explanation where a visual would add little value
   - Asks about capabilities or general questions

Remember: Bias toward 'qa_visual' for data questions. Use 'dashboard' only for saved/reusable multi-visual dashboard work."""


_DASHBOARD_REPAIR_RE = re.compile(
    r"("
    r"\b(fix|repair|wrong|incorrect|bug|broken|update|change|correct|same\s+(number|value)|metric\s+cards?)\b"
    r"|sai|giống\s+nhau|giong\s+nhau|không\s+đúng|khong\s+dung|sửa|sua"
    r")",
    re.IGNORECASE,
)


def _looks_like_dashboard_repair_request(prompt: str) -> bool:
    """Detect user requests that are about fixing an existing dashboard artifact."""
    return bool(_DASHBOARD_REPAIR_RE.search(prompt or ""))


def _file_has_at_least_one_data_row(file_path: str) -> bool:
    """Return False if the file is empty or contains only a header row (no data rows)."""
    ext = (os.path.splitext(file_path)[1] or "").lower()
    try:
        if ext in (".csv", ".txt"):
            with open(file_path, newline="", encoding="utf-8", errors="replace") as f:
                reader = csv.reader(f)
                next(reader, None)  # header row (if any)
                return next(reader, None) is not None
        if ext in (".xlsx", ".xls"):
            import pandas as pd

            df = pd.read_excel(file_path, nrows=1)
            return len(df) > 0
    except Exception as e:
        logger.warning(f"[START] Could not check row count for {file_path}: {e}")
        return True
    return True


def node_start(state: AgentState, **kwargs) -> AgentState:
    """
    START Node: Initialize and validate user state.

    This node validates that the workflow has all necessary context
    and logs the workflow initialization.

    Args:
        state: Current agent state
        **kwargs: Additional arguments (unused)

    Returns:
        Updated agent state
    """
    logger.info(
        f"Starting workflow for conversation {state.conversation_id}, "
        f"user {state.user_state.user_id}, project {state.user_state.project_id}"
    )

    # Log context summary
    logger.info(
        f"Context: {len(state.user_state.user_assets)} assets, "
        f"{len(state.user_state.dashboards)} dashboards, "
        f"{len(state.user_state.conversation_history)} conversation nodes"
    )

    # Validate file paths if provided
    if state.file_paths:
        logger.info(f"Files to analyze: {len(state.file_paths)}")
        for idx, fp in enumerate(state.file_paths):
            file_exists = os.path.exists(fp)
            logger.info(f"  File {idx + 1}: {fp} (exists: {file_exists})")

        existing = [fp for fp in state.file_paths if os.path.exists(fp)]
        if existing and all(not _file_has_at_least_one_data_row(fp) for fp in existing):
            msg = (
                "The attached file(s) contain column headers but **no data rows**, so there is nothing to chart or "
                "summarize. If this came from Meta Ads, try a wider date range or confirm the ad account has "
                "campaign activity in that period. Upload a CSV with at least one data row to run analysis."
            )
            logger.info(
                "[START] All input files are header-only / empty — short-circuiting to Q&A message"
            )
            state.working_memory.tool_outputs["early_exit_empty_data"] = True
            state.working_memory.tool_outputs["route_decision"] = {
                "next_step": "qa",
                "reasoning": "No data rows in CSV inputs",
            }
            state.working_memory.qa_response = msg
            state.output = {"type": "message", "content": msg}

    return state


def _deterministic_profile(assets_dict: dict) -> str:
    """
    Profile every file with pandas only — no LLM, no merge-strategy planning.

    Produces accurate column/dtype/stats context per file so the REASONING node
    receives real data instead of hallucinating. Used for single-file inputs and
    for the pure-text Q&A route, where the upfront LLM merge loop adds no value
    (REASONING still has Python_REPL for any cross-file math a text answer needs).
    """
    import pandas as pd

    sections = []
    for filename, filepath in assets_dict.items():
        try:
            df = pd.read_csv(filepath)
            rows, cols = df.shape
            lines = [
                f"File: {filename} ({rows:,} rows × {cols} columns)",
                f"Columns: {', '.join(f'{c} ({df[c].dtype})' for c in df.columns)}",
            ]

            # Numeric summary
            num_cols = df.select_dtypes(include="number").columns.tolist()
            if num_cols:
                desc = df[num_cols].describe()
                lines.append("Numeric summary (min / mean / max):")
                for c in num_cols:
                    mn = desc.loc["min", c]
                    av = desc.loc["mean", c]
                    mx = desc.loc["max", c]
                    lines.append(f"  {c}: min={mn:.2f}, mean={av:.2f}, max={mx:.2f}")

            # Date/string columns — unique value count
            other_cols = [c for c in df.columns if c not in num_cols]
            for c in other_cols:
                lines.append(
                    f"  {c}: {df[c].nunique()} unique values, sample={df[c].iloc[0]}"
                )

            # 3-row sample
            lines.append("Sample rows (first 3):")
            lines.append(df.head(3).to_string(index=False))

            sections.append("\n".join(lines))
        except Exception as exc:
            logger.warning("Profiler failed for %s: %s", filename, exc)
            sections.append(f"File: {filename} (profiling failed: {exc})")

    return "\n\n".join(sections)


def node_explore_files(state: AgentState, model=None, **kwargs) -> AgentState:
    """
    EXPLORE_FILES Node: Data Profiler & Merge Strategist.

    This node profiles all available datasets and, when multiple files exist
    AND the route benefits from it, analyzes their relationships to propose a
    concrete merge/join strategy. The merge strategy is stored in
    state.data_profile so the downstream reasoning node can act on it.
    """
    logger.info("Running EXPLORE_FILES node")

    if not state.assets_dict:
        logger.info("No assets to explore. Proceeding to REASONING.")
        return state

    route = (state.working_memory.tool_outputs.get("route_decision") or {}).get(
        "next_step"
    )

    # Deterministic-only path: single file, or a pure-text Q&A answer. Both skip
    # the expensive multi-file LLM merge loop that only the visual/dashboard
    # routes benefit from.
    if len(state.assets_dict) == 1 or route == "qa":
        state.data_profile = _deterministic_profile(state.assets_dict)
        logger.info(
            "Deterministic profile generated (%d file(s), route=%s)",
            len(state.assets_dict),
            route,
        )
        return state

    try:
        python_tool = PythonREPLTool()

        # INJECT locals/globals into the REPL environment
        if hasattr(python_tool.python_repl, "globals") and isinstance(
            python_tool.python_repl.globals, dict
        ):
            python_tool.python_repl.globals["file_paths"] = state.assets_dict
        elif hasattr(python_tool.python_repl, "locals") and isinstance(
            python_tool.python_repl.locals, dict
        ):
            python_tool.python_repl.locals["file_paths"] = state.assets_dict

        if model is None:
            model = get_model_for_quick_agent()

        has_multiple_files = len(state.assets_dict) > 1
        user_prompt = state.input_prompt or ""

        # Build merge-aware profiler prompt
        merge_section = ""
        if has_multiple_files:
            user_guidance_section = ""
            if user_prompt.strip():
                user_guidance_section = f"""
**USER'S REQUEST (may contain merge/join guidance):**
\"{user_prompt}\"
If the user mentions how to combine, merge, or join the files, prioritize their instructions when proposing the merge strategy."""

            merge_section = f"""
--- PHASE 2: MERGE STRATEGY (MULTI-FILE ONLY) ---
After profiling ALL files, you MUST analyze how these datasets relate and can be merged.

{user_guidance_section}

Use the Python_REPL tool to investigate:
1. **Common columns**: Find columns that exist in multiple files (same name or similar name).
2. **Key candidates**: For each pair of files, identify potential join keys by comparing column names, dtypes, and sample values.
3. **Value overlap**: For candidate join keys, check the overlap of unique values between files (e.g., how many IDs from file A exist in file B).
4. **Merge recommendation**: Based on the above, propose the best merge strategy.

**OUTPUT for Phase 2 — include a section titled "=== MERGE STRATEGY ===" with:**
- Which files should be merged and in what order
- Join type (inner, left, right, outer) and why
- Join key column(s) for each merge step
- Ready-to-use pandas code snippet (e.g., `pd.merge(df1, df2, on='column', how='left')`)
- If files are NOT related (no common keys), state that clearly and recommend analyzing them separately
- Any data preparation needed before merging (e.g., renaming columns, type casting)
"""

        profiler_prompt = f"""You are the 'Data Profiler & Merge Strategist', an expert data scientist.
Your objective is to explore, profile, and analyze the relationships between the user's datasets.

You have access to a Python_REPL tool.
The variable `file_paths` is ALREADY defined in your Python environment as a dictionary mapping filenames to local file paths.

🚨 CRITICAL RULES:
- NEVER redefine or reassign `file_paths`. It is already set for you.
- NEVER hardcode file paths. Always use `file_paths[key]` to get the path.
- Start your code with `for name, path in file_paths.items():` to iterate.

--- PHASE 1: DATA PROFILING ---
1. Use the Python_REPL tool to iterate through the `file_paths` dictionary.
2. For EACH file, load it using pandas (`pd.read_csv(path)`) and extract:
   - File Name
   - File Size (in MB — use os.path.getsize)
   - DataFrame Shape (rows × columns)
   - Column Names and Data Types (dtypes)
   - First 3 rows (df.head(3))
   - Missing values (Null/NaN) count per column
3. **Constraint:** Do NOT print the entire dataframe. Use `.head(3)` or `.info()` only.
{merge_section}
--- FINAL OUTPUT ---
Provide a structured summary containing:
1. **Data Profile Summary** for each file (from Phase 1)
{"2. **Merge Strategy** section with concrete join plan and pandas code (from Phase 2)" if has_multiple_files else ""}

Ensure the format is clear and actionable for the next reasoning agent."""

        # Pre-run: show LLM the actual file_paths so it doesn't hallucinate paths
        actual_paths_output = python_tool.run("print(file_paths)")
        logger.info(f"[Data Profiler] Actual file_paths: {actual_paths_output}")

        model_with_tools = model.bind_tools([python_tool])
        messages = [
            SystemMessage(content=profiler_prompt),
            HumanMessage(
                content=f"The `file_paths` variable is already loaded in your Python environment with these files:\n{actual_paths_output}\n\n"
                f"Please profile all datasets and produce the summary"
                + (" with merge strategy." if has_multiple_files else ".")
                + "\n\nRemember: do NOT redefine `file_paths`. Just use it directly."
            ),
        ]

        logger.info(
            "Calling Data Profiler LLM to explore files"
            + (" (with merge analysis)" if has_multiple_files else "")
            + "."
        )

        # Allow more turns for multi-file merge analysis
        max_turns = 18 if has_multiple_files else 15
        tool_executed = False
        for turn in range(max_turns):
            response = _llm_invoke(
                model_with_tools.invoke,
                messages,
                label=f"Data Profiler turn {turn + 1}",
            )
            _update_usage(state, response)
            if isinstance(response.content, list):
                response.content = "\n".join(
                    item.get("text", "") if isinstance(item, dict) else str(item)
                    for item in response.content
                )

            messages.append(response)

            if response.tool_calls and len(response.tool_calls) > 0:
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    tool_call_id = tool_call["id"]

                    if tool_name.lower() == "python_repl":
                        query = tool_args.get("query", "")
                        logger.info(f"[Data Profiler] Executing Python code:\n{query}")
                        result = python_tool.run(query)
                        tool_executed = True
                        result_str = str(result)
                        preview = (
                            result_str[:300] + "...\n[Output truncated]"
                            if len(result_str) > 300
                            else result_str
                        )
                        logger.info(
                            f"[Data Profiler] Execution result preview:\n{preview}"
                        )
                    elif tool_name.lower() == "get_available_chart_types":
                        logger.info(
                            "[Data Profiler] Tool check: get_available_chart_types"
                        )
                        result = get_available_chart_types.invoke({})
                    else:
                        logger.warning(
                            f"[Data Profiler] Tool error: Unknown tool '{tool_name}'. Redirecting model to Python_REPL."
                        )
                        result = (
                            f"ERROR: Tool '{tool_name}' does not exist in this environment. "
                            "You have ONLY TWO tools available: 'Python_REPL' (to run Python code) "
                            "and 'get_available_chart_types'. "
                            "STOP calling any other tool. Use 'Python_REPL' with a 'query' parameter to execute code."
                        )

                    tool_msg = ToolMessage(
                        content=str(result), tool_call_id=tool_call_id
                    )
                    messages.append(tool_msg)
            else:
                if not tool_executed:
                    # LLM tried to respond without running any code — force it to use the tool
                    logger.warning(
                        f"[Data Profiler] Turn {turn + 1}: LLM skipped tool usage. Nudging to use Python_REPL."
                    )
                    messages.append(
                        HumanMessage(
                            content="You MUST use the Python_REPL tool to actually load and inspect the files. "
                            "Do not summarize without executing code first. "
                            "Call Python_REPL now to profile the datasets."
                        )
                    )
                    continue

                state.data_profile = str(response.content)
                # Log merge strategy if present, otherwise brief summary
                content_str = str(response.content)
                if "=== MERGE STRATEGY ===" in content_str:
                    merge_part = content_str[
                        content_str.index("=== MERGE STRATEGY ===") :
                    ]
                    logger.info(
                        f"[Data Profiler] Data exploration complete.\nMerge Strategy:\n{merge_part}"
                    )
                else:
                    logger.info(
                        f"[Data Profiler] Data exploration complete. (No merge strategy — single file or unrelated datasets)"
                    )
                break

    except Exception as e:
        logger.error(f"Error exploring files: {str(e)}")
        state.data_profile = f"Exploration failed: {str(e)}"

    return state


def node_ask_first(state: AgentState, **kwargs) -> AgentState:
    """
    ASK_FIRST Node: Pause for high-impact user decisions before routing.

    This node is deterministic by design. It only emits a clarification when
    the next workflow step would otherwise require a risky guess.
    """
    logger.info("Running ASK_FIRST node")
    clarifications = build_workflow_clarifications(
        conversation={
            "nodes": state.user_state.conversation_history,
            "dashboards": state.user_state.dashboards,
        },
        user_prompt=state.input_prompt or "",
        user_assets=state.user_state.user_assets,
        dashboards=state.user_state.dashboards,
        file_paths=state.file_paths,
        assets_dict=state.assets_dict,
        data_profile=state.data_profile,
        chart_mentions=state.chart_mentions,
    )
    if not clarifications:
        logger.info("ASK_FIRST found no clarification need")
        return state

    state.output = {
        "type": "clarification_request",
        "clarifications": clarifications,
    }
    state.working_memory.tool_outputs["ask_first"] = {
        "reason_codes": [c.get("reason_code") for c in clarifications],
        "clarification_ids": [c.get("clarification_id") for c in clarifications],
    }
    logger.info(
        "ASK_FIRST produced %d clarification(s): %s",
        len(clarifications),
        [c.get("reason_code") for c in clarifications],
    )
    return state


def node_routing(state: AgentState, model=None, **kwargs) -> AgentState:
    """
    ROUTING Node: Decide workflow type (dashboard or qa).

    Uses Router Agent to analyze user intent and conversation context
    to determine whether to run dashboard generation or Q&A workflow.
    If chart_mentions are present, short-circuit to chart modification mode.

    Args:
        state: Current agent state
        model: LLM model for routing (optional, will create if not provided)
        **kwargs: Additional arguments

    Returns:
        Updated agent state with routing decision in working_memory
    """
    logger.info("Running ROUTING node")

    has_asset = len(state.user_state.user_assets) > 0
    dashboard_count = len(state.user_state.dashboards)
    clarification_metadata = latest_clarification_metadata(
        {"nodes": state.user_state.conversation_history}
    )
    target_chart_id = str(clarification_metadata.get("target_chart_id") or "").strip()
    if target_chart_id:
        target = next(
            (
                chart
                for chart in extract_dashboard_targets(state.user_state.dashboards)
                if str(chart.get("id")) == target_chart_id
                or str(chart.get("component_id")) == target_chart_id
            ),
            None,
        )
        if target:
            target_dashboard_id = clarification_metadata.get(
                "target_dashboard_id"
            ) or target.get("dashboard_id")
            state.chart_mentions = [
                {
                    "component_id": target.get("component_id") or target_chart_id,
                    "chart_id": target.get("id") or target_chart_id,
                    "dashboard_id": target_dashboard_id,
                    "title": target.get("title"),
                    "chart_type": target.get("type"),
                    "config": target.get("config"),
                }
            ]
            logger.info(
                "Routing chart target selected via clarification: %s", target_chart_id
            )
            state.working_memory.tool_outputs["route_decision"] = {
                "next_step": "dashboard",
                "reasoning": "User selected a target chart in ask-first clarification.",
                "is_chart_modification": True,
                "from_clarification": True,
            }
            return state

    route_mode = clarification_metadata.get("route_mode")
    if route_mode in {"dashboard", "qa", "qa_visual"}:
        logger.info("Routing mode selected via clarification: %s", route_mode)
        state.working_memory.tool_outputs["route_decision"] = {
            "next_step": route_mode,
            "reasoning": "User selected this output mode in ask-first clarification.",
            "from_clarification": True,
        }
        return state

    # Short-circuit: If user @mentioned a chart, force chart modification mode
    if state.chart_mentions:
        chart_titles = [cm.get("title", "Unknown") for cm in state.chart_mentions]
        logger.info(f"Chart modification requested via @chart mention: {chart_titles}")
        state.working_memory.tool_outputs["route_decision"] = {
            "next_step": "dashboard",
            "reasoning": f"Chart modification requested via @chart mention for: {', '.join(chart_titles)}",
            "is_chart_modification": True,
        }
        return state

    if dashboard_count > 0 and _looks_like_dashboard_repair_request(state.input_prompt):
        logger.info("Dashboard repair requested against an existing dashboard")
        state.working_memory.tool_outputs["route_decision"] = {
            "next_step": "dashboard",
            "reasoning": "User is reporting/fixing an existing dashboard, so generate a corrected dashboard artifact.",
            "is_dashboard_repair": True,
        }
        return state

    # Get or create model
    if model is None:
        model = get_model_for_quick_agent()

    # Format router system prompt with context
    router_prompt = ROUTER_SYSTEM_PROMPT.format(
        has_asset=has_asset, dashboard_count=dashboard_count
    )

    # Build router messages
    router_messages = [SystemMessage(content=router_prompt)]

    # Add recent conversation history (last 10 nodes)
    recent_history = (
        state.user_state.conversation_history[-10:]
        if len(state.user_state.conversation_history) > 10
        else state.user_state.conversation_history
    )

    for node in recent_history:
        role = node.get("role", "").lower()
        content_text = _render_node_contents(node, state.user_state.dashboards)

        if role == "user" and content_text:
            router_messages.append(HumanMessage(content=content_text))
        elif role == "assistant" and content_text:
            router_messages.append(AIMessage(content=content_text))

    # Add current user prompt
    router_messages.append(
        HumanMessage(content=f"Current user request: {state.input_prompt}")
    )

    # Call router model
    try:
        from morpheus.workflows.analyze_csv.state_models import RouteDecision

        # Try structured output first
        try:
            router_model = model.with_structured_output(RouteDecision)
            route_decision = _llm_invoke(
                router_model.invoke, router_messages, label="Router structured output"
            )
            _update_usage(state, route_decision)
            next_step = route_decision.next_step
            reasoning = route_decision.reasoning
        except Exception as e:
            logger.warning(f"Structured output failed, using fallback: {str(e)}")
            # Fallback: parse from response
            response = _llm_invoke(
                model.invoke, router_messages, label="Router fallback"
            )
            _update_usage(state, response)
            content = str(response.content) if response.content else ""

            # Try to extract decision from content
            if "dashboard" in content.lower():
                next_step = "dashboard"
                reasoning = "Fallback routing based on content analysis"
            elif "qa_visual" in content.lower() or "visual" in content.lower():
                next_step = "qa_visual"
                reasoning = "Fallback routing based on content analysis"
            elif "qa" in content.lower():
                next_step = "qa"
                reasoning = "Fallback routing based on content analysis"
            else:
                next_step = "qa_visual" if has_asset else "qa"
                reasoning = "Default fallback routing"

    except Exception as e:
        logger.error(f"Router error: {str(e)}, defaulting based on asset availability")
        next_step = "qa_visual" if has_asset else "qa"
        reasoning = f"Error fallback: {str(e)}"

    # Store decision in working memory
    state.working_memory.tool_outputs["route_decision"] = {
        "next_step": next_step,
        "reasoning": reasoning,
    }

    logger.info(f"Routing decision: {next_step} - {reasoning}")

    return state


def node_reasoning(
    state: AgentState, model=None, model_with_tools=None, **kwargs
) -> AgentState:
    """
    REASONING Node: Agent decides next action based on current state.

    The agent analyzes the current state and working memory to decide
    what action to take next. This is the "brain" of the workflow.

    Args:
        state: Current agent state
        model: Base LLM model (optional)
        model_with_tools: LLM model with tools bound (optional)
        **kwargs: Additional arguments

    Returns:
        Updated agent state with pending action in working_memory
    """
    logger.info(f"Running REASONING node (iteration {state.iteration})")
    thinking_event_fn = kwargs.get("thinking_event_fn")

    # Get or create model
    if model is None:
        model = get_model_for_agent()
    if model_with_tools is None:
        python_tool = PythonREPLTool()
        tools = [python_tool, get_available_chart_types]
        model_with_tools = model.bind_tools(tools)

    # Get route decision
    route_decision = state.working_memory.tool_outputs.get("route_decision", {})
    mode = route_decision.get("next_step", "dashboard")

    # Coarse chart-edit progress: announce that we're analyzing the target chart
    # before any REPL runs. Only for chart-modification runs.
    if thinking_event_fn and route_decision.get("is_chart_modification"):
        chart_id = None
        if state.chart_mentions:
            chart_id = state.chart_mentions[0].get("chart_id")
        try:
            thinking_event_fn(
                phase="analyzing",
                title="Analyzing the chart you mentioned",
                metadata={
                    "step": "analyzing",
                    "is_chart_modification": True,
                    "chart_id": chart_id,
                },
            )
        except Exception as exc:
            logger.warning(f"Failed to emit analyzing thinking event: {exc}")

    # Select system prompt based on mode
    if mode == "dashboard":
        base_prompt = DASHBOARD_SYSTEM_PROMPT
    elif mode == "qa_visual":
        base_prompt = QA_VISUAL_SYSTEM_PROMPT
    else:
        base_prompt = QA_SYSTEM_PROMPT

    # Format state context for prompt (will be implemented in helpers.py)
    # For now, use basic context
    state_context = _format_state_for_prompt_basic(state)

    # Build system prompt with state context
    system_prompt = f"""{base_prompt}

{state_context}

Based on the above context, decide your next action."""

    # Build message history
    messages = [SystemMessage(content=system_prompt)]

    # Add file path instruction if available
    if state.file_paths:
        # Filter to valid, non-placeholder files
        valid_files = [
            fp
            for fp in state.file_paths
            if fp and os.path.exists(fp) and "qa_" not in fp
        ]

        if valid_files:
            file_info = ""

            # Inject Data Profile from EXPLORE_FILES node if available
            if state.data_profile:
                file_info += f"=== DATASET PROFILES ===\n{state.data_profile}\n========================\n\n"

            if len(valid_files) == 1:
                # Single file - backward compatible prompt
                file_info += f"CSV file available at: {valid_files[0]}"
            else:
                # Multiple files - enhanced prompt with all file paths
                files_list = "\n".join(
                    [f"- File {i+1}: {fp}" for i, fp in enumerate(valid_files)]
                )
                file_info += f"""Multiple CSV files available for analysis:
{files_list}

Load ALL files and combine/analyze as needed for the user's request. You can use pandas to merge, concatenate, or analyze files together."""

            file_info += "\n\nCRITICAL: When writing Python code, load the files using the paths pre-loaded in the `file_paths` dictionary object in your environment (e.g. `file_paths['users.csv']`)."

            # Check if this is a chart modification request
            is_chart_mod = route_decision.get("is_chart_modification", False)

            if (
                is_chart_mod
                and state.chart_mentions
                and _mention_is_table(state.chart_mentions[0])
            ):
                # Table modification mode — recompute rows and emit a table.
                instruction = _build_table_mod_instruction(
                    state.chart_mentions[0], state.input_prompt, file_info
                )
            elif is_chart_mod and state.chart_mentions:
                # Chart modification mode — inject target chart context
                chart_info = state.chart_mentions[0]
                existing_config = chart_info.get("config", {})
                existing_config_json = json.dumps(
                    existing_config, ensure_ascii=False, indent=2
                )
                chart_id = chart_info.get("chart_id", "chart_modified")

                # Try to identify which dataset columns the chart uses
                chart_columns_hint = ""
                if existing_config.get("axisConfig"):
                    ax = existing_config["axisConfig"]
                    cols = []
                    if ax.get("x_axis", {}).get("column"):
                        cols.append(ax["x_axis"]["column"])
                    if ax.get("y_axis", {}).get("column"):
                        cols.append(ax["y_axis"]["column"])
                    if cols:
                        chart_columns_hint = (
                            f"\nThis chart uses columns: {', '.join(cols)}"
                        )
                elif existing_config.get("datasets"):
                    # Extract labels from existing datasets
                    ds_labels = [
                        ds.get("label", "")
                        for ds in existing_config.get("datasets", [])
                    ]
                    if ds_labels:
                        chart_columns_hint = (
                            f"\nThis chart uses datasets: {', '.join(ds_labels)}"
                        )

                instruction = f"""User wants to MODIFY an existing chart in their dashboard.

TARGET CHART TO MODIFY:
- Chart ID: {chart_id}
- Title: {chart_info.get('title', 'Untitled')}
- Current Type: {chart_info.get('chart_type', 'unknown')}{chart_columns_hint}
- Current Config:
```json
{existing_config_json}
```

User's modification request: {state.input_prompt}

{file_info}

IMPORTANT SCOPE RULE: You are modifying ONLY this one chart. If multiple files are available,
use ONLY the file that contains the data relevant to this chart (check column names from the chart config above).
Do NOT combine data from unrelated files.

WORKFLOW:
1. First, use Python REPL to load the relevant CSV file and analyze the data for this chart.
2. Then output a dashboard JSON with ONLY the modified chart.

You MUST output a valid JSON code block in this EXACT format:

```json
{{
  "dashboard": {{
    "title": "Chart Modification",
    "description": "Modified chart per user request"
  }},
  "metrics": [],
  "charts": [
    {{
      "id": "{chart_id}",
      "chart_type": "<new_or_same_type>",
      "title": "<chart_title>",
      "description": "<chart_description>",
      "layout": {{"x": 0, "y": 0, "w": 24, "h": 12, "minW": 12, "minH": 10}},
      "datasets": [
        {{
          "label": "<dataset_label>",
          "data": [
            {{"label": "<data_label>", "value": <computed_value>}}
          ]
        }}
      ],
      "config": {{"animation": true, "showGrid": true, "showLegend": true}},
      "styling": {{"theme": "default", "title": "title-color", "description": "description-color", "cartesianGrid": "element-color/75", "xAxis": "element-color", "yAxis": "element-color", "legend": "highlight-color", "dataElements": "highlight-color", "tile": {{"background": "bg-card-color", "borderColor": "border-card-color", "borderWidth": 1, "borderRadius": 12}}}}
    }}
  ],
  "tables": [],
  "insights": ["<insight about the modification>"]
}}
```

CRITICAL RULES:
- Keep chart ID as "{chart_id}"
- Populate datasets with REAL computed data from Python analysis (never empty arrays)
- EVERY series/dataset MUST have a non-empty `data` array. If the edit ADDS series
  (e.g. daily/weekly/monthly variants, or any new breakdown), you MUST load the source
  file and COMPUTE each one in the Python REPL — e.g. parse the date column and
  `df.set_index(<date>).resample('D'|'W'|'M').sum()` — then fill each dataset's `data`
  with the resulting {{"label": ..., "value": ...}} points. A chart with empty data will be REJECTED.
- Output ONLY the modified chart in "charts" array. Other dashboard components will be preserved automatically.
- You MUST output the JSON code block — do NOT just describe the changes in text."""
            elif mode == "dashboard":
                if route_decision.get("is_dashboard_repair", False):
                    latest_dashboard_id = None
                    latest_dashboard = None
                    if state.user_state.dashboards:
                        latest_dashboard_id, latest_dashboard = list(
                            state.user_state.dashboards.items()
                        )[-1]
                    existing_dashboard_context = (
                        json.dumps(latest_dashboard, ensure_ascii=False, indent=2)
                        if latest_dashboard
                        else "{}"
                    )
                    instruction = f"""User is asking to REPAIR an existing dashboard artifact, not just answer a question.

User's repair request: {state.input_prompt}

Existing dashboard ID: {latest_dashboard_id or "unknown"}
Existing dashboard JSON:
```json
{existing_dashboard_context}
```

{file_info}

REPAIR WORKFLOW:
1. Use Python_REPL to reload the selected data and recompute the affected values.
2. Generate a COMPLETE replacement dashboard JSON, preserving existing layout/styling where reasonable.
3. Metric cards must use the correct metric-specific values. If multiple metrics share one related chart, do not copy the first dataset into every metric; match each metric to its own column/dataset.
4. For ambiguous metric names like A1, A3, A7, use the latest value unless the metric title explicitly says total, sum, average, avg, or mean.

CRITICAL: You MUST output a dashboard JSON code block. Do NOT answer with text only, and do NOT stop after saying the data was reloaded or analyzed."""
                else:
                    instruction = f"User wants to: {state.input_prompt}\n\n{file_info}"
            elif mode == "qa_visual":
                instruction = f"User asks a focused data question that should be answered with text plus inline chart/table artifact(s): {state.input_prompt}\n\n{file_info}"
            else:
                instruction = f"User question: {state.input_prompt}\n\n{file_info}"

            messages.append(HumanMessage(content=instruction))
        else:
            # Q&A mode with no real data file (placeholder only) — use the raw query
            if state.input_prompt:
                messages.append(HumanMessage(content=state.input_prompt))
    elif state.input_prompt:
        # No file_paths at all — pure Q&A
        messages.append(HumanMessage(content=state.input_prompt))

    # 🔥 FIX: Build conversation history from previous tool executions
    # This is crucial to prevent the agent from having "amnesia" and repeating the same actions
    conversation_history = _build_conversation_history_from_executions(state)
    messages.extend(conversation_history)

    # 🔥 ANTI-HALLUCINATION: If we previously flagged insufficient tool usage, add reminder
    force_more_tools_msg = state.working_memory.tool_outputs.get("force_more_tools")
    if force_more_tools_msg:
        messages.append(HumanMessage(content=force_more_tools_msg))
        # Clear the flag after adding to prevent repeated additions
        state.working_memory.tool_outputs.pop("force_more_tools", None)

    # 🔥 DATA GROUNDING: If we have tool executions and in dashboard mode, add grounding reminder
    if (
        mode in ("dashboard", "qa_visual")
        and len(state.working_memory.python_execution_results) >= 1
    ):
        grounding_reminder = """
REMINDER: When you generate your JSON:
- Use ONLY values that came from your Python analysis above
- Every number must be traceable to a print() statement you executed
- If you did not compute a value with Python, do NOT include it in the output"""
        messages.append(HumanMessage(content=grounding_reminder))

    # Call LLM
    try:
        response = _llm_invoke(
            model_with_tools.invoke, messages, label="Reasoning node"
        )
        _update_usage(state, response)
        # Normalize response.content to string (Gemini returns a list)
        if isinstance(response.content, list):
            response.content = "\n".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in response.content
            )

        # Parse response for action decision
        if response.tool_calls and len(response.tool_calls) > 0:
            # Agent wants to use a tool
            first_tool_call = response.tool_calls[0]
            action_request = ActionRequest(
                action_type="EXECUTE_TOOL",
                tool_name=first_tool_call["name"],
                arguments=first_tool_call["args"],
                reasoning=(
                    str(response.content) if response.content else "Tool execution"
                ),
            )

            # Store all tool calls for execution
            state.working_memory.tool_outputs["pending_tool_calls"] = (
                response.tool_calls
            )

            # 🔥 FIX: Also capture content if present alongside tool calls
            # Some LLMs return both tool calls AND content (the final answer)
            # We store this as a "pending_qa_response" to be used if no more tool calls come
            if response.content and len(str(response.content).strip()) > 20:
                logger.info(
                    f"LLM returned content alongside tool call, storing as pending response: {str(response.content)[:50]}..."
                )
                state.working_memory.tool_outputs["pending_qa_response"] = str(
                    response.content
                )

        elif response.content:
            # Agent provided final output - proceed with finish
            action_request = ActionRequest(
                action_type="FINISH",
                reasoning="Agent provided final output",
            )

            # Store output in working memory
            if mode == "dashboard":
                is_chart_mod = route_decision.get("is_chart_modification", False)

                if is_chart_mod:
                    # Chart-mod path: force the FINAL emission through provider
                    # structured output on the base (un-tool-bound) model, with
                    # regex + targeted repair as fallbacks. Returns None to
                    # defer to the existing retry loop.
                    quick_model = kwargs.get("quick_model")
                    json_data = _finalize_chart_mod_emission(
                        state, model, quick_model, messages, response.content
                    )
                else:
                    # Full-dashboard path — unchanged regex extraction.
                    json_data = _extract_json_from_content(response.content)

                if json_data:
                    # Store JSON for validation in node_validation
                    state.working_memory.dashboard_json = json_data

                    # Generate summary with simple LLM call
                    try:
                        summary = _generate_summary_for_dashboard(
                            model, json_data, state.input_prompt
                        )
                        state.working_memory.dashboard_summary = summary
                        logger.info(f"Generated summary: {summary[:50]}...")
                    except Exception as e:
                        logger.warning(
                            f"Failed to generate summary: {e}, using default"
                        )
                        charts_count = len(json_data.get("charts", []))
                        metrics_count = len(json_data.get("metrics", []))
                        state.working_memory.dashboard_summary = (
                            f"I've created a dashboard with {charts_count} chart(s) and {metrics_count} metric(s) "
                            f"based on your data analysis request."
                        )
                else:
                    # No JSON found - text response
                    logger.info("No JSON found in dashboard mode, treating as Q&A")
                    state.working_memory.qa_response = str(response.content)
            elif mode == "qa_visual":
                visual_payload = _extract_qa_visual_from_content(str(response.content))
                if visual_payload:
                    state.working_memory.qa_response = visual_payload.get("answer", "")
                    state.working_memory.visual_artifacts = visual_payload.get(
                        "artifacts", []
                    )
                else:
                    logger.info("No QA visual JSON found, treating as text Q&A")
                    state.working_memory.qa_response = str(response.content)
            else:
                state.working_memory.qa_response = str(response.content)

        else:
            # Empty response - check if we have a pending Q&A response from a previous tool call
            pending_qa = state.working_memory.tool_outputs.get("pending_qa_response")

            if pending_qa:
                # We have content from a previous iteration - use it as the final answer
                logger.info(
                    f"Using pending Q&A response as final answer: {pending_qa[:50]}..."
                )
                action_request = ActionRequest(
                    action_type="FINISH",
                    reasoning="Using content captured from previous tool call response",
                )
                state.working_memory.qa_response = pending_qa
                # Clear the pending response
                state.working_memory.tool_outputs.pop("pending_qa_response", None)
            else:
                # No pending response - force retry with first available file
                logger.warning(
                    "Empty response from model in REASONING node - forcing retry"
                )

                # Build retry query for all files
                retry_file = state.file_path if state.file_path else "unknown"
                retry_query = f"""# Retry: Load and analyze data file(s)
import pandas as pd

# Load primary file
df = pd.read_csv('{retry_file}')
print("File loaded:", '{retry_file}')
print(df.head())
print(df.info())
print(df.columns.tolist())"""

                action_request = ActionRequest(
                    action_type="EXECUTE_TOOL",
                    tool_name="python_repl",
                    arguments={"query": retry_query},
                    reasoning="Model returned empty response, retrying with data load...",
                )

                # Create a dummy tool call for execution
                state.working_memory.tool_outputs["pending_tool_calls"] = [
                    {
                        "name": "python_repl",
                        "args": {"query": retry_query},
                        "id": f"retry_{state.iteration}",
                    }
                ]

        # Store pending action
        state.working_memory.tool_outputs["pending_action"] = action_request.dict()

        logger.info(
            f"Agent decided: {action_request.action_type} - {action_request.reasoning}"
        )

    except Exception as e:
        error_str = str(e)
        logger.error(f"Error in REASONING node: {error_str}")
        if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
            state.working_memory.rate_limit_hits += 1
            if state.working_memory.rate_limit_hits >= 3:
                # Daily quota likely exhausted; fail fast with a clear message
                logger.error(
                    "REASONING: 3 consecutive 429s — quota exhausted, aborting"
                )
                state.working_memory.qa_response = (
                    "⚠️ The AI model hit its rate limit (quota exhausted). "
                    "Please try again later or contact support to upgrade your API quota."
                )
                # Set FINISH action so edges route to SYNTHESIS, not EXECUTION
                state.working_memory.tool_outputs["pending_action"] = {
                    "action_type": "FINISH",
                    "reasoning": "Aborting due to quota exhaustion",
                }
            else:
                delay_match = re.search(r"retryDelay[\"':\s]+(\d+)s", error_str)
                delay_s = int(delay_match.group(1)) if delay_match else 60
                delay_s = max(10, min(delay_s, 120))
                logger.warning(
                    f"REASONING: rate limit (429) hit #{state.working_memory.rate_limit_hits}, sleeping {delay_s}s"
                )
                time.sleep(delay_s)
        else:
            state.working_memory.rate_limit_hits = 0
        state.working_memory.errors.append(
            {
                "node": "REASONING",
                "error": error_str,
                "timestamp": datetime.now().isoformat(),
            }
        )

    return state


def node_execution(state: AgentState, python_tool=None, **kwargs) -> AgentState:
    """
    EXECUTION Node: Execute the action decided by reasoning node.

    This is the "hands" of the workflow - executes tools and actions
    without making decisions.

    Args:
        state: Current agent state
        python_tool: Python REPL tool instance (optional)
        **kwargs: Additional arguments

    Returns:
        Updated agent state with execution results in working_memory
    """
    logger.info("Running EXECUTION node")
    thinking_event_fn = kwargs.get("thinking_event_fn")

    # Activity transparency: stream the code+output of every successful Python
    # REPL run as a per-step "execution" thinking event (generation + edits
    # alike). Cheap — no LLM here; explanations are added later in SYNTHESIS.
    def _emit_execution_step(code: Any, output: Any) -> None:
        emit_execution_step(state, thinking_event_fn, code, output)

    # Get or create python tool
    if python_tool is None:
        python_tool = PythonREPLTool()

    # INJECT locals/globals into the REPL environment for the Execution node
    if state.assets_dict:
        if hasattr(python_tool.python_repl, "globals") and isinstance(
            python_tool.python_repl.globals, dict
        ):
            python_tool.python_repl.globals["file_paths"] = state.assets_dict
        elif hasattr(python_tool.python_repl, "locals") and isinstance(
            python_tool.python_repl.locals, dict
        ):
            python_tool.python_repl.locals["file_paths"] = state.assets_dict

    # Get pending action
    pending_action_dict = state.working_memory.tool_outputs.get("pending_action")
    if not pending_action_dict:
        logger.error("No pending action found in EXECUTION node")
        state.working_memory.errors.append(
            {
                "node": "EXECUTION",
                "error": "No pending action found",
                "timestamp": datetime.now().isoformat(),
            }
        )
        return state

    action = ActionRequest(**pending_action_dict)

    # Execute based on action type
    try:
        if action.action_type == "EXECUTE_TOOL":
            # Get tool calls
            tool_calls = state.working_memory.tool_outputs.get("pending_tool_calls", [])

            if not tool_calls:
                logger.warning("No tool calls found for EXECUTE_TOOL action")
                return state

            # Execute each tool call
            for tool_call in tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]
                tool_call_id = tool_call["id"]

                logger.info(f"Executing tool: {tool_name}")

                try:
                    # Execute tool
                    if tool_name.lower() == "python_repl":
                        tool_result = python_tool.run(tool_args["query"])
                        success = True
                        error = None
                        # Stream this successful run as a live activity step.
                        _emit_execution_step(tool_args.get("query"), tool_result)
                    elif tool_name.lower() == "get_available_chart_types":
                        tool_result = get_available_chart_types.invoke({})
                        success = True
                        error = None
                    else:
                        # Unknown tool — always redirect to Python_REPL
                        logger.warning(
                            f"[Execution] Unknown tool called: '{tool_name}'. Redirecting model."
                        )
                        guidance = (
                            f"ERROR: Tool '{tool_name}' does not exist in this environment. "
                            "ONLY TWO tools are available: 'Python_REPL' (run Python code via 'query' parameter) "
                            "and 'get_available_chart_types'. "
                            "Do NOT call any other tool. Use 'Python_REPL' to execute your code."
                        )
                        tool_result = guidance
                        error = guidance

                        success = False

                    logger.info(f"Tool result: {str(tool_result)[:200]}...")

                    # Store result (including original args for conversation history reconstruction)
                    result_entry = {
                        "tool_name": tool_name,
                        "tool_call_id": tool_call_id,
                        "tool_args": tool_args,  # Store args for history reconstruction
                        "success": success,
                        "output": str(tool_result),
                        "error": error,
                        "timestamp": datetime.now().isoformat(),
                    }

                    state.working_memory.python_execution_results.append(result_entry)
                    state.working_memory.tool_outputs[
                        f"tool_{tool_name}_{tool_call_id}"
                    ] = result_entry

                    # Reset retry count on success
                    if success:
                        state.working_memory.retry_count = 0
                    else:
                        state.working_memory.retry_count += 1
                        state.working_memory.errors.append(
                            {
                                "tool": tool_name,
                                "error": error,
                                "timestamp": datetime.now().isoformat(),
                            }
                        )

                except SystemExit as e:
                    # LLM generated code that calls exit() or quit() - handle gracefully
                    error_msg = f"Code attempted to exit the interpreter (exit() or quit() called). This is not allowed. Please remove any exit() or quit() calls from your code."
                    logger.warning(f"SystemExit caught in tool execution: {e}")

                    state.working_memory.python_execution_results.append(
                        {
                            "tool_name": tool_name,
                            "tool_call_id": tool_call_id,
                            "tool_args": tool_args,
                            "success": False,
                            "output": error_msg,
                            "error": error_msg,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )

                    state.working_memory.errors.append(
                        {
                            "tool": tool_name,
                            "error": error_msg,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                    state.working_memory.retry_count += 1

                except Exception as e:
                    error_msg = f"Error executing {tool_name}: {str(e)}"
                    logger.error(error_msg)

                    state.working_memory.python_execution_results.append(
                        {
                            "tool_name": tool_name,
                            "tool_call_id": tool_call_id,
                            "tool_args": tool_args,  # Store args for history reconstruction
                            "success": False,
                            "output": None,
                            "error": error_msg,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )

                    state.working_memory.errors.append(
                        {
                            "tool": tool_name,
                            "error": error_msg,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                    state.working_memory.retry_count += 1

        elif action.action_type == "FINISH":
            # No execution needed, just log
            logger.info("Action type is FINISH, no execution needed")

        else:
            logger.warning(f"Unknown action type: {action.action_type}")

    except Exception as e:
        logger.error(f"Error in EXECUTION node: {str(e)}")
        state.working_memory.errors.append(
            {
                "node": "EXECUTION",
                "action": action.action_type,
                "error": str(e),
                "timestamp": datetime.now().isoformat(),
            }
        )
        state.working_memory.retry_count += 1

    # Clear pending action and tool calls
    state.working_memory.tool_outputs.pop("pending_action", None)
    state.working_memory.tool_outputs.pop("pending_tool_calls", None)

    return state


def node_reasoning_internal(
    state: AgentState, model=None, python_tool=None, **kwargs
) -> AgentState:
    """
    REASONING_INTERNAL Node: Self-contained reasoning with internal tool loop.

    Replaces REASONING + EXECUTION + SYNTHESIS in a single node:
    1. Binds Python_REPL and get_available_chart_types to the model
    2. Builds same messages as node_reasoning (system prompt, file context,
       conversation_history, state context, grounding reminders)
    3. Internal loop: model decides → we execute tools → feed results back
    4. On final text output: extracts JSON/QA + runs synthesis formatting
    5. Sets state.output so flow goes directly to VALIDATION

    Best for models with built-in reasoning (e.g. OpenAI GPT-5.4-mini
    with Responses API + reasoning_effort).

    Args:
        state: Current agent state
        model: Base LLM model (optional)
        python_tool: Python REPL tool instance (optional)

    Returns:
        Updated agent state with state.output set, ready for VALIDATION
    """
    logger.info(f"Running REASONING_INTERNAL node (iteration {state.iteration})")
    thinking_event_fn = kwargs.get("thinking_event_fn")

    def emit_thinking_event(
        phase: str,
        title: str,
        summary: str = "",
        detail: str = "",
        status: str = "completed",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not thinking_event_fn:
            return
        try:
            thinking_event_fn(
                phase=phase,
                title=title,
                summary=summary,
                detail=detail,
                status=status,
                metadata=metadata or {},
            )
        except Exception as exc:
            logger.warning(f"Failed to emit thinking event: {exc}")

    # --- Setup model and tools ---
    if model is None:
        model = get_model_for_agent()
    if python_tool is None:
        python_tool = PythonREPLTool()

    # Inject file_paths dict into REPL environment
    if state.assets_dict:
        if hasattr(python_tool.python_repl, "globals") and isinstance(
            python_tool.python_repl.globals, dict
        ):
            python_tool.python_repl.globals["file_paths"] = state.assets_dict
        elif hasattr(python_tool.python_repl, "locals") and isinstance(
            python_tool.python_repl.locals, dict
        ):
            python_tool.python_repl.locals["file_paths"] = state.assets_dict

    tools = [python_tool, get_available_chart_types]
    model_with_tools = model.bind_tools(tools)

    # --- Route context ---
    route_decision = state.working_memory.tool_outputs.get("route_decision", {})
    mode = route_decision.get("next_step", "dashboard")
    is_chart_mod = route_decision.get("is_chart_modification", False)

    # --- Build messages (same inputs as node_reasoning) ---
    if mode == "dashboard":
        base_prompt = DASHBOARD_SYSTEM_PROMPT
    elif mode == "qa_visual":
        base_prompt = QA_VISUAL_SYSTEM_PROMPT
    else:
        base_prompt = QA_SYSTEM_PROMPT
    state_context = _format_state_for_prompt_basic(state)

    system_prompt = f"""{base_prompt}

{state_context}

Based on the above context, decide your next action."""

    messages = [SystemMessage(content=system_prompt)]

    # Build user instruction with file context
    if state.file_paths:
        valid_files = [
            fp
            for fp in state.file_paths
            if fp and os.path.exists(fp) and "qa_" not in fp
        ]

        if valid_files:
            file_info = ""

            # Inject Data Profile from EXPLORE_FILES
            if state.data_profile:
                file_info += f"=== DATASET PROFILES ===\n{state.data_profile}\n========================\n\n"

            if len(valid_files) == 1:
                file_info += f"CSV file available at: {valid_files[0]}"
            else:
                files_list = "\n".join(
                    [f"- File {i+1}: {fp}" for i, fp in enumerate(valid_files)]
                )
                file_info += f"""Multiple CSV files available for analysis:
{files_list}

Load ALL files and combine/analyze as needed for the user's request. You can use pandas to merge, concatenate, or analyze files together."""

            file_info += "\n\nCRITICAL: When writing Python code, load the files using the paths pre-loaded in the `file_paths` dictionary object in your environment (e.g. `file_paths['users.csv']`)."

            if (
                is_chart_mod
                and state.chart_mentions
                and _mention_is_table(state.chart_mentions[0])
            ):
                instruction = _build_table_mod_instruction(
                    state.chart_mentions[0], state.input_prompt, file_info
                )
            elif is_chart_mod and state.chart_mentions:
                chart_info = state.chart_mentions[0]
                existing_config = chart_info.get("config", {})
                existing_config_json = json.dumps(
                    existing_config, ensure_ascii=False, indent=2
                )
                chart_id = chart_info.get("chart_id", "chart_modified")

                chart_columns_hint = ""
                if existing_config.get("axisConfig"):
                    ax = existing_config["axisConfig"]
                    cols = []
                    if ax.get("x_axis", {}).get("column"):
                        cols.append(ax["x_axis"]["column"])
                    if ax.get("y_axis", {}).get("column"):
                        cols.append(ax["y_axis"]["column"])
                    if cols:
                        chart_columns_hint = (
                            f"\nThis chart uses columns: {', '.join(cols)}"
                        )
                elif existing_config.get("datasets"):
                    ds_labels = [
                        ds.get("label", "")
                        for ds in existing_config.get("datasets", [])
                    ]
                    if ds_labels:
                        chart_columns_hint = (
                            f"\nThis chart uses datasets: {', '.join(ds_labels)}"
                        )

                instruction = f"""User wants to MODIFY an existing chart in their dashboard.

TARGET CHART TO MODIFY:
- Chart ID: {chart_id}
- Title: {chart_info.get('title', 'Untitled')}
- Current Type: {chart_info.get('chart_type', 'unknown')}{chart_columns_hint}
- Current Config:
```json
{existing_config_json}
```

User's modification request: {state.input_prompt}

{file_info}

IMPORTANT SCOPE RULE: You are modifying ONLY this one chart.

WORKFLOW:
1. First, use Python REPL to load the relevant CSV file and analyze the data.
2. Then output a dashboard JSON with ONLY the modified chart.

You MUST output a valid JSON code block. Keep chart ID as "{chart_id}".
Populate datasets with REAL computed data from Python analysis (never empty arrays).
EVERY series/dataset MUST have a non-empty `data` array. If the edit ADDS series (e.g.
daily/weekly/monthly variants), LOAD the source file and COMPUTE each one in the REPL
(e.g. df.set_index(<date>).resample('D'|'W'|'M').sum()), then fill each dataset's `data`.
A chart with empty data will be REJECTED.
Output ONLY the modified chart in "charts" array."""
            elif mode == "dashboard":
                instruction = f"User wants to: {state.input_prompt}\n\n{file_info}"
            elif mode == "qa_visual":
                instruction = f"User asks a focused data question that should be answered with text plus inline chart/table artifact(s): {state.input_prompt}\n\n{file_info}"
            else:
                instruction = f"User question: {state.input_prompt}\n\n{file_info}"

            messages.append(HumanMessage(content=instruction))

    # Fallback: ensure we always have a user message
    if not any(isinstance(m, HumanMessage) for m in messages):
        messages.append(HumanMessage(content=state.input_prompt))

    # Include conversation history from previous tool executions (same as node_reasoning)
    conversation_history = _build_conversation_history_from_executions(state)
    messages.extend(conversation_history)

    # Anti-hallucination: force_more_tools from validation retry
    force_more_tools_msg = state.working_memory.tool_outputs.get("force_more_tools")
    if force_more_tools_msg:
        messages.append(HumanMessage(content=force_more_tools_msg))
        state.working_memory.tool_outputs.pop("force_more_tools", None)

    # Data grounding reminder if we already have some tool executions
    if (
        mode in ("dashboard", "qa_visual")
        and len(state.working_memory.python_execution_results) >= 1
    ):
        messages.append(
            HumanMessage(
                content="""REMINDER: When you generate your dashboard JSON:
- Use ONLY values that came from your Python analysis above
- Every number must be traceable to a print() statement you executed
- If you did not compute a value with Python, do NOT include it in the output"""
            )
        )

    # --- Internal tool execution loop ---
    max_turns = 30
    tool_execution_count = 0

    try:
        for turn in range(max_turns):
            emit_thinking_event(
                "analysis",
                "Comparing analytical options",
                f"Evaluating the next step for {mode.replace('_', ' ')} mode.",
                metadata={"turn": turn + 1, "mode": mode},
            )
            response = _llm_invoke(
                model_with_tools.invoke,
                messages,
                label=f"Internal reasoning turn {turn + 1}",
            )
            _update_usage(state, response)

            # Normalize content (Gemini returns list)
            if isinstance(response.content, list):
                response.content = "\n".join(
                    item.get("text", "") if isinstance(item, dict) else str(item)
                    for item in response.content
                )

            messages.append(response)

            if response.tool_calls and len(response.tool_calls) > 0:
                # --- Execute tool calls inline ---
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    tool_call_id = tool_call["id"]

                    try:
                        if tool_name.lower() == "python_repl":
                            query = tool_args.get("query", "")
                            emit_thinking_event(
                                "tool",
                                "Running Python analysis",
                                "Computing values from the selected data before drafting the response.",
                                detail=query,
                                status="active",
                                metadata={"turn": turn + 1, "tool": "python_repl"},
                            )
                            logger.info(
                                f"[Internal] Turn {turn+1} — Python:\n{query[:200]}..."
                            )
                            result = python_tool.run(query)
                            success, error = True, None
                        elif tool_name.lower() == "get_available_chart_types":
                            emit_thinking_event(
                                "tool",
                                "Checking chart options",
                                "Reviewing available visual encodings for the answer.",
                                status="active",
                                metadata={
                                    "turn": turn + 1,
                                    "tool": "get_available_chart_types",
                                },
                            )
                            logger.info(
                                f"[Internal] Turn {turn+1} — get_available_chart_types"
                            )
                            result = get_available_chart_types.invoke({})
                            success, error = True, None
                        else:
                            logger.warning(f"[Internal] Unknown tool '{tool_name}'")
                            result = (
                                f"ERROR: Tool '{tool_name}' does not exist. "
                                "ONLY 'Python_REPL' (with 'query' param) and "
                                "'get_available_chart_types' are available."
                            )
                            success, error = False, str(result)

                        result_str = str(result)
                        preview = (
                            result_str[:300] + "...[truncated]"
                            if len(result_str) > 300
                            else result_str
                        )
                        logger.info(f"[Internal] Turn {turn+1} result: {preview}")

                    except SystemExit as e:
                        result_str = (
                            "Code attempted to exit(). Remove exit()/quit() calls."
                        )
                        success, error = False, result_str
                        logger.warning(f"[Internal] SystemExit caught: {e}")

                    except Exception as e:
                        result_str = f"Error executing {tool_name}: {str(e)}"
                        success, error = False, result_str
                        logger.error(f"[Internal] Tool error: {result_str}")

                    # Store in working memory (observability + validation)
                    state.working_memory.python_execution_results.append(
                        {
                            "tool_name": tool_name,
                            "tool_call_id": tool_call_id,
                            "tool_args": tool_args,
                            "success": success,
                            "output": result_str,
                            "error": error,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )

                    if success:
                        tool_execution_count += 1
                        # Stream the code+output as a fine-grained Activity step so
                        # the sidebar shows code LIVE on the default OpenAI path too
                        # (not just the Gemini split path).
                        if "python" in str(tool_name).lower():
                            emit_execution_step(
                                state,
                                thinking_event_fn,
                                tool_args.get("query"),
                                result_str,
                            )
                        emit_thinking_event(
                            "tool",
                            "Tool result received",
                            f"{tool_name} completed and returned data for the next step.",
                            detail=result_str,
                            metadata={"turn": turn + 1, "tool": tool_name},
                        )
                    else:
                        state.working_memory.retry_count += 1
                        emit_thinking_event(
                            "error",
                            "Tool needs correction",
                            f"{tool_name} returned an issue; retrying with corrected context.",
                            detail=error or result_str,
                            status="error",
                            metadata={"turn": turn + 1, "tool": tool_name},
                        )

                    # Feed result back to model
                    messages.append(
                        ToolMessage(content=result_str, tool_call_id=tool_call_id)
                    )

            else:
                # --- No tool calls → model produced final output ---

                # Anti-hallucination: enforce minimum tool usage
                min_tools = _get_minimum_tool_executions_required(state)
                if tool_execution_count < min_tools:
                    logger.warning(
                        f"[Internal] Only {tool_execution_count}/{min_tools} tool executions. "
                        "Nudging model to use tools first."
                    )
                    messages.append(
                        HumanMessage(
                            content=f"⚠️ You have only used tools {tool_execution_count} time(s) but need "
                            f"at least {min_tools}. You MUST use Python_REPL to load and analyze "
                            "the data BEFORE generating any output. Call Python_REPL now."
                        )
                    )
                    continue

                # Check for empty response
                content = str(response.content) if response.content else ""
                if not content.strip():
                    if turn < max_turns - 3:
                        logger.warning(
                            f"[Internal] Empty response on turn {turn+1}, nudging"
                        )
                        messages.append(
                            HumanMessage(
                                content="Your response was empty. Please continue your analysis."
                            )
                        )
                        continue
                    else:
                        break

                # --- Extract output → store in working_memory for SYNTHESIS ---
                if mode == "dashboard":
                    if is_chart_mod:
                        # Chart-mod path: structured output on the base
                        # (un-tool-bound) model with regex + repair fallbacks.
                        quick_model = kwargs.get("quick_model")
                        json_data = _finalize_chart_mod_emission(
                            state, model, quick_model, messages, content
                        )
                    else:
                        # Full-dashboard path — unchanged regex extraction.
                        json_data = _extract_json_from_content(content)

                    if json_data:
                        state.working_memory.dashboard_json = json_data

                        # Generate summary
                        try:
                            summary = _generate_summary_for_dashboard(
                                model, json_data, state.input_prompt
                            )
                            state.working_memory.dashboard_summary = summary
                        except Exception as e:
                            logger.warning(f"[Internal] Summary generation failed: {e}")
                            charts_count = len(json_data.get("charts", []))
                            metrics_count = len(json_data.get("metrics", []))
                            state.working_memory.dashboard_summary = (
                                f"I've created a dashboard with {charts_count} chart(s) and "
                                f"{metrics_count} metric(s) based on your data analysis request."
                            )
                    else:
                        # No JSON → treat as Q&A text
                        state.working_memory.qa_response = content
                elif mode == "qa_visual":
                    visual_payload = _extract_qa_visual_from_content(content)
                    if visual_payload:
                        state.working_memory.qa_response = visual_payload.get(
                            "answer", ""
                        )
                        state.working_memory.visual_artifacts = visual_payload.get(
                            "artifacts", []
                        )
                    else:
                        state.working_memory.qa_response = content
                else:
                    # QA mode
                    state.working_memory.qa_response = content

                logger.info(
                    f"[Internal] Completed — {turn + 1} turns, {tool_execution_count} tool calls, mode={mode}"
                )
                emit_thinking_event(
                    "synthesis",
                    (
                        "Drafting answer with visual"
                        if mode == "qa_visual"
                        else "Assembling final response"
                    ),
                    "Combining computed results into the user-facing response.",
                    metadata={
                        "turns": turn + 1,
                        "tool_count": tool_execution_count,
                        "mode": mode,
                    },
                )
                break

        else:
            # Max turns exhausted — salvage last AI message
            logger.error(f"[Internal] Max turns ({max_turns}) exhausted")
            for msg in reversed(messages):
                if (
                    isinstance(msg, AIMessage)
                    and msg.content
                    and str(msg.content).strip()
                ):
                    last_content = str(msg.content)
                    if mode == "dashboard":
                        json_data = _extract_json_from_content(last_content)
                        if json_data:
                            state.working_memory.dashboard_json = json_data
                        else:
                            state.working_memory.qa_response = last_content
                    elif mode == "qa_visual":
                        visual_payload = _extract_qa_visual_from_content(last_content)
                        if visual_payload:
                            state.working_memory.qa_response = visual_payload.get(
                                "answer", ""
                            )
                            state.working_memory.visual_artifacts = visual_payload.get(
                                "artifacts", []
                            )
                        else:
                            state.working_memory.qa_response = last_content
                    else:
                        state.working_memory.qa_response = last_content
                    break
            else:
                state.working_memory.errors.append(
                    {
                        "node": "REASONING_INTERNAL",
                        "error": f"Max turns ({max_turns}) exhausted with no output",
                        "timestamp": datetime.now().isoformat(),
                    }
                )

    except Exception as e:
        error_str = str(e)
        logger.error(f"Error in REASONING_INTERNAL node: {error_str}", exc_info=True)
        if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
            state.working_memory.rate_limit_hits += 1
            if state.working_memory.rate_limit_hits >= 3:
                logger.error(
                    "REASONING_INTERNAL: 3 consecutive 429s — quota exhausted, aborting"
                )
                state.working_memory.qa_response = (
                    "⚠️ The AI model hit its rate limit (quota exhausted). "
                    "Please try again later or contact support to upgrade your API quota."
                )
            else:
                delay_match = re.search(r"retryDelay[\"':\s]+(\d+)s", error_str)
                delay_s = int(delay_match.group(1)) if delay_match else 60
                delay_s = max(10, min(delay_s, 120))
                logger.warning(
                    f"REASONING_INTERNAL: rate limit (429) hit #{state.working_memory.rate_limit_hits}, sleeping {delay_s}s"
                )
                time.sleep(delay_s)
        else:
            state.working_memory.rate_limit_hits = 0
        state.working_memory.errors.append(
            {
                "node": "REASONING_INTERNAL",
                "error": error_str,
                "timestamp": datetime.now().isoformat(),
            }
        )

    return state


def _build_edit_provenance(state: AgentState) -> dict:
    """Build AUTHORITATIVE edit provenance from actually-executed REPL runs.

    Source of truth is ``python_execution_results`` (what the agent really ran),
    NOT the model's self-reported provenance — so the "data behind this edit"
    the user sees cannot be fabricated.
    """
    python_code: list = []
    computed_values: dict = {}
    try:
        results = state.working_memory.python_execution_results or []
    except Exception:
        results = []

    run_index = 0
    for result in results:
        if not isinstance(result, dict):
            continue
        if not result.get("success"):
            continue
        tool_name = str(result.get("tool_name") or "")
        if "python" not in tool_name.lower():
            continue
        args = result.get("tool_args") or {}
        query = args.get("query") if isinstance(args, dict) else None
        if query:
            python_code.append(str(query))
        output = result.get("output")
        if output is not None:
            # Truncate to keep payloads small; the FE shows this as a disclosure.
            computed_values[f"run_{run_index}"] = str(output)[:2000]
            run_index += 1

    return {
        "python_code": python_code,
        "computed_values": computed_values,
        "notes": None,
    }


# ---------------------------------------------------------------------------
# Activity transparency — analysis steps (generation + edits)
# ---------------------------------------------------------------------------
# A "step" is one successful Python REPL run, sanitized for display. The shared
# contract (backend + frontend consume it) is:
#   {index:int, title:str, python:str, output:str, explanation:str}
# python/output are truncated to <= ANALYSIS_STEP_MAX_CHARS each; we keep at most
# the last ANALYSIS_STEPS_MAX meaningful steps.
ANALYSIS_STEP_MAX_CHARS = 1500
ANALYSIS_STEPS_MAX = 8

# Absolute temp paths leak machine-specific noise into the displayed code; strip
# them so the activity panel shows portable, readable analysis.
_TEMP_PATH_RE = re.compile(r"(/var/folders/\S+|/mnt/\S+|/tmp/\S+)")
# ``file_paths['something.csv']`` / ``file_paths["x"]`` plumbing is noise to a
# non-technical reader — collapse the subscript to a generic placeholder.
_FILE_PATHS_ACCESS_RE = re.compile(r"file_paths\[\s*['\"][^'\"]*['\"]\s*\]")
# A step whose code is essentially just listing/printing file_paths does no
# computation worth showing.
_TRIVIAL_STEP_RE = re.compile(r"^\s*(print\s*\(\s*file_paths.*\)|file_paths\s*)\s*$")


def _sanitize_analysis_text(text: Any) -> str:
    """Strip temp paths + file_paths subscript noise from displayed code/output."""
    if text is None:
        return ""
    cleaned = str(text)
    cleaned = _TEMP_PATH_RE.sub("<path>", cleaned)
    cleaned = _FILE_PATHS_ACCESS_RE.sub("file_paths[...]", cleaned)
    return cleaned


def _is_trivial_step_code(code: str) -> bool:
    """True for debug-only steps (e.g. just ``print(file_paths)``) with no real work."""
    stripped = (code or "").strip()
    if not stripped:
        return True
    non_empty_lines = [line for line in stripped.splitlines() if line.strip()]
    if len(non_empty_lines) == 1 and _TRIVIAL_STEP_RE.match(non_empty_lines[0]):
        return True
    return False


def _step_title_from_code(code: str, fallback_index: int) -> str:
    """Short heuristic title — first comment line, else a generic label."""
    for line in (code or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            comment = stripped.lstrip("#").strip()
            if comment:
                return comment[:80]
    return f"Step {fallback_index + 1}: analysis"


def _fallback_analysis_step_explanation(_step: dict) -> str:
    """Non-technical fallback when the quick model cannot explain a step."""
    raw_title = str(_step.get("title") or "").strip()
    title = re.sub(r"[._-]+", " ", raw_title)
    title = re.sub(r"\s+", " ", title).strip()
    lower_title = title.lower()
    if not title or re.match(r"^step \d+: analysis$", title, flags=re.IGNORECASE):
        return "Ran a calculation and saved the result used in the dashboard."
    if "robust read" in lower_title:
        return "Loaded the data carefully and retried with safer read settings."
    if "bom" in lower_title and "column" in lower_title:
        return "Cleaned hidden characters from column names so the data matches correctly."
    if "computed values" in lower_title:
        return "Pulled the exact computed values into the dashboard."
    if "join" in lower_title:
        return "Matched related records so the data can be compared correctly."
    if re.search(r"(total|sum|aggregate|daily|weekly|monthly)", lower_title):
        return f"{title[:1].upper()}{title[1:].rstrip('.')} for the dashboard."
    return f"{title[:1].upper()}{title[1:].rstrip('.')} for this calculation."


def _fill_missing_analysis_step_explanations(steps: list) -> list:
    """Ensure every activity step has a user-readable explanation."""
    for step in steps:
        if not str(step.get("explanation", "")).strip():
            step["explanation"] = _fallback_analysis_step_explanation(step)
    return steps


def emit_execution_step(
    state: AgentState, thinking_event_fn, code: Any, output: Any
) -> None:
    """Stream one successful Python REPL run as a per-step ``execution`` thinking
    event (code + output), so the Activity sidebar can show code LIVE.

    Shared by both reasoning loops (split `node_execution` and OpenAI internal
    `node_reasoning_internal`) so the live experience is identical on every model.
    Uses a monotonic per-run counter in ``tool_outputs["_analysis_step_emitted"]``
    so step indexes never collide/duplicate. Cheap — no LLM; the plain-language
    explanations are added later in SYNTHESIS.
    """
    if not thinking_event_fn:
        return
    step_index = int(state.working_memory.tool_outputs.get("_analysis_step_emitted", 0))
    state.working_memory.tool_outputs["_analysis_step_emitted"] = step_index + 1
    sanitized_code = _sanitize_analysis_text(code)[:ANALYSIS_STEP_MAX_CHARS]
    sanitized_output = _sanitize_analysis_text(output)[:ANALYSIS_STEP_MAX_CHARS]
    try:
        thinking_event_fn(
            phase="execution",
            title=_step_title_from_code(sanitized_code, step_index),
            metadata={
                "python": sanitized_code,
                "output": sanitized_output,
                "step_index": step_index,
            },
        )
    except Exception as exc:
        logger.warning(f"Failed to emit execution step thinking event: {exc}")


def _collect_analysis_steps(state: AgentState) -> list:
    """Generalize edit provenance into structured analysis steps for BOTH paths.

    Iterates successful Python REPL runs in ``python_execution_results`` (works for
    generation runs as well as edits), sanitizes the code/output, drops trivial
    debug-only steps, truncates, and caps to the last ANALYSIS_STEPS_MAX steps.
    """
    try:
        results = state.working_memory.python_execution_results or []
    except Exception:
        results = []

    steps: list = []
    for result in results:
        if not isinstance(result, dict):
            continue
        if not result.get("success"):
            continue
        tool_name = str(result.get("tool_name") or "")
        if "python" not in tool_name.lower():
            continue
        args = result.get("tool_args") or {}
        query = args.get("query") if isinstance(args, dict) else None
        if not query:
            continue

        raw_code = str(query)
        if _is_trivial_step_code(raw_code):
            continue

        sanitized_code = _sanitize_analysis_text(raw_code)[:ANALYSIS_STEP_MAX_CHARS]
        sanitized_output = _sanitize_analysis_text(result.get("output"))[
            :ANALYSIS_STEP_MAX_CHARS
        ]
        steps.append(
            {
                "index": 0,  # reassigned after capping so indexes stay contiguous
                "title": _step_title_from_code(raw_code, len(steps)),
                "python": sanitized_code,
                "output": sanitized_output,
            }
        )

    # Cap to the last N meaningful steps and renumber contiguously.
    steps = steps[-ANALYSIS_STEPS_MAX:]
    for index, step in enumerate(steps):
        step["index"] = index
    return steps


def _explain_analysis_steps(quick_model, steps: list) -> list:
    """Attach a 1-sentence plain-language explanation to each step.

    ONE batched LLM call via the cheap quick model. On ANY failure (no model,
    bad/short response, exception) steps receive a deterministic plain-language
    fallback explanation — this never raises.
    """
    if not steps:
        return steps

    # Default every step to an empty explanation so callers always get the key.
    for step in steps:
        step.setdefault("explanation", "")

    if quick_model is None:
        return _fill_missing_analysis_step_explanations(steps)

    try:
        step_blocks = []
        for step in steps:
            # Bound per-step input so a batch stays cheap.
            code_excerpt = str(step.get("python", ""))[:800]
            output_excerpt = str(step.get("output", ""))[:400]
            step_blocks.append(
                f"Step {step['index']}:\nCODE:\n{code_excerpt}\nOUTPUT:\n{output_excerpt}"
            )
        prompt = (
            "For each analysis step below, write ONE short, plain-language, "
            "non-technical sentence explaining what it computed (e.g. 'Computed "
            "weekly totals by resampling the date column'). Do not mention code, "
            "libraries, or variable names.\n\n"
            "Return ONLY a JSON array of objects like "
            '[{"index": 0, "explanation": "..."}], one per step, matching the '
            "step indexes.\n\n" + "\n\n".join(step_blocks)
        )
        response = _llm_invoke(
            quick_model.invoke,
            [HumanMessage(content=prompt)],
            label="Analysis-step explanations",
        )
        content = getattr(response, "content", response)
        parsed = json.loads(clean_json(str(content)))
        if not isinstance(parsed, list):
            return _fill_missing_analysis_step_explanations(steps)
        by_index = {}
        for item in parsed:
            if isinstance(item, dict) and "index" in item:
                by_index[item["index"]] = str(item.get("explanation", ""))
        for step in steps:
            if step["index"] in by_index:
                step["explanation"] = by_index[step["index"]][:300]
    except Exception as exc:
        logger.warning(f"Analysis-step explanations failed: {exc}")
        return _fill_missing_analysis_step_explanations(steps)

    return _fill_missing_analysis_step_explanations(steps)


def _attach_analysis_steps(state: AgentState) -> None:
    """Collect + explain analysis steps, persist to working memory and surface in output.

    Called from SYNTHESIS for both the generation and edit paths once the output
    dict has been finalized. Bounded/cheap; never raises.
    """
    try:
        steps = _collect_analysis_steps(state)
        if not steps:
            return
        steps = _explain_analysis_steps(get_model_for_quick_agent(), steps)
        state.working_memory.analysis_steps = steps
        if isinstance(state.output, dict):
            state.output["analysis_steps"] = steps
    except Exception as exc:
        logger.warning(f"Failed to attach analysis steps: {exc}")


def _derive_change_summary(old_config: dict, new_chart: dict) -> dict:
    """Fallback ChangeSummary when the structured summary is unavailable.

    Compares the previous chart config with the newly emitted chart to describe
    type changes and series additions/removals in the ChangeSummary shape.
    """
    old_config = old_config or {}
    new_chart = new_chart or {}

    def _chart_type(cfg: dict):
        return cfg.get("chart_type") or cfg.get("type")

    old_type = _chart_type(old_config)
    new_type = _chart_type(new_chart)

    def _labels(cfg: dict) -> list:
        datasets = cfg.get("datasets") or []
        labels = []
        for ds in datasets:
            if isinstance(ds, dict) and ds.get("label"):
                labels.append(str(ds["label"]))
        return labels

    old_labels = _labels(old_config)
    new_labels = _labels(new_chart)
    series_added = [lbl for lbl in new_labels if lbl not in old_labels]
    series_removed = [lbl for lbl in old_labels if lbl not in new_labels]

    change_type: list = []
    parts: list = []
    if old_type and new_type and old_type != new_type:
        change_type.append("chart_type")
        parts.append(f"changed from {old_type} to {new_type}")
    if series_added:
        change_type.append("series_added")
        parts.append(f"added {', '.join(series_added)}")
    if series_removed:
        change_type.append("series_removed")
        parts.append(f"removed {', '.join(series_removed)}")
    if not change_type:
        change_type.append("other")
        parts.append("updated the chart")

    title = new_chart.get("title") or old_config.get("title") or "the chart"
    human_summary = f"Updated {title}: " + "; ".join(parts) + "."

    return {
        "change_type": change_type,
        "chart_type_from": old_type,
        "chart_type_to": new_type,
        "series_added": series_added,
        "series_removed": series_removed,
        "filters_applied": [],
        "human_summary": human_summary,
    }


def node_synthesis(state: AgentState, model=None, **kwargs) -> AgentState:
    """
    SYNTHESIS Node: Synthesize final output from working memory.

    Aggregates results from working memory and prepares final output.
    May use structured output as fallback if needed.

    Args:
        state: Current agent state
        model: LLM model for structured output fallback (optional)
        **kwargs: Additional arguments

    Returns:
        Updated agent state with output populated
    """
    logger.info("Running SYNTHESIS node")
    thinking_event_fn = kwargs.get("thinking_event_fn")

    route_decision = state.working_memory.tool_outputs.get("route_decision", {})
    mode = route_decision.get("next_step", "dashboard")

    is_chart_mod = route_decision.get("is_chart_modification", False)

    if mode == "dashboard" and is_chart_mod and state.chart_mentions:
        # Chart modification mode — output only the modified chart with metadata
        # Frontend will handle merging into the existing dashboard
        dashboard_json = state.working_memory.dashboard_json
        chart_mention = state.chart_mentions[0]
        logger.info(
            f"Chart modification synthesis for chart: {chart_mention.get('title')}"
        )

        if dashboard_json:
            # Coarse chart-edit progress: announce rendering of the updated chart
            # right before we set the merge-ready output.
            if thinking_event_fn:
                try:
                    thinking_event_fn(
                        phase="rendering",
                        title="Rendering the updated chart",
                        metadata={
                            "step": "rendering",
                            "is_chart_modification": True,
                            "chart_id": chart_mention.get("chart_id"),
                        },
                    )
                except Exception as exc:
                    logger.warning(f"Failed to emit rendering thinking event: {exc}")
            # Extract the modified chart object from the dashboard wrapper for
            # change-summary derivation (output data is {... "charts":[chart]}).
            modified_chart = {}
            try:
                charts = (dashboard_json or {}).get("charts") or []
                if charts:
                    modified_chart = charts[0] or {}
            except Exception:
                modified_chart = {}

            # "What changed" summary: prefer the structured summary the model
            # produced; otherwise derive one by diffing old vs new.
            change_summary = state.working_memory.chart_change_summary
            if not change_summary:
                change_summary = _derive_change_summary(
                    chart_mention.get("config") or {}, modified_chart
                )

            # "Data behind this edit": always compute authoritative provenance
            # from the executed REPL runs; backfill python_code if the model's
            # self-reported provenance lacks it.
            authoritative = _build_edit_provenance(state)
            data_provenance = state.working_memory.edit_provenance or {}
            if not data_provenance.get("python_code"):
                data_provenance = {**data_provenance, **authoritative}

            # Tag output so frontend knows to merge instead of replace
            state.output = {
                "type": "chart_modification",
                "data": dashboard_json,
                "chart_modification_context": {
                    "component_id": chart_mention.get("component_id"),
                    "chart_id": chart_mention.get("chart_id"),
                    # Dashboard the edited component belongs to (None for old
                    # clients); the server merge uses it to target the correct
                    # dashboard and persist in place.
                    "dashboard_id": chart_mention.get("dashboard_id"),
                    "title": chart_mention.get("title"),
                    "chart_type": chart_mention.get("chart_type"),
                    "change_summary": change_summary,
                    "data_provenance": data_provenance,
                },
            }
            logger.info("Chart modification synthesis complete — frontend will merge")
        elif state.working_memory.qa_response:
            state.output = {
                "type": "message",
                "content": state.working_memory.qa_response,
            }
        else:
            state.working_memory.errors.append(
                {
                    "node": "SYNTHESIS",
                    "error": "Failed to extract modified chart JSON",
                    "timestamp": datetime.now().isoformat(),
                }
            )
            logger.error("Failed to synthesize chart modification output")

    elif mode == "dashboard":
        # Full dashboard generation mode (original path)
        dashboard_json = state.working_memory.dashboard_json

        if dashboard_json:
            state.output = {
                "type": "dashboard_config",
                "data": dashboard_json,
            }
            logger.info("Dashboard synthesis complete")
        elif state.working_memory.qa_response:
            # Fallback: No JSON found, but we have a text response
            # This happens when routing defaulted to dashboard but LLM gave text
            logger.info(
                "No dashboard JSON, but found qa_response - using as text output"
            )
            state.output = {
                "type": "message",
                "content": state.working_memory.qa_response,
            }
        else:
            state.working_memory.errors.append(
                {
                    "node": "SYNTHESIS",
                    "error": "Failed to extract dashboard JSON",
                    "timestamp": datetime.now().isoformat(),
                }
            )
            logger.error("Failed to synthesize dashboard output")

    elif mode == "qa_visual":
        qa_response = state.working_memory.qa_response
        artifacts = state.working_memory.visual_artifacts

        if qa_response and artifacts:
            state.output = {
                "type": "answer_with_visual",
                "content": qa_response,
                "artifacts": artifacts,
            }
            logger.info(
                f"QA visual synthesis complete with {len(artifacts)} artifact(s)"
            )
        elif qa_response:
            state.output = {
                "type": "message",
                "content": qa_response,
            }
            logger.info("QA visual synthesis fell back to text-only message")
        else:
            state.working_memory.errors.append(
                {
                    "node": "SYNTHESIS",
                    "error": "Failed to extract QA visual response",
                    "timestamp": datetime.now().isoformat(),
                }
            )
            logger.error("Failed to synthesize QA visual output")

    else:  # qa mode
        qa_response = state.working_memory.qa_response

        if qa_response:
            state.output = {
                "type": "message",
                "content": qa_response,
            }
            logger.info("Q&A synthesis complete")
        else:
            state.working_memory.errors.append(
                {
                    "node": "SYNTHESIS",
                    "error": "Failed to extract QA response",
                    "timestamp": datetime.now().isoformat(),
                }
            )
            logger.error("Failed to synthesize Q&A output")

    # Activity transparency: once the output dict is finalized (generation OR
    # edit), attach the structured analysis steps so the server can persist them.
    _attach_analysis_steps(state)

    return state


def node_validation(state: AgentState, **kwargs) -> AgentState:
    """
    VALIDATION Node: Validate output format, completeness, and data authenticity.

    Validates that the output meets schema requirements, contains all necessary data,
    and checks for data hallucination (fabricated values).

    Args:
        state: Current agent state
        **kwargs: Additional arguments

    Returns:
        Updated agent state with validation result in working_memory
    """
    logger.info("Running VALIDATION node")

    if not state.output:
        logger.error("No output to validate")
        state.working_memory.errors.append(
            {
                "node": "VALIDATION",
                "error": "No output to validate",
                "timestamp": datetime.now().isoformat(),
            }
        )
        state.working_memory.tool_outputs["validation"] = {
            "valid": False,
            "error": "No output",
        }
        return state

    output_type = state.output.get("type")

    # Chart modification mode: skip data authenticity checks on the merged
    # dashboard, but still enforce structural/layout validity so impossible grid
    # geometry cannot be saved.
    route_decision = state.working_memory.tool_outputs.get("route_decision", {})
    if route_decision.get("is_chart_modification") and output_type in (
        "dashboard_config",
        "chart_modification",
    ):
        validation_result = _validate_dashboard_json(state.output.get("data"))
        if validation_result.get("valid"):
            logger.info(
                "Chart modification mode — structural validation passed; "
                "running scoped data-authenticity check"
            )
            validation_result["note"] = "chart_modification_layout_only"

            # Scoped anti-hallucination: ensure the modified chart's datapoints
            # trace back to the Python analysis. Restyle-only edits (no REPL
            # runs) are intentionally skipped inside the helper.
            modified_chart = _extract_modified_chart(state.output.get("data"))
            if modified_chart is not None:
                data_validation = _validate_chart_modification_data(
                    modified_chart, state
                )

                for warning in data_validation.get("warnings", []):
                    logger.warning(f"Chart-mod data validation: {warning}")

                if data_validation.get("empty_chart"):
                    # EMPTY chart is unambiguously broken — force ONE recompute so
                    # the model actually computes data (never re-reasoned for soft
                    # issues, but an empty chart must not ship).
                    empty_retries = state.working_memory.tool_outputs.get(
                        "chart_mod_empty_retries", 0
                    )
                    if empty_retries < 1:
                        grounding = _build_data_grounding_context(state)
                        state.working_memory.tool_outputs["force_more_tools"] = (
                            "⚠️ THE MODIFIED CHART HAS NO DATAPOINTS — IT WOULD RENDER BLANK ⚠️\n\n"
                            "LOAD the source file and COMPUTE real values via the Python REPL for "
                            "EVERY series. If you added time-variant series (daily/weekly/monthly), "
                            "resample the date column (e.g. "
                            "df.set_index(<date>).resample('D'/'W'/'M').sum()) and populate each "
                            "dataset's `data` with the resulting {label, value} points. "
                            "NEVER emit empty data arrays.\n\n"
                            f"{grounding}"
                        )
                        state.working_memory.tool_outputs["chart_mod_empty_retries"] = (
                            empty_retries + 1
                        )
                        # Mark invalid → the shared block below increments retry_count
                        # and the workflow re-runs reasoning/execution.
                        validation_result = {
                            "valid": False,
                            "error": "Chart modification produced an empty chart — recomputing.",
                            "data_errors": data_validation.get("errors", []),
                            "empty_chart": True,
                        }
                    else:
                        # Recompute still empty — never ship a blank chart. Flag so
                        # the server keeps the ORIGINAL chart unchanged (no overwrite).
                        logger.warning(
                            "Chart-mod still empty after recompute retry; flagging "
                            "empty_chart so the original chart is kept."
                        )
                        validation_result["empty_chart"] = True
                        validation_result["data_warnings"] = data_validation.get(
                            "errors", []
                        )
                else:
                    # Accept-with-warning: a chart edit is never re-reasoned for soft
                    # data-authenticity issues (that doubled latency). Unmatched
                    # datapoints are surfaced as warnings only; the structural/layout
                    # check above still gates un-renderable output, and restyle-only
                    # edits are skipped inside the helper. validation_result stays valid.
                    validation_result["unmatched_ratio"] = data_validation.get(
                        "unmatched_ratio", 0.0
                    )
                    issues = data_validation.get("errors", []) + data_validation.get(
                        "warnings", []
                    )
                    if issues:
                        validation_result["data_warnings"] = issues
                        if not data_validation.get("valid"):
                            logger.warning(
                                "Chart-mod data authenticity flagged %d issue(s); "
                                "accepting with warning (no re-reasoning)",
                                len(issues),
                            )
        state.working_memory.tool_outputs["validation"] = validation_result
        if not validation_result.get("valid"):
            error_msg = validation_result.get("error", "Validation failed")
            if (
                "layout" in str(error_msg).lower()
                or "overlap" in str(error_msg).lower()
            ):
                state.working_memory.tool_outputs[
                    "force_more_tools"
                ] = f"""⚠️ YOUR DASHBOARD WAS REJECTED DUE TO LAYOUT GEOMETRY ⚠️

The dashboard layout is invalid: {error_msg}

Regenerate the dashboard JSON with a 24-column grid where every component has
finite integer x/y/w/h/minW/minH, w >= minW, x + w <= 24, h >= minH, and no
overlapping components. If a chart or table cannot fit beside another after
applying minW, move it to the next row at x=0."""
            logger.error(f"Validation failed: {error_msg}")
            state.working_memory.errors.append(
                {
                    "node": "VALIDATION",
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                }
            )
            state.working_memory.retry_count += 1
        return state

    if output_type == "dashboard_config":
        # Step 1: Validate dashboard JSON schema
        validation_result = _validate_dashboard_json(state.output.get("data"))

        # Step 2: Validate data authenticity (anti-hallucination check)
        if validation_result.get("valid"):
            dashboard_data = state.output.get("data", {})
            data_validation = _validate_dashboard_data(dashboard_data, state)

            # Track validation retry attempts
            validation_retries = state.working_memory.tool_outputs.get(
                "validation_retries", 0
            )
            max_validation_retries = 2

            # Log warnings and errors
            if data_validation.get("warnings"):
                for warning in data_validation["warnings"]:
                    logger.warning(f"Data validation: {warning}")

            if data_validation.get("metric_warnings"):
                for warning in data_validation["metric_warnings"]:
                    logger.warning(
                        f"Data validation (metric - non-critical): {warning}"
                    )

            if data_validation.get("errors"):
                for error in data_validation["errors"]:
                    logger.error(f"Data validation error: {error}")

            # Check for critical issues (likely hallucinated data)
            # A single metric warning is non-critical (lowest severity) and passes validation.
            # But >=2 metric warnings still trigger retry.
            has_critical_issues = (
                len(data_validation.get("errors", [])) > 0
                or len(data_validation.get("warnings", [])) >= 1
                or len(data_validation.get("metric_warnings", [])) >= 2
            )

            if has_critical_issues and validation_retries < max_validation_retries:
                # Data appears to be fabricated - force retry
                logger.warning(
                    f"Dashboard data validation failed (attempt {validation_retries + 1}/{max_validation_retries}). "
                    f"Likely fabricated data detected. Forcing regeneration."
                )

                # Build error message for LLM
                grounding_context = _build_data_grounding_context(state)
                issues_list = "\n".join(
                    [f"- ERROR: {e}" for e in data_validation.get("errors", [])]
                    + [f"- WARNING: {w}" for w in data_validation.get("warnings", [])]
                    + [
                        f"- METRIC WARNING (non-critical): {w}"
                        for w in data_validation.get("metric_warnings", [])
                    ]
                )

                validation_error_msg = f"""⚠️ YOUR DASHBOARD WAS REJECTED DUE TO DATA ISSUES ⚠️

The following issues were detected - your data appears to be FABRICATED:
{issues_list}

{grounding_context}

Please REGENERATE the dashboard JSON using ONLY the values from the Python analysis above.
DO NOT include any values that you cannot trace back to a print() statement.
It's better to have fewer charts with REAL data than more charts with FAKE data."""

                # Store for retry
                state.working_memory.tool_outputs["force_more_tools"] = (
                    validation_error_msg
                )
                state.working_memory.tool_outputs["validation_retries"] = (
                    validation_retries + 1
                )

                # Mark as invalid to trigger retry
                validation_result = {
                    "valid": False,
                    "error": "Data validation failed - likely fabricated data",
                    "data_warnings": data_validation.get("warnings", []),
                    "data_errors": data_validation.get("errors", []),
                }
            elif has_critical_issues:
                # Max retries reached - accept with warning
                logger.warning(
                    "Max validation retries reached, accepting dashboard despite data issues"
                )
                validation_result["data_warnings"] = data_validation.get("warnings", [])
            else:
                # Data validation passed
                logger.info("Data authenticity validation passed")

    elif output_type == "message":
        # Validate QA response
        validation_result = _validate_qa_response(state.output.get("content"))
    elif output_type == "answer_with_visual":
        validation_result = _validate_answer_with_visual(state.output, state)
    else:
        validation_result = {
            "valid": False,
            "error": f"Unknown output type: {output_type}",
        }

    # Analysis focus compliance check
    if state.template_spec and state.working_memory.dashboard_json:
        dashboard_json = state.working_memory.dashboard_json
        required_keywords = state.template_spec.get("required_metric_keywords", [])

        if required_keywords:
            metric_titles = [
                (m.get("title") or m.get("name") or "").lower()
                for m in dashboard_json.get("metrics", [])
            ]
            all_metrics_text = " ".join(metric_titles)

            matched = sum(
                1 for kw in required_keywords if kw.lower() in all_metrics_text
            )
            match_ratio = matched / len(required_keywords)

            if match_ratio < 0.3:
                logger.warning(
                    f"Analysis focus compliance low: {matched}/{len(required_keywords)} keywords found. "
                    f"Focus: {state.template_spec.get('name')}"
                )
                state.working_memory.errors.append(
                    {
                        "node": "node_validation",
                        "type": "analysis_focus_compliance",
                        "message": (
                            f"Dashboard does not contain expected metrics for analysis focus "
                            f"'{state.template_spec.get('name')}'. "
                            f"Found {matched}/{len(required_keywords)} required metric keywords."
                        ),
                        "retry_suggested": True,
                    }
                )

    if output_type == "dashboard_config" and not validation_result.get("valid"):
        error_msg = validation_result.get("error", "Dashboard validation failed")
        if "layout" in str(error_msg).lower() or "overlap" in str(error_msg).lower():
            state.working_memory.tool_outputs[
                "force_more_tools"
            ] = f"""⚠️ YOUR DASHBOARD WAS REJECTED DUE TO LAYOUT GEOMETRY ⚠️

The dashboard layout is invalid: {error_msg}

Regenerate the dashboard JSON with a 24-column grid where every component has
finite integer x/y/w/h/minW/minH, w >= minW, x + w <= 24, h >= minH, and no
overlapping components. If a chart or table cannot fit beside another after
applying minW, move it to the next row at x=0."""

    state.working_memory.tool_outputs["validation"] = validation_result

    if not validation_result.get("valid"):
        error_msg = validation_result.get("error", "Validation failed")
        logger.error(f"Validation failed: {error_msg}")
        state.working_memory.errors.append(
            {
                "node": "VALIDATION",
                "error": error_msg,
                "timestamp": datetime.now().isoformat(),
            }
        )
        state.working_memory.retry_count += 1
    else:
        logger.info("Validation passed")

    return state


def node_finish(state: AgentState, **kwargs) -> AgentState:
    """
    FINISH Node: Terminal success node.

    Sets workflow status to FINISHED and logs completion.

    Args:
        state: Current agent state
        **kwargs: Additional arguments

    Returns:
        Updated agent state with FINISHED status
    """
    state.status = "FINISHED"
    logger.info(
        f"Workflow completed successfully for conversation {state.conversation_id}"
    )
    return state


def node_error(state: AgentState, **kwargs) -> AgentState:
    """
    ERROR Node: Terminal error node.

    Sets workflow status to ERROR and logs error summary.

    Args:
        state: Current agent state
        **kwargs: Additional arguments

    Returns:
        Updated agent state with ERROR status
    """
    state.status = "ERROR"

    # Log recent errors
    if state.working_memory.errors:
        error_summary = "\n".join(
            [
                f"- {e.get('node', 'unknown')}: {e.get('error', 'unknown error')}"
                for e in state.working_memory.errors[-3:]
            ]
        )
        logger.error(f"Workflow failed:\n{error_summary}")
    else:
        logger.error("Workflow failed with no recorded errors")

    return state


# Helper functions (basic implementations, will be refactored to helpers.py)


def _render_node_contents(node: Dict[str, Any], dashboards: Dict[str, Any]) -> str:
    """Render node contents to text."""
    chunks = []
    for content in node.get("contents", []):
        content_type = (content.get("type") or "").lower()
        data = content.get("data") or {}
        if content_type == "text":
            text = data.get("text")
            if text:
                chunks.append(str(text).strip())
        elif content_type == "dashboard":
            dash_id = data.get("dashboard_id")
            if dash_id and dash_id in dashboards:
                dash_payload = dashboards[dash_id]
                dash_block = json.dumps(dash_payload, ensure_ascii=False, indent=2)
                chunks.append(f"Attached dashboard ({dash_id}):\n{dash_block}")
        elif content_type == "chart_mention":
            title = data.get("title", "Unknown Chart")
            chart_type = data.get("chart_type", "chart")
            chunks.append(
                f"[Referenced chart for modification: {title} ({chart_type})]"
            )
    return "\n\n".join(chunk for chunk in chunks if chunk).strip()


def _format_state_for_prompt_basic(state: AgentState) -> str:
    """Basic state formatting for prompt (will be enhanced in helpers.py)."""
    sections = []

    sections.append(
        f"""CURRENT STATE:
- Node: {state.current_node}
- Iteration: {state.iteration}/{state.max_iterations}"""
    )

    route_decision = state.working_memory.tool_outputs.get("route_decision")
    if route_decision:
        sections.append(f"""MODE: {route_decision.get('next_step')}""")

    if state.theme_id:
        sections.append(
            f"""SELECTED VISUAL THEME:
- Use theme "{state.theme_id}" for styling_recommendations.theme and every metric/chart/table styling.theme.
- Do not choose a different dashboard theme unless the selected theme is invalid."""
        )

    if state.template_spec:
        prompt_prefix = state.template_spec.get("prompt_prefix", "")
        if prompt_prefix:
            sections.append(
                f"""SELECTED ANALYSIS FOCUS:
{prompt_prefix}"""
            )

    if state.working_memory.errors:
        recent_errors = state.working_memory.errors[-2:]
        sections.append(
            f"""ERRORS (Retry: {state.working_memory.retry_count}):
{chr(10).join([f"- {e.get('error', '')[:100]}" for e in recent_errors])}"""
        )

    return "\n\n".join(sections)


def _generate_summary_for_dashboard(
    model, dashboard_json: Dict[str, Any], user_prompt: str
) -> str:
    """Generate a text summary for the dashboard using a simple LLM call.

    Args:
        model: LLM model instance
        dashboard_json: The dashboard JSON configuration
        user_prompt: Original user request for context

    Returns:
        String summary of the dashboard
    """
    # Build description of dashboard contents
    charts = dashboard_json.get("charts", [])
    metrics = dashboard_json.get("metrics", [])

    chart_info = [
        f"- {c.get('type', 'chart')}: '{c.get('title', 'Untitled')}'" for c in charts
    ]
    metric_info = [
        f"- {m.get('label', 'Metric')}: {m.get('value', 'N/A')}" for m in metrics
    ]

    description = ""
    if chart_info:
        description += "Charts:\n" + "\n".join(chart_info) + "\n"
    if metric_info:
        description += "Metrics:\n" + "\n".join(metric_info)

    prompt = f"""You just created a dashboard for the user, you should notify the user about the dashboard. Based on the dashboard you just created for the user, write a brief 2-3 sentence summary.

User's request: {user_prompt}

Dashboard contents:
{description}

Write a conversational summary explaining what the dashboard shows and key insights. No labels or prefixes."""

    from langchain_core.messages import HumanMessage

    response = _llm_invoke(
        model.invoke, [HumanMessage(content=prompt)], label="Dashboard summary"
    )
    _update_usage(state, response)

    if response and response.content and isinstance(response.content, list):
        return str(response.content[0]["text"].strip())
    elif response and response.content:
        return str(response.content).strip()
    # Fallback
    return f"I've created a dashboard with {len(charts)} chart(s) and {len(metrics)} metric(s) based on your request."


class StructuredEmissionError(Exception):
    """Raised when provider structured-output for chart-mod fails.

    Signals the caller to fall back to regex extraction + repair.
    """


# Required ChartSpec fields the wrapper/downstream code depends on. A regex
# extraction missing any of these triggers the targeted repair step.
_CHART_SPEC_REQUIRED_KEYS = ("id", "chart_type", "title", "datasets")


def _wrap_chart_into_dashboard(chart: Dict[str, Any]) -> Dict[str, Any]:
    """Wrap a single chart object into the dashboard JSON envelope.

    Downstream code (validation, persistence) expects the full
    ``{dashboard, metrics, charts:[chart], tables, insights}`` shape, so both
    the structured-output path and the regex fallback funnel through here.
    """
    return {
        "dashboard": {
            "title": "Chart Modification",
            "description": "Modified chart",
        },
        "metrics": [],
        "charts": [chart],
        "tables": [],
        "insights": [],
    }


def _wrap_table_into_dashboard(table: Dict[str, Any]) -> Dict[str, Any]:
    """Wrap a single table object into the dashboard JSON envelope.

    Mirror of ``_wrap_chart_into_dashboard`` for the table-modification path:
    the modified table lands in ``tables`` (not ``charts``) so the server merge
    replaces it in-place by id.
    """
    return {
        "dashboard": {
            "title": "Table Modification",
            "description": "Modified table",
        },
        "metrics": [],
        "charts": [],
        "tables": [table],
        "insights": [],
    }


# Required TableSpec fields the wrapper/downstream code depends on. Mirrors the
# chart required-key check used for regex-fallback repair gating.
_TABLE_SPEC_REQUIRED_KEYS = ("id", "title", "columns", "data")


def _mention_target_id(chart_mention: Dict[str, Any]) -> Optional[str]:
    """Return the id of the component the mention targets.

    Prefer the structured chart/table ``chart_id`` (the stable component id the
    frontend stores), falling back to ``component_id``. Used to force-preserve
    the emitted component's id so the server merge replaces (not appends).
    """
    if not isinstance(chart_mention, dict):
        return None
    return chart_mention.get("chart_id") or chart_mention.get("component_id")


def _mention_is_table(chart_mention: Dict[str, Any]) -> bool:
    """Detect whether the @-mention targets a table component.

    Mentions encode the component kind in ``chart_type`` (it mirrors the
    component ``type``). A value of ``table`` means the user is editing a table.
    """
    if not isinstance(chart_mention, dict):
        return False
    kind = str(chart_mention.get("chart_type") or "").strip().lower()
    return kind == "table"


def _build_table_mod_instruction(
    chart_mention: Dict[str, Any], input_prompt: str, file_info: str
) -> str:
    """Build the reasoning instruction for a TABLE edit.

    Mirrors the chart-modification instruction's structure but injects the table
    definition (columns + current rows + ranking/description) and instructs the
    model to recompute via Python REPL and emit a ``tables`` array (never a
    chart). The original table id is preserved so the server merge replaces it.
    """
    existing_config = chart_mention.get("config", {}) or {}
    existing_config_json = json.dumps(existing_config, ensure_ascii=False, indent=2)
    table_id = (
        chart_mention.get("chart_id")
        or chart_mention.get("component_id")
        or "table_modified"
    )

    columns = existing_config.get("columns") or []
    column_labels = [
        str(col.get("label") or col.get("id") or "")
        for col in columns
        if isinstance(col, dict)
    ]
    columns_hint = (
        f"\nThis table has columns: {', '.join(label for label in column_labels if label)}"
        if column_labels
        else ""
    )

    return f"""User wants to MODIFY an existing TABLE in their dashboard.

TARGET TABLE TO MODIFY:
- Table ID: {table_id}
- Title: {chart_mention.get('title', 'Untitled')}{columns_hint}
- Current Definition (columns, rows, and ranking/description logic):
```json
{existing_config_json}
```

User's modification request: {input_prompt}

{file_info}

IMPORTANT SCOPE RULE: You are modifying ONLY this one table. If multiple files are
available, use ONLY the file that contains the data relevant to this table (check
the column ids/labels from the definition above). Do NOT combine unrelated files.

WORKFLOW:
1. First, use the Python REPL to load the relevant source file and recompute the
   table rows (apply the requested ranking/filter/aggregation against real data).
2. Then output a dashboard JSON with ONLY the modified table.

You MUST output a valid JSON code block in this EXACT format:

```json
{{
  "dashboard": {{
    "title": "Table Modification",
    "description": "Modified table per user request"
  }},
  "metrics": [],
  "charts": [],
  "tables": [
    {{
      "id": "{table_id}",
      "title": "<table_title>",
      "description": "<table_description>",
      "layout": {{"x": 0, "y": 0, "w": 24, "h": 12, "minW": 12, "minH": 10}},
      "columns": [
        {{"id": "<column_id>", "label": "<column_header>", "type": "<text|number|currency|percent>"}}
      ],
      "data": [
        {{"<column_id>": "<computed_cell_value>"}}
      ]
    }}
  ],
  "insights": ["<insight about the modification>"]
}}
```

CRITICAL RULES:
- Keep the table ID as "{table_id}".
- Populate "data" rows with REAL computed values from Python analysis (never empty arrays).
- Output ONLY the modified table in the "tables" array; "charts" MUST be empty.
- You MUST output the JSON code block — do NOT just describe the changes in text."""


def _is_gemini_model(model: Any) -> bool:
    """Detect Gemini provider using the same model_name check used elsewhere."""
    model_name = getattr(model, "model_name", "") or getattr(model, "model", "")
    return str(model_name).startswith("gemini")


def _emit_chart_spec_structured(
    model, messages, state: AgentState
) -> ChartModificationResult:
    """Force the chart-mod final emission through provider structured output.

    Takes the UN-tool-bound base model. For OpenAI, prefers strict JSON-schema
    and retries via function-calling on failure. For Gemini, uses the default
    structured-output method (maps to ``response_schema``).

    Records the successful method into
    ``state.working_memory.tool_outputs["structured_output_method"]``.

    Returns the validated ``ChartModificationResult``. Any failure is wrapped in
    ``StructuredEmissionError`` so the caller can fall back.
    """
    if _is_gemini_model(model):
        try:
            structured = model.with_structured_output(ChartModificationResult)
            result = _llm_invoke(
                structured.invoke, messages, label="Chart-mod structured (gemini)"
            )
            state.working_memory.tool_outputs["structured_output_method"] = (
                "gemini_response_schema"
            )
            return result
        except Exception as exc:
            raise StructuredEmissionError(
                f"Gemini structured output failed: {exc}"
            ) from exc

    # OpenAI: prefer strict json_schema, fall back to function_calling.
    try:
        structured = model.with_structured_output(
            ChartModificationResult, method="json_schema"
        )
        result = _llm_invoke(
            structured.invoke, messages, label="Chart-mod structured (json_schema)"
        )
        state.working_memory.tool_outputs["structured_output_method"] = "json_schema"
        return result
    except Exception as schema_exc:
        logger.warning(
            f"json_schema structured output failed, retrying function_calling: {schema_exc}"
        )
        try:
            structured = model.with_structured_output(
                ChartModificationResult, method="function_calling"
            )
            result = _llm_invoke(
                structured.invoke,
                messages,
                label="Chart-mod structured (function_calling)",
            )
            state.working_memory.tool_outputs["structured_output_method"] = (
                "function_calling"
            )
            return result
        except Exception as fc_exc:
            raise StructuredEmissionError(
                f"OpenAI structured output failed (json_schema + function_calling): {fc_exc}"
            ) from fc_exc


def _emit_table_spec_structured(
    model, messages, state: AgentState
) -> TableModificationResult:
    """Force the table-mod final emission through provider structured output.

    Direct analog of ``_emit_chart_spec_structured`` but bound to
    ``TableModificationResult`` so a table edit stays a table (never coerced
    into a ChartSpec). Records the successful method and wraps any failure in
    ``StructuredEmissionError`` so the caller can fall back to regex extraction.
    """
    if _is_gemini_model(model):
        try:
            structured = model.with_structured_output(TableModificationResult)
            result = _llm_invoke(
                structured.invoke, messages, label="Table-mod structured (gemini)"
            )
            state.working_memory.tool_outputs["structured_output_method"] = (
                "gemini_response_schema"
            )
            return result
        except Exception as exc:
            raise StructuredEmissionError(
                f"Gemini structured output failed: {exc}"
            ) from exc

    try:
        structured = model.with_structured_output(
            TableModificationResult, method="json_schema"
        )
        result = _llm_invoke(
            structured.invoke, messages, label="Table-mod structured (json_schema)"
        )
        state.working_memory.tool_outputs["structured_output_method"] = "json_schema"
        return result
    except Exception as schema_exc:
        logger.warning(
            f"json_schema structured output failed, retrying function_calling: {schema_exc}"
        )
        try:
            structured = model.with_structured_output(
                TableModificationResult, method="function_calling"
            )
            result = _llm_invoke(
                structured.invoke,
                messages,
                label="Table-mod structured (function_calling)",
            )
            state.working_memory.tool_outputs["structured_output_method"] = (
                "function_calling"
            )
            return result
        except Exception as fc_exc:
            raise StructuredEmissionError(
                f"OpenAI structured output failed (json_schema + function_calling): {fc_exc}"
            ) from fc_exc


def _chart_spec_missing_keys(parsed: Dict[str, Any]) -> list:
    """Return the required ChartSpec keys missing/invalid in ``parsed``.

    Validates against ``ChartSpec``; on validation failure, reports the subset
    of required keys flagged by pydantic (plus any absent outright).
    """
    if not isinstance(parsed, dict):
        return list(_CHART_SPEC_REQUIRED_KEYS)

    try:
        ChartSpec.model_validate(parsed)
        return []
    except Exception as exc:
        from pydantic import ValidationError

        invalid = set()
        if isinstance(exc, ValidationError):
            for err in exc.errors():
                if err.get("loc"):
                    top = err["loc"][0]
                    if top in _CHART_SPEC_REQUIRED_KEYS:
                        invalid.add(top)
        # Also flag keys absent from the dict entirely.
        for key in _CHART_SPEC_REQUIRED_KEYS:
            if key not in parsed:
                invalid.add(key)
        return [key for key in _CHART_SPEC_REQUIRED_KEYS if key in invalid]


def _repair_chart_json(
    quick_model, parsed: Dict[str, Any], missing: list, state: AgentState
) -> Optional[Dict[str, Any]]:
    """Cheap, single-shot targeted repair of a chart dict missing keys.

    Uses the quick/cheap model with ``with_structured_output(ChartSpec)`` to
    coerce ``parsed`` into a valid ChartSpec, supplying a grounding excerpt of
    allowed computed values. Guarded by a ``repair_attempted`` flag in
    tool_outputs so it never runs twice. Returns the repaired chart dict on
    success, otherwise ``None``.
    """
    if state.working_memory.tool_outputs.get("repair_attempted"):
        logger.info("Chart repair already attempted, skipping second repair")
        return None
    state.working_memory.tool_outputs["repair_attempted"] = True

    if quick_model is None:
        quick_model = get_model_for_quick_agent()

    grounding_excerpt = _build_data_grounding_context(state)[:4000]
    repair_prompt = f"""This chart JSON is missing or has invalid required keys: {missing}.

Here are the allowed computed values you may use (do NOT fabricate values):
{grounding_excerpt}

Here is the broken chart JSON:
```json
{json.dumps(parsed, ensure_ascii=False, indent=2)}
```

Return ONLY a corrected chart object matching the schema, filling the missing keys
using real values from the allowed values above. Preserve the existing id."""

    try:
        structured = quick_model.with_structured_output(ChartSpec)
        repaired = _llm_invoke(
            structured.invoke,
            [HumanMessage(content=repair_prompt)],
            label="Chart-mod repair",
        )
        repaired_dict = (
            repaired.model_dump() if hasattr(repaired, "model_dump") else repaired
        )
        if _chart_spec_missing_keys(repaired_dict):
            logger.warning("Chart repair still missing required keys")
            return None
        return repaired_dict
    except Exception as exc:
        logger.warning(f"Chart repair failed: {exc}")
        return None


def _chart_has_no_datapoints(chart_obj: Any) -> bool:
    """True when a chart has no datasets, or every dataset's ``data`` is empty.

    A chart modification that yields zero datapoints is unambiguously broken (a
    blank chart) — distinct from a restyle that legitimately reuses non-empty
    data. Used to reject empty emissions and force a recompute.
    """
    if not isinstance(chart_obj, dict):
        return True
    datasets = chart_obj.get("datasets")
    if not isinstance(datasets, list) or len(datasets) == 0:
        return True
    for dataset in datasets:
        if isinstance(dataset, dict):
            data = dataset.get("data")
            if isinstance(data, list) and len(data) > 0:
                return False
    return True


def _finalize_table_mod_emission(
    state: AgentState, model, messages, content: str, target_id: Optional[str]
) -> Optional[Dict[str, Any]]:
    """Produce the table-mod dashboard JSON, keeping a table a table.

    Fallback ordering mirrors the chart path:
      a. structured output bound to ``TableModificationResult`` → wrap + return.
      b. on failure → regex extraction; extract the modified table object.
      c. on no usable table → return None so the existing retry loop runs.

    The emitted table's ``id`` is force-preserved to ``target_id`` so the server
    merge replaces (not appends) the table.

    Regex-first: the reasoning loop usually already produced a valid table, so we
    accept that (zero extra LLM cost) and only fall back to a structured emission
    when the regex output isn't a usable table.
    """

    def _table_obj_ok(obj: Any) -> bool:
        return (
            isinstance(obj, dict)
            and isinstance(obj.get("columns"), list)
            and len(obj.get("columns") or []) > 0
            and isinstance(obj.get("data"), list)
        )

    # a. FAST PATH: regex-extract the table the reasoning loop already produced.
    parsed = _extract_json_from_content(content)
    if parsed and "dashboard" not in parsed:
        if "tables" in parsed and isinstance(parsed.get("tables"), list):
            tables = parsed.get("tables") or []
            table_obj = tables[0] if tables else None
        else:
            table_obj = parsed
        if _table_obj_ok(table_obj):
            if target_id:
                table_obj["id"] = target_id
            logger.info("Table modification: emitted via regex fast-path")
            return _wrap_table_into_dashboard(table_obj)
    elif parsed and "dashboard" in parsed:
        # Already a full dashboard envelope (rare) — pass through.
        return parsed

    # b. FALLBACK: provider structured output bound to TableModificationResult.
    try:
        result = _emit_table_spec_structured(model, messages, state)
        table_dict = result.table.model_dump()
        if target_id:
            table_dict["id"] = target_id
        state.working_memory.chart_change_summary = result.change_summary.model_dump()
        state.working_memory.edit_provenance = result.data_provenance.model_dump()
        logger.info("Table modification: emitted via structured output (fallback)")
        return _wrap_table_into_dashboard(table_dict)
    except StructuredEmissionError as exc:
        logger.warning(f"Table structured emission failed: {exc}")

    # c. defer to the existing retry loop
    return None


def _finalize_chart_mod_emission(
    state: AgentState, model, quick_model, messages, content: str
) -> Optional[Dict[str, Any]]:
    """Produce the chart-mod dashboard JSON via the structured-output pipeline.

    Fast-path ordering (regex-first — the reasoning loop usually already emitted
    a valid chart, so we accept it with zero extra LLM cost):
      a. regex extraction → if a valid ChartSpec → wrap + return.
      b. full dashboard envelope (rare) → pass through.
      c. else provider structured output (base model) as a safety net.
      d. else single targeted repair of the regex chart.
      e. on continued failure → return None so the existing retry loop runs.

    The emitted component's ``id`` is force-preserved to the @-mention target id
    so the server merge replaces (not appends). Table edits are routed to
    ``_finalize_table_mod_emission`` so they stay tables.
    """
    chart_mention = state.chart_mentions[0] if state.chart_mentions else {}
    target_id = _mention_target_id(chart_mention)

    # Table edits must not be coerced into a ChartSpec.
    if _mention_is_table(chart_mention):
        return _finalize_table_mod_emission(state, model, messages, content, target_id)

    # a. FAST PATH: regex-extract the chart the reasoning loop already produced.
    parsed = _extract_json_from_content(content)
    chart_obj = None
    if parsed and "dashboard" not in parsed:
        if "charts" in parsed and isinstance(parsed.get("charts"), list):
            charts = parsed.get("charts") or []
            chart_obj = charts[0] if charts else None
        else:
            chart_obj = parsed
        if (
            isinstance(chart_obj, dict)
            and not _chart_spec_missing_keys(chart_obj)
            and not _chart_has_no_datapoints(chart_obj)
        ):
            if target_id:
                chart_obj["id"] = target_id
            logger.info("Chart modification: emitted via regex fast-path")
            return _wrap_chart_into_dashboard(chart_obj)
    elif parsed and "dashboard" in parsed:
        # b. Already a full dashboard envelope (rare for chart-mod) — pass through.
        return parsed

    # c. SAFETY NET: provider structured output on the un-tool-bound base model.
    try:
        result = _emit_chart_spec_structured(model, messages, state)
        chart_dict = result.chart.model_dump()
        if target_id:
            chart_dict["id"] = target_id
        state.working_memory.chart_change_summary = result.change_summary.model_dump()
        state.working_memory.edit_provenance = result.data_provenance.model_dump()
        logger.info("Chart modification: emitted via structured output (fallback)")
        return _wrap_chart_into_dashboard(chart_dict)
    except StructuredEmissionError as exc:
        logger.warning(f"Structured emission failed, attempting repair: {exc}")

    # d. REPAIR: single targeted repair of the regex chart, if we have one.
    if isinstance(chart_obj, dict):
        missing = _chart_spec_missing_keys(chart_obj)
        repaired = _repair_chart_json(quick_model, chart_obj, missing, state)
        if repaired is not None:
            if target_id:
                repaired["id"] = target_id
            return _wrap_chart_into_dashboard(repaired)

    # e. defer to the existing retry loop
    return None


def _extract_json_from_content(content: str) -> Dict[str, Any]:
    """Extract JSON from LLM response content."""
    if not content or not content.strip():
        return None

    try:
        # Search for JSON code blocks
        json_match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find any code block
            code_match = re.search(r"```\s*(.*?)\s*```", content, re.DOTALL)
            if code_match:
                json_str = code_match.group(1)
            else:
                # Use entire content
                json_str = content

        # Clean the JSON string
        cleaned_json = clean_json(json_str)

        # Parse JSON
        parsed = json.loads(cleaned_json)

        # Validate it's a dict
        if not isinstance(parsed, dict):
            logger.warning(f"Extracted JSON is not a dict, got type: {type(parsed)}")
            return None

        return parsed

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from content: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Error extracting JSON from content: {str(e)}")
        return None


def _extract_qa_visual_from_content(content: str) -> Dict[str, Any]:
    """Extract and normalize QA visual JSON from LLM response content."""
    parsed = _extract_json_from_content(content)
    if not parsed or not isinstance(parsed, dict):
        return None

    answer = parsed.get("answer") or parsed.get("content") or parsed.get("response")
    artifacts = parsed.get("artifacts") or parsed.get("visual_artifacts") or []

    # Be forgiving if the model returned a single artifact directly.
    if not artifacts and parsed.get("kind") in ("chart", "table"):
        artifacts = [parsed]

    if not isinstance(answer, str) or not isinstance(artifacts, list):
        return None

    normalized = []
    for idx, artifact in enumerate(artifacts[:3]):
        if not isinstance(artifact, dict):
            continue
        normalized_artifact = dict(artifact)
        kind = str(normalized_artifact.get("kind") or "").lower()
        if kind not in ("chart", "table"):
            if normalized_artifact.get("columns") and normalized_artifact.get("data"):
                kind = "table"
            elif normalized_artifact.get("datasets"):
                kind = "chart"
        if kind not in ("chart", "table"):
            continue
        normalized_artifact["kind"] = kind
        normalized_artifact["id"] = (
            normalized_artifact.get("id") or f"artifact_{idx + 1:03d}"
        )
        if kind == "chart":
            normalized_artifact["chart_type"] = (
                normalized_artifact.get("chart_type")
                or normalized_artifact.get("type")
                or "bar"
            )
        normalized.append(normalized_artifact)

    if not normalized:
        return None

    return {"answer": answer.strip(), "artifacts": normalized}


_DASHBOARD_GRID_COLS = 24
_CHART_MIN_H_FLOORS = {
    "line": 12,
    "area": 12,
    "pie": 12,
    "donut": 12,
    "radial_bar": 12,
    "treemap": 12,
    "sankey": 12,
    "bar": 10,
    "stacked_bar": 10,
    "stacked_column": 10,
    "scatter": 10,
    "composed": 10,
    "radar": 10,
    "funnel": 10,
    "geographic": 10,
}


def _layout_number(layout: Dict[str, Any], key: str) -> Optional[int]:
    value = layout.get(key)
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if int(value) != value:
        return None
    return int(value)


def _rects_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if a["x"] + a["w"] <= b["x"]:
        return False
    if a["x"] >= b["x"] + b["w"]:
        return False
    if a["y"] + a["h"] <= b["y"]:
        return False
    if a["y"] >= b["y"] + b["h"]:
        return False
    return True


def _component_min_h_floor(kind: str, component: Dict[str, Any]) -> int:
    if kind == "metric":
        return 4
    if kind == "table":
        return 10
    chart_type = str(component.get("chart_type") or "").lower()
    return _CHART_MIN_H_FLOORS.get(chart_type, 10)


def _validate_dashboard_layout_geometry(data: Dict[str, Any]) -> Dict[str, Any]:
    occupied: list[Dict[str, Any]] = []
    component_groups = (
        ("metric", data.get("metrics", []) or []),
        ("chart", data.get("charts", []) or []),
        ("table", data.get("tables", []) or []),
    )

    for kind, components in component_groups:
        if not isinstance(components, list):
            return {"valid": False, "error": f"{kind}s is not a list"}

        for index, component in enumerate(components):
            if not isinstance(component, dict):
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] is not an object",
                }

            layout = component.get("layout")
            if not isinstance(layout, dict):
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] missing layout object",
                }

            values = {
                key: _layout_number(layout, key)
                for key in ("x", "y", "w", "h", "minW", "minH")
            }
            missing_or_invalid = [key for key, value in values.items() if value is None]
            if missing_or_invalid:
                return {
                    "valid": False,
                    "error": (
                        f"{kind}[{index}] layout has non-integer or missing values: "
                        f"{missing_or_invalid}"
                    ),
                }

            x = values["x"]
            y = values["y"]
            w = values["w"]
            h = values["h"]
            min_w = values["minW"]
            min_h = values["minH"]
            assert x is not None and y is not None and w is not None and h is not None
            assert min_w is not None and min_h is not None

            if x < 0 or y < 0:
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] layout x/y must be non-negative",
                }
            if min_w < 1 or min_w > _DASHBOARD_GRID_COLS:
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] layout minW={min_w} outside 1..24",
                }
            if w < 1 or w > _DASHBOARD_GRID_COLS:
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] layout w={w} outside 1..24",
                }
            if w < min_w:
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] layout w={w} < minW={min_w}",
                }
            if x + w > _DASHBOARD_GRID_COLS:
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] layout x+w={x + w} exceeds 24",
                }
            floor = _component_min_h_floor(kind, component)
            if min_h < floor:
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] layout minH={min_h} < required floor {floor}",
                }
            if h < min_h:
                return {
                    "valid": False,
                    "error": f"{kind}[{index}] layout h={h} < minH={min_h}",
                }

            rect = {
                "id": str(component.get("id") or f"{kind}_{index}"),
                "kind": kind,
                "index": index,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }
            for other in occupied:
                if _rects_overlap(rect, other):
                    return {
                        "valid": False,
                        "error": (
                            f"{kind}[{index}] layout overlaps "
                            f"{other['kind']}[{other['index']}]"
                        ),
                    }
            occupied.append(rect)

    return {"valid": True}


def _validate_dashboard_json(data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate dashboard JSON structure."""
    if not data:
        return {"valid": False, "error": "Dashboard data is empty"}

    if not isinstance(data, dict):
        return {
            "valid": False,
            "error": f"Dashboard data is not a dict, got {type(data)}",
        }

    # Check for required top-level keys
    required_keys = ["dashboard"]
    missing_keys = [key for key in required_keys if key not in data]

    if missing_keys:
        return {"valid": False, "error": f"Missing required keys: {missing_keys}"}

    # Check dashboard metadata
    dashboard_info = data.get("dashboard", {})
    if not isinstance(dashboard_info, dict):
        return {"valid": False, "error": "Dashboard metadata is not a dict"}

    if not dashboard_info.get("title"):
        return {"valid": False, "error": "Dashboard missing title"}

    # Check for at least one visualization component
    has_charts = bool(data.get("charts"))
    has_metrics = bool(data.get("metrics"))
    has_tables = bool(data.get("tables"))

    if not (has_charts or has_metrics or has_tables):
        return {"valid": False, "error": "Dashboard has no visualization components"}

    layout_validation = _validate_dashboard_layout_geometry(data)
    if not layout_validation.get("valid"):
        return layout_validation

    return {"valid": True}


def _validate_qa_response(content: str) -> Dict[str, Any]:
    """Validate Q&A response."""
    if not content:
        return {"valid": False, "error": "Q&A response is empty"}

    if not isinstance(content, str):
        return {
            "valid": False,
            "error": f"Q&A response is not a string, got {type(content)}",
        }

    if len(content.strip()) < 10:
        return {"valid": False, "error": "Q&A response is too short"}

    return {"valid": True}


def _validate_answer_with_visual(
    output: Dict[str, Any], state: AgentState
) -> Dict[str, Any]:
    """Validate inline QA visual response shape."""
    content_validation = _validate_qa_response(output.get("content"))
    if not content_validation.get("valid"):
        return content_validation

    if state.file_paths:
        successful_python_calls = [
            result
            for result in state.working_memory.python_execution_results
            if result.get("success")
            and str(result.get("tool_name", "")).lower() == "python_repl"
        ]
        if not successful_python_calls:
            state.working_memory.tool_outputs["force_more_tools"] = (
                "You must use Python_REPL to load and analyze the data before producing "
                "a QA visual response. Compute and print every value that appears in "
                "the answer or visual artifacts, then return the required JSON."
            )
            return {
                "valid": False,
                "error": "QA visual response was generated without Python analysis",
            }

    artifacts = output.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        return {"valid": False, "error": "QA visual response has no artifacts"}

    if len(artifacts) > 3:
        return {"valid": False, "error": "QA visual response has more than 3 artifacts"}

    for idx, artifact in enumerate(artifacts):
        if not isinstance(artifact, dict):
            return {"valid": False, "error": f"Artifact {idx + 1} is not an object"}
        kind = artifact.get("kind")
        if kind == "chart":
            datasets = artifact.get("datasets") or []
            if not isinstance(datasets, list) or not datasets:
                return {
                    "valid": False,
                    "error": f"Chart artifact {idx + 1} has no datasets",
                }
            has_points = any(isinstance(ds, dict) and ds.get("data") for ds in datasets)
            if not has_points:
                return {
                    "valid": False,
                    "error": f"Chart artifact {idx + 1} has no data points",
                }
        elif kind == "table":
            columns = artifact.get("columns") or []
            rows = artifact.get("data") or []
            if not columns or not rows:
                return {
                    "valid": False,
                    "error": f"Table artifact {idx + 1} has no columns or rows",
                }
        else:
            return {
                "valid": False,
                "error": f"Artifact {idx + 1} has unsupported kind: {kind}",
            }

    return {"valid": True}


def _build_conversation_history_from_executions(state: AgentState) -> list:
    """
    Build LangChain message history from previous tool executions.

    This function converts stored tool execution results into proper LangChain
    message format (AIMessage + ToolMessage pairs) so the agent can "see" and
    "remember" what actions it has already taken.

    This prevents the "amnesia bug" where the agent repeats the same action
    infinitely because it doesn't see the results of previous executions.

    Args:
        state: Current agent state with execution history

    Returns:
        List of LangChain messages (AIMessage + ToolMessage pairs)
    """
    messages = []

    # Get all tool execution results
    execution_results = state.working_memory.python_execution_results

    if not execution_results:
        return messages

    # Group executions by iteration (each reasoning->execution cycle)
    # We need to pair AIMessage (tool call) with ToolMessage (result)
    execution_batches = []
    current_batch = []

    for result in execution_results:
        current_batch.append(result)
        # Each batch represents one REASONING->EXECUTION cycle
        # For simplicity, we'll treat each result as a separate message pair

    # Convert each execution result into AIMessage + ToolMessage pair
    for result in execution_results:
        tool_name = result.get("tool_name", "unknown")
        tool_call_id = result.get("tool_call_id", "unknown")
        tool_args = result.get("tool_args", {})  # Get original arguments
        output = result.get("output", "")
        success = result.get("success", False)
        error = result.get("error")

        # Create AIMessage with tool call (what the agent decided to do)
        # We reconstruct the tool call from the stored result
        ai_message = AIMessage(
            content="",  # The reasoning was in the decision, we just show the tool call
            tool_calls=[
                {
                    "name": tool_name,
                    "args": tool_args,  # Include the actual arguments used
                    "id": tool_call_id,
                }
            ],
        )

        # Create ToolMessage with result (what happened when we executed it)
        if success:
            # Truncate long outputs to avoid context window bloat
            truncated_output = str(output)[:500] if output else "No output"
            tool_message = ToolMessage(
                content=truncated_output,
                tool_call_id=tool_call_id,
            )
        else:
            # For errors, show the error message
            error_msg = error if error else "Execution failed"
            tool_message = ToolMessage(
                content=f"Error: {error_msg}",
                tool_call_id=tool_call_id,
            )

        messages.append(ai_message)
        messages.append(tool_message)

    # Limit history to prevent context window explosion
    # Keep only the last 6 message pairs (12 messages = 6 tool call cycles)
    max_messages = 12
    if len(messages) > max_messages:
        messages = messages[-max_messages:]

    return messages


def _build_data_grounding_context(state: AgentState) -> str:
    """
    Build a summary of all data values extracted from Python REPL outputs,
    plus actual unique string values from the CSV files.

    This helps prevent hallucination by giving the LLM a clear reference
    of what actual values were computed during analysis AND the real
    string values available in the data.

    Args:
        state: Current agent state with tool execution results

    Returns:
        String summary of key data points from tool outputs and CSV data
    """
    import pandas as pd

    execution_results = state.working_memory.python_execution_results

    grounding_lines = []
    grounding_lines.append("=" * 60)
    grounding_lines.append("🚨 ALLOWED VALUES - USE ONLY THESE IN YOUR JSON 🚨")
    grounding_lines.append("=" * 60)

    # Part 1: Extract unique string values directly from CSV files
    if state.file_paths:
        grounding_lines.append("")
        grounding_lines.append("📋 ACTUAL STRING VALUES FROM YOUR DATA FILES:")
        grounding_lines.append("-" * 50)
        grounding_lines.append("Copy these EXACTLY when creating labels/names:")
        grounding_lines.append("")

        for file_path in state.file_paths:
            if file_path and os.path.exists(file_path):
                try:
                    df = pd.read_csv(
                        file_path, nrows=1000
                    )  # Read more rows for better coverage
                    file_name = os.path.basename(file_path)
                    grounding_lines.append(f"File: {file_name}")

                    for col in df.columns:
                        # Only process string/object columns
                        if df[col].dtype == "object":
                            unique_vals = df[col].dropna().unique()  # ALL unique values
                            if len(unique_vals) > 0:
                                # Show all values, comma separated
                                vals_str = ", ".join([f'"{v}"' for v in unique_vals])
                                grounding_lines.append(f"  • {col}: {vals_str}")

                    grounding_lines.append("")
                except Exception as e:
                    logger.warning(f"Could not extract values from {file_path}: {e}")

    # Part 2: Tool output values
    if execution_results:
        grounding_lines.append("")
        grounding_lines.append("📊 VALUES FROM YOUR PYTHON ANALYSIS:")
        grounding_lines.append("-" * 50)

        for idx, result in enumerate(execution_results):
            if result.get("success") and result.get("output"):
                output = result.get("output", "")
                # Truncate very long outputs but keep enough context
                if len(output) > 2000:
                    output = output[:2000] + "\n... (truncated)"

                grounding_lines.append(f"--- Tool Call {idx + 1} Output ---")
                grounding_lines.append(output)
                grounding_lines.append("")
    else:
        grounding_lines.append("")
        grounding_lines.append(
            "⚠️ No tool outputs yet - you MUST use Python_REPL first!"
        )

    grounding_lines.append("=" * 60)
    grounding_lines.append("⚠️ CRITICAL: If a value is NOT listed above,")
    grounding_lines.append("   DO NOT use it - it would be FABRICATED!")
    grounding_lines.append("=" * 60)

    return "\n".join(grounding_lines)


def _get_minimum_tool_executions_required(state: AgentState) -> int:
    """
    Determine minimum tool executions required before allowing final response.

    For dashboard mode with files, requires at least 2 tool executions per file
    to ensure proper loading and analysis of each file.

    Args:
        state: Current agent state

    Returns:
        Minimum number of tool executions required
    """
    num_files = len(state.file_paths) if state.file_paths else 0

    if num_files == 0:
        return 0  # Q&A mode without files
    else:
        # Require 2 tool executions per file (load + analyze each)
        # Minimum of 2 even for single file
        return max(2, num_files * 2)


def _validate_dashboard_data(dashboard_json: dict, state: AgentState) -> dict:
    """
    Validate that dashboard data appears to come from actual tool outputs.

    This is a heuristic check - we look for signs of hallucinated data,
    including both numeric values and string labels/names.

    Args:
        dashboard_json: Generated dashboard configuration
        state: Current agent state with tool execution history

    Returns:
        Dict with 'valid': bool, 'warnings': list, 'errors': list
    """
    import re
    import pandas as pd

    warnings = []
    metric_warnings = []
    errors = []

    # Get all tool output text for reference
    all_outputs = ""
    for result in state.working_memory.python_execution_results:
        if result.get("success") and result.get("output"):
            all_outputs += result.get("output", "") + "\n"

    all_outputs_lower = all_outputs.lower()

    # Also load actual data from CSV files for validation
    # This is important because LLM reads data directly via pandas
    all_csv_values = set()
    actual_column_names: list[str] = []  # raw column names for title integrity check
    for file_path in state.file_paths or []:
        if file_path and os.path.exists(file_path):
            try:
                df = pd.read_csv(
                    file_path, nrows=1000
                )  # Read first 1000 rows for validation
                actual_column_names.extend([c.lower() for c in df.columns.tolist()])
                for col in df.columns:
                    # Get unique string values from each column
                    unique_vals = df[col].dropna().astype(str).unique()
                    for val in unique_vals:
                        if (
                            len(val) >= 3
                            and not val.replace(",", "")
                            .replace(".", "")
                            .replace("-", "")
                            .isdigit()
                        ):
                            all_csv_values.add(val.lower().strip())
            except Exception as e:
                logger.warning(f"Could not read {file_path} for validation: {e}")

    all_csv_values_str = " ".join(all_csv_values)

    # --- Column-integrity check ---
    # Detect fabricated metric/chart titles that have no link to actual column names.
    # We flag well-known "invented SaaS metrics" that don't appear in the CSV columns.
    FABRICATED_METRIC_KEYWORDS = {
        "revenue",
        "ad spend",
        "ad_spend",
        "conversions",
        "impressions",
        "ctr",
        "click-through",
        "roas",
        "cpm",
        "cpc",
        "ltv",
        "arpu",
        "mrr",
        "arr",
        "churn",
        "campaign type",
        "industry",
        "country",
        "region",
    }
    if actual_column_names:
        col_blob = " ".join(actual_column_names)
        dashboard_metrics = dashboard_json.get("metrics", [])
        dashboard_charts = dashboard_json.get("charts", [])
        for item in [*dashboard_metrics, *dashboard_charts]:
            title = (item.get("title") or "").lower()
            for kw in FABRICATED_METRIC_KEYWORDS:
                if kw in title:
                    # Check whether the keyword has any foothold in the actual column names
                    if kw not in col_blob and kw.replace(" ", "_") not in col_blob:
                        warnings.append(
                            f"Metric/chart title '{item.get('title')}' references '{kw}' "
                            f"but no such column exists in the CSV (columns: {actual_column_names}). "
                            f"This is likely hallucinated data."
                        )

    if not all_outputs and not all_csv_values:
        errors.append(
            "No tool outputs or data files found - dashboard data may be fabricated"
        )
        return {"valid": False, "warnings": warnings, "errors": errors}

    # Common generic labels that are likely fabricated if not in tool output
    # These are words that LLMs tend to make up
    suspicious_patterns = [
        r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\b",  # "John Smith", "Alice Johnson" pattern
        r"\bSeller\s+[A-Z]\b",  # "Seller A", "Seller B" pattern
        r"\bProduct\s+[A-Z]\b",  # "Product A", "Product B" pattern
        r"\bCategory\s+\d+\b",  # "Category 1", "Category 2" pattern
    ]

    def is_label_in_data(label: str) -> bool:
        """Check if a label appears in tool outputs OR actual CSV data."""
        if not label or len(label) < 3:
            return True  # Skip very short labels

        label_lower = label.lower().strip()

        # Check in tool outputs
        if (label_lower in all_outputs_lower) or (all_outputs_lower in label_lower):
            return True

        # Partial match in CSV values (for truncated or slightly different values)
        if (label_lower in all_csv_values_str) or (all_csv_values_str in label_lower):
            return True

        # Check if it's a common word (dates, months, etc.) - allow these
        common_words = {
            "jan",
            "feb",
            "mar",
            "apr",
            "may",
            "jun",
            "jul",
            "aug",
            "sep",
            "oct",
            "nov",
            "dec",
            "january",
            "february",
            "march",
            "april",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
            "q1",
            "q2",
            "q3",
            "q4",
            "total",
            "average",
            "sum",
            "count",
            "other",
            "unknown",
        }
        if label_lower in common_words:
            return True

        # Check for date patterns (2022-01, 2023-05-15, etc.)
        if re.match(r"\d{4}[-/]\d{2}([-/]\d{2})?", label):
            return True

        return False

    def extract_labels_from_data(data: list) -> list:
        """Extract all string labels from chart data."""
        labels = []
        for item in data:
            if isinstance(item, dict):
                label = item.get("label") or item.get("name") or item.get("category")
                if label and isinstance(label, str):
                    labels.append(label)
        return labels

    # Check metrics
    metrics = dashboard_json.get("metrics", [])
    for metric in metrics:
        value = str(metric.get("value", ""))
        title = metric.get("title", "Unknown")

        # Extract numeric part from value (e.g., "$1,234.56" -> "1234.56")
        numbers = re.findall(r"[\d,]+\.?\d*", value)

        for num in numbers:
            clean_num = num.replace(",", "")
            if len(clean_num) > 3:  # Only check significant numbers
                # Check if this number appears somewhere in tool outputs
                if clean_num not in all_outputs and num not in all_outputs:
                    metric_warnings.append(
                        f"Metric '{title}' value '{value}' may be fabricated - not found in tool outputs"
                    )

    # Check charts
    charts = dashboard_json.get("charts", [])
    for chart in charts:
        chart_id = chart.get("id", "unknown")
        chart_title = chart.get("title", chart_id)
        datasets = chart.get("datasets", [])

        for dataset in datasets:
            data = dataset.get("data", [])
            dataset_label = dataset.get("label", "unknown")

            # Extract and validate string labels
            labels = extract_labels_from_data(data)
            fabricated_labels = []

            for label in labels:
                if not is_label_in_data(label):
                    fabricated_labels.append(label)

            # If more than 30% of labels are not found, likely fabricated
            if labels and len(fabricated_labels) > len(labels) * 0.3:
                warnings.append(
                    f"Chart '{chart_title}' dataset '{dataset_label}' has labels not found in data: "
                    f"{', '.join(fabricated_labels[:5])}{'...' if len(fabricated_labels) > 5 else ''}"
                )

            # Count suspiciously round numbers
            round_count = 0
            for item in data:
                val = item.get("value") if isinstance(item, dict) else item
                if isinstance(val, (int, float)):
                    # Check if it's a suspiciously round number (divisible by 100 or 1000)
                    if val > 100 and val % 100 == 0:
                        round_count += 1

            if len(data) > 3 and round_count > len(data) * 0.5:
                warnings.append(
                    f"Chart '{chart_title}' has suspiciously many round numbers - may be fabricated"
                )

    # Check tables
    tables = dashboard_json.get("tables", [])
    for table in tables:
        table_id = table.get("id", "unknown")
        table_title = table.get("title", table_id)
        rows = table.get("rows", []) or table.get("data", [])

        # Check sample of string values in table rows
        fabricated_values = []
        checked_count = 0

        for row in rows[:10]:  # Check first 10 rows
            if isinstance(row, dict):
                for key, val in row.items():
                    if (
                        isinstance(val, str)
                        and len(val) > 3
                        and not val.replace(",", "").replace(".", "").isdigit()
                    ):
                        checked_count += 1
                        if not is_label_in_data(val):
                            fabricated_values.append(val)

        if checked_count > 0 and len(fabricated_values) > checked_count * 0.3:
            warnings.append(
                f"Table '{table_title}' has values not found in data: "
                f"{', '.join(fabricated_values[:3])}{'...' if len(fabricated_values) > 3 else ''}"
            )

    valid = len(errors) == 0

    return {
        "valid": valid,
        "warnings": warnings,
        "metric_warnings": metric_warnings,
        "errors": errors,
    }


def _successful_repl_outputs(state: AgentState) -> list:
    """Return the output text of every successful Python REPL execution."""
    outputs = []
    for result in state.working_memory.python_execution_results:
        if result.get("success") and result.get("output"):
            outputs.append(str(result.get("output", "")))
    return outputs


def _count_successful_repl_runs(state: AgentState) -> int:
    """Count REPL executions that completed successfully with output."""
    return len(_successful_repl_outputs(state))


def _collect_repl_numeric_values(state: AgentState) -> set:
    """Extract every numeric token printed by successful REPL runs.

    Tokens match ``-?\\d[\\d,]*\\.?\\d*`` and are comma-normalized to float.
    Returns the set of floats (best-effort; unparseable tokens are skipped).
    """
    numeric_values: set = set()
    token_pattern = re.compile(r"-?\d[\d,]*\.?\d*")
    for output in _successful_repl_outputs(state):
        for token in token_pattern.findall(output):
            cleaned = token.replace(",", "").rstrip(".")
            if not cleaned or cleaned in ("-", "."):
                continue
            try:
                numeric_values.add(float(cleaned))
            except ValueError:
                continue
    return numeric_values


def _collect_repl_string_values(state: AgentState) -> set:
    """Extract quoted/label-like strings from successful REPL outputs.

    Optionally unions in cached CSV column uniques from working_memory if such
    a cheap source already exists. All values are lowercased and stripped.
    """
    string_values: set = set()
    quoted_pattern = re.compile(r"['\"]([^'\"]{1,80})['\"]")
    for output in _successful_repl_outputs(state):
        for match in quoted_pattern.findall(output):
            cleaned = match.strip().lower()
            if cleaned:
                string_values.add(cleaned)

    # Optional cheap union: reuse cached CSV uniques if a prior node stashed them.
    cached_uniques = state.working_memory.tool_outputs.get("csv_unique_values")
    if isinstance(cached_uniques, (list, set, tuple)):
        for value in cached_uniques:
            if isinstance(value, str) and value.strip():
                string_values.add(value.strip().lower())

    return string_values


def _value_traces_to_repl(
    value: float, repl_numeric: set, repl_outputs_text: str
) -> bool:
    """Decide whether a single chart datapoint traces to REPL output.

    MATCHED if any of:
      * exact match (after comma-normalization) to a printed numeric value,
      * the value rounds to a printed value at 0, 1, or 2 decimals,
      * a reasonably-formatted string form of the value appears as a substring
        of the concatenated REPL output text.
    """
    # Exact match against printed numerics.
    if value in repl_numeric:
        return True

    # Rounded match: chart value (or printed value) rounds to the other at
    # 0/1/2 decimals. Handles "120.0" emitted from a printed "120" and vice versa.
    for decimals in (0, 1, 2):
        rounded_value = round(value, decimals)
        if rounded_value in repl_numeric:
            return True
        for printed in repl_numeric:
            if round(printed, decimals) == rounded_value:
                return True

    # Substring match against raw output text using compact string forms.
    candidates = set()
    candidates.add(repr(value))
    if value == int(value):
        candidates.add(str(int(value)))
    candidates.add(str(value))
    for decimals in (1, 2):
        candidates.add(f"{value:.{decimals}f}")
    for candidate in candidates:
        if candidate and candidate in repl_outputs_text:
            return True

    return False


def _extract_chart_values(chart_spec_dict: dict) -> list:
    """Collect all numeric ``dataset.data[].value`` datapoints from a chart."""
    values: list = []
    for dataset in chart_spec_dict.get("datasets", []) or []:
        if not isinstance(dataset, dict):
            continue
        for item in dataset.get("data", []) or []:
            raw_value = item.get("value") if isinstance(item, dict) else item
            if isinstance(raw_value, bool):
                continue
            if isinstance(raw_value, (int, float)):
                values.append(float(raw_value))
    return values


def _extract_chart_labels(chart_spec_dict: dict) -> list:
    """Collect string labels from a chart's datasets for soft validation."""
    labels: list = []
    for dataset in chart_spec_dict.get("datasets", []) or []:
        if not isinstance(dataset, dict):
            continue
        for item in dataset.get("data", []) or []:
            if isinstance(item, dict):
                label = item.get("label") or item.get("name") or item.get("category")
                if isinstance(label, str) and label.strip():
                    labels.append(label.strip())
    return labels


def _extract_modified_chart(output_data) -> Optional[dict]:
    """Pull the single modified chart out of a chart-modification output.

    The chart-mod output's ``data`` is the dashboard wrapper, i.e.
    ``{... "charts": [chart]}``. Returns the first chart dict, or ``None`` if
    the shape differs (handled gracefully by the caller).
    """
    if isinstance(output_data, dict):
        charts = output_data.get("charts")
        if isinstance(charts, list) and charts and isinstance(charts[0], dict):
            return charts[0]
        # Tolerate a bare chart object that already has datasets.
        if isinstance(output_data.get("datasets"), list):
            return output_data
    return None


def _validate_chart_modification_data(chart_spec_dict: dict, state: AgentState) -> dict:
    """Scoped anti-hallucination check for a single modified chart.

    Verifies that the chart's numeric datapoints trace back to printed Python
    REPL values. Unlike the full-dashboard authenticity path, this is tuned to
    avoid false-positives on legitimate restyle-only edits (e.g. "make it a line
    chart") that reuse pre-existing values without re-running analysis.

    Returns ``{valid, errors, warnings, unmatched_ratio}``.
    """
    errors: list = []
    warnings: list = []

    # Empty data is unambiguously broken (a blank chart) — hard-fail regardless
    # of whether the REPL ran, so it can never be excused as a "restyle".
    if _chart_has_no_datapoints(chart_spec_dict):
        errors.append(
            "The modified chart has NO datapoints (every dataset is empty) — "
            "it would render blank. Re-run the Python analysis and populate "
            "every series with REAL computed values."
        )
        return {
            "valid": False,
            "errors": errors,
            "warnings": warnings,
            "unmatched_ratio": 1.0,
            "empty_chart": True,
        }

    successful_runs = _count_successful_repl_runs(state)
    chart_values = _extract_chart_values(chart_spec_dict)
    total_values = len(chart_values)

    # No analysis was re-run: this is almost certainly a restyle that reuses the
    # existing chart's values. Skip the hard-fail to avoid false positives.
    if successful_runs == 0:
        warnings.append(
            "No successful Python REPL runs for this edit — treating it as a "
            "restyle and skipping data-authenticity hard checks."
        )
        return {
            "valid": True,
            "errors": errors,
            "warnings": warnings,
            "unmatched_ratio": 0.0,
        }

    repl_numeric = _collect_repl_numeric_values(state)
    repl_outputs_text = "\n".join(_successful_repl_outputs(state))

    unmatched = [
        value
        for value in chart_values
        if not _value_traces_to_repl(value, repl_numeric, repl_outputs_text)
    ]
    unmatched_ratio = (len(unmatched) / total_values) if total_values else 0.0

    # Labels are validated softly — mismatches are warnings only, never failures.
    repl_strings = _collect_repl_string_values(state)
    if repl_strings:
        unmatched_labels = [
            label
            for label in _extract_chart_labels(chart_spec_dict)
            if label.lower() not in repl_strings
            and label.lower() not in repl_outputs_text.lower()
        ]
        if unmatched_labels:
            warnings.append(
                "Chart labels not found in Python analysis output: "
                + ", ".join(unmatched_labels[:5])
                + ("..." if len(unmatched_labels) > 5 else "")
            )

    if unmatched_ratio > CHART_MOD_AUTHENTICITY_FAIL_RATIO:
        errors.append(
            f"{len(unmatched)}/{total_values} chart datapoints "
            f"({unmatched_ratio:.0%}) do not trace to any Python analysis "
            f"output — values appear fabricated. Examples: "
            + ", ".join(str(value) for value in unmatched[:5])
        )
        return {
            "valid": False,
            "errors": errors,
            "warnings": warnings,
            "unmatched_ratio": unmatched_ratio,
        }

    if unmatched_ratio > 0:
        warnings.append(
            f"{len(unmatched)}/{total_values} chart datapoints "
            f"({unmatched_ratio:.0%}) could not be traced to Python analysis "
            f"output, but this is within the accepted tolerance."
        )

    return {
        "valid": True,
        "errors": errors,
        "warnings": warnings,
        "unmatched_ratio": unmatched_ratio,
    }
