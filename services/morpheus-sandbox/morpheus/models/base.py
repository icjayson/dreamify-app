from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from utils.config import config
from utils.logger import logger

# Gemini 3.x models are "thinking" models — their internal reasoning step can take
# 3-5 minutes per call, making agentic workflows impractical unless thinking is
# disabled (thinking_budget=0).  With thinking disabled they respond like fast
# non-thinking models while still benefiting from the gemini-3.x architecture.
_GEMINI_THINKING_PREFIXES = ("gemini-3.",)


def _is_thinking_model(model_name: str) -> bool:
    """Return True if the model is a Gemini thinking/reasoning model."""
    return any(model_name.startswith(p) for p in _GEMINI_THINKING_PREFIXES)


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

        thinking = _is_thinking_model(model_name)

        # Thinking models (gemini-3.x):
        #   - temperature must be 1 (API requirement)
        #   - thinking_budget=0 disables the expensive internal reasoning step
        #     so that agentic tool-call loops don't time out.
        #     The model still uses its full parameter space; only the explicit
        #     "chain-of-thought" pass is skipped.
        temperature = 1 if thinking else agent_config.temperature

        model_kwargs = dict(
            model=model_name,
            temperature=temperature,
            google_api_key=config.google.api_key,
            timeout=120,
            max_retries=2,
        )
        if thinking:
            # Disable thinking tokens so each tool-call round-trip is fast
            model_kwargs["thinking_budget"] = 0
            logger.info(f"[Model] {model_name} is a thinking model — thinking_budget=0 set for workflow efficiency")

        model = ChatGoogleGenerativeAI(**model_kwargs)
    else:
        # Use OpenAI
        if not config.openai or not config.openai.api_key:
            raise ValueError("OpenAI API key not configured")
        model = ChatOpenAI(
            model=model_name,
            temperature=agent_config.temperature,
            api_key=config.openai.api_key,
        )

    return model
