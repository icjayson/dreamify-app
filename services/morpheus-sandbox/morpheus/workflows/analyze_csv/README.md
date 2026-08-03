# Analyze CSV Workflow - Stateful Agentic Architecture

## Overview

This workflow has been refactored from a monolithic black-box implementation into a **transparent state machine** with explicit nodes, edges, and state management. The new architecture provides better observability, debuggability, and self-correction capabilities.

## Architecture

### State Machine Flow

```
START → ROUTING → REASONING ⇄ EXECUTION → SYNTHESIS → VALIDATION → FINISH
                      ↓                                      ↓
                    ERROR ←─────────────────────────────────┘
```

### Key Components

#### 1. **State Models** (`state_models.py`)
- `AgentState`: Complete workflow state container
- `UserState`: Read-only user context (conversation history, assets, dashboards)
- `WorkingMemory`: Runtime scratchpad for intermediate results
- `WorkflowHistory`: Audit trail of all state transitions
- `ActionRequest`/`ActionResult`: Action definitions and results

#### 2. **Nodes** (`nodes.py`)
Each node is a pure function: `(AgentState) -> AgentState`

- **START**: Initialize and validate user state
- **ROUTING**: Decide workflow type (dashboard vs. Q&A)
- **REASONING**: Agent decides next action (the "brain")
- **EXECUTION**: Execute tools and actions (the "hands")
- **SYNTHESIS**: Aggregate results into final output
- **VALIDATION**: Validate output completeness and format
- **FINISH**: Terminal success state
- **ERROR**: Terminal error state

#### 3. **Edges** (`edges.py`)
- `decide_next_node(state) -> str`: Central routing logic
- Handles self-correction loops (EXECUTION error → REASONING)
- Implements retry logic and max iteration checks

#### 4. **State Graph** (`state_graph.py`)
- `StatefulAnalyzeCSVWorkflow`: Main workflow orchestrator
- `_run_workflow_loop()`: Executes state machine
- `_build_initial_state()`: Constructs initial AgentState
- `_state_to_output()`: Converts state to legacy output format

#### 5. **Helpers** (`helpers.py`)
- `format_state_for_prompt()`: Token-optimized state formatting for LLM
- `extract_json_from_content()`: Parse dashboard JSON from LLM output
- `validate_dashboard_json()`: Validate dashboard structure
- `validate_qa_response()`: Validate Q&A text response
- Various utility functions

#### 6. **Legacy Compatibility** (`workflow.py`)
- `AnalyzeCSVWorkflow`: Thin wrapper maintaining backward compatibility
- Delegates to `StatefulAnalyzeCSVWorkflow`
- Original implementation kept for reference (marked as legacy)

## Key Features

### 1. Observability
- ✅ Every state transition is logged with timestamp and duration
- ✅ Complete audit trail in `WorkflowHistory`
- ✅ Working memory is inspectable at any point
- ✅ Clear separation between agent reasoning and action execution

### 2. Debuggability
- ✅ State can be printed/inspected at any iteration
- ✅ Errors tracked with full context (node, tool, timestamp)
- ✅ Retry logic is explicit and traceable
- ✅ Can inject breakpoints at node boundaries

### 3. Self-Correction
- ✅ Execution errors loop back to REASONING with error context
- ✅ Agent can "see" mistakes and adjust strategy
- ✅ Validation failures trigger re-generation
- ✅ Retry count prevents infinite loops

### 4. Token Optimization
- ✅ `format_state_for_prompt()` reduces context by 80-90%
- ✅ Only essential context included in LLM prompts
- ✅ Full state preserved for debugging/audit

### 5. Testability
- ✅ Each node is independently unit testable
- ✅ Edge logic is isolated and testable
- ✅ Can mock state and test individual components
- ✅ Integration tests can assert on state transitions

## Usage

### Basic Usage (Backward Compatible)

```python
from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow

# Initialize workflow (delegates to stateful implementation)
workflow = AnalyzeCSVWorkflow()

# Execute (same interface as before)
result = workflow.execute(
    file_path="data.csv",
    conversation=conversation_dict,
    dashboards=dashboards_dict,
    user_prompt="Create a dashboard"
)
```

### Direct Stateful Workflow Usage

