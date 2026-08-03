"""Explicit access policy for every deployed HTTP operation."""

import re
from typing import Dict, Iterable, Iterator, Set, Tuple

from fastapi.routing import APIRoute

Operation = Tuple[str, str]


def _operations(methods: Iterable[str], paths: Iterable[str]) -> Set[Operation]:
    return {(method, path) for path in paths for method in methods}


PUBLIC_OPERATIONS = _operations(
    ["GET"],
    [
        "/health",
        "/health/ready",
        "/api/v1/health",
        "/api/v1/health/ready",
        "/api/v1/capabilities",
        "/api/v1/docs",
        "/api/v1/openapi.json",
        "/api/v1/redoc",
        "/api/v1/public/project/{project_id}",
        "/api/v1/public/project/{project_id}/dashboard",
        "/api/v1/public/conversation/{conversation_id}/dashboard",
        "/api/v1/blog/posts",
        "/api/v1/blog/posts/{slug}",
        "/docs/oauth2-redirect",
    ],
) | _operations(
    ["POST"],
    [
        "/api/v1/feedback",
        "/api/v1/feedback/overall",
    ],
)

USER_OPERATIONS = (
    _operations(
        ["GET", "POST"],
        [
            "/api/v1/projects",
            "/api/v1/projects/{project_id}/members",
            "/api/v1/projects/{project_id}/operator-briefs",
            "/api/v1/conversations",
            "/api/v1/dashboards",
            "/api/v1/workflow-runs",
        ],
    )
    | _operations(
        ["GET", "PATCH", "DELETE"],
        [
            "/api/v1/projects/{project_id}",
            "/api/v1/conversations/{conversation_id}",
            "/api/v1/dashboards/{dashboard_id}",
        ],
    )
    | _operations(
        ["GET", "PATCH", "DELETE"],
        ["/api/v1/projects/{project_id}/members/{member_id}"],
    )
    | _operations(
        ["GET", "DELETE"],
        ["/api/v1/assets/{asset_id}", "/api/v1/user/asset/{asset_id}"],
    )
    | _operations(
        ["GET"],
        [
            "/api/v1/users/me",
            "/api/v1/user/lookup",
            "/api/v1/files/preview/{asset_id}",
            "/api/v1/projects/{project_id}/assets",
            "/api/v1/dashboards/{dashboard_id}/versions",
            "/api/v1/uploads/intents/{intent_id}",
            "/api/v1/workflow-runs/{run_id}",
            "/api/v1/workflow-runs/{run_id}/events",
            "/api/v1/conversation/workflow-status/{conversation_id}",
            "/api/v1/conversation/workflow-events/{conversation_id}",
            "/api/v1/conversation/{conversation_id}",
            "/api/v1/conversation/{conversation_id}/stream",
            "/api/v1/conversation/{conversation_id}/dashboard",
            "/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/versions",
            "/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/versions/{version}",
            "/api/v1/user/project/list",
            "/api/v1/user/project/recent",
            "/api/v1/user/project/detail/{project_id}",
            "/api/v1/user/asset/list",
            "/api/v1/user/asset/{asset_id}/download-url",
            "/api/v1/provider-connections",
            "/api/v1/notifications",
            "/api/v1/operator-briefs",
            "/api/v1/operator-briefs/{brief_id}",
        ],
    )
    | _operations(
        ["POST"],
        [
            "/api/v1/uploads/intents",
            "/api/v1/uploads/blob-token/validate",
            "/api/v1/uploads/{reservation_id}/finalize",
            "/api/v1/uploads/intents/{reservation_id}/finalize",
            "/api/v1/workflow-runs",
            "/api/v1/workflow-runs/{run_id}/cancel",
            "/api/v1/conversation/chat",
            "/api/v1/conversation/{conversation_id}/stop",
            "/api/v1/conversation/{conversation_id}/clarification/{clarification_id}/dismiss",
            "/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/revert",
            "/api/v1/user/project/create",
            "/api/v1/provider-connections/{provider}/activate",
            "/api/v1/provider-connections/{provider}/verify",
            "/api/v1/notifications/mark-read",
        ],
    )
    | _operations(
        ["PATCH"],
        ["/api/v1/operator-briefs/{brief_id}/outcome"],
    )
    | _operations(
        ["PUT"],
        [
            "/api/v1/uploads/{reservation_id}/content",
            "/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/data",
            "/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/template",
            "/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/theme",
            "/api/v1/user/project/{project_id}",
            "/api/v1/provider-connections/{provider}",
        ],
    )
    | _operations(
        ["DELETE"],
        [
            "/api/v1/user/project/{project_id}",
            "/api/v1/provider-connections/{provider}",
        ],
    )
)

OWNER_ADMIN_OPERATIONS = (
    _operations(
        ["GET"],
        [
            "/api/v1/admin/metrics",
            "/api/v1/admin/metrics/timeseries",
            "/api/v1/admin/users",
            "/api/v1/admin/users/{user_id}",
            "/api/v1/admin/conversations",
            "/api/v1/admin/conversations/{conversation_id}",
            "/api/v1/admin/conversations/{conversation_id}/nodes",
            "/api/v1/admin/conversations/{conversation_id}/dashboard",
            "/api/v1/admin/conversations/{conversation_id}/assets/{asset_id}/preview",
            "/api/v1/admin/blog/posts",
            "/api/v1/admin/blog/posts/{post_id}",
        ],
    )
    | _operations(
        ["POST"],
        [
            "/api/v1/admin/blog/posts",
            "/api/v1/admin/blog/assets",
        ],
    )
    | _operations(
        ["PATCH"],
        [
            "/api/v1/admin/blog/posts/{post_id}",
            "/api/v1/admin/blog/posts/{post_id}/feature",
        ],
    )
    | _operations(["DELETE"], ["/api/v1/admin/blog/posts/{post_id}"])
)

