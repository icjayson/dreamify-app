"""
Utility script to create DynamoDB tables used by Dreamify backend.

Usage:
    python -m utils.dynamodb.create_table            # create all tables
    python -m utils.dynamodb.create_table assets    # create single table by name
"""
from __future__ import annotations

import argparse
import sys
from typing import Dict, Optional

from botocore.exceptions import ClientError  # type: ignore

from utils.config import config
from utils.dynamodb.client import get_dynamodb_resource
from utils.dynamodb.tables import tables


def _table_exists(resource, name: str) -> bool:
    try:
        resource.meta.client.describe_table(TableName=name)
        return True
    except ClientError as exc:
        error_code = exc.response["Error"]["Code"]
        if error_code == "ResourceNotFoundException":
            return False
        raise


def _create_table(resource, name: str, spec: Dict) -> None:
    if _table_exists(resource, name):
        print(f"[skip] Table '{name}' already exists")
        return

    print(f"[create] Creating table '{name}'...")
    resource.create_table(
        TableName=name,
        BillingMode="PAY_PER_REQUEST",
        **spec,
    )
    waiter = resource.meta.client.get_waiter("table_exists")
    waiter.wait(TableName=name)
    print(f"[done] Table '{name}' created")


def get_table_specs() -> Dict[str, Dict]:
    """
    Return table specifications keyed by logical table name.
    """
    return {
        tables.projects: {
            "KeySchema": [
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "project_id", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "user_id", "AttributeType": "S"},
                {"AttributeName": "project_id", "AttributeType": "S"},
            ],
        },
        tables.assets: {
            "KeySchema": [
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "asset_id", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "user_id", "AttributeType": "S"},
                {"AttributeName": "asset_id", "AttributeType": "S"},
            ],
            "GlobalSecondaryIndexes": [
                {
                    "IndexName": "asset_id_index",
                    "KeySchema": [
                        {"AttributeName": "asset_id", "KeyType": "HASH"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        },
        tables.conversations: {
            "KeySchema": [
                {"AttributeName": "project_id", "KeyType": "HASH"},
                {"AttributeName": "conversation_id", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "project_id", "AttributeType": "S"},
                {"AttributeName": "conversation_id", "AttributeType": "S"},
            ],
        },
        tables.workflow_status: {
            "KeySchema": [
                {"AttributeName": "conversation_id", "KeyType": "HASH"},
                {"AttributeName": "node_id", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "conversation_id", "AttributeType": "S"},
                {"AttributeName": "node_id", "AttributeType": "S"},
            ],
        },
        tables.dashboards: {
            "KeySchema": [
                {"AttributeName": "project_id", "KeyType": "HASH"},
                {"AttributeName": "dashboard_id", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "project_id", "AttributeType": "S"},
                {"AttributeName": "dashboard_id", "AttributeType": "S"},
                {"AttributeName": "conversation_id", "AttributeType": "S"},
            ],
            "GlobalSecondaryIndexes": [
                {
                    "IndexName": "conversation_id_index",
                    "KeySchema": [
                        {"AttributeName": "conversation_id", "KeyType": "HASH"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        },
    }


def create_tables(target: Optional[str] = None) -> None:
    resource = get_dynamodb_resource()
    specs = get_table_specs()

    if target:
        name_map = {n.split("/")[-1]: n for n in specs.keys()}
        resolved = name_map.get(target) or specs.get(target) and target
        if not resolved:
            raise ValueError(f"Unknown table '{target}'. Available: {', '.join(name_map.keys())}")
        _create_table(resource, resolved, specs[resolved])
        return

    for name, spec in specs.items():
        _create_table(resource, name, spec)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Create DynamoDB tables for Dreamify backend")
    parser.add_argument(
        "table",
        nargs="?",
        help="Optional table name (logical name without prefixes). If omitted, creates all tables.",
    )
    args = parser.parse_args(argv)

    try:
        create_tables(args.table)
    except Exception as exc:
        print(f"[error] {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())


