from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from morpheus.tools.python_repl.tool import python_tool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.workflows.analyze_csv.prompts.analysis_prompts import SYSTEM_PROMPT
from utils.config import load_config
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
        self.tools = [python_tool, get_available_chart_types]
        self.model_with_tools = self.model.bind_tools(self.tools)
        self.messages = []
        self.chart_recommendations = []

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

Do NOT create any visualizations - only analyze and recommend.
""")
        ]
        return self.messages
    
    def execute(self, file_path: str, user_prompt: str = None):
        """Execute the CSV analysis workflow"""
        
        # Initialize messages
        self.init_messages(file_path, user_prompt)
        
        max_iterations = 10
        
        try:
            for iteration in range(max_iterations):
                print(f"Workflow iteration {iteration + 1}")
                
                # Get model response
                response = self.model_with_tools.invoke(self.messages)
                self.messages.append(response)
                
                # Check if the response contains tool calls
                if not response.tool_calls:
                    print("No more tool calls - analysis complete")
                    # Extract chart recommendations from final response
                    self._extract_chart_recommendations(response.content)
                    break

                # Process tool calls
                print(f"Processing {len(response.tool_calls)} tool calls...")
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    
                    print(f"Executing tool: {tool_name}")
                    
                    try:
                        # Execute the appropriate tool
                        if tool_name == "python_repl":
                            tool_result = python_tool.run(tool_args.get("command", ""))
                        elif tool_name == "get_available_chart_types":
                            tool_result = get_available_chart_types.invoke({})
                        else:
                            tool_result = f"Unknown tool: {tool_name}"
                        
                        # Add tool result to messages
                        self.messages.append(ToolMessage(
                            content=str(tool_result),
                            tool_call_id=tool_call["id"]
                        ))
                        
                    except Exception as e:
                        error_msg = f"Error executing {tool_name}: {str(e)}"
                        print(error_msg)
                        self.messages.append(ToolMessage(
                            content=error_msg,
                            tool_call_id=tool_call["id"]
                        ))
        
        except Exception as e:
            print(f"Workflow error: {str(e)}")
            return {"error": str(e)}
        
        # Return simple results
        return {
            "chart_recommendations": self.chart_recommendations,
            "insights": ["Analysis completed successfully"]
        }
    
    def _extract_chart_recommendations(self, final_response: str):
        """Extract chart recommendations from the final LLM response"""
        
        # Simple pattern matching to extract recommendations
        # Look for patterns like "bar_chart", "line_chart", etc.
        chart_types = ["bar_chart", "line_chart", "scatter_plot", "pie_chart", 
                      "histogram", "box_plot", "heatmap", "area_chart"]
        
        found_charts = []
        for chart_type in chart_types:
            if chart_type in final_response.lower():
                found_charts.append({
                    'chart_type': chart_type,
                    'columns': [],
                    'x_axis': None,
                    'y_axis': None,
                    'color': None,
                    'size': None,
                    'metadata': {},
                    'confidence': 0.8,
                    'reasoning': f"Recommended based on data analysis"
                })
        
        self.chart_recommendations = found_charts
