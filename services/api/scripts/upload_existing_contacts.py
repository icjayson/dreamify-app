"""
One-off backfill: upload all existing Clerk users into the Resend automation
audience, with name + the 6 custom properties used by the automations:
    uid, has_dashboard, has_connector, first_connector, has_workspace, workspace_platform

Each contact's properties are computed from current DynamoDB state, so existing
users who already built dashboards / connected sources / integrated workspaces
get the right flags right away.

IMPORTANT
  - Uploading contacts does NOT trigger any automation. Resend automations fire
    only on custom events (events/send). Importing/creating contacts is silent.
  - Use the SAME audience as the live automations (config.resend.audience_id).
    A separate audience is not needed.
  - Audience custom properties are String only here, so flags are "true"/"false".
  - Idempotent: re-running creates new contacts and updates existing ones.

Prereqs (Resend → Audience → Properties), all type String:
    uid, has_dashboard, has_connector, first_connector, has_workspace, workspace_platform

Run from the repo root:
    python scripts/upload_existing_contacts.py --dry-run   # preview, no writes
    python scripts/upload_existing_contacts.py             # for real
"""

import os
import sys
import time

# Make `utils` importable regardless of how the script is launched.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import resend  # noqa: E402
from boto3.dynamodb.conditions import Attr  # noqa: E402
from clerk_backend_api import Clerk  # noqa: E402

from utils.config import config  # noqa: E402
from utils.resend_automation import provider_label  # noqa: E402
from utils.dynamodb.repos import projects as projects_repo  # noqa: E402
from utils.dynamodb.repos import connected_accounts as ca_repo  # noqa: E402
from utils.dynamodb.client import get_table  # noqa: E402
from utils.dynamodb.tables import tables  # noqa: E402

DRY = "--dry-run" in sys.argv
USE_TEST = "--test" in sys.argv

# Clerk has separate Development (sk_test) and Production (sk_live) instances with
# DIFFERENT users. Default to the LIVE instance for the real backfill; pass
# --test to target the development instance instead.
_live_key = config.clerk.CLERK_LIVE_SECRET_KEY if config.clerk else None
_test_key = config.clerk.CLERK_SECRET_KEY if config.clerk else None
_clerk_key = _test_key if (USE_TEST or not _live_key) else _live_key
_clerk_client = Clerk(bearer_auth=_clerk_key)
_instance = "TEST (sk_test)" if (USE_TEST or not _live_key) else "LIVE (sk_live)"


def iter_clerk_users(page: int = 100):
    """Yield every Clerk user, paginating through the list endpoint."""
    offset = 0
    while True:
        batch = list(
            _clerk_client.users.list(request={"limit": page, "offset": offset})
        )
        if not batch:
            break
        yield from batch
        offset += page


def _list_workspaces(user_id: str) -> list:
    """Scan chat_workspaces for a user's real (non-pending) workspaces."""
    table = get_table(tables.chat_workspaces)
    items, kwargs = [], {"FilterExpression": Attr("user_id").eq(user_id)}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return [
        w for w in items
        if "pending" not in str(w.get("platform", ""))
        and not str(w.get("platform_workspace_id", "")).startswith("zalo_upload")
    ]


def compute_properties(user_id: str) -> dict:
    """Derive the 6 contact properties from current DynamoDB state."""
    # Dashboards
    try:
        has_dashboard = bool(projects_repo.list_projects(user_id))
    except Exception:
        has_dashboard = False
    # Connectors / entities
    try:
        conns = ca_repo.list_connections_by_prefix(user_id, "")
        entities = [
            (c.get("provider"), e)
            for c in conns
            for e in (c.get("selected_entities") or [])
        ]
    except Exception:
        entities = []
    first_connector = provider_label(entities[0][0]) if entities else ""
    # Workspaces
    try:
        workspaces = _list_workspaces(user_id)
    except Exception:
        workspaces = []
    workspace_platform = (workspaces[0].get("platform") or "") if workspaces else ""

    return {
        "uid": user_id,
        "has_dashboard": "true" if has_dashboard else "false",
        "has_connector": "true" if entities else "false",
        "first_connector": first_connector,
        "has_workspace": "true" if workspaces else "false",
        "workspace_platform": workspace_platform,
    }


def upsert(params: dict) -> str:
    """Create the contact, or update it if it already exists. Returns status."""
    try:
        resend.Contacts.create(params)
        return "created"
    except Exception:
        try:
            resend.Contacts.update(params)
            return "updated"
        except Exception as e:
            return f"error: {type(e).__name__}: {e}"


def main() -> None:
    if not config.resend or not config.resend.automation_api_key or not config.resend.audience_id:
        print("ERROR: resend.automation_api_key / audience_id not configured.")
        sys.exit(1)

    resend.api_key = config.resend.automation_api_key
    audience_id = config.resend.audience_id
    print(f"Clerk instance: {_instance}  →  audience {audience_id}\n")

    created = updated = errored = no_email = 0
    for user in iter_clerk_users():
        email = (
            user.email_addresses[0].email_address
            if getattr(user, "email_addresses", None)
            else None
        )
        if not email:
            no_email += 1
            continue

        props = compute_properties(user.id)
        params = {
            "audience_id": audience_id,
            "email": email,
            "first_name": user.first_name or "",
            "last_name": user.last_name or "",
            "unsubscribed": False,
            "properties": props,
        }

        if DRY:
            print(f"[dry] {email}  {props}")
            continue

        status = upsert(params)
        print(f"{email}  {status}")
        if status == "created":
            created += 1
        elif status == "updated":
            updated += 1
        else:
            errored += 1
        time.sleep(0.1)  # be gentle on rate limits

    print(
        f"\nDone. {'(dry-run) ' if DRY else ''}"
        f"created={created} updated={updated} errors={errored} no_email={no_email}"
    )


if __name__ == "__main__":
    main()
