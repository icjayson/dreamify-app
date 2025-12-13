from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from morpheus.tools.python_repl.tool import PythonREPLTool, PersistentPythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.workflows.analyze_csv.prompts.analysis_prompts import UNIFIED_SYSTEM_PROMPT
from morpheus.workflows.base import WorkflowOutput
from utils.config import load_config
from utils.logger import logger
import json
import re
import os
from typing import Any, Dict, Optional, List

class AnalyzeCSVWorkflow:
    
    def __init__(self):
        self.config = load_config()
        self.model = ChatOpenAI(
            model=self.config.openai.agent[0].model,
            temperature=self.config.openai.agent[0].temperature,
            api_key=self.config.openai.api_key
        )
        self.python_tool = PythonREPLTool()
        self.tools = [self.python_tool, get_available_chart_types]
        self.model_with_tools = self.model.bind_tools(self.tools)
        self.messages = []
        self.workflow_output = None

    def init_messages(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
    ):
        """Initialize conversation history with prior nodes and latest request."""
        self.messages = [SystemMessage(content=UNIFIED_SYSTEM_PROMPT)]

        for node in conversation.get("nodes", []):
            content_text = self._render_node_contents(node, dashboards)
            if not content_text:
                continue
            role = (node.get("role") or "").lower()
            if role == "user":
                self.messages.append(HumanMessage(content=content_text))
            elif role == "assistant":
                self.messages.append(AIMessage(content=content_text))

        effective_prompt = (
            user_prompt
            or conversation.get("metadata", {}).get("prompt")
            or "Please analyze the data."
        )

        # Build simple factual context
        context_parts = []
        
        # File availability
        file_exists = file_path and os.path.exists(file_path) if file_path else False
        is_placeholder = file_path and "qa_" in file_path if file_path else False
        
        if file_exists and not is_placeholder:
            context_parts.append(f"📊 CSV file available at: {file_path}")
        else:
            context_parts.append("ℹ️  No data file available")
        
        # Dashboard count
        if dashboards:
            dashboard_count = len(dashboards)
            context_parts.append(f"📈 {dashboard_count} dashboard(s) exist in this conversation")
        
        # User request
        context_parts.append(f"🎯 User request: {effective_prompt}")
        
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
    
    def execute(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
    ):
        """Execute the CSV analysis workflow"""
        
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
        
        # Initialize messages with unified prompt (LLM decides response format)
        self.init_messages(file_path, conversation, dashboards, user_prompt)
        
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
                logger.info(f"Workflow iteration {iteration + 1}")
                
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
                    logger.info("No more tool calls - analysis complete")
                    final_content = response.content or ""
                    break

                # Process tool calls
                logger.info(f"Processing {len(response.tool_calls)} tool calls...")
                for tool_call in response.tool_calls:
                    tool_message = self._execute_tool_call(tool_call)
                    self.messages.append(tool_message)
                    self.workflow_output.add_message(tool_message, tool_call_id=tool_call["id"])
        
        except Exception as e:
            error_msg = f"Workflow error: {str(e)}"
            logger.error(error_msg)
            self.workflow_output.set_completed("error", error_msg)
            return {"type": "dashboard_config", "error": str(e)}
        
        # Set workflow as completed
        self.workflow_output.set_completed("success")
        
        # Extract typed response from final content
        extraction_result = self._extract_typed_response(final_content)
        response_type = extraction_result.get("type")
        
        if response_type == "dashboard":
            # Dashboard mode - extract JSON
            logger.info("Processing as Dashboard response")
            json_data = extraction_result.get("data")
            
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
                # Fallback - return error
                error_msg = extraction_result.get("error") or "Failed to extract dashboard JSON from response"
                logger.error(error_msg)
                return {
                    "type": "dashboard_config",
                    "error": error_msg,
                    "workflow_output": self.workflow_output,
                }
        elif response_type == "message":
            # Q&A mode - return text response
            logger.info("Processing as Q&A text response")
            content = extraction_result.get("data") or final_content
            return {
                "type": "message",
                "content": content,
                "workflow_output": self.workflow_output,
            }
        else:
            # Error type
            error_msg = extraction_result.get("error") or "Unknown error during response extraction"
            logger.error(error_msg)
            return {
                "type": "dashboard_config",
                "error": error_msg,
                "workflow_output": self.workflow_output,
            }
    
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

    def _build_summary(self, charts_len: int, metrics_len: int) -> str:
        return (
            f"Generated dashboard with {charts_len} chart(s) "
            f"and {metrics_len} metric(s)."
        )
    
    def _extract_typed_response(self, content: str) -> Dict[str, Any]:
        """
        Extract and type the LLM response content.
        
        Args:
            content: The response content from the LLM
            
        Returns:
            Dict with keys:
            - type: "dashboard" | "message" | "error"
            - data: Parsed JSON dict (if dashboard), text content (if message), None (if error)
            - error: Error message string (if error), None otherwise
        """
        if not content:
            return {"type": "message", "data": "", "error": None}
        
        # Try JSON code block extraction
        json_pattern = r'```json\s*(\{[\s\S]*?\})\s*```'
        json_match = re.search(json_pattern, content, re.DOTALL)
        
        if json_match:
            try:
                json_str = json_match.group(1)
                json_data = json.loads(json_str)
                logger.info("Extracted JSON from code block - Dashboard type")
                charts_count = len(json_data.get("charts", [])) if isinstance(json_data, dict) else 0
                metrics_count = len(json_data.get("metrics", [])) if isinstance(json_data, dict) else 0
                logger.info(f"Extracted dashboard with {charts_count} charts and {metrics_count} metrics")
                return {"type": "dashboard", "data": json_data, "error": None}
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON from code block: {e}")
                return {"type": "error", "data": None, "error": f"Invalid JSON in code block: {str(e)}"}
        
        # Try plain JSON parsing
        try:
            content_stripped = content.strip()
            if content_stripped.startswith('{') and content_stripped.endswith('}'):
                json_data = json.loads(content_stripped)
                logger.info("Extracted plain JSON - Dashboard type")
                return {"type": "dashboard", "data": json_data, "error": None}
        except (json.JSONDecodeError, ValueError) as e:
            logger.debug(f"Content is not plain JSON: {e}")
        
        # Default to message type
        logger.info("Detected text response - Message type")
        return {"type": "message", "data": content, "error": None}
