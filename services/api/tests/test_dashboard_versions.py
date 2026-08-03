"""Phase 7: dashboard version history + non-destructive revert.

Hermetic: S3 is replaced by an in-memory dict and the conversations repo is
monkeypatched. No real AWS access.
"""

import asyncio
import json
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.api.route_modules import conversation
from app.services import dashboard_version_service


# ---------------------------------------------------------------------------
# In-memory S3 + conversation fixtures
# ---------------------------------------------------------------------------


class _FakeS3:
    """Minimal S3 stand-in keyed by (bucket, key) -> bytes."""

    def __init__(self):
        self.objects = {}

    def upload_bytes(self, bucket, key, data, content_type=None, metadata=None):
        self.objects[(bucket, key)] = data
        return {"etag": "fake", "version_id": None}

    def download_bytes(self, bucket, key):
        try:
            return self.objects[(bucket, key)]
        except KeyError:
            raise FileNotFoundError(f"Object not found: s3://{bucket}/{key}")


def _conversation_meta():
    return {
        "user_id": "user_1",
        "s3_bucket": "bucket",
        "s3_key": "users/user_1/projects/project_1/conversations/c1/conversation.json",
    }


def _conversation_with_dashboard():
    return {
        "user_id": "user_1",
        "project_id": "project_1",
        "conversation_id": "c1",
        "dashboards": [
            {
                "dashboard_id": "dash_1",
                "s3_uri": "s3://bucket/users/user_1/projects/project_1/dashboards/dash_1.json",
            }
        ],
    }


def _install(fake, convo, meta=None):
    """Wire the fake S3 + conversation into the module under test.

    load_conversation/save_conversation operate on the shared ``convo`` dict so
    manifest mutations persist across calls within a test.
    """
    meta = meta or _conversation_meta()

    def _save_conversation(bucket, key, conversation_obj):
        # The handler/service mutate ``convo`` in place (same object), so just
        # serialize it to the fake store without touching the live reference.
        fake.objects[(bucket, key)] = json.dumps(conversation_obj).encode("utf-8")

    def _load_conversation(bucket, key):
        return convo

    return [
        patch.object(
            conversation.conversations_repo, "get_conversation", return_value=meta
        ),
        patch.object(conversation, "load_conversation", _load_conversation),
        patch.object(conversation, "upload_bytes", fake.upload_bytes),
        patch.object(conversation, "download_bytes", fake.download_bytes),
        patch.object(dashboard_version_service, "upload_bytes", fake.upload_bytes),
        patch.object(dashboard_version_service, "download_bytes", fake.download_bytes),
        patch.object(
            dashboard_version_service, "save_conversation", _save_conversation
        ),
    ]


def _enter(patches):
    for p in patches:
        p.start()


def _exit(patches):
    for p in patches:
        p.stop()


_DASH_KEY = "users/user_1/projects/project_1/dashboards/dash_1.json"
_V0_KEY = "users/user_1/projects/project_1/dashboards/dash_1/versions/0.json"


# ---------------------------------------------------------------------------
# Save: snapshot + optimistic concurrency
# ---------------------------------------------------------------------------


def test_first_manual_save_snapshots_prior_state():
    fake = _FakeS3()
    fake.objects[("bucket", _DASH_KEY)] = b'{"title": "original"}'
    convo = _conversation_with_dashboard()
    patches = _install(fake, convo)
    _enter(patches)
    try:
        resp = asyncio.run(
            conversation.save_dashboard_data(
                conversation_id="c1",
                dashboard_id="dash_1",
                request=conversation.SaveDashboardDataRequest(
                    project_id="project_1",
                    dashboard_data={"title": "edited"},
                    edit_summary="renamed title",
                ),
                user_id="user_1",
            )
        )
    finally:
        _exit(patches)

    assert resp["success"] is True
    # Prior state copied to versions/0.json verbatim.
    assert fake.objects[("bucket", _V0_KEY)] == b'{"title": "original"}'
    # Live key now holds the new data.
    assert json.loads(fake.objects[("bucket", _DASH_KEY)]) == {"title": "edited"}
    # Manifest entry appended; head version is now 0.
    versions = convo["dashboards"][0]["versions"]
    assert len(versions) == 1
    assert versions[0]["version"] == 0
    assert versions[0]["source"] == "manual"
    assert versions[0]["edit_summary"] == "renamed title"
    assert dashboard_version_service.current_version(convo["dashboards"][0]) == 0


