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
BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://localhost:8080")
MORPHEUS_API_KEY = os.environ.get("MORPHEUS_API_KEY", "dev-secret-key")

logger.info(
    "Config AWS credentials present: %s", "yes" if getattr(config, "aws", None) else "no"
)

def _parse_s3_key(s3_key: str) -> Optional[dict]:
    """Parse S3 key to extract user/project/asset metadata."""
    if s3_key is None:
        return None
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


def _fetch_asset_from_backend(asset_id: str) -> Optional[Dict[str, Any]]:
    """Fetch asset information from backend API using asset_id."""
    try:
        headers = {"X-Morpheus-Key": MORPHEUS_API_KEY}
        response = requests.get(
            f"{BACKEND_API_URL}/api/v1/morpheus/asset/{asset_id}",
            headers=headers,
            timeout=10,
        )
        if response.status_code == 200:
            asset_data = response.json()
            logger.info(f"Successfully fetched asset {asset_id} from backend API")
            return asset_data
        else:
            logger.warning(f"Failed to fetch asset {asset_id}: HTTP {response.status_code}")
            return None
    except Exception as e:
        logger.error(f"Error fetching asset {asset_id} from backend: {e}")
        return None


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
        timeout = aiohttp.ClientTimeout(total=100)
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


def _check_workflow_status(conversation_id: str, project_id: str) -> Optional[str]:
    """Check workflow status from database via backend API."""
    try:
        response = requests.get(
            f"{BACKEND_API_URL}/api/v1/morpheus/workflow-status/{conversation_id}",
            params={"project_id": project_id},
            timeout=5,
        )
        if response.status_code == 200:
            data = response.json()
            return data.get("status")
        else:
            logger.warning(
                f"Failed to check workflow status: HTTP {response.status_code} for conversation {conversation_id}"
            )
            return None
    except requests.exceptions.RequestException as e:
        logger.warning(f"Error checking workflow status for conversation {conversation_id}: {str(e)}")
        return None
    except Exception as e:
        logger.warning(f"Unexpected error checking workflow status for conversation {conversation_id}: {str(e)}")
        return None


