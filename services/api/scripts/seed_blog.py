"""
One-time seed: import the original static blog posts into DynamoDB.

The frontend export step produces a JSON file from src/content/blog:
    cd dreamify-frontend/frontend && node scripts/export-blog-seed.mjs

Then run this against that JSON (idempotent on slug — existing posts are skipped):
    python -m scripts.seed_blog /path/to/dreamify-frontend/frontend/scripts/blog-seed.json

If no path is given, a few common relative locations are tried.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import List

from utils.dynamodb.repos import blog_posts as blog_repo


def _reading_minutes(content_html: str) -> int:
    text = re.sub(r"<[^>]+>", " ", content_html or "")
    return max(1, round(len(text.split()) / 200))


def _default_seed_paths() -> List[Path]:
    here = Path(__file__).resolve()
    repo_root = here.parents[1]  # dreamify-backend/
    candidates = [
        repo_root.parent / "dreamify-frontend" / "frontend" / "scripts" / "blog-seed.json",
        repo_root / "scripts" / "blog-seed.json",
    ]
    return candidates


def _resolve_seed_file(argv: List[str]) -> Path:
    if len(argv) > 1:
        p = Path(argv[1])
        if not p.exists():
            raise FileNotFoundError(f"Seed file not found: {p}")
        return p
    for cand in _default_seed_paths():
        if cand.exists():
            return cand
    raise FileNotFoundError(
        "No blog-seed.json found. Generate it first with "
        "`node scripts/export-blog-seed.mjs` in the frontend, or pass a path."
    )


def main(argv: List[str]) -> int:
    seed_file = _resolve_seed_file(argv)
    print(f"[seed] Reading {seed_file}")
    posts = json.loads(seed_file.read_text(encoding="utf-8"))

    created = 0
    skipped = 0
    for p in posts:
        slug = p["slug"]
        if blog_repo.get_post_by_slug(slug):
            print(f"[skip] '{slug}' already exists")
            skipped += 1
            continue
        blog_repo.create_post(
            slug=slug,
            title=p["title"],
            description=p.get("description", ""),
            content_html=p.get("content_html", ""),
            cover_image_url=p.get("cover_image_url"),
            author=p.get("author") or "Dreamify Team",
            persona=p.get("persona"),
            target_keyword=p.get("target_keyword"),
            status="published",
            reading_minutes=_reading_minutes(p.get("content_html", "")),
            published_at=p.get("published_at"),
        )
        print(f"[create] '{slug}'")
        created += 1

    print(f"[done] created={created} skipped={skipped} total={len(posts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
