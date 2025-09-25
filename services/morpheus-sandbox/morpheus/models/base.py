from langchain_openai import ChatOpenAI
from utils.config import config

def get_model_for_agent(
    agent="multi_purpose"
) -> ChatOpenAI:
    agent_config = None
    for a in config.openai.agent:
        if a.name == agent:
            agent_config = a
            break
    if not agent_config:
        raise ValueError(f"Agent config not found for agent: {agent}")
    
    model = ChatOpenAI(
        model=agent_config.model,
        temperature=agent_config.temperature,
        api_key=config.openai.api_key
    )
    return model

