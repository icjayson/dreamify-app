"""
DynamoDB repository for workflow node status tracking.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from boto3.dynamodb.conditions import Key

from utils.dynamodb.client import get_table
from utils.dynamodb.tables import tables
from utils.logger import logger

# DynamoDB rejects items over 400 KB. We guard well below that so the rest of
# the item (status, ids, other metadata) always has headroom and a completion
# write never fails because of an oversized analysis trail.
_METADATA_SIZE_LIMIT_BYTES = 300_000
# Per-step text fields are the usual culprits; trim them before dropping steps.
_STEP_FIELD_MAX_CHARS = 2_000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _metadata_byte_size(metadata: Dict[str, Any]) -> int:
    try:
        return len(json.dumps(metadata, default=str).encode("utf-8"))
    except (TypeError, ValueError):
        # Non-serializable metadata is the caller's problem, not ours — let the
        # put_item surface it rather than silently guessing a size.
        return 0


def _guard_metadata_size(
    metadata: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Shrink oversized metadata in place so DynamoDB accepts the write.

    Targets ``analysis_steps`` (the activity-transparency trail), which carries
    large ``python``/``output`` blobs. Trims those fields first, then drops the
    trail entirely as a last resort. Other metadata is left untouched.
    """
    if not metadata or _metadata_byte_size(metadata) <= _METADATA_SIZE_LIMIT_BYTES:
        return metadata

    steps = metadata.get("analysis_steps")
    if isinstance(steps, list) and steps:
        for step in steps:
            if not isinstance(step, dict):
                continue
            for field in ("output", "python"):
                value = step.get(field)
                if isinstance(value, str) and len(value) > _STEP_FIELD_MAX_CHARS:
                    step[field] = value[:_STEP_FIELD_MAX_CHARS] + "…[truncated]"
        if _metadata_byte_size(metadata) > _METADATA_SIZE_LIMIT_BYTES:
            logger.warning(
                "Workflow metadata still over %d bytes after trimming analysis_steps "
                "fields; dropping analysis_steps entirely.",
                _METADATA_SIZE_LIMIT_BYTES,
            )
            metadata.pop("analysis_steps", None)
        else:
            logger.warning(
                "Workflow metadata exceeded %d bytes; truncated analysis_steps "
                "python/output fields to fit.",
                _METADATA_SIZE_LIMIT_BYTES,
            )
    elif _metadata_byte_size(metadata) > _METADATA_SIZE_LIMIT_BYTES:
        logger.warning(
            "Workflow metadata exceeded %d bytes with no analysis_steps to trim; "
            "writing as-is and letting DynamoDB enforce its limit.",
            _METADATA_SIZE_LIMIT_BYTES,
        )
    return metadata


def upsert_node_status(
    conversation_id: str,
    node_id: str,
    status: str,
    metadata: Optional[Dict] = None,
) -> Dict:
    table = get_table(tables.workflow_status)
    item = {
        "conversation_id": conversation_id,
        "node_id": node_id,
        "status": status,
        "metadata": _guard_metadata_size(metadata) or {},
        "updated_at": _now_iso(),
    }
    logger.info(f"Upserting node status: {item}")
    table.put_item(Item=item)
    return item


def append_workflow_event(
    conversation_id: str,
    run_id: str,
    sequence: int,
    event: Dict[str, Any],
) -> Dict:
    table = get_table(tables.workflow_status)
    node_id = f"event#{run_id}#{sequence:06d}"
    now_iso = _now_iso()
    metadata = {
        **event,
        "id": event.get("id") or node_id,
        "run_id": event.get("run_id") or run_id,
        "sequence": int(event.get("sequence", sequence)),
        "updated_at": event.get("updated_at") or now_iso,
    }
    item = {
        "conversation_id": conversation_id,
        "node_id": node_id,
        "status": metadata.get("status", "completed"),
        "metadata": _guard_metadata_size(metadata) or {},
        "updated_at": now_iso,
    }
    logger.info(f"Appending workflow event: {item}")
    table.put_item(Item=item)
    return item


def list_nodes(conversation_id: str) -> List[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.query(
        KeyConditionExpression=Key("conversation_id").eq(conversation_id),
        ScanIndexForward=False,
    )
    return resp.get("Items", [])


def list_workflow_events(conversation_id: str) -> List[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.query(
        KeyConditionExpression=Key("conversation_id").eq(conversation_id)
        & Key("node_id").begins_with("event#"),
        ScanIndexForward=True,
    )
    items = resp.get("Items", [])
    return sorted(
        items,
        key=lambda item: (
            (item.get("metadata") or {}).get("started_at")
            or (item.get("metadata") or {}).get("updated_at")
            or item.get("updated_at")
            or "",
            (item.get("metadata") or {}).get("run_id") or "",
            int((item.get("metadata") or {}).get("sequence") or 0),
        ),
    )


def get_node(conversation_id: str, node_id: str) -> Optional[Dict]:
    table = get_table(tables.workflow_status)
    resp = table.get_item(Key={"conversation_id": conversation_id, "node_id": node_id})
    return resp.get("Item")
