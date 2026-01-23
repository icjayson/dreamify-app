"""
Helper functions for stateful workflow.

This module contains utility functions extracted and refactored from the
original workflow implementation, plus new functions for state management.
"""

import os
import json
import re
from typing import Dict, Any, Optional, List
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage

from morpheus.workflows.analyze_csv.state_models import AgentState
from utils.logger import logger
from utils.postprocess import clean_json


def format_state_for_prompt(state: AgentState) -> str:
    """
    Convert AgentState to concise context string for LLM prompts.
    
    Optimizes token usage by:
    - Excluding binary data and file contents
    - Summarizing long outputs (truncate to key metadata)
    - Including only recent history (last N entries)
    - Highlighting errors and retry context
    
    Args:
        state: Current workflow state
        
    Returns:
        Formatted string with essential context for LLM decision-making
    """
    
    sections = []
    
    # 1. Current State Summary
    sections.append(f"""CURRENT STATE:
- Node: {state.current_node}
- Iteration: {state.iteration}/{state.max_iterations}
- Status: {state.status}""")
    
    # 2. Route Decision (if available)
    route_decision = state.working_memory.tool_outputs.get("route_decision")
    if route_decision:
        sections.append(f"""WORKFLOW MODE: {route_decision.get('next_step')}
Reasoning: {route_decision.get('reasoning')}""")
    
    # 3. Working Memory Summary (filtered)
    wm_summary = []
    
    # Data analysis status
    if state.working_memory.dataframe_profile:
        profile = state.working_memory.dataframe_profile
        wm_summary.append(f"- DataFrame profiled: {profile.get('shape', 'unknown shape')}")
    
    if state.working_memory.column_analysis:
        col_count = len(state.working_memory.column_analysis.get('columns', []))
        wm_summary.append(f"- Columns analyzed: {col_count}")
    
    # Tool execution summary (last 3 only)
    recent_tools = state.working_memory.python_execution_results[-3:]
    if recent_tools:
        wm_summary.append(f"- Recent tool executions: {len(recent_tools)}")
        for idx, tool_result in enumerate(recent_tools, 1):
            status = "✓" if tool_result.get("success") else "✗"
            tool_name = tool_result.get("tool_name", "unknown")
            # Truncate output preview
            output_preview = str(tool_result.get("output", ""))[:100]
            if len(str(tool_result.get("output", ""))) > 100:
                output_preview += "..."
            wm_summary.append(f"  {status} Tool {idx}: {tool_name} - {output_preview}")
    
    # Generation artifacts status
    if state.working_memory.dashboard_json:
        charts_count = len(state.working_memory.dashboard_json.get("charts", []))
        metrics_count = len(state.working_memory.dashboard_json.get("metrics", []))
        wm_summary.append(f"- Dashboard generated: {charts_count} charts, {metrics_count} metrics")
    
    if state.working_memory.qa_response:
        response_preview = state.working_memory.qa_response[:80]
        if len(state.working_memory.qa_response) > 80:
            response_preview += "..."
        wm_summary.append(f"- QA response: {response_preview}")
    
    if wm_summary:
        sections.append("WORKING MEMORY:\n" + "\n".join(wm_summary))
    
    # 4. Recent Errors (last 3 only, if any)
    if state.working_memory.errors:
        recent_errors = state.working_memory.errors[-3:]
        error_lines = []
        for err in recent_errors:
            error_text = err.get('error', 'Unknown error')
            if len(error_text) > 100:
                error_text = error_text[:100] + "..."
            error_lines.append(f"- [{err.get('node', 'unknown')}] {error_text}")
        
        sections.append(f"""RECENT ERRORS (Retry count: {state.working_memory.retry_count}):
{chr(10).join(error_lines)}""")
    
    # 5. Recent Workflow History (last 5 entries)
    if state.workflow_history.entries:
        recent_history = state.workflow_history.entries[-5:]
        history_lines = []
        for entry in recent_history:
            status_icon = "✓" if entry.success else "✗"
            history_lines.append(
                f"{status_icon} {entry.from_state} → {entry.action} → {entry.to_state} ({entry.duration_ms:.0f}ms)"
            )
        
        sections.append("RECENT HISTORY:\n" + "\n".join(history_lines))
    
    # 6. Available Context
    context_items = []
    
    # File info
    if state.file_path:
        file_exists = os.path.exists(state.file_path) if state.file_path else False
        context_items.append(f"- Data file: {state.file_path} ({'exists' if file_exists else 'missing'})")
    
    # User assets count
    asset_count = len(state.user_state.user_assets)
    if asset_count > 0:
        context_items.append(f"- User assets: {asset_count} file(s)")
    
    # Existing dashboards count
    dashboard_count = len(state.user_state.dashboards)
    if dashboard_count > 0:
        context_items.append(f"- Existing dashboards: {dashboard_count}")
    
    # Conversation history depth
    history_depth = len(state.user_state.conversation_history)
    if history_depth > 0:
        context_items.append(f"- Conversation history: {history_depth} message(s)")
    
    if context_items:
        sections.append("AVAILABLE CONTEXT:\n" + "\n".join(context_items))
    
    # 7. User Intent
    sections.append(f"""USER REQUEST:
{state.input_prompt}""")
    
    # Combine all sections
    formatted_context = "\n\n".join(sections)
    
    # Add separator for clarity
    formatted_context = f"""
{'='*60}
WORKFLOW STATE CONTEXT
{'='*60}

{formatted_context}

{'='*60}
"""
    
    return formatted_context


