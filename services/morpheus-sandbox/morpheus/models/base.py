from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from utils.config import config

def get_model_for_agent(
    agent="multi_purpose"
):
    """
    Get the appropriate LLM model for the specified agent.
    Supports both OpenAI and Google Gemini models based on config.
    """
    # Agent config is at root level in config.yaml
    agent_config = None
    if config.agent:
        for a in config.agent:
            if a.name == agent:
                agent_config = a
                break
    
    if not agent_config:
        raise ValueError(f"Agent config not found for agent: {agent}")
    
    model_name = agent_config.model
    
    # Determine which provider to use based on model name
    if model_name.startswith("gemini"):
        # Use Google Gemini
        if not config.google or not config.google.api_key:
            raise ValueError("Google API key not configured")
        model = ChatGoogleGenerativeAI(
            model=model_name,
            temperature=agent_config.temperature,
            google_api_key=config.google.api_key
        )
    else:
        # Use OpenAI
        if not config.openai or not config.openai.api_key:
            raise ValueError("OpenAI API key not configured")
        model = ChatOpenAI(
            model=model_name,
            temperature=agent_config.temperature,
            api_key=config.openai.api_key
        )
    
    return model

