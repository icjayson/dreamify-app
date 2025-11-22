from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Any, Dict

import boto3

from utils.config import config
from utils.logger import logger


@lru_cache(maxsize=1)
def _get_resource():
    if not config.aws or not config.aws.access_key:
        raise RuntimeError("AWS credentials missing for DynamoDB access")
    return boto3.resource(
        "dynamodb",
        region_name=config.aws.access_key.AWS_DEFAULT_REGION,
        aws_access_key_id=config.aws.access_key.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=config.aws.access_key.AWS_SECRET_ACCESS_KEY,
    )


def save_dashboard_metadata(
    user_id: str,
    project_id: str,
    conversation_id: str,
    dashboard_id: str,
    s3_bucket: str,
    s3_key: str,
    status: str = "ready",
    metadata: Dict[str, Any] | None = None,
) -> None:
    """
    Persist dashboard reference so backend/frontend can list it later.
    """
    if not config.aws or not config.aws.dynamodb:
        logger.warning("DynamoDB configuration missing, skip dashboard metadata persistence")
        return

    table_name = config.aws.dynamodb.DASHBOARDS_TABLE
    table = _get_resource().Table(table_name)
    item = {
        "project_id": project_id,
        "dashboard_id": dashboard_id,
        "conversation_id": conversation_id,
        "user_id": user_id,
        "s3_bucket": s3_bucket,
        "s3_key": s3_key,
        "status": status,
        "metadata": metadata or {},
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    table.put_item(Item=item)

