"""
DynamoDB client helpers.
"""
from functools import lru_cache
from typing import Any

import boto3

from utils.config import config


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


