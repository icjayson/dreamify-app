"""
Inbound webhooks that drive email automations.

Currently handles Clerk's `user.created` to enroll new signups into the Resend
"Welcome Series" automation (Flow 1):
    Clerk signup → POST /api/v1/webhooks/clerk → emit "user.created" event → Resend.

Signatures are verified with Svix (Clerk's webhook signing). Configure the
endpoint + signing secret in Clerk dashboard → Webhooks, and set
`clerk.CLERK_WEBHOOK_SECRET` ("whsec_...") in config.
"""

import json
import logging

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks

from utils.config import config, frontend_app_url
from utils.resend_automation import emit, sync_contact, delete_contact

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webhooks"])


def _app_url() -> str:
    return frontend_app_url()


def _primary_email(data: dict) -> str | None:
    """Pick the primary email address from a Clerk user payload."""
    emails = data.get("email_addresses") or []
    if not emails:
        return None
    primary_id = data.get("primary_email_address_id")
    if primary_id:
        for e in emails:
            if e.get("id") == primary_id:
                return e.get("email_address")
    return emails[0].get("email_address")


@router.post("/webhooks/clerk")
async def clerk_webhook(request: Request, background_tasks: BackgroundTasks):
    """Verify a Clerk webhook and, on user.created, fire the welcome automation."""
    secret = config.clerk.CLERK_WEBHOOK_SECRET if config.clerk else None
    if not secret:
        # Misconfiguration — fail loud so it's noticed, but don't leak details.
        logger.error("[webhook] CLERK_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=503, detail="Webhook not configured")

    payload = await request.body()
    headers = {k: v for k, v in request.headers.items()}

    # Verify signature (Svix). Import locally so a missing dep doesn't break import.
    try:
        from svix.webhooks import Webhook, WebhookVerificationError
    except ImportError:
        logger.error("[webhook] svix not installed")
        raise HTTPException(status_code=503, detail="Webhook not configured")

    try:
        evt = Webhook(secret).verify(payload, headers)
    except WebhookVerificationError:
        logger.warning("[webhook] invalid Clerk signature")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        logger.error("[webhook] verify error: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=400, detail="Invalid payload")

    # `evt` is the parsed JSON dict; be defensive about its shape.
    if isinstance(evt, (bytes, str)):
        try:
            evt = json.loads(evt)
        except Exception:
            evt = {}

    event_type = evt.get("type")
    data = evt.get("data") or {}

    if event_type == "user.created":
        # New signup → enroll in audience + fire the welcome automation (Flow 1).
        email = _primary_email(data)
        if email:
            first_name = data.get("first_name") or ""
            background_tasks.add_task(
                emit,
                event="user.created",
                email=email,
                first_name=first_name,
                payload={
                    "user_id": data.get("id"),
                    "first_name": first_name,
                    "app_url": _app_url(),
                },
            )
            logger.info("[webhook] user.created enqueued for %s", email)
        else:
            logger.warning("[webhook] user.created had no email; skipping")

    elif event_type == "user.updated":
        # Profile change → keep the audience contact in sync (name/email).
        email = _primary_email(data)
        if email:
            background_tasks.add_task(
                sync_contact,
                email=email,
                first_name=data.get("first_name") or "",
                last_name=data.get("last_name") or "",
            )
            logger.info("[webhook] user.updated synced for %s", email)

    elif event_type == "user.deleted":
        # Account deleted → remove from audience if Clerk included an email.
        email = _primary_email(data)
        if email:
            background_tasks.add_task(delete_contact, email=email)
            logger.info("[webhook] user.deleted removing %s", email)
        else:
            logger.warning("[webhook] user.deleted had no email; cannot remove contact")

    # Always 200 quickly so Clerk doesn't retry on slow downstream work.
    return {"received": True}
