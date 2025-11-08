"""
S3 client utilities for file operations.
"""
import boto3
from typing import Optional
from botocore.exceptions import ClientError
from utils.logger import logger
import os

def get_s3_client():
    """Get configured S3 client."""
    # Get AWS credentials from environment variables first, then try config
    aws_access_key_id = os.getenv('AWS_ACCESS_KEY_ID')
    aws_secret_access_key = os.getenv('AWS_SECRET_ACCESS_KEY')
    aws_region = os.getenv('AWS_DEFAULT_REGION', 'ap-southeast-1')
    
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
        except Exception as e:
            logger.warning(f"Failed to load AWS credentials from config: {str(e)}")
    
    # If still not found, boto3 will use default credentials chain (IAM role, etc.)
    if aws_access_key_id and aws_secret_access_key:
        return boto3.client(
            's3',
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            region_name=aws_region
        )
    else:
        # Use default credentials chain
        logger.warning("AWS credentials not found in environment or config, using default credentials chain")
        return boto3.client('s3', region_name=aws_region)


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

