"""
S3 path generation utilities.
"""
from typing import Optional
import uuid


def build_asset_key(
    user_id: str,
    project_id: str,
    asset_id: str,
    file_id: str,
    extension: str
) -> str:
    """
    Build S3 key for asset file.
    
    Structure: users/{user_id}/projects/{project_id}/assets/{asset_id}/{file_id}.{ext}
    """
    return f"users/{user_id}/projects/{project_id}/assets/{asset_id}/{file_id}.{extension}"


def build_metadata_key(
    user_id: str,
    project_id: str,
    asset_id: str,
    file_id: str
) -> str:
    """
    Build S3 key for metadata JSON file.
    
    Structure: users/{user_id}/projects/{project_id}/assets/{asset_id}/metadata/{file_id}.json
    """
    return f"users/{user_id}/projects/{project_id}/assets/{asset_id}/metadata/{file_id}.json"


def build_processed_json_key(
    user_id: str,
    project_id: str,
    asset_id: str,
    file_id: str
) -> str:
    """
    Build S3 key for processed JSON file.
    
    Structure: users/{user_id}/projects/{project_id}/assets/{asset_id}/processed/{file_id}.json
    """
    return f"users/{user_id}/projects/{project_id}/assets/{asset_id}/processed/{file_id}.json"


def build_conversation_dir(
    user_id: str,
    project_id: str,
    conversation_id: str,
) -> str:
    """
    Base directory for conversation artifacts.
    Structure: users/{user_id}/projects/{project_id}/conversations/{conversation_id}
    """
    return f"users/{user_id}/projects/{project_id}/conversations/{conversation_id}"


def build_conversation_key(
    user_id: str,
    project_id: str,
    conversation_id: str,
    backup: bool = False,
) -> str:
    """
    Conversation JSON (primary or backup).
    - primary: .../conversation.json
    - backup:  .../conversation.backup.json
    """
    suffix = "conversation.backup.json" if backup else "conversation.json"
    base = build_conversation_dir(user_id, project_id, conversation_id)
    return f"{base}/{suffix}"


def build_dashboard_key(
    user_id: str,
    project_id: str,
    dashboard_id: str,
) -> str:
    """
    Dashboard JSON path.
    Structure: users/{user_id}/projects/{project_id}/dashboards/{dashboard_id}.json
    """
    return f"users/{user_id}/projects/{project_id}/dashboards/{dashboard_id}.json"

