"""Generate or verify the canonical Dreamify API OpenAPI snapshot."""

import argparse
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.main import create_app  # noqa: E402
from app.platform.settings import Settings  # noqa: E402

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = REPOSITORY_ROOT / "packages" / "contracts" / "openapi.json"


def render_openapi() -> str:
    settings = Settings(
        app_env="test",
        database_url="sqlite:///:memory:",
        cors_origins=["https://app.example.test"],
        demo_auth_mode=True,
        storage_backend="local",
        workflow_dispatch_url="https://web.example.test/api/workflow/dispatch",
        internal_service_shared_secret="openapi-internal-service-secret",
    )
    schema = create_app(settings).openapi()
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when the committed snapshot differs from the runtime schema",
    )
    args = parser.parse_args()
    rendered = render_openapi()
    if args.check:
        if not SNAPSHOT_PATH.exists():
            print(f"OpenAPI snapshot is missing: {SNAPSHOT_PATH}")
            return 1
        if SNAPSHOT_PATH.read_text(encoding="utf-8") != rendered:
            print("OpenAPI snapshot is stale; run scripts/generate_openapi.py")
            return 1
        print("OpenAPI snapshot is current")
        return 0
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(rendered, encoding="utf-8")
    print(f"Wrote {SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
