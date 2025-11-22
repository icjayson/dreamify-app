from datetime import datetime
import json
import os
import tempfile
import time
import uuid
import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiohttp
import requests

from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
from utils.config import config
from utils.dynamodb import save_dashboard_metadata
from utils.health import check_health
from utils.logger import logger
from utils.s3_client import download_bytes, get_s3_client

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for request/response
class RunRequest(BaseModel):
    conversation_id: str
    conversation_uri: str
    conversation_backup_uri: Optional[str] = None
    project_id: str
    user_id: str


class StatusRequest(BaseModel):
    conversation_id: str
    project_id: str

# Backend API URL for updating file records
BACKEND_API_URL = "http://localhost:5001"

logger.info(
    "Config AWS credentials present: %s", "yes" if getattr(config, "aws", None) else "no"
)

def _parse_s3_key(s3_key: str) -> dict:
    """Parse S3 key to extract user/project/asset metadata."""
    clean_key = s3_key.lstrip("/")
    parts = clean_key.split("/")
    if not parts:
        raise ValueError(f"Invalid S3 key format: {s3_key}")
    if parts[0] == "v1":
        parts = parts[1:]
    if len(parts) < 7:
        raise ValueError(f"Invalid S3 key format: {s3_key}")
    if parts[0] != "users" or parts[2] != "projects" or parts[4] != "assets":
        raise ValueError(f"Unexpected S3 key structure: {s3_key}")

    user_id = parts[1]
    project_id = parts[3]
    asset_id = parts[5]
    filename = "/".join(parts[6:])

    if '.' in filename:
        file_id, extension = filename.rsplit('.', 1)
    else:
        file_id = filename
        extension = ""

    return {
        "user_id": user_id,
        "project_id": project_id,
        "asset_id": asset_id,
        "file_id": file_id,
        "extension": extension,
    }


def _build_processed_json_key(user_id: str, project_id: str, asset_id: str, file_id: str) -> str:
    """Build S3 key for processed JSON file."""
    return f"users/{user_id}/projects/{project_id}/assets/{asset_id}/processed/{file_id}.json"

def _upload_bytes_to_s3(bucket: str, key: str, data: bytes, content_type: str = 'application/json'):
    """Upload bytes to S3."""
    s3_client = get_s3_client()
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type
    )


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError(f"Invalid S3 URI: {uri}")
    without_scheme = uri[len("s3://") :]
    if "/" not in without_scheme:
        raise ValueError(f"Invalid S3 URI: {uri}")
    bucket, key = without_scheme.split("/", 1)
    return bucket, key.lstrip("/")


def _load_json_from_s3_uri(uri: str, max_retries: int = 3, initial_delay: float = 1.0) -> Dict[str, Any]:
    """
    Load JSON from S3 URI with retry logic for handling eventual consistency.
    
    Args:
        uri: S3 URI to load from
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay in seconds (doubles with each retry)
    
    Returns:
        Parsed JSON data as dictionary
    
    Raises:
        FileNotFoundError: If the object doesn't exist after all retries
    """
    bucket, key = _parse_s3_uri(uri)
    delay = initial_delay
    
    for attempt in range(max_retries + 1):
        try:
            payload = download_bytes(bucket, key)
            return json.loads(payload.decode("utf-8"))
        except FileNotFoundError:
            if attempt < max_retries:
                logger.warning(
                    f"Conversation not found at {uri}, retrying in {delay}s (attempt {attempt + 1}/{max_retries})"
                )
                time.sleep(delay)
                delay *= 2  # Exponential backoff
            else:
                logger.error(f"Conversation not found at {uri} after {max_retries + 1} attempts")
                raise


def _upload_json_to_s3_uri(uri: str, data: Dict[str, Any]):
    bucket, key = _parse_s3_uri(uri)
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    _upload_bytes_to_s3(bucket, key, body)


