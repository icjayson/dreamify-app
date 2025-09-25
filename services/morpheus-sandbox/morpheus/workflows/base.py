"""
General workflow output class that all workflows should follow
"""

from datetime import datetime
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from langchain_core.messages import BaseMessage
import json


class WorkflowMessage(BaseModel):
    """Simplified message structure for serialization"""
    type: str  # "human", "ai", "system", "tool"
    content: str
    timestamp: datetime
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True


class WorkflowOutput(BaseModel):
    """
    Standard output format for all workflows in the Morpheus system.
    Contains complete workflow execution details including all messages.
    """
    
    # Basic workflow info
    workflow_name: str
    workflow_version: str = "1.0"
    execution_id: str
    
    # Timing
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    
    # Input/Output
    input_data: Dict[str, Any]
    output_data: Dict[str, Any]
    
    # Execution details
    status: str  # "success", "error", "partial"
    error_message: Optional[str] = None
    
    # Complete conversation history
    messages: List[WorkflowMessage] = []
    
    # Metadata
    metadata: Dict[str, Any] = {}
    
    class Config:
        arbitrary_types_allowed = True
    
    def add_message(self, message: BaseMessage, tool_calls: Optional[List[Dict[str, Any]]] = None, tool_call_id: Optional[str] = None):
        """Add a message to the workflow history"""
        
        # Convert message type
        msg_type_map = {
            "HumanMessage": "human",
            "AIMessage": "ai", 
            "SystemMessage": "system",
            "ToolMessage": "tool"
        }
        
        msg_type = msg_type_map.get(message.__class__.__name__, "unknown")
        
        workflow_msg = WorkflowMessage(
            type=msg_type,
            content=str(message.content),
            timestamp=datetime.now(),
            tool_calls=tool_calls,
            tool_call_id=tool_call_id
        )
        
        self.messages.append(workflow_msg)
    
    def set_completed(self, status: str = "success", error_message: Optional[str] = None):
        """Mark the workflow as completed"""
        self.end_time = datetime.now()
        self.status = status
        self.error_message = error_message
        
        if self.start_time and self.end_time:
            self.duration_seconds = (self.end_time - self.start_time).total_seconds()
    
    def save_to_file(self, file_path: str):
        """Save the workflow output to a JSON file"""
        
        # Convert to dict for JSON serialization
        data = self.dict()
        
        # Convert datetime objects to ISO strings
        def convert_datetime(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            elif isinstance(obj, dict):
                return {k: convert_datetime(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_datetime(item) for item in obj]
            return obj
        
        data = convert_datetime(data)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    @classmethod
    def create_new(cls, workflow_name: str, input_data: Dict[str, Any], execution_id: Optional[str] = None) -> "WorkflowOutput":
        """Create a new workflow output instance"""
        
        if execution_id is None:
            execution_id = f"{workflow_name}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        
        return cls(
            workflow_name=workflow_name,
            execution_id=execution_id,
            start_time=datetime.now(),
            input_data=input_data,
            output_data={},
            status="running"
        )