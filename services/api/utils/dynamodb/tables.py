"""
Centralized DynamoDB table name helpers.
"""
from dataclasses import dataclass

from utils.config import config


@dataclass(frozen=True)
class DynamoTables:
    projects: str = config.aws.dynamodb.PROJECTS_TABLE
    assets: str = config.aws.dynamodb.ASSETS_TABLE
    conversations: str = config.aws.dynamodb.CONVERSATIONS_TABLE
    workflow_status: str = config.aws.dynamodb.WORKFLOW_STATUS_TABLE
    dashboards: str = config.aws.dynamodb.DASHBOARDS_TABLE


tables = DynamoTables()


