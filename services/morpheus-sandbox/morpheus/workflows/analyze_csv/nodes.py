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

🚫 CRITICAL DATA EMBEDDING REQUIREMENT 🚫
=========================================
NO SQL QUERIES ALLOWED IN JSON OUTPUT:
- Do NOT output any "query" or "sql" fields in the JSON
- You MUST execute Python code using Python_REPL to calculate ALL values BEFORE generating JSON
- The datasets[].data[] arrays MUST contain actual numbers derived from your Python execution
- NEVER use placeholders, query strings, or SQL statements in the output
- All values in datasets[].data[] must be final computed numbers from Python

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

Available Themes (choose ONE for entire dashboard):
- monochrome

CRITICAL THEME REQUIREMENT:
- Choose ONE theme for the entire dashboard
- EVERY metric, chart, and table styling object MUST include "theme" field
- ALL cards MUST use the SAME theme value
- Example: {"theme": "monochrome", "title": "title-color", ...}

TABLE FORMATTING:
=================
Transform raw CSV column names to human-readable labels:
- orderId → Order ID
- qty → Quantity
- amount → Amount
- createdAt → Created Date

NEVER use raw CSV field names in table columns.

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
  ]
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
        from morpheus.workflows.analyze_csv.workflow import RouteDecision
        
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
            if len(valid_files) == 1:
                # Single file - backward compatible prompt
                file_info = f"CSV file available at: {valid_files[0]}"
            else:
                # Multiple files - enhanced prompt with all file paths
                files_list = "\n".join([f"- File {i+1}: {fp}" for i, fp in enumerate(valid_files)])
                file_info = f"""Multiple CSV files available for analysis:
{files_list}

Load ALL files and combine/analyze as needed for the user's request. You can use pandas to merge, concatenate, or analyze files together."""
            
            if mode == "dashboard":
                instruction = f"User wants to: {state.input_prompt}\n\n{file_info}"
            else:
                instruction = f"User question: {state.input_prompt}\n\n{file_info}"
            
            messages.append(HumanMessage(content=instruction))
    
    # 🔥 FIX: Build conversation history from previous tool executions
    # This is crucial to prevent the agent from having "amnesia" and repeating the same actions
    conversation_history = _build_conversation_history_from_executions(state)
    messages.extend(conversation_history)
    
    # Call LLM
    try:
        response = model_with_tools.invoke(messages)
        
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
            # Agent provided final output
            action_request = ActionRequest(
                action_type="FINISH",
                reasoning="Agent provided final output",
            )
            
            # Store output in working memory
            if mode == "dashboard":
                # Extract JSON from content
                json_data = _extract_json_from_content(response.content)
                
                if json_data:
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
    VALIDATION Node: Validate output format and completeness.
    
    Validates that the output meets schema requirements and contains
    all necessary data.
    
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
        # Validate dashboard JSON
        validation_result = _validate_dashboard_json(state.output.get("data"))
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
