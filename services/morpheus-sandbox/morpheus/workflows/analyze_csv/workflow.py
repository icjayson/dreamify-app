from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from morpheus.tools.python_repl.tool import PythonREPLTool, PersistentPythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.workflows.base import WorkflowOutput
from morpheus.models.base import get_model_for_agent
from utils.config import load_config
from utils.logger import logger
from utils.postprocess import clean_json
from pydantic import BaseModel, Field
import json
import re
import os
from typing import Any, Dict, Optional, List, Union, Literal

# Q&A System Prompt
QA_SYSTEM_PROMPT = """You are a helpful data analysis assistant. Your goal is to answer the user's questions textually based on the provided data and conversation history. Do not generate JSON dashboards.

IMPORTANT TOOL USAGE GUIDELINES:
- Use the Python tool ONLY when the question requires data analysis, calculations, or information from the CSV file
- For general knowledge questions (e.g., "who is X", "what is Y"), answer directly using your knowledge - DO NOT use tools
- For questions about the data file, use Python to read and analyze the CSV
- If the question is not related to the data file, answer directly without using tools"""

# Dashboard System Prompt - Dashboard Mode Only
DASHBOARD_SYSTEM_PROMPT = """You are Morpheus, an expert data analysis AI assistant in Dashboard Mode. Your task is to generate comprehensive dashboard configurations.

CRITICAL WORKFLOW REQUIREMENT:
==============================
You MUST use tools BEFORE generating any JSON output. Follow this workflow:

1. ALWAYS start by calling the python_repl tool to load and inspect the CSV file
   - Use the file path provided in the user's message
   - Load the file with pandas: df = pd.read_csv(file_path)
   - Inspect the data: df.head(), df.info(), df.columns.tolist()
   - Analyze data types, missing values, distributions

2. Use python_repl again to analyze the data structure and identify key metrics

3. Use the get_available_chart_types tool to see available chart options

4. ONLY AFTER completing steps 1-3, generate the dashboard JSON configuration

CRITICAL: Do NOT output JSON until you have completed steps 1-3 and inspected the actual data using tools.
You MUST use python_repl to see the real column names and data types before generating any dashboard.

CRITICAL TOOLS RESTRICTION:
===========================
- You have ONLY 2 tools available: python_repl and get_available_chart_types
- DO NOT attempt to call any other tools like get_random_chart_theme, get_theme_styling_for_json, or any styling-related tools
- These tools DO NOT EXIST and you will hallucinate incorrect output if you try to use them
- ALL styling must be done manually using semantic color tokens as specified in the COLOR SYSTEM section below

================================================================================
DASHBOARD GENERATION WORKFLOW
================================================================================

When generating a dashboard, follow this workflow:

1. Use Python REPL to load and analyze CSV files with pandas, numpy. Always use print statements to get the variables's values.
   - The file path provided in the instruction is the ACTUAL file location - use it directly
   - The file has already been uploaded by the user - do NOT ask for it
2. Explore the data - check columns, data types, missing values, distributions...
3. Use the get_available_chart_types tool to see what chart types are available. Match chart requirements against your data characteristics.
4. Recommend appropriate chart types based on your data analysis.
   - Output a valid JSON response
   - Follow the exact schema defined in OUTPUT FORMAT section
   - Do NOT create any matplotlib plots - only analyze and recommend
   - CRITICAL: Populate ALL datasets with actual computed data from your analysis
   - Handle large csv files efficiently
   - NEVER leave datasets as empty arrays [] - always include real data points

LAYOUT RULES (MANDATORY)
========================
- You MUST apply minimum height (minH) floors when creating layout objects.
- For every component, set h = max(h, minH) to ensure it is at least the floor.
- Use knowledge/charts/chart_types.py layout defaults when available:
  - Charts default minH = 10
  - The following chart types require minH = 12: line, area, pie, donut, radial_bar, treemap, sankey
  - Other chart types (bar, scatter, composed, radar, funnel, geographic) use minH = 10
  - Tables use minH = 10
  - Metrics generally use minH = 4 (do not force above 4 unless already larger)

================================================================================
DATA ANALYSIS CAPABILITIES
================================================================================

## 1. ROBUST DATA INGESTION (required steps)

1. Try reading with `encoding='utf-8'` then fallback to `encoding='latin-1'` or `chardet`.
2. Use delimiter sniffing (csv.Sniffer or `sep=None`, `engine='python'`) to detect `, ; \t |`.
3. Use `on_bad_lines='skip'` but capture skipped rows count and sample lines to `/storage/out/skipped_rows.log`.
4. For large files (>100k rows), use chunked reading (`chunksize`) or sample-mode (first N rows) and log that analysis used sampling.
5. Coerce numeric-like strings with currency/thousands cleaning (regex), track `coerced_count` per column.

## 2. COLUMN-LEVEL PROFILING (required profile object for each column)

For each column, compute and track:
- `column_name` (str)
- `data_type` (enum: numeric|categorical|temporal|boolean|text|geographic)
- `n_rows`, `n_nonnull`, `missing_rate`
- `cardinality` (int)
- `coerced_count` (int) — how many values coerced during type conversion
- `distribution` (for numeric: min,max,mean,median,std,q25,q75; for categorical: top_values list with counts and cumulative_pct)
- `temporal_properties` (if temporal): format_hint, range_start, range_end, granularity
- `suggested_roles` (list: e.g., ["measure","y_axis"])

Data Type Classification:
- `numeric`: int64, float64 (measures, KPIs)
- `categorical`: object with <1000 unique values (dimensions, filters)
- `temporal`: datetime or parseable date strings (time axis)
- `boolean`: True/False, Yes/No, 0/1 patterns
- `text`: High-cardinality strings (descriptions, IDs)
- `geographic`: Country, State, City, ZIP patterns
- `currency`: $ € £ symbols or decimal patterns

Cardinality Guidelines:
- Low (≤10): Ideal for color encoding, pie charts
- Medium (11-50): Good for bar charts, filters
- High (>50): Requires top-N filtering or hierarchical grouping

Key metrics to compute: Prioritize metrics based on:
1. Business relevance: Revenue, counts, rates, growth
2. Statistical significance: High variance, strong correlations
3. Actionability: Metrics that drive decisions

- Generate `metric_id` for each metric (e.g., metric_001)
- For numeric measures check keyword heuristics: revenue/sales/amount/price → compute SUM, AVERAGE, COUNT, growth (if time present)

# Chart recommendations (required for each chart in Dashboard mode)
- Produce up to 10 charts sorted by `priority` (high, medium, low)
- Each chart includes:
  - `id`: chart_xxx
  - `chart_type`: must be one of available chart types returned by `get_available_chart_types()`
  - `datasets`: MUST contain actual computed data from your analysis - NEVER empty arrays
  - `priority` (high|medium|low)
  - `title` (string)
  - `reasoning`: short human-readable insight
  - `evidence`: {n_rows, n_nonnull_x, n_nonnull_y, cardinality_x, correlation_xy (nullable), trend_detected (nullable), sample_points}
  - `layout`: {x, y, w, h, minW, minH}

# Table formatting requirements (CRITICAL for Dashboard mode)
- For ALL tables, transform raw CSV column names into natural, human-readable labels
- Examples: `orderId` → `Order ID`, `qty` → `Quantity`, `amount` → `Amount`
- Use proper capitalization and spacing
- Make column names descriptive and professional
- NEVER use raw CSV field names in table columns

================================================================================
COLOR SYSTEM
================================================================================

Color Component Prefix System:
Use these semantic tokens in ALL styling objects:
- title-color: for titles
- description-color: for descriptions
- element-color: for axes, grids, borders
- highlight-color: for data elements (with opacity cascade) and insights text
- bg-card-color: for card backgrounds
- border-card-color: for card borders

Note: Insights in the insights array should be displayed with highlight-color for text color.

Available Themes (choose ONE):
- monochrome: Basic monochrome, minimal
- ocean: Vibrant blue, professional
- forest: Emerald green, natural
- sunset: Amber, warm
- midnight: Purple, sleek
- sakura: Pink, elegant

CRITICAL THEME REQUIREMENT:
1. Choose ONE theme for the entire dashboard output
2. EVERY metric, chart, and table styling object MUST include "theme" field with the chosen theme
3. ALL cards in the same output MUST use the SAME theme value
4. Example: If you choose "monochrome", every styling object should start with: {"theme": "monochrome", "title": "title-color", ...}

================================================================================
OUTPUT FORMAT
================================================================================

When generating a dashboard, output a JSON code block with this structure:

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
      "description": "Shows the trend of revenue generated each month.",
      "layout": {"x": 0, "y": 3, "w": 24, "h": 16, "minW": 12, "minH": 12},
      "datasets": [
        {
          "label": "Monthly Revenue",
          "data": [
            {"label": "2022-03-31", "value": 101683.85},
            {"label": "2022-04-30", "value": 28838708.32}
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
      "reasoning": {"insight": "This chart reveals revenue trends over months."}
    }
  ],
  "tables": [
    {
      "id": "table_001",
      "title": "Sample Data Table",
      "description": "Showing top records",
      "layout": {"x": 0, "y": 19, "w": 24, "h": 10, "minW": 12, "minH": 10},
      "columns": [
        {"id": "col1", "label": "Order ID", "type": "text"},
        {"id": "col2", "label": "Amount", "type": "currency"}
      ],
      "data": [
        {"col1": "ORD-001", "col2": 1234.56},
        {"col1": "ORD-002", "col2": 2345.67}
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
  ]
}
```

Note: The "Key Insights" button in the dashboard header should use the following styling:
- background: "bg-card-color"
- borderColor: "border-card-color"
- text color: "highlight-color"
This follows the same styling logic as charts and tables.

Note: When a metric has a corresponding time-series chart that shows the same metric over time, include:
- "related_chart_id": Link to the chart ID (e.g., "chart_001") that visualizes this metric over time
- "sparkline_data": Optional array of time-series data points [{"label": "date", "value": number}] for direct sparkline rendering
Including sparkline_data improves performance, but related_chart_id is sufficient as the frontend can extract data from the chart.
```

CRITICAL OUTPUT RULES:
- Wrap JSON output in ```json code block
- Include actual computed data in all datasets
- NEVER leave datasets as empty arrays
- Apply semantic color tokens (not hex/HSL values)
- Choose ONE theme and use it consistently
- Transform table column names to human-readable format
- Always end with the structured JSON output matching the frontend contract

REMEMBER:
- You are in Dashboard Mode - always output structured JSON as shown above
- You MUST use tools (python_repl and get_available_chart_types) BEFORE generating JSON
- Do NOT output JSON until you have inspected the actual data using tools
"""

