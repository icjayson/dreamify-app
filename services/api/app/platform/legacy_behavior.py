"""Bounded compatibility helpers for legacy chat and dashboard contracts."""

import hashlib
import json
from typing import Any, Dict, Iterable, List, Mapping, Optional

from app.platform.errors import ApiError
from app.platform.models import WorkflowEvent, WorkflowRun, utc_now
from app.platform.repositories import WorkflowRepository

MAX_EXPLAINER_BYTES = 32 * 1024
MAX_CLARIFICATION_RESPONSE_BYTES = 16 * 1024

LEGACY_TEMPLATE_STYLES = {
    "default": ("default", None),
    "saas_growth": ("carbon", "saas_growth"),
    "ecommerce_sales": ("slate", "ecommerce_sales"),
    "finance_overview": ("chalk", "finance_overview"),
    "marketing_funnel": ("sage", "marketing_funnel"),
    "ops_performance": ("ash", "ops_performance"),
    "product_analytics": ("ink", "product_analytics"),
    "hr_workforce": ("warm", "hr_workforce"),
    "executive_summary": ("carbon", "executive_summary"),
}


def normalize_chat_request(request: Mapping[str, Any]) -> Dict[str, Any]:
    normalized = dict(request)
    template_id = normalized.get("template_id")
    mapped = LEGACY_TEMPLATE_STYLES.get(template_id)
    if mapped:
        theme_id, focus_id = mapped
        normalized.setdefault("theme_id", theme_id)
        if focus_id:
            normalized.setdefault("analysis_focus_id", focus_id)
    return normalized


def update_dashboard_presentation(
    content: Mapping[str, Any], style_key: str, value: str
) -> Dict[str, Any]:
    updated = dict(content)
    if style_key == "theme_id":
        updated["theme_id"] = value
        _sync_legacy_styling(updated, value)
        return updated
    mapped = LEGACY_TEMPLATE_STYLES.get(value)
    if mapped is None:
        raise ApiError(422, "TEMPLATE_UNSUPPORTED", "Template is not supported")
    theme_id, focus_id = mapped
    updated["theme_id"] = theme_id
    metadata = dict(updated.get("metadata") or {})
    metadata["template_id"] = value
    if focus_id:
        metadata["analysis_focus_id"] = focus_id
    else:
        metadata.pop("analysis_focus_id", None)
    updated["metadata"] = metadata
    _sync_legacy_styling(updated, theme_id)
    return updated


def _sync_legacy_styling(content: Dict[str, Any], theme_id: str) -> None:
    styling = content.get("styling_recommendations")
    if isinstance(styling, dict):
        content["styling_recommendations"] = {**styling, "theme": theme_id}


def bounded_explainer(output: Any) -> Dict[str, Any]:
    if not isinstance(output, dict):
        return {}
    edit_note = output.get("edit_note")
    summary = output.get("change_summary")
    if not isinstance(summary, dict) and isinstance(edit_note, str):
        summary = {"human_summary": edit_note}
    computed = output.get("computed_values")
    if not isinstance(computed, dict):
        computed = output.get("data_provenance")
    result = {
        "change_summary": _sanitize_json(summary)
        if isinstance(summary, dict)
        else None,
        "computed_values": _sanitize_json(computed)
        if isinstance(computed, dict)
        else None,
        "analysis_steps": _analysis_steps(output.get("analysis_steps")),
        "edit_note": edit_note[:2000] if isinstance(edit_note, str) else None,
    }
    return _fit_explainer(result)


def _analysis_steps(value: Any) -> Optional[List[Dict[str, Any]]]:
    if not isinstance(value, list):
        return None
    steps = [_sanitize_json(item) for item in value[:12] if isinstance(item, dict)]
    return [item for item in steps if isinstance(item, dict)] or None


