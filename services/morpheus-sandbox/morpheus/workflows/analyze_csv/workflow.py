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
        self.workflow_output = None

    def init_messages(self, file_path: str, user_prompt: str = None):
        """Initialize conversation with system prompt and user request"""
        if user_prompt is None:
            user_prompt = f"Please analyze the CSV file at '{file_path}' and recommend appropriate chart types for visualization."
        
        self.messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=f"""
Analyze this CSV file and recommend chart types: {file_path}

User request: {user_prompt}

Steps:
1. Use Python REPL to load and analyze the CSV file
2. Use get_available_chart_types to see what charts are available  
3. Based on your analysis, recommend specific chart types with reasoning
4. Calculate key metrics from the data (totals, averages, counts, etc.)
5. IMPORTANT: End your response with the structured JSON format as specified in the system prompt

Do NOT create any visualizations - only analyze and recommend.
""")
        ]
        return self.messages
    
    def execute(self, file_path: str, user_prompt: str = None):
        """Execute the CSV analysis workflow"""
        
        # Create workflow output instance
        self.workflow_output = WorkflowOutput.create_new(
            workflow_name="analyze_csv",
            input_data={
                "file_path": file_path,
                "user_prompt": user_prompt
            }
        )
        
        logger.info(f"Starting CSV analysis workflow for file: {file_path}")
        
        # Initialize messages
        self.init_messages(file_path, user_prompt)
        
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
                    # Extract chart recommendations from final response
                    self._extract_chart_recommendations(response.content)
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
        self.workflow_output.output_data = {
            "chart_recommendations": self.chart_recommendations,
            "metrics": self.metrics,
            "insights": ["Analysis completed successfully"]
        }
        
        logger.info("CSV analysis workflow completed successfully")
        logger.info(f"Final results: {len(self.chart_recommendations)} charts, {len(self.metrics)} metrics")
        
        # Return simple results
        return {
            "chart_recommendations": self.chart_recommendations,
            "metrics": self.metrics,
            "insights": ["Analysis completed successfully"],
            "workflow_output": self.workflow_output
        }
    
    def _extract_chart_recommendations(self, final_response: str):
        """Extract structured chart recommendations and metrics from the final LLM response"""
        
        logger.info("Extracting structured recommendations from final response")
        
        try:
            # Look for JSON structure in the response
            json_match = re.search(r'```json\s*(\{.*?\})\s*```', final_response, re.DOTALL)
            
            if json_match:
                json_str = json_match.group(1)
                structured_data = json.loads(json_str)
                
                # Extract charts
                if "charts" in structured_data:
                    self.chart_recommendations = []
                    for chart in structured_data["charts"]:
                        recommendation = {
                            'chart_type': chart.get('chart_type', ''),
                            'title': chart.get('title', ''),
                            'columns': chart.get('columns', []),
                            'x_axis': chart.get('x_axis'),
                            'y_axis': chart.get('y_axis'),
                            'color': chart.get('color'),
                            'size': chart.get('size'),
                            'metadata': {'title': chart.get('title', '')},
                            'confidence': 0.9,  # High confidence for structured output
                            'reasoning': chart.get('reasoning', 'LLM structured recommendation')
                        }
                        self.chart_recommendations.append(recommendation)
                    
                    logger.info(f"Extracted {len(self.chart_recommendations)} chart recommendations")
                
                # Extract metrics
                if "metrics" in structured_data:
                    self.metrics = structured_data["metrics"]
                    logger.info(f"Extracted {len(self.metrics)} metrics")
                else:
                    self.metrics = []
                    
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
        """Fallback extraction method if structured JSON parsing fails"""
        
        logger.info("Using fallback extraction method")
        
        # Simple pattern matching to extract recommendations
        chart_types = ["bar_chart", "line_chart", "scatter_plot", "pie_chart", 
                      "histogram", "box_plot", "heatmap", "area_chart"]
        
        found_charts = []
        for chart_type in chart_types:
            if chart_type in final_response.lower():
                found_charts.append({
                    'chart_type': chart_type,
                    'title': f'{chart_type.replace("_", " ").title()}',
                    'columns': [],
                    'x_axis': None,
                    'y_axis': None,
                    'color': None,
                    'size': None,
                    'metadata': {},
                    'confidence': 0.6,  # Lower confidence for fallback
                    'reasoning': f"Detected {chart_type} in response text"
                })
        
        self.chart_recommendations = found_charts
        self.metrics = []  # No metrics in fallback