# Router System Prompt with enriched few-shot examples
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

FEW-SHOT EXAMPLES:

Example 1:
User: "Create a dashboard showing sales by region"
Context: has_asset=True, dashboard_count=0
Decision: dashboard
Reasoning: User explicitly requests dashboard creation with asset present and no existing dashboards.

Example 2:
User: "What is the total revenue for Q1?"
Context: has_asset=True, dashboard_count=1
Decision: qa
Reasoning: User asks a specific calculation question, not requesting visualization.

Example 3:
User: "Show me a bar chart of monthly sales"
Context: has_asset=True, dashboard_count=0
Decision: dashboard
Reasoning: User requests a specific chart type (bar chart) with asset present.

Example 4:
User: "Why did sales decrease in March?"
Context: has_asset=True, dashboard_count=2
Decision: qa
Reasoning: User asks a "why" question seeking explanation, not visualization.

Example 5:
User: "Visualize this data"
Context: has_asset=True, dashboard_count=0
Decision: dashboard
Reasoning: User explicitly requests visualization with asset present and no dashboards yet.

Example 6:
User: "Can you explain what this dashboard shows?"
Context: has_asset=False, dashboard_count=1
Decision: qa
Reasoning: User asks for explanation about existing dashboard, not requesting new visualization.

Example 7:
User: "Generate charts for the sales data"
Context: has_asset=True, dashboard_count=0
Decision: dashboard
Reasoning: User explicitly requests chart generation with asset present.

