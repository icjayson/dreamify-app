"""
S3 path generation utilities.
"""
from typing import Optional
import uuid


def build_asset_key(
    version: str,
    user_id: str,
    project_id: str,
    asset_id: str,
    file_id: str,
    extension: str
) -> str:
    """
    Build S3 key for asset file.
    
    Structure: v1/users/{user_id}/projects/{project_id}/assets/{asset_id}/{file_id}.{ext}
    """
    return f"{version}/users/{user_id}/projects/{project_id}/assets/{asset_id}/{file_id}.{extension}"


def build_metadata_key(
    version: str,
    user_id: str,
    project_id: str,
    asset_id: str,
    file_id: str
) -> str:
    """
    Build S3 key for metadata JSON file.
    
    Structure: v1/users/{user_id}/projects/{project_id}/assets/{asset_id}/metadata/{file_id}.json
    """
    return f"{version}/users/{user_id}/projects/{project_id}/assets/{asset_id}/metadata/{file_id}.json"


def build_processed_json_key(
    version: str,
    user_id: str,
    project_id: str,
    asset_id: str,
    file_id: str
) -> str:
    """
    Build S3 key for processed JSON file.
    
    Structure: v1/users/{user_id}/projects/{project_id}/assets/{asset_id}/processed/{file_id}.json
    """
    return f"{version}/users/{user_id}/projects/{project_id}/assets/{asset_id}/processed/{file_id}.json"

