"""
State graph workflow orchestrator.

This module implements the StatefulAnalyzeCSVWorkflow class which orchestrates
the execution of the state machine workflow with explicit node transitions.
"""

import os
import time
import uuid
import sys
import importlib.util
from datetime import datetime
from typing import Dict, Any, Optional

from morpheus.workflows.analyze_csv.state_models import (
    AgentState,
    UserState,
    WorkingMemory,
    WorkflowHistory,
    WorkflowHistoryEntry,
)
from morpheus.workflows.analyze_csv import nodes
from morpheus.workflows.analyze_csv.edges import decide_next_node
from morpheus.workflows.base import WorkflowOutput
from morpheus.tools.python_repl.tool import PythonREPLTool
from morpheus.tools.charts_knowledge.tool import get_available_chart_types
from morpheus.models.base import get_model_for_agent
from utils.config import load_config
from utils.logger import logger


class StatefulAnalyzeCSVWorkflow:
    """
    Stateful agentic workflow for CSV analysis.
    
    Implements a state machine architecture where the agent explicitly
    transitions between nodes based on state and execution results.
    """
    
    def __init__(self):
        """Initialize workflow with model, tools, and node registry."""
        self.config = load_config()
        self.model = get_model_for_agent()
        self.python_tool = PythonREPLTool()
        self.tools = [self.python_tool, get_available_chart_types]
        self.model_with_tools = self.model.bind_tools(self.tools)
        
        # Node registry: maps node names to node functions
        self.nodes = {
            "START": nodes.node_start,
            "ROUTING": nodes.node_routing,
            "REASONING": nodes.node_reasoning,
            "EXECUTION": nodes.node_execution,
            "SYNTHESIS": nodes.node_synthesis,
            "VALIDATION": nodes.node_validation,
            "FINISH": nodes.node_finish,
            "ERROR": nodes.node_error,
        }
        
        # Live sync tracker for intermediate state persistence
        self._last_synced_index = 0
        
        logger.info("StatefulAnalyzeCSVWorkflow initialized")
    
    def _get_server_functions(self):
        """
        Dynamically import server.py functions for conversation persistence.
        
        Returns:
            Tuple of (persist_fn, post_status_fn, load_fn) or (None, None, None) if import fails
        """
        try:
            server_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                'server.py'
            )
            if os.path.exists(server_path):
                spec = importlib.util.spec_from_file_location("server", server_path)
                server_module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(server_module)
                
                persist_fn = getattr(server_module, '_persist_conversation', None)
                post_status_fn = getattr(server_module, '_post_node_status_sync', None)
                load_fn = getattr(server_module, '_load_json_from_s3_uri', None)
                
                return persist_fn, post_status_fn, load_fn
        except Exception as e:
            logger.debug(f"Could not import server functions: {str(e)}")
        
        return None, None, None
    
    def execute(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
        conversation_uri: Optional[str] = None,
        conversation_backup_uri: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point for workflow execution.
        
        Builds initial state from inputs, runs the workflow loop, and
        converts the final state to output format.
        
        Args:
            file_path: Path to CSV file to analyze
            conversation: Conversation dict from S3
            dashboards: Dict of dashboard_id -> dashboard_data
            user_prompt: Optional user prompt (extracted from conversation if not provided)
            conversation_uri: Optional S3 URI for conversation persistence (enables live sync)
            conversation_backup_uri: Optional backup S3 URI
            
        Returns:
            Dict with workflow output in legacy format for backward compatibility
        """
        logger.info(
            f"Starting workflow execution for conversation {conversation.get('conversation_id')}"
        )
        
        # Build initial state
        state = self._build_initial_state(
            file_path=file_path,
            conversation=conversation,
            dashboards=dashboards,
            user_prompt=user_prompt,
            conversation_uri=conversation_uri,
            conversation_backup_uri=conversation_backup_uri,
        )
        
        # Run workflow loop
        state = self._run_workflow_loop(state)
        
        # Convert state to output format
        output = self._state_to_output(state)
        
        logger.info(f"Workflow execution complete: status={state.status}")
        
        return output
    
    def _create_legacy_node(
        self, state: AgentState, history_entry: WorkflowHistoryEntry
    ) -> Optional[Dict[str, Any]]:
        """
        Convert WorkflowHistoryEntry to legacy conversation node format.
        
        Maps workflow states to conversation nodes with appropriate roles
        and content for frontend display and admin visibility.
        
        Args:
            state: Current agent state
            history_entry: Workflow history entry to convert
            
        Returns:
            Legacy node dict or None if no node should be created
        """
        try:
            from_state = history_entry.from_state
            
            # START: User prompt already saved by API
            if from_state == "START":
                return None
            
            # ROUTING: System message for admin visibility
            elif from_state == "ROUTING":
                route_decision = (
                    state.working_memory.tool_outputs.get('route_decision') or
                    state.working_memory.route_decision or
                    "Unknown"
                )
                return {
                    "node_id": f"node_{uuid.uuid4().hex[:8]}",
                    "role": "system",
                    "status": "completed",
                    "created_at": history_entry.timestamp.isoformat(),
                    "contents": [{
                        "type": "text",
                        "data": {"text": f"📍 Routing Decision: {route_decision}"}
                    }],
                    "metadata": {"type": "routing_decision", "node_name": "ROUTING"}
                }
            
            # REASONING: Thought process for admin visibility
            elif from_state == "REASONING":
                pending_action = state.working_memory.tool_outputs.get('pending_action', {})
                reasoning = pending_action.get('reasoning', 'Processing...')
                tool_name = pending_action.get('tool_name')
                arguments = pending_action.get('arguments', {})
                
                # Build content string
                if tool_name:
                    content = f"💭 Planning: Execute {tool_name}\nReasoning: {reasoning}"
                else:
                    content = f"💭 Reasoning: {reasoning}"
                
                return {
                    "node_id": f"node_{uuid.uuid4().hex[:8]}",
                    "role": "system",
                    "status": "completed",
                    "created_at": history_entry.timestamp.isoformat(),
                    "contents": [{
                        "type": "text",
                        "data": {"text": content}
                    }],
                    "metadata": {"type": "thought_process", "node_name": "REASONING"}
                }
            
            # EXECUTION: Single tool node with both input and output
            elif from_state == "EXECUTION":
                # Get last tool execution result
                execution_results = state.working_memory.python_execution_results
                if not execution_results:
                    return None
                
                last_result = execution_results[-1]
                tool_name = last_result.get('tool_name', 'unknown')
                tool_call_id = last_result.get('tool_call_id', 'unknown')
                tool_args = last_result.get('tool_args', {})
                success = last_result.get('success', False)
                output = last_result.get('output', '')
                error = last_result.get('error')
                
                # Format tool input
                if tool_name == "Python_REPL" or tool_name == "python_repl":
                    tool_input = tool_args.get('query', str(tool_args))
                else:
                    tool_input = str(tool_args)
                
                # Build content with both input and output
                content = f"🔧 Tool: {tool_name}\n\n📥 Input:\n{tool_input}\n\n📤 Output:\n{output}"
                
                return {
                    "node_id": f"node_{uuid.uuid4().hex[:8]}",
                    "role": "tool",
                    "status": "completed" if success else "error",
                    "created_at": history_entry.timestamp.isoformat(),
                    "contents": [{
                        "type": "text",
                        "data": {
                            "text": content,
                            "tool_name": tool_name,
                            "tool_input": tool_input,
                            "tool_output": output
                        }
                    }],
                    "metadata": {
                        "tool_call_id": tool_call_id,
                        "tool_name": tool_name,
                        "tool_args": tool_args,
                        "success": success,
                        "error": error,
                        "node_name": "EXECUTION"
                    }
                }
            
            # SYNTHESIS: Final assistant response
            elif from_state == "SYNTHESIS":
                if state.output:
                    output_type = state.output.get('type')
                    
                    if output_type == 'dashboard_config':
                        # Extract dashboard summary
                        data = state.output.get('data', {})
                        if isinstance(data, dict):
                            chart_count = len(data.get('charts', []))
                            metric_count = len(data.get('metrics', []))
                            content = f"✨ Generated dashboard with {chart_count} charts and {metric_count} metrics"
                        else:
                            content = "✨ Dashboard generation complete"
                    
                    elif output_type == 'message':
                        # Q&A response
                        content = state.output.get('content', 'Analysis complete')
                    
                    else:
                        content = "✨ Analysis complete"
                else:
                    content = "✨ Analysis complete"
                
                return {
                    "node_id": f"node_{uuid.uuid4().hex[:8]}",
                    "role": "assistant",
                    "status": "completed",
                    "created_at": history_entry.timestamp.isoformat(),
                    "contents": [{
                        "type": "text",
                        "data": {"text": content}
                    }],
                    "metadata": {"type": "final_synthesis", "node_name": "SYNTHESIS"}
                }
            
            # VALIDATION: System message with validation status
            elif from_state == "VALIDATION":
                validation_result = state.working_memory.validation_result or {}
                is_valid = validation_result.get('valid', False)
                error_message = validation_result.get('error', '')
                
                if is_valid:
                    content = "✅ Validation passed"
                else:
                    content = f"❌ Validation failed: {error_message}"
                
                return {
                    "node_id": f"node_{uuid.uuid4().hex[:8]}",
                    "role": "system",
                    "status": "completed",
                    "created_at": history_entry.timestamp.isoformat(),
                    "contents": [{
                        "type": "text",
                        "data": {"text": content}
                    }],
                    "metadata": {
                        "type": "validation",
                        "valid": is_valid,
                        "node_name": "VALIDATION"
                    }
                }
            
            # ERROR: System error message
            elif from_state == "ERROR":
                errors = state.working_memory.errors
                if errors:
                    last_error = errors[-1]
                    error_message = last_error.get('error', 'Unknown error')
                else:
                    error_message = 'Unknown error'
                
                return {
                    "node_id": f"node_{uuid.uuid4().hex[:8]}",
                    "role": "system",
                    "status": "error",
                    "created_at": history_entry.timestamp.isoformat(),
                    "contents": [{
                        "type": "text",
                        "data": {"text": f"❌ Error: {error_message}"}
                    }],
                    "metadata": {
                        "type": "error",
                        "node_name": "ERROR",
                        "error": error_message
                    }
                }
            
            # Unknown state: return None
            else:
                logger.debug(f"Skipping node creation for unknown state: {from_state}")
                return None
        
        except Exception as e:
            # Fail gracefully - log warning but don't crash
            logger.warning(f"Failed to create legacy node for {history_entry.from_state}: {str(e)}")
            return None
    
    def _sync_intermediate_state(
        self, state: AgentState, persist_fn, load_fn, post_status_fn
    ) -> None:
        """
        Sync intermediate state to S3 for live frontend updates.
        
        Fault-tolerant method that converts new workflow history entries to legacy nodes
        and persists them to S3 for real-time frontend visibility. All operations are
        wrapped in try-except blocks to ensure workflow never crashes due to sync failures.
        
        Args:
            state: Current agent state
            persist_fn: Function to persist conversation to S3
            load_fn: Function to load conversation from S3
            post_status_fn: Function to post workflow status
        """
        try:
            # Check prerequisites
            if not state.conversation_uri:
                logger.debug("No conversation_uri available, skipping sync")
                return
            
            if not persist_fn or not load_fn:
                logger.debug("Persistence functions not available, skipping sync")
                return
            
            # Get new entries since last sync
            new_entries = state.workflow_history.entries[self._last_synced_index:]
            if not new_entries:
                return
            
            # Convert entries to legacy nodes
            new_nodes = []
            for entry in new_entries:
                try:
                    legacy_node = self._create_legacy_node(state, entry)
                    if legacy_node:
                        new_nodes.append(legacy_node)
                except Exception as e:
                    logger.warning(f"Failed to create legacy node for {entry.from_state}: {str(e)}")
                    continue
            
            if not new_nodes:
                # Update tracker even if no nodes created (to avoid re-processing)
                self._last_synced_index = len(state.workflow_history.entries)
                return
            
            # Load current conversation from S3
            try:
                conversation = load_fn(state.conversation_uri)
            except Exception as e:
                logger.warning(f"Failed to load conversation from S3: {str(e)}")
                return
            
            # Append new nodes
            conversation.setdefault("nodes", []).extend(new_nodes)
            conversation["updated_at"] = datetime.now().isoformat()
            
            # Save back to S3
            try:
                persist_fn(
                    state.conversation_uri,
                    state.conversation_backup_uri,
                    conversation
                )
                logger.info(f"✅ Synced {len(new_nodes)} intermediate node(s) to S3 (iteration {state.iteration})")
            except Exception as e:
                logger.warning(f"Failed to persist conversation to S3: {str(e)}")
                return
            
            # Update sync tracker
            self._last_synced_index = len(state.workflow_history.entries)
            
        except Exception as e:
            # Catch-all for any unexpected errors - never crash the workflow
            logger.warning(f"Unexpected error in _sync_intermediate_state (non-fatal): {str(e)}")
    
    def _run_workflow_loop(self, state: AgentState) -> AgentState:
        """
        Core workflow loop with explicit state transitions.
        
        Executes nodes in sequence based on state graph edges until
        a terminal state (FINISH or ERROR) is reached. Includes live sync
        of intermediate state to S3 for real-time frontend updates.
        
        Args:
            state: Initial agent state
            
        Returns:
            Final agent state after workflow completion
        """
        logger.info("Starting workflow loop")
        
        # Get persistence functions for live sync
        persist_fn, post_status_fn, load_fn = self._get_server_functions()
        
        # Reset sync tracker
        self._last_synced_index = 0
        
        # Track if we should sync (only if all prerequisites available)
        should_sync = (
            persist_fn is not None 
            and load_fn is not None 
            and state.conversation_uri is not None
        )
        
        if should_sync:
            logger.info("✅ Live sync enabled for this workflow execution")
        else:
            logger.debug("Live sync disabled (missing prerequisites)")
        
        while state.status == "RUNNING":
            # Log current state
            logger.info(
                f"[Iteration {state.iteration}] Current Node: {state.current_node}, "
                f"Status: {state.status}"
            )
            
            # Check for external stop signal
            if self._check_workflow_stopped(state):
                logger.info("Workflow stopped by external signal")
                state.status = "STOPPED"
                break
            
            # Execute current node
            try:
                node_func = self.nodes.get(state.current_node)
                
                if not node_func:
                    logger.error(f"Unknown node: {state.current_node}")
                    state.status = "ERROR"
                    state.working_memory.errors.append({
                        "node": state.current_node,
                        "error": f"Unknown node: {state.current_node}",
                        "timestamp": datetime.now().isoformat(),
                    })
                    break
                
                start_time = time.time()
                
                # Execute node with dependencies
                state = node_func(
                    state,
                    model=self.model,
                    model_with_tools=self.model_with_tools,
                    python_tool=self.python_tool,
                )
                
                duration_ms = (time.time() - start_time) * 1000
                
                # Log state transition
                self._log_transition(state, duration_ms, success=True)
                
                # Sync intermediate state to S3 for live frontend updates (fault-tolerant)
                if should_sync:
                    try:
                        self._sync_intermediate_state(state, persist_fn, load_fn, post_status_fn)
                    except Exception as e:
                        # Never let sync failures crash the workflow
                        logger.warning(f"Failed to sync intermediate state (non-fatal): {str(e)}")
                
                # Post workflow status for frontend polling (fault-tolerant)
                if post_status_fn and state.conversation_id:
                    try:
                        metadata = {
                            "step": state.current_node.lower(),
                            "iteration": state.iteration,
                            "node": state.current_node
                        }
                        post_status_fn(state.conversation_id, "processing", metadata)
                    except Exception as e:
                        # Never let status posting crash the workflow
                        logger.warning(f"Failed to post status update (non-fatal): {str(e)}")
                
            except Exception as e:
                logger.error(f"Error in node {state.current_node}: {str(e)}", exc_info=True)
                state.status = "ERROR"
                state.working_memory.errors.append({
                    "node": state.current_node,
                    "error": str(e),
                    "timestamp": datetime.now().isoformat(),
                })
                
                # Transition to ERROR node
                state.current_node = "ERROR"
                continue
            
            # Decide next node
            previous_node = state.current_node
            next_node = decide_next_node(state)
            
            logger.info(f"Transition: {previous_node} -> {next_node}")
            
            state.current_node = next_node
            state.iteration += 1
            
            # Check for terminal states
            if next_node in ["FINISH", "ERROR"]:
                # Execute terminal node
                try:
                    terminal_func = self.nodes[next_node]
                    state = terminal_func(state)
                except Exception as e:
                    logger.error(f"Error in terminal node {next_node}: {str(e)}")
                    state.status = "ERROR"
                
                break
        
        logger.info(f"Workflow loop complete: final status={state.status}")
        
        return state
    
    def _build_initial_state(
        self,
        file_path: str,
        conversation: Dict[str, Any],
        dashboards: Dict[str, Any],
        user_prompt: Optional[str] = None,
        conversation_uri: Optional[str] = None,
        conversation_backup_uri: Optional[str] = None,
    ) -> AgentState:
        """
        Build initial AgentState from inputs.
        
        Extracts user context, initializes working memory, and creates
        the initial state object.
        
        Args:
            file_path: Path to CSV file
            conversation: Conversation dict from S3
            dashboards: Existing dashboards dict
            user_prompt: User's request/question
            conversation_uri: Optional S3 URI for conversation persistence
            conversation_backup_uri: Optional backup S3 URI
            
        Returns:
            Initialized AgentState
        """
        logger.info("Building initial state")
        
        # Extract user context
        user_state = UserState(
            user_id=conversation.get("user_id", ""),
            project_id=conversation.get("project_id", ""),
            conversation_id=conversation.get("conversation_id", ""),
            conversation_history=conversation.get("nodes", []),
            user_assets=self._extract_assets_from_conversation(conversation),
            dashboards=dashboards,
        )
        
        # Initialize working memory
        working_memory = WorkingMemory()
        
        # Initialize workflow history
        workflow_history = WorkflowHistory()
        
        # Get effective prompt
        effective_prompt = (
            user_prompt
            or conversation.get("metadata", {}).get("prompt")
            or "Please analyze the data."
        )
        
        # Create agent state
        state = AgentState(
            user_state=user_state,
            working_memory=working_memory,
            workflow_history=workflow_history,
            input_prompt=effective_prompt,
            file_path=file_path,
            conversation_id=conversation.get("conversation_id"),
            project_id=conversation.get("project_id"),
            conversation_uri=conversation_uri,
            conversation_backup_uri=conversation_backup_uri,
        )
        
        logger.info(
            f"Initial state created: {len(user_state.user_assets)} assets, "
            f"{len(user_state.conversation_history)} history nodes"
        )
        
        return state
    
    def _state_to_output(self, state: AgentState) -> Dict[str, Any]:
        """
        Convert AgentState to legacy output format.
        
        Maintains backward compatibility with existing server.py integration
        by converting state to the expected output format with WorkflowOutput.
        
        Args:
            state: Final agent state
            
        Returns:
            Dict with workflow output in legacy format
        """
        logger.info("Converting state to output format")
        
        # Build WorkflowOutput for compatibility
        workflow_output = WorkflowOutput.create_new(
            workflow_name="analyze_csv",
            input_data={
                "file_path": state.file_path,
                "conversation_id": state.conversation_id,
                "user_prompt": state.input_prompt,
            },
        )
        
        # Add workflow history as metadata
        workflow_output.metadata["workflow_history"] = [
            {
                "timestamp": entry.timestamp.isoformat(),
                "from_state": entry.from_state,
                "action": entry.action,
                "to_state": entry.to_state,
                "duration_ms": entry.duration_ms,
                "success": entry.success,
            }
            for entry in state.workflow_history.entries
        ]
        
        # Add working memory summary to metadata
        workflow_output.metadata["final_iteration"] = state.iteration
        workflow_output.metadata["retry_count"] = state.working_memory.retry_count
        workflow_output.metadata["error_count"] = len(state.working_memory.errors)
        
        # Set completion status
        if state.status == "FINISHED":
            workflow_output.set_completed(status="success")
        elif state.status == "ERROR":
            error_msg = (
                state.working_memory.errors[-1].get("error")
                if state.working_memory.errors
                else "Unknown error"
            )
            workflow_output.set_completed(status="error", error_message=error_msg)
        elif state.status == "STOPPED":
            workflow_output.set_completed(status="stopped", error_message="Workflow stopped by user")
        else:
            workflow_output.set_completed(status="partial")
        
        # Build result dict
        result = {
            "workflow_output": workflow_output,
        }
        
        # Add output if available
        if state.output:
            result.update(state.output)
            
            # Set output_data in WorkflowOutput
            if state.output.get("type") == "dashboard_config":
                workflow_output.output_data = state.output.get("data", {})
            elif state.output.get("type") == "message":
                workflow_output.output_data = {"content": state.output.get("content")}
        
        # Add error if failed
        if state.status == "ERROR":
            result["error"] = (
                state.working_memory.errors[-1].get("error")
                if state.working_memory.errors
                else "Unknown error"
            )
        
        # Add summary for dashboard outputs
        if state.output and state.output.get("type") == "dashboard_config":
            data = state.output.get("data", {})
            if isinstance(data, dict):
                charts_count = len(data.get("charts", []))
                metrics_count = len(data.get("metrics", []))
                result["summary"] = (
                    f"Generated dashboard with {charts_count} chart(s) "
                    f"and {metrics_count} metric(s)."
                )
        
        return result
    
    def _extract_assets_from_conversation(self, conversation: Dict[str, Any]) -> list:
        """
        Extract asset information from conversation nodes.
        
        Args:
            conversation: Conversation dict
            
        Returns:
            List of asset dicts with metadata
        """
        assets = []
        nodes = conversation.get("nodes", [])
        
        for node in nodes:
            node_created_at = node.get("created_at")
            contents = node.get("contents", [])
            
            for content in contents:
                content_type = content.get("type")
                if content_type in ["asset", "attachment"]:
                    asset_data = content.get("data", {})
                    # Ensure required fields
                    if (
                        asset_data.get("asset_id")
                        and asset_data.get("s3_bucket")
                        and asset_data.get("s3_key")
                    ):
                        assets.append({
                            "asset_id": asset_data.get("asset_id"),
                            "file_id": asset_data.get("file_id"),
                            "s3_bucket": asset_data.get("s3_bucket"),
                            "s3_key": asset_data.get("s3_key"),
                            "extension": asset_data.get("extension", "csv"),
                            "filename": asset_data.get("filename", ""),
                            "node_created_at": node_created_at,
                        })
        
        # Sort assets by created_at (newest first)
        assets.sort(key=lambda x: x.get("node_created_at", ""), reverse=True)
        
        return assets
    
    def _check_workflow_stopped(self, state: AgentState) -> bool:
        """
        Check if workflow should be stopped externally.
        
        Checks backend API for stop signals from user.
        
        Args:
            state: Current agent state
            
        Returns:
            True if workflow should stop, False otherwise
        """
        if not state.conversation_id or not state.project_id:
            return False
        
        try:
            # Import here to avoid circular dependency
            import sys
            import importlib.util
            
            # Try to load server module dynamically
            server_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
                'server.py'
            )
            
            if os.path.exists(server_path):
                spec = importlib.util.spec_from_file_location("server", server_path)
                server_module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(server_module)
                status = server_module._check_workflow_status(
                    state.conversation_id,
                    state.project_id
                )
                return status == "stopped"
        
        except Exception as e:
            logger.debug(f"Could not check workflow status: {str(e)}")
        
        return False
    
    def _log_transition(self, state: AgentState, duration_ms: float, success: bool):
        """
        Log state transition to workflow history.
        
        Args:
            state: Current agent state
            duration_ms: Duration of node execution in milliseconds
            success: Whether node executed successfully
        """
        # Get last action from working memory
        pending_action = state.working_memory.tool_outputs.get("pending_action")
        action_type = pending_action.get("action_type") if pending_action else "unknown"
        
        # Create history entry
        entry = WorkflowHistoryEntry(
            timestamp=datetime.now(),
            from_state=state.current_node,
            action=action_type,
            action_input={},
            action_output={},
            to_state=state.current_node,  # Will be updated on next transition
            duration_ms=duration_ms,
            success=success,
            error=None,
        )
        
        state.workflow_history.entries.append(entry)
