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
import concurrent.futures as _futures
from datetime import datetime
from typing import Callable, Any, Dict, Optional

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage

from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    ActionRequest,
    WorkflowHistoryEntry,
)
from morpheus.tools.python_repl.tool import PythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.models.base import get_model_for_agent, get_model_for_quick_agent
from utils.logger import logger
from utils.postprocess import clean_json

# ---------------------------------------------------------------------------
# Thread-safe LLM timeout helper
# ---------------------------------------------------------------------------
# signal.SIGALRM only works in the main thread and crashes in FastAPI background
# tasks. concurrent.futures gives us a real timeout for any thread.
_LLM_EXECUTOR = _futures.ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm_call")


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
        logger.info(f"[Usage] {tokens} tokens (total: {state.working_memory.total_tokens})")

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
            logger.info("[START] All input files are header-only / empty — short-circuiting to Q&A message")
            state.working_memory.tool_outputs["early_exit_empty_data"] = True
            state.working_memory.tool_outputs["route_decision"] = {
                "next_step": "qa",
                "reasoning": "No data rows in CSV inputs",
            }
            state.working_memory.qa_response = msg
            state.output = {"type": "message", "content": msg}
    
    return state


def node_explore_files(state: AgentState, model=None, **kwargs) -> AgentState:
    """
    EXPLORE_FILES Node: Data Profiler & Merge Strategist.
    
    This node profiles all available datasets and, when multiple files exist,
    analyzes their relationships to propose a concrete merge/join strategy.
    The merge strategy is stored in state.data_profile so the downstream
    reasoning node can act on it immediately.
    """
    logger.info("Running EXPLORE_FILES node")

    if not state.assets_dict:
        logger.info("No assets to explore. Proceeding to ROUTING.")
        return state

    if len(state.assets_dict) == 1:
        # Single file: run a deterministic pandas profiler so the REASONING node
        # receives accurate column/dtype/stats context instead of hallucinating.
        filename, filepath = next(iter(state.assets_dict.items()))
        try:
            import pandas as pd, os, math

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
                lines.append(f"  {c}: {df[c].nunique()} unique values, sample={df[c].iloc[0]}")

            # 3-row sample
            lines.append("Sample rows (first 3):")
            lines.append(df.head(3).to_string(index=False))

            state.data_profile = "\n".join(lines)
            logger.info("Single-file profile generated for %s", filename)
        except Exception as exc:
            logger.warning("Single-file profiler failed for %s: %s", filename, exc)
            state.data_profile = f"File: {filename} (profiling failed: {exc})"
        return state
        
    try:
        python_tool = PythonREPLTool()
        
        # INJECT locals/globals into the REPL environment
        if hasattr(python_tool.python_repl, 'globals') and isinstance(python_tool.python_repl.globals, dict):
            python_tool.python_repl.globals['file_paths'] = state.assets_dict
        elif hasattr(python_tool.python_repl, 'locals') and isinstance(python_tool.python_repl.locals, dict):
            python_tool.python_repl.locals['file_paths'] = state.assets_dict

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
            HumanMessage(content=f"The `file_paths` variable is already loaded in your Python environment with these files:\n{actual_paths_output}\n\n"
                         f"Please profile all datasets and produce the summary"
                         + (" with merge strategy." if has_multiple_files else ".")
                         + "\n\nRemember: do NOT redefine `file_paths`. Just use it directly.")
        ]
        
        logger.info("Calling Data Profiler LLM to explore files"
                     + (" (with merge analysis)" if has_multiple_files else "") + ".")
        
        # Allow more turns for multi-file merge analysis
        max_turns = 18 if has_multiple_files else 15
        tool_executed = False
        for turn in range(max_turns):
            response = _llm_invoke(model_with_tools.invoke, messages, label=f"Data Profiler turn {turn + 1}")
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
                        preview = result_str[:300] + "...\n[Output truncated]" if len(result_str) > 300 else result_str
                        logger.info(f"[Data Profiler] Execution result preview:\n{preview}")
                    elif tool_name.lower() == "get_available_chart_types":
                        logger.info("[Data Profiler] Tool check: get_available_chart_types")
                        result = get_available_chart_types.invoke({})
                    else:
                        logger.warning(f"[Data Profiler] Tool error: Unknown tool '{tool_name}'. Redirecting model to Python_REPL.")
                        result = (
                            f"ERROR: Tool '{tool_name}' does not exist in this environment. "
                            "You have ONLY TWO tools available: 'Python_REPL' (to run Python code) "
                            "and 'get_available_chart_types'. "
                            "STOP calling any other tool. Use 'Python_REPL' with a 'query' parameter to execute code."
                        )
                        
                    tool_msg = ToolMessage(content=str(result), tool_call_id=tool_call_id)
                    messages.append(tool_msg)
            else:
                if not tool_executed:
                    # LLM tried to respond without running any code — force it to use the tool
                    logger.warning(f"[Data Profiler] Turn {turn + 1}: LLM skipped tool usage. Nudging to use Python_REPL.")
                    messages.append(HumanMessage(
                        content="You MUST use the Python_REPL tool to actually load and inspect the files. "
                                "Do not summarize without executing code first. "
                                "Call Python_REPL now to profile the datasets."
                    ))
                    continue
                
                state.data_profile = str(response.content)
                # Log merge strategy if present, otherwise brief summary
                content_str = str(response.content)
                if "=== MERGE STRATEGY ===" in content_str:
                    merge_part = content_str[content_str.index("=== MERGE STRATEGY ==="):]
                    logger.info(f"[Data Profiler] Data exploration complete.\nMerge Strategy:\n{merge_part}")
                else:
                    logger.info(f"[Data Profiler] Data exploration complete. (No merge strategy — single file or unrelated datasets)")
                break
                
    except Exception as e:
        logger.error(f"Error exploring files: {str(e)}")
        state.data_profile = f"Exploration failed: {str(e)}"
        
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
        has_asset=has_asset,
        dashboard_count=dashboard_count
    )
    
    # Build router messages
    router_messages = [SystemMessage(content=router_prompt)]
    
    # Add recent conversation history (last 10 nodes)
    recent_history = state.user_state.conversation_history[-10:] if len(state.user_state.conversation_history) > 10 else state.user_state.conversation_history
    
    for node in recent_history:
        role = node.get("role", "").lower()
        content_text = _render_node_contents(node, state.user_state.dashboards)
        
        if role == "user" and content_text:
            router_messages.append(HumanMessage(content=content_text))
        elif role == "assistant" and content_text:
            router_messages.append(AIMessage(content=content_text))
    
    # Add current user prompt
    router_messages.append(HumanMessage(content=f"Current user request: {state.input_prompt}"))
    
    # Call router model
    try:
        from morpheus.workflows.analyze_csv.state_models import RouteDecision
        
        # Try structured output first
        try:
            router_model = model.with_structured_output(RouteDecision)
            route_decision = _llm_invoke(router_model.invoke, router_messages, label="Router structured output")
            _update_usage(state, route_decision)
            next_step = route_decision.next_step
            reasoning = route_decision.reasoning
        except Exception as e:
            logger.warning(f"Structured output failed, using fallback: {str(e)}")
            # Fallback: parse from response
            response = _llm_invoke(model.invoke, router_messages, label="Router fallback")
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