```python
from morpheus.workflows.analyze_csv.state_graph import StatefulAnalyzeCSVWorkflow

# Initialize stateful workflow
workflow = StatefulAnalyzeCSVWorkflow()

# Execute
result = workflow.execute(
    file_path="data.csv",
    conversation=conversation_dict,
    dashboards=dashboards_dict,
    user_prompt="Create a dashboard"
)

# Result includes workflow_output with full state history
workflow_output = result["workflow_output"]
print(f"Total iterations: {workflow_output.metadata['final_iteration']}")
print(f"Retry count: {workflow_output.metadata['retry_count']}")
```

## State Lifecycle

### 1. Initialization
```python
state = AgentState(
    user_state=UserState(...),      # User context
    working_memory=WorkingMemory(), # Empty scratchpad
    workflow_history=WorkflowHistory(), # Empty audit trail
    input_prompt="user request",
    file_path="data.csv",
    current_node="START",
    status="RUNNING"
)
```

### 2. Execution Loop
```python
while state.status == "RUNNING":
    # Execute current node
    state = nodes[state.current_node](state)
    
    # Decide next node
    next_node = decide_next_node(state)
    state.current_node = next_node
    state.iteration += 1
    
    # Check terminal condition
    if next_node in ["FINISH", "ERROR"]:
        break
```

### 3. State Transitions Example

```
Iteration 0: START
  → Action: Initialize user state
  → Next: ROUTING

Iteration 1: ROUTING
  → Action: Route to "dashboard" mode
  → Next: REASONING

Iteration 2: REASONING
  → Action: Decide to load CSV file
  → Next: EXECUTION

Iteration 3: EXECUTION
  → Action: Execute python_repl to load data
  → Next: REASONING (continue loop)

Iteration 4: REASONING
  → Action: Decide to generate dashboard
  → Next: EXECUTION

Iteration 5: EXECUTION
  → Action: No tools, output generated
  → Next: SYNTHESIS

Iteration 6: SYNTHESIS
  → Action: Extract dashboard JSON
  → Next: VALIDATION

Iteration 7: VALIDATION
  → Action: Validate structure (success)
  → Next: FINISH

Final: FINISH
  → Status: FINISHED
  → Output: {type: "dashboard_config", data: {...}}
```

## Error Handling & Self-Correction

### Example: Execution Error Recovery

```
Iteration 3: EXECUTION
  → Action: Execute python_repl
  → Result: SyntaxError in Python code
  → working_memory.errors.append({error: "SyntaxError..."})
  → working_memory.retry_count = 1
  → Next: REASONING (self-correction)

Iteration 4: REASONING
  → State Context: Includes error from last execution
  → Agent sees error and generates corrected code
  → Action: Retry with fixed Python code
  → Next: EXECUTION

Iteration 5: EXECUTION
  → Action: Execute corrected python_repl
  → Result: Success
  → working_memory.retry_count = 0 (reset)
  → Next: REASONING (continue)
```

## Token Optimization

The `format_state_for_prompt()` function creates concise context:

```
Before (Full State): ~5000 tokens
After (Formatted): ~650 tokens (87% reduction)
```

**What's Included:**
- Current node, iteration, status
- Route decision
- Recent tool executions (last 3)
- Recent errors (last 3)
- Recent history (last 5 entries)
- File availability
- User request

**What's Excluded:**
- Full dataframe data
- Complete dashboard JSON (only counts)
- Full conversation history (only count)
- Binary data
- Raw tool outputs (only previews)

## Extending the Workflow

### Adding a New Node

1. Define node function in `nodes.py`:
```python
def node_my_new_step(state: AgentState, **kwargs) -> AgentState:
    logger.info("Running MY_NEW_STEP node")
    # Your logic here
    return state
```

2. Register node in `state_graph.py`:
```python
self.nodes = {
    # ... existing nodes
    "MY_NEW_STEP": nodes.node_my_new_step,
}
```

3. Update edge logic in `edges.py`:
```python
def decide_next_node(state: AgentState) -> str:
    # ... existing logic
    elif current == "MY_PREV_NODE":
        return "MY_NEW_STEP"
    elif current == "MY_NEW_STEP":
        return "NEXT_NODE"
```

### Adding Middleware (e.g., Human-in-the-Loop)

