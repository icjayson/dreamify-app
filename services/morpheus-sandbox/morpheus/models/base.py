from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from utils.config import config
from utils.logger import logger


def get_model_for_agent(
    agent="multi_purpose",
    model_override=None,
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

    model_name = model_override if model_override else agent_config.model

    # Determine which provider to use based on model name
    if model_name.startswith("gemini"):
        # Use Google Gemini
        if not config.google or not config.google.api_key:
            raise ValueError("Google API key not configured")
        model_kwargs = dict(
            model=model_name,
            temperature=1.0,
            google_api_key=config.google.api_key,
            timeout=120,
            max_retries=2,
        )
        model_kwargs["thinking_level"] = "low"
        logger.info(f"[Model] {model_name} is a thinking model — thinking_level=low set for workflow efficiency")
        model = ChatGoogleGenerativeAI(**model_kwargs)
    else:
        # Use OpenAI
        if not config.openai or not config.openai.api_key:
            raise ValueError("OpenAI API key not configured")
        model = ChatOpenAI(
            model=model_name,
            api_key=config.openai.api_key,
            reasoning_effort="low",
            use_responses_api=True,
            timeout=180,
            #temperature=0.7,
            max_retries=2,
        )

    return model
