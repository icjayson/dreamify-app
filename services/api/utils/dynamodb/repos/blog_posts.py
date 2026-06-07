"""
DynamoDB repository for blog posts (global CMS content).

Schema:
  PK: post_id (String, UUID)
  GSI slug_index:    slug (HASH)                       — public detail lookups
  GSI listing_index: gsi_pk (HASH, const "POST") +
                     created_at (RANGE)                — newest-first listings
"""

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from boto3.dynamodb.conditions import Key  # type: ignore

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables

LISTING_INDEX = "listing_index"
SLUG_INDEX = "slug_index"
GSI_PK_VALUE = "POST"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_post(
    *,
    slug: str,
    title: str,
    description: str = "",
    content_html: str = "",
    content_json: Optional[Dict] = None,
    cover_image_url: Optional[str] = None,
    author: str = "Dreamify Team",
    persona: Optional[str] = None,
    tags: Optional[List[str]] = None,
    target_keyword: Optional[str] = None,
    status: str = "draft",
    reading_minutes: int = 1,
    published_at: Optional[str] = None,
    featured: bool = False,
    post_id: Optional[str] = None,
) -> Dict:
    table = get_table(tables.blog_posts)
    now = _now_iso()
    item: Dict = {
        "post_id": post_id or str(uuid.uuid4()),
        "gsi_pk": GSI_PK_VALUE,
        "slug": slug,
        "title": title,
        "description": description or "",
        "content_html": content_html or "",
        "content_json": content_json or {},
        "cover_image_url": cover_image_url,
        "author": author or "Dreamify Team",
        "persona": persona,
        "tags": tags or [],
        "target_keyword": target_keyword,
        "status": status,
        "reading_minutes": reading_minutes,
        "published_at": published_at if status == "published" else None,
        "featured": featured,
        "created_at": now,
        "updated_at": now,
    }
    table.put_item(Item=item)
    return item


def get_post(post_id: str) -> Optional[Dict]:
    table = get_table(tables.blog_posts)
    resp = table.get_item(Key={"post_id": post_id})
    return resp.get("Item")


def get_post_by_slug(slug: str) -> Optional[Dict]:
    table = get_table(tables.blog_posts)
    resp = table.query(
        IndexName=SLUG_INDEX,
        KeyConditionExpression=Key("slug").eq(slug),
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def list_all() -> List[Dict]:
    """Every post (drafts included), newest-first. Admin use."""
    table = get_table(tables.blog_posts)
    resp = table.query(
        IndexName=LISTING_INDEX,
        KeyConditionExpression=Key("gsi_pk").eq(GSI_PK_VALUE),
        ScanIndexForward=False,
    )
    return resp.get("Items", [])


def list_published() -> List[Dict]:
    """Published posts only, newest-first. Public use."""
    return [p for p in list_all() if p.get("status") == "published"]


def update_post(post_id: str, **fields) -> Optional[Dict]:
    """
    Update mutable fields on a post. Pass any of: slug, title, description,
    content_html, content_json, cover_image_url, author, persona, tags,
    target_keyword, status, reading_minutes, published_at.
    """
    table = get_table(tables.blog_posts)

    allowed = {
        "slug", "title", "description", "content_html", "content_json",
        "cover_image_url", "author", "persona", "tags", "target_keyword",
        "status", "reading_minutes", "published_at", "featured",
    }
    expr: List[str] = []
    names: Dict[str, str] = {}
    values: Dict[str, object] = {}
    for key, value in fields.items():
        if key not in allowed or value is None:
            continue
        expr.append(f"#{key} = :{key}")
        names[f"#{key}"] = key
        values[f":{key}"] = value

    if not expr:
        return get_post(post_id)

    expr.append("#updated_at = :updated_at")
    names["#updated_at"] = "updated_at"
    values[":updated_at"] = _now_iso()

    resp = table.update_item(
        Key={"post_id": post_id},
        UpdateExpression="SET " + ", ".join(expr),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes")


def set_featured(post_id: str) -> Optional[Dict]:
    """Mark one post as the featured post and clear the flag on all others
    (single-featured model used by the /blog hero)."""
    for p in list_all():
        pid = p["post_id"]
        is_target = pid == post_id
        if bool(p.get("featured")) != is_target:
            update_post(pid, featured=is_target)
    return get_post(post_id)


def delete_post(post_id: str) -> None:
    table = get_table(tables.blog_posts)
    table.delete_item(Key={"post_id": post_id})
