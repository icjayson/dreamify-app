"""
Edge transition logic for state graph workflow.

This module defines how the workflow transitions between nodes based on
the current state. The decide_next_node function is the core routing logic.
"""

from typing import Optional
from morpheus.workflows.analyze_csv.state_models import AgentState
from utils.logger import logger


def get_last_action_from_history(state: AgentState) -> Optional[dict]:
    """
    Get the last action from workflow history.
    
    Args:
        state: Current agent state
        
    Returns:
        Last action dict or None if no history
    """
    if not state.workflow_history.entries:
        return None
    
    last_entry = state.workflow_history.entries[-1]
    return {
        "action": last_entry.action,
        "action_type": last_entry.action_input.get("action_type"),
        "success": last_entry.success,
    }


def get_last_execution_result(state: AgentState) -> dict:
    """
    Get the last execution result from working memory.
    
    Args:
        state: Current agent state
        
    Returns:
        Dict with success and error fields
    """
    # Check if there were recent Python execution results
    if state.working_memory.python_execution_results:
        last_result = state.working_memory.python_execution_results[-1]
        return {
            "success": last_result.get("success", True),
            "error": last_result.get("error"),
        }
    
    # Check for errors in working memory
    if state.working_memory.errors:
        return {
            "success": False,
            "error": state.working_memory.errors[-1].get("error"),
        }
    
    # Default: assume success
    return {"success": True, "error": None}


def decide_next_node(state: AgentState) -> str:
    """
    Central routing logic based on current node and state.
    
    This function determines which node to transition to next based on:
    - Current node
    - Workflow status
    - Iteration count
    - Execution results
    - Validation outcomes
    - Retry attempts
    
    Args:
        state: Current agent state
        
    Returns:
        Name of next node to transition to
    """
    # Check termination conditions
    if state.iteration >= state.max_iterations:
        logger.warning(f"Max iterations ({state.max_iterations}) exceeded, terminating workflow")
        return "ERROR"
    
    if state.status == "STOPPED":
        logger.info("Workflow stopped by user, transitioning to FINISH")
        return "FINISH"
    
    # Node-specific transitions
    current = state.current_node
    
    if current == "START":
        return "EXPLORE_FILES"
    
    elif current == "EXPLORE_FILES":
        return "ROUTING"
    
    elif current == "ROUTING":
        # After routing, choose reasoning strategy
        if state.use_internal_reasoning:
            return "REASONING_INTERNAL"
        return "REASONING"
    
    elif current == "REASONING_INTERNAL":
        # Self-contained node (replaces REASONING + EXECUTION)
        # Goes to shared SYNTHESIS node to build state.output
        if state.working_memory.errors and not state.working_memory.dashboard_json and not state.working_memory.qa_response:
            return "ERROR"
        return "SYNTHESIS"
    
    elif current == "REASONING":
        # Check if agent decided to finish
        pending_action = state.working_memory.tool_outputs.get("pending_action")
        if pending_action:
            action_type = pending_action.get("action_type")
            if action_type == "FINISH":
                logger.info("Agent decided to finish, transitioning to SYNTHESIS")
                return "SYNTHESIS"
        
        # Otherwise proceed to execution
        return "EXECUTION"
    
    elif current == "EXECUTION":
        # Check execution result
        last_result = get_last_execution_result(state)
        
        if last_result.get("error") and state.working_memory.retry_count < 3:
            # Self-correction loop: go back to reasoning with error context
            logger.info(
                f"Execution error (retry {state.working_memory.retry_count}/3), "
                f"returning to REASONING for self-correction"
            )
            return "REASONING"
        
        elif last_result.get("success"):
            # Continue agent loop
            return "REASONING"
        
        else:
            # Too many retries
            logger.error(f"Execution failed after {state.working_memory.retry_count} retries")
            return "ERROR"
    
    elif current == "SYNTHESIS":
        # After synthesis, always validate
        return "VALIDATION"
    
    elif current == "VALIDATION":
        # Check validation result
        validation_result = state.working_memory.tool_outputs.get("validation", {})
        
        if validation_result.get("valid"):
            # Validation passed
            logger.info("Validation passed, transitioning to FINISH")
            return "FINISH"
        
        elif state.working_memory.retry_count < 2:
            # Try again with error context
            retry_target = "REASONING_INTERNAL" if state.use_internal_reasoning else "REASONING"
            logger.info(
                f"Validation failed (retry {state.working_memory.retry_count}/2), "
                f"returning to {retry_target}"
            )
            return retry_target
        
        else:
            # Validation failed too many times
            logger.error(f"Validation failed after {state.working_memory.retry_count} retries")
            return "ERROR"
    
    elif current == "FINISH":
        # Terminal state, should not transition
        return "FINISH"
    
    elif current == "ERROR":
        # Terminal state, should not transition
        return "ERROR"
    
    else:
        # Unknown node, default to finish
        logger.warning(f"Unknown node '{current}', defaulting to FINISH")
        return "FINISH"
