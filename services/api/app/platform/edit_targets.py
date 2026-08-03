"""Pure validation helpers for explicit in-place dashboard edits."""

from typing import Any, Dict, Iterable, Optional, Set

from app.platform.errors import ApiError
from app.platform.schemas import ConversationChatCreate, ConversationEditTarget


def normalize_edit_target(
    payload: ConversationChatCreate,
) -> Optional[ConversationEditTarget]:
    mentions = [
        content.data
        for content in payload.user_node_contents
        if content.type == "chart_mention"
    ]
    mention_target = _target_from_mentions(mentions) if mentions else None
    explicit = payload.edit_target
    if explicit and mention_target:
        if explicit.dashboard_id != mention_target.dashboard_id or set(
            explicit.component_ids
        ) != set(mention_target.component_ids):
            raise ApiError(
                422,
                "EDIT_TARGET_MISMATCH",
                "edit_target does not match the chart mentions",
            )
    return explicit or mention_target


def require_target_components(
    dashboard: Dict[str, Any], component_ids: Iterable[str]
) -> None:
    available = dashboard_component_ids(dashboard)
    missing = sorted(set(component_ids) - available)
    if missing:
        raise ApiError(
            409,
            "EDIT_TARGET_COMPONENT_MISMATCH",
            "The dashboard no longer contains every requested edit target",
            {"missing_component_ids": missing},
        )


def dashboard_component_ids(dashboard: Dict[str, Any]) -> Set[str]:
    identifiers: Set[str] = set()
    for component in dashboard.get("components") or []:
        if not isinstance(component, dict):
            continue
        _add_id(identifiers, component.get("id"))
        config = component.get("component_config")
        if isinstance(config, dict):
            _add_id(identifiers, config.get("id"))
    for collection in ("charts", "metrics", "tables"):
        for component in dashboard.get(collection) or []:
            if isinstance(component, dict):
                _add_id(identifiers, component.get("id"))
    return identifiers


def _target_from_mentions(mentions: list[Dict[str, Any]]) -> ConversationEditTarget:
    dashboard_ids = {
        value
        for mention in mentions
        if isinstance((value := mention.get("dashboard_id")), str) and value.strip()
    }
    raw_component_ids = [
        [
            value
            for key in ("component_id", "chart_id")
            if isinstance((value := mention.get(key)), str) and value.strip()
        ]
        for mention in mentions
    ]
    component_ids = list(
        dict.fromkeys(value for values in raw_component_ids for value in values)
    )
    if len(dashboard_ids) != 1 or any(not values for values in raw_component_ids):
        raise ApiError(
            422,
            "EDIT_TARGET_INCOMPLETE",
            "Every chart mention must identify one shared dashboard and a component",
        )
    return ConversationEditTarget(
        dashboard_id=next(iter(dashboard_ids)), component_ids=component_ids
    )


def _add_id(identifiers: Set[str], value: object) -> None:
    if isinstance(value, str) and value:
        identifiers.add(value)
