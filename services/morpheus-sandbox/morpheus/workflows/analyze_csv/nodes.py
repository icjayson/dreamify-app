"""
Node implementations for stateful agentic workflow.

Each node is a pure function that takes AgentState and returns updated AgentState.
Nodes are responsible for specific workflow phases and should not directly
transition to other nodes (that's handled by edges.py).
"""

import os
import time
import json
import re
from datetime import datetime
from typing import Dict, Any
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage

from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    ActionRequest,
    WorkflowHistoryEntry,
)
from morpheus.tools.python_repl.tool import PythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.models.base import get_model_for_agent
from utils.logger import logger
from utils.postprocess import clean_json

# Import system prompts from original workflow
# These will be refactored into separate prompts module later if needed
QA_SYSTEM_PROMPT = """You are a helpful data analysis assistant. Your goal is to answer the user's questions textually based on the provided data and conversation history. Do not generate JSON dashboards.

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
   - Load: df = pd.read_csv(file_path)
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
Prioritize metrics based on:
1. Business relevance: Revenue, counts, rates, growth
2. Statistical significance: High variance, strong correlations
3. Actionability: Metrics that drive decisions

For numeric columns, check keyword heuristics:
- revenue/sales/amount/price → compute SUM, AVERAGE, COUNT
- If time column exists → compute growth rates

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
- Tables: minH=8
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

Available Themes (choose ONE for entire dashboard):
- monochrome

CRITICAL THEME REQUIREMENT:
- Choose ONE theme for the entire dashboard
- EVERY metric, chart, and table styling object MUST include "theme" field
- ALL cards MUST use the SAME theme value
- Example: {"theme": "monochrome", "title": "title-color", ...}


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
        "theme": "monochrome",
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
        "theme": "monochrome",
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
        "theme": "monochrome",
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
  }
}
```

CRITICAL OUTPUT RULES:
======================
1. Wrap JSON output in ```json code block
2. Include actual computed data in ALL datasets - NEVER empty arrays []
3. NO SQL queries or "query" fields - only embedded data values computed via Python
4. Apply semantic color tokens (not hex/HSL except for trendUp/trendDown)
5. Choose ONE theme and use consistently across all components
6. Transform table column names to human-readable format
7. All datasets[].data[] must contain objects with "label" and "value" keys
8. All numeric values must be actual numbers from your Python computations
9. Include layout (x, y, w, h, minW, minH) for every metric, chart, and table

VALIDATION CHECKLIST (Before Output):
=====================================
✓ metrics[] with: id, title, value, change, trend, layout, styling (with theme)
✓ charts[] with: id, chart_type, title, layout, datasets, config, styling (with theme), reasoning
✓ tables[] with: id, title, layout, columns, data, styling (with theme)
✓ insights[] with at least 3 insight strings
✓ data_quality with: total_records, completeness, duplicates
✓ ALL datasets contain actual computed data - NO empty arrays
✓ ALL table columns use human-readable names
✓ ALL styling objects include "theme" field with SAME value
✓ Layout h >= minH for all components

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
   - Explicitly asks to visualize, plot, chart, create a dashboard, or generate charts
   - Asks to see data in a visual format
   - Requests specific chart types (bar chart, line chart, pie chart, etc.)
   - If an asset exists but no dashboards have been created yet, lean towards 'dashboard' mode if the user asks for general data views

2. Route to 'qa' if the user:
   - Asks specific questions about values, trends, causes, or wants calculations
   - Requests information or explanations (not visualizations)
   - Asks follow-up questions about existing dashboards
   - Asks about capabilities or general questions

Remember: When in doubt, consider if the user wants to SEE data (dashboard) or KNOW information (qa)."""


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
    
    return state