def test_expected_version_mismatch_returns_409():
    fake = _FakeS3()
    fake.objects[("bucket", _DASH_KEY)] = b'{"title": "original"}'
    convo = _conversation_with_dashboard()
    # Pretend one version already exists -> head is 0.
    convo["dashboards"][0]["versions"] = [
        {
            "version": 0,
            "s3_key": _V0_KEY,
            "created_at": "t",
            "edit_summary": None,
            "source": "manual",
        }
    ]
    patches = _install(fake, convo)
    _enter(patches)
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                conversation.save_dashboard_data(
                    conversation_id="c1",
                    dashboard_id="dash_1",
                    request=conversation.SaveDashboardDataRequest(
                        project_id="project_1",
                        dashboard_data={"title": "edited"},
                        expected_version=5,
                    ),
                    user_id="user_1",
                )
            )
    finally:
        _exit(patches)
    assert exc.value.status_code == 409


def test_expected_version_match_succeeds():
    fake = _FakeS3()
    fake.objects[("bucket", _DASH_KEY)] = b'{"title": "original"}'
    convo = _conversation_with_dashboard()
    patches = _install(fake, convo)
    _enter(patches)
    try:
        resp = asyncio.run(
            conversation.save_dashboard_data(
                conversation_id="c1",
                dashboard_id="dash_1",
                request=conversation.SaveDashboardDataRequest(
                    project_id="project_1",
                    dashboard_data={"title": "edited"},
                    expected_version=0,
                ),
                user_id="user_1",
            )
        )
    finally:
        _exit(patches)
    assert resp["success"] is True


# ---------------------------------------------------------------------------
# List versions
# ---------------------------------------------------------------------------


def test_list_versions_returns_ordered_manifest():
    fake = _FakeS3()
    convo = _conversation_with_dashboard()
    convo["dashboards"][0]["versions"] = [
        {
            "version": 0,
            "s3_key": _V0_KEY,
            "created_at": "t0",
            "edit_summary": "a",
            "source": "manual",
        },
        {
            "version": 1,
            "s3_key": "k1",
            "created_at": "t1",
            "edit_summary": "b",
            "source": "revert",
        },
    ]
    patches = _install(fake, convo)
    _enter(patches)
    try:
        resp = asyncio.run(
            conversation.list_dashboard_versions(
                conversation_id="c1",
                dashboard_id="dash_1",
                project_id="project_1",
                user_id="user_1",
            )
        )
    finally:
        _exit(patches)
    assert resp.dashboard_id == "dash_1"
    assert resp.current_version == 1
    assert [v.version for v in resp.versions] == [0, 1]
    assert resp.versions[1].source == "revert"


# ---------------------------------------------------------------------------
# Get version data
# ---------------------------------------------------------------------------


def test_get_version_returns_snapshot_data():
    fake = _FakeS3()
    fake.objects[("bucket", _V0_KEY)] = b'{"title": "snapshot v0"}'
    convo = _conversation_with_dashboard()
    convo["dashboards"][0]["versions"] = [
        {
            "version": 0,
            "s3_key": _V0_KEY,
            "created_at": "t0",
            "edit_summary": None,
            "source": "manual",
        }
    ]
    patches = _install(fake, convo)
    _enter(patches)
    try:
        resp = asyncio.run(
            conversation.get_dashboard_version(
                conversation_id="c1",
                dashboard_id="dash_1",
                version=0,
                project_id="project_1",
                user_id="user_1",
            )
        )
    finally:
        _exit(patches)
    assert resp.version == 0
    assert resp.dashboard_data == {"title": "snapshot v0"}