def _extract_assets_from_nodes(conversation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract all asset content items from conversation nodes."""
    assets = []
    nodes = conversation.get("nodes", [])
    
    for node in nodes:
        node_created_at = node.get("created_at")
        contents = node.get("contents", [])
        for content in contents:
            content_type = content.get("type")
            if content_type in ["asset", "attachment"]:
                asset_data = content.get("data", {})
                # Ensure we have required fields
                if asset_data.get("asset_id") and asset_data.get("s3_bucket") and asset_data.get("s3_key"):
                    assets.append({
                        "asset_id": asset_data.get("asset_id"),
                        "file_id": asset_data.get("file_id"),
                        "s3_bucket": asset_data.get("s3_bucket"),
                        "s3_key": asset_data.get("s3_key"),
                        "extension": asset_data.get("extension", "csv"),
                        "filename": asset_data.get("filename", ""),
                        "node_created_at": node_created_at,
                    })
    
    # Sort assets by node_created_at (newest first)
    assets.sort(key=lambda x: x.get("node_created_at", ""), reverse=True)
    logger.info(f"Extracted {len(assets)} asset(s), sorted by created_at (newest first)")
    
    return assets


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
        
        # Map message types to conversation roles with strict logic
        # Distinguish tool executions, system instructions, and final responses
        if msg_type == "human":
            # Check if this is a workflow-generated instruction vs actual user prompt
            content_lower = str(msg_content).lower()
            workflow_keywords = ["user wants to:", "csv file available at:", "important:", "you must use tools"]
            if any(keyword in content_lower for keyword in workflow_keywords):
                role = "system"  # Workflow-generated instruction
            else:
                role = "user"  # Actual user prompt
        elif msg_type == "ai":
            # AI messages with tool_calls are tool execution triggers, not final responses
            if msg_tool_calls:
                role = "tool"  # AI message triggering tool execution
            else:
                role = "assistant"  # Final user-facing response
        elif msg_type == "system":
            role = "system"
        elif msg_type == "tool":
            role = "tool"  # Tool execution result
        else:
            role = "assistant"  # Fallback
        
        # Get timestamp as ISO string
        if isinstance(msg_timestamp, str):
            timestamp_iso = msg_timestamp
        elif hasattr(msg_timestamp, 'isoformat'):
            timestamp_iso = msg_timestamp.isoformat()
        else:
            timestamp_iso = datetime.utcnow().isoformat()
        
        # Build node(s)
        # Check if this is an AI message with both text explanation and JSON block
        # If so, split into two nodes: assistant (text) and system (JSON)
        content_str = str(msg_content)
        if role == "assistant" and "```json" in content_str:
            import re
            # Try to extract text before JSON block and JSON block separately
            json_match = re.search(r'```json\s*(.*?)\s*```', content_str, re.DOTALL)
            if json_match:
                # Extract text before JSON block
                json_start = content_str.find("```json")
                text_before = content_str[:json_start].strip()
                json_block = json_match.group(0)  # Full ```json...``` block
                
                # Create assistant node with text explanation (if exists)
                if text_before:
                    assistant_node = {
                        "node_id": f"node_{uuid.uuid4().hex[:8]}",
                        "role": "assistant",
                        "status": "completed",
                        "created_at": timestamp_iso,
                        "contents": [
                            {
                                "type": "text",
                                "data": {
                                    "text": text_before,
                                },
                            }
                        ],
                    }
                    nodes.append(assistant_node)
                
                # Create system node with JSON block (for debugging/admin view)
                system_node = {
                    "node_id": f"node_{uuid.uuid4().hex[:8]}",
                    "role": "system",
                    "status": "completed",
                    "created_at": timestamp_iso,
                    "contents": [
                        {
                            "type": "text",
                            "data": {
                                "text": json_block,
                            },
                        }
                    ],
                }
                nodes.append(system_node)
                
                # Skip the regular node creation below
                continue
        
        # Regular node creation for messages without JSON blocks
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

        # Extract all assets from conversation nodes
        assets = _extract_assets_from_nodes(conversation)
        logger.info(f"Found {len(assets)} asset(s) in conversation {conversation_id}")

        # Handle file download - download all assets or create placeholder for Q&A
        temp_file_paths = []
        if not assets:
            logger.info(f"No assets in conversation {conversation_id} - processing Q&A without file")
            # Create empty CSV file for Q&A mode (workflow will handle it)
            temp_dir = tempfile.gettempdir()
            temp_file_path = os.path.join(temp_dir, f"qa_{conversation_id}.csv")
            # Create minimal CSV file
            with open(temp_file_path, "w") as handle:
                handle.write("placeholder\n1\n")  # Minimal CSV for workflow
            temp_file_paths.append(temp_file_path)
            logger.info(f"Created placeholder file for Q&A: {temp_file_path}")
        else:
            _post_node_status_sync(conversation_id, "processing", {"step": "download_asset"})
            for idx, asset_info in enumerate(assets):
                asset_bucket = asset_info.get("s3_bucket")
                asset_key = asset_info.get("s3_key")
                
                if not asset_bucket or not asset_key:
                    logger.warning(f"Asset {asset_info.get('asset_id')} missing s3_bucket or s3_key, skipping")
                    continue
                
                logger.info(f"Downloading asset {idx + 1}/{len(assets)} for conversation {conversation_id}: s3://{asset_bucket}/{asset_key}")
                try:
                    file_content = download_bytes(asset_bucket, asset_key)
                    logger.info(f"Successfully downloaded {len(file_content)} bytes from S3")

                    # Safely get extension with proper None handling
                    extension = asset_info.get("extension", "csv")
                    if extension and isinstance(extension, str):
                        file_ext = extension.lstrip(".")
                    else:
                        file_ext = "csv"
                    
                    file_identifier = asset_info.get("file_id") or asset_info.get("asset_id") or f"{conversation_id}_{idx}"
                    temp_dir = tempfile.gettempdir()
                    temp_file_path = os.path.join(temp_dir, f"{file_identifier}.{file_ext}")
                    with open(temp_file_path, "wb") as handle:
                        handle.write(file_content)
                    temp_file_paths.append(temp_file_path)
                    logger.info(f"Saved file to {temp_file_path} ({os.path.getsize(temp_file_path)} bytes)")
                except Exception as e:
                    logger.error(f"Failed to download asset {asset_info.get('asset_id')}: {e}")
                    _post_node_status_sync(
                        conversation_id,
                        "error",
                        {
                            "step": "download_asset",
                            "error": f"Failed to download file: {str(e)}",
                            "asset_id": asset_info.get("asset_id"),
                        },
                    )
                    # Continue with other assets instead of returning
                    continue
            
            if not temp_file_paths:
                logger.error("No assets were successfully downloaded")
                _post_node_status_sync(
                    conversation_id,
                    "error",
                    {
                        "step": "download_asset",
                        "error": "Failed to download any assets",
                    },
                )
                return
        
        # Store primary_asset for later use in error handling and completion
        primary_asset = assets[0] if assets else None
        
        # Use first file path for backward compatibility with workflow (for now)
        # TODO: Update workflow to accept multiple file paths
        temp_file_path = temp_file_paths[0] if temp_file_paths else None
        logger.info(f"Selected primary file path: {temp_file_path} (from {len(temp_file_paths)} downloaded assets)")

        workflow = AnalyzeCSVWorkflow()
        _post_node_status_sync(conversation_id, "processing", {"step": "run_workflow"})
        
        # Extract user prompt from latest user node
        user_prompt = None
        nodes = conversation.get("nodes", [])
        for node in reversed(nodes):
            if node.get("role") == "user":
                contents = node.get("contents", [])
                for content in contents:
                    if content.get("type") == "text":
                        user_prompt = content.get("data", {}).get("text")
                        break
                if user_prompt:
                    break
        
        result = workflow.execute(
            file_path=temp_file_path,
            conversation=conversation,
            dashboards=dashboards_cache,
            user_prompt=user_prompt,
        )
        
        # Validate result is not None
        if result is None:
            error_msg = "Workflow returned None result"
            logger.error(error_msg)
            _post_node_status_sync(conversation_id, "error", {"error": error_msg})
            return
        
        # Detect response type from result structure
        # Dashboard: has "data" dict with charts/metrics
        # Q&A: has "content" string
        response_type = result.get("type")
        if not response_type:
            # Auto-detect if type not provided
            if result.get("data") and isinstance(result.get("data"), dict):
                response_type = "dashboard_config"
            elif result.get("content") and isinstance(result.get("content"), str):
                response_type = "message"
            else:
                # Default to dashboard for backward compatibility
                response_type = "dashboard_config"
        
        logger.info(f"Detected response type: {response_type}")
        
        # Postprocess workflow messages into conversation nodes
        workflow_output = result.get("workflow_output")
        if workflow_output:
            postprocessed_nodes = _postprocess_workflow_to_conversation_nodes(workflow_output)
            conversation.setdefault("nodes", []).extend(postprocessed_nodes)

        # Handle Q&A responses (type == "message")
        if response_type == "message":
            logger.info("Processing Q&A response - skipping dashboard generation")
            
            # Extract Q&A content from result
            qa_content = result.get("content", "I've processed your question.")
            
            # The workflow_output messages have already been added to conversation nodes above
            # But we should ensure the final assistant response is clear
            # The postprocessed_nodes should already contain the assistant's text response
            
            # Q&A responses don't generate dashboards, just save conversation with text response
            conversation["updated_at"] = datetime.utcnow().isoformat()
            _persist_conversation(conversation_uri, conversation_backup_uri, conversation)
            
            # Post completion status with Q&A content in metadata
            file_identifier = assets[0].get("file_id") or assets[0].get("asset_id") if assets else conversation_id
            _post_node_status_sync(
                conversation_id,
                "completed",
                {
                    "fileID": file_identifier,
                    "response_type": "message",
                    "content": qa_content,
                },
            )
            
            logger.info(f"Q&A workflow completed for conversation {conversation_id}")
            return

        # Handle Dashboard responses (type == "dashboard_config")
        logger.info("Processing Dashboard response")
        
        # Use first asset for processed JSON key generation (for backward compatibility)
        primary_asset = assets[0] if assets else None
        file_size = os.path.getsize(temp_file_path) if temp_file_path and os.path.exists(temp_file_path) else 0
        processed_json_s3_key = None
        
        if primary_asset and primary_asset.get("s3_key"):
            asset_key = primary_asset.get("s3_key")
            key_parts = _parse_s3_key(asset_key)
            if key_parts:
                processed_json_s3_key = _build_processed_json_key(
                    user_id=key_parts["user_id"],
                    project_id=key_parts["project_id"],
                    asset_id=key_parts["asset_id"],
                    file_id=key_parts["file_id"],
                )
            else:
                logger.warning(f"Failed to parse asset_key: {asset_key}")
        else:
            logger.warning(f"No asset_key available for processed JSON key generation")

        result_data = result.get("data", {}) if result else {}
        if not isinstance(result_data, dict):
            result_data = {}
        
        file_identifier = primary_asset.get("file_id") or primary_asset.get("asset_id") if primary_asset else conversation_id
        file_ext = primary_asset.get("extension", "csv").lstrip(".") if primary_asset else "csv"
        
        processed_data = {
            "fileID": file_identifier,
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "file_size": file_size,
            "file_type": file_ext,
            "data": result_data,
            "charts": result_data.get("charts", []),
            "metrics": result_data.get("metrics", []),
            "insights": result_data.get("insights", []),
        }

        if result.get("workflow_output"):
            output_dir = Path("storage/out")
            output_dir.mkdir(exist_ok=True, parents=True)
            workflow_output_file = output_dir / f"workflow_{file_identifier}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            result["workflow_output"].save_to_file(str(workflow_output_file))
            processed_data["workflow_output_path"] = str(workflow_output_file)

        processed_json_bytes = json.dumps(processed_data, ensure_ascii=False, indent=2).encode("utf-8")
        if processed_json_s3_key and primary_asset:
            asset_bucket = primary_asset.get("s3_bucket")
            if asset_bucket:
                _upload_bytes_to_s3(asset_bucket, processed_json_s3_key, processed_json_bytes)
            else:
                logger.warning(f"Skipping processed JSON upload: missing asset_bucket")
        else:
            logger.warning(f"Skipping processed JSON upload: processed_json_s3_key={processed_json_s3_key}, primary_asset={primary_asset is not None}")

        asset_id = primary_asset.get("asset_id") if primary_asset else None
        if asset_id and processed_json_s3_key:
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

        dashboard_title = None
        dashboard_description = None
        result_data = result.get("data")
        if result_data:
            dashboard_meta = result_data.get("dashboard") if isinstance(result_data, dict) else {}
            if isinstance(dashboard_meta, dict):
                dashboard_title = dashboard_meta.get("title")
                dashboard_description = dashboard_meta.get("description")

        new_dashboard_record = None
        result_data = result.get("data")
        if result_data and isinstance(result_data, dict) and conversation_bucket:
            logger.info(
                f"Saving dashboard artifact for conversation {conversation_id}, data keys: {list(result_data.keys())}"
            )
            try:
                new_dashboard_record = _save_dashboard_artifact(
                    bucket=conversation_bucket,
                    conversation=conversation,
                    dashboard_data=result_data,
                )
                logger.info(
                    f"Successfully saved dashboard {new_dashboard_record.get('dashboard_id')} "
                    f"to s3://{new_dashboard_record.get('s3_bucket')}/{new_dashboard_record.get('s3_key')}"
                )
            except Exception as e:
                logger.error(f"Failed to save dashboard artifact: {e}", exc_info=True)
                raise
        else:
            logger.warning(
                f"Skipping dashboard save: result_data={result_data is not None}, "
                f"result_data_type={type(result_data).__name__ if result_data else None}, "
                f"conversation_bucket={conversation_bucket}"
            )

        # If we have a saved dashboard record, attach it to the conversation structure
        if new_dashboard_record:
            # Add dashboard reference to the last assistant node (or create one if needed)
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

            # Append to conversation-level dashboards list for backend /dashboard endpoint
            conversation.setdefault("dashboards", []).append(
                {
                    "dashboard_id": new_dashboard_record["dashboard_id"],
                    "s3_uri": new_dashboard_record["s3_uri"],
                    "created_at": datetime.utcnow().isoformat(),
                }
            )

        conversation["updated_at"] = datetime.utcnow().isoformat()
        _persist_conversation(conversation_uri, conversation_backup_uri, conversation)
        
        completion_file_identifier = primary_asset.get("file_id") or primary_asset.get("asset_id") if primary_asset else conversation_id
        _post_node_status_sync(
            conversation_id,
            "completed",
            {
                "fileID": completion_file_identifier,
                # Explicitly mark this as a dashboard response for frontend routing
                "response_type": "dashboard_config",
                "dashboard_id": new_dashboard_record["dashboard_id"] if new_dashboard_record else None,
            },
        )

        # Update project metadata in backend so UI can restore conversations/dashboards
        try:
            project_metadata_payload = {
                "user_id": user_id,
                "name": dashboard_title,
                "description": dashboard_description,
                "latest_conversation_id": conversation_id,
                "latest_dashboard_id": new_dashboard_record["dashboard_id"]
                if new_dashboard_record
                else None,
                "dashboard_title": dashboard_title,
            }
            headers = {"X-Morpheus-Key": MORPHEUS_API_KEY}
            response = requests.put(
                f"{BACKEND_API_URL}/api/v1/morpheus/project/{project_id}/metadata",
                json=project_metadata_payload,
                headers=headers,
                timeout=10,
            )
            if response.status_code != 200:
                logger.warning(
                    "Failed to update project metadata for %s: %s %s",
                    project_id,
                    response.status_code,
                    response.text,
                )
        except Exception as exc:
            logger.warning("Project metadata update failed: %s", exc)

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

        if processed_json_s3_key and conversation is not None and primary_asset:
            try:
                error_file_identifier = primary_asset.get("file_id") or primary_asset.get("asset_id") or conversation_id
                error_payload = {
                    "fileID": error_file_identifier,
                    "status": "error",
                    "error": str(exc),
                    "processed_at": datetime.now().isoformat(),
                }
                error_asset_bucket = primary_asset.get("s3_bucket") or conversation_bucket
                _upload_bytes_to_s3(
                    error_asset_bucket,
                    processed_json_s3_key,
                    json.dumps(error_payload, ensure_ascii=False, indent=2).encode("utf-8"),
                )
            except Exception as upload_error:
                logger.error(f"Failed to save error payload: {upload_error}")

        _post_node_status_sync(conversation_id, "error", {"error": str(exc)})

    finally:
        # Clean up all downloaded asset files
        if temp_file_paths:
            for temp_path in temp_file_paths:
                if temp_path and os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception as cleanup_error:
                        logger.warning(f"Failed to clean up temporary file {temp_path}: {cleanup_error}")


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
