"""
Event-driven Resend automation helpers (contacts + events/send).

Separate from `email_service.py` (transactional sends). These helpers:
  - upsert a contact into the automation Audience, and
  - emit a custom event that triggers a Resend automation.

Both are best-effort and non-fatal: failures are logged, never raised, so they
can be called off the request path without affecting the main response.

Schema confirmed against the live Resend API (snake_case):
  POST https://api.resend.com/events/send
    { "event": "user.created", "email"|"contact_id": ..., "payload": {...} }
  resend.Contacts.create({ "audience_id", "email", "first_name", "last_name", "unsubscribed" })
"""

import asyncio
import json
import logging
import threading
from typing import Optional

import httpx
import resend as _resend

from utils.config import config, frontend_app_url

logger = logging.getLogger(__name__)

RESEND_BASE = "https://api.resend.com"

# Friendly display names for connector providers (used in automation emails).
PROVIDER_LABELS = {
    "meta_ads": "Meta Ads",
    "facebook": "Meta Ads",
    "tiktok": "TikTok",
    "shopify": "Shopify",
    "stripe": "Stripe",
    "hubspot": "HubSpot",
    "salesforce": "Salesforce",
    "supabase": "Supabase",
    "google_ads": "Google Ads",
    "warehouse": "your data warehouse",
}


def provider_label(provider: str) -> str:
    """Human-friendly name for a provider key (e.g. 'meta_ads' -> 'Meta Ads')."""
    if not provider:
        return "your data source"
    return PROVIDER_LABELS.get(provider, provider.replace("_", " ").title())


def app_url() -> str:
    """Base app URL for links in automation emails."""
    return frontend_app_url()


def _api_key() -> Optional[str]:
    return config.resend.automation_api_key if config.resend else None


def _audience_id() -> Optional[str]:
    return config.resend.audience_id if config.resend else None


def _enabled() -> bool:
    return bool(config.resend and config.resend.automations_enabled)


def upsert_contact(
    *,
    email: str,
    first_name: str = "",
    last_name: str = "",
    properties: Optional[dict] = None,
) -> Optional[str]:
    """
    Idempotently add a contact to the automation Audience.

    A duplicate (already-present) contact is treated as success — Resend returns
    the existing id or a 4xx we swallow. Returns the contact id when available.
    """
    key, aud = _api_key(), _audience_id()
    if not key or not aud:
        logger.debug(
            "[automation] upsert_contact skipped — key/audience not configured"
        )
        return None
    try:
        _resend.api_key = key
        params = {
            "audience_id": aud,
            "email": email,
            "first_name": first_name or "",
            "last_name": last_name or "",
            "unsubscribed": False,
        }
        # `properties` is only supported on some plans; include it when provided.
        if properties:
            params["properties"] = properties
        res = _resend.Contacts.create(params)
        cid = res.get("id") if isinstance(res, dict) else getattr(res, "id", None)
        logger.info("[automation] contact upserted %s -> %s", email, cid)
        return cid
    except Exception as e:
        # 409/duplicate is expected and fine — contact already in the audience.
        logger.warning(
            "[automation] contact upsert non-fatal for %s: %s: %s",
            email,
            type(e).__name__,
            e,
        )
        return None


def update_contact(
    *,
    email: str,
    first_name: str = "",
    last_name: str = "",
    properties: Optional[dict] = None,
) -> bool:
    """Update an existing contact's fields (by email). Non-fatal."""
    key, aud = _api_key(), _audience_id()
    if not key or not aud:
        return False
    try:
        _resend.api_key = key
        params = {
            "audience_id": aud,
            "email": email,
            "first_name": first_name or "",
            "last_name": last_name or "",
        }
        if properties:
            params["properties"] = properties
        _resend.Contacts.update(params)
        logger.info("[automation] contact updated %s", email)
        return True
    except Exception as e:
        logger.warning(
            "[automation] contact update non-fatal for %s: %s: %s",
            email,
            type(e).__name__,
            e,
        )
        return False


def remove_contact(*, email: str) -> bool:
    """Remove a contact from the audience (by email). Non-fatal."""
    key, aud = _api_key(), _audience_id()
    if not key or not aud or not email:
        return False
    try:
        _resend.api_key = key
        _resend.Contacts.remove(audience_id=aud, email=email)
        logger.info("[automation] contact removed %s", email)
        return True
    except Exception as e:
        logger.warning(
            "[automation] contact remove non-fatal for %s: %s: %s",
            email,
            type(e).__name__,
            e,
        )
        return False


def sync_contact(*, email: str, first_name: str = "", last_name: str = "") -> None:
    """
    Mirror a Clerk user into the audience: ensure the contact exists, then apply
    the latest name fields. Use for `user.updated`. Gated + non-fatal.
    """
    if not _enabled():
        return
    upsert_contact(email=email, first_name=first_name, last_name=last_name)
    update_contact(email=email, first_name=first_name, last_name=last_name)