def node_reasoning(state: AgentState, model=None, model_with_tools=None, **kwargs) -> AgentState:
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
            fp for fp in state.file_paths 
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
                files_list = "\n".join([f"- File {i+1}: {fp}" for i, fp in enumerate(valid_files)])
                file_info += f"""Multiple CSV files available for analysis:
{files_list}

Load ALL files and combine/analyze as needed for the user's request. You can use pandas to merge, concatenate, or analyze files together."""

            file_info += "\n\nCRITICAL: When writing Python code, load the files using the paths pre-loaded in the `file_paths` dictionary object in your environment (e.g. `file_paths['users.csv']`)."

            # Check if this is a chart modification request
            is_chart_mod = route_decision.get("is_chart_modification", False)

            if is_chart_mod and state.chart_mentions:
                # Chart modification mode — inject target chart context
                chart_info = state.chart_mentions[0]
                existing_config = chart_info.get("config", {})
                existing_config_json = json.dumps(existing_config, ensure_ascii=False, indent=2)
                chart_id = chart_info.get('chart_id', 'chart_modified')

                # Try to identify which dataset columns the chart uses
                chart_columns_hint = ""
                if existing_config.get("axisConfig"):
                    ax = existing_config["axisConfig"]
                    cols = []
                    if ax.get("x_axis", {}).get("column"): cols.append(ax["x_axis"]["column"])
                    if ax.get("y_axis", {}).get("column"): cols.append(ax["y_axis"]["column"])
                    if cols:
                        chart_columns_hint = f"\nThis chart uses columns: {', '.join(cols)}"
                elif existing_config.get("datasets"):
                    # Extract labels from existing datasets
                    ds_labels = [ds.get("label", "") for ds in existing_config.get("datasets", [])]
                    if ds_labels:
                        chart_columns_hint = f"\nThis chart uses datasets: {', '.join(ds_labels)}"

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
- Output ONLY the modified chart in "charts" array. Other dashboard components will be preserved automatically.
- You MUST output the JSON code block — do NOT just describe the changes in text."""
            elif mode == "dashboard":
                if route_decision.get("is_dashboard_repair", False):
                    latest_dashboard_id = None
                    latest_dashboard = None
                    if state.user_state.dashboards:
                        latest_dashboard_id, latest_dashboard = list(state.user_state.dashboards.items())[-1]
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
    if mode in ("dashboard", "qa_visual") and len(state.working_memory.python_execution_results) >= 1:
        grounding_reminder = """
