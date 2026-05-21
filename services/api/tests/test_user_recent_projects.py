import asyncio
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from app.main import app
from app.api.route_modules.user import list_recent_projects_endpoint


def _project(project_id: str, updated_at: str, name: str = "Project"):
    return {
        "project_id": project_id,
        "user_id": "user_1",
        "name": name,
        "updated_at": updated_at,
        "created_at": updated_at,
    }


def test_recent_projects_endpoint_uses_limit_and_maps_response():
    with patch(
        "app.api.route_modules.user.projects_repo.list_recent_projects"
    ) as mock_recent:
        mock_recent.return_value = [
            _project("p1", "2026-05-02T00:00:00+00:00", "Newest"),
            _project("p2", "2026-05-01T00:00:00+00:00", "Older"),
        ]

        response = asyncio.run(list_recent_projects_endpoint(limit=2, user_id="user_1"))

    assert [item.id for item in response.projects] == ["p1", "p2"]
    mock_recent.assert_called_once_with("user_1", limit=2)


def test_recent_projects_endpoint_clamps_large_limit():
    with patch(
        "app.api.route_modules.user.projects_repo.list_recent_projects"
    ) as mock_recent:
        mock_recent.return_value = []

        response = asyncio.run(
            list_recent_projects_endpoint(limit=500, user_id="user_1")
        )

    assert response.projects == []
    mock_recent.assert_called_once_with("user_1", limit=50)


def test_list_recent_projects_falls_back_and_sorts_when_gsi_unavailable():
    from utils.dynamodb.repos import projects

    table = MagicMock()
    table.query.side_effect = [
        ClientError(
            {
                "Error": {
                    "Code": "ValidationException",
                    "Message": "The table does not have the specified index: user_id_updated_at_index",
                }
            },
            "Query",
        ),
        {
            "Items": [
                _project("old", "2026-05-01T00:00:00+00:00"),
                _project("new", "2026-05-03T00:00:00+00:00"),
                _project("mid", "2026-05-02T00:00:00+00:00"),
            ]
        },
    ]

    with patch.object(projects, "get_table", return_value=table):
        result = projects.list_recent_projects("user_1", limit=2)

    assert [item["project_id"] for item in result] == ["new", "mid"]
    assert table.query.call_count == 2


def test_openapi_includes_recent_projects_endpoint():
    assert "/api/v1/user/project/recent" in app.openapi().get("paths", {})