def node_explore_files(state: AgentState, model=None, **kwargs) -> AgentState:
    """
    EXPLORE_FILES Node: Data Profiler agent to automatically profile all available datasets.
    
    This node serves as a prefix step. It uses PythonREPL to analyze the datasets
    mapped in state.assets_dict and saves a summary in state.data_profile.
    """
    logger.info("Running EXPLORE_FILES node")
    
    if not state.assets_dict:
        logger.info("No assets to explore. Proceeding to ROUTING.")
        return state
        
    try:
        # Get or create python tool
        python_tool = PythonREPLTool()
        
        # INJECT locals/globals into the REPL environment
        if hasattr(python_tool.python_repl, 'globals') and isinstance(python_tool.python_repl.globals, dict):
            python_tool.python_repl.globals['file_paths'] = state.assets_dict
        elif hasattr(python_tool.python_repl, 'locals') and isinstance(python_tool.python_repl.locals, dict):
            python_tool.python_repl.locals['file_paths'] = state.assets_dict

        if model is None:
            model = get_model_for_agent()

        profiler_prompt = f"""You are the 'Data Profiler', an expert data scientist. 
Your sole objective is to explore and profile multiple datasets provided by the user before any deep analysis begins.

You have access to a Python_REPL tool.
The paths to the user's uploaded files are already stored in a predefined Python dictionary called `file_paths` in your execution environment, where the key is the filename and the value is the local file path.

**YOUR INSTRUCTIONS:**
1. Use the Python_REPL tool to iterate through the `file_paths` dictionary.
2. For EACH file, load it using pandas (`pd.read_csv(path)`) and extract the following information:
   - File Name
   - File Size (in MB - you can compute from os.path.getsize)
   - DataFrame Shape (Number of rows and columns)
   - Column Names and their Data Types (dtypes)
   - The first 3 rows of data (df.head(3))
   - Number of missing values (Null/NaN) per column.
3. **Crucial Constraints:** Do NOT print the entire dataframe. Data can be massive. Only use `.head(3)` or `.info()`.
4. After executing the Python code to gather this data, synthesize the output into a concise, structured 'Data Profile Summary' in text format.

**OUTPUT FORMAT:**
Provide a structured summary of ALL files. Do not perform any deep analysis or answer user queries. Just output the profile.
Ensure the format easily provides the schema for the next reasoning agent."""

        model_with_tools = model.bind_tools([python_tool])
        messages = [
            SystemMessage(content=profiler_prompt),
            HumanMessage(content="Please profile all datasets in the file_paths dictionary and produce the summary.")
        ]
        
        logger.info("Calling Data Profiler LLM to explore files.")
        
        # Standard ReAct loop just for the profiler
        max_turns = 5
        for turn in range(max_turns):
            response = model_with_tools.invoke(messages)
            if isinstance(response.content, list):
                response.content = "\n".join(
                    item.get("text", "") if isinstance(item, dict) else str(item)
                    for item in response.content
                )
            
            messages.append(response)
            
            if response.tool_calls and len(response.tool_calls) > 0:
                # Execute all tools
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    tool_call_id = tool_call["id"]
                    
                    if tool_name.lower() == "python_repl":
                        query = tool_args.get("query", "")
                        logger.info(f"[Data Profiler] Executing Python code:\n{query}")
                        result = python_tool.run(query)
                        result_str = str(result)
                        preview = result_str[:300] + "...\n[Output truncated]" if len(result_str) > 300 else result_str
                        logger.info(f"[Data Profiler] Execution result preview:\n{preview}")
                    elif tool_name.lower() == "get_available_chart_types":
                        logger.info("[Data Profiler] Tool check: get_available_chart_types")
                        result = get_available_chart_types.invoke({})
                    else:
                        logger.info(f"[Data Profiler] Tool error: Unknown tool {tool_name}")
                        result = f"Error: Unknown tool {tool_name}"
                        
                    tool_msg = ToolMessage(content=str(result), tool_call_id=tool_call_id)
                    messages.append(tool_msg)
            else:
                # Finished
                state.data_profile = str(response.content)
                logger.info(f"[Data Profiler] Data exploration complete.\nSummary Preview:\n{str(response.content)[:500]}...")
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
    
    Args:
        state: Current agent state
        model: LLM model for routing (optional, will create if not provided)
        **kwargs: Additional arguments
        
    Returns:
        Updated agent state with routing decision in working_memory
    """
    logger.info("Running ROUTING node")
    
    # Get or create model
    if model is None:
        model = get_model_for_agent()
    
    # Extract context flags
    has_asset = len(state.user_state.user_assets) > 0
    dashboard_count = len(state.user_state.dashboards)
    
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
            route_decision = router_model.invoke(router_messages)
            next_step = route_decision.next_step
            reasoning = route_decision.reasoning
        except Exception as e:
            logger.warning(f"Structured output failed, using fallback: {str(e)}")
            # Fallback: parse from response
            response = model.invoke(router_messages)
            content = str(response.content) if response.content else ""
            
            # Try to extract decision from content
            if "dashboard" in content.lower():
                next_step = "dashboard"
                reasoning = "Fallback routing based on content analysis"
            elif "qa" in content.lower():
                next_step = "qa"
                reasoning = "Fallback routing based on content analysis"
            else:
                # Default to dashboard
                next_step = "dashboard"
                reasoning = "Default fallback routing"
    
    except Exception as e:
        logger.error(f"Router error: {str(e)}, defaulting to dashboard")
        next_step = "dashboard"
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
            
            if mode == "dashboard":
                instruction = f"User wants to: {state.input_prompt}\n\n{file_info}"
            else:
                instruction = f"User question: {state.input_prompt}\n\n{file_info}"
            
            messages.append(HumanMessage(content=instruction))
    
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
    if mode == "dashboard" and len(state.working_memory.python_execution_results) >= 1:
        grounding_reminder = """
