from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from morpheus.tools.python_repl.tool import PythonREPLTool, PersistentPythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.workflows.analyze_csv.prompts.analysis_prompts import UNIFIED_SYSTEM_PROMPT
from morpheus.workflows.base import WorkflowOutput
from morpheus.models.base import get_model_for_agent
from morpheus.workflows.analyze_csv.intent_detector import detect_user_intent
from utils.config import load_config
from utils.logger import logger
import json
import re
import os
from typing import Any, Dict, Optional, List

class AnalyzeCSVWorkflow:
    
    def __init__(self):
        self.config = load_config()
        self.model = get_model_for_agent()
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
        extraction_result = self._extract_typed_response(user_prompt, conversation, final_content)
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
    
    def _extract_typed_response(self, user_prompt, conversation, content: str) -> Dict[str, Any]:
        """
        Extract and type the LLM response content.
        
        Args:
            content: The response content from the LLM
            
        Returns:
            "qa" or "dashboard"
        """
        if not user_prompt:
            # Default to dashboard if no prompt
            return {
                "type": "dashboard",
                "data": None,
            }

        # ---- RULE-BASED OVERRIDE: FEATURE-AWARE INTENT ----
        # If a data asset is attached to the conversation, no dashboards exist yet,
        # and the latest user prompt explicitly asks for a dashboard/visualization,
        # we force "dashboard" intent without consulting the classifier.

        # Detect whether an asset is present on the conversation by checking nodes
        asset_present = False
        nodes = conversation.get("nodes", [])
        for node in nodes:
            contents = node.get("contents", [])
            for content in contents:
                if content.get("type") in ["asset", "attachment"]:
                    asset_data = content.get("data", {})
                    if asset_data.get("asset_id") and asset_data.get("s3_bucket") and asset_data.get("s3_key"):
                        asset_present = True
                        break
            if asset_present:
                break

        # Detect whether any dashboards already exist for this conversation
        dashboards = conversation.get("dashboards") or []
        has_existing_dashboard = bool(dashboards)

        # Simple keyword-based detection of explicit dashboard requests
        lower_prompt = user_prompt.lower()
        dashboard_keywords = [
            "dashboard",
            "visualize",
            "visualise",
            "visualization",
            "visualisation",
            "chart",
            "charts",
            "graph",
            "graphs",
            "plot",
            "plots",
            "create dashboard",
            "build dashboard",
            "make dashboard",
            "generate dashboard",
        ]
        explicit_dashboard_request = any(keyword in lower_prompt for keyword in dashboard_keywords)

        if asset_present and not has_existing_dashboard and explicit_dashboard_request:
            logger.info(
                "Forcing intent to 'dashboard' (asset present, no dashboards yet, explicit dashboard request detected)."
            )
            return "dashboard"

        # ---- FALLBACK: LLM-BASED INTENT DETECTION ----
        # Extract conversation history for context
        conversation_history = conversation.get("nodes", [])

        # Detect intent using LLM
        intent = detect_user_intent(user_prompt, conversation_history)
        logger.info(f"Detected intent: {intent} for prompt: {user_prompt[:50]}...")
        return intent
    
    def _execute_qa_mode(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
    ):
        """
        Execute Q&A mode: answer questions without generating dashboard.
        
        Returns:
            Dict with type="message", content, and workflow_output
        """
        logger.info("Executing Q&A mode")
        
        # Initialize messages with Q&A system prompt
        self.init_messages(file_path, conversation, dashboards, user_prompt, mode="qa")
        
        # Add initial messages to workflow output
        for msg in self.messages:
            self.workflow_output.add_message(msg)
        
        max_iterations = 10
        final_content = "I'm processing your question..."
        
        try:
            for iteration in range(max_iterations):
                logger.info(f"Q&A workflow iteration {iteration + 1}")
                
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
                    final_content = response.content or "I've completed the analysis."
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