def _persist_conversation(primary_uri: str, backup_uri: Optional[str], payload: Dict[str, Any]):
    _upload_json_to_s3_uri(primary_uri, payload)
    if backup_uri:
        try:
            _upload_json_to_s3_uri(backup_uri, payload)
        except Exception as exc:
            logger.warning(f"Failed to update conversation backup: {exc}")


def _load_existing_dashboards(conversation: Dict[str, Any]) -> Dict[str, Any]:
    dashboards: Dict[str, Any] = {}
    for entry in conversation.get("dashboards", []):
        dash_id = entry.get("dashboard_id")
        uri = entry.get("s3_uri")
        if not dash_id or not uri:
            continue
        try:
            dashboards[dash_id] = _load_json_from_s3_uri(uri)
        except Exception as exc:
            logger.warning(f"Failed to load dashboard {dash_id}: {exc}")
    return dashboards




def _build_dashboard_key(user_id: str, project_id: str, dashboard_id: str) -> str:
    return f"users/{user_id}/projects/{project_id}/dashboards/{dashboard_id}.json"


def _save_dashboard_artifact(
    bucket: str,
    conversation: Dict[str, Any],
    dashboard_data: Dict[str, Any],
) -> Dict[str, Any]:
    user_id = conversation.get("user_id")
    project_id = conversation.get("project_id")
    conversation_id = conversation.get("conversation_id")
    if not user_id or not project_id or not conversation_id:
        raise ValueError("Conversation missing identifiers required for dashboard persistence")
    dashboard_id = str(uuid.uuid4())
    key = _build_dashboard_key(user_id, project_id, dashboard_id)
    payload = json.dumps(dashboard_data, ensure_ascii=False, indent=2).encode("utf-8")
    _upload_bytes_to_s3(bucket, key, payload)
    save_dashboard_metadata(
        user_id=user_id,
        project_id=project_id,
        conversation_id=conversation_id,
        dashboard_id=dashboard_id,
        s3_bucket=bucket,
        s3_key=key,
    )
    return {
        "dashboard_id": dashboard_id,
        "s3_bucket": bucket,
        "s3_key": key,
        "s3_uri": f"s3://{bucket}/{key}",
    }

async def _post_node_status(conversation_id: Optional[str], status: str, metadata: Optional[dict] = None):
    if not conversation_id:
        return
    try:
        logger.info(f"Posting node status: {conversation_id}, {status}, {metadata} to {BACKEND_API_URL}/api/v1/morpheus/workflow-status")
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{BACKEND_API_URL}/api/v1/morpheus/workflow-status",
                json={
                    "conversation_id": conversation_id,
                    "node_id": "workflow",
                    "status": status,
                    "metadata": metadata or {},
                },
            ) as response:
                if response.status != 200:
                    response_text = await response.text()
                    logger.error(
                        f"Failed to update node status: HTTP {response.status} - {response_text[:200]} "
                        f"(conversation_id={conversation_id}, status={status})"
                    )
                    raise Exception(f"Failed to update node status: HTTP {response.status} - {response_text[:200]} "
                        f"(conversation_id={conversation_id}, status={status})")
                return await response.json()
    except asyncio.TimeoutError:
        logger.warning(f"Timeout updating node status for conversation {conversation_id}")
        return None
    except aiohttp.ClientError as e:
        logger.warning(f"Failed to update node status: {e}")
        return None
    except Exception as e:
        logger.warning(f"Failed to update node status: {e}")
        return None