def delete_contact(*, email: str) -> None:
    """Remove a contact for `user.deleted`. Gated + non-fatal."""
    if not _enabled():
        return
    remove_contact(email=email)


def send_event(
    *,
    event: str,
    email: Optional[str] = None,
    contact_id: Optional[str] = None,
    payload: Optional[dict] = None,
) -> bool:
    """
    Fire a custom event that triggers a Resend automation.

    Identify the recipient by `email` or `contact_id` (at least one required).
    Non-fatal: returns False on any failure.
    """
    key = _api_key()
    if not key:
        logger.debug(
            "[automation] send_event skipped — automation_api_key not configured"
        )
        return False
    if not email and not contact_id:
        logger.error("[automation] send_event %s missing email/contact_id", event)
        return False
    try:
        body: dict = {"event": event, "payload": payload or {}}
        if contact_id:
            body["contact_id"] = contact_id
        else:
            body["email"] = email
        resp = httpx.post(
            f"{RESEND_BASE}/events/send",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            content=json.dumps(body),
            timeout=10.0,
        )
        resp.raise_for_status()
        logger.info("[automation] event %s -> %s", event, email or contact_id)
        return True
    except Exception as e:
        logger.error("[automation] event %s failed: %s: %s", event, type(e).__name__, e)
        return False


def emit(
    *,
    event: str,
    email: str,
    first_name: str = "",
    last_name: str = "",
    payload: Optional[dict] = None,
) -> None:
    """
    Upsert the contact (so the event can map to it) then send the event.

    Gated by `config.resend.automations_enabled`. Synchronous — call from a
    thread/executor (or use `emit_async`) so it never blocks the request path.
    """
    if not _enabled():
        return
    upsert_contact(email=email, first_name=first_name, last_name=last_name)
    send_event(event=event, email=email, payload=payload or {})


async def emit_async(**kwargs) -> None:
    """Run `emit()` in a worker thread so it never blocks/breaks the request."""
    if not _enabled():
        return
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: emit(**kwargs))


def notify_connector_connected(
    *, user_id: str, provider: str, entity: dict, is_first: bool
) -> None:
    """
    Fire the `connector.connected` automation event (Flow 3) in a daemon thread.

    Safe to call from any context (sync or async) — it never blocks the caller.
    Email resolution (Clerk) happens inside the thread. Best-effort / non-fatal.
    """
    if not _enabled():
        return

    def _run() -> None:
        try:
            from utils.clerk_auth import get_user_email_name  # lazy: avoid import cycle

            email, first_name = get_user_email_name(user_id)
            if not email:
                return
            emit(
                event="connector.connected",
                email=email,
                first_name=first_name,
                payload={
                    "first_name": first_name,
                    "is_first": is_first,
                    "provider": provider,
                    "provider_label": provider_label(provider),
                    "entity_name": entity.get("name", ""),
                    "entity_id": entity.get("id", ""),
                    "app_url": app_url(),
                },
            )
        except Exception as e:  # pragma: no cover - best effort
            logger.warning(
                "[automation] connector.connected notify failed: %s: %s",
                type(e).__name__,
                e,
            )

    threading.Thread(target=_run, daemon=True).start()


def notify_workspace_integrated(
    *, user_id: str, platform: str, workspace_name: str, workspace_id: str
) -> None:
    """
    Fire the `workspace.integrated` automation event (Flow 4) in a daemon thread.
    Fires on every successful integration (no is_first gate). Best-effort.
    """
    if not _enabled():
        return

    def _run() -> None:
        try:
            from utils.clerk_auth import get_user_email_name  # lazy: avoid import cycle

            email, first_name = get_user_email_name(user_id)
            if not email:
                return
            emit(
                event="workspace.integrated",
                email=email,
                first_name=first_name,
                payload={
                    "first_name": first_name,
                    "platform": platform,
                    "workspace_name": workspace_name or "",
                    "workspace_id": workspace_id,
                    "app_url": app_url(),
                },
            )
        except Exception as e:  # pragma: no cover - best effort
            logger.warning(
                "[automation] workspace.integrated notify failed: %s: %s",
                type(e).__name__,
                e,
            )

    threading.Thread(target=_run, daemon=True).start()


def notify_workspace_activity(
    *, user_id: str, workspace_id: str, platform: str = ""
) -> None:
    """
    Fire the `workspace.activity` automation event (Flow 4) in a daemon thread.
    Signals the user is actually using a workspace, satisfying the Wait-for-Event.
    """
    if not _enabled():
        return

    def _run() -> None:
        try:
            from utils.clerk_auth import get_user_email_name  # lazy: avoid import cycle

            email, _ = get_user_email_name(user_id)
            if not email:
                return
            send_event(
                event="workspace.activity",
                email=email,
                payload={"workspace_id": workspace_id, "platform": platform},
            )
        except Exception as e:  # pragma: no cover - best effort
            logger.warning(
                "[automation] workspace.activity notify failed: %s: %s",
                type(e).__name__,
                e,
            )

    threading.Thread(target=_run, daemon=True).start()
