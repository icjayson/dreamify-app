"""
DynamoDB client helpers.
"""

from decimal import Decimal
from functools import lru_cache
from typing import Any

import boto3

from utils.config import config


def floats_to_decimal(obj: Any) -> Any:
    """
    Recursively convert floats to Decimal so values are accepted by the boto3
    DynamoDB resource API (which rejects Python ``float``). Uses ``str`` to avoid
    binary float-precision artefacts. Reads come back as Decimal — callers that
    need floats should coerce on read.
    """
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: floats_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [floats_to_decimal(v) for v in obj]
    return obj


@lru_cache(maxsize=1)
def get_dynamodb_resource() -> Any:
    """
    Return a cached boto3 DynamoDB resource configured for our AWS account.
    """
    return boto3.resource(
        "dynamodb",
        region_name=config.aws.access_key.AWS_DEFAULT_REGION,
    )


def get_dynamodb_client() -> Any:
    """
    Return a cached boto3 DynamoDB client.
    """
    return boto3.client(
        "dynamodb",
        region_name=config.aws.access_key.AWS_DEFAULT_REGION,
    )


def get_table(table_name: str):
    """
    Convenience helper to fetch a Table resource by name.
    """
    return get_dynamodb_resource().Table(table_name)
