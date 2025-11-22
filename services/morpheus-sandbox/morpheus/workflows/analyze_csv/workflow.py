from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from morpheus.tools.python_repl.tool import PythonREPLTool, PersistentPythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.workflows.analyze_csv.prompts.analysis_prompts import SYSTEM_PROMPT
from morpheus.workflows.base import WorkflowOutput
from utils.config import load_config
from utils.logger import logger
import json
import re
from typing import Any, Dict, Optional

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
        self.chart_recommendations = []
        self.metrics = []
        self.frontend_contract = None
        self.workflow_output = None

    def init_messages(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
    ):
        """Initialize conversation history with prior nodes and latest request."""
        self.messages = [SystemMessage(content=SYSTEM_PROMPT)]

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
            or f"Please analyze the CSV file at '{file_path}' and recommend appropriate chart types for visualization."
        )

        instruction = f"""
Analyze this CSV file and recommend chart types: {file_path}

Latest user request: {effective_prompt}

Steps:
1. Use Python REPL to load and analyze the CSV file. Always use print for receiving Python REPL tool output.
2. Use get_available_chart_types to see what charts are available
3. Based on your analysis, recommend specific chart types with reasoning
4. Calculate key metrics from the data (totals, averages, counts, etc.)
5. IMPORTANT: End your response with the structured JSON format as specified in the system prompt

Do NOT create any visualizations - only analyze and recommend.
""".strip()

        self.messages.append(HumanMessage(content=instruction))
        return self.messages
    
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
        
        # Initialize messages
        self.init_messages(file_path, conversation, dashboards, user_prompt)
        
        # Add initial messages to workflow output
        for msg in self.messages:
            self.workflow_output.add_message(msg)
        
        max_iterations = 10
        
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
                    # Extract structured frontend contract from final response
                    self._extract_frontend_contract(response.content)
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
                            tool_result = self.python_tool.run(tool_args["query"])
                        elif tool_name.lower() == "get_available_chart_types":
                            tool_result = get_available_chart_types.invoke({})
                        else:
                            tool_result = f"Unknown tool: {tool_name}"
                        
                        logger.info(response)
                        # logger.info(response.additional_kwargs['tool_calls'][0]['function']['arguments']['query'])
                        logger.info(f"Tool result: {str(tool_result)}")
                        
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
        
        except Exception as e:
            error_msg = f"Workflow error: {str(e)}"
            logger.error(error_msg)
            self.workflow_output.set_completed("error", error_msg)
            return {"error": str(e)}
        
        # Set workflow as completed
        self.workflow_output.set_completed("success")
        # Prefer saving the full frontend contract if available
        if self.frontend_contract:
            self.workflow_output.output_data = self.frontend_contract
            logger.info("CSV analysis workflow completed successfully with frontend contract")
            charts_len = len(self.frontend_contract.get("charts", [])) if isinstance(self.frontend_contract, dict) else 0
            metrics_len = len(self.frontend_contract.get("metrics", [])) if isinstance(self.frontend_contract, dict) else 0
            summary = self._build_summary(charts_len, metrics_len)
            logger.info(f"Final results: {charts_len} charts, {metrics_len} metrics")
            return {
                "data": self.frontend_contract,
                "workflow_output": self.workflow_output,
                "summary": summary,
            }
        else:
            # Legacy fallback (should not happen if prompt is followed)
            self.workflow_output.output_data = {
                "chart_recommendations": self.chart_recommendations,
                "metrics": self.metrics,
                "insights": ["Analysis completed successfully"]
            }
            charts_len = len(self.chart_recommendations)
            metrics_len = len(self.metrics)
            summary = self._build_summary(charts_len, metrics_len)
            logger.info("CSV analysis workflow completed successfully (legacy fallback)")
            logger.info(f"Final results: {charts_len} charts, {metrics_len} metrics")
            return {
                "chart_recommendations": self.chart_recommendations,
                "metrics": self.metrics,
                "insights": ["Analysis completed successfully"],
                "workflow_output": self.workflow_output,
                "summary": summary,
            }
    
    def _extract_frontend_contract(self, final_response: str):
        """Extract the full frontend-contract JSON from the final LLM response"""
        
        logger.info("Extracting structured recommendations from final response")
        
        try:
            # Look for JSON structure in the response
            json_match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```', final_response, re.DOTALL)
            
            if json_match:
                json_str = json_match.group(1)
                structured_data = json.loads(json_str)
                
                # Store the entire structured object as the frontend contract
                self.frontend_contract = structured_data
                charts_count = len(structured_data.get("charts", [])) if isinstance(structured_data, dict) else 0
                metrics_count = len(structured_data.get("metrics", [])) if isinstance(structured_data, dict) else 0
                logger.info(f"Extracted frontend contract with {charts_count} charts and {metrics_count} metrics")
                    
            else:
                logger.warning("No structured JSON found in response, falling back to simple extraction")
                self._fallback_extraction(final_response)
                
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from response: {e}")
            self._fallback_extraction(final_response)
        except Exception as e:
            logger.error(f"Error extracting recommendations: {e}")
            self._fallback_extraction(final_response)
    
    def _fallback_extraction(self, final_response: str):
        """Fallback extraction method if structured JSON parsing fails. Sets minimal error contract."""
        logger.info("Using fallback extraction method")
        self.frontend_contract = {
            "status": "failed",
            "success": False,
            "insights": ["Failed to parse structured JSON from agent response."],
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