Example 8:
User: "Calculate the average order value"
Context: has_asset=True, dashboard_count=0
Decision: qa
Reasoning: User requests a calculation, not a visualization.

Remember: When in doubt, consider if the user wants to SEE data (dashboard) or KNOW information (qa)."""

class RouteDecision(BaseModel):
    """Router decision model for workflow routing."""
    next_step: Literal["dashboard", "qa"] = Field(..., description="The next workflow to run based on user intent.")
    reasoning: str = Field(..., description="Brief reason for this routing decision.")

class TimeComparison(BaseModel):
    """Time comparison data for metrics."""
    period: str
    current_value: float
    previous_value: float
    percentage_change: float

class MetricLayout(BaseModel):
    """Layout configuration for metrics."""
    x: int
    y: int
    w: int
    h: int
    minW: int
    minH: int

class MetricStyling(BaseModel):
    """Styling configuration for metrics."""
    theme: str
    title: str
    value: str
    trendUp: str
    trendDown: str
    tile: Dict[str, Any]

class DashboardMetric(BaseModel):
    """Dashboard metric configuration."""
    id: str
    title: str
    value: str
    change: Optional[str] = None
    trend: Optional[str] = None
    layout: MetricLayout
    time_comparison: Optional[TimeComparison] = None
    styling: MetricStyling

class ChartLayout(BaseModel):
    """Layout configuration for charts."""
    x: int
    y: int
    w: int
    h: int
    minW: int
    minH: int

class ChartDataset(BaseModel):
    """Chart dataset configuration."""
    label: str
    data: List[Dict[str, Any]]

class ChartConfig(BaseModel):
    """Chart configuration."""
    animation: Optional[bool] = True
    showGrid: Optional[bool] = True
    showLegend: Optional[bool] = True

class ChartStyling(BaseModel):
    """Styling configuration for charts."""
    theme: str
    title: str
    description: str
    cartesianGrid: Optional[str] = None
    xAxis: Optional[str] = None
    yAxis: Optional[str] = None
    legend: Optional[str] = None
    dataElements: Optional[str] = None
    tile: Dict[str, Any]

class ChartReasoning(BaseModel):
    """Reasoning/insight for chart."""
    insight: str

class DashboardChart(BaseModel):
    """Dashboard chart configuration."""
    id: str
    chart_type: str
    title: str
    description: Optional[str] = None
    layout: ChartLayout
    datasets: List[ChartDataset]
    config: Optional[ChartConfig] = None
    styling: ChartStyling
    reasoning: Optional[ChartReasoning] = None

class TableLayout(BaseModel):
    """Layout configuration for tables."""
    x: int
    y: int
    w: int
    h: int
    minW: int
    minH: int

class TableColumn(BaseModel):
    """Table column configuration."""
    id: str
    label: str
    type: str

class TableStyling(BaseModel):
    """Styling configuration for tables."""
    theme: str
    title: str
    description: str
    headerBackground: Optional[str] = None
    headerText: Optional[str] = None
    rowText: Optional[str] = None
    tile: Dict[str, Any]

class DashboardTable(BaseModel):
    """Dashboard table configuration."""
    id: str
    title: str
    description: Optional[str] = None
    layout: TableLayout
    columns: List[TableColumn]
    data: List[Dict[str, Any]]
    styling: TableStyling

class DashboardInfo(BaseModel):
    """Dashboard metadata."""
    title: str
    description: Optional[str] = None

class DashboardConfig(BaseModel):
    """Complete dashboard configuration model for structured output."""
    dashboard: DashboardInfo
    created_at: Optional[str] = None
    metrics: List[DashboardMetric] = []
    charts: List[DashboardChart] = []
    tables: List[DashboardTable] = []
    insights: List[str] = []

class AnalyzeCSVWorkflow:
    
    def __init__(self):
        self.config = load_config()
        self.model = get_model_for_agent()
        self.python_tool = PythonREPLTool()
        self.tools = [self.python_tool, get_available_chart_types]
        self.model_with_tools = self.model.bind_tools(self.tools)
        self.messages = []
        self.workflow_output = None

    def _get_context_flags(self, conversation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract context flags from conversation for Router Agent.
        
        Returns:
            Dict with has_dashboard, has_asset, and dashboard_count
        """
        has_dashboard = False
        has_asset = False
        dashboard_count = 0
        
        # Check conversation.dashboards
        dashboards_list = conversation.get("dashboards") or []
        dashboard_count = len(dashboards_list)
        if dashboard_count > 0:
            has_dashboard = True
        
        # Scan nodes for dashboard content type
        nodes = conversation.get("nodes", [])
        for node in nodes:
            contents = node.get("contents", [])
            for content in contents:
                content_type = (content.get("type") or "").lower()
                if content_type == "dashboard":
                    has_dashboard = True
                elif content_type in ["asset", "attachment"]:
                    asset_data = content.get("data", {})
                    if asset_data.get("asset_id") and asset_data.get("s3_bucket") and asset_data.get("s3_key"):
                        has_asset = True
        
        return {
            "has_dashboard": has_dashboard,
            "has_asset": has_asset,
            "dashboard_count": dashboard_count,
        }

    def init_messages(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
        mode: str = "dashboard",
    ):
        """Initialize conversation history with prior nodes and latest request."""
        # Select system prompt based on mode
        if mode == "qa":
            system_prompt = QA_SYSTEM_PROMPT
        else:
            system_prompt = DASHBOARD_SYSTEM_PROMPT
        self.messages = [SystemMessage(content=system_prompt)]

        # Include all nodes without filtering
        nodes = conversation.get("nodes", [])

        for node in nodes:
            message = self._node_to_message(node, dashboards)
            if message is not None:
                self.messages.append(message)

        effective_prompt = (
            user_prompt
            or conversation.get("metadata", {}).get("prompt")
            or "Please analyze the data."
        )

        # File availability check
        file_exists = file_path and os.path.exists(file_path) if file_path else False
        is_placeholder = file_path and "qa_" in file_path if file_path else False
        
        # Build instruction message based on mode
        if mode == "dashboard" and file_exists and not is_placeholder:
            # Dashboard mode with real file - simple instruction: user prompt + file path
            instruction = f"User wants to: {effective_prompt}\n\nCSV file available at: {file_path}"
            
        elif mode == "qa" and file_exists and not is_placeholder:
            # Q&A mode with real file - conditionally suggest Python based on question type
            # Check if question seems data-related (contains data-related keywords)
            data_keywords = ["data", "csv", "file", "column", "row", "value", "calculate", "sum", "average", "count", "total", "metric", "statistic"]
            question_lower = effective_prompt.lower()
            is_data_question = any(keyword in question_lower for keyword in data_keywords)
            
            instruction_parts = [
                f"User question: {effective_prompt}",
            ]
            
            if is_data_question:
                instruction_parts.extend([
                    f"",
                    f"CSV file available at: {file_path}",
                    f"",
                    f"If the question requires data from the CSV file, use the python_repl tool to read and analyze it.",
                ])
            else:
                instruction_parts.extend([
                    f"",
                    f"Note: A CSV file is available at {file_path}, but this question appears to be about general knowledge.",
                    f"Answer the question directly using your knowledge. Only use the python_repl tool if the question specifically requires data from the file.",
                ])
            
            instruction = "\n".join(instruction_parts)
            
        else:
            # Fallback for cases without file or placeholder files
            context_parts = []
            if file_exists and not is_placeholder:
                context_parts.append(f"📊 CSV file available at: {file_path}")
            else:
                context_parts.append("ℹ️  No data file available")
            
            if dashboards:
                dashboard_count = len(dashboards)
                context_parts.append(f"📈 {dashboard_count} dashboard(s) exist in this conversation")
            
            context_parts.append(f"🎯 User request: {effective_prompt}")
            
            if mode == "dashboard":
                context_parts.append(
                    "IMPORTANT: You MUST use the `python_repl` tool to inspect the dataframe "
                    "(e.g., df.head(), df.info()) to understand the column names and data types "
                    "BEFORE generating the dashboard JSON. Do not hallucinate column names. "
                    "Output ONLY valid JSON after analysis."
                )
            elif mode == "qa":
                # For Q&A without file, clarify tool usage
                if not file_exists or is_placeholder:
                    context_parts.append(
                        "Answer the question directly. Only use tools if the question requires data analysis or calculations."
                    )
            
            instruction = "\n\n".join(context_parts)
        
        self.messages.append(HumanMessage(content=instruction))
        return self.messages
    
    def _execute_tool_call(self, tool_call: Dict[str, Any]) -> ToolMessage:
        """
        Execute a single tool call and return ToolMessage.
        
        Args:
            tool_call: Tool call dict with 'name', 'args', and 'id' keys
            
        Returns:
            ToolMessage with result or error
        """
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]
        tool_call_id = tool_call["id"]
        
        logger.info(f"Executing tool: {tool_name}")
        
        try:
            if tool_name.lower() == "python_repl":
                tool_result = self.python_tool.run(tool_args["query"])
            elif tool_name.lower() == "get_available_chart_types":
                tool_result = get_available_chart_types.invoke({})
            else:
                tool_result = f"Unknown tool: {tool_name}"
            
            logger.info(f"Tool result: {str(tool_result)[:200]}...")
            return ToolMessage(
                content=str(tool_result),
                tool_call_id=tool_call_id
            )
        except Exception as e:
            error_msg = f"Error executing {tool_name}: {str(e)}"
            logger.error(error_msg)
            return ToolMessage(
                content=error_msg,
                tool_call_id=tool_call_id
            )
    
    def _route_request(self, user_prompt: str, conversation: Dict[str, Any]) -> RouteDecision:
        """
        Route user request to appropriate workflow using Router Agent.
        
        Args:
            user_prompt: The user's current request
            conversation: The conversation context
            
        Returns:
            RouteDecision with next_step and reasoning
        """
        try:
            # Get context flags
            context_flags = self._get_context_flags(conversation)
            has_asset = context_flags["has_asset"]
            dashboard_count = context_flags["dashboard_count"]
            
            # Format router system prompt with context variables
            router_prompt = ROUTER_SYSTEM_PROMPT.format(
                has_asset=has_asset,
                dashboard_count=dashboard_count
            )
            
            # Build conversation history for router (last 10 nodes for context)
            nodes = conversation.get("nodes", [])
            recent_nodes = nodes[-10:] if len(nodes) > 10 else nodes
            
            # Build router messages
            router_messages = [SystemMessage(content=router_prompt)]
            
            # Add recent conversation history
            for node in recent_nodes:
                message = self._node_to_message(node, conversation.get("dashboards", {}))
                if message is not None:
                    router_messages.append(message)
            
            # Add current user prompt
            router_messages.append(HumanMessage(content=f"Current user request: {user_prompt}"))
            
            # Try to use structured output
            try:
                router_model = self.model.with_structured_output(RouteDecision)
                route_decision = router_model.invoke(router_messages)
                logger.info(f"Router decision: {route_decision.next_step} - {route_decision.reasoning}")
                return route_decision
            except (AttributeError, TypeError, Exception) as e:
                # Fallback: call model normally and parse response
                logger.warning(f"Structured output not available, using fallback parsing: {str(e)}")
                response = self.model.invoke(router_messages)
                content = str(response.content) if response.content else ""
                
                # Try to parse JSON from response
                try:
                    # Look for JSON in response
                    json_match = re.search(r'\{[^{}]*"next_step"[^{}]*\}', content, re.DOTALL)
                    if json_match:
                        json_str = json_match.group(0)
                        parsed = json.loads(json_str)
                        route_decision = RouteDecision(**parsed)
                        logger.info(f"Router decision (parsed): {route_decision.next_step} - {route_decision.reasoning}")
                        return route_decision
                except (json.JSONDecodeError, KeyError, TypeError) as parse_error:
                    logger.warning(f"Failed to parse router response: {str(parse_error)}")
                
                # Final fallback: default to dashboard
                logger.warning("Router failed, defaulting to dashboard")
                return RouteDecision(
                    next_step="dashboard",
                    reasoning="Default fallback due to routing error"
                )
        except Exception as e:
            logger.error(f"Router Agent error: {str(e)}")
            # Default to dashboard on any error (backwards compatibility)
            return RouteDecision(
                next_step="dashboard",
                reasoning=f"Default fallback due to routing error: {str(e)}"
            )
    
    def _run_dashboard_workflow(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
        conversation_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Execute dashboard workflow: generate dashboard JSON configuration.
        
        Returns:
            Dict with type="dashboard_config", data, workflow_output, summary
        """
        logger.info("Running dashboard workflow")
        
        # Initialize messages with dashboard mode
        self.init_messages(file_path, conversation, dashboards, user_prompt, mode="dashboard")
        
        # Add system prompt and instruction message to workflow output for full conversation history
        # System message and instruction context are new and should be saved
        # Note: User messages from conversation history are already in conversation.nodes, 
        # but we save system prompt and workflow-generated messages for complete audit trail
        if self.messages:
            # Add system message (first message) to workflow output
            system_msg = self.messages[0]
            if isinstance(system_msg, SystemMessage):
                self.workflow_output.add_message(system_msg)
            
            # Add instruction message (last HumanMessage) to workflow output
            # This contains the context we built (file path, dashboard count, user request)
            for msg in reversed(self.messages):
                if isinstance(msg, HumanMessage):
                    self.workflow_output.add_message(msg)
                    break
        
        max_iterations = 10
        final_content = ""
        
        try:
            for iteration in range(max_iterations):
                logger.info(f"Dashboard workflow iteration {iteration + 1}")
                
                # Check workflow status before each iteration
                if conversation_id and project_id:
                    import sys
                    import os
                    # Add parent directory to path to import from server
                    server_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), 'server.py')
                    if os.path.exists(server_path):
                        import importlib.util
                        spec = importlib.util.spec_from_file_location("server", server_path)
                        server_module = importlib.util.module_from_spec(spec)
                        spec.loader.exec_module(server_module)
                        status = server_module._check_workflow_status(conversation_id, project_id)
                    else:
                        status = None
                    if status == "stopped":
                        logger.info("Workflow stopped by user")
                        self.workflow_output.set_completed("stopped", "Workflow stopped by user")
                        # Extract partial content from messages if available
                        partial_content = ""
                        for msg in reversed(self.messages):
                            if isinstance(msg, AIMessage) and msg.content:
                                partial_content = str(msg.content)
                                break
                        if partial_content:
                            json_data = self._extract_json_from_content(partial_content)
                            if json_data and isinstance(json_data, dict):
                                self.workflow_output.output_data = json_data
                                return {
                                    "type": "dashboard_config",
                                    "data": json_data,
                                    "workflow_output": self.workflow_output,
                                    "summary": "Workflow stopped - partial results",
                                }
                        # Return empty result if no partial content
                        return {
                            "type": "dashboard_config",
                            "error": "Workflow stopped by user",
                            "workflow_output": self.workflow_output,
                        }
                
                # Get model response
                response = self.model_with_tools.invoke(self.messages)
                self.messages.append(response)
                
                # Safely check for tool calls
                has_tool_calls = bool(response.tool_calls and len(response.tool_calls) > 0)
                
                # Log response details for debugging
                response_content = str(response.content) if response.content else ""
                logger.info(
                    f"Iteration {iteration + 1} response: has_tool_calls={has_tool_calls}, "
                    f"tool_calls_count={len(response.tool_calls) if response.tool_calls else 0}, "
                    f"content_length={len(response_content)}"
                )
                
                # Add response to workflow output
                tool_calls_data = None
                if has_tool_calls:
                    tool_calls_data = [{"name": tc["name"], "args": tc["args"]} for tc in response.tool_calls]
                self.workflow_output.add_message(response, tool_calls=tool_calls_data)
                
                # Check if the response contains tool calls
                if not has_tool_calls:
                    logger.info("No more tool calls - dashboard analysis complete")
                    final_content = response_content
                    
                    # Handle empty content with structured output fallback
                    if not final_content or not final_content.strip():
                        logger.warning(
                            f"Model returned empty content in iteration {iteration + 1}. "
                            f"Attempting structured output mode."
                        )
                        
                        # Check if we have a file but no tool calls were made - enforce tool usage
                        file_exists = file_path and os.path.exists(file_path) if file_path else False
                        is_placeholder = file_path and "qa_" in file_path if file_path else False
                        
                        if file_exists and not is_placeholder and iteration < 2:
                            logger.info(
                                f"File exists at {file_path} but no tools called in iteration {iteration + 1}. "
                                "Requesting tool usage."
                            )
                            self.messages.append(HumanMessage(
                                content=(
                                    f"You must use tools first. Load the CSV file at {file_path} using python_repl: "
                                    f"df = pd.read_csv('{file_path}'); print(df.head()); print(df.info()); print(df.columns.tolist())"
                                )
                            ))
                            continue
                        
                        # Try structured output when content is empty and we've used tools
                        # Check if we have tool messages in history (indicating tools were used)
                        has_tool_history = any(
                            isinstance(msg, ToolMessage) for msg in self.messages
                        )
                        
                        if has_tool_history:
                            try:
                                logger.info("Attempting structured output for dashboard JSON generation")
                                structured_model = self.model.with_structured_output(DashboardConfig)
                                structured_response = structured_model.invoke(self.messages)
                                
                                # Convert Pydantic model to dict
                                if hasattr(structured_response, 'model_dump'):
                                    final_content = structured_response.model_dump()
                                elif hasattr(structured_response, 'dict'):
                                    final_content = structured_response.dict()
                                else:
                                    final_content = structured_response
                                
                                logger.info("Successfully generated dashboard using structured output")
                                
                                # Add the structured response as an AIMessage for workflow output
                                if isinstance(final_content, dict):
                                    # Convert dict to JSON string for compatibility
                                    final_content_str = json.dumps(final_content, ensure_ascii=False, indent=2)
                                    ai_response = AIMessage(content=final_content_str)
                                    self.workflow_output.add_message(ai_response)
                                
                                break
                            except (AttributeError, TypeError, Exception) as e:
                                logger.warning(f"Structured output failed: {str(e)}. Falling back to retry logic.")
                                # Fall through to retry logic below
                        
                        # Allow multiple iterations with empty content (up to 3 iterations)
                        if iteration < 3:
                            logger.info(
                                f"Continuing to iteration {iteration + 2} due to empty content. "
                                f"Current iteration: {iteration + 1}"
                            )
                            self.messages.append(HumanMessage(
                                content="Please provide your analysis and dashboard JSON configuration."
                            ))
                            continue
                        
                        # If we get here with empty content after retries, it's an error
                        error_msg = (
                            f"Model returned empty content after {iteration + 1} iterations. "
                            "Workflow cannot proceed without content."
                        )
                        logger.error(error_msg)
                        self.workflow_output.set_completed("error", error_msg)
                        return {
                            "type": "dashboard_config",
                            "error": error_msg,
                            "workflow_output": self.workflow_output,
                        }
                    
                    # If we have content, proceed normally
                    if isinstance(final_content, dict):
                        content_preview = json.dumps(final_content, ensure_ascii=False)[:200] + "..." if len(json.dumps(final_content)) > 200 else json.dumps(final_content, ensure_ascii=False)
                    else:
                        content_preview = (final_content[:200] + "...") if len(final_content) > 200 else final_content
                    logger.info(
                        "Dashboard workflow complete. Final content preview: %s",
                        content_preview,
                    )
                    break

                # Process tool calls
                logger.info(f"Processing {len(response.tool_calls)} tool calls...")
                for tool_call in response.tool_calls:
                    tool_message = self._execute_tool_call(tool_call)
                    self.messages.append(tool_message)
                    self.workflow_output.add_message(tool_message, tool_call_id=tool_call["id"])
        
        except Exception as e:
            error_msg = f"Dashboard workflow error: {str(e)}"
            logger.error(error_msg)
            self.workflow_output.set_completed("error", error_msg)
            return {"type": "dashboard_config", "error": str(e), "workflow_output": self.workflow_output}
        
        # Set workflow as completed
        self.workflow_output.set_completed("success")
        
        # Extract JSON from final content
        json_data = self._extract_json_from_content(final_content)
        
        if json_data and isinstance(json_data, dict):
            self.workflow_output.output_data = json_data
            logger.info("CSV analysis workflow completed successfully with dashboard JSON")
            charts_len = len(json_data.get("charts", [])) if isinstance(json_data, dict) else 0
            metrics_len = len(json_data.get("metrics", [])) if isinstance(json_data, dict) else 0
            summary = self._build_summary(charts_len, metrics_len)
            logger.info(f"Final results: {charts_len} charts, {metrics_len} metrics")
            return {
                "type": "dashboard_config",
                "data": json_data,
                "workflow_output": self.workflow_output,
                "summary": summary,
            }
        else:
            # Enhanced error reporting
            if isinstance(final_content, dict):
                final_content_str = json.dumps(final_content, ensure_ascii=False, indent=2)
                final_content_length = len(final_content_str)
                final_content_preview = (final_content_str[:500] + "...") if len(final_content_str) > 500 else final_content_str
            else:
                final_content_length = len(final_content) if final_content else 0
                final_content_preview = (final_content[:500] + "...") if final_content and len(final_content) > 500 else (final_content or "(empty)")
            
            error_details = {
                "final_content_length": final_content_length,
                "final_content_preview": final_content_preview,
                "workflow_messages_count": len(self.workflow_output.messages) if hasattr(self.workflow_output, 'messages') else 0,
            }
            error_msg = (
                f"Failed to extract dashboard JSON from response. "
                f"Content length: {error_details['final_content_length']}, "
                f"Messages in workflow: {error_details['workflow_messages_count']}"
            )
            logger.error(f"{error_msg}. Details: {error_details}")
            
            # If we have workflow messages, log the last few for debugging
            if hasattr(self.workflow_output, 'messages') and self.workflow_output.messages:
                logger.error("Last 3 workflow messages:")
                for msg in self.workflow_output.messages[-3:]:
                    msg_content = getattr(msg, 'content', str(msg))[:200] if hasattr(msg, 'content') else str(msg)[:200]
                    logger.error(f"  - {msg_content}")
            
            return {
                "type": "dashboard_config",
                "error": error_msg,
                "error_details": error_details,
                "workflow_output": self.workflow_output,
            }
    
    def execute(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
    ):
        """Execute the CSV analysis workflow with Router Agent"""
        
        # Create workflow output instance
        self.workflow_output = WorkflowOutput.create_new(
            workflow_name="analyze_csv",
            input_data={
                "file_path": file_path,
                "conversation_id": conversation.get("conversation_id"),
                "project_id": conversation.get("project_id"),
                "user_prompt": user_prompt or conversation.get("metadata", {}).get("prompt"),
            }
        )
        
        logger.info(
            "Starting CSV analysis workflow for file: %s (conversation=%s)",
            file_path,
            conversation.get("conversation_id"),
        )
        
        try:
            # Get effective prompt
            effective_prompt = (
                user_prompt
                or conversation.get("metadata", {}).get("prompt")
                or "Please analyze the data."
            )
            
            # Route request using Router Agent
            route_decision = self._route_request(effective_prompt, conversation)
            logger.info(f"Router decision: {route_decision.next_step} - {route_decision.reasoning}")
            
            # Extract conversation_id and project_id for status checking
            conversation_id = conversation.get("conversation_id")
            project_id = conversation.get("project_id")
            
            # Dispatch to appropriate workflow
            if route_decision.next_step == "dashboard":
                return self._run_dashboard_workflow(file_path, conversation, dashboards, user_prompt, conversation_id, project_id)
            elif route_decision.next_step == "qa":
                return self._run_qa_workflow(file_path, conversation, dashboards, user_prompt, conversation_id, project_id)
            else:
                # Default to dashboard (backwards compatibility)
                logger.warning(f"Unknown route decision: {route_decision.next_step}, defaulting to dashboard")
                return self._run_dashboard_workflow(file_path, conversation, dashboards, user_prompt, conversation_id, project_id)
        
        except Exception as e:
            error_msg = f"Workflow execution error: {str(e)}"
            logger.error(error_msg)
            self.workflow_output.set_completed("error", error_msg)
            return {"type": "dashboard_config", "error": str(e), "workflow_output": self.workflow_output}
    
    def _render_node_contents(self, node: Dict[str, Any], dashboards: Dict[str, Any]) -> str:
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

    def _node_to_message(self, node: Dict[str, Any], dashboards: Dict[str, Any]):
        """
        Convert a conversation node to appropriate LangChain message type.
        
        Args:
            node: Conversation node dict with role, contents, and optional metadata
            dashboards: Dict of dashboard_id -> dashboard_data for rendering
            
        Returns:
            HumanMessage, AIMessage, SystemMessage, ToolMessage, or None if invalid
        """
        role = (node.get("role") or "").lower()
        content_text = self._render_node_contents(node, dashboards)
        
        # Handle empty content - still create message objects for structure
        if not content_text:
            content_text = ""
        
        if role == "user":
            return HumanMessage(content=content_text)
        elif role == "assistant":
            return AIMessage(content=content_text)
        elif role == "system":
            return SystemMessage(content=content_text)
        elif role == "tool":
            metadata = node.get("metadata", {})
            tool_call_id = metadata.get("tool_call_id")
            if not tool_call_id:
                logger.warning(f"Tool node missing tool_call_id in metadata, skipping: {node.get('node_id', 'unknown')}")
                return None
            return ToolMessage(content=content_text, tool_call_id=tool_call_id)
        else:
            logger.warning(f"Unknown node role '{role}', skipping node: {node.get('node_id', 'unknown')}")
            return None

    def _build_summary(self, charts_len: int, metrics_len: int) -> str:
        return (
            f"Generated dashboard with {charts_len} chart(s) "
            f"and {metrics_len} metric(s)."
        )
    
    def _extract_json_from_content(self, content: Union[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Extract and parse JSON from LLM response content.
        
        Args:
            content: The LLM response content (may contain JSON in code blocks or be a dict)
            
        Returns:
            Parsed JSON dict if successful, None otherwise
        """
        # Handle dict input (already parsed JSON from LLM)
        if isinstance(content, dict):
            logger.info("Content is already a dict, returning directly")
            return content
        
        # Handle string input
        if not content or (isinstance(content, str) and not content.strip()):
            logger.warning("Empty content provided for JSON extraction")
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
    
    
    def _run_qa_workflow(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
        conversation_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Execute Q&A workflow: answer questions textually without generating dashboard.
        
        Returns:
            Dict with type="message", content, and workflow_output
        """
        logger.info("Running Q&A workflow")
        
        # Initialize messages with Q&A system prompt
        self.init_messages(file_path, conversation, dashboards, user_prompt, mode="qa")
        
        max_iterations = 10
        final_content = "I'm processing your question..."
        
        try:
            for iteration in range(max_iterations):
                logger.info(f"Q&A workflow iteration {iteration + 1}")
                
                # Check workflow status before each iteration
                if conversation_id and project_id:
                    import sys
                    import os
                    # Add parent directory to path to import from server
                    server_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), 'server.py')
                    if os.path.exists(server_path):
                        import importlib.util
                        spec = importlib.util.spec_from_file_location("server", server_path)
                        server_module = importlib.util.module_from_spec(spec)
                        spec.loader.exec_module(server_module)
                        status = server_module._check_workflow_status(conversation_id, project_id)
                    else:
                        status = None
                    if status == "stopped":
                        logger.info("Workflow stopped by user")
                        self.workflow_output.set_completed("stopped", "Workflow stopped by user")
                        # Extract partial content from messages if available
                        partial_content = "Workflow stopped by user."
                        for msg in reversed(self.messages):
                            if isinstance(msg, AIMessage) and msg.content:
                                partial_content = str(msg.content)
                                break
                        return {
                            "type": "message",
                            "content": partial_content,
                            "workflow_output": self.workflow_output,
                        }
                
                # Get model response
                response = self.model_with_tools.invoke(self.messages)
                self.messages.append(response)
                
                # Add response to workflow output
                tool_calls_data = None
                if response.tool_calls:
                    tool_calls_data = [{"name": tc["name"], "args": tc["args"]} for tc in response.tool_calls]
                self.workflow_output.add_message(response, tool_calls=tool_calls_data)
                
                # Check if the response contains tool calls
                if not response.tool_calls:
                    logger.info("No more tool calls - Q&A complete")
                    # Extract final text response
                    final_content = str(response.content) if response.content else "I've completed the analysis."
                    break

                # Process tool calls
                logger.info(f"Processing {len(response.tool_calls)} tool calls...")
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    
                    logger.info(f"Executing tool: {tool_name}")
                    
                    try:
                        # Execute the appropriate tool
                        if tool_name.lower() == "python_repl":
                            # Check if this is Q&A without file - skip file operations
                            is_placeholder = file_path and "qa_" in file_path if file_path else False
                            if is_placeholder:
                                # For Q&A without file, allow general Python but warn about file access
                                query = tool_args.get("query", "")
                                if "pd.read_csv" in query or "read_csv" in query or (file_path and file_path in query):
                                    tool_result = "No data file is available for this Q&A session. Please answer the user's question directly without trying to access a file."
                                else:
                                    # Allow other Python operations
                                    tool_result = self.python_tool.run(query)
                            else:
                                tool_result = self.python_tool.run(tool_args["query"])
                        elif tool_name.lower() == "get_available_chart_types":
                            tool_result = get_available_chart_types.invoke({})
                        else:
                            tool_result = f"Unknown tool: {tool_name}"
                        
                        logger.info(f"Tool result: {str(tool_result)[:200]}...")
                        
                        # Add tool result to messages
                        tool_message = ToolMessage(
                            content=str(tool_result),
                            tool_call_id=tool_call["id"]
                        )
                        self.messages.append(tool_message)
                        
                        # Add to workflow output
                        self.workflow_output.add_message(tool_message, tool_call_id=tool_call["id"])
                        
                    except Exception as e:
                        error_msg = f"Error executing {tool_name}: {str(e)}"
                        logger.error(error_msg)
                        tool_message = ToolMessage(
                            content=error_msg,
                            tool_call_id=tool_call["id"]
                        )
                        self.messages.append(tool_message)
                        self.workflow_output.add_message(tool_message, tool_call_id=tool_call["id"])
            
            # Set workflow as completed
            self.workflow_output.set_completed("success")
            
            # Return Q&A response structure
            return {
                "type": "message",
                "content": final_content,
                "workflow_output": self.workflow_output,
            }
        
        except Exception as e:
            error_msg = f"Q&A workflow error: {str(e)}"
            logger.error(error_msg)
            self.workflow_output.set_completed("error", error_msg)
            return {
                "type": "message",
                "content": f"I encountered an error while processing your question: {str(e)}",
                "workflow_output": self.workflow_output,
            }
