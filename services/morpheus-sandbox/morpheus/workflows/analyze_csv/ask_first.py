"""
Deterministic ask-first policy for the analytics workflow.

The frontend/backend contract is intentionally small:
assistant nodes may carry a `clarification_request`, and user nodes answer with
`clarification_response`. This module decides when to produce those requests.
"""

from __future__ import annotations

import csv
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Sequence


Clarification = Dict[str, Any]

DATA_CONTEXT_PROMPT_RE = re.compile(
    r"\b("
    r"analy[sz]e|analysis|insights?|performance|kpis?|"
    r"trend|chart|graph|plot|visuali[sz]e|dashboard|report|metric|metrics|"
    r"sessions?|users?|visitors?|traffic|revenue|sales|orders?|spend|clicks?|"
    r"impressions?|ctr|cpc|roas|conversion|conversions?|compare|ranking|top|bottom"
    r")\b",
    re.IGNORECASE,
)

OUTPUT_MODE_PROMPT_RE = re.compile(
    r"^\s*(analy[sz]e|review|show|explore|summari[sz]e|insights?|performance)\b.{0,80}$",
    re.IGNORECASE,
)

CHART_TARGET_PROMPT_RE = re.compile(
    r"\b(this|that|the)?\s*(chart|graph|plot|visual|card|metric|table)\b.*\b("
    r"fix|repair|update|change|edit|correct|make|turn|convert|adjust"
    r")\b|"
    r"\b(fix|repair|update|change|edit|correct|adjust)\b.*\b(chart|graph|plot|visual|card|metric|table)\b",
    re.IGNORECASE,
)

DASHBOARD_UPDATE_PROMPT_RE = re.compile(
    r"\b(update|change|edit|improve|refresh|revise|modify|fix|repair|correct)\b",
    re.IGNORECASE,
)

NEW_DASHBOARD_PROMPT_RE = re.compile(
    r"\b(new|another|separate|fresh|from scratch|create|build|generate)\b",
    re.IGNORECASE,
)

JOIN_PROMPT_RE = re.compile(
    r"\b(join|merge|combine|blend|relate|relationship|together|across)\b",
    re.IGNORECASE,
)

TREND_PROMPT_RE = re.compile(
    r"\b(trend|over time|by date|timeline|daily|weekly|monthly|quarterly|yearly|wow|mom|yoy)\b",
    re.IGNORECASE,
)

GRAIN_RE = re.compile(
    r"\b(daily|day|weekly|week|monthly|month|quarterly|quarter|yearly|year|wow|mom|yoy)\b",
    re.I,
)

DATE_COLUMN_HINT_RE = re.compile(
    r"(date|time|day|week|month|year|created|updated|timestamp|period|start|end)",
    re.IGNORECASE,
)

NUMERIC_COLUMN_HINT_RE = re.compile(
    r"(revenue|sales|amount|price|cost|spend|click|impression|user|session|order|conversion|count|total|value|rate)",
    re.IGNORECASE,
)


