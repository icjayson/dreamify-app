"""Idempotent bootstrap data from versioned, non-secret fixtures."""

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.errors import ApiError
from app.platform.models import (
    AppUser,
    Asset,
    BlogPost,
    Conversation,
    Dashboard,
    DashboardVersion,
    Project,
    ProjectMember,
    StoredObject,
    WorkflowSlot,
)
from app.platform.storage import ObjectStorage, StorageMetadata
from app.platform.support_services import reading_minutes

BLOG_SEED_PATH = Path(__file__).with_name("data") / "blog_seed.json"
DEMO_CSV_PATH = Path(__file__).with_name("data") / "demo_sales.csv"
BLOG_DEMO_NOTICE = (
    '<aside data-dreamify-notice="hobby-demo"><strong>Hobby demo notice:</strong> '
    "This historical article predates the Free preview. In this deployment, file "
    "upload is available; billing, external connectors, scheduled delivery, and "
    "paid plans are disabled.</aside>"
)

DEMO_USER_ID = "demo_user"
DEMO_PROJECT_ID = "project-demo"
DEMO_PROJECT_MEMBER_ID = "project-member-demo-owner"
DEMO_STORED_OBJECT_ID = "object-demo-sales"
DEMO_ASSET_ID = "asset-demo-sales"
DEMO_CONVERSATION_ID = "conversation-demo"
DEMO_DASHBOARD_ID = "dashboard-demo"
DEMO_DASHBOARD_VERSION_ID = "dashboard-version-demo-1"
DEMO_CSV_CONTENT_TYPE = "text/csv"
DEMO_CSV_BYTES = DEMO_CSV_PATH.read_bytes()
DEMO_CSV_SHA256 = hashlib.sha256(DEMO_CSV_BYTES).hexdigest()
DEMO_CSV_PATHNAME = (
    f"seed/{DEMO_USER_ID}/assets/{DEMO_ASSET_ID}/{DEMO_CSV_SHA256}/sales.csv"
)
DEMO_CREATED_AT = datetime(2026, 1, 1, tzinfo=timezone.utc)
DEMO_DASHBOARD_CONTENT = {
    "id": DEMO_DASHBOARD_ID,
    "title": "Sales overview",
    "theme_id": "default",
    "layout": {"type": "grid", "grid_columns": 24},
    "components": [
        {
            "id": "metric-revenue",
            "type": "metric",
            "position": {"x": 0, "y": 0, "width": 6, "height": 2},
            "component_config": {
                "id": "metric-revenue-config",
                "title": "Total revenue",
                "value": 7100,
                "trend": "up",
            },
        },
        {
            "id": "chart-revenue",
            "type": "chart",
            "position": {"x": 0, "y": 2, "width": 12, "height": 8},
            "component_config": {
                "id": "chart-revenue-config",
                "type": "line",
                "title": "Revenue trend",
                "datasets": [
                    {
                        "label": "Revenue",
                        "data": [
                            {"label": "2026-01", "value": 2200},
                            {"label": "2026-02", "value": 2400},
                            {"label": "2026-03", "value": 2500},
                        ],
                    }
                ],
            },
        },
    ],
}


def _blog_seed() -> list[dict]:
    records = json.loads(BLOG_SEED_PATH.read_text(encoding="utf-8"))
    if not isinstance(records, list) or len(records) != 8:
        raise RuntimeError("The versioned blog seed must contain exactly eight posts")
    return records


def seed_blog_posts(session: Session) -> None:
    existing = set(session.scalars(select(BlogPost.slug)).all())
    feature_first = not existing
    for index, record in enumerate(_blog_seed()):
        if record["slug"] in existing:
            continue
        published_at = datetime.fromisoformat(record["published_at"]).replace(
            tzinfo=timezone.utc
        )
        session.add(
            BlogPost(
                id=str(uuid5(NAMESPACE_URL, f"dreamify-blog:{record['slug']}")),
                slug=record["slug"],
                title=record["title"],
                description=record["description"],
                content_html=BLOG_DEMO_NOTICE + record["content_html"],
                content_json=None,
                cover_image_url=record.get("cover_image_url"),
                cover_image_alt=None,
                author=record["author"],
                persona=record.get("persona"),
                tags=["historical"],
                target_keyword=record.get("target_keyword"),
                status=record["status"],
                reading_minutes=reading_minutes(
                    BLOG_DEMO_NOTICE + record["content_html"]
                ),
                published_at=published_at,
                featured=feature_first and index == 0,
                created_at=published_at,
                updated_at=published_at,
            )
        )


def _metadata_matches_demo(metadata: StorageMetadata) -> bool:
    return (
        metadata.pathname == DEMO_CSV_PATHNAME
        and metadata.content_type == DEMO_CSV_CONTENT_TYPE
        and metadata.size_bytes == len(DEMO_CSV_BYTES)
        and metadata.checksum_sha256 == DEMO_CSV_SHA256
    )


def _persist_demo_csv(storage: ObjectStorage) -> StorageMetadata:
    try:
        metadata = storage.head(DEMO_CSV_PATHNAME, verify_checksum=True)
    except ApiError as error:
        if error.code not in {"OBJECT_NOT_FOUND", "UPLOAD_INCOMPLETE"}:
            raise
        metadata = storage.put_bytes(
            DEMO_CSV_PATHNAME,
            DEMO_CSV_BYTES,
            DEMO_CSV_CONTENT_TYPE,
            overwrite=False,
        )
    if not _metadata_matches_demo(metadata):
        raise RuntimeError(
            "The demo CSV object does not match its immutable checksum address"
        )
    return metadata