def _sanitize_json(value: Any, depth: int = 0) -> Any:
    if depth >= 5:
        return None
    if isinstance(value, str):
        return value[:2000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, list):
        return [_sanitize_json(item, depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(key)[:80]: _sanitize_json(item, depth + 1)
            for key, item in list(value.items())[:32]
        }
    return None


def _json_size(value: Any) -> int:
    return len(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def _fit_explainer(result: Dict[str, Any]) -> Dict[str, Any]:
    steps = result.get("analysis_steps")
    while _json_size(result) > MAX_EXPLAINER_BYTES and steps:
        steps.pop()
    if _json_size(result) > MAX_EXPLAINER_BYTES:
        result["computed_values"] = None
    if _json_size(result) > MAX_EXPLAINER_BYTES:
        summary = result.get("change_summary") or {}
        human = summary.get("human_summary")
        result["change_summary"] = (
            {"human_summary": human[:2000]} if isinstance(human, str) else None
        )
    return {key: value for key, value in result.items() if value is not None}


def clarification_requests(output: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(output, dict):
        return {}
    candidates: List[Any] = []
    if output.get("type") == "clarification_request":
        candidates.append(output)
    batched = output.get("clarifications")
    if isinstance(batched, list):
        candidates.extend(batched[:20])
    requests: Dict[str, Dict[str, Any]] = {}
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        clarification_id = candidate.get("clarification_id")
        if isinstance(clarification_id, str) and clarification_id:
            requests[clarification_id] = candidate
    return requests


def validate_clarification_responses(
    contents: Iterable[Any], parent_output: Any
) -> None:
    responses = [
        _content_data(item)
        for item in contents
        if _content_type(item) == "clarification_response"
    ]
    if not responses:
        return
    if len(responses) > 20:
        raise _invalid_clarification("Too many clarification responses")
    requests = clarification_requests(parent_output)
    seen: set[str] = set()
    for response in responses:
        _validate_clarification_response(response, requests, seen)


def _validate_clarification_response(
    response: Dict[str, Any], requests: Dict[str, Dict[str, Any]], seen: set[str]
) -> None:
    if _json_size(response) > MAX_CLARIFICATION_RESPONSE_BYTES:
        raise _invalid_clarification("Clarification response exceeds 16 KiB")
    clarification_id = response.get("clarification_id")
    if not isinstance(clarification_id, str) or clarification_id not in requests:
        raise _invalid_clarification("Clarification id is not awaiting a response")
    if clarification_id in seen:
        raise _invalid_clarification("Clarification response is duplicated")
    seen.add(clarification_id)
    metadata = response.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise _invalid_clarification("Clarification metadata must be an object")
    _validate_selected_option(response, requests[clarification_id])


def _validate_selected_option(
    response: Dict[str, Any], request: Dict[str, Any]
) -> None:
    selected = response.get("selected_option_id")
    options = request.get("options")
    allowed = {
        item.get("id")
        for item in options or []
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    if allowed and selected not in allowed:
        raise _invalid_clarification("Selected clarification option is invalid")
    if not allowed and selected is not None:
        raise _invalid_clarification("Free-text clarification has no selectable option")


def _content_type(content: Any) -> Any:
    if hasattr(content, "type"):
        return content.type
    return content.get("type") if isinstance(content, dict) else None


def _content_data(content: Any) -> Dict[str, Any]:
    if hasattr(content, "data"):
        data = content.data
    else:
        data = content.get("data") if isinstance(content, dict) else None
    return data if isinstance(data, dict) else {}


def require_clarification(output: Any, clarification_id: str) -> Dict[str, Any]:
    request = clarification_requests(output).get(clarification_id)
    if request is None:
        raise ApiError(404, "CLARIFICATION_NOT_FOUND", "Clarification was not found")
    return request


def clarification_dismissal_key(clarification_id: str) -> str:
    digest = hashlib.sha256(clarification_id.encode("utf-8")).hexdigest()[:32]
    return f"clarification-dismissed:{digest}"


def clarification_dismissal_payload(clarification_id: str) -> Dict[str, Any]:
    return {
        "phase": "clarification",
        "status": "completed",
        "title": "Clarification dismissed",
        "metadata": {
            "clarification_id": clarification_id,
            "selected_option_id": None,
            "answer_status": "no_answer",
            "hidden": True,
        },
    }


def record_clarification_dismissal(
    repository: WorkflowRepository,
    run: WorkflowRun,
    clarification_id: str,
    max_events: int,
) -> WorkflowEvent:
    require_clarification(run.output, clarification_id)
    event_key = clarification_dismissal_key(clarification_id)
    existing = repository.get_event(run.id, event_key)
    if existing is not None:
        return existing
    if run.status != "awaiting_user_input":
        raise ApiError(
            409,
            "CLARIFICATION_NOT_AWAITING",
            "Clarification is no longer awaiting input",
        )
    if (
        len(repository.list_events(run.owner_id, run.id, limit=max_events))
        >= max_events
    ):
        raise ApiError(413, "EVENT_LIMIT_EXCEEDED", "Workflow event limit reached")
    event = repository.add_event(
        WorkflowEvent(
            owner_id=run.owner_id,
            run_id=run.id,
            sequence=repository.next_sequence(run.id),
            event_key=event_key,
            event_type="clarification_dismissed",
            payload=clarification_dismissal_payload(clarification_id),
        )
    )
    run.status = "cancelled"
    run.cancel_requested = True
    run.cancel_reason = "Clarification dismissed"
    run.current_step = "clarification_dismissed"
    run.completed_at = utc_now()
    run.version += 1
    return event


def _invalid_clarification(message: str) -> ApiError:
    return ApiError(400, "INVALID_CLARIFICATION_RESPONSE", message)