BLOB_GATEWAY_OPERATIONS = _operations(["POST"], ["/api/v1/uploads/blob-completed"])

INTERNAL_SERVICE_OPERATIONS = (
    _operations(
        ["POST"],
        [
            "/api/v1/internal/assets/resolve",
            "/api/v1/internal/storage/cleanup",
            "/api/v1/internal/workflow/capacity/acquire",
            "/api/v1/internal/workflow/capacity/release",
            "/api/v1/internal/workflow/runs/{run_id}/claim",
            "/api/v1/internal/workflow/runs/{run_id}/dispatch/authorize",
            "/api/v1/internal/workflow/runs/{run_id}/dispatch/receipt",
            "/api/v1/internal/workflow/runs/{run_id}/provider/resolve",
            "/api/v1/internal/workflow/runs/{run_id}/provider-calls/reserve",
            "/api/v1/internal/workflow/runs/{run_id}/transition",
            "/api/v1/internal/workflow/runs/{run_id}/response",
            "/api/v1/internal/workflow/runs/{run_id}/cancel",
            "/api/v1/internal/workflow/runs/{run_id}/artifacts",
            "/api/v1/internal/workflow/runs/{run_id}/steps/{step_key}/begin",
            "/api/v1/workflow-runs/{run_id}/events",
        ],
    )
    | _operations(
        ["GET"],
        [
            "/api/v1/internal/workflow/runs/{run_id}",
            "/api/v1/internal/workflow/runs/{run_id}/context",
            "/api/v1/internal/workflow/runs/{run_id}/response",
            "/api/v1/internal/workflow/runs/{run_id}/artifacts/{object_id}",
            "/api/v1/internal/workflow/runs/{run_id}/steps/{step_key}",
        ],
    )
    | _operations(["PUT"], ["/api/v1/internal/workflow/runs/{run_id}/steps/{step_key}"])
)

DISABLED_OPERATIONS = _operations(
    ["GET", "POST", "PUT", "PATCH", "DELETE"],
    [
        "/api/v1/billing/{action:path}",
        "/api/v1/connectors/{provider}/{action:path}",
        "/api/v1/dashboard/{action:path}",
        "/api/v1/integration/{action:path}",
        "/api/v1/schedules",
        "/api/v1/schedules/{action:path}",
        "/api/v1/sync-runs",
        "/api/v1/sync-runs/{action:path}",
    ],
) | _operations(
    ["POST"],
    [
        "/api/v1/user/asset/{action:path}",
    ],
)


def _manifest() -> Dict[Operation, str]:
    groups = {
        "public": PUBLIC_OPERATIONS,
        "user": USER_OPERATIONS,
        "blob-gateway": BLOB_GATEWAY_OPERATIONS,
        "internal-service": INTERNAL_SERVICE_OPERATIONS,
        "owner-admin": OWNER_ADMIN_OPERATIONS,
        "disabled": DISABLED_OPERATIONS,
    }
    manifest: Dict[Operation, str] = {}
    for access, operations in groups.items():
        overlap = set(manifest).intersection(operations)
        if overlap:
            raise RuntimeError(f"Access policy overlaps: {sorted(overlap)}")
        manifest.update({operation: access for operation in operations})
    return manifest


ROUTE_ACCESS_POLICY = _manifest()


def openapi_access_policy() -> Dict[Operation, str]:
    """Return the policy using OpenAPI's normalized path-parameter syntax."""
    normalized: Dict[Operation, str] = {}
    for (method, path), access in ROUTE_ACCESS_POLICY.items():
        openapi_path = re.sub(r"{([^}:]+):[^}]+}", r"{\1}", path)
        key = (method, openapi_path)
        if key in normalized and normalized[key] != access:
            raise RuntimeError(f"OpenAPI access policy overlaps: {key}")
        normalized[key] = access
    return normalized


def iter_http_routes(routes: Iterable[object]) -> Iterator[object]:
    """Yield concrete routes through FastAPI's nested included-router wrapper."""
    for route in routes:
        included_router = getattr(route, "original_router", None)
        if included_router is not None:
            yield from iter_http_routes(included_router.routes)
            continue
        if getattr(route, "path", None) and getattr(route, "methods", None):
            yield route


def operation_keys(routes: Iterable[object]) -> Set[Operation]:
    operations: Set[Operation] = set()
    for route in iter_http_routes(routes):
        for method in getattr(route, "methods", set()) or set():
            if method not in {"HEAD", "OPTIONS"}:
                operations.add((method, route.path))
    return operations


def annotate_and_validate_access_policy(routes: Iterable[object]) -> None:
    """Fail startup on an unclassified route and publish policy in OpenAPI."""
    actual = operation_keys(routes)
    expected = set(ROUTE_ACCESS_POLICY)
    if actual != expected:
        missing = sorted(actual - expected)
        stale = sorted(expected - actual)
        raise RuntimeError(
            f"Route access policy mismatch; unclassified={missing}, stale={stale}"
        )
    for route in iter_http_routes(routes):
        methods = {
            method
            for method in (getattr(route, "methods", set()) or set())
            if method not in {"HEAD", "OPTIONS"}
        }
        access = {ROUTE_ACCESS_POLICY[(method, route.path)] for method in methods}
        if len(access) != 1:
            raise RuntimeError(
                f"Route methods require a single access class: {route.path}"
            )
        if isinstance(route, APIRoute):
            route.openapi_extra = {
                **(route.openapi_extra or {}),
                "x-dreamify-access": access.pop(),
            }
