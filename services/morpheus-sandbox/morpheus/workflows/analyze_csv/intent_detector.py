"""
Intent detection module for routing between Q&A and Dashboard modes.
"""
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI
from morpheus.models.base import get_model_for_agent
from utils.config import load_config
from utils.logger import logger
from typing import List, Dict, Any
import re

INTENT_DETECTION_PROMPT = """You are an intent classifier for a data analysis system. Your task is to determine whether a user's request is asking for:

1. **Q&A (Question & Answer)**: The user wants to ask questions about the data, get explanations, calculations, or insights without generating a new dashboard. Examples:
   - "What is the total revenue?"
   - "How many orders were placed?"
   - "Explain the trend in sales"
   - "Calculate the average order value"
   - "Tell me about the top products"
   - "Why did sales decrease?"

2. **Dashboard**: The user wants to create, build, generate, or visualize a dashboard with charts and metrics. Examples:
   - "Create a dashboard"
   - "Build a visualization"
   - "Generate charts for this data"
   - "Show me a dashboard"
   - "Visualize the data"
   - "Make a dashboard with revenue trends"

Context clues:
- Questions starting with "what", "how", "why", "explain", "tell me", "calculate" are usually Q&A
- Requests with "create", "build", "generate", "visualize", "dashboard", "chart", "graph" are usually Dashboard
- If a dashboard already exists in the conversation and the user asks a follow-up question, it's likely Q&A
- If the user explicitly requests dashboard creation or visualization, it's Dashboard

Respond with ONLY one word: "qa" or "dashboard"
"""


def detect_user_intent(user_prompt: str, conversation_history: List[Dict[str, Any]]) -> str:
    """
    Detect user intent using LLM-based classification.
    
    Args:
        user_prompt: The current user prompt
        conversation_history: List of previous conversation nodes (for context)
    
    Returns:
        "qa" or "dashboard"
    """
    try:
        config = load_config()
        model = get_model_for_agent()
        
        # Build context from conversation history
        context_parts = []
        has_existing_dashboard = False
        for node in conversation_history[-5:]:  # Last 5 nodes for context
            role = (node.get("role") or "").lower()
            if role == "assistant":
                # Check if assistant node contains dashboard
                for content in node.get("contents", []):
                    if content.get("type") == "dashboard":
                        has_existing_dashboard = True
                        break
        
        # Build prompt with context
        context_info = ""
        if has_existing_dashboard:
            context_info = "\n\nNote: A dashboard already exists in this conversation. Follow-up questions are likely Q&A unless the user explicitly requests a new dashboard."
        
        full_prompt = f"{user_prompt}{context_info}"
        
        messages = [
            SystemMessage(content=INTENT_DETECTION_PROMPT),
            HumanMessage(content=full_prompt)
        ]
        
        response = model.invoke(messages)
        intent = response.content.strip().lower()
        
        # Normalize response
        if "qa" in intent or "question" in intent or "answer" in intent:
            detected_intent = "qa"
        elif "dashboard" in intent:
            detected_intent = "dashboard"
        else:
            # Default to dashboard if unclear (preserves existing behavior)
            logger.warning(f"Unclear intent detection result: {intent}, defaulting to dashboard")
            detected_intent = "dashboard"
        
        logger.info(f"Detected intent: {detected_intent} for prompt: {user_prompt[:50]}...")
        return detected_intent
        
    except Exception as e:
        logger.error(f"Error in intent detection: {e}, defaulting to dashboard")
        return "dashboard"  # Default to dashboard on error to preserve existing behavior

