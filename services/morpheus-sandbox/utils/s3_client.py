"""
S3 client utilities for file operations.
"""
import boto3
from typing import Optional
from botocore.exceptions import ClientError
from utils.logger import logger
import os

def _mask_credential(value: Optional[str]) -> str:
    if not value:
        return "missing"
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}***{value[-4:]}"

def get_s3_client():
    """Get configured S3 client."""
    # Check HOME directory for potential issues
    home_dir = os.getenv('HOME')
    if home_dir:
        if not os.path.exists(home_dir):
            logger.warning(f"HOME environment variable points to non-existent directory: {home_dir}")
        elif not os.access(home_dir, os.R_OK):
            logger.warning(f"HOME environment variable points to non-readable directory: {home_dir}")
    
    # Get AWS credentials from environment variables first, then try config
    aws_access_key_id = os.getenv('AWS_ACCESS_KEY_ID')
    aws_secret_access_key = os.getenv('AWS_SECRET_ACCESS_KEY')
    aws_region = os.getenv('AWS_DEFAULT_REGION', 'ap-southeast-1')
    credential_source = "environment"
    
    # If not in environment, try to load from config (if available)
    if not aws_access_key_id or not aws_secret_access_key:
        try:
            from utils.config import config
            if config.aws and config.aws.access_key:
                if not aws_access_key_id:
                    aws_access_key_id = config.aws.access_key.AWS_ACCESS_KEY_ID
                if not aws_secret_access_key:
                    aws_secret_access_key = config.aws.access_key.AWS_SECRET_ACCESS_KEY
                if not aws_region or aws_region == 'ap-southeast-1':  # Use config if default region
                    aws_region = config.aws.access_key.AWS_DEFAULT_REGION
                credential_source = "config"
                logger.info(
                    "Loaded AWS credentials from config file (access_key_id=%s)",
                    _mask_credential(aws_access_key_id),
                )
        except Exception as e:
            logger.warning(f"Failed to load AWS credentials from config: {str(e)}")
    
    # If still not found, raise descriptive error
    if aws_access_key_id and aws_secret_access_key:
        logger.info(
            "Using AWS credentials from %s (access_key_id=%s, region=%s)",
            credential_source,
            _mask_credential(aws_access_key_id),
            aws_region,
        )
        return boto3.client(
            's3',
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            region_name=aws_region
        )
    else:
        error_msg = (
            "AWS credentials not found in environment variables or config. "
            "Please export AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or populate config/config.yaml."
        )
        logger.error(error_msg)
        raise RuntimeError(error_msg)


def download_bytes(bucket: str, key: str) -> bytes:
    """
    Download bytes from S3.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        File data as bytes
    """
    try:
        s3_client = get_s3_client()
    except Exception as e:
        logger.error(f"Failed to create S3 client: {str(e)}")
        raise RuntimeError(f"Failed to initialize S3 client: {str(e)}") from e
    
    try:
        logger.info(f"Downloading from S3: s3://{bucket}/{key}")
        response = s3_client.get_object(Bucket=bucket, Key=key)
        data = response['Body'].read()
        logger.info(f"Successfully downloaded {len(data)} bytes from S3")
        return data
    except PermissionError as e:
        error_msg = f"Permission denied accessing S3 or credentials: {str(e)}"
        logger.error(error_msg)
        raise RuntimeError(error_msg) from e
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            raise FileNotFoundError(f"Object not found: s3://{bucket}/{key}")
        logger.error(f"S3 download error: {str(e)}")
        raise
    except Exception as e:
        error_msg = f"Unexpected error downloading from S3: {str(e)}"
        logger.error(error_msg)
        raise RuntimeError(error_msg) from e