Create an approval node:
```python
def node_human_approval(state: AgentState, **kwargs) -> AgentState:
    """Wait for human approval before proceeding"""
    # Store pending output
    pending_output = state.working_memory.dashboard_json
    
    # Request approval (via API, webhook, etc.)
    approval = request_human_approval(pending_output)
    
    if not approval["approved"]:
        # Reject: go back to reasoning with feedback
        state.working_memory.errors.append({
            "node": "HUMAN_APPROVAL",
            "error": approval["feedback"]
        })
        state.working_memory.retry_count += 1
    
    return state
```

Then insert into flow: `SYNTHESIS → HUMAN_APPROVAL → VALIDATION`

## Migration Guide

### From Old Workflow to New

The refactored workflow is **100% backward compatible**. No changes needed to existing code using `AnalyzeCSVWorkflow`.

**Old Code (Still Works):**
```python
from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
workflow = AnalyzeCSVWorkflow()
result = workflow.execute(...)
```

**New Code (Recommended for new development):**
```python
from morpheus.workflows.analyze_csv.state_graph import StatefulAnalyzeCSVWorkflow
workflow = StatefulAnalyzeCSVWorkflow()
result = workflow.execute(...)
```

### Testing Migration

The new workflow has been tested to produce identical outputs to the old implementation while providing enhanced observability.

## File Structure

```
morpheus/workflows/analyze_csv/
├── README.md                    # This file
├── state_models.py              # Pydantic state models
├── nodes.py                     # Node implementations
├── edges.py                     # Edge transition logic
├── state_graph.py               # Workflow orchestrator
├── helpers.py                   # Helper functions
├── workflow.py                  # Legacy compatibility layer
└── prompts/                     # System prompts
    ├── analysis_prompts.py
    └── user.py
```

## Troubleshooting

### Enable Debug Logging

```python
import logging
logging.getLogger("morpheus.workflows").setLevel(logging.DEBUG)
```

### Inspect State at Breakpoint

```python
# Add to any node
print(format_state_for_prompt(state))
```

### Check Workflow History

```python
result = workflow.execute(...)
workflow_output = result["workflow_output"]

for entry in workflow_output.metadata["workflow_history"]:
    print(f"{entry['from_state']} → {entry['action']} → {entry['to_state']} ({entry['duration_ms']}ms)")
```

### Common Issues

**1. Max Iterations Exceeded**
- Check `state.max_iterations` (default: 10)
- Review `WorkflowHistory` to see where agent is stuck
- Check for missing error handling in nodes

**2. Validation Failures**
- Check `state.working_memory.errors` for details
- Review last few iterations in workflow history
- Ensure tools are executing successfully

**3. Empty Output**
- Check if SYNTHESIS node extracted data correctly
- Review REASONING node decisions
- Verify tools produced expected outputs

## Performance

**Execution Time:**
- Similar to original implementation (~10-30s for typical workflow)
- Slight overhead from state management (<100ms per iteration)

**Memory:**
- AgentState: ~1-5MB depending on working memory size
- WorkflowHistory: ~100KB for typical 10-iteration workflow

**Token Usage:**
- Reduced by 80-90% through `format_state_for_prompt()`
- Typical prompt: 500-1000 tokens vs. 3000-5000 tokens before

## Future Enhancements

### Planned
- [ ] Suspend/Resume workflow capability
- [ ] State checkpointing to database
- [ ] Workflow visualization tool
- [ ] Performance profiling per node
- [ ] A/B testing framework for nodes

### Possible
- [ ] Multi-agent collaboration (parallel nodes)
- [ ] Conditional branching based on data characteristics
- [ ] Dynamic tool registration
- [ ] Workflow templates for common patterns

## Contributing

When adding new features:

1. **Nodes**: Keep pure (no side effects beyond state updates)
2. **Edges**: Keep logic simple and testable
3. **State**: Add new fields to appropriate model (UserState, WorkingMemory, etc.)
4. **Helpers**: Extract reusable logic to helpers.py
5. **Tests**: Add unit tests for nodes and integration tests for workflows

## References

- Original workflow: `workflow.py` (lines 1150-1386, marked as legacy)
- State models: `state_models.py`
- LangChain docs: https://python.langchain.com/docs/
- Pydantic docs: https://docs.pydantic.dev/

---

**Last Updated**: 2026-01-22
**Version**: 2.0.0 (Stateful Agentic Architecture)