def _seed_demo_identity(session: Session) -> None:
    if session.get(AppUser, DEMO_USER_ID) is None:
        session.add(
            AppUser(
                id=DEMO_USER_ID,
                email="demo@dreamify.invalid",
                display_name="Dreamify Demo",
                status="active",
                created_at=DEMO_CREATED_AT,
                updated_at=DEMO_CREATED_AT,
            )
        )
        session.flush()
    if session.get(Project, DEMO_PROJECT_ID) is None:
        session.add(
            Project(
                id=DEMO_PROJECT_ID,
                owner_id=DEMO_USER_ID,
                name="Sales overview demo",
                description=(
                    "Deterministic CSV analysis workspace for the Free preview."
                ),
                created_at=DEMO_CREATED_AT,
                updated_at=DEMO_CREATED_AT,
            )
        )
        session.flush()
    if session.get(ProjectMember, DEMO_PROJECT_MEMBER_ID) is None:
        session.add(
            ProjectMember(
                id=DEMO_PROJECT_MEMBER_ID,
                project_id=DEMO_PROJECT_ID,
                user_id=DEMO_USER_ID,
                role="owner",
                status="active",
                created_at=DEMO_CREATED_AT,
                updated_at=DEMO_CREATED_AT,
            )
        )
        session.flush()


def _seed_demo_stored_object(
    session: Session, metadata: StorageMetadata, storage_backend: str
) -> None:
    stored_object = session.get(StoredObject, DEMO_STORED_OBJECT_ID)
    if stored_object is None:
        stored_object = StoredObject(
            id=DEMO_STORED_OBJECT_ID,
            owner_id=DEMO_USER_ID,
            backend=storage_backend,
            pathname=DEMO_CSV_PATHNAME,
            url=metadata.url,
            content_type=DEMO_CSV_CONTENT_TYPE,
            size_bytes=len(DEMO_CSV_BYTES),
            checksum_sha256=DEMO_CSV_SHA256,
            etag=metadata.etag,
            created_at=DEMO_CREATED_AT,
        )
        session.add(stored_object)
    else:
        stored_object.backend = storage_backend
        stored_object.pathname = DEMO_CSV_PATHNAME
        stored_object.url = metadata.url
        stored_object.content_type = DEMO_CSV_CONTENT_TYPE
        stored_object.size_bytes = len(DEMO_CSV_BYTES)
        stored_object.checksum_sha256 = DEMO_CSV_SHA256
        stored_object.etag = metadata.etag
    session.flush()


def _seed_demo_asset(session: Session) -> None:
    if session.get(Asset, DEMO_ASSET_ID) is None:
        session.add(
            Asset(
                id=DEMO_ASSET_ID,
                owner_id=DEMO_USER_ID,
                project_id=DEMO_PROJECT_ID,
                stored_object_id=DEMO_STORED_OBJECT_ID,
                filename="sales.csv",
                asset_type="dataset",
                content_type=DEMO_CSV_CONTENT_TYPE,
                size_bytes=len(DEMO_CSV_BYTES),
                status="ready",
                created_at=DEMO_CREATED_AT,
                updated_at=DEMO_CREATED_AT,
            )
        )
        session.flush()


def _seed_demo_outputs(session: Session) -> None:
    if session.get(Conversation, DEMO_CONVERSATION_ID) is None:
        session.add(
            Conversation(
                id=DEMO_CONVERSATION_ID,
                owner_id=DEMO_USER_ID,
                project_id=DEMO_PROJECT_ID,
                title="Analyze all sales data and build a dashboard",
                created_at=DEMO_CREATED_AT,
                updated_at=DEMO_CREATED_AT,
            )
        )
        session.flush()
    if session.get(Dashboard, DEMO_DASHBOARD_ID) is None:
        session.add(
            Dashboard(
                id=DEMO_DASHBOARD_ID,
                owner_id=DEMO_USER_ID,
                project_id=DEMO_PROJECT_ID,
                conversation_id=DEMO_CONVERSATION_ID,
                title="Sales overview",
                status="ready",
                current_version=1,
                content=deepcopy(DEMO_DASHBOARD_CONTENT),
                created_at=DEMO_CREATED_AT,
                updated_at=DEMO_CREATED_AT,
            )
        )
        session.flush()
    if session.get(DashboardVersion, DEMO_DASHBOARD_VERSION_ID) is None:
        session.add(
            DashboardVersion(
                id=DEMO_DASHBOARD_VERSION_ID,
                dashboard_id=DEMO_DASHBOARD_ID,
                version=1,
                content=deepcopy(DEMO_DASHBOARD_CONTENT),
                source="seed",
                edit_summary="Deterministic Free preview baseline",
                created_at=DEMO_CREATED_AT,
            )
        )
        session.flush()


def seed_demo_workspace(session: Session, storage: ObjectStorage) -> None:
    metadata = _persist_demo_csv(storage)
    _seed_demo_identity(session)
    _seed_demo_stored_object(session, metadata, storage.backend)
    _seed_demo_asset(session)
    _seed_demo_outputs(session)


def seed_database(
    session: Session, storage: ObjectStorage, workflow_slot_count: int = 2
) -> None:
    existing = set(session.scalars(select(WorkflowSlot.slot_number)).all())
    for slot_number in range(1, workflow_slot_count + 1):
        if slot_number not in existing:
            session.add(WorkflowSlot(slot_number=slot_number))
    seed_blog_posts(session)
    seed_demo_workspace(session, storage)
    session.flush()