REMINDER: When you generate your JSON:
- Use ONLY values that came from your Python analysis above
- Every number must be traceable to a print() statement you executed
- If you did not compute a value with Python, do NOT include it in the output"""
        messages.append(HumanMessage(content=grounding_reminder))
    
    # Call LLM
    try:
        response = _llm_invoke(model_with_tools.invoke, messages, label="Reasoning node")
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
                reasoning=str(response.content) if response.content else "Tool execution"
            )
            
            # Store all tool calls for execution
            state.working_memory.tool_outputs["pending_tool_calls"] = response.tool_calls
            
            # 🔥 FIX: Also capture content if present alongside tool calls
            # Some LLMs return both tool calls AND content (the final answer)
            # We store this as a "pending_qa_response" to be used if no more tool calls come
            if response.content and len(str(response.content).strip()) > 20:
                logger.info(f"LLM returned content alongside tool call, storing as pending response: {str(response.content)[:50]}...")
                state.working_memory.tool_outputs["pending_qa_response"] = str(response.content)
            
        elif response.content:
            # Agent provided final output - proceed with finish
            action_request = ActionRequest(
                action_type="FINISH",
                reasoning="Agent provided final output",
            )
            
            # Store output in working memory
            if mode == "dashboard":
                # Extract JSON from content
                json_data = _extract_json_from_content(response.content)

                # Fallback for chart modification: if LLM returned a chart object
                # without the "dashboard" wrapper, wrap it into a valid dashboard JSON
                is_chart_mod = route_decision.get("is_chart_modification", False)
                if json_data and is_chart_mod and "dashboard" not in json_data:
                    # LLM returned chart object directly — wrap it
                    if "chart_type" in json_data or "datasets" in json_data:
                        logger.info("Chart modification: wrapping raw chart object into dashboard JSON")
                        json_data = {
                            "dashboard": {"title": "Chart Modification", "description": "Modified chart"},
                            "metrics": [],
                            "charts": [json_data],
                            "tables": [],
                            "insights": [],
                        }
                    elif "charts" in json_data and "dashboard" not in json_data:
                        logger.info("Chart modification: adding missing dashboard wrapper")
                        json_data["dashboard"] = {"title": "Chart Modification", "description": "Modified chart"}
                        json_data.setdefault("metrics", [])
                        json_data.setdefault("tables", [])
                        json_data.setdefault("insights", [])

                if json_data:
                    # Store JSON for validation in node_validation
                    state.working_memory.dashboard_json = json_data
                    
                    # Generate summary with simple LLM call
                    try:
                        summary = _generate_summary_for_dashboard(model, json_data, state.input_prompt)
                        state.working_memory.dashboard_summary = summary
                        logger.info(f"Generated summary: {summary[:50]}...")
                    except Exception as e:
                        logger.warning(f"Failed to generate summary: {e}, using default")
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
                    state.working_memory.visual_artifacts = visual_payload.get("artifacts", [])
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
                logger.info(f"Using pending Q&A response as final answer: {pending_qa[:50]}...")
                action_request = ActionRequest(
                    action_type="FINISH",
                    reasoning="Using content captured from previous tool call response",
                )
                state.working_memory.qa_response = pending_qa
                # Clear the pending response
                state.working_memory.tool_outputs.pop("pending_qa_response", None)
            else:
                # No pending response - force retry with first available file
                logger.warning("Empty response from model in REASONING node - forcing retry")
                
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
                state.working_memory.tool_outputs["pending_tool_calls"] = [{
                    "name": "python_repl",
                    "args": {"query": retry_query},
                    "id": f"retry_{state.iteration}"
                }]
        
        # Store pending action
        state.working_memory.tool_outputs["pending_action"] = action_request.dict()
        
        logger.info(f"Agent decided: {action_request.action_type} - {action_request.reasoning}")
        
    except Exception as e:
        error_str = str(e)
        logger.error(f"Error in REASONING node: {error_str}")
        if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
            state.working_memory.rate_limit_hits += 1
            if state.working_memory.rate_limit_hits >= 3:
                # Daily quota likely exhausted; fail fast with a clear message
                logger.error("REASONING: 3 consecutive 429s — quota exhausted, aborting")
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
                logger.warning(f"REASONING: rate limit (429) hit #{state.working_memory.rate_limit_hits}, sleeping {delay_s}s")
                time.sleep(delay_s)
        else:
            state.working_memory.rate_limit_hits = 0
        state.working_memory.errors.append({
            "node": "REASONING",
            "error": error_str,
            "timestamp": datetime.now().isoformat(),
        })

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
    
    # Get or create python tool
    if python_tool is None:
        python_tool = PythonREPLTool()
        
    # INJECT locals/globals into the REPL environment for the Execution node
    if state.assets_dict:
        if hasattr(python_tool.python_repl, 'globals') and isinstance(python_tool.python_repl.globals, dict):
            python_tool.python_repl.globals['file_paths'] = state.assets_dict
        elif hasattr(python_tool.python_repl, 'locals') and isinstance(python_tool.python_repl.locals, dict):
            python_tool.python_repl.locals['file_paths'] = state.assets_dict
    
    # Get pending action
    pending_action_dict = state.working_memory.tool_outputs.get("pending_action")
    if not pending_action_dict:
        logger.error("No pending action found in EXECUTION node")
        state.working_memory.errors.append({
            "node": "EXECUTION",
            "error": "No pending action found",
            "timestamp": datetime.now().isoformat(),
        })
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
                    elif tool_name.lower() == "get_available_chart_types":
                        tool_result = get_available_chart_types.invoke({})
                        success = True
                        error = None
                    else:
                        # Unknown tool — always redirect to Python_REPL
                        logger.warning(f"[Execution] Unknown tool called: '{tool_name}'. Redirecting model.")
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
                    state.working_memory.tool_outputs[f"tool_{tool_name}_{tool_call_id}"] = result_entry
                    
                    # Reset retry count on success
                    if success:
                        state.working_memory.retry_count = 0
                    else:
                        state.working_memory.retry_count += 1
                        state.working_memory.errors.append({
                            "tool": tool_name,
                            "error": error,
                            "timestamp": datetime.now().isoformat(),
                        })
                
                except SystemExit as e:
                    # LLM generated code that calls exit() or quit() - handle gracefully
                    error_msg = f"Code attempted to exit the interpreter (exit() or quit() called). This is not allowed. Please remove any exit() or quit() calls from your code."
                    logger.warning(f"SystemExit caught in tool execution: {e}")
                    
                    state.working_memory.python_execution_results.append({
                        "tool_name": tool_name,
                        "tool_call_id": tool_call_id,
                        "tool_args": tool_args,
                        "success": False,
                        "output": error_msg,
                        "error": error_msg,
                        "timestamp": datetime.now().isoformat(),
                    })
                    
                    state.working_memory.errors.append({
                        "tool": tool_name,
                        "error": error_msg,
                        "timestamp": datetime.now().isoformat(),
                    })
                    state.working_memory.retry_count += 1
                
                except Exception as e:
                    error_msg = f"Error executing {tool_name}: {str(e)}"
                    logger.error(error_msg)
                    
                    state.working_memory.python_execution_results.append({
                        "tool_name": tool_name,
                        "tool_call_id": tool_call_id,
                        "tool_args": tool_args,  # Store args for history reconstruction
                        "success": False,
                        "output": None,
                        "error": error_msg,
                        "timestamp": datetime.now().isoformat(),
                    })
                    
                    state.working_memory.errors.append({
                        "tool": tool_name,
                        "error": error_msg,
                        "timestamp": datetime.now().isoformat(),
                    })
                    state.working_memory.retry_count += 1
        
        elif action.action_type == "FINISH":
            # No execution needed, just log
            logger.info("Action type is FINISH, no execution needed")
        
        else:
            logger.warning(f"Unknown action type: {action.action_type}")
    
    except Exception as e:
        logger.error(f"Error in EXECUTION node: {str(e)}")
        state.working_memory.errors.append({
            "node": "EXECUTION",
            "action": action.action_type,
            "error": str(e),
            "timestamp": datetime.now().isoformat(),
        })
        state.working_memory.retry_count += 1
    
    # Clear pending action and tool calls
    state.working_memory.tool_outputs.pop("pending_action", None)
    state.working_memory.tool_outputs.pop("pending_tool_calls", None)
    
    return state


def node_reasoning_internal(state: AgentState, model=None, python_tool=None, **kwargs) -> AgentState:
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
        if hasattr(python_tool.python_repl, 'globals') and isinstance(python_tool.python_repl.globals, dict):
            python_tool.python_repl.globals['file_paths'] = state.assets_dict
        elif hasattr(python_tool.python_repl, 'locals') and isinstance(python_tool.python_repl.locals, dict):
            python_tool.python_repl.locals['file_paths'] = state.assets_dict

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
            fp for fp in state.file_paths
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
                files_list = "\n".join([f"- File {i+1}: {fp}" for i, fp in enumerate(valid_files)])
                file_info += f"""Multiple CSV files available for analysis:
{files_list}