def extract_json_from_content(content: Any) -> Optional[Dict[str, Any]]:
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


def node_to_message(node: Dict[str, Any], dashboards: Dict[str, Any]):
    """
    Convert a conversation node to appropriate LangChain message type.
    
    Args:
        node: Conversation node dict with role, contents, and optional metadata
        dashboards: Dict of dashboard_id -> dashboard_data for rendering
        
    Returns:
        HumanMessage, AIMessage, SystemMessage, ToolMessage, or None if invalid
    """
    role = (node.get("role") or "").lower()
    content_text = render_node_contents(node, dashboards)
    
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
            logger.warning(
                f"Tool node missing tool_call_id in metadata, skipping: {node.get('node_id', 'unknown')}"
            )
            return None
        return ToolMessage(content=content_text, tool_call_id=tool_call_id)
    else:
        logger.warning(f"Unknown node role '{role}', skipping node: {node.get('node_id', 'unknown')}")
        return None


def render_node_contents(node: Dict[str, Any], dashboards: Dict[str, Any]) -> str:
    """
    Render node contents to text string.
    
    Args:
        node: Conversation node dict
        dashboards: Dict of dashboard_id -> dashboard_data
        
    Returns:
        Rendered text content
    """
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


def build_router_messages(
    user_prompt: str,
    conversation_history: List[Dict[str, Any]],
    dashboards: Dict[str, Any],
    has_asset: bool,
    dashboard_count: int,
) -> List:
    """
    Build message history for router agent.
    
    Args:
        user_prompt: Current user request
        conversation_history: List of conversation nodes
        dashboards: Dict of existing dashboards
        has_asset: Whether user has uploaded assets
        dashboard_count: Number of existing dashboards
        
    Returns:
        List of LangChain messages for router
    """
    from morpheus.workflows.analyze_csv.nodes import ROUTER_SYSTEM_PROMPT
    
    # Format router system prompt with context
    router_prompt = ROUTER_SYSTEM_PROMPT.format(
        has_asset=has_asset,
        dashboard_count=dashboard_count
    )
    
    messages = [SystemMessage(content=router_prompt)]
    
    # Add recent conversation history (last 10 nodes)
    recent_history = (
        conversation_history[-10:]
        if len(conversation_history) > 10
        else conversation_history
    )
    
    for node in recent_history:
        message = node_to_message(node, dashboards)
        if message is not None:
            messages.append(message)
    
    # Add current user prompt
    messages.append(HumanMessage(content=f"Current user request: {user_prompt}"))
    
    return messages


def validate_dashboard_json(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate dashboard JSON structure and completeness.
    
    Args:
        data: Dashboard configuration dict
        
    Returns:
        Dict with 'valid' bool and optional 'error' message
    """
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
    
    # Validate charts have datasets
    charts = data.get("charts", [])
    for idx, chart in enumerate(charts):
        if not chart.get("datasets"):
            return {
                "valid": False,
                "error": f"Chart {idx} ({chart.get('id', 'unknown')}) has no datasets"
            }
        
        # Check that datasets are not empty arrays
        datasets = chart.get("datasets", [])
        for ds_idx, dataset in enumerate(datasets):
            if not dataset.get("data"):
                return {
                    "valid": False,
                    "error": f"Chart {idx} dataset {ds_idx} has empty data array"
                }
    
    return {"valid": True}


def validate_qa_response(content: str) -> Dict[str, Any]:
    """
    Validate Q&A response content.
    
    Args:
        content: Q&A text response
        
    Returns:
        Dict with 'valid' bool and optional 'error' message
    """
    if not content:
        return {"valid": False, "error": "Q&A response is empty"}
    
    if not isinstance(content, str):
        return {"valid": False, "error": f"Q&A response is not a string, got {type(content)}"}
    
    if len(content.strip()) < 10:
        return {"valid": False, "error": "Q&A response is too short (less than 10 characters)"}
    
    return {"valid": True}


def build_summary(result: Dict[str, Any]) -> str:
    """
    Build summary string for workflow output.
    
    Args:
        result: Workflow result dict
        
    Returns:
        Human-readable summary string
    """
    output_type = result.get("type")
    
    if output_type == "dashboard_config":
        data = result.get("data", {})
        if isinstance(data, dict):
            charts_count = len(data.get("charts", []))
            metrics_count = len(data.get("metrics", []))
            tables_count = len(data.get("tables", []))
            
            parts = []
            if charts_count > 0:
                parts.append(f"{charts_count} chart(s)")
            if metrics_count > 0:
                parts.append(f"{metrics_count} metric(s)")
            if tables_count > 0:
                parts.append(f"{tables_count} table(s)")
            
            return f"Generated dashboard with {', '.join(parts)}."
        else:
            return "Generated dashboard."
    
    elif output_type == "message":
        content = result.get("content", "")
        if content:
            preview = content[:50] + "..." if len(content) > 50 else content
            return f"Q&A response: {preview}"
        else:
            return "Generated Q&A response."
    
    else:
        return "Workflow completed."


def get_context_flags(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract context flags from conversation for Router Agent.
    
    Args:
        conversation: Conversation dict from S3
        
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
                if (
                    asset_data.get("asset_id")
                    and asset_data.get("s3_bucket")
                    and asset_data.get("s3_key")
                ):
                    has_asset = True
    
    return {
        "has_dashboard": has_dashboard,
        "has_asset": has_asset,
        "dashboard_count": dashboard_count,
    }