def test_get_missing_version_returns_404():
    fake = _FakeS3()
    convo = _conversation_with_dashboard()
    patches = _install(fake, convo)
    _enter(patches)
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                conversation.get_dashboard_version(
                    conversation_id="c1",
                    dashboard_id="dash_1",
                    version=99,
                    project_id="project_1",
                    user_id="user_1",
                )
            )
    finally:
        _exit(patches)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Revert (non-destructive)
# ---------------------------------------------------------------------------


def test_revert_restores_content_and_creates_new_head():
    fake = _FakeS3()
    convo = _conversation_with_dashboard()
    patches = _install(fake, convo)
    _enter(patches)
    try:
        # Save once: v0 captures "original", live becomes "edited".
        fake.objects[("bucket", _DASH_KEY)] = b'{"title": "original"}'
        asyncio.run(
            conversation.save_dashboard_data(
                conversation_id="c1",
                dashboard_id="dash_1",
                request=conversation.SaveDashboardDataRequest(
                    project_id="project_1", dashboard_data={"title": "edited"}
                ),
                user_id="user_1",
            )
        )
        # Revert to v0.
        resp = asyncio.run(
            conversation.revert_dashboard_version(
                conversation_id="c1",
                dashboard_id="dash_1",
                request=conversation.RevertRequest(
                    project_id="project_1", target_version=0
                ),
                user_id="user_1",
            )
        )
    finally:
        _exit(patches)

    assert resp.success is True
    assert resp.reverted_to == 0
    # Revert snapshotted the pre-revert "edited" state as v1 (new head).
    assert resp.new_version == 1
    # Live content restored to v0's "original".
    assert json.loads(fake.objects[("bucket", _DASH_KEY)]) == {"title": "original"}
    # v1 snapshot holds the pre-revert "edited" state (non-destructive).
    v1_key = "users/user_1/projects/project_1/dashboards/dash_1/versions/1.json"
    assert json.loads(fake.objects[("bucket", v1_key)]) == {"title": "edited"}
    assert len(convo["dashboards"][0]["versions"]) == 2


def test_revert_to_missing_version_returns_404():
    fake = _FakeS3()
    fake.objects[("bucket", _DASH_KEY)] = b'{"title": "original"}'
    convo = _conversation_with_dashboard()
    patches = _install(fake, convo)
    _enter(patches)
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                conversation.revert_dashboard_version(
                    conversation_id="c1",
                    dashboard_id="dash_1",
                    request=conversation.RevertRequest(
                        project_id="project_1", target_version=42
                    ),
                    user_id="user_1",
                )
            )
    finally:
        _exit(patches)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Ownership / missing conversation
# ---------------------------------------------------------------------------


def test_list_versions_wrong_owner_returns_403():
    fake = _FakeS3()
    convo = _conversation_with_dashboard()
    meta = _conversation_meta()
    meta["user_id"] = "someone_else"
    patches = _install(fake, convo, meta=meta)
    _enter(patches)
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                conversation.list_dashboard_versions(
                    conversation_id="c1",
                    dashboard_id="dash_1",
                    project_id="project_1",
                    user_id="user_1",
                )
            )
    finally:
        _exit(patches)
    assert exc.value.status_code == 403


def test_revert_missing_conversation_returns_404():
    fake = _FakeS3()
    convo = _conversation_with_dashboard()
    patches = _install(fake, convo, meta=None)
    # Override get_conversation to return None.
    patches[0] = patch.object(
        conversation.conversations_repo, "get_conversation", return_value=None
    )
    _enter(patches)
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                conversation.revert_dashboard_version(
                    conversation_id="c1",
                    dashboard_id="dash_1",
                    request=conversation.RevertRequest(
                        project_id="project_1", target_version=0
                    ),
                    user_id="user_1",
                )
            )
    finally:
        _exit(patches)
    assert exc.value.status_code == 404