Load ALL files and combine/analyze as needed for the user's request. You can use pandas to merge, concatenate, or analyze files together."""

            file_info += "\n\nCRITICAL: When writing Python code, load the files using the paths pre-loaded in the `file_paths` dictionary object in your environment (e.g. `file_paths['users.csv']`)."

            if is_chart_mod and state.chart_mentions:
                chart_info = state.chart_mentions[0]
                existing_config = chart_info.get("config", {})
                existing_config_json = json.dumps(existing_config, ensure_ascii=False, indent=2)
                chart_id = chart_info.get('chart_id', 'chart_modified')

                chart_columns_hint = ""
                if existing_config.get("axisConfig"):
                    ax = existing_config["axisConfig"]
                    cols = []
                    if ax.get("x_axis", {}).get("column"): cols.append(ax["x_axis"]["column"])
                    if ax.get("y_axis", {}).get("column"): cols.append(ax["y_axis"]["column"])
                    if cols:
                        chart_columns_hint = f"\nThis chart uses columns: {', '.join(cols)}"
                elif existing_config.get("datasets"):
                    ds_labels = [ds.get("label", "") for ds in existing_config.get("datasets", [])]
                    if ds_labels:
                        chart_columns_hint = f"\nThis chart uses datasets: {', '.join(ds_labels)}"

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
    if mode in ("dashboard", "qa_visual") and len(state.working_memory.python_execution_results) >= 1:
        messages.append(HumanMessage(content="""REMINDER: When you generate your dashboard JSON:
- Use ONLY values that came from your Python analysis above
- Every number must be traceable to a print() statement you executed
- If you did not compute a value with Python, do NOT include it in the output"""))

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
                model_with_tools.invoke, messages,
                label=f"Internal reasoning turn {turn + 1}"
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
                            logger.info(f"[Internal] Turn {turn+1} — Python:\n{query[:200]}...")
                            result = python_tool.run(query)
                            success, error = True, None
                        elif tool_name.lower() == "get_available_chart_types":
                            emit_thinking_event(
                                "tool",
                                "Checking chart options",
                                "Reviewing available visual encodings for the answer.",
                                status="active",
                                metadata={"turn": turn + 1, "tool": "get_available_chart_types"},
                            )
                            logger.info(f"[Internal] Turn {turn+1} — get_available_chart_types")
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
                        preview = result_str[:300] + "...[truncated]" if len(result_str) > 300 else result_str
                        logger.info(f"[Internal] Turn {turn+1} result: {preview}")

                    except SystemExit as e:
                        result_str = "Code attempted to exit(). Remove exit()/quit() calls."
                        success, error = False, result_str
                        logger.warning(f"[Internal] SystemExit caught: {e}")

                    except Exception as e:
                        result_str = f"Error executing {tool_name}: {str(e)}"
                        success, error = False, result_str
                        logger.error(f"[Internal] Tool error: {result_str}")

                    # Store in working memory (observability + validation)
                    state.working_memory.python_execution_results.append({
                        "tool_name": tool_name,
                        "tool_call_id": tool_call_id,
                        "tool_args": tool_args,
                        "success": success,
                        "output": result_str,
                        "error": error,
                        "timestamp": datetime.now().isoformat(),
                    })

                    if success:
                        tool_execution_count += 1
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
                    messages.append(ToolMessage(content=result_str, tool_call_id=tool_call_id))

            else:
                # --- No tool calls → model produced final output ---

                # Anti-hallucination: enforce minimum tool usage
                min_tools = _get_minimum_tool_executions_required(state)
                if tool_execution_count < min_tools:
                    logger.warning(
                        f"[Internal] Only {tool_execution_count}/{min_tools} tool executions. "
                        "Nudging model to use tools first."
                    )
                    messages.append(HumanMessage(
                        content=f"⚠️ You have only used tools {tool_execution_count} time(s) but need "
                                f"at least {min_tools}. You MUST use Python_REPL to load and analyze "
                                "the data BEFORE generating any output. Call Python_REPL now."
                    ))
                    continue

                # Check for empty response
                content = str(response.content) if response.content else ""
                if not content.strip():
                    if turn < max_turns - 3:
                        logger.warning(f"[Internal] Empty response on turn {turn+1}, nudging")
                        messages.append(HumanMessage(
                            content="Your response was empty. Please continue your analysis."
                        ))
                        continue
                    else:
                        break

                # --- Extract output → store in working_memory for SYNTHESIS ---
                if mode == "dashboard":
                    json_data = _extract_json_from_content(content)

                    # Chart modification wrapping
                    if json_data and is_chart_mod and "dashboard" not in json_data:
                        if "chart_type" in json_data or "datasets" in json_data:
                            json_data = {
                                "dashboard": {"title": "Chart Modification", "description": "Modified chart"},
                                "metrics": [], "charts": [json_data], "tables": [], "insights": [],
                            }
                        elif "charts" in json_data:
                            json_data["dashboard"] = {"title": "Chart Modification", "description": "Modified chart"}
                            json_data.setdefault("metrics", [])
                            json_data.setdefault("tables", [])
                            json_data.setdefault("insights", [])

                    if json_data:
                        state.working_memory.dashboard_json = json_data

                        # Generate summary
                        try:
                            summary = _generate_summary_for_dashboard(model, json_data, state.input_prompt)
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
                        state.working_memory.qa_response = visual_payload.get("answer", "")
                        state.working_memory.visual_artifacts = visual_payload.get("artifacts", [])
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
                    "Drafting answer with visual" if mode == "qa_visual" else "Assembling final response",
                    "Combining computed results into the user-facing response.",
                    metadata={"turns": turn + 1, "tool_count": tool_execution_count, "mode": mode},
                )
                break

        else:
            # Max turns exhausted — salvage last AI message
            logger.error(f"[Internal] Max turns ({max_turns}) exhausted")
            for msg in reversed(messages):
                if isinstance(msg, AIMessage) and msg.content and str(msg.content).strip():
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
                            state.working_memory.qa_response = visual_payload.get("answer", "")
                            state.working_memory.visual_artifacts = visual_payload.get("artifacts", [])
                        else:
                            state.working_memory.qa_response = last_content
                    else:
                        state.working_memory.qa_response = last_content
                    break
            else:
                state.working_memory.errors.append({
                    "node": "REASONING_INTERNAL",
                    "error": f"Max turns ({max_turns}) exhausted with no output",
                    "timestamp": datetime.now().isoformat(),
                })

    except Exception as e:
        error_str = str(e)
        logger.error(f"Error in REASONING_INTERNAL node: {error_str}", exc_info=True)
        if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
            state.working_memory.rate_limit_hits += 1
            if state.working_memory.rate_limit_hits >= 3:
                logger.error("REASONING_INTERNAL: 3 consecutive 429s — quota exhausted, aborting")
                state.working_memory.qa_response = (
                    "⚠️ The AI model hit its rate limit (quota exhausted). "
                    "Please try again later or contact support to upgrade your API quota."
                )
            else:
                delay_match = re.search(r"retryDelay[\"':\s]+(\d+)s", error_str)
                delay_s = int(delay_match.group(1)) if delay_match else 60
                delay_s = max(10, min(delay_s, 120))
                logger.warning(f"REASONING_INTERNAL: rate limit (429) hit #{state.working_memory.rate_limit_hits}, sleeping {delay_s}s")
                time.sleep(delay_s)
        else:
            state.working_memory.rate_limit_hits = 0
        state.working_memory.errors.append({
            "node": "REASONING_INTERNAL",
            "error": error_str,
            "timestamp": datetime.now().isoformat(),
        })

    return state


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
    
    route_decision = state.working_memory.tool_outputs.get("route_decision", {})
    mode = route_decision.get("next_step", "dashboard")
    
    is_chart_mod = route_decision.get("is_chart_modification", False)

    if mode == "dashboard" and is_chart_mod and state.chart_mentions:
        # Chart modification mode — output only the modified chart with metadata
        # Frontend will handle merging into the existing dashboard
        dashboard_json = state.working_memory.dashboard_json
        chart_mention = state.chart_mentions[0]
        logger.info(f"Chart modification synthesis for chart: {chart_mention.get('title')}")

        if dashboard_json:
            # Tag output so frontend knows to merge instead of replace
            state.output = {
                "type": "chart_modification",
                "data": dashboard_json,
                "chart_modification_context": {
                    "component_id": chart_mention.get("component_id"),
                    "chart_id": chart_mention.get("chart_id"),
                    "title": chart_mention.get("title"),
                    "chart_type": chart_mention.get("chart_type"),
                },
            }
            logger.info("Chart modification synthesis complete — frontend will merge")
        elif state.working_memory.qa_response:
            state.output = {
                "type": "message",
                "content": state.working_memory.qa_response,
            }
        else:
            state.working_memory.errors.append({
                "node": "SYNTHESIS",
                "error": "Failed to extract modified chart JSON",
                "timestamp": datetime.now().isoformat(),
            })
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
            logger.info("No dashboard JSON, but found qa_response - using as text output")
            state.output = {
                "type": "message",
                "content": state.working_memory.qa_response,
            }
        else:
            state.working_memory.errors.append({
                "node": "SYNTHESIS",
                "error": "Failed to extract dashboard JSON",
                "timestamp": datetime.now().isoformat(),
            })
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
            logger.info(f"QA visual synthesis complete with {len(artifacts)} artifact(s)")
        elif qa_response:
            state.output = {
                "type": "message",
                "content": qa_response,
            }
            logger.info("QA visual synthesis fell back to text-only message")
        else:
            state.working_memory.errors.append({
                "node": "SYNTHESIS",
                "error": "Failed to extract QA visual response",
                "timestamp": datetime.now().isoformat(),
            })
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
            state.working_memory.errors.append({
                "node": "SYNTHESIS",
                "error": "Failed to extract QA response",
                "timestamp": datetime.now().isoformat(),
            })
            logger.error("Failed to synthesize Q&A output")
    
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
        state.working_memory.errors.append({
            "node": "VALIDATION",
            "error": "No output to validate",
            "timestamp": datetime.now().isoformat(),
        })
        state.working_memory.tool_outputs["validation"] = {"valid": False, "error": "No output"}
        return state
    
    output_type = state.output.get("type")

    # Chart modification mode: skip strict validation since SYNTHESIS already merged into existing dashboard
    route_decision = state.working_memory.tool_outputs.get("route_decision", {})
    if route_decision.get("is_chart_modification") and output_type == "dashboard_config":
        logger.info("Chart modification mode — skipping strict validation (merged dashboard)")
        state.working_memory.tool_outputs["validation"] = {"valid": True, "note": "chart_modification_skip"}
        return state

    if output_type == "dashboard_config":
        # Step 1: Validate dashboard JSON schema
        validation_result = _validate_dashboard_json(state.output.get("data"))
        
        # Step 2: Validate data authenticity (anti-hallucination check)
        if validation_result.get("valid"):
            dashboard_data = state.output.get("data", {})
            data_validation = _validate_dashboard_data(dashboard_data, state)
            
            # Track validation retry attempts
            validation_retries = state.working_memory.tool_outputs.get("validation_retries", 0)
            max_validation_retries = 2
            
            # Log warnings and errors
            if data_validation.get("warnings"):
                for warning in data_validation["warnings"]:
                    logger.warning(f"Data validation: {warning}")
            
            if data_validation.get("metric_warnings"):
                for warning in data_validation["metric_warnings"]:
                    logger.warning(f"Data validation (metric - non-critical): {warning}")
            
            if data_validation.get("errors"):
                for error in data_validation["errors"]:
                    logger.error(f"Data validation error: {error}")
            
            # Check for critical issues (likely hallucinated data)
            # A single metric warning is non-critical (lowest severity) and passes validation.
            # But >=2 metric warnings still trigger retry.
            has_critical_issues = (
                len(data_validation.get("errors", [])) > 0 or 
                len(data_validation.get("warnings", [])) >= 1 or
                len(data_validation.get("metric_warnings", [])) >= 2
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
                    [f"- ERROR: {e}" for e in data_validation.get("errors", [])] +
                    [f"- WARNING: {w}" for w in data_validation.get("warnings", [])] +
                    [f"- METRIC WARNING (non-critical): {w}" for w in data_validation.get("metric_warnings", [])]
                )
                
                validation_error_msg = f"""⚠️ YOUR DASHBOARD WAS REJECTED DUE TO DATA ISSUES ⚠️

The following issues were detected - your data appears to be FABRICATED:
{issues_list}

{grounding_context}

Please REGENERATE the dashboard JSON using ONLY the values from the Python analysis above.
DO NOT include any values that you cannot trace back to a print() statement.
It's better to have fewer charts with REAL data than more charts with FAKE data."""
                
                # Store for retry
                state.working_memory.tool_outputs["force_more_tools"] = validation_error_msg
                state.working_memory.tool_outputs["validation_retries"] = validation_retries + 1
                
                # Mark as invalid to trigger retry
                validation_result = {
                    "valid": False, 
                    "error": "Data validation failed - likely fabricated data",
                    "data_warnings": data_validation.get("warnings", []),
                    "data_errors": data_validation.get("errors", []),
                }
            elif has_critical_issues:
                # Max retries reached - accept with warning
                logger.warning("Max validation retries reached, accepting dashboard despite data issues")
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
        validation_result = {"valid": False, "error": f"Unknown output type: {output_type}"}

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
                1 for kw in required_keywords
                if kw.lower() in all_metrics_text
            )
            match_ratio = matched / len(required_keywords)

            if match_ratio < 0.3:
                logger.warning(
                    f"Analysis focus compliance low: {matched}/{len(required_keywords)} keywords found. "
                    f"Focus: {state.template_spec.get('name')}"
                )
                state.working_memory.errors.append({
                    "node": "node_validation",
                    "type": "analysis_focus_compliance",
                    "message": (
                        f"Dashboard does not contain expected metrics for analysis focus "
                        f"'{state.template_spec.get('name')}'. "
                        f"Found {matched}/{len(required_keywords)} required metric keywords."
                    ),
                    "retry_suggested": True
                })

    state.working_memory.tool_outputs["validation"] = validation_result

    if not validation_result.get("valid"):
        error_msg = validation_result.get("error", "Validation failed")
        logger.error(f"Validation failed: {error_msg}")
        state.working_memory.errors.append({
            "node": "VALIDATION",
            "error": error_msg,
            "timestamp": datetime.now().isoformat(),
        })
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
    logger.info(f"Workflow completed successfully for conversation {state.conversation_id}")
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
        error_summary = "\n".join([
            f"- {e.get('node', 'unknown')}: {e.get('error', 'unknown error')}"
            for e in state.working_memory.errors[-3:]
        ])
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
            chunks.append(f"[Referenced chart for modification: {title} ({chart_type})]")
    return "\n\n".join(chunk for chunk in chunks if chunk).strip()


