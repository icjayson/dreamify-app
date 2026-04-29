"""
Telegram bot utilities: lazy bot singleton, MarkdownV2 formatters, keyboard builder.

All message text uses MarkdownV2 parse mode. Special chars must be escaped.
"""

import logging
import re
from typing import Optional

from utils.config import config

logger = logging.getLogger(__name__)

_bot = None


async def get_telegram_bot():
    """Return a lazy-initialised, initialized telegram.Bot instance.

    python-telegram-bot v20+ requires bot.initialize() to be called before
    any API calls so the underlying HTTP session is started.
    """
    global _bot
    if _bot is None:
        token = config.telegram.bot_token if config.telegram else ""
        if not token:
            raise RuntimeError("telegram.bot_token is not set in config.yaml")
        from telegram import Bot
        _bot = Bot(token=token)
        await _bot.initialize()
    return _bot


# ── MarkdownV2 helpers ────────────────────────────────────────────────────────

_MARKDOWN_V2_SPECIAL = re.compile(r'([_*\[\]()~`>#+\-=|{}.!\\])')


def escape_markdown(text: str) -> str:
    """Escape all MarkdownV2 reserved characters in plain text."""
    return _MARKDOWN_V2_SPECIAL.sub(r'\\\1', text)


# ── Message formatters ────────────────────────────────────────────────────────

def format_analyzing_message(query: str) -> str:
    truncated = query[:80] + "…" if len(query) > 80 else query
    return f"🔍 *Analyzing\\.\\.\\.* _{escape_markdown(truncated)}_"


def format_status_message(label: str) -> str:
    return f"⏳ {escape_markdown(label)}"


def format_response_message(
    narrative: str,
    dashboard_url: Optional[str],
    credits_used: int,
    metrics: Optional[list] = None,
) -> str:
    parts = ["📊 *Dreamify*\n"]
    parts.append(escape_markdown(narrative))

    if metrics:
        chip_lines = []
        for m in metrics[:4]:
            trend = m.get("trend", "")
            icon = "📈" if trend == "up" else "📉" if trend == "down" else "➡️"
            title = escape_markdown(str(m.get("title", "")))
            value = escape_markdown(str(m.get("value", "")))
            change = escape_markdown(str(m.get("change", ""))) if m.get("change") else ""
            line = f"{icon} *{title}* {value}"
            if change:
                line += f"  {change}"
            chip_lines.append(line)
        parts.append("\n\n" + "\n".join(chip_lines))

    parts.append(f"\n\n_{escape_markdown(str(credits_used))} credits used_")
    return "".join(parts)


def format_error_message(message: str) -> str:
    return f"⚠️ {escape_markdown(message)}"


# ── Inline keyboard ───────────────────────────────────────────────────────────

def build_dashboard_keyboard(dashboard_url: str):
    """Return an InlineKeyboardMarkup with a 'View Dashboard' button."""
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("📈 View Dashboard", url=dashboard_url),
    ]])
