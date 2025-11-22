"""
Helpers for storing conversation JSON payloads in S3.
"""
import json
from typing import Any, Dict

from utils.s3.client import get_s3_client


def save_conversation(bucket: str, key: str, conversation: Dict[str, Any]) -> None:
    client = get_s3_client()
    payload = json.dumps(conversation, ensure_ascii=False).encode("utf-8")
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=payload,
        ContentType="application/json",
    )


def load_conversation(bucket: str, key: str) -> Dict[str, Any]:
    client = get_s3_client()
    response = client.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read()
    return json.loads(body.decode("utf-8"))