REMINDER: When you generate your dashboard JSON:
- Use ONLY values that came from your Python analysis above
- Every number must be traceable to a print() statement you executed
- If you did not compute a value with Python, do NOT include it in the dashboard"""
        messages.append(HumanMessage(content=grounding_reminder))
    
    # Call LLM
    try:
        response = model_with_tools.invoke(messages)
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
            # Agent provided final output - BUT first check if we have enough SUCCESSFUL tool executions
            successful_tool_count = sum(
                1 for result in state.working_memory.python_execution_results 
                if result.get("success", False)
            )
            min_required = _get_minimum_tool_executions_required(state)
            
            if mode == "dashboard" and successful_tool_count < min_required:
                # Not enough successful tool executions - force more analysis
                logger.warning(
                    f"LLM tried to finish with only {successful_tool_count} successful tool calls "
                    f"(minimum {min_required} required for {len(state.file_paths)} file(s))"
                )
                
                # Force the LLM to use more tools
                grounding_context = _build_data_grounding_context(state)
                force_tool_msg = f"""STOP! You have not analyzed the data sufficiently.

You have only made {successful_tool_count} successful tool call(s), but you need at least {min_required} to properly analyze the data.

{grounding_context}

Please use Python_REPL to:
1. Load ALL files provided
2. Compute the specific metrics and values you will use in your dashboard
3. Print ALL values before generating JSON

DO NOT generate the dashboard JSON until you have computed all the values."""
                
                action_request = ActionRequest(
                    action_type="EXECUTE_TOOL",
                    tool_name="python_repl",
                    arguments={"query": "# Please continue analyzing the data\nimport pandas as pd\n# Load and analyze files..."},
                    reasoning="Insufficient tool executions - forcing more analysis"
                )
                
                # Note: Don't actually execute this dummy query - it's just to signal retry
                # Instead, append message asking for more tools
                state.working_memory.tool_outputs["force_more_tools"] = force_tool_msg
            else:
                # Sufficient tool executions - proceed with finish
                action_request = ActionRequest(
                    action_type="FINISH",
                    reasoning="Agent provided final output",
                )
                
                # Store output in working memory
                if mode == "dashboard":
                    # Extract JSON from content
                    json_data = _extract_json_from_content(response.content)
                    
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
        logger.error(f"Error in REASONING node: {str(e)}")
        state.working_memory.errors.append({
            "node": "REASONING",
            "error": str(e),
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
                        # Check if this is a common tool name hallucination
                        common_mistakes = ['run', 'execute', 'code', 'python', 'code_interpreter']
                        base_error = f"Unknown tool: {tool_name}"
                        
                        if tool_name.lower() in common_mistakes:
                            guidance = f"\n\n⚠️ CRITICAL ERROR: Tool '{tool_name}' does not exist. Did you mean to use 'Python_REPL' to execute your code? Please retry using 'Python_REPL' with the 'query' parameter containing your Python code."
                            tool_result = base_error + guidance
                            error = base_error + guidance
                        else:
                            tool_result = base_error
                            error = base_error
                        
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
    
    if mode == "dashboard":
        # Extract dashboard JSON
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
    else:
        validation_result = {"valid": False, "error": f"Unknown output type: {output_type}"}
    
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
    response = model.invoke([HumanMessage(content=prompt)])
    
    if response and response.content:
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
    for file_path in (state.file_paths or []):
        if file_path and os.path.exists(file_path):
            try:
                df = pd.read_csv(file_path, nrows=1000)  # Read first 1000 rows for validation
                for col in df.columns:
                    # Get unique string values from each column
                    unique_vals = df[col].dropna().astype(str).unique()
                    for val in unique_vals:
                        if len(val) >= 3 and not val.replace(",", "").replace(".", "").replace("-", "").isdigit():
                            all_csv_values.add(val.lower().strip())
            except Exception as e:
                logger.warning(f"Could not read {file_path} for validation: {e}")
    
    all_csv_values_str = " ".join(all_csv_values)
    
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
        if label_lower in all_outputs_lower:
            return True
        
        # Check in actual CSV data values (exact match in set)
        if label_lower in all_csv_values:
            return True
        
        # Partial match in CSV values (for truncated or slightly different values)
        if label_lower in all_csv_values_str:
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