def _format_state_for_prompt_basic(state: AgentState) -> str:
    """Basic state formatting for prompt (will be enhanced in helpers.py)."""
    sections = []
    
    sections.append(f"""CURRENT STATE:
- Node: {state.current_node}
- Iteration: {state.iteration}/{state.max_iterations}""")
    
    route_decision = state.working_memory.tool_outputs.get("route_decision")
    if route_decision:
        sections.append(f"""MODE: {route_decision.get('next_step')}""")

    if state.theme_id:
        sections.append(f"""SELECTED VISUAL THEME:
- Use theme "{state.theme_id}" for styling_recommendations.theme and every metric/chart/table styling.theme.
- Do not choose a different dashboard theme unless the selected theme is invalid.""")

    if state.template_spec:
        prompt_prefix = state.template_spec.get("prompt_prefix", "")
        if prompt_prefix:
            sections.append(f"""SELECTED ANALYSIS FOCUS:
{prompt_prefix}""")
    
    if state.working_memory.errors:
        recent_errors = state.working_memory.errors[-2:]
        sections.append(f"""ERRORS (Retry: {state.working_memory.retry_count}):
{chr(10).join([f"- {e.get('error', '')[:100]}" for e in recent_errors])}""")
    
    return "\n\n".join(sections)



def _generate_summary_for_dashboard(model, dashboard_json: Dict[str, Any], user_prompt: str) -> str:
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
    
    chart_info = [f"- {c.get('type', 'chart')}: '{c.get('title', 'Untitled')}'" for c in charts]
    metric_info = [f"- {m.get('label', 'Metric')}: {m.get('value', 'N/A')}" for m in metrics]
    
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
    response = _llm_invoke(model.invoke, [HumanMessage(content=prompt)], label="Dashboard summary")
    _update_usage(state, response)
    
    if response and response.content and isinstance(response.content, list):
        return str(response.content[0]['text'].strip())
    elif response and response.content:
        return str(response.content).strip()
    # Fallback
    return f"I've created a dashboard with {len(charts)} chart(s) and {len(metrics)} metric(s) based on your request."