def latest_user_node(conversation: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for node in reversed(conversation.get("nodes", [])):
        if node.get("role") == "user":
            return node
    return None


def latest_user_has_clarification_response(conversation: Dict[str, Any]) -> bool:
    node = latest_user_node(conversation)
    if not node:
        return False
    return any(
        content.get("type") == "clarification_response"
        for content in node.get("contents", [])
    )


def latest_clarification_metadata(conversation: Dict[str, Any]) -> Dict[str, Any]:
    node = latest_user_node(conversation)
    if not node:
        return {}
    response = _clarification_response_from_node(node)
    metadata = response.get("metadata") if isinstance(response, dict) else None
    return metadata if isinstance(metadata, dict) else {}


def answered_clarification_reason_codes(conversation: Dict[str, Any]) -> set[str]:
    request_reasons: Dict[str, str] = {}
    answered: set[str] = set()
    for node in conversation.get("nodes", []):
        for content in node.get("contents", []):
            data = content.get("data") or {}
            if not isinstance(data, dict):
                continue
            clarification_id = str(data.get("clarification_id") or "").strip()
            if not clarification_id:
                continue
            if content.get("type") == "clarification_request":
                reason_code = str(data.get("reason_code") or "").strip()
                if reason_code:
                    request_reasons[clarification_id] = reason_code
            elif content.get("type") == "clarification_response":
                reason_code = str(data.get("reason_code") or "").strip()
                if not reason_code:
                    reason_code = request_reasons.get(clarification_id, "")
                if reason_code:
                    answered.add(reason_code)
    return answered


def latest_user_prompt(conversation: Dict[str, Any]) -> Optional[str]:
    node = latest_user_node(conversation)
    if not node:
        return None
    return _text_from_node(node)


def latest_effective_user_prompt(conversation: Dict[str, Any]) -> Optional[str]:
    """Return the original ask when the latest user turn is a clarification answer."""
    latest = latest_user_node(conversation)
    if not latest:
        return None

    response = _clarification_response_from_node(latest)
    if not response:
        return _text_from_node(latest)

    clarification_id = str(response.get("clarification_id") or "").strip()
    if not clarification_id:
        return _text_from_node(latest)

    nodes = conversation.get("nodes", [])
    request_index = _find_clarification_request_index(nodes, clarification_id)
    original_prompt = _find_previous_user_prompt(nodes, request_index)
    answer_label = str(
        response.get("selected_option_label")
        or response.get("selected_option_id")
        or ""
    ).strip()
    free_text = str(response.get("free_text") or "").strip()
    metadata = (
        response.get("metadata") if isinstance(response.get("metadata"), dict) else {}
    )

    parts = [original_prompt or _text_from_node(latest) or ""]
    answer_parts = []
    if answer_label:
        answer_parts.append(f"Selected option: {answer_label}")
    if free_text:
        answer_parts.append(f"User note: {free_text}")
    if metadata:
        compact_metadata = {
            key: value
            for key, value in metadata.items()
            if key
            in {
                "route_mode",
                "target_chart_id",
                "target_dashboard_id",
                "date_column",
                "time_grain",
                "metric_column",
                "aggregation",
                "join_strategy",
                "update_scope",
                "context_request",
                "next_action",
                "asset_selection",
                "asset_ids",
            }
        }
        if compact_metadata:
            answer_parts.append(f"Clarification metadata: {compact_metadata}")
    if answer_parts:
        parts.append("Clarification answer:\n" + "\n".join(answer_parts))
    return "\n\n".join(part for part in parts if part).strip() or None


def is_data_context_needed(user_prompt: Optional[str]) -> bool:
    return bool(user_prompt and DATA_CONTEXT_PROMPT_RE.search(user_prompt))


def build_data_context_clarification(
    user_prompt: Optional[str],
    project_assets: Sequence[Dict[str, Any]],
    reason_code: str = "missing_data_context",
) -> Clarification:
    ranked_assets = rank_project_assets_for_prompt(list(project_assets), user_prompt)
    options: List[Dict[str, Any]] = []
    for asset in ranked_assets[:6]:
        asset_id = str(asset.get("asset_id") or "").strip()
        if not asset_id:
            continue
        row_count = asset.get("row_count")
        column_count = asset.get("column_count")
        shape = ""
        if row_count is not None and column_count is not None:
            shape = f" ({row_count} rows, {column_count} columns)"
        options.append(
            {
                "id": f"asset:{asset_id}",
                "label": asset_label(asset),
                "description": f"{asset.get('filename') or 'Project data'}{shape}",
                "recommended": len(options) == 0,
                "impact": "Use this source for the next analysis step",
                "metadata": {
                    "asset_ids": [asset_id],
                    "asset_selection": "explicit",
                    "asset": asset,
                },
            }
        )

    all_asset_ids = [
        str(asset.get("asset_id"))
        for asset in ranked_assets
        if str(asset.get("asset_id") or "").strip()
    ]
    if len(all_asset_ids) > 1:
        options.append(
            {
                "id": "all_project_data",
                "label": "Use all project data",
                "description": "Broader context, slower and less precise if sources are unrelated",
                "impact": "Best when the sources are meant to be analyzed together",
                "metadata": {
                    "asset_ids": all_asset_ids,
                    "asset_selection": "all",
                },
            }
        )

    options.append(
        {
            "id": "answer_without_data",
            "label": "Answer without data",
            "description": "Explain what data is needed instead of analyzing",
            "impact": "No dashboard or computed values will be produced",
            "metadata": {"asset_selection": "none"},
        }
    )

    question = (
        "Which matching data source should I use?"
        if reason_code == "multiple_matching_assets"
        else "Choose the data context"
    )
    return _clarification(
        reason_code=reason_code,
        question=question,
        options=options,
        allow_free_text=True,
        required=True,
    )


def build_analysis_context_clarification(
    user_prompt: Optional[str],
) -> Clarification:
    return _clarification(
        "analysis_context",
        "What context should I use for this analysis?",
        [
            {
                "id": "provide_data_first",
                "label": "Add data first",
                "description": "Upload a CSV or connect a data source before analysis",
                "recommended": True,
                "impact": "Best path for real metrics and charts",
                "metadata": {
                    "asset_selection": "none",
                    "next_action": "provide_data",
                },
            },
            {
                "id": "define_metric_scope",
                "label": "Define metric and period",
                "description": "Tell me the KPI, date range, segment, or business context",
                "impact": "I will turn that into an analysis plan while waiting for data",
                "metadata": {
                    "asset_selection": "none",
                    "context_request": "metric_scope",
                },
            },
            {
                "id": "answer_without_data",
                "label": "Explain what data is needed",
                "description": "Describe the inputs needed for a performance analysis",
                "impact": "No computed values or dashboard will be produced",
                "metadata": {
                    "asset_selection": "none",
                    "route_mode": "qa",
                },
            },
        ],
        allow_free_text=True,
        required=True,
    )


def choose_data_context_reason_code(
    user_prompt: Optional[str],
    project_assets: Sequence[Dict[str, Any]],
) -> str:
    ranked = rank_project_assets_for_prompt(list(project_assets), user_prompt)
    positive = [asset for asset in ranked if asset_score(asset, user_prompt) > 0]
    if len(positive) > 1:
        top_score = asset_score(positive[0], user_prompt)
        second_score = asset_score(positive[1], user_prompt)
        if top_score == second_score or second_score >= max(1, top_score - 2):
            return "multiple_matching_assets"
    return "missing_data_context"


def build_workflow_clarification(
    *,
    conversation: Dict[str, Any],
    user_prompt: str,
    user_assets: Sequence[Dict[str, Any]],
    dashboards: Dict[str, Any],
    file_paths: Sequence[str],
    assets_dict: Dict[str, str],
    data_profile: Optional[str],
    chart_mentions: Sequence[Dict[str, Any]],
) -> Optional[Clarification]:
    answered_reasons = answered_clarification_reason_codes(conversation)
    latest_metadata = latest_clarification_metadata(conversation)
    if latest_metadata.get("target_chart_id") or latest_metadata.get("route_mode"):
        return None
    if chart_mentions:
        return None

    charts = extract_dashboard_targets(dashboards)
    if (
        "chart_target" not in answered_reasons
        and len(charts) > 1
        and CHART_TARGET_PROMPT_RE.search(user_prompt or "")
    ):
        return build_chart_target_clarification(charts)

    if (
        "dashboard_update_scope" not in answered_reasons
        and dashboards
        and DASHBOARD_UPDATE_PROMPT_RE.search(user_prompt or "")
        and not NEW_DASHBOARD_PROMPT_RE.search(user_prompt or "")
    ):
        return build_dashboard_update_scope_clarification(dashboards)

    if (
        "join_strategy" not in answered_reasons
        and len(file_paths) > 1
        and not JOIN_PROMPT_RE.search(user_prompt or "")
    ):
        return build_join_strategy_clarification(assets_dict)

    if (
        "time_or_metric_definition" not in answered_reasons
        and TREND_PROMPT_RE.search(user_prompt or "")
        and file_paths
    ):
        time_clarification = build_time_or_metric_clarification(
            user_prompt, file_paths, data_profile
        )
        if time_clarification:
            return time_clarification

    if "output_mode" not in answered_reasons and _needs_output_mode_clarification(
        user_prompt, bool(user_assets or file_paths), bool(dashboards)
    ):
        return build_output_mode_clarification()

    return None


def build_clarification_message(clarification: Clarification) -> str:
    reason = clarification.get("reason_code")
    if reason in {"missing_data_context", "multiple_matching_assets"}:
        return "I need one choice before I analyze. I will not guess the data source."
    if reason == "analysis_context":
        return "I can analyze performance, but I need the data or the decision context first."
    if reason == "chart_target":
        return "I can make the edit, but I need to know which chart to target."
    if reason == "join_strategy":
        return "I found multiple files and need one decision about how to combine them."
    if reason == "time_or_metric_definition":
        return "I can calculate this, but the time or metric definition is ambiguous."
    if reason == "dashboard_update_scope":
        return "I need to know whether to update the current dashboard or create a new version."
    if reason == "output_mode":
        return "I can answer this a few ways. Pick the output shape before I spend time building it."
    return "I need one choice before I continue."


def build_chart_target_clarification(charts: Sequence[Dict[str, Any]]) -> Clarification:
    options = []
    for chart in charts[:8]:
        chart_id = str(chart.get("id") or chart.get("component_id") or "").strip()
        if not chart_id:
            continue
        options.append(
            {
                "id": f"chart:{chart_id}",
                "label": str(chart.get("title") or "Untitled chart"),
                "description": str(chart.get("type") or "chart"),
                "recommended": len(options) == 0,
                "impact": "Only this visual will be targeted for the edit",
                "metadata": {
                    "target_chart_id": chart_id,
                    "target_dashboard_id": chart.get("dashboard_id"),
                    "chart_title": chart.get("title"),
                    "chart_type": chart.get("type"),
                },
            }
        )
    return _clarification(
        "chart_target", "Which chart should I update?", options, allow_free_text=True
    )


def build_dashboard_update_scope_clarification(
    dashboards: Dict[str, Any],
) -> Clarification:
    latest_dashboard_id = next(reversed(dashboards.keys())) if dashboards else None
    return _clarification(
        "dashboard_update_scope",
        "Should I update the current dashboard or create a new one?",
        [
            {
                "id": "update_current",
                "label": "Update current dashboard",
                "description": "Apply the requested changes to the dashboard you are viewing",
                "recommended": True,
                "impact": "Keeps one evolving dashboard version",
                "metadata": {
                    "update_scope": "current",
                    "target_dashboard_id": latest_dashboard_id,
                },
            },
            {
                "id": "create_new",
                "label": "Create new dashboard",
                "description": "Keep the current dashboard and generate a separate version",
                "impact": "Useful for alternative analysis directions",
                "metadata": {"update_scope": "new"},
            },
        ],
        allow_free_text=True,
    )


def build_output_mode_clarification() -> Clarification:
    return _clarification(
        "output_mode",
        "What should I produce?",
        [
            {
                "id": "saved_dashboard",
                "label": "Saved dashboard",
                "description": "Build a reusable dashboard in the project panel",
                "recommended": True,
                "impact": "Best for ongoing reporting or sharing",
                "metadata": {"route_mode": "dashboard"},
            },
            {
                "id": "inline_visual",
                "label": "Inline visual answer",
                "description": "Answer in chat with one to three focused visuals",
                "impact": "Best for a quick analytical question",
                "metadata": {"route_mode": "qa_visual"},
            },
            {
                "id": "text_answer",
                "label": "Text answer",
                "description": "Answer concisely without creating visuals",
                "impact": "Fastest option for explanation-only questions",
                "metadata": {"route_mode": "qa"},
            },
        ],
        allow_free_text=True,
    )


def build_join_strategy_clarification(assets_dict: Dict[str, str]) -> Clarification:
    file_names = list(assets_dict.keys()) or ["the selected files"]
    return _clarification(
        "join_strategy",
        "How should I combine the files?",
        [
            {
                "id": "auto_join",
                "label": "Infer the best join",
                "description": ", ".join(file_names[:3]),
                "recommended": True,
                "impact": "I will inspect common keys and choose the safest join",
                "metadata": {"join_strategy": "auto"},
            },
            {
                "id": "analyze_separately",
                "label": "Analyze separately",
                "description": "Keep each file as its own analytical source",
                "impact": "Avoids accidental row multiplication from weak joins",
                "metadata": {"join_strategy": "separate"},
            },
            {
                "id": "left_join",
                "label": "Use first file as base",
                "description": "Left join other files onto the first selected file",
                "impact": "Preserves the primary source rows",
                "metadata": {"join_strategy": "left_join_first"},
            },
        ],
        allow_free_text=True,
    )


def build_time_or_metric_clarification(
    user_prompt: str,
    file_paths: Sequence[str],
    data_profile: Optional[str],
) -> Optional[Clarification]:
    columns = extract_columns_from_files(file_paths)
    if not columns and data_profile:
        columns = extract_columns_from_profile(data_profile)
    date_columns = [col for col in columns if DATE_COLUMN_HINT_RE.search(col)]
    numeric_columns = [col for col in columns if NUMERIC_COLUMN_HINT_RE.search(col)]

    if len(date_columns) <= 1 and GRAIN_RE.search(user_prompt or ""):
        return None

    options: List[Dict[str, Any]] = []
    if len(date_columns) > 1:
        for col in date_columns[:5]:
            options.append(
                {
                    "id": f"date:{col}",
                    "label": f"Use {col}",
                    "description": "Use this column for time-based grouping",
                    "recommended": len(options) == 0,
                    "impact": "Changes the trend timeline and comparisons",
                    "metadata": {"date_column": col},
                }
            )

    if not GRAIN_RE.search(user_prompt or ""):
        for grain in ("daily", "weekly", "monthly"):
            options.append(
                {
                    "id": f"grain:{grain}",
                    "label": grain.title(),
                    "description": f"Aggregate the trend at a {grain} grain",
                    "recommended": grain == "weekly"
                    and not any(o.get("recommended") for o in options),
                    "metadata": {"time_grain": grain},
                }
            )

    if (
        len(options) < 2
        and len(numeric_columns) > 1
        and re.search(
            r"\b(metric|value|total|average|avg|sum)\b", user_prompt or "", re.I
        )
    ):
        for col in numeric_columns[:5]:
            options.append(
                {
                    "id": f"metric:{col}",
                    "label": f"Use {col}",
                    "description": "Use this measure for the requested metric",
                    "recommended": len(options) == 0,
                    "metadata": {"metric_column": col, "aggregation": "sum"},
                }
            )

    if len(options) < 2:
        return None

    return _clarification(
        "time_or_metric_definition",
        "Which time or metric definition should I use?",
        options[:8],
        allow_free_text=True,
    )


def extract_dashboard_targets(dashboards: Dict[str, Any]) -> List[Dict[str, Any]]:
    targets: List[Dict[str, Any]] = []
    for dashboard_id, dashboard in dashboards.items():
        if not isinstance(dashboard, dict):
            continue
        for key, default_type in (
            ("charts", "chart"),
            ("metrics", "metric"),
            ("tables", "table"),
        ):
            items = dashboard.get(key)
            if not isinstance(items, list):
                continue
            for index, item in enumerate(items):
                if not isinstance(item, dict):
                    continue
                component_id = str(item.get("id") or f"{key}_{index + 1}")
                targets.append(
                    {
                        "id": component_id,
                        "component_id": component_id,
                        "dashboard_id": dashboard_id,
                        "title": item.get("title")
                        or item.get("name")
                        or f"{default_type.title()} {index + 1}",
                        "type": item.get("chart_type")
                        or item.get("type")
                        or default_type,
                        "config": item,
                    }
                )
    return targets


def extract_columns_from_files(file_paths: Sequence[str]) -> List[str]:
    columns: List[str] = []
    for path in file_paths[:3]:
        ext = os.path.splitext(path)[1].lower()
        try:
            if ext in {".csv", ".txt", ""}:
                with open(
                    path, newline="", encoding="utf-8", errors="replace"
                ) as handle:
                    reader = csv.reader(handle)
                    header = next(reader, [])
            elif ext in {".xlsx", ".xls"}:
                import pandas as pd

                header = list(pd.read_excel(path, nrows=0).columns)
            else:
                header = []
        except Exception:
            header = []
        for column in header:
            normalized = str(column).strip()
            if normalized and normalized not in columns:
                columns.append(normalized)
    return columns


def extract_columns_from_profile(data_profile: str) -> List[str]:
    match = re.search(r"Columns:\s*(.+)", data_profile)
    if not match:
        return []
    columns = []
    for chunk in match.group(1).split(","):
        name = chunk.strip().split(" (", 1)[0].strip()
        if name and name not in columns:
            columns.append(name)
    return columns


def rank_project_assets_for_prompt(
    project_assets: List[Dict[str, Any]], user_prompt: Optional[str]
) -> List[Dict[str, Any]]:
    return sorted(
        project_assets, key=lambda asset: asset_score(asset, user_prompt), reverse=True
    )


def asset_score(asset: Dict[str, Any], user_prompt: Optional[str]) -> int:
    prompt = (user_prompt or "").lower()
    raw = " ".join(
        str(asset.get(key) or "").lower()
        for key in ("filename", "asset_type", "extension")
    )
    total = 0
    if any(
        term in prompt
        for term in ("visitor", "traffic", "session", "user", "ga4", "analytics")
    ):
        total += (
            5
            if any(term in raw for term in ("ga4", "analytics", "visitor", "traffic"))
            else 0
        )
    if any(
        term in prompt for term in ("ad", "campaign", "spend", "click", "impression")
    ):
        total += 5 if "ads" in raw or "campaign" in raw else 0
    if any(term in prompt for term in ("revenue", "sales", "order", "payment")):
        total += (
            5
            if any(term in raw for term in ("stripe", "shopify", "sales", "revenue"))
            else 0
        )
    total += 1 if asset.get("row_count") not in (None, 0, "0") else 0
    return total


def asset_label(asset: Dict[str, Any]) -> str:
    filename = str(asset.get("filename") or "Data source").strip()
    source = (
        str(asset.get("asset_type") or "")
        .replace("integration_", "")
        .replace("_", " ")
        .strip()
    )
    return source.title() if source else filename


def _needs_output_mode_clarification(
    user_prompt: str, has_asset: bool, has_dashboard: bool
) -> bool:
    if not has_asset:
        return False
    prompt = user_prompt or ""
    lower = prompt.lower()
    if any(
        term in lower
        for term in (
            "dashboard",
            "report",
            "chart",
            "graph",
            "plot",
            "table",
            "visual",
            "text",
            "explain",
        )
    ):
        return False
    if has_dashboard and DASHBOARD_UPDATE_PROMPT_RE.search(prompt):
        return False
    return bool(OUTPUT_MODE_PROMPT_RE.search(prompt))


def _clarification(
    reason_code: str,
    question: str,
    options: Sequence[Dict[str, Any]],
    *,
    allow_free_text: bool = False,
    required: bool = True,
) -> Clarification:
    return {
        "clarification_id": str(uuid.uuid4()),
        "reason_code": reason_code,
        "question": question,
        "options": list(options),
        "allow_free_text": allow_free_text,
        "required": required,
    }


def _text_from_node(node: Dict[str, Any]) -> Optional[str]:
    for content in node.get("contents", []):
        if content.get("type") == "text":
            text = (content.get("data") or {}).get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
    return None


def _clarification_response_from_node(node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for content in node.get("contents", []):
        if content.get("type") == "clarification_response":
            data = content.get("data") or {}
            return data if isinstance(data, dict) else {}
    return None


def _find_clarification_request_index(
    nodes: Sequence[Dict[str, Any]], clarification_id: str
) -> Optional[int]:
    for index in range(len(nodes) - 1, -1, -1):
        node = nodes[index]
        if node.get("role") != "assistant":
            continue
        for content in node.get("contents", []):
            data = content.get("data") or {}
            if (
                content.get("type") == "clarification_request"
                and data.get("clarification_id") == clarification_id
            ):
                return index
    return None


def _find_previous_user_prompt(
    nodes: Sequence[Dict[str, Any]], before_index: Optional[int]
) -> Optional[str]:
    end = before_index if before_index is not None else len(nodes)
    for index in range(end - 1, -1, -1):
        node = nodes[index]
        if node.get("role") != "user":
            continue
        if _clarification_response_from_node(node):
            continue
        text = _text_from_node(node)
        if text:
            return text
    return None
