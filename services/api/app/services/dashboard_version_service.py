"""
Dashboard version history service.

Persists prior dashboard states as explicit, write-once sibling S3 keys
(``.../dashboards/{dashboard_id}/versions/{n}.json``) so the frontend can show
before/after and one-click revert. S3 object versioning is NOT reliably enabled
(``USER_ASSETS_BUCKET_VERSION`` is empty), so versions are managed with explicit
keys rather than S3 object versions.

A version manifest lives on the conversation JSON's dashboard entry under
``versions`` -- a list of records ``{version, s3_key, created_at, edit_summary,
source}``. Existing dashboards with no manifest behave as version 0; the first
snapshot writes ``versions/0.json``.

NOTE (Morpheus snapshot gap): Morpheus overwrites dashboards through its own
write path, NOT this backend endpoint. To get full version history for AI edits,
that Morpheus dashboard-write path must call ``snapshot_current(...,
source="morpheus", ...)`` BEFORE it overwrites the live dashboard object. That
change is intentionally out of scope here and should be made in a future change
on the Morpheus side.
"""

import json
from typing import Any, Dict, List, Optional

from app.utils.timestamp_utils import utc_now_iso
from utils.s3.client import download_bytes, upload_bytes
from utils.s3.conversations import save_conversation
from utils.s3.paths import build_dashboard_version_key


def current_version(target_dashboard_entry: Dict[str, Any]) -> int:
    """Current head version: len(versions) - 1, or 0 when no snapshots exist."""
    versions = target_dashboard_entry.get("versions") or []
    return len(versions) - 1 if versions else 0


def list_versions(
    conversation: Dict[str, Any], dashboard_id: str
) -> List[Dict[str, Any]]:
    """Return the ordered version manifest entries for a dashboard."""
    for entry in conversation.get("dashboards", []):
        if entry.get("dashboard_id") == dashboard_id:
            return list(entry.get("versions") or [])
    return []


def get_version_data(
    bucket: str,
    user_id: str,
    project_id: str,
    dashboard_id: str,
    version: int,
) -> Dict[str, Any]:
    """Download and parse the snapshot stored at ``versions/{version}.json``."""
    version_key = build_dashboard_version_key(
        user_id, project_id, dashboard_id, version
    )
    snapshot_bytes = download_bytes(bucket, version_key)
    return json.loads(snapshot_bytes.decode("utf-8"))


def snapshot_current(
    bucket: str,
    current_key: str,
    user_id: str,
    project_id: str,
    dashboard_id: str,
    conversation: Dict[str, Any],
    target_dashboard_entry: Dict[str, Any],
    *,
    source: str,
    edit_summary: Optional[str],
    conversation_bucket: str,
    conversation_key: str,
) -> int:
    """Snapshot the CURRENT live dashboard before it is overwritten.

    Copies the existing object at ``current_key`` to an immutable, write-once
    ``versions/{n}.json`` sibling key and appends a manifest record to
    ``target_dashboard_entry["versions"]``. The updated conversation JSON is then
    persisted via ``save_conversation``. Returns the new current (head) version
    number.

    If the current dashboard object does not exist yet (nothing to snapshot),
    the version is left unchanged and returned as-is.
    """
    try:
        current_bytes = download_bytes(bucket, current_key)
    except FileNotFoundError:
        return current_version(target_dashboard_entry)

    versions = target_dashboard_entry.setdefault("versions", [])
    new_version = len(versions)
    version_key = build_dashboard_version_key(
        user_id, project_id, dashboard_id, new_version
    )
    upload_bytes(bucket, version_key, current_bytes, content_type="application/json")

    versions.append(
        {
            "version": new_version,
            "s3_key": version_key,
            "created_at": utc_now_iso(),
            "edit_summary": edit_summary,
            "source": source,
        }
    )
    conversation["updated_at"] = utc_now_iso()
    save_conversation(conversation_bucket, conversation_key, conversation)
    return new_version


def revert(
    bucket: str,
    current_key: str,
    user_id: str,
    project_id: str,
    dashboard_id: str,
    conversation: Dict[str, Any],
    target_dashboard_entry: Dict[str, Any],
    target_version: int,
    *,
    conversation_bucket: str,
    conversation_key: str,
) -> int:
    """Restore a prior version onto the live dashboard, non-destructively.

    First snapshots the pre-revert live state (``source="revert"``), then copies
    ``versions/{target_version}.json`` back onto ``current_key``. The revert is
    itself a new head version, so it is never destructive. Returns the new
    current (head) version number created by the pre-revert snapshot.
    """
    target_bytes = _read_version_bytes(
        bucket, user_id, project_id, dashboard_id, target_version
    )
    new_version = snapshot_current(
        bucket,
        current_key,
        user_id,
        project_id,
        dashboard_id,
        conversation,
        target_dashboard_entry,
        source="revert",
        edit_summary=f"Reverted to version {target_version}",
        conversation_bucket=conversation_bucket,
        conversation_key=conversation_key,
    )
    upload_bytes(bucket, current_key, target_bytes, content_type="application/json")
    return new_version


def _read_version_bytes(
    bucket: str,
    user_id: str,
    project_id: str,
    dashboard_id: str,
    version: int,
) -> bytes:
    version_key = build_dashboard_version_key(
        user_id, project_id, dashboard_id, version
    )
    return download_bytes(bucket, version_key)