def _post_node_status_sync(conversation_id: Optional[str], status: str, metadata: Optional[dict] = None):
    """Synchronous wrapper for _post_node_status to use in background tasks."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(_post_node_status(conversation_id, status, metadata))


def _postprocess_workflow_to_conversation_nodes(workflow_output) -> List[Dict[str, Any]]:
    """Convert all workflow_output.messages into conversation nodes."""
    from morpheus.workflows.base import WorkflowMessage
    
    if not workflow_output or not hasattr(workflow_output, 'messages'):
        return []
    
    nodes = []
    for msg in workflow_output.messages:
        # Handle WorkflowMessage objects
        if isinstance(msg, dict):
            msg_type = msg.get("type", "unknown")
            msg_content = msg.get("content", "")
            msg_timestamp = msg.get("timestamp", datetime.utcnow())
            msg_tool_calls = msg.get("tool_calls")
            msg_tool_call_id = msg.get("tool_call_id")
        else:
            # Pydantic model access
            msg_type = getattr(msg, 'type', 'unknown')
            msg_content = getattr(msg, 'content', '')
            msg_timestamp = getattr(msg, 'timestamp', datetime.utcnow())
            msg_tool_calls = getattr(msg, 'tool_calls', None)
            msg_tool_call_id = getattr(msg, 'tool_call_id', None)
        
        # Map message types to conversation roles
        role_map = {
            "human": "user",
            "ai": "assistant",
            "system": "system",
            "tool": "assistant",
        }
        role = role_map.get(msg_type, "assistant")
        
        # Get timestamp as ISO string
        if isinstance(msg_timestamp, str):
            timestamp_iso = msg_timestamp
        elif hasattr(msg_timestamp, 'isoformat'):
            timestamp_iso = msg_timestamp.isoformat()
        else:
            timestamp_iso = datetime.utcnow().isoformat()
        
        # Build node
        node = {
            "node_id": f"node_{uuid.uuid4().hex[:8]}",
            "role": role,
            "status": "completed",
            "created_at": timestamp_iso,
            "contents": [
                {
                    "type": "text",
                    "data": {
                        "text": str(msg_content),
                    },
                }
            ],
        }
        
        # Add metadata for tool calls if present
        metadata = {}
        if msg_tool_calls:
            metadata["tool_calls"] = msg_tool_calls
        if msg_tool_call_id:
            metadata["tool_call_id"] = msg_tool_call_id
        
        if metadata:
            node["metadata"] = metadata
        
        nodes.append(node)
    
    return nodes


def _process_conversation_background(
    conversation_id: str,
    conversation_uri: str,
    conversation_backup_uri: Optional[str],
    project_id: str,
    user_id: str,
):
    """Background processing function for workflow execution."""
    temp_file_path = None
    processed_json_s3_key = None
    conversation: Optional[Dict[str, Any]] = None
    conversation_bucket: Optional[str] = None

    try:
        logger.info(f"Starting workflow for conversation {conversation_id}")
        _post_node_status_sync(conversation_id, "processing", {"step": "load_conversation"})

        try:
            conversation = _load_json_from_s3_uri(conversation_uri)
        except FileNotFoundError as e:
            error_msg = f"Conversation not found in S3: {conversation_uri}. The conversation may not have been saved yet or there was an S3 consistency delay."
            logger.error(error_msg)
            _post_node_status_sync(
                conversation_id,
                "error",
                {
                    "step": "load_conversation",
                    "error": error_msg,
                    "conversation_uri": conversation_uri,
                },
            )
            return

        conversation_bucket, _ = _parse_s3_uri(conversation_uri)
        dashboards_cache = _load_existing_dashboards(conversation)

        metadata = conversation.get("metadata", {})
        asset_info = metadata.get("asset") or {}
        asset_bucket = asset_info.get("s3_bucket")
        asset_key = asset_info.get("s3_key")
        file_ext = (asset_info.get("extension") or "csv").lstrip(".")
        file_identifier = asset_info.get("file_id") or asset_info.get("asset_id") or conversation_id

        if not asset_bucket or not asset_key:
            error_msg = "Conversation metadata missing asset reference"
            logger.error(error_msg)
            _post_node_status_sync(
                conversation_id,
                "error",
                {
                    "step": "validate_asset",
                    "error": error_msg,
                },
            )
            return

        _post_node_status_sync(conversation_id, "processing", {"step": "download_asset"})
        logger.info(f"Downloading asset for conversation {conversation_id}: s3://{asset_bucket}/{asset_key}")
        file_content = download_bytes(asset_bucket, asset_key)

        temp_dir = tempfile.gettempdir()
        temp_file_path = os.path.join(temp_dir, f"{file_identifier}.{file_ext}")
        with open(temp_file_path, "wb") as handle:
            handle.write(file_content)

        workflow = AnalyzeCSVWorkflow()
        _post_node_status_sync(conversation_id, "processing", {"step": "run_workflow"})
        result = workflow.execute(
            file_path=temp_file_path,
            conversation=conversation,
            dashboards=dashboards_cache,
        )
        
        # Postprocess workflow messages into conversation nodes
        workflow_output = result.get("workflow_output")
        if workflow_output:
            postprocessed_nodes = _postprocess_workflow_to_conversation_nodes(workflow_output)
            conversation.setdefault("nodes", []).extend(postprocessed_nodes)

        file_size = os.path.getsize(temp_file_path) if os.path.exists(temp_file_path) else 0
        key_parts = _parse_s3_key(asset_key)
        processed_json_s3_key = _build_processed_json_key(
            user_id=key_parts["user_id"],
            project_id=key_parts["project_id"],
            asset_id=key_parts["asset_id"],
            file_id=key_parts["file_id"],
        )

        processed_data = {
            "fileID": file_identifier,
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "file_size": file_size,
            "file_type": file_ext,
            "data": result.get("data", {}),
            "charts": result.get("data", {}).get("charts", []),
            "metrics": result.get("data", {}).get("metrics", []),
            "insights": result.get("data", {}).get("insights", []),
        }

        if result.get("workflow_output"):
            output_dir = Path("storage/out")
            output_dir.mkdir(exist_ok=True, parents=True)
            workflow_output_file = output_dir / f"workflow_{file_identifier}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            result["workflow_output"].save_to_file(str(workflow_output_file))
            processed_data["workflow_output_path"] = str(workflow_output_file)

        processed_json_bytes = json.dumps(processed_data, ensure_ascii=False, indent=2).encode("utf-8")
        _upload_bytes_to_s3(asset_bucket, processed_json_s3_key, processed_json_bytes)

        asset_id = asset_info.get("asset_id")
        if asset_id:
            try:
                update_url = f"{BACKEND_API_URL}/api/v1/morpheus/asset/{asset_id}/processed-key"
                response = requests.put(
                    update_url,
                    json={"processed_json_s3_key": processed_json_s3_key},
                    timeout=10,
                )
                if response.status_code != 200:
                    logger.warning(f"Failed to update asset {asset_id}: {response.status_code} - {response.text}")
            except Exception as exc:
                logger.warning(f"Failed to update asset via API: {exc}")

        new_dashboard_record = None
        if result.get("data") and conversation_bucket:
            new_dashboard_record = _save_dashboard_artifact(
                bucket=conversation_bucket,
                conversation=conversation,
                dashboard_data=result["data"],
            )
            # Add dashboard to the last assistant node (or create one if needed)
            if conversation.get("nodes"):
                last_assistant_node = None
                for node in reversed(conversation["nodes"]):
                    if node.get("role") == "assistant":
                        last_assistant_node = node
                        break
                
                if last_assistant_node:
                    last_assistant_node["contents"].append(
                        {
                            "type": "dashboard",
                            "data": {
                                "dashboard_id": new_dashboard_record["dashboard_id"],
                                "s3_uri": new_dashboard_record["s3_uri"],
                            },
                        }
                    )
                else:
                    # Create a new assistant node for dashboard if none exists
                    dashboard_node = {
                        "node_id": f"node_{uuid.uuid4().hex[:8]}",
                        "role": "assistant",
                        "status": "completed",
                        "created_at": datetime.utcnow().isoformat(),
                        "contents": [
                            {
                                "type": "dashboard",
                                "data": {
                                    "dashboard_id": new_dashboard_record["dashboard_id"],
                                    "s3_uri": new_dashboard_record["s3_uri"],
                                },
                            }
                        ],
                    }
                    conversation.setdefault("nodes", []).append(dashboard_node)
            
            conversation.setdefault("dashboards", []).append(
                {
                    "dashboard_id": new_dashboard_record["dashboard_id"],
                    "s3_uri": new_dashboard_record["s3_uri"],
                    "created_at": datetime.utcnow().isoformat(),
                }
            )

        conversation["updated_at"] = datetime.utcnow().isoformat()
        _persist_conversation(conversation_uri, conversation_backup_uri, conversation)
        _post_node_status_sync(
            conversation_id,
            "completed",
            {
                "fileID": file_identifier,
                "dashboard_id": new_dashboard_record["dashboard_id"] if new_dashboard_record else None,
            },
        )

        logger.info(f"Workflow completed for conversation {conversation_id}")

    except Exception as exc:
        logger.error(f"Workflow failed for conversation {conversation_id}: {exc}")
        import traceback

        logger.error(traceback.format_exc())
        if conversation is not None:
            # Add error node to conversation
            error_node = {
                "node_id": f"node_{uuid.uuid4().hex[:8]}",
                "role": "assistant",
                "status": "error",
                "created_at": datetime.utcnow().isoformat(),
                "contents": [
                    {"type": "text", "data": {"text": f"Workflow failed: {exc}"}}
                ],
            }
            conversation.setdefault("nodes", []).append(error_node)
            conversation["updated_at"] = datetime.utcnow().isoformat()
            try:
                _persist_conversation(conversation_uri, conversation_backup_uri, conversation)
            except Exception as persist_error:
                logger.warning(f"Failed to persist errored conversation: {persist_error}")

        if processed_json_s3_key and conversation is not None:
            try:
                error_payload = {
                    "fileID": file_identifier,
                    "status": "error",
                    "error": str(exc),
                    "processed_at": datetime.now().isoformat(),
                }
                _upload_bytes_to_s3(
                    asset_bucket or conversation_bucket,
                    processed_json_s3_key,
                    json.dumps(error_payload, ensure_ascii=False, indent=2).encode("utf-8"),
                )
            except Exception as upload_error:
                logger.error(f"Failed to save error payload: {upload_error}")

        _post_node_status_sync(conversation_id, "error", {"error": str(exc)})

    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as cleanup_error:
                logger.warning(f"Failed to clean up temporary file {temp_file_path}: {cleanup_error}")


@app.post("/run")
async def run_workflow(request: RunRequest, background_tasks: BackgroundTasks):
    """
    Start workflow processing for a conversation.
    """
    try:
        if not request.conversation_uri:
            raise HTTPException(status_code=400, detail="conversation_uri is required")

        logger.info(
            "Received run request conversation_id=%s project_id=%s",
            request.conversation_id,
            request.project_id,
        )

        # Create workflow status node immediately before starting background task
        # This ensures the frontend can poll for status right away
        response = await _post_node_status(
            request.conversation_id,
            "processing",
            {
                "step": "initialized",
                "message": "Workflow queued for processing",
            },
        )
        if not response:
            return {
                "success": False,
                "data": {
                    "success": False,
                    "conversation_id": request.conversation_id,
                    "status": "error",
                    "message": "Failed to update node status",
                },
            }

        logger.info(f"Node status updated successfully: {response}")

        background_tasks.add_task(
            _process_conversation_background,
            request.conversation_id,
            request.conversation_uri,
            request.conversation_backup_uri,
            request.project_id,
            request.user_id,
        )

        return {
            "success": True,
            "data": {
                "success": True,
                "conversation_id": request.conversation_id,
                "status": "accepted",
                "message": "Workflow started in background",
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Run endpoint failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/status")
async def get_workflow_status(request: StatusRequest):
    """
    Proxy to backend workflow status poller.
    """
    try:
        logger.info(
            "Received status request for conversation %s",
            request.conversation_id,
        )
        response = requests.get(
            f"{BACKEND_API_URL}/api/v1/morpheus/workflow-status/{request.conversation_id}",
            params={"project_id": request.project_id},
            timeout=10,
        )
        if response.status_code == 200:
            return response.json()
        raise HTTPException(status_code=response.status_code, detail=response.text)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Status proxy failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return await check_health()
