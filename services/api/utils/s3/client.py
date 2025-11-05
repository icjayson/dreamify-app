"""
S3 client utilities for file operations.
"""
import boto3
import hashlib
from typing import Optional, BinaryIO
from botocore.exceptions import ClientError
import logging

logger = logging.getLogger(__name__)


def get_s3_client():
    """Get configured S3 client."""
    return boto3.client(
        's3',
        aws_access_key_id=None,  # Will use environment variables set by config
        aws_secret_access_key=None,
        region_name=None
    )


def upload_bytes(
    bucket: str,
    key: str,
    data: bytes,
    content_type: Optional[str] = None,
    metadata: Optional[dict] = None
) -> dict:
    """
    Upload bytes to S3.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        data: File data as bytes
        content_type: Content type (e.g., 'text/csv')
        metadata: Optional metadata dict
        
    Returns:
        dict with 'etag' and optionally 'version_id'
    """
    s3_client = get_s3_client()
    
    extra_args = {}
    if content_type:
        extra_args['ContentType'] = content_type
    if metadata:
        extra_args['Metadata'] = metadata
    
    try:
        response = s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            **extra_args
        )
        
        return {
            'etag': response.get('ETag', '').strip('"'),
            'version_id': response.get('VersionId')
        }
    except ClientError as e:
        logger.error(f"S3 upload error: {str(e)}")
        raise


def download_bytes(bucket: str, key: str) -> bytes:
    """
    Download bytes from S3.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        File data as bytes
    """
    s3_client = get_s3_client()
    
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        return response['Body'].read()
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            raise FileNotFoundError(f"Object not found: s3://{bucket}/{key}")
        logger.error(f"S3 download error: {str(e)}")
        raise


def head_object(bucket: str, key: str) -> Optional[dict]:
    """
    Get object metadata without downloading.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        dict with metadata or None if not found
    """
    s3_client = get_s3_client()
    
    try:
        response = s3_client.head_object(Bucket=bucket, Key=key)
        return {
            'content_length': response.get('ContentLength'),
            'content_type': response.get('ContentType'),
            'etag': response.get('ETag', '').strip('"'),
            'last_modified': response.get('LastModified')
        }
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            return None
        logger.error(f"S3 head_object error: {str(e)}")
        raise


def object_exists(bucket: str, key: str) -> bool:
    """Check if object exists in S3."""
    return head_object(bucket, key) is not None


def delete_object(bucket: str, key: str) -> bool:
    """
    Delete object from S3.
    
    Returns:
        True if deleted, False if not found
    """
    s3_client = get_s3_client()
    
    try:
        s3_client.delete_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            return False
        logger.error(f"S3 delete error: {str(e)}")
        raise


def compute_sha256_checksum(data: bytes) -> str:
    """Compute SHA-256 checksum of data."""
    return hashlib.sha256(data).hexdigest()

