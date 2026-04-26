"""
Slack Bolt app setup, event handlers, and Block Kit formatting helpers.
"""

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

SLACK_SIGNING_SECRET = os.environ.get("SLACK_SIGNING_SECRET", "")
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")

# Lazily initialised — only constructed when the Slack event handler is first used.
# This avoids hard-importing slack_bolt at module load time so the module can be
# imported in test environments where slack_bolt may not be installed.
_slack_app = None
_slack_handler = None


def get_slack_app():
    global _slack_app
    if _slack_app is None:
        from slack_bolt.async_app import AsyncApp
        _slack_app = AsyncApp(
            signing_secret=SLACK_SIGNING_SECRET,
            token=SLACK_BOT_TOKEN or None,
            token_verification_enabled=bool(SLACK_BOT_TOKEN),
        )
    return _slack_app


def get_slack_handler():
    global _slack_handler
    if _slack_handler is None:
        from slack_bolt.adapter.fastapi.async_handler import AsyncSlackRequestHandler
        _slack_handler = AsyncSlackRequestHandler(get_slack_app())
    return _slack_handler


# ── Formatters ────────────────────────────────────────────────────────────────

def build_analyzing_blocks(query: str) -> list:
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*📊 Dreamify*\n\n🔍 Analyzing: _{query}_",
            },
        }
    ]


def build_status_blocks(step_label: str) -> list:
    return [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*📊 Dreamify*\n\n{step_label}"},
        }
    ]


def _format_metric_chip(metric: Dict[str, Any]) -> str:
    """Render one dashboard metric as a compact mrkdwn chip."""
    trend = metric.get("trend", "")
    icon = "📈" if trend == "up" else "📉" if trend == "down" else "➡️"
    title = metric.get("title", "")
    value = metric.get("value", "")
    change = metric.get("change", "")
    parts = [f"*{title}*", str(value)]
    if change:
        parts.append(f"{icon} {change}")
    return "  ".join(parts)


def build_response_blocks(
    narrative: str,
    dashboard_url: Optional[str],
    credits_used: int,
    metrics: Optional[list] = None,
) -> list:
    blocks: list = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*📊 Dreamify*\n\n{narrative}"},
        }
    ]

    # Inline metric chips — shown when a dashboard was generated
    if metrics:
        chips = "   |   ".join(_format_metric_chip(m) for m in metrics[:4])
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": chips},
        })

    action_elements = []
    if dashboard_url:
        action_elements.append(
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "View Dashboard"},
                "url": dashboard_url,
                "style": "primary",
            }
        )

    if action_elements:
        blocks.append({"type": "actions", "elements": action_elements})

    blocks.append(
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"_{credits_used} credits used_"}
            ],
        }
    )
    return blocks


def build_error_blocks(message: str) -> list:
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*📊 Dreamify*\n\n⚠️ {message}",
            },
        }
    ]


def build_sync_placeholder_blocks(provider_label: str, account_name: str, rows: Optional[int]) -> list:
    """Placeholder sent immediately after sync completes, before Morpheus analysis."""
    rows_str = f" · {rows:,} rows" if rows is not None else ""
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"✅ *{account_name}* synced successfully{rows_str}\n"
                    f"_Analyzing data with Dreamify AI…_"
                ),
            },
        }
    ]


def build_sync_result_blocks(
    provider_label: str,
    account_name: str,
    rows: Optional[int],
    narrative: str,
    dashboard_url: Optional[str],
    metrics: Optional[list] = None,
) -> list:
    """Final Slack message after Morpheus analysis completes."""
    rows_str = f" · {rows:,} rows" if rows is not None else ""
    blocks: list = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"✅ *{account_name}* synced{rows_str}\n\n"
                    f"{narrative}"
                ),
            },
        }
    ]
    if metrics:
        chips = "   |   ".join(_format_metric_chip(m) for m in metrics[:4])
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": chips},
        })
    if dashboard_url:
        blocks.append({
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Open Dashboard →"},
                    "url": dashboard_url,
                    "style": "primary",
                }
            ],
        })
    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": "_Powered by Dreamify_"}],
    })
    return blocks


# ── Workflow step labels ──────────────────────────────────────────────────────

_STEP_LABELS: Dict[str, str] = {
    "initializing": "🔍 Initializing...",
    "starting": "🔍 Starting workflow...",
    "load_conversation": "📂 Loading conversation...",
    "download_asset": "📥 Loading data sources...",
    "run_workflow": "⚙️ Running analysis...",
    "routing": "🗺️ Routing query...",
    "reasoning": "🧠 Reasoning...",
    "execution": "💻 Executing analysis...",
    "synthesis": "✍️ Synthesizing insights...",
    "validation": "✅ Validating output...",
    "finish": "✅ Done",
    "error": "❌ Analysis failed",
}


def step_label(step: str) -> str:
    return _STEP_LABELS.get(step, f"⚙️ {step.replace('_', ' ').title()}...")


# ── Token helpers ─────────────────────────────────────────────────────────────

def encrypt_token(token: str) -> str:
    """Encrypt a bot token using Fernet symmetric encryption."""
    from cryptography.fernet import Fernet

    key = _get_fernet_key()
    return Fernet(key).encrypt(token.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    """Decrypt a bot token."""
    from cryptography.fernet import Fernet

    key = _get_fernet_key()
    return Fernet(key).decrypt(encrypted.encode()).decode()


def _get_fernet_key() -> bytes:
    raw = os.environ.get("CHAT_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("CHAT_ENCRYPTION_KEY env var is not set")
    # Accept both raw bytes (urlsafe base64) and plain strings
    return raw.encode() if isinstance(raw, str) else raw
