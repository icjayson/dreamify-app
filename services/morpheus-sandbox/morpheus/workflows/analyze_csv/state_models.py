"""
State models for stateful agentic workflow.

This module defines all Pydantic models used to represent workflow state,
including user context, working memory, and execution history.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field


class UserState(BaseModel):
    """
    Read-only user context for the workflow.
    
    Contains information about the user, their assets, conversation history,
    and existing dashboards. This state is loaded at workflow start and should
    not be modified during execution.
    """
    user_id: str
    project_id: str
    conversation_id: str
    conversation_history: List[Dict[str, Any]] = Field(default_factory=list, description="Nodes from S3 conversation")
    user_assets: List[Dict[str, Any]] = Field(default_factory=list, description="Files/data available to user")
    dashboards: Dict[str, Any] = Field(default_factory=dict, description="Existing dashboards in conversation")
    
    class Config:
        arbitrary_types_allowed = True


class WorkingMemory(BaseModel):
    """
    Runtime scratchpad for intermediate workflow results.
    
    Tracks all artifacts generated during workflow execution including data analysis,
    tool outputs, errors, and generation results. This memory is accumulated
    throughout the workflow and used by the agent to make decisions.
    """
    # Data analysis artifacts
    dataframe_profile: Optional[Dict[str, Any]] = Field(default=None, description="DataFrame structure and statistics")
    column_analysis: Optional[Dict[str, Any]] = Field(default=None, description="Per-column analysis results")
    available_chart_types: Optional[str] = Field(default=None, description="Available chart types from knowledge base")
    
    # Intermediate results
    current_query: Optional[str] = Field(default=None, description="Current query being processed")
    python_execution_results: List[Dict[str, Any]] = Field(default_factory=list, description="Results from Python REPL executions")
    tool_outputs: Dict[str, Any] = Field(default_factory=dict, description="Outputs from all tool executions")
    
    # Generation artifacts
    dashboard_json: Optional[Dict[str, Any]] = Field(default=None, description="Generated dashboard configuration")
    dashboard_summary: Optional[str] = Field(default=None, description="Summary text explaining the generated dashboard")
    qa_response: Optional[str] = Field(default=None, description="Generated Q&A text response")
    
    # Error tracking
    errors: List[Dict[str, Any]] = Field(default_factory=list, description="Error history with context")
    retry_count: int = Field(default=0, description="Number of retries attempted")
    
    class Config:
        arbitrary_types_allowed = True


class WorkflowHistoryEntry(BaseModel):
    """
    Single entry in the workflow execution history.
    
    Records a state transition with timing, action details, and success status.
    Used for debugging and understanding agent decision-making process.
    """
    timestamp: datetime
    from_state: str
    action: str
    action_input: Dict[str, Any] = Field(default_factory=dict)
    action_output: Optional[Dict[str, Any]] = None
    to_state: str
    duration_ms: float
    success: bool
    error: Optional[str] = None
    
    class Config:
        arbitrary_types_allowed = True


class WorkflowHistory(BaseModel):
    """
    Complete audit trail of workflow execution.
    
    Maintains ordered list of all state transitions and actions taken
    during workflow execution. Critical for debugging and observability.
    """
    entries: List[WorkflowHistoryEntry] = Field(default_factory=list)
    
    class Config:
        arbitrary_types_allowed = True


class AgentState(BaseModel):
    """
    Complete workflow state container.
    
    Central state object that flows through all workflow nodes. Contains
    user context, working memory, execution history, and control metadata.
    """
    # Core state components
    user_state: UserState
    working_memory: WorkingMemory
    workflow_history: WorkflowHistory
    
    # Execution metadata
    current_node: str = Field(default="START", description="Current node in state graph")
    status: Literal["RUNNING", "FINISHED", "ERROR", "STOPPED"] = Field(default="RUNNING", description="Workflow execution status")
    iteration: int = Field(default=0, description="Current iteration count")
    max_iterations: int = Field(default=60, description="Maximum iterations before timeout")
    
    # Input/Output
    input_prompt: str = Field(description="User's request/question")
    file_paths: List[str] = Field(default_factory=list, description="Paths to CSV/data files being analyzed")
    output: Optional[Dict[str, Any]] = Field(default=None, description="Final workflow output")
    
    @property
    def file_path(self) -> Optional[str]:
        """Backward compatibility: return first file path."""
        return self.file_paths[0] if self.file_paths else None
    
    @property
    def has_multiple_files(self) -> bool:
        """Check if multiple files are available for analysis."""
        return len(self.file_paths) > 1
    
    # Config
    conversation_id: Optional[str] = None
    project_id: Optional[str] = None
    conversation_uri: Optional[str] = Field(default=None, description="S3 URI for conversation persistence")
    conversation_backup_uri: Optional[str] = Field(default=None, description="Backup S3 URI")
    
    class Config:
        arbitrary_types_allowed = True


class ActionRequest(BaseModel):
    """
    Action decision from reasoning node.
    
    Represents the agent's decision about what to do next, including
    tool selection, arguments, and reasoning for the decision.
    """
    action_type: Literal[
        "ROUTE",
        "ANALYZE_DATA",
        "EXECUTE_TOOL",
        "GENERATE_DASHBOARD",
        "GENERATE_QA_RESPONSE",
        "VALIDATE",
        "FINISH"
    ] = Field(description="Type of action to execute")
    tool_name: Optional[str] = Field(default=None, description="Name of tool to execute (if action_type is EXECUTE_TOOL)")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="Arguments for the action/tool")
    reasoning: str = Field(description="Agent's reasoning for this action")
    
    class Config:
        arbitrary_types_allowed = True


class ActionResult(BaseModel):
    """
    Result from action execution.
    
    Contains execution outcome, data, and optional error information.
    Used to communicate results back to the agent for next decision.
    """
    success: bool = Field(description="Whether action executed successfully")
    data: Optional[Dict[str, Any]] = Field(default=None, description="Action output data")
    error: Optional[str] = Field(default=None, description="Error message if failed")
    next_node: Optional[str] = Field(default=None, description="Suggested next node (optional)")
    
    class Config:
        arbitrary_types_allowed = True


class DashboardWithSummary(BaseModel):
    """
    Structured output for dashboard generation with summary.
    
    This model is used for structured LLM output to ensure we get both
    an explanatory summary and the dashboard JSON in a single response.
    """
    summary: str = Field(
        description="A 2-3 sentence natural language summary explaining what dashboard was created, "
                    "key insights found, and what the charts/metrics show. This will be displayed "
                    "to the user as a text message before the dashboard."
    )
    dashboard: Dict[str, Any] = Field(
        description="The complete dashboard JSON configuration including dashboard metadata, "
                    "metrics, charts, tables, and insights arrays."
    )
    
    class Config:
        arbitrary_types_allowed = True
