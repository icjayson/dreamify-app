from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from utils.config import config

def get_model_for_agent(
    agent="multi_purpose"
):
    agent_config = None
    for a in config.agent:
        if a.name == agent:
            agent_config = a
            break
    if not agent_config:
        raise ValueError(f"Agent config not found for agent: {agent}")
    
    # Check if the model is a Gemini model
    if agent_config.model.startswith("gemini"):
        model = ChatGoogleGenerativeAI(
            model=agent_config.model,
            temperature=agent_config.temperature,
            google_api_key=config.google.api_key
        )
    else:
        model = ChatOpenAI(
            model=agent_config.model,
            temperature=agent_config.temperature,
            api_key=config.openai.api_key
        )
    return model