def _extract_json_from_content(content: str) -> Dict[str, Any]:
    """Extract JSON from LLM response content."""
    if not content or not content.strip():
        return None
    
    try:
        # Search for JSON code blocks
        json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find any code block
            code_match = re.search(r'```\s*(.*?)\s*```', content, re.DOTALL)
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
        normalized_artifact["id"] = normalized_artifact.get("id") or f"artifact_{idx + 1:03d}"
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


def _validate_dashboard_json(data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate dashboard JSON structure."""
    if not data:
        return {"valid": False, "error": "Dashboard data is empty"}
    
    if not isinstance(data, dict):
        return {"valid": False, "error": f"Dashboard data is not a dict, got {type(data)}"}
    
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
    
    return {"valid": True}


def _validate_qa_response(content: str) -> Dict[str, Any]:
    """Validate Q&A response."""
    if not content:
        return {"valid": False, "error": "Q&A response is empty"}
    
    if not isinstance(content, str):
        return {"valid": False, "error": f"Q&A response is not a string, got {type(content)}"}
    
    if len(content.strip()) < 10:
        return {"valid": False, "error": "Q&A response is too short"}
    
    return {"valid": True}


def _validate_answer_with_visual(output: Dict[str, Any], state: AgentState) -> Dict[str, Any]:
    """Validate inline QA visual response shape."""
    content_validation = _validate_qa_response(output.get("content"))
    if not content_validation.get("valid"):
        return content_validation

    if state.file_paths:
        successful_python_calls = [
            result for result in state.working_memory.python_execution_results
            if result.get("success") and str(result.get("tool_name", "")).lower() == "python_repl"
        ]
        if not successful_python_calls:
            state.working_memory.tool_outputs["force_more_tools"] = (
                "You must use Python_REPL to load and analyze the data before producing "
                "a QA visual response. Compute and print every value that appears in "
                "the answer or visual artifacts, then return the required JSON."
            )
            return {"valid": False, "error": "QA visual response was generated without Python analysis"}

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
                return {"valid": False, "error": f"Chart artifact {idx + 1} has no datasets"}
            has_points = any(isinstance(ds, dict) and ds.get("data") for ds in datasets)
            if not has_points:
                return {"valid": False, "error": f"Chart artifact {idx + 1} has no data points"}
        elif kind == "table":
            columns = artifact.get("columns") or []
            rows = artifact.get("data") or []
            if not columns or not rows:
                return {"valid": False, "error": f"Table artifact {idx + 1} has no columns or rows"}
        else:
            return {"valid": False, "error": f"Artifact {idx + 1} has unsupported kind: {kind}"}

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
            tool_calls=[{
                "name": tool_name,
                "args": tool_args,  # Include the actual arguments used
                "id": tool_call_id,
            }]
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
                    df = pd.read_csv(file_path, nrows=1000)  # Read more rows for better coverage
                    file_name = os.path.basename(file_path)
                    grounding_lines.append(f"File: {file_name}")
                    
                    for col in df.columns:
                        # Only process string/object columns
                        if df[col].dtype == 'object':
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
        grounding_lines.append("⚠️ No tool outputs yet - you MUST use Python_REPL first!")
    
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
    for file_path in (state.file_paths or []):
        if file_path and os.path.exists(file_path):
            try:
                df = pd.read_csv(file_path, nrows=1000)  # Read first 1000 rows for validation
                actual_column_names.extend([c.lower() for c in df.columns.tolist()])
                for col in df.columns:
                    # Get unique string values from each column
                    unique_vals = df[col].dropna().astype(str).unique()
                    for val in unique_vals:
                        if len(val) >= 3 and not val.replace(",", "").replace(".", "").replace("-", "").isdigit():
                            all_csv_values.add(val.lower().strip())
            except Exception as e:
                logger.warning(f"Could not read {file_path} for validation: {e}")

    all_csv_values_str = " ".join(all_csv_values)

    # --- Column-integrity check ---
    # Detect fabricated metric/chart titles that have no link to actual column names.
    # We flag well-known "invented SaaS metrics" that don't appear in the CSV columns.
    FABRICATED_METRIC_KEYWORDS = {
        "revenue", "ad spend", "ad_spend", "conversions", "impressions", "ctr",
        "click-through", "roas", "cpm", "cpc", "ltv", "arpu", "mrr", "arr",
        "churn", "campaign type", "industry", "country", "region",
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
        errors.append("No tool outputs or data files found - dashboard data may be fabricated")
        return {"valid": False, "warnings": warnings, "errors": errors}
    
    # Common generic labels that are likely fabricated if not in tool output
    # These are words that LLMs tend to make up
    suspicious_patterns = [
        r'\b[A-Z][a-z]+\s+[A-Z][a-z]+\b',  # "John Smith", "Alice Johnson" pattern
        r'\bSeller\s+[A-Z]\b',  # "Seller A", "Seller B" pattern
        r'\bProduct\s+[A-Z]\b',  # "Product A", "Product B" pattern
        r'\bCategory\s+\d+\b',  # "Category 1", "Category 2" pattern
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
            'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
            'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
            'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'q1', 'q2', 'q3', 'q4', 'total', 'average', 'sum', 'count', 'other', 'unknown',
        }
        if label_lower in common_words:
            return True
        
        # Check for date patterns (2022-01, 2023-05-15, etc.)
        if re.match(r'\d{4}[-/]\d{2}([-/]\d{2})?', label):
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
        numbers = re.findall(r'[\d,]+\.?\d*', value)
        
        for num in numbers:
            clean_num = num.replace(",", "")
            if len(clean_num) > 3:  # Only check significant numbers
                # Check if this number appears somewhere in tool outputs
                if clean_num not in all_outputs and num not in all_outputs:
                    metric_warnings.append(f"Metric '{title}' value '{value}' may be fabricated - not found in tool outputs")
    
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
                warnings.append(f"Chart '{chart_title}' has suspiciously many round numbers - may be fabricated")
    
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
                    if isinstance(val, str) and len(val) > 3 and not val.replace(",", "").replace(".", "").isdigit():
                        checked_count += 1
                        if not is_label_in_data(val):
                            fabricated_values.append(val)
        
        if checked_count > 0 and len(fabricated_values) > checked_count * 0.3:
            warnings.append(
                f"Table '{table_title}' has values not found in data: "
                f"{', '.join(fabricated_values[:3])}{'...' if len(fabricated_values) > 3 else ''}"
            )
    
    valid = len(errors) == 0
    
    return {"valid": valid, "warnings": warnings, "metric_warnings": metric_warnings, "errors": errors}
