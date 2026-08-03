"""Run idempotent platform seed data after Alembic migrations."""

import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


def main() -> None:
    from app.platform.database import Database
    from app.platform.seed import seed_database
    from app.platform.settings import get_settings
    from app.platform.storage import create_storage

    settings = get_settings()
    database = Database(settings)
    storage = create_storage(settings)
    try:
        with database.session() as session:
            seed_database(session, storage, settings.workflow_slot_count)
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
